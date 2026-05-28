import { app, ipcMain } from "electron";
import type {
  LlmPlanNextCommandRequest,
  ModelConfig,
  RemoteAgentInstallRequest,
  ServerConfig,
  SshExecuteCommandRequest,
  TaskApproveAndExecuteStepRequest,
  TaskPlanNextStepRequest,
  TaskStartRequest,
  TaskStopRequest
} from "../shared/types";
import { getModelConfig, getServerConfig, saveModelConfig, saveServerConfig } from "./config/configStore";
import { installRemoteAgent, uninstallRemoteAgent } from "./agent/remoteAgent";
import { getTaskHistoryPath, listTaskHistory } from "./history/historyStore";
import { planNextCommand } from "./llm/llmClient";
import { analyzeCommandRisk } from "./safety/commandRisk";
import { executeCommand, testConnection } from "./ssh/sshClient";
import { taskEngine } from "./task/taskEngine";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("config:getServerConfig", () => getServerConfig());
  ipcMain.handle("config:saveServerConfig", (_event, server: ServerConfig) => saveServerConfig(server));
  ipcMain.handle("config:getModelConfig", () => getModelConfig());
  ipcMain.handle("config:saveModelConfig", (_event, modelConfig: ModelConfig) => saveModelConfig(modelConfig));
  ipcMain.handle("safety:analyzeCommandRisk", (_event, command: string) => analyzeCommandRisk(command));
  ipcMain.handle("ssh:testConnection", (_event, server: ServerConfig) => testConnection(server));
  ipcMain.handle("ssh:executeCommand", (_event, request: SshExecuteCommandRequest) => executeCommand(request));
  ipcMain.handle("agent:install", (_event, request: RemoteAgentInstallRequest) => installRemoteAgent(request));
  ipcMain.handle("agent:uninstall", (_event, server: ServerConfig) => uninstallRemoteAgent(server));
  ipcMain.handle("llm:planNextCommand", (_event, request: LlmPlanNextCommandRequest) => planNextCommand(request));
  ipcMain.handle("task:start", (_event, request: TaskStartRequest) => taskEngine.start(request));
  ipcMain.handle("task:approveAndExecuteStep", (_event, request: TaskApproveAndExecuteStepRequest) =>
    taskEngine.approveAndExecuteStep(request)
  );
  ipcMain.handle("task:planNextStep", (_event, request: TaskPlanNextStepRequest) => taskEngine.planNextStep(request));
  ipcMain.handle("task:stop", (_event, request: TaskStopRequest) => taskEngine.stop(request));
  ipcMain.handle("history:listTasks", () => listTaskHistory());
  ipcMain.handle("history:getPath", () => getTaskHistoryPath());
}
