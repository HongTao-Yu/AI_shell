import { FormEvent, useMemo, useState } from "react";
import { aiShellApi } from "../api/aiShellApi";
import type { AiTask, ModelConfig, ServerConfig, TaskStep } from "../types";
import { CommandCard } from "./CommandCard";
import { ExecutionResult } from "./ExecutionResult";
import { HistoryPanel } from "./HistoryPanel";
import { ModelConfigForm } from "./ModelConfigForm";

interface AiPanelProps {
  server: ServerConfig | null;
  modelConfig: ModelConfig | null;
  onModelConfigSaved: (modelConfig: ModelConfig) => void;
  onSendCommandToTerminal: (command: string) => void;
  onTaskChanged: (task: AiTask | null) => void;
}

const quickTasks = [
  "帮我把当前项目跑起来",
  "帮我排查磁盘空间",
  "帮我查看端口占用",
  "帮我分析上一条报错",
  "帮我检查 Python 环境"
];

function getCurrentStep(task: AiTask | null): TaskStep | null {
  if (!task?.currentStepId) {
    return null;
  }

  return task.steps.find((step) => step.stepId === task.currentStepId) ?? null;
}

function statusText(status: AiTask["status"]): string {
  const labels: Record<AiTask["status"], string> = {
    idle: "等待下一步",
    planning: "AI 正在规划",
    waiting_approval: "等待你确认",
    executing: "正在执行",
    observing: "正在观察结果",
    completed: "任务完成",
    failed: "任务失败",
    stopped: "已停止"
  };
  return labels[status];
}

export function AiPanel({
  server,
  modelConfig,
  onModelConfigSaved,
  onSendCommandToTerminal,
  onTaskChanged
}: AiPanelProps): JSX.Element {
  const [taskGoal, setTaskGoal] = useState("");
  const [task, setTask] = useState<AiTask | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecutingStep, setIsExecutingStep] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const currentStep = useMemo(() => getCurrentStep(task), [task]);
  const latestExecutionResult = currentStep?.executionResult ?? task?.steps.at(-1)?.executionResult ?? null;
  const canPlanNext = Boolean(task && ["idle", "failed"].includes(task.status));
  const canStopTask = Boolean(task && !["completed", "failed", "stopped"].includes(task.status));
  const isReady = Boolean(server && modelConfig);

  function setTaskAndNotify(nextTask: AiTask | null): void {
    setTask(nextTask);
    onTaskChanged(nextTask);
  }

  function showError(message: string): void {
    setToastMessage(message);
  }

  async function handleStartTask(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();

    if (!modelConfig) {
      showError("请先保存模型配置。");
      return;
    }

    if (!server) {
      showError("请先保存服务器配置。");
      return;
    }

    const goal = taskGoal.trim();
    if (!goal) {
      showError("请输入你想完成的 Linux 任务。");
      return;
    }

    setIsPlanning(true);
    setToastMessage("");
    setTaskAndNotify(null);

    try {
      const result = await aiShellApi.startTask({
        modelConfig,
        serverConfig: server,
        userGoal: goal
      });
      setTaskAndNotify(result);
      if (result.errorMessage) {
        showError(result.errorMessage);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPlanning(false);
    }
  }

  async function handlePlanNextStep(): Promise<void> {
    if (!task) {
      return;
    }

    setIsPlanning(true);
    setToastMessage("");

    try {
      const result = await aiShellApi.planNextStep({ taskId: task.id });
      setTaskAndNotify(result);
      if (result.errorMessage) {
        showError(result.errorMessage);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleAcceptExecute(): Promise<void> {
    if (!task || !currentStep || currentStep.suggestion.done) {
      return;
    }

    if (currentStep.riskAnalysis.level === "blocked") {
      showError(`命令已被拦截：${currentStep.riskAnalysis.reasons.join(" ")}`);
      return;
    }

    let confirmedHighRisk = false;
    if (currentStep.riskAnalysis.requiresSecondConfirm) {
      confirmedHighRisk = window.confirm(
        `这是一条高风险命令：\n${currentStep.riskAnalysis.reasons.join("\n")}\n\n确认继续执行吗？`
      );
      if (!confirmedHighRisk) {
        return;
      }
    }

    setIsExecutingStep(true);
    setToastMessage("");

    try {
      const result = await aiShellApi.approveAndExecuteStep({
        taskId: task.id,
        stepId: currentStep.stepId,
        confirmedHighRisk,
        timeoutSeconds: 30
      });
      setTaskAndNotify(result);
      if (result.errorMessage) {
        showError(result.errorMessage);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecutingStep(false);
    }
  }

  async function handleStopTask(): Promise<void> {
    if (!task) {
      return;
    }

    try {
      const result = await aiShellApi.stopTask({ taskId: task.id });
      setTaskAndNotify(result);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <aside className="panel ai-panel" aria-label="AI 任务面板">
      <div className="ai-header">
        <div>
          <h2 className="ai-title">AI 任务面板</h2>
          <p className="panel-subtitle">描述目标，AI 每次只给一条可确认的 Linux 命令。</p>
        </div>
        <span className={`connection-badge ${isReady ? "connection-badge-ready" : "connection-badge-missing"}`}>
          {isReady ? "可以开始" : "需要配置"}
        </span>
      </div>

      <HistoryPanel />

      {toastMessage && (
        <div className="toast-alert" role="alert">
          <span>{toastMessage}</span>
          <button type="button" onClick={() => setToastMessage("")}>
            关闭
          </button>
        </div>
      )}

      {!server && (
        <div className="empty-state">
          <strong>未配置服务器</strong>
          <span>先在顶部填写 Linux 服务器信息。没有服务器时，AI 建议无法真正执行。</span>
        </div>
      )}

      {!modelConfig && (
        <section className="ai-section">
          <h3>模型配置</h3>
          <p className="section-hint">填写 OpenAI Compatible API 的 Base URL、API Key 和模型名。API Key 不会显示在日志中。</p>
          <ModelConfigForm modelConfig={modelConfig} onModelConfigSaved={onModelConfigSaved} />
        </section>
      )}

      {modelConfig && (
        <section className="ai-section compact-section">
          <h3>模型已配置</h3>
          <p className="section-hint">当前模型：{modelConfig.modelName}</p>
          <ModelConfigForm modelConfig={modelConfig} onModelConfigSaved={onModelConfigSaved} />
        </section>
      )}

      <section className="quick-tasks" aria-label="常用任务">
        <h3>常用任务</h3>
        <div className="quick-task-grid">
          {quickTasks.map((item) => (
            <button key={item} className="quick-task-button" type="button" onClick={() => setTaskGoal(item)}>
              {item}
            </button>
          ))}
        </div>
      </section>

      <form className="task-form" onSubmit={handleStartTask}>
        <label className="field">
          <span>你想让 AI 帮你做什么？</span>
          <textarea
            required
            rows={4}
            value={taskGoal}
            placeholder="例如：帮我把当前项目跑起来"
            onChange={(event) => setTaskGoal(event.target.value)}
          />
        </label>
        <button className="primary-button" disabled={isPlanning || !isReady} type="submit">
          {isPlanning ? "AI 正在规划..." : "开始任务"}
        </button>
        {!isReady && <p className="hint-text">请先完成服务器和模型配置。</p>}
      </form>

      {!task && (
        <div className="empty-state">
          <strong>未开始任务</strong>
          <span>选择一个常用任务，或直接输入自然语言目标。AI 会先生成低风险探测命令。</span>
        </div>
      )}

      {task && (
        <section className="task-state-card">
          <div className="task-state-header">
            <div>
              <h3>当前任务</h3>
              <p>{task.userGoal}</p>
            </div>
            <span className={`task-status task-status-${task.status}`}>{statusText(task.status)}</span>
          </div>
          <dl className="context-summary">
            <div>
              <dt>当前 cwd</dt>
              <dd>{task.currentCwd || task.context?.cwd || "采集中或不可用"}</dd>
            </div>
            <div>
              <dt>项目类型</dt>
              <dd>{task.context?.projectTypeGuess ?? "unknown"}</dd>
            </div>
            <div>
              <dt>特征文件</dt>
              <dd>
                {task.context?.projectFiles && task.context.projectFiles.length > 0
                  ? task.context.projectFiles.join(", ")
                  : "未检测到"}
              </dd>
            </div>
          </dl>
          {task.summary && <p className="task-summary">{task.summary}</p>}
          <div className="task-action-row">
            <button className="secondary-button" disabled={!canPlanNext || isPlanning} type="button" onClick={handlePlanNextStep}>
              {isPlanning ? "生成中..." : "生成下一步"}
            </button>
            <button className="secondary-button danger-button" disabled={!canStopTask} type="button" onClick={handleStopTask}>
              停止任务
            </button>
          </div>
        </section>
      )}

      <div className="stack">
        <CommandCard
          suggestion={currentStep?.suggestion ?? null}
          isExecuting={isExecutingStep}
          canExecute={isReady}
          onAcceptExecute={handleAcceptExecute}
          onUseEditedCommand={onSendCommandToTerminal}
          onPlanAlternative={task ? handlePlanNextStep : undefined}
          onStopTask={task ? handleStopTask : undefined}
        />
        <ExecutionResult result={latestExecutionResult} />
        {task && task.steps.length > 0 && (
          <section className="task-history" aria-label="历史步骤">
            <h3>历史步骤</h3>
            <ol>
              {task.steps.map((step) => (
                <li key={step.stepId}>
                  <span className="history-title">
                    #{step.stepId} {step.suggestion.stepTitle}
                  </span>
                  <code>{step.suggestion.done ? "done" : step.suggestion.command}</code>
                  <span className={`task-status task-status-${step.status}`}>{step.status}</span>
                  {step.executionResult && (
                    <span>
                      exit_code: {step.executionResult.exitCode}
                      {step.executionResult.cwd ? `, cwd: ${step.executionResult.cwd}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </aside>
  );
}
