export type {
  AiTask,
  CommandRiskAnalysis,
  CommandExecutionRequest,
  CommandExecutionResult,
  CommandRiskLevel,
  CommandSuggestion,
  EnvironmentContext,
  LlmPlanNextCommandRequest,
  LlmPlanNextCommandResult,
  LlmCommandHistoryEntry,
  LocalAppConfig,
  ModelConfig,
  RemoteAgentInstallRequest,
  RemoteAgentOperationResult,
  ServerConfig,
  SshCommandExecutionResult,
  SshExecuteCommandRequest,
  SshTestConnectionResult,
  TaskApproveAndExecuteStepRequest,
  TaskHistoryEntry,
  TaskHistoryServerSnapshot,
  TaskHistoryStep,
  TaskPlanNextStepRequest,
  TaskStartRequest,
  TaskStatus,
  TaskStep,
  TaskStepStatus,
  TaskStopRequest
} from "../../../shared/types";

import type { AiShellApi } from "../../../main/preload";

declare global {
  interface Window {
    aiShell: AiShellApi;
  }
}
