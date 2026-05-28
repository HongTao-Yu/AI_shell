import { useEffect, useMemo, useState } from "react";
import { aiShellApi } from "./api/aiShellApi";
import { AiPanel } from "./components/AiPanel";
import { ServerForm } from "./components/ServerForm";
import { TerminalPanel } from "./components/TerminalPanel";
import type { AiTask, ModelConfig, ServerConfig } from "./types";

interface TerminalDraft {
  id: number;
  command: string;
}

function getServerStatus(server: ServerConfig | null): string {
  if (!server) {
    return "未配置服务器";
  }

  return `${server.name} · ${server.host}:${server.port}`;
}

function getModelStatus(modelConfig: ModelConfig | null): string {
  if (!modelConfig) {
    return "未配置模型";
  }

  return modelConfig.modelName;
}

export function App(): JSX.Element {
  const [server, setServer] = useState<ServerConfig | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [currentTask, setCurrentTask] = useState<AiTask | null>(null);
  const [terminalDraft, setTerminalDraft] = useState<TerminalDraft | null>(null);
  const [configStatus, setConfigStatus] = useState("正在读取本地配置...");

  const currentCwd = useMemo(() => {
    return currentTask?.currentCwd || currentTask?.context?.cwd || server?.defaultCwd || "尚未采集";
  }, [currentTask, server]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([aiShellApi.getServerConfig(), aiShellApi.getModelConfig()])
      .then(([savedServer, savedModelConfig]) => {
        if (cancelled) {
          return;
        }

        setServer(savedServer);
        setModelConfig(savedModelConfig);

        if (savedServer && savedModelConfig) {
          setConfigStatus("服务器和模型配置已就绪，可以开始任务。");
        } else if (!savedServer && !savedModelConfig) {
          setConfigStatus("请先填写服务器和模型配置。");
        } else if (!savedServer) {
          setConfigStatus("模型已配置，请继续填写服务器信息。");
        } else {
          setConfigStatus("服务器已配置，请继续填写模型信息。");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfigStatus("读取本地配置失败，请检查应用权限后重试。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleServerSaved(savedServer: ServerConfig): void {
    setServer(savedServer);
    setConfigStatus("服务器配置已保存。建议先点击左侧“测试连接”。");
  }

  function handleModelConfigSaved(savedModelConfig: ModelConfig): void {
    setModelConfig(savedModelConfig);
    setConfigStatus("模型配置已保存。现在可以在右侧输入自然语言任务。");
  }

  function handleTaskChanged(task: AiTask | null): void {
    setCurrentTask(task);
  }

  function handleSendCommandToTerminal(command: string): void {
    setTerminalDraft({
      id: Date.now(),
      command
    });
    setConfigStatus("修改后的命令已放到左侧手动执行区，执行前仍会经过本地风险检查。");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">AI Shell Assistant</p>
          <h1>Linux AI 命令行助手</h1>
        </div>

        <div className="top-status" aria-label="当前状态">
          <span className={`status-chip ${server ? "status-ready" : "status-missing"}`}>服务器：{getServerStatus(server)}</span>
          <span className="status-chip status-neutral">cwd：{currentCwd}</span>
          <span className={`status-chip ${modelConfig ? "status-ready" : "status-missing"}`}>模型：{getModelStatus(modelConfig)}</span>
        </div>

        <ServerForm server={server} onServerSaved={handleServerSaved} />
      </header>

      <div className="config-banner" role="status">
        {configStatus}
      </div>

      <section className="workspace" aria-label="主工作区">
        <TerminalPanel server={server} prefillCommand={terminalDraft} />
        <AiPanel
          modelConfig={modelConfig}
          server={server}
          onModelConfigSaved={handleModelConfigSaved}
          onSendCommandToTerminal={handleSendCommandToTerminal}
          onTaskChanged={handleTaskChanged}
        />
      </section>
    </main>
  );
}
