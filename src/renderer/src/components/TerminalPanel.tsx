import { FormEvent, useEffect, useState } from "react";
import { aiShellApi } from "../api/aiShellApi";
import type { CommandRiskAnalysis, ServerConfig, SshCommandExecutionResult, SshTestConnectionResult } from "../types";
import { ExecutionResult } from "./ExecutionResult";
import { RemoteAgentPanel } from "./RemoteAgentPanel";

interface TerminalDraft {
  id: number;
  command: string;
}

interface TerminalPanelProps {
  server: ServerConfig | null;
  prefillCommand?: TerminalDraft | null;
}

function makeLocalExecutionResult(
  command: string,
  cwd: string,
  stderr: string,
  risk: CommandRiskAnalysis,
  blocked = false
): SshCommandExecutionResult {
  const now = new Date().toISOString();

  return {
    command,
    stdout: "",
    stderr,
    exitCode: -1,
    durationMs: 0,
    cwd,
    startedAt: now,
    finishedAt: now,
    risk,
    blocked,
    requiresSecondConfirm: risk.requiresSecondConfirm
  };
}

export function TerminalPanel({ server, prefillCommand }: TerminalPanelProps): JSX.Element {
  const [command, setCommand] = useState("pwd");
  const [cwd, setCwd] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);
  const [connectionResult, setConnectionResult] = useState<SshTestConnectionResult | null>(null);
  const [executionResult, setExecutionResult] = useState<SshCommandExecutionResult | null>(null);
  const [riskAnalysis, setRiskAnalysis] = useState<CommandRiskAnalysis | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (prefillCommand?.command) {
      setCommand(prefillCommand.command);
    }
  }, [prefillCommand]);

  async function handleTestConnection(): Promise<void> {
    if (!server) {
      setConnectionResult({
        ok: false,
        message: "请先在顶部保存服务器配置。",
        durationMs: 0
      });
      return;
    }

    setIsTesting(true);
    setConnectionResult(null);

    try {
      setConnectionResult(await aiShellApi.testConnection(server));
    } catch (error) {
      setConnectionResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        durationMs: 0
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleExecuteCommand(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const risk = await aiShellApi.analyzeCommandRisk(command);
    setRiskAnalysis(risk);

    if (!server) {
      setExecutionResult(makeLocalExecutionResult(command, cwd.trim(), "请先保存服务器配置，再执行命令。", risk));
      return;
    }

    if (risk.level === "blocked") {
      setExecutionResult(makeLocalExecutionResult(command, cwd.trim(), `已拦截：${risk.reasons.join(" ")}`, risk, true));
      return;
    }

    let confirmedHighRisk = false;
    if (risk.requiresSecondConfirm) {
      confirmedHighRisk = window.confirm(`这是一条高风险命令：\n${risk.reasons.join("\n")}\n\n确认继续执行吗？`);
      if (!confirmedHighRisk) {
        setExecutionResult(makeLocalExecutionResult(command, cwd.trim(), "高风险命令已取消执行。", risk));
        return;
      }
    }

    setIsExecuting(true);
    setExecutionResult(null);

    try {
      const result = await aiShellApi.executeCommand({
        serverConfig: server,
        command,
        cwd: cwd.trim() || undefined,
        timeoutSeconds,
        confirmedHighRisk
      });
      setExecutionResult(result);
      if (result.cwd) {
        setCwd(result.cwd);
      }
    } catch (error) {
      setExecutionResult(makeLocalExecutionResult(command, cwd.trim(), error instanceof Error ? error.message : String(error), risk));
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <section className="panel terminal-panel" aria-label="终端和执行结果区域">
      <div className="terminal-header">
        <div>
          <h2 className="terminal-title">手动命令执行</h2>
          <p className="panel-subtitle">先测试连接，再执行一条命令。所有命令都会经过本地风险检查。</p>
        </div>
        <span className={`connection-badge ${server ? "connection-badge-ready" : "connection-badge-missing"}`}>
          {server?.host ? `${server.username}@${server.host}` : "未配置服务器"}
        </span>
      </div>

      {!server && (
        <div className="empty-state empty-state-dark">
          <strong>还不能执行命令</strong>
          <span>请先在顶部填写服务器地址、用户名和登录方式。配置保存后再点击“测试连接”。</span>
        </div>
      )}

      <div className="terminal-actions">
        <button className="secondary-button terminal-button" disabled={isTesting || !server} type="button" onClick={handleTestConnection}>
          {isTesting ? "测试中..." : "测试连接"}
        </button>
        {connectionResult && (
          <span className={connectionResult.ok ? "connection-ok" : "connection-error"}>
            {connectionResult.message} ({connectionResult.durationMs}ms)
          </span>
        )}
      </div>

      <form className="command-form" onSubmit={handleExecuteCommand}>
        <label className="terminal-field command-input-field">
          <span>命令</span>
          <input required value={command} placeholder="pwd" onChange={(event) => setCommand(event.target.value)} />
        </label>
        <label className="terminal-field">
          <span>工作目录</span>
          <input value={cwd} placeholder="/home/user/project，可选" onChange={(event) => setCwd(event.target.value)} />
        </label>
        <label className="terminal-field timeout-field">
          <span>超时秒数</span>
          <input
            max={600}
            min={1}
            type="number"
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
          />
        </label>
        <button className="primary-button terminal-button" disabled={isExecuting || !server} type="submit">
          {isExecuting ? "执行中..." : "执行命令"}
        </button>
      </form>

      {riskAnalysis && (
        <div className={`risk-summary risk-summary-${riskAnalysis.level}`}>
          <strong>风险等级：{riskAnalysis.level}</strong>
          <span>{riskAnalysis.reasons.join(" ")}</span>
          {riskAnalysis.level === "blocked" && <span>已拦截，不能执行。</span>}
          {riskAnalysis.requiresSecondConfirm && <span>执行前需要二次确认。</span>}
        </div>
      )}

      <RemoteAgentPanel server={server} />

      <div className="terminal-body">
        <p className="terminal-line">$ {executionResult?.command ?? command}</p>
        <ExecutionResult result={executionResult} variant="dark" />
      </div>
    </section>
  );
}
