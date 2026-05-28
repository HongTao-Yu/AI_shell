import { FormEvent, useEffect, useState } from "react";
import { aiShellApi } from "../api/aiShellApi";
import type { ServerConfig } from "../types";

interface ServerFormProps {
  server: ServerConfig | null;
  onServerSaved: (server: ServerConfig) => void;
}

export function ServerForm({ server, onServerSaved }: ServerFormProps): JSX.Element {
  const [name, setName] = useState("默认服务器");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!server) {
      return;
    }

    setName(server.name);
    setHost(server.host);
    setPort(server.port);
    setUsername(server.username);
    setPassword(server.password ?? "");
    setPrivateKeyPath(server.privateKeyPath ?? "");
  }, [server]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaveState("saving");

    const now = new Date().toISOString();
    const trimmedPrivateKeyPath = privateKeyPath.trim();
    const serverConfig: ServerConfig = {
      id: host ? `${host.trim()}:${port}` : "default-server",
      name: name.trim(),
      host: host.trim(),
      port,
      username: username.trim(),
      authType: trimmedPrivateKeyPath ? "privateKey" : "password",
      password,
      privateKeyPath: trimmedPrivateKeyPath || undefined,
      createdAt: server?.createdAt ?? now,
      updatedAt: now
    };

    try {
      const savedServer = await aiShellApi.saveServerConfig(serverConfig);
      onServerSaved(savedServer);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <form className="server-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>名称</span>
        <input required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>主机</span>
        <input required value={host} placeholder="192.168.1.10" onChange={(event) => setHost(event.target.value)} />
      </label>
      <label className="field">
        <span>端口</span>
        <input
          max={65535}
          min={1}
          required
          type="number"
          value={port}
          onChange={(event) => setPort(Number(event.target.value))}
        />
      </label>
      <label className="field">
        <span>用户</span>
        <input required value={username} placeholder="root" onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label className="field">
        <span>密码</span>
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          placeholder="可留空"
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label className="field field-wide">
        <span>私钥路径</span>
        <input
          value={privateKeyPath}
          placeholder="C:\\Users\\me\\.ssh\\id_rsa，可选"
          onChange={(event) => setPrivateKeyPath(event.target.value)}
        />
      </label>
      <button className="primary-button" disabled={saveState === "saving"} type="submit">
        {saveState === "saving" ? "保存中..." : "保存配置"}
      </button>
      {saveState === "saved" && <span className="form-status success">已保存</span>}
      {saveState === "error" && <span className="form-status error">保存失败</span>}
    </form>
  );
}
