import { useState } from "react";
import { aiShellApi } from "../api/aiShellApi";
import type { RemoteAgentOperationResult, ServerConfig } from "../types";

interface RemoteAgentPanelProps {
  server: ServerConfig | null;
}

export function RemoteAgentPanel({ server }: RemoteAgentPanelProps): JSX.Element {
  const [updateShellRc, setUpdateShellRc] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [result, setResult] = useState<RemoteAgentOperationResult | null>(null);

  async function handleInstall(): Promise<void> {
    if (!server) {
      setResult({
        ok: false,
        message: "Please save a server configuration before installing the remote agent.",
        steps: []
      });
      return;
    }

    const confirmed = window.confirm(
      updateShellRc
        ? "Install remote agent to ~/.ai-shell-assistant and update ~/.bashrc with a marked PATH block?"
        : "Install remote agent to ~/.ai-shell-assistant without changing ~/.bashrc?"
    );
    if (!confirmed) {
      return;
    }

    setIsWorking(true);
    setResult(null);

    try {
      setResult(await aiShellApi.installRemoteAgent({ serverConfig: server, updateShellRc }));
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        steps: []
      });
    } finally {
      setIsWorking(false);
    }
  }

  async function handleUninstall(): Promise<void> {
    if (!server) {
      setResult({
        ok: false,
        message: "Please save a server configuration before uninstalling the remote agent.",
        steps: []
      });
      return;
    }

    const confirmed = window.confirm(
      "Uninstall remote agent from ~/.ai-shell-assistant and remove the marked ~/.bashrc block?"
    );
    if (!confirmed) {
      return;
    }

    setIsWorking(true);
    setResult(null);

    try {
      setResult(await aiShellApi.uninstallRemoteAgent(server));
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        steps: []
      });
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <section className="remote-agent-panel" aria-label="Remote agent installer">
      <div className="remote-agent-header">
        <div>
          <h3>Remote Agent</h3>
          <p>Install a small ai script on the Linux server for future terminal adapters.</p>
        </div>
        <span className={`connection-badge ${server ? "connection-badge-ready" : "connection-badge-missing"}`}>
          {server ? "server ready" : "no server"}
        </span>
      </div>

      <label className="checkbox-row">
        <input
          checked={updateShellRc}
          type="checkbox"
          onChange={(event) => setUpdateShellRc(event.target.checked)}
        />
        <span>Update ~/.bashrc with marked PATH block</span>
      </label>

      <div className="task-action-row">
        <button className="secondary-button" disabled={isWorking || !server} type="button" onClick={handleInstall}>
          {isWorking ? "Working..." : "Install remote Agent"}
        </button>
        <button className="secondary-button danger-button" disabled={isWorking || !server} type="button" onClick={handleUninstall}>
          Uninstall
        </button>
      </div>

      {result && (
        <div className={`agent-result ${result.ok ? "agent-result-ok" : "agent-result-error"}`}>
          <strong>{result.message}</strong>
          {result.aiPath && <code>{result.aiPath}</code>}
          {result.steps.length > 0 && (
            <ul>
              {result.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          )}
          {result.doctorOutput && <pre>{result.doctorOutput}</pre>}
        </div>
      )}
    </section>
  );
}
