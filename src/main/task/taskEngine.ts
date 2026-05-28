import type {
  AiTask,
  EnvironmentContext,
  LlmCommandHistoryEntry,
  LlmPlanNextCommandResult,
  ModelConfig,
  ServerConfig,
  TaskApproveAndExecuteStepRequest,
  TaskPlanNextStepRequest,
  TaskStartRequest,
  TaskStep,
  TaskStopRequest
} from "../../shared/types";
import { collectEnvironmentContext } from "../context/contextCollector";
import { saveTaskHistory } from "../history/historyStore";
import { planNextCommand } from "../llm/llmClient";
import { analyzeCommandRisk } from "../safety/commandRisk";
import { executeCommand } from "../ssh/sshClient";

interface TaskSession {
  task: AiTask;
  modelConfig: ModelConfig;
  serverConfig: ServerConfig;
  currentCwd: string;
  context: EnvironmentContext | null;
}

function now(): string {
  return new Date().toISOString();
}

function createTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneTask(task: AiTask): AiTask {
  return JSON.parse(JSON.stringify(task)) as AiTask;
}

function tail(value: string, maxLength = 2000): string {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

function toHistoryEntry(step: TaskStep): LlmCommandHistoryEntry | null {
  if (!step.executionResult) {
    return null;
  }

  return {
    stepId: step.stepId,
    command: step.executionResult.command,
    stdoutTail: tail(step.executionResult.stdout),
    stderrTail: tail(step.executionResult.stderr),
    exitCode: step.executionResult.exitCode,
    cwd: step.executionResult.cwd,
    durationMs: step.executionResult.durationMs
  };
}

function emptyContext(cwd: string, error: string): EnvironmentContext {
  return {
    cwd,
    uname: "",
    username: "",
    shell: "",
    directoryListing: "",
    gitBranch: "",
    gitStatus: "",
    projectFiles: [],
    projectTypeGuess: "unknown",
    collectedAt: now(),
    errors: [error]
  };
}

export class TaskEngine {
  private readonly sessions = new Map<string, TaskSession>();

  async start(request: TaskStartRequest): Promise<AiTask> {
    const timestamp = now();
    const task: AiTask = {
      id: createTaskId(),
      userGoal: request.userGoal,
      status: "idle",
      steps: [],
      currentCwd: request.serverConfig.defaultCwd,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const session: TaskSession = {
      task,
      modelConfig: request.modelConfig,
      serverConfig: request.serverConfig,
      currentCwd: request.serverConfig.defaultCwd ?? "",
      context: null
    };

    this.sessions.set(task.id, session);

    await this.refreshContext(session);
    await this.persistHistory(session);
    return this.planNextStep({ taskId: task.id });
  }

  async planNextStep(request: TaskPlanNextStepRequest): Promise<AiTask> {
    const session = this.requireSession(request.taskId);
    const { task } = session;

    if (task.status === "stopped" || task.status === "executing") {
      throw new Error(`Task ${task.id} cannot plan next step while status is ${task.status}.`);
    }

    task.status = "planning";
    task.updatedAt = now();

    try {
      const history = task.steps.map(toHistoryEntry).filter((entry): entry is LlmCommandHistoryEntry => Boolean(entry));
      const suggestion = await planNextCommand({
        modelConfig: session.modelConfig,
        taskGoal: task.userGoal,
        history,
        currentCwd: session.currentCwd,
        context: session.context ?? undefined
      });

      const step = this.createStep(task, suggestion);
      task.steps.push(step);
      task.currentStepId = step.stepId;

      if (suggestion.done) {
        step.status = "completed";
        task.status = "completed";
        task.summary = suggestion.reason || suggestion.expectedResult || "任务已完成。";
      } else if (step.riskAnalysis.level === "blocked") {
        step.status = "blocked";
        task.status = "failed";
        task.errorMessage = `命令已被安全策略拦截：${step.riskAnalysis.reasons.join(" ")}`;
      } else {
        step.status = "waiting_approval";
        task.status = "waiting_approval";
      }

      const timestamp = now();
      step.updatedAt = timestamp;
      task.updatedAt = timestamp;
      await this.persistHistory(session);
      return cloneTask(task);
    } catch (error) {
      task.status = "failed";
      task.errorMessage = error instanceof Error ? error.message : String(error);
      task.updatedAt = now();
      await this.persistHistory(session);
      return cloneTask(task);
    }
  }

  async approveAndExecuteStep(request: TaskApproveAndExecuteStepRequest): Promise<AiTask> {
    const session = this.requireSession(request.taskId);
    const { task } = session;
    const step = this.findStepForExecution(task, request.stepId);

    if (step.riskAnalysis.level === "blocked") {
      step.status = "blocked";
      task.status = "failed";
      task.errorMessage = `命令已被安全策略拦截：${step.riskAnalysis.reasons.join(" ")}`;
      task.updatedAt = now();
      return cloneTask(task);
    }

    if (step.riskAnalysis.requiresSecondConfirm && !request.confirmedHighRisk) {
      throw new Error(`High risk command requires second confirmation: ${step.riskAnalysis.reasons.join(" ")}`);
    }

    const timestamp = now();
    step.status = "executing";
    step.updatedAt = timestamp;
    task.status = "executing";
    task.updatedAt = timestamp;

    const result = await executeCommand({
      serverConfig: session.serverConfig,
      command: step.suggestion.command,
      cwd: session.currentCwd || session.serverConfig.defaultCwd,
      timeoutSeconds: request.timeoutSeconds ?? 30,
      confirmedHighRisk: request.confirmedHighRisk
    });

    const observedAt = now();
    step.executionResult = result;
    step.riskAnalysis = result.risk;
    step.status = result.blocked ? "blocked" : "executed";
    step.updatedAt = observedAt;
    task.status = result.blocked ? "failed" : "idle";
    task.errorMessage = result.blocked ? result.stderr : undefined;
    task.updatedAt = observedAt;
    session.currentCwd = result.cwd || session.currentCwd;
    await this.refreshContext(session);
    await this.persistHistory(session);

    return cloneTask(task);
  }

  async stop(request: TaskStopRequest): Promise<AiTask> {
    const session = this.requireSession(request.taskId);
    session.task.status = "stopped";
    session.task.updatedAt = now();
    await this.persistHistory(session);
    return cloneTask(session.task);
  }

  private requireSession(taskId: string): TaskSession {
    const session = this.sessions.get(taskId);

    if (!session) {
      throw new Error(`Task ${taskId} was not found.`);
    }

    return session;
  }

  private createStep(task: AiTask, suggestion: LlmPlanNextCommandResult): TaskStep {
    const riskAnalysis = suggestion.done
      ? { level: "low" as const, reasons: ["Task is marked done by the model."], requiresSecondConfirm: false }
      : analyzeCommandRisk(suggestion.command);
    const timestamp = now();

    return {
      stepId: task.steps.length + 1,
      suggestion: {
        ...suggestion,
        riskLevel: riskAnalysis.level,
        riskReasons: riskAnalysis.reasons,
        requiresSecondConfirm: riskAnalysis.requiresSecondConfirm
      },
      riskAnalysis,
      executionResult: null,
      status: "planned",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private async refreshContext(session: TaskSession): Promise<void> {
    try {
      const context = await collectEnvironmentContext(session.serverConfig, session.currentCwd || session.serverConfig.defaultCwd);
      session.context = context;
      session.currentCwd = context.cwd || session.currentCwd;
      session.task.context = context;
      session.task.currentCwd = session.currentCwd;
      session.task.updatedAt = now();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const context = emptyContext(session.currentCwd, message);
      session.context = context;
      session.task.context = context;
      session.task.currentCwd = session.currentCwd;
      session.task.updatedAt = now();
    }
  }

  private async persistHistory(session: TaskSession): Promise<void> {
    try {
      await saveTaskHistory(session.task, session.serverConfig);
    } catch {
      // History persistence must not interrupt command execution or planning.
    }
  }

  private findStepForExecution(task: AiTask, stepId?: number): TaskStep {
    const step = stepId
      ? task.steps.find((candidate) => candidate.stepId === stepId)
      : [...task.steps].reverse().find((candidate) => candidate.status === "waiting_approval");

    if (!step) {
      throw new Error("No waiting task step was found.");
    }

    if (step.status !== "waiting_approval") {
      throw new Error(`Step ${step.stepId} cannot be executed while status is ${step.status}.`);
    }

    return step;
  }
}

export const taskEngine = new TaskEngine();
