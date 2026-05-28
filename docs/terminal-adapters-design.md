# AI Shell Assistant Terminal Adapters Design

## 1. 适配目标

终端适配器的目标不是替代 Xshell、MobaXterm、SecureCRT 或 Windows Terminal，而是在用户继续使用熟悉终端的前提下，把 AI Shell Assistant 的核心能力带到现有工作流中。

第一阶段适配目标：

1. 让外部终端可以通过统一入口启动 SSH 连接，例如 `ai-ssh user@host -p 22`。
2. 让用户可以把终端中的报错、输出片段或当前问题发送给 AI Shell Assistant 分析。
3. 让 AI Shell Assistant 生成的建议命令可以被用户确认后复制或粘贴回终端。
4. 保持安全边界：AI 只建议命令，用户确认后执行；blocked 命令不应被绕过。
5. 不要求外部终端具备完整任务状态机，核心闭环仍由 AI Shell Assistant 桌面端和主进程维护。

非目标：

1. 不实现 Xshell/MobaXterm 的深度原生插件。
2. 不承诺可以读取或控制所有终端内部状态。
3. 不绕过用户确认直接在外部终端执行高风险命令。
4. 不依赖 root 权限、系统级 SSH Hook 或远端强制 Agent。

## 2. 核心能力不应依赖 Xshell/MobaXterm 插件

AI Shell Assistant 的核心能力包括服务器配置、SSH 命令执行、LLM 调用、风险识别、任务状态机、历史日志和上下文采集。这些能力应该保持在 Electron 主进程和本地受控模块中，而不是绑定到某个终端插件。

原因：

1. 终端能力差异大：Xshell、MobaXterm、SecureCRT、Windows Terminal 的扩展方式、脚本能力、剪贴板支持和菜单能力并不一致。
2. 插件 API 不稳定或不开放：部分终端没有公开、稳定、完整的插件 API，深度集成成本高，且容易随版本变化失效。
3. 安全策略必须统一：命令风险识别、二次确认、blocked 拦截不能散落到各个终端脚本里，否则容易出现绕过路径。
4. 可测试性更好：核心逻辑留在主应用，可以用 TypeScript 类型、IPC、单元测试和端到端流程验证。
5. 用户安装门槛更低：先提供独立桌面应用和 `ai-ssh`，用户无需理解终端插件机制即可使用。

因此，终端适配层只做轻量连接：

```text
外部终端
  -> ai-ssh / 启动命令 / 剪贴板 / 本地 URL 或 CLI
  -> AI Shell Assistant 桌面端
  -> 主进程核心能力
```

## 3. Xshell 适配方案

### 3.1 脚本、菜单、快捷键可以做什么

Xshell 适配优先采用“外部工具 + 脚本 + 剪贴板”的轻量方式。不同版本的 Xshell 脚本能力可能不同，设计上不假设存在完整插件 API。

可做能力：

1. 配置自定义按钮或菜单项，启动本地 AI Shell Assistant。
2. 配置快捷键，把当前选中的文本复制到剪贴板，再触发本地分析入口。
3. 通过外部命令启动 `ai-ssh user@host -p 22`。
4. 将 AI 生成的建议命令复制到剪贴板，由用户手动粘贴到 Xshell。
5. 在后续版本中，如果当前 Xshell 脚本环境支持发送文本到会话，可以把“粘贴建议命令”做成可选增强，但不能作为唯一方案。

不承诺能力：

1. 不承诺读取 Xshell 完整缓冲区。
2. 不承诺稳定获取当前会话的 host、user、cwd。
3. 不承诺直接控制所有 Xshell 标签页或会话。

### 3.2 如何调用本地 AI Shell Assistant

建议提供三类本地入口：

1. `ai-shell-assistant.exe --open`
   打开桌面应用。

2. `ai-shell-assistant.exe --analyze-clipboard`
   读取剪贴板中的终端输出，打开分析面板。

3. `ai-shell-assistant.exe --suggest-command --text-from-clipboard`
   读取剪贴板文本，让 AI 生成下一条命令建议，但仍在桌面端展示风险、原因和预期结果。

当前工程已有 `ai-ssh` 包装器，v0.2 可以先支持：

```powershell
ai-ssh user@host -p 22
```

后续再补桌面端 CLI 参数或本地协议：

```text
ai-shell-assistant://analyze?source=clipboard
```

协议方式体验更好，但需要注册 Windows URL Protocol，适合 v0.3 以后。

### 3.3 如何选中文本分析

务实方案：

1. 用户在 Xshell 中选中报错或输出片段。
2. 用户按 Xshell 里的复制快捷键，或点击自定义菜单“复制并分析”。
3. Xshell 脚本或外部工具触发本地命令：

```powershell
ai-shell-assistant.exe --analyze-clipboard
```

4. AI Shell Assistant 从剪贴板读取文本，展示：
   - 输出摘要
   - 可能原因
   - 建议下一条命令
   - 风险等级
   - 是否需要二次确认

注意：剪贴板方式不依赖 Xshell 内部 API，是兼容性最高的起点。缺点是无法保证文本一定来自当前终端，需要 UI 明确展示“本次分析来自剪贴板”。

### 3.4 如何把建议命令粘贴回终端

分三档实现：

1. v0.2 基础方案：AI Shell Assistant 提供“复制命令”按钮，用户回到 Xshell 手动粘贴。
2. v0.3 半自动方案：AI Shell Assistant 复制命令到剪贴板，并提示用户回到终端粘贴执行。
3. v0.4 可选增强：如果用户启用 Xshell 脚本适配，脚本可以读取剪贴板并发送到当前会话，但必须保留用户确认，不自动按 Enter 执行高风险命令。

安全要求：

1. blocked 命令不能复制为“可执行建议”，只能展示拦截原因。
2. high 命令复制前需要二次确认。
3. 粘贴回终端时默认不自动执行，建议只粘贴命令文本，不附带回车。

## 4. MobaXterm 适配方案

### 4.1 通过本地工具和命令包装器实现

MobaXterm 的适配应优先走通用命令包装器，而不是假设存在深度插件能力。

可做能力：

1. 在 MobaXterm 中配置自定义 SSH 启动命令或本地工具，调用 `ai-ssh`。
2. 使用剪贴板把选中输出发送给 AI Shell Assistant 分析。
3. 通过“复制建议命令”让用户粘贴回 MobaXterm。
4. 如果用户安装了远端 `ai` 脚本，可以在远端执行 `ai doctor` 检查 Agent 状态。

### 4.2 通过 ai-ssh 或启动命令实现

推荐 v0.2 支持：

```powershell
ai-ssh user@host -p 22
```

对于已经保存过服务器配置的用户：

```powershell
ai-ssh --profile default
```

MobaXterm 的会话配置可以把外部命令或本地 shell 启动命令指向 `ai-ssh`。此时 `ai-ssh` 负责调用系统 OpenSSH。如果系统没有 OpenSSH，则提示用户使用 AI Shell Assistant 内置客户端。

### 4.3 插件能力限制

设计上不假设 MobaXterm 能提供以下能力：

1. 稳定读取当前终端选中内容。
2. 稳定获取当前会话元数据。
3. 原生展示 AI Shell Assistant 侧边栏。
4. 直接控制远端 shell 输入输出流。

因此 MobaXterm 适配的可靠路线是：

```text
启动连接：ai-ssh
文本分析：剪贴板
命令回填：复制命令 + 用户粘贴
深度联动：后续评估，不作为 MVP 承诺
```

## 5. SecureCRT 适配方案

SecureCRT 通常具备脚本能力，适配思路可以类似 Xshell，但仍不把核心能力放到 SecureCRT 脚本中。

可选方案：

1. SecureCRT 脚本复制当前选中内容或屏幕文本到剪贴板。
2. 调用本地 AI Shell Assistant 分析剪贴板。
3. AI Shell Assistant 生成建议命令并复制到剪贴板。
4. 用户回到 SecureCRT 粘贴执行。

可选增强：

1. 如果脚本可访问当前会话连接信息，可把 host/user 作为附加上下文传给本地应用。
2. 如果脚本支持发送文本到当前会话，可做“粘贴到终端但不自动回车”的能力。

限制：

1. 不要求用户必须使用 SecureCRT 脚本。
2. 不依赖 SecureCRT 执行高风险安全判断。

## 6. Windows Terminal Profile 适配方案

Windows Terminal 是最适合先做 profile 适配的终端，因为它主要通过配置文件定义启动命令。

v0.2 可生成或提示用户添加 profile：

```json
{
  "name": "AI Shell Assistant SSH",
  "commandline": "ai-ssh --profile default",
  "startingDirectory": "%USERPROFILE%"
}
```

也可以为具体服务器生成：

```json
{
  "name": "AI SSH user@host",
  "commandline": "ai-ssh user@host -p 22",
  "startingDirectory": "%USERPROFILE%"
}
```

实现方式：

1. AI Shell Assistant 读取已保存服务器配置。
2. 生成 Windows Terminal profile JSON 片段。
3. 用户手动复制到 Windows Terminal 设置中，或后续提供“写入配置”按钮。

谨慎点：

1. 自动修改 Windows Terminal settings.json 前必须提示用户确认。
2. 修改前应备份原配置。
3. 如果 settings.json 格式异常，不能覆盖，应提示用户手动配置。

## 7. 分阶段实现路线

### v0.2：ai-ssh + profile

目标：提供稳定的外部终端启动入口。

能力：

1. 完善 `ai-ssh`。
2. 支持 `ai-ssh user@host -p 22`。
3. 支持 `ai-ssh --profile profileName`。
4. 在 UI 中展示可复制的启动命令。
5. 生成 Windows Terminal profile JSON 片段。
6. 在 README 中提供 Xshell/MobaXterm 外部工具配置说明。

验收：

1. Windows Terminal 可以通过 profile 启动 `ai-ssh`。
2. Xshell/MobaXterm 可以配置外部工具调用 `ai-ssh`。
3. 不影响 AI Shell Assistant 内置 SSH 执行能力。

### v0.3：选中文本分析

目标：让用户能把外部终端输出交给 AI 分析。

能力：

1. 增加本地入口：`ai-shell-assistant.exe --analyze-clipboard`。
2. 支持从剪贴板读取终端输出。
3. AI 面板展示“来自剪贴板”的分析任务。
4. 基于选中文本生成下一条建议命令。
5. 支持复制建议命令到剪贴板。

验收：

1. 用户在 Xshell/MobaXterm 中复制报错后，可以一键打开 AI 分析。
2. AI 建议仍经过本地风险识别。
3. blocked/high 规则仍然生效。

### v0.4：侧边栏联动

目标：提供更接近“外部终端 + AI 面板”的体验。

候选能力：

1. AI Shell Assistant 以小窗或侧边栏模式打开。
2. 通过本地 WebSocket、Named Pipe 或本地 HTTP loopback 接收外部工具请求。
3. 外部终端脚本只负责发送剪贴板文本、会话名称或用户手动填写的 host。
4. AI 面板维护跨终端的任务历史和建议命令。
5. 可选支持“复制命令并聚焦终端”，但不承诺所有终端可用。

验收：

1. 外部终端输出可以稳定进入 AI Shell Assistant。
2. AI Shell Assistant 可以保持任务上下文。
3. 用户仍然明确确认每一步命令。

## 8. 风险和限制

### 8.1 技术限制

1. 不同终端脚本能力差异大，不能用同一套深度插件覆盖所有终端。
2. 剪贴板方式简单可靠，但无法验证文本来源。
3. 外部终端可能无法稳定获取 cwd、host、user、shell 类型。
4. `ai-ssh` 依赖系统 OpenSSH；如果未安装，需要提示用户使用内置客户端。
5. Windows Terminal profile 自动写入需要小心处理 JSON 格式和用户已有配置。

### 8.2 安全风险

1. 外部终端执行不一定经过 AI Shell Assistant 的主进程，因此建议命令默认只复制，不自动执行。
2. 不能允许 blocked 命令通过外部适配绕过。
3. 高风险命令必须在 AI Shell Assistant 中完成二次确认。
4. 剪贴板可能包含 token、password、secret，需要在发送给模型前脱敏。
5. 外部工具调用本地分析入口时，应避免把敏感文本写入命令行参数，优先使用剪贴板或本地 IPC。

### 8.3 产品限制

1. Xshell/MobaXterm 深度联动可能需要用户手动配置。
2. 不同版本菜单和脚本入口可能不同，文档需要按版本维护。
3. 第一版适配应定位为“辅助入口”，而不是完整插件生态。
4. 对 Linux 小白来说，最稳定体验仍然是 AI Shell Assistant 内置客户端。

## 9. 推荐优先级

最先做：

1. 完善 `ai-ssh` 和 Windows 安装包中的命令入口。
2. 在 AI Shell Assistant 中生成 Windows Terminal profile 片段。
3. 提供 Xshell/MobaXterm 外部工具配置文档。
4. 增加“复制建议命令”与“从剪贴板分析”能力。

暂缓：

1. 原生 Xshell 插件。
2. 原生 MobaXterm 插件。
3. 自动读取所有外部终端会话状态。
4. 自动把高风险命令粘贴并执行。
