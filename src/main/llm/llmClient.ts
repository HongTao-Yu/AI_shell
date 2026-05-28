import type {
  EnvironmentContext,
  LlmCommandHistoryEntry,
  LlmPlanNextCommandRequest,
  LlmPlanNextCommandResult,
  ModelConfig
} from "../../shared/types";
import { analyzeCommandRisk } from "../safety/commandRisk";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface RawCommandSuggestion {
  step_title?: unknown;
  command?: unknown;
  reason?: unknown;
  risk_level?: unknown;
  expected_result?: unknown;
  done?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function extractJsonObject(rawContent: string): RawCommandSuggestion {
  const trimmed = rawContent.trim();

  try {
    return JSON.parse(trimmed) as RawCommandSuggestion;
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1].trim()) as RawCommandSuggestion;
      } catch {
        // Fall through to balanced object extraction.
      }
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as RawCommandSuggestion;
    }

    throw new Error("Model response was not valid JSON and no JSON object could be extracted.");
  }
}

function toStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Model JSON field "${fieldName}" must be a string.`);
  }
  return value;
}

function normalizeSuggestion(raw: RawCommandSuggestion): LlmPlanNextCommandResult {
  const done = raw.done === true;
  const command = toStringField(raw.command ?? "", "command");

  if (!done && !command.trim()) {
    throw new Error('Model JSON field "command" cannot be empty unless done is true.');
  }

  const riskAnalysis = done ? { level: "low" as const, reasons: ["Task is marked done by the model."], requiresSecondConfirm: false } : analyzeCommandRisk(command);

  return {
    stepTitle: toStringField(raw.step_title ?? "", "step_title") || (done ? "任务已完成" : "下一步命令"),
    command,
    reason: toStringField(raw.reason ?? "", "reason"),
    riskLevel: riskAnalysis.level,
    riskReasons: riskAnalysis.reasons,
    requiresSecondConfirm: riskAnalysis.requiresSecondConfirm,
    expectedResult: toStringField(raw.expected_result ?? "", "expected_result"),
    done
  };
}

function buildSystemPrompt(): string {
  return [
    "你是 Linux 命令行专家。",
    "你每次只能生成一条命令。",
    "命令必须是 Linux shell 命令。",
    "不要生成解释性 Markdown。",
    "不要生成多条命令用 && 连接。",
    "如果需要先了解环境，优先生成低风险查询命令，比如 pwd、ls、cat README.md、which python。",
    "如果任务已经完成，返回 done=true，command 为空字符串。",
    "你只能返回 JSON 对象，不能返回 Markdown、代码块或额外文字。",
    'JSON 结构必须是 {"step_title":"检查当前目录","command":"pwd","reason":"确认当前所在目录，后续命令需要基于该目录执行。","risk_level":"low","expected_result":"输出当前工作目录。","done":false}。'
  ].join("\n");
}

function tail(value: string, maxLength = 2000): string {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

function formatHistoryEntry(entry: LlmCommandHistoryEntry): string {
  return [
    `步骤 ${entry.stepId}`,
    `command: ${entry.command}`,
    `exit_code: ${entry.exitCode}`,
    `cwd: ${entry.cwd || "(unknown)"}`,
    `duration_ms: ${entry.durationMs}`,
    `stdout_tail:\n${tail(entry.stdoutTail) || "(empty)"}`,
    `stderr_tail:\n${tail(entry.stderrTail) || "(empty)"}`
  ].join("\n");
}

function formatEnvironmentContext(context?: EnvironmentContext): string {
  if (!context) {
    return "(no environment context collected)";
  }

  return [
    `cwd: ${context.cwd || "(unknown)"}`,
    `uname: ${context.uname || "(unknown)"}`,
    `user: ${context.username || "(unknown)"}`,
    `shell: ${context.shell || "(unknown)"}`,
    `project_type_guess: ${context.projectTypeGuess}`,
    `project_feature_files: ${context.projectFiles.length > 0 ? context.projectFiles.join(", ") : "(none detected)"}`,
    `git_branch: ${context.gitBranch || "(unknown or not a git repo)"}`,
    `git_status_short:\n${tail(context.gitStatus, 2000) || "(clean, unknown, or not a git repo)"}`,
    `directory_listing:\n${tail(context.directoryListing, 4000) || "(empty or unavailable)"}`,
    `context_collection_errors:\n${context.errors.length > 0 ? context.errors.join("\n") : "(none)"}`
  ].join("\n");
}

function buildUserPrompt(request: LlmPlanNextCommandRequest): string {
  const history = request.history ?? [];
  const lines = [
    `用户自然语言任务：${request.taskGoal}`,
    `当前 cwd：${request.currentCwd || "(unknown)"}`,
    "",
    "当前服务器和目录上下文：",
    formatEnvironmentContext(request.context),
    "",
    "已执行历史：",
    history.length > 0 ? history.map(formatHistoryEntry).join("\n\n---\n\n") : "(no commands executed yet)",
    "",
    "请基于用户目标和历史执行结果，生成下一条 Linux 命令。每次只能生成一条命令。",
    "如果检测到 README.md、requirements.txt、package.json 等项目特征文件，优先用低风险命令读取说明或检查依赖文件名。",
    "如果上一步失败，请优先基于 stderr/stdout 给出低风险排查命令。",
    "如果任务已经完成，请返回 done=true，command 为空字符串，并在 reason 中总结完成情况。"
  ];

  return lines.join("\n");
}

export class LlmClient {
  constructor(private readonly modelConfig: ModelConfig) {}

  get configured(): boolean {
    return Boolean(this.modelConfig.baseUrl && this.modelConfig.apiKey && this.modelConfig.modelName);
  }

  async planNextCommand(request: LlmPlanNextCommandRequest): Promise<LlmPlanNextCommandResult> {
    if (!this.configured) {
      throw new Error("Model configuration is incomplete. Please set baseUrl, apiKey, and modelName.");
    }

    const response = await fetch(`${normalizeBaseUrl(this.modelConfig.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.modelConfig.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.modelConfig.modelName,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt()
          },
          {
            role: "user",
            content: buildUserPrompt(request)
          }
        ]
      })
    });

    const responseText = await response.text();
    let responseBody: ChatCompletionResponse;

    try {
      responseBody = JSON.parse(responseText) as ChatCompletionResponse;
    } catch {
      throw new Error(`Model API returned non-JSON HTTP response with status ${response.status}.`);
    }

    if (!response.ok) {
      throw new Error(responseBody.error?.message ?? `Model API request failed with status ${response.status}.`);
    }

    const content = responseBody.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Model API response did not include choices[0].message.content.");
    }

    return normalizeSuggestion(extractJsonObject(content));
  }
}

export function planNextCommand(request: LlmPlanNextCommandRequest): Promise<LlmPlanNextCommandResult> {
  return new LlmClient(request.modelConfig).planNextCommand(request);
}
