import type { AiShellApi } from "../../../main/preload";
import type {
  AiTask,
  CommandRiskAnalysis,
  SshCommandExecutionResult,
  SshExecuteCommandRequest,
  TaskStartRequest
} from "../types";

function browserRisk(command: string): CommandRiskAnalysis {
  if (!command.trim()) {
    return { level: "blocked", reasons: ["Empty commands cannot be executed."], requiresSecondConfirm: false };
  }
  return { level: "medium", reasons: ["Risk analysis is available in the Electron desktop app."], requiresSecondConfirm: false };
}

function failedExecutionResult(request: SshExecuteCommandRequest, message: string): SshCommandExecutionResult {
  const now = new Date().toISOString();
  const risk = browserRisk(request.command);

  return {
    command: request.command,
    stdout: "",
    stderr: message,
    exitCode: -1,
    durationMs: 0,
    cwd: "",
    startedAt: now,
    finishedAt: now,
    risk,
    blocked: risk.level === "blocked",
    requiresSecondConfirm: risk.requiresSecondConfirm
  };
}

function failedTask(request: TaskStartRequest, message: string): AiTask {
  const now = new Date().toISOString();

  return {
    id: `browser_task_${Date.now()}`,
    userGoal: request.userGoal,
    status: "failed",
    steps: [],
    errorMessage: message,
    createdAt: now,
    updatedAt: now
  };
}

const browserFallbackApi: AiShellApi = {
  getAppVersion: () => Promise.resolve("browser-preview"),
  getServerConfig: () => Promise.resolve(null),
  saveServerConfig: (server) => Promise.resolve(server),
  getModelConfig: () => Promise.resolve(null),
  saveModelConfig: (modelConfig) => Promise.resolve(modelConfig),
  analyzeCommandRisk: (command) => Promise.resolve(browserRisk(command)),
  testConnection: () =>
    Promise.resolve({
      ok: false,
      message: "SSH is only available in the Electron desktop app.",
      durationMs: 0
    }),
  executeCommand: (request) =>
    Promise.resolve(failedExecutionResult(request, "SSH command execution is only available in the Electron desktop app.")),
  installRemoteAgent: () =>
    Promise.resolve({
      ok: false,
      message: "Remote agent installation is only available in the Electron desktop app.",
      steps: []
    }),
  uninstallRemoteAgent: () =>
    Promise.resolve({
      ok: false,
      message: "Remote agent uninstall is only available in the Electron desktop app.",
      steps: []
    }),
  planNextCommand: () => Promise.reject(new Error("LLM calls are only available in the Electron desktop app.")),
  startTask: (request) =>
    Promise.resolve(failedTask(request, "Task engine is only available in the Electron desktop app.")),
  approveAndExecuteStep: () => Promise.reject(new Error("Task execution is only available in the Electron desktop app.")),
  planNextStep: () => Promise.reject(new Error("Task planning is only available in the Electron desktop app.")),
  stopTask: (request) =>
    Promise.resolve({
      id: request.taskId,
      userGoal: "",
      status: "stopped",
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
  listTaskHistory: () => Promise.resolve([]),
  getTaskHistoryPath: () => Promise.resolve("Electron app userData/task-history.json")
};

export const aiShellApi: AiShellApi = window.aiShell ?? browserFallbackApi;
