import { useEffect, useState } from "react";
import { aiShellApi } from "../api/aiShellApi";
import type { TaskHistoryEntry } from "../types";

function formatTime(value: string): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? "未执行" : String(exitCode);
}

export function HistoryPanel(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskHistoryEntry[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [historyPath, setHistoryPath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;

  async function loadHistory(): Promise<void> {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const [history, path] = await Promise.all([aiShellApi.listTaskHistory(), aiShellApi.getTaskHistoryPath()]);
      setTasks(history);
      setHistoryPath(path);
      setSelectedTaskId((current) => current ?? history[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      void loadHistory();
    }
  }, [isOpen]);

  return (
    <section className="history-panel">
      <div className="history-panel-header">
        <div>
          <h3>历史任务</h3>
          <p className="section-hint">最近任务会保存到本地 JSON，便于回看和调试。</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => setIsOpen((value) => !value)}>
            {isOpen ? "收起历史" : "查看历史"}
          </button>
          {isOpen && (
            <button className="secondary-button" disabled={isLoading} type="button" onClick={loadHistory}>
              {isLoading ? "刷新中..." : "刷新"}
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="history-content">
          {historyPath && <p className="history-path">保存位置：{historyPath}</p>}
          {errorMessage && <div className="toast-alert">{errorMessage}</div>}
          {!errorMessage && tasks.length === 0 && (
            <div className="empty-state">
              <strong>暂无历史任务</strong>
              <span>完成一次 AI 任务后，这里会显示任务目标、服务器、命令步骤和执行结果摘要。</span>
            </div>
          )}
          {tasks.length > 0 && (
            <div className="history-layout">
              <ol className="history-list">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      className={task.id === selectedTask?.id ? "history-item history-item-active" : "history-item"}
                      type="button"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <strong>{task.userGoal}</strong>
                      <span>{task.server.name || task.server.host}</span>
                      <span>
                        {task.status} · {formatTime(task.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>

              {selectedTask && (
                <article className="history-detail">
                  <div className="history-detail-header">
                    <div>
                      <h4>{selectedTask.userGoal}</h4>
                      <p>
                        {selectedTask.server.name} · {selectedTask.server.host}
                      </p>
                    </div>
                    <span className={`task-status task-status-${selectedTask.status}`}>{selectedTask.status}</span>
                  </div>
                  <dl className="history-meta">
                    <div>
                      <dt>创建时间</dt>
                      <dd>{formatTime(selectedTask.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>{formatTime(selectedTask.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>最终 cwd</dt>
                      <dd>{selectedTask.currentCwd || "-"}</dd>
                    </div>
                  </dl>
                  {selectedTask.errorMessage && <p className="blocked-note">{selectedTask.errorMessage}</p>}
                  {selectedTask.summary && <p className="task-summary">{selectedTask.summary}</p>}
                  <ol className="history-step-list">
                    {selectedTask.steps.map((step) => (
                      <li key={step.stepId}>
                        <div className="history-step-header">
                          <strong>
                            #{step.stepId} {step.stepTitle}
                          </strong>
                          <span className={`risk-pill risk-${step.riskLevel}`}>{step.riskLevel}</span>
                        </div>
                        <code>{step.command || "done"}</code>
                        <p>{step.reason}</p>
                        <div className="history-step-metrics">
                          <span>exit_code: {formatExitCode(step.exitCode)}</span>
                          <span>duration: {step.durationMs ?? "-"}ms</span>
                          <span>cwd: {step.cwd || "-"}</span>
                        </div>
                        {step.stdoutTail && (
                          <details className="output-panel">
                            <summary>stdout tail</summary>
                            <pre>{step.stdoutTail}</pre>
                          </details>
                        )}
                        {step.stderrTail && (
                          <details className="output-panel stderr-panel">
                            <summary>stderr tail</summary>
                            <pre>{step.stderrTail}</pre>
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                </article>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
