import type { SshCommandExecutionResult } from "../types";

interface ExecutionResultProps {
  result: SshCommandExecutionResult | null;
  variant?: "light" | "dark";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function ExecutionResult({ result, variant = "light" }: ExecutionResultProps): JSX.Element {
  const isSuccess = result ? result.exitCode === 0 : false;
  const shellClass = variant === "dark" ? "execution-result result-dark" : "execution-result";

  if (!result) {
    return (
      <section className={shellClass} aria-label="执行结果">
        <div className="result-header">
          <h3>执行结果</h3>
          <span className="result-badge result-idle">等待执行</span>
        </div>
        <p className="result-empty">执行后会在这里看到 stdout、stderr、exit_code、耗时和 cwd。</p>
      </section>
    );
  }

  return (
    <section className={shellClass} aria-label="执行结果">
      <div className="result-header">
        <h3>执行结果</h3>
        <span className={`result-badge ${isSuccess ? "result-success" : "result-failed"}`}>
          {isSuccess ? "成功" : result.blocked ? "已拦截" : "失败"}
        </span>
      </div>

      <div className="result-metrics">
        <div>
          <span>exit_code</span>
          <strong>{result.exitCode}</strong>
        </div>
        <div>
          <span>duration</span>
          <strong>{formatDuration(result.durationMs)}</strong>
        </div>
        <div>
          <span>cwd_after</span>
          <strong>{result.cwd || "未返回"}</strong>
        </div>
      </div>

      <details className="output-panel" open>
        <summary>stdout {result.stdout ? "" : "（无输出）"}</summary>
        <pre>{result.stdout || "(empty)"}</pre>
      </details>

      <details className="output-panel stderr-panel" open={Boolean(result.stderr)}>
        <summary>stderr {result.stderr ? "" : "（无错误输出）"}</summary>
        <pre>{result.stderr || "(empty)"}</pre>
      </details>
    </section>
  );
}
