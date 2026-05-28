import type { EnvironmentContext, ServerConfig } from "../../shared/types";
import { executeCommand } from "../ssh/sshClient";

const FEATURE_FILES = [
  "README.md",
  "requirements.txt",
  "pyproject.toml",
  "package.json",
  "pom.xml",
  "build.gradle",
  "CMakeLists.txt",
  "docker-compose.yml",
  "Dockerfile"
];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function tail(value: string, maxLength = 4000): string {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

function redactSensitiveListing(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !/(^|\s)(\.env|.*id_rsa|.*id_dsa|.*id_ecdsa|.*id_ed25519|.*token.*|.*secret.*|.*password.*)(\s|$)/i.test(line))
    .join("\n");
}

function guessProjectType(projectFiles: string[]): string {
  const files = new Set(projectFiles);
  const guesses: string[] = [];

  if (files.has("requirements.txt") || files.has("pyproject.toml")) {
    guesses.push("Python");
  }

  if (files.has("package.json")) {
    guesses.push("Node.js");
  }

  if (files.has("pom.xml")) {
    guesses.push("Java Maven");
  }

  if (files.has("build.gradle")) {
    guesses.push("Java Gradle");
  }

  if (files.has("CMakeLists.txt")) {
    guesses.push("C/C++ CMake");
  }

  if (files.has("docker-compose.yml") || files.has("Dockerfile")) {
    guesses.push("Docker");
  }

  return guesses.length > 0 ? guesses.join(", ") : "unknown";
}

async function runContextCommand(
  serverConfig: ServerConfig,
  command: string,
  cwd: string | undefined,
  timeoutSeconds = 8
): Promise<{ stdout: string; stderr: string; cwd: string; ok: boolean }> {
  const result = await executeCommand({
    serverConfig,
    command,
    cwd,
    timeoutSeconds
  });

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    cwd: result.cwd,
    ok: result.exitCode === 0
  };
}

export async function collectEnvironmentContext(
  serverConfig: ServerConfig,
  cwd?: string
): Promise<EnvironmentContext> {
  const errors: string[] = [];
  const startedAt = new Date().toISOString();
  const initialCwd = cwd || serverConfig.defaultCwd;

  async function safeRun(command: string, fallback = "", timeoutSeconds = 8): Promise<{ stdout: string; cwd: string }> {
    try {
      const result = await runContextCommand(serverConfig, command, initialCwd, timeoutSeconds);
      if (!result.ok && result.stderr) {
        errors.push(`${command}: ${result.stderr}`);
      }
      return {
        stdout: result.ok ? result.stdout : fallback,
        cwd: result.cwd
      };
    } catch (error) {
      errors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        stdout: fallback,
        cwd: ""
      };
    }
  }

  const pwdResult = await safeRun("pwd");
  const activeCwd = pwdResult.stdout || pwdResult.cwd || initialCwd || "";
  const cwdArg = activeCwd || undefined;

  async function safeRunInActiveCwd(command: string, fallback = "", timeoutSeconds = 8): Promise<string> {
    try {
      const result = await runContextCommand(serverConfig, command, cwdArg, timeoutSeconds);
      if (!result.ok && result.stderr) {
        errors.push(`${command}: ${result.stderr}`);
      }
      return result.ok ? result.stdout : fallback;
    } catch (error) {
      errors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  }

  const [uname, username, shell, directoryListing, gitBranch, gitStatus, featureOutput] = await Promise.all([
    safeRunInActiveCwd("uname -a"),
    safeRunInActiveCwd("whoami"),
    safeRunInActiveCwd("printf '%s' \"${SHELL:-unknown}\""),
    safeRunInActiveCwd("ls -la", "", 10),
    safeRunInActiveCwd("git branch --show-current 2>/dev/null || true"),
    safeRunInActiveCwd("git status --short 2>/dev/null || true"),
    safeRunInActiveCwd(
      `${FEATURE_FILES.map((file) => `[ -e ${shellQuote(file)} ] && printf '%s\\n' ${shellQuote(file)}`).join("; ")}; true`,
      "",
      8
    )
  ]);
  const projectFiles = featureOutput
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);

  return {
    cwd: activeCwd,
    uname,
    username,
    shell,
    directoryListing: tail(redactSensitiveListing(directoryListing)),
    gitBranch,
    gitStatus: tail(redactSensitiveListing(gitStatus), 2000),
    projectFiles,
    projectTypeGuess: guessProjectType(projectFiles),
    collectedAt: startedAt,
    errors
  };
}

export { FEATURE_FILES };
