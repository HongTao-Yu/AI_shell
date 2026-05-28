# AI Shell Assistant

AI Shell Assistant 是一个面向 Windows 桌面的 Linux AI 命令行助手。v0.1 的目标是让用户配置 Linux 服务器、输入自然语言任务，由 AI 每次生成一条可解释、可确认、带风险等级的 Linux 命令，并在用户接纳后通过 SSH 执行。

当前已完成工程骨架、本地服务器配置保存与读取、SSH 测试连接、手动单条命令执行、OpenAI Compatible API 生成下一条命令建议、命令风险识别与执行前拦截、“接纳并执行 -> 结果反馈 -> 生成下一步”的任务闭环，以及基础环境上下文采集。

## 技术栈

- Electron
- React
- TypeScript
- Node.js
- Vite
- ssh2
- OpenAI Compatible API

## 安装依赖

```bash
npm install
```

如果遇到 `Electron failed to install correctly`，通常是 Electron 二进制下载不完整。可以配置镜像后重新安装：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

## 启动开发环境

```bash
npm run dev
```

启动后会打开 Electron 桌面窗口。顶部填写服务器配置，左侧可以测试 SSH 连接并执行一条手动命令，右侧可以配置模型并生成下一条命令建议。

## 构建

```bash
npm run build
```

## 类型检查 / Lint

```bash
npm run lint
```

当前 lint 先使用 TypeScript 编译检查占位，后续可以接入 ESLint。

## 环境变量

复制 `.env.example` 为 `.env`，按需填写 OpenAI Compatible API 配置。不要把真实 API Key 提交到代码仓库。

```bash
cp .env.example .env
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

## 服务器配置

开发环境启动后，可以在窗口顶部填写默认 Linux 服务器信息：

- 名称
- 主机地址
- SSH 端口
- 用户名
- 密码
- 私钥路径，可选

点击“保存配置”后，配置会通过 Electron IPC 写入应用的 `userData` 目录下的 `config.json`。应用下次启动时会自动读取上次保存的默认服务器配置。

当前阶段只保存一台默认服务器。密码会保存在本地 JSON 文件中，代码不会把密码打印到控制台日志；后续正式版本建议接入 Windows Credential Manager 或系统密钥链。

## 模型配置

右侧 AI 面板中可以填写 OpenAI Compatible API 参数：

- Base URL，例如 `https://api.openai.com/v1`
- API Key
- Model，例如 `gpt-4.1-mini` 或你的供应商提供的模型名

点击“保存模型”后，配置会保存到本地 `config.json` 的 `modelConfig` 字段。代码不会把 API Key 打印到控制台日志。`.env.example` 只作为配置项命名参考，当前桌面端优先使用界面中保存的模型配置。

## AI 命令建议

保存模型配置后，在“自然语言任务”中输入目标，例如：

```text
帮我查看当前目录
```

点击“生成下一条命令”，应用会调用 `${baseUrl}/chat/completions`，要求模型只返回结构化 JSON：

```json
{
  "step_title": "检查当前目录",
  "command": "pwd",
  "reason": "确认当前所在目录，后续命令需要基于该目录执行。",
  "risk_level": "low",
  "expected_result": "输出当前工作目录。",
  "done": false
}
```

如果模型返回 Markdown 代码块或夹杂额外说明，应用会尝试提取 JSON 对象；如果仍无法解析，会在 AI 面板显示清晰错误。模型返回的 `risk_level` 只作为参考，应用会使用本地风险模块重新判断风险等级。

AI 生成命令后，点击“接纳并执行”会通过 SSH 执行该命令。`blocked` 命令会显示“已拦截”，不能点击执行；`high` 命令会在执行前弹出二次确认。

## AI 任务闭环

右侧 AI 面板现在使用主进程中的任务状态机：

1. 填写服务器配置和模型配置。
2. 在“自然语言任务”中输入目标，例如“帮我查看当前目录”。
3. 点击“开始任务”，应用会创建任务并规划第一条命令。
4. 查看命令卡片，点击“接纳并执行”。
5. 主进程通过 SSH 执行命令，并记录 `stdout`、`stderr`、`exitCode`、`durationMs`、`cwd`。
6. 点击“生成下一步”，应用会把用户目标、历史命令、`stdout_tail`、`stderr_tail`、`exit_code` 和当前 `cwd` 一起发送给模型，让模型基于真实执行结果继续规划。

任务状态包括 `idle`、`planning`、`waiting_approval`、`executing`、`observing`、`completed`、`failed`、`stopped`。当前阶段不会自动连续执行多条命令，每一步都必须由用户确认。

## 上下文采集

任务开始时，主进程会通过 SSH 执行低风险命令采集基础上下文，并在每次命令执行后根据 `cwd_after` 刷新上下文。采集失败不会导致整个任务失败，错误会记录在任务上下文中供排查。

采集字段：

- `cwd`：当前工作目录。
- `uname`：`uname -a` 的系统信息。
- `username`：`whoami` 的结果。
- `shell`：远端 `$SHELL`。
- `directoryListing`：当前目录 `ls -la` 输出尾部。
- `gitBranch` / `gitStatus`：当前目录 Git 分支和简短状态，失败时忽略。
- `projectFiles`：只检测特征文件名，例如 `README.md`、`requirements.txt`、`pyproject.toml`、`package.json`、`pom.xml`、`build.gradle`、`CMakeLists.txt`、`docker-compose.yml`、`Dockerfile`。
- `projectTypeGuess`：根据特征文件猜测 Python、Node.js、Java、CMake 或 Docker 项目。

AI prompt 会带上这些上下文，因此在项目目录下更容易先建议 `cat README.md`、检查 `requirements.txt` 或查看 `package.json`。

验证 cwd 更新：

1. 启动任务后查看右侧“当前 cwd”。
2. 让 AI 或手动任务步骤执行 `cd /tmp`。
3. 执行完成后右侧“当前 cwd”和历史步骤中的 `cwd` 应尽量更新为 `/tmp`。
4. 再点击“生成下一步”，AI 会收到新的 cwd。

敏感信息保护：

- 上下文采集只检测特征文件是否存在，不读取 README 以外的任何文件内容；当前阶段不会自动读取 `.env`、私钥、token、secret、password 文件。
- 目录列表和 Git 状态发送给模型前会过滤包含 `.env`、私钥、token、secret、password 等敏感名称的行。
- 不执行删除、写盘、停服务、安装依赖等高风险命令来采集上下文。

## SSH 命令执行

1. 启动应用：`npm run dev`。
2. 在顶部填写真实 Linux 服务器配置并点击“保存配置”。
3. 在左侧点击“测试连接”。
4. 测试成功后输入命令并点击“执行命令”。

推荐测试命令：

```bash
pwd
ls -la
whoami
not-a-real-command
sleep 35
```

`not-a-real-command` 应返回非 0 `exit_code` 和 stderr。`sleep 35` 可以配合默认 30 秒超时验证超时错误。

## 远端 Agent 自动安装

左侧终端区域提供 “Remote Agent” 面板，可以通过当前保存的 SSH 服务器配置，把一个最小 shell 版远端 Agent 安装到普通用户目录：

```text
~/.ai-shell-assistant/
  bin/ai
  logs/
  sessions/
  config.json
```

安装流程：

1. 通过 SSH 连接远端 Linux。
2. 执行 `mkdir -p ~/.ai-shell-assistant/bin ~/.ai-shell-assistant/logs ~/.ai-shell-assistant/sessions`。
3. 通过 SFTP 上传 `ai` shell 脚本到 `~/.ai-shell-assistant/bin/ai`。
4. 执行 `chmod +x ~/.ai-shell-assistant/bin/ai`。
5. 创建远端 `config.json`。
6. 如果勾选更新 shell 配置，会先备份 `~/.bashrc` 到 `~/.bashrc.ai-shell-assistant.bak`，再写入带明显标记的 PATH 块：

```bash
# >>> AI Shell Assistant >>>
export PATH="$HOME/.ai-shell-assistant/bin:$PATH"
# <<< AI Shell Assistant <<<
```

安装后可在远端执行：

```bash
~/.ai-shell-assistant/bin/ai doctor
```

`ai doctor` 会输出当前用户、当前 shell、安装路径、PATH 状态和最近日志路径。重复安装会先删除旧标记块再写入，不会重复污染 `~/.bashrc`。

卸载会删除 `~/.ai-shell-assistant`，并从 `~/.bashrc` 中删除 AI Shell Assistant 标记块。当前实现不要求 root 权限，不安装系统依赖，不修改 `/usr/bin` 或 `/usr/local/bin`。

## 任务历史与本地日志

AI 任务会保存到 Electron `userData` 目录下的 `task-history.json`。可以在右侧“历史任务”入口查看最近任务、服务器名称/host、最终状态、每一步命令建议和执行结果摘要。

历史记录保存内容：

- 任务：`id`、用户目标、服务器 `name/host`、`createdAt`、`updatedAt`、最终状态、当前 `cwd`。
- 步骤：命令、原因、风险等级、预期结果、状态、`exit_code`、`durationMs`、`cwd`。
- 输出：只保存 `stdoutTail` 和 `stderrTail`，每项最多保留尾部约 4000 字符。

隐私与脱敏策略：

- 不保存 SSH 密码、私钥内容、模型 API Key。
- 写入历史前会对 `api key`、`token`、`password`、`secret`、`private key`、Bearer Token、常见云访问密钥和私钥块进行脱敏。
- 历史持久化失败不会中断任务执行。

## 命令安全策略

应用会在主进程执行 `analyzeCommandRisk(command)`，手动命令和 AI 建议命令都会经过本地风险识别。主进程在真正 SSH 执行前再次校验，不能只依赖前端状态或模型返回值。

风险等级：

- `low`：低风险查询命令，例如 `ls -la`、`pwd`、`cat README.md`、`grep`、`find`、`which python`、`python --version`、`df -h`。
- `medium`：会安装依赖、拉取镜像或启动服务的命令，例如 `pip install -r requirements.txt`、`apt install`、`yum install`、`npm install`、`docker pull`、`systemctl restart`。
- `high`：会删除路径、改权限、停服务或卸载包的命令，例如 `rm -rf build`、`chmod -R 777`、`chown -R`、`kill -9`、`systemctl stop`、`docker system prune`、`kubectl delete`、`pip uninstall`。执行前需要二次确认。
- `blocked`：默认禁止执行的高危命令，例如 `rm -rf /`、`rm -rf /*`、`mkfs`、`dd if=`、`fdisk`、`parted`、`> /dev/sda`、`:(){ :|:& };:`。

风险等级测试命令：

```bash
ls -la
pip install -r requirements.txt
rm -rf build
rm -rf /
```

## ai-ssh 命令行包装器

项目提供了一个最小可用的 `ai-ssh` 辅助入口，用于后续适配 Windows Terminal、Xshell、MobaXterm 等外部终端。它会优先读取 AI Shell Assistant 保存在 Electron `userData` 目录下的本地 `config.json`，然后调用系统自带的 `ssh` 命令发起普通 SSH 连接。

构建 CLI：
```bash
npm run build:cli
```

查看帮助：
```bash
npm run ai-ssh -- --help
```

直接连接：
```bash
npm run ai-ssh -- user@host -p 22
```

使用已保存的服务器配置：
```bash
npm run ai-ssh -- --profile default
```

如果系统找不到 `ssh` 命令，`ai-ssh` 会提示安装 Windows OpenSSH Client，或者改用 AI Shell Assistant 内置客户端。当前版本不会代理 PTY、不接管终端输入输出，也不会实现 Xshell/MobaXterm 深度插件；外部终端后续可把启动命令配置为 `ai-ssh user@host -p 22`。

## 当前阶段能力

- Electron 主进程可启动。
- React 渲染进程可显示主界面。
- 默认服务器配置可保存到本地 JSON，并可在下次启动时恢复。
- SSH 逻辑在 Electron 主进程中执行，renderer 只通过 preload 暴露的安全 IPC API 调用。
- 支持 password 登录。
- 支持读取 `privateKeyPath` 指向的私钥文件；如果同时填写密码，会作为私钥 passphrase 使用。
- 支持执行一条手动输入的命令。
- 返回并展示 `stdout`、`stderr`、`exitCode`、`durationMs`、`startedAt`、`finishedAt`。
- 命令失败或超时会返回结构化结果，不会让应用崩溃。
- 支持保存模型配置并调用 OpenAI Compatible `/chat/completions`。
- 支持将模型返回的结构化 JSON 展示为命令建议卡片。
- 支持本地命令风险识别，`blocked` 命令禁止执行，`high` 命令需要二次确认。
- 支持 AI 建议命令由用户点击“接纳并执行”后通过 SSH 执行。
- 支持任务历史步骤展示，并在“生成下一步”时把历史执行结果反馈给 AI。
- 支持任务开始和命令执行后采集基础环境上下文，并在 UI 中展示当前 cwd、项目类型猜测和特征文件。

## 暂未实现

- 内置交互式 SSH 终端。
- Xshell / MobaXterm 深度插件。
- 企业账号系统。
- 云端后端。
- 远端 Linux Agent 自动安装。
