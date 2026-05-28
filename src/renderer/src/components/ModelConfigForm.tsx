import { FormEvent, useEffect, useState } from "react";
import { aiShellApi } from "../api/aiShellApi";
import type { ModelConfig } from "../types";

interface ModelConfigFormProps {
  modelConfig: ModelConfig | null;
  onModelConfigSaved: (modelConfig: ModelConfig) => void;
}

export function ModelConfigForm({ modelConfig, onModelConfigSaved }: ModelConfigFormProps): JSX.Element {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!modelConfig) {
      return;
    }

    setBaseUrl(modelConfig.baseUrl);
    setApiKey(modelConfig.apiKey);
    setModelName(modelConfig.modelName);
  }, [modelConfig]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaveState("saving");

    try {
      const savedConfig = await aiShellApi.saveModelConfig({
        baseUrl: baseUrl.trim(),
        apiKey,
        modelName: modelName.trim(),
        updatedAt: new Date().toISOString()
      });
      onModelConfigSaved(savedConfig);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <form className="model-config-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Base URL</span>
        <input required value={baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setBaseUrl(event.target.value)} />
      </label>
      <label className="field">
        <span>API Key</span>
        <input
          autoComplete="off"
          required
          type="password"
          value={apiKey}
          placeholder="不会输出到日志"
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Model</span>
        <input required value={modelName} placeholder="gpt-4.1-mini" onChange={(event) => setModelName(event.target.value)} />
      </label>
      <button className="primary-button" disabled={saveState === "saving"} type="submit">
        {saveState === "saving" ? "保存中..." : "保存模型"}
      </button>
      {saveState === "saved" && <span className="form-status success">已保存</span>}
      {saveState === "error" && <span className="form-status error">保存失败</span>}
    </form>
  );
}
