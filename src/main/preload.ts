import { contextBridge, ipcRenderer } from "electron";
import type {
  AiTask,
  CommandRiskAnalysis,
  LlmPlanNextCommandRequest,
  LlmPlanNextCommandResult,
  ModelConfig,
  RemoteAgentInstallRequest,
  RemoteAgentOperationResult,
  ServerConfig,
  SshCommandExecutionResult,
  SshExecuteCommandRequest,
  SshTestConnectionResult,
  TaskApproveAndExecuteStepRequest,
  TaskHistoryEntry,
  TaskPlanNextStepRequest,
  TaskStartRequest,
  TaskStopRequest
} from "../shared/types";

const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),
  getServerConfig: (): Promise<ServerConfig | null> => ipcRenderer.invoke("config:getServerConfig"),
  saveServerConfig: (server: ServerConfig): Promise<ServerConfig> =>
    ipcRenderer.invoke("config:saveServerConfig", server),
  getModelConfig: (): Promise<ModelConfig | null> => ipcRenderer.invoke("config:getModelConfig"),
  saveModelConfig: (modelConfig: ModelConfig): Promise<ModelConfig> =>
    ipcRenderer.invoke("config:saveModelConfig", modelConfig),
  analyzeCommandRisk: (command: string): Promise<CommandRiskAnalysis> =>
    ipcRenderer.invoke("safety:analyzeCommandRisk", command),
  testConnection: (server: ServerConfig): Promise<SshTestConnectionResult> =>
    ipcRenderer.invoke("ssh:testConnection", server),
  executeCommand: (request: SshExecuteCommandRequest): Promise<SshCommandExecutionResult> =>
    ipcRenderer.invoke("ssh:executeCommand", request),
  installRemoteAgent: (request: RemoteAgentInstallRequest): Promise<RemoteAgentOperationResult> =>
    ipcRenderer.invoke("agent:install", request),
  uninstallRemoteAgent: (server: ServerConfig): Promise<RemoteAgentOperationResult> =>
    ipcRenderer.invoke("agent:uninstall", server),
  planNextCommand: (request: LlmPlanNextCommandRequest): Promise<LlmPlanNextCommandResult> =>
    ipcRenderer.invoke("llm:planNextCommand", request),
  startTask: (request: TaskStartRequest): Promise<AiTask> => ipcRenderer.invoke("task:start", request),
  approveAndExecuteStep: (request: TaskApproveAndExecuteStepRequest): Promise<AiTask> =>
    ipcRenderer.invoke("task:approveAndExecuteStep", request),
  planNextStep: (request: TaskPlanNextStepRequest): Promise<AiTask> =>
    ipcRenderer.invoke("task:planNextStep", request),
  stopTask: (request: TaskStopRequest): Promise<AiTask> => ipcRenderer.invoke("task:stop", request),
  listTaskHistory: (): Promise<TaskHistoryEntry[]> => ipcRenderer.invoke("history:listTasks"),
  getTaskHistoryPath: (): Promise<string> => ipcRenderer.invoke("history:getPath")
};

contextBridge.exposeInMainWorld("aiShell", api);

export type AiShellApi = typeof api;
