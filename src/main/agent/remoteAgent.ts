import { readFile } from "node:fs/promises";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import type { RemoteAgentInstallRequest, RemoteAgentOperationResult, ServerConfig } from "../../shared/types";

const CONNECT_TIMEOUT_SECONDS = 20;
const INSTALL_ROOT = ".ai-shell-assistant";
const INSTALL_PATH = "~/.ai-shell-assistant";
const AI_PATH = "~/.ai-shell-assistant/bin/ai";
const BEGIN_MARKER = "# >>> AI Shell Assistant >>>";
const END_MARKER = "# <<< AI Shell Assistant <<<";

const REMOTE_AI_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

AI_SHELL_HOME="\${AI_SHELL_HOME:-$HOME/.ai-shell-assistant}"
LOG_DIR="$AI_SHELL_HOME/logs"
SESSION_DIR="$AI_SHELL_HOME/sessions"
CONFIG_FILE="$AI_SHELL_HOME/config.json"

ensure_layout() {
  mkdir -p "$LOG_DIR" "$SESSION_DIR"
  if [ ! -f "$CONFIG_FILE" ]; then
    printf '{\\n  "version": "0.2.0",\\n  "installedAt": "%s"\\n}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CONFIG_FILE"
  fi
}

doctor() {
  ensure_layout
  printf 'AI Shell Assistant remote agent doctor\\n'
  printf 'user: %s\\n' "$(whoami 2>/dev/null || printf unknown)"
  printf 'shell: %s\\n' "\${SHELL:-unknown}"
  printf 'install_path: %s\\n' "$AI_SHELL_HOME"
  case ":\$PATH:" in
    *":$AI_SHELL_HOME/bin:"*) printf 'path_status: ok\\n' ;;
    *) printf 'path_status: missing $AI_SHELL_HOME/bin\\n' ;;
  esac
  printf 'latest_log_path: %s\\n' "$LOG_DIR/ai.log"
}

case "\${1:-doctor}" in
  doctor)
    doctor
    ;;
  version)
    printf 'ai-shell-agent 0.2.0\\n'
    ;;
  *)
    printf 'Usage: ai {doctor|version}\\n' >&2
    exit 2
    ;;
esac
`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function createConnectConfig(server: ServerConfig): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: CONNECT_TIMEOUT_SECONDS * 1000,
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

function connect(server: ServerConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      client.end();
      reject(new Error(`SSH connection timed out after ${CONNECT_TIMEOUT_SECONDS} seconds.`));
    }, CONNECT_TIMEOUT_SECONDS * 1000);

    function finishWithError(error: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      client.end();
      reject(error);
    }

    createConnectConfig(server)
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

function exec(client: Client, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("data", (data: Buffer) => {
        stdout += data.toString("utf8");
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf8");
      });

      stream.on("close", (code: number | null) => {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      stream.on("error", reject);
    });
  });
}

function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(sftp);
    });
  });
}

function writeRemoteFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, content, { encoding: "utf8", mode: 0o755 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function remoteHomePath(relativePath: string): string {
  return `./${relativePath}`;
}

function buildShellRcInstallCommand(): string {
  const block = [
    BEGIN_MARKER,
    `export PATH="$HOME/${INSTALL_ROOT}/bin:$PATH"`,
    END_MARKER
  ].join("\n");

  return [
    "bash -lc",
    shellQuote(
      [
        "set -e",
        "touch ~/.bashrc",
        "if [ ! -f ~/.bashrc.ai-shell-assistant.bak ]; then cp ~/.bashrc ~/.bashrc.ai-shell-assistant.bak; fi",
        `sed -i '/${BEGIN_MARKER}/,/${END_MARKER}/d' ~/.bashrc`,
        `printf '\\n%s\\n' ${shellQuote(block)} >> ~/.bashrc`
      ].join("\n")
    )
  ].join(" ");
}

function buildUninstallCommand(): string {
  return [
    "bash -lc",
    shellQuote(
      [
        "set -e",
        "if [ -f ~/.bashrc ]; then",
        `  sed -i '/${BEGIN_MARKER}/,/${END_MARKER}/d' ~/.bashrc`,
        "fi",
        `rm -rf ~/${INSTALL_ROOT}`
      ].join("\n")
    )
  ].join(" ");
}

function failedResult(error: unknown, steps: string[]): RemoteAgentOperationResult {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    installPath: INSTALL_PATH,
    aiPath: AI_PATH,
    steps
  };
}

async function runChecked(client: Client, command: string, stepLabel: string, steps: string[]): Promise<string> {
  const result = await exec(client, command);
  if (result.exitCode !== 0) {
    throw new Error(`${stepLabel} failed: ${result.stderr || result.stdout || `exit code ${result.exitCode}`}`);
  }
  steps.push(stepLabel);
  return result.stdout;
}

export async function installRemoteAgent(request: RemoteAgentInstallRequest): Promise<RemoteAgentOperationResult> {
  const steps: string[] = [];
  let client: Client | null = null;
  let sftp: SFTPWrapper | null = null;

  try {
    client = await connect(request.serverConfig);
    steps.push("SSH connection established.");

    await runChecked(client, `mkdir -p ~/${INSTALL_ROOT}/bin ~/${INSTALL_ROOT}/logs ~/${INSTALL_ROOT}/sessions`, "Created remote agent directories.", steps);

    sftp = await getSftp(client);
    await writeRemoteFile(sftp, remoteHomePath(`${INSTALL_ROOT}/bin/ai`), REMOTE_AI_SCRIPT);
    steps.push("Uploaded ai script.");

    await runChecked(client, `chmod +x ~/${INSTALL_ROOT}/bin/ai`, "Marked ai script executable.", steps);

    await runChecked(
      client,
      `test -f ~/${INSTALL_ROOT}/config.json || printf '{\\n  "version": "0.2.0"\\n}\\n' > ~/${INSTALL_ROOT}/config.json`,
      "Ensured remote config file.",
      steps
    );

    if (request.updateShellRc) {
      await runChecked(client, buildShellRcInstallCommand(), "Updated ~/.bashrc PATH block.", steps);
    } else {
      steps.push("Skipped ~/.bashrc update.");
    }

    const doctorOutput = await runChecked(client, `${AI_PATH} doctor`, "Ran ai doctor.", steps);

    return {
      ok: true,
      message: "Remote agent installed.",
      installPath: INSTALL_PATH,
      aiPath: AI_PATH,
      doctorOutput,
      steps
    };
  } catch (error) {
    return failedResult(error, steps);
  } finally {
    sftp?.end();
    client?.end();
  }
}

export async function uninstallRemoteAgent(serverConfig: ServerConfig): Promise<RemoteAgentOperationResult> {
  const steps: string[] = [];
  let client: Client | null = null;

  try {
    client = await connect(serverConfig);
    steps.push("SSH connection established.");

    await runChecked(client, buildUninstallCommand(), "Removed remote agent files and ~/.bashrc block.", steps);

    return {
      ok: true,
      message: "Remote agent uninstalled.",
      installPath: INSTALL_PATH,
      aiPath: AI_PATH,
      steps
    };
  } catch (error) {
    return failedResult(error, steps);
  } finally {
    client?.end();
  }
}
