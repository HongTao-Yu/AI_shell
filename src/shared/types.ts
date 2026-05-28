export type CommandRiskLevel = "low" | "medium" | "high" | "blocked";

export interface CommandRiskAnalysis {
  level: CommandRiskLevel;
  reasons: string[];
  requiresSecondConfirm: boolean;
}

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  password?: string;
  privateKeyPath?: string;
  defaultCwd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  updatedAt: string;
}

export type TaskStatus =
  | "idle"
  | "planning"
  | "waiting_approval"
  | "executing"
  | "observing"
  | "completed"
  | "failed"
  | "stopped";

export type TaskStepStatus =
  | "planned"
  | "waiting_approval"
  | "executing"
  | "executed"
  | "blocked"
  | "completed"
  | "failed";

export interface AiTask {
  id: string;
  userGoal: string;
  status: TaskStatus;
  steps: TaskStep[];
  currentStepId?: number;
  currentCwd?: string;
  context?: EnvironmentContext;
  summary?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStep {
  stepId: number;
  suggestion: LlmPlanNextCommandResult;
  riskAnalysis: CommandRiskAnalysis;
  executionResult: SshCommandExecutionResult | null;
  status: TaskStepStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CommandSuggestion {
  taskId: string;
  stepId: number;
  stepTitle: string;
  command: string;
  reason: string;
  riskLevel: CommandRiskLevel;
  expectedResult: string;
  approvalRequired: boolean;
  requiresSudo: boolean;
  blocked: boolean;
  blockReason?: string;
}

export interface CommandExecutionRequest {
  taskId: string;
  stepId: number;
  serverId: string;
  command: string;
  cwd?: string;
  timeoutSeconds: number;
  riskLevel: CommandRiskLevel;
  approvalRequired: boolean;
  requiresSudo: boolean;
}

export interface CommandExecutionResult {
  taskId: string;
  stepId: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  cwd: string;
  startedAt: string;
  finishedAt: string;
}

export interface SshTestConnectionResult {
  ok: boolean;
  message: string;
  durationMs: number;
}

export interface SshExecuteCommandRequest {
  serverConfig: ServerConfig;
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
  confirmedHighRisk?: boolean;
}

export interface SshCommandExecutionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  risk: CommandRiskAnalysis;
  blocked: boolean;
  requiresSecondConfirm: boolean;
}

export interface LlmCommandHistoryEntry {
  stepId: number;
  command: string;
  stdoutTail: string;
  stderrTail: string;
  exitCode: number;
  cwd: string;
  durationMs: number;
}

export interface LlmPlanNextCommandRequest {
  modelConfig: ModelConfig;
  taskGoal: string;
  history?: LlmCommandHistoryEntry[];
  currentCwd?: string;
  context?: EnvironmentContext;
}

export interface LlmPlanNextCommandResult {
  stepTitle: string;
  command: string;
  reason: string;
  riskLevel: CommandRiskLevel;
  riskReasons: string[];
  requiresSecondConfirm: boolean;
  expectedResult: string;
  done: boolean;
}

export interface EnvironmentContext {
  cwd: string;
  uname: string;
  username: string;
  shell: string;
  directoryListing: string;
  gitBranch: string;
  gitStatus: string;
  projectFiles: string[];
  projectTypeGuess: string;
  collectedAt: string;
  errors: string[];
}

export interface LocalAppConfig {
  serverConfig: ServerConfig | null;
  modelConfig: ModelConfig | null;
  servers?: ServerConfig[];
  activeServerId?: string;
}

export interface TaskStartRequest {
  modelConfig: ModelConfig;
  serverConfig: ServerConfig;
  userGoal: string;
}

export interface TaskApproveAndExecuteStepRequest {
  taskId: string;
  stepId?: number;
  confirmedHighRisk?: boolean;
  timeoutSeconds?: number;
}

export interface TaskPlanNextStepRequest {
  taskId: string;
}

export interface TaskStopRequest {
  taskId: string;
}

export interface TaskHistoryServerSnapshot {
  name: string;
  host: string;
}

export interface TaskHistoryStep {
  stepId: number;
  stepTitle: string;
  command: string;
  reason: string;
  riskLevel: CommandRiskLevel;
  expectedResult: string;
  status: TaskStepStatus;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
  cwd: string;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskHistoryEntry {
  id: string;
  userGoal: string;
  server: TaskHistoryServerSnapshot;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  currentCwd?: string;
  summary?: string;
  errorMessage?: string;
  steps: TaskHistoryStep[];
}

export interface RemoteAgentInstallRequest {
  serverConfig: ServerConfig;
  updateShellRc: boolean;
}

export interface RemoteAgentOperationResult {
  ok: boolean;
  message: string;
  installPath?: string;
  aiPath?: string;
  doctorOutput?: string;
  steps: string[];
}
