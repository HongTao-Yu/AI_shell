import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiTask, ServerConfig, TaskHistoryEntry, TaskHistoryStep } from "../../shared/types";

const MAX_HISTORY_ITEMS = 50;
const OUTPUT_TAIL_LENGTH = 4000;
const TEXT_FIELD_LIMIT = 2000;
const MASK = "[REDACTED]";

interface HistoryFile {
  version: 1;
  tasks: TaskHistoryEntry[];
}

function getHistoryPath(): string {
  return path.join(app.getPath("userData"), "task-history.json");
}

function tail(value: string, maxLength = OUTPUT_TAIL_LENGTH): string {
  const text = redactSensitiveText(value);
  return text.length <= maxLength ? text : text.slice(-maxLength);
}

function limitText(value: string | undefined, maxLength = TEXT_FIELD_LIMIT): string | undefined {
  if (!value) {
    return value;
  }

  const redacted = redactSensitiveText(value);
  return redacted.length <= maxLength ? redacted : redacted.slice(0, maxLength);
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, MASK)
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{12,})\b/g, MASK)
    .replace(/\b(api[_-]?key|token|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?[^"'\s]+["']?/gi, `$1=${MASK}`)
    .replace(/\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${MASK}`)
    .replace(/(AKIA|ASIA)[A-Z0-9]{16}/g, MASK);
}

function sanitizeTask(task: AiTask, serverConfig: ServerConfig): TaskHistoryEntry {
  return {
    id: task.id,
    userGoal: limitText(task.userGoal) ?? "",
    server: {
      name: limitText(serverConfig.name, 200) ?? "",
      host: limitText(serverConfig.host, 200) ?? ""
    },
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    currentCwd: limitText(task.currentCwd, 500),
    summary: limitText(task.summary),
    errorMessage: limitText(task.errorMessage),
    steps: task.steps.map((step): TaskHistoryStep => {
      const executionResult = step.executionResult;

      return {
        stepId: step.stepId,
        stepTitle: limitText(step.suggestion.stepTitle, 500) ?? "",
        command: limitText(step.suggestion.command, 1000) ?? "",
        reason: limitText(step.suggestion.reason) ?? "",
        riskLevel: step.riskAnalysis.level,
        expectedResult: limitText(step.suggestion.expectedResult) ?? "",
        status: step.status,
        exitCode: executionResult ? executionResult.exitCode : null,
        stdoutTail: executionResult ? tail(executionResult.stdout) : "",
        stderrTail: executionResult ? tail(executionResult.stderr) : "",
        cwd: executionResult ? limitText(executionResult.cwd, 500) ?? "" : "",
        durationMs: executionResult ? executionResult.durationMs : null,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt
      };
    })
  };
}

async function loadHistoryFile(): Promise<HistoryFile> {
  try {
    const raw = await readFile(getHistoryPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<HistoryFile>;
    return {
      version: 1,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    };
  } catch {
    return {
      version: 1,
      tasks: []
    };
  }
}

async function saveHistoryFile(history: HistoryFile): Promise<void> {
  const historyPath = getHistoryPath();
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

export async function saveTaskHistory(task: AiTask, serverConfig: ServerConfig): Promise<TaskHistoryEntry> {
  const history = await loadHistoryFile();
  const entry = sanitizeTask(task, serverConfig);
  const withoutCurrent = history.tasks.filter((item) => item.id !== entry.id);

  await saveHistoryFile({
    version: 1,
    tasks: [entry, ...withoutCurrent].slice(0, MAX_HISTORY_ITEMS)
  });

  return entry;
}

export async function listTaskHistory(): Promise<TaskHistoryEntry[]> {
  const history = await loadHistoryFile();
  return history.tasks;
}

export async function getTaskHistoryPath(): Promise<string> {
  return getHistoryPath();
}
