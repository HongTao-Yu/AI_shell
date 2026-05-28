import { readFile } from "node:fs/promises";
import { Client, type ConnectConfig } from "ssh2";
import type {
  CommandRiskAnalysis,
  ServerConfig,
  SshCommandExecutionResult,
  SshExecuteCommandRequest,
  SshTestConnectionResult
} from "../../shared/types";
import { analyzeCommandRisk } from "../safety/commandRisk";

const DEFAULT_TIMEOUT_SECONDS = 30;
const CWD_MARKER_PREFIX = "__AI_SHELL_ASSISTANT_CWD__=";
const EXIT_CODE_MARKER_PREFIX = "__AI_SHELL_ASSISTANT_EXIT_CODE__=";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function createConnectConfig(server: ServerConfig, timeoutSeconds: number): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: timeoutSeconds * 1000,
    keepaliveInterval: 10_000
  };

  if (server.privateKeyPath) {
    config.privateKey = await readFile(server.privateKeyPath, "utf8");
    if (server.password) {
      config.passphrase = server.password;
    }
    return config;
  }

  config.password = server.password;
  return config;
}

function connect(server: ServerConfig, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      client.end();
      reject(new Error(`SSH connection timed out after ${timeoutSeconds} seconds.`));
    }, timeoutSeconds * 1000);

    function finishWithError(error: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      client.end();
      reject(error);
    }

    createConnectConfig(server, timeoutSeconds)
      .then((config) => {
        client
          .once("ready", () => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(client);
          })
          .once("error", finishWithError)
          .connect(config);
      })
      .catch(finishWithError);
  });
}

function defaultRisk(): CommandRiskAnalysis {
  return {
    level: "medium",
    reasons: ["Command was not analyzed before failure."],
    requiresSecondConfirm: false
  };
}

function toFailedResult(command: string, startedAt: string, error: unknown, risk = defaultRisk()): SshCommandExecutionResult {
  const finishedAt = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);

  return {
    command,
    stdout: "",
    stderr: message,
    exitCode: -1,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    cwd: "",
    startedAt,
    finishedAt,
    risk,
    blocked: risk.level === "blocked",
    requiresSecondConfirm: risk.requiresSecondConfirm
  };
}

function buildWrappedCommand(command: string, cwd?: string): string {
  const cwdLines = cwd
    ? [
        `cd ${shellQuote(cwd)}`,
        "__ai_shell_cd_code=$?",
        "if [ \"$__ai_shell_cd_code\" -ne 0 ]; then",
        `  printf '\\n${EXIT_CODE_MARKER_PREFIX}%s\\n' "$__ai_shell_cd_code"`,
        `  printf '${CWD_MARKER_PREFIX}%s\\n' "$PWD"`,
        "  exit $__ai_shell_cd_code",
        "fi"
      ]
    : [];
  const body = [
    ...cwdLines,
    command,
    "__ai_shell_exit_code=$?",
    `printf '\\n${EXIT_CODE_MARKER_PREFIX}%s\\n' "$__ai_shell_exit_code"`,
    `printf '${CWD_MARKER_PREFIX}%s\\n' "$PWD"`,
    "exit $__ai_shell_exit_code"
  ]
    .filter(Boolean)
    .join("\n");

  return `bash -lc ${shellQuote(body)}`;
}

function splitStdoutMarkers(stdout: string): { stdout: string; cwd: string; markerExitCode: number | null } {
  const markerIndex = stdout.lastIndexOf(CWD_MARKER_PREFIX);
  const exitMarkerIndex = stdout.lastIndexOf(EXIT_CODE_MARKER_PREFIX);
  let markerExitCode: number | null = null;

  if (exitMarkerIndex >= 0) {
    const afterExitMarker = stdout.slice(exitMarkerIndex + EXIT_CODE_MARKER_PREFIX.length);
    const rawCode = afterExitMarker.split(/\r?\n/, 1)[0]?.trim() ?? "";
    const parsedCode = Number(rawCode);
    markerExitCode = Number.isFinite(parsedCode) ? parsedCode : null;
  }

  if (markerIndex < 0) {
    return { stdout, cwd: "", markerExitCode };
  }

  const contentEnd = exitMarkerIndex >= 0 ? Math.min(exitMarkerIndex, markerIndex) : markerIndex;
  const beforeMarker = stdout.slice(0, contentEnd).replace(/\r?\n$/, "");
  const afterMarker = stdout.slice(markerIndex + CWD_MARKER_PREFIX.length);
  const cwd = afterMarker.split(/\r?\n/, 1)[0]?.trim() ?? "";

  return {
    stdout: beforeMarker,
    cwd,
    markerExitCode
  };
}

export async function testConnection(server: ServerConfig, timeoutSeconds = 10): Promise<SshTestConnectionResult> {
  const started = Date.now();

  try {
    const client = await connect(server, timeoutSeconds);
    client.end();

    return {
      ok: true,
      message: "SSH connection succeeded.",
      durationMs: Date.now() - started
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      message,
      durationMs: Date.now() - started
    };
  }
}

export async function executeCommand(request: SshExecuteCommandRequest): Promise<SshCommandExecutionResult> {
  const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const startedAt = new Date().toISOString();
  const risk = analyzeCommandRisk(request.command);
  const command = buildWrappedCommand(request.command, request.cwd);
  let client: Client | null = null;

  if (risk.level === "blocked") {
    return toFailedResult(request.command, startedAt, new Error(`Command blocked by safety policy: ${risk.reasons.join(" ")}`), risk);
  }

  if (risk.requiresSecondConfirm && !request.confirmedHighRisk) {
    return toFailedResult(request.command, startedAt, new Error(`High risk command requires second confirmation: ${risk.reasons.join(" ")}`), risk);
  }

  try {
    client = await connect(request.serverConfig, timeoutSeconds);
    const activeClient = client;

    return await new Promise<SshCommandExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (exitCode: number, extraStderr = ""): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        activeClient.end();

        const finishedAt = new Date().toISOString();
        const parsedStdout = splitStdoutMarkers(stdout);
        resolve({
          command: request.command,
          stdout: parsedStdout.stdout,
          stderr: extraStderr ? `${stderr}${stderr ? "\n" : ""}${extraStderr}` : stderr,
          exitCode: parsedStdout.markerExitCode ?? exitCode,
          durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
          cwd: parsedStdout.cwd,
          startedAt,
          finishedAt,
          risk,
          blocked: false,
          requiresSecondConfirm: false
        });
      };

      const timer = setTimeout(() => {
        finish(-1, `Command timed out after ${timeoutSeconds} seconds.`);
      }, timeoutSeconds * 1000);

      activeClient.exec(command, (error, stream) => {
        if (error) {
          finish(-1, error.message);
          return;
        }

        stream
          .on("data", (data: Buffer) => {
            stdout += data.toString("utf8");
          })
          .stderr.on("data", (data: Buffer) => {
            stderr += data.toString("utf8");
          });

        stream.on("close", (code: number | null) => {
          finish(code ?? 0);
        });

        stream.on("error", (error: Error) => {
          finish(-1, error.message);
        });
      });
    });
  } catch (error) {
    client?.end();
    return toFailedResult(request.command, startedAt, error, risk);
  }
}
