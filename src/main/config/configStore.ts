import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalAppConfig, ModelConfig, ServerConfig } from "../../shared/types";

const defaultConfig: LocalAppConfig = {
  serverConfig: null,
  modelConfig: null
};

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

export async function loadConfig(): Promise<LocalAppConfig> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalAppConfig>;
    const legacyServer =
      parsed.serverConfig ?? parsed.servers?.find((server) => server.id === parsed.activeServerId) ?? parsed.servers?.[0] ?? null;

    return {
      ...defaultConfig,
      ...parsed,
      serverConfig: legacyServer
    };
  } catch {
    return defaultConfig;
  }
}

export async function saveConfig(config: LocalAppConfig): Promise<LocalAppConfig> {
  const configPath = getConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export async function getServerConfig(): Promise<ServerConfig | null> {
  const config = await loadConfig();
  return config.serverConfig;
}

export async function saveServerConfig(server: ServerConfig): Promise<ServerConfig> {
  const current = await loadConfig();
  await saveConfig({
    ...current,
    serverConfig: server,
    activeServerId: server.id
  });
  return server;
}

export async function getModelConfig(): Promise<ModelConfig | null> {
  const config = await loadConfig();
  return config.modelConfig;
}

export async function saveModelConfig(modelConfig: ModelConfig): Promise<ModelConfig> {
  const current = await loadConfig();
  await saveConfig({
    ...current,
    modelConfig
  });
  return modelConfig;
}
