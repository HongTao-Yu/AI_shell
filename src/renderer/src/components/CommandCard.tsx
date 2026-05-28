import { useState } from "react";
import type { LlmPlanNextCommandResult } from "../types";

interface CommandCardProps {
  suggestion: LlmPlanNextCommandResult | null;
  isExecuting?: boolean;
  canExecute?: boolean;
  onAcceptExecute?: () => void;
  onUseEditedCommand?: (command: string) => void;
  onPlanAlternative?: () => void;
  onStopTask?: () => void;
}

const riskLabels: Record<LlmPlanNextCommandResult["riskLevel"], string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  blocked: "已拦截"
};

function getActionLabel(suggestion: LlmPlanNextCommandResult, isExecuting: boolean): string {
  if (suggestion.riskLevel === "blocked") {
    return "已拦截";
  }

  if (isExecuting) {
    return "执行中...";
  }

  return "接纳并执行";
}

export function CommandCard({
  suggestion,
  isExecuting = false,
  canExecute = true,
  onAcceptExecute,
  onUseEditedCommand,
  onPlanAlternative,
  onStopTask
}: CommandCardProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [editedCommand, setEditedCommand] = useState("");

  if (!suggestion) {
    return (
      <section className="command-card" aria-label="命令建议卡片">
        <div className="empty-state">
          <strong>还没有命令建议</strong>
          <span>在右侧输入任务后，AI 会每次只给出一条 Linux 命令，并说明原因、风险和预期结果。</span>
        </div>
      </section>
    );
  }

  const actionDisabled = suggestion.done || suggestion.riskLevel === "blocked" || isExecuting || !canExecute || !onAcceptExecute;

  function startEditing(): void {
    if (!suggestion) {
      return;
    }
    setEditedCommand(suggestion.command);
    setIsEditing(true);
  }

  function submitEditedCommand(): void {
    const trimmed = editedCommand.trim();
    if (!trimmed) {
      return;
    }
    onUseEditedCommand?.(trimmed);
    setIsEditing(false);
  }

  return (
    <section className="command-card" aria-label="命令建议卡片">
      <div className="command-card-header">
        <div>
          <p className="card-kicker">下一步建议</p>
          <h3>{suggestion.stepTitle}</h3>
        </div>
        <span className={`risk-pill risk-${suggestion.riskLevel}`}>{riskLabels[suggestion.riskLevel]}</span>
      </div>

      <pre className="command-box">{suggestion.done ? "任务已完成" : suggestion.command}</pre>

      {isEditing && (
        <div className="edit-command-box">
          <label className="field">
            <span>修改后命令</span>
            <textarea value={editedCommand} rows={3} onChange={(event) => setEditedCommand(event.target.value)} />
          </label>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => setIsEditing(false)}>
              取消
            </button>
            <button className="primary-button" type="button" onClick={submitEditedCommand}>
              放到左侧执行区
            </button>
          </div>
        </div>
      )}

      <dl className="suggestion-details">
        <div>
          <dt>为什么执行</dt>
          <dd>{suggestion.reason || "AI 没有返回原因，建议先换一个方案。"}</dd>
        </div>
        <div>
          <dt>风险说明</dt>
          <dd>{suggestion.riskReasons.length > 0 ? suggestion.riskReasons.join(" ") : "未发现明确风险。"}</dd>
        </div>
        <div>
          <dt>预期结果</dt>
          <dd>{suggestion.expectedResult || "执行后观察 stdout、stderr 和 exit_code。"}</dd>
        </div>
      </dl>

      {suggestion.riskLevel === "blocked" && <p className="blocked-note">这条命令已被本地安全策略拦截，不能执行。</p>}
      {suggestion.requiresSecondConfirm && <p className="high-risk-note">这条命令属于高风险，点击执行后还需要二次确认。</p>}

      {showExplanation && (
        <div className="inline-help">
          <strong>怎么看这张卡片</strong>
          <span>先看风险等级，再看命令和预期结果。低风险通常是查询命令；中风险可能安装依赖；高风险会改变系统状态；已拦截命令不能执行。</span>
        </div>
      )}

      <div className="command-actions">
        <button className="primary-button" type="button" disabled={actionDisabled} onClick={onAcceptExecute}>
          {getActionLabel(suggestion, isExecuting)}
        </button>
        <button className="secondary-button" type="button" disabled={suggestion.done || isExecuting} onClick={startEditing}>
          修改命令
        </button>
        <button className="secondary-button" type="button" onClick={() => setShowExplanation((value) => !value)}>
          解释命令
        </button>
        <button className="secondary-button" type="button" disabled={!onPlanAlternative || isExecuting} onClick={onPlanAlternative}>
          换一个方案
        </button>
        <button className="secondary-button danger-button" type="button" disabled={!onStopTask || isExecuting} onClick={onStopTask}>
          停止任务
        </button>
      </div>

      {!canExecute && !suggestion.done && <p className="hint-text">请先配置服务器和模型，才能执行 AI 建议。</p>}
    </section>
  );
}
