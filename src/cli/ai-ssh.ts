#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { LocalAppConfig, ServerConfig } from "../shared/types";

interface CliOptions {
  target?: string;
  port?: number;
  profile?: string;
  help: boolean;
}

function printHelp(): void {
  console.log(`AI Shell Assistant SSH wrapper

Usage:
  ai-ssh user@host
  ai-ssh user@host -p 22
  ai-ssh --profile default

Options:
  -p <port>              SSH port. Defaults to saved config or 22.
  --profile <name>       Use a saved server profile name when available.
  -h, --help             Show this help.

Notes:
  This is a lightweight wrapper for the system ssh command.
  It does not proxy terminal input/output and does not replace the built-in client.
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-p") {
      const rawPort = argv[index + 1];
      const port = Number(rawPort);
      if (!rawPort || !Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("Invalid port. Use -p 22.");
      }
      options.port = port;
      index += 1;
      continue;
    }

    if (arg === "--profile") {
      const profile = argv[index + 1];
      if (!profile) {
        throw new Error("Missing profile name after --profile.");
      }
      options.profile = profile;
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.target) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    options.target = arg;
  }

  return options;
}

function getCandidateConfigPaths(): string[] {
  const appNames = ["AI Shell Assistant", "ai-shell-assistant"];
  const home = os.homedir();
  const candidates: string[] = [];

  for (const appName of appNames) {
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, appName, "config.json"));
    }

    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, appName, "config.json"));
    }

    candidates.push(path.join(home, "AppData", "Roaming", appName, "config.json"));
    candidates.push(path.join(home, ".config", appName, "config.json"));
  }

  return Array.from(new Set(candidates));
}

async function loadLocalConfig(): Promise<LocalAppConfig | null> {
  for (const configPath of getCandidateConfigPaths()) {
    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const raw = await readFile(configPath, "utf8");
      return JSON.parse(raw) as LocalAppConfig;
    } catch {
      return null;
    }
  }

  return null;
}

function findServer(config: LocalAppConfig | null, profile?: string): ServerConfig | null {
  if (!config) {
    return null;
  }

  const servers = config.servers ?? [];

  if (profile) {
    return servers.find((server) => server.name === profile || server.id === profile) ?? (config.serverConfig?.name === profile ? config.serverConfig : null);
  }

  return config.serverConfig ?? servers.find((server) => server.id === config.activeServerId) ?? servers[0] ?? null;
}

function parseTarget(target: string): { username?: string; host: string } {
  const match = target.match(/^([^@]+)@(.+)$/);
  if (!match) {
    return {
      host: target
    };
  }

  return {
    username: match[1],
    host: match[2]
  };
}

function resolveConnection(options: CliOptions, server: ServerConfig | null): { username?: string; host?: string; port: number } {
  const parsedTarget = options.target ? parseTarget(options.target) : null;

  return {
    username: parsedTarget?.username ?? server?.username,
    host: parsedTarget?.host ?? server?.host,
    port: options.port ?? server?.port ?? 22
  };
}

function findSystemSsh(): string | null {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, ["ssh"], {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine ?? null;
}

function runSystemSsh(sshPath: string, username: string | undefined, host: string, port: number): Promise<number> {
  const target = username ? `${username}@${host}` : host;
  const child = spawn(sshPath, ["-p", String(port), target], {
    stdio: "inherit",
    windowsHide: false
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 0));
  });
}

async function main(): Promise<number> {
  let options: CliOptions;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run ai-ssh --help for usage.");
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  const config = await loadLocalConfig();
  const server = findServer(config, options.profile);
  const connection = resolveConnection(options, server);

  if (!connection.host) {
    console.error("Missing target host. Use ai-ssh user@host or configure a server in AI Shell Assistant.");
    return 2;
  }

  const sshPath = findSystemSsh();
  if (!sshPath) {
    console.error("System ssh command was not found.");
    console.error("Please install OpenSSH Client for Windows, or use the built-in AI Shell Assistant client.");
    return 1;
  }

  console.log(`Launching ssh: ${connection.username ? `${connection.username}@` : ""}${connection.host} -p ${connection.port}`);
  return runSystemSsh(sshPath, connection.username, connection.host, connection.port);
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
