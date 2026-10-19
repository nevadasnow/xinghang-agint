# 守岸人 · 星海陪伴终端

基于 Electron + React + TypeScript 的桌面 AI 陪伴终端。主题参考《鸣潮》守岸人（深海夜空 × 海蓝光效 × 紫罗兰 × 星光白）。

## 快速开始

```bash
# 1. 安装依赖（首次）
npm install

# 2. 开发模式启动（热更新）
npm run dev

# 3. 构建并启动
npm run build
npm start
```

## 配置模型接口

打开应用后，在「首页右上角设置」或「对话页左下角模型设置」中填写：

| 能力 | 说明 |
| --- | --- |
| 服务商预设 | DeepSeek / 豆包（火山方舟）/ 通义千问 / 智谱 GLM / MiniMax / Kimi / 自定义（参照 Shorekeeper 厂商注册表） |
| 接口地址 | OpenAI 兼容 Base URL，选择预设后自动填充 |
| API Key | 你的模型服务 API Key（可显隐） |
| 连接并获取模型 | 填入 Endpoint 与 Key 后一键完成两件事：① 从 `{baseURL}/models` 拉取模型列表（兼容 OpenAI 标准格式与阿里云 MaaS 网关分页格式）；② 自动测试聊天接口（发最小请求），一次点击同时验证「列表连通 + 聊天可用」，支持「刷新列表」 |
| 从列表选择 | 获取到的模型下拉（N 个可选），选择后自动写入下方 MODEL ID |
| MODEL ID（可手填） | 可手填任意模型名（如网关不开放 /models 端点时），与列表选择联动 |
| 测试连接 | 已合并进「连接并获取模型」，无需单独点击 |

> **阿里云 MaaS 网关说明**：若接口地址以 `…/api/v1` 结尾（DashScope 原生模式，不支持 `/chat/completions`），应用会自动回退到同 host 的 `…/compatible-mode/v1`（OpenAI 兼容模式）进行聊天与测试，无需手动改地址。
| 模型档案 | 可保存多套配置（名称 + 厂商 + 模型），一键加载 / 设为默认（★）/ 删除，同凭据自动去重 |
| 高级参数 | 请求超时（30–1800s）、最大重试次数（0–10）、上下文窗口 tokens |

未配置接口时自动进入演示模式（本地示例回复），界面可完整体验。

## 功能

- 首页：品牌欢迎区 + 三种模式入口（聊天 / 代码 / 工作）
- 对话页：左侧会话列表 + 模式切换；右侧消息流 + 底部输入框
- 多模式提示词：每个模式注入不同的 system prompt（守岸人基础人格 + 模式说明）
- 提示词资产化：人格 / 身份 / 模式规则 / 风格 / 世界观分层存放于 `src/main/prompts/*.md`（参照 Shorekeeper 的 prompts 体系），构建时打包进主进程
- 会话持久化：对话保存在 `%APPDATA%/shorekeeper-agent/data.json`
- 模型接入：OpenAI 兼容接口，主进程发起请求，API Key 不出渲染层

## Agent 能力 · 工具开关（复刻 Shorekeeper）

入口：设置弹窗 →「Agent 能力 · 工具开关」→「打开工具开关」。参照 Shorekeeper 的 ToolToggleSettingsPanel 复刻：

- **四个模式页签**：工作 Work / 代码 Code / 学习 Learn / 聊天 Chat，按模式管理守岸人可调用的工具。
- **总开关语义**：默认启用全部已注册工具（共 92 个），可逐个关闭；关闭后运行时按当前模式过滤，被关闭的工具不会注入提示词、不会进入模型 function calling。
- **聊天增强开关**：聊天页签顶部「聊天工具增强」，默认关闭——关闭时聊天模式只暴露 Shorekeeper 的 chatBuiltin 内置集（联网搜索 / 读取网页 / 天气 / 汇率 / 翻译等 19 个）；开启后其余工具也可按工具开关逐个 opt-in。
- **持久化**：开关状态写入 `%APPDATA%/shorekeeper-agent/config.json` 的 `toolModeOverrides` 与 `chatToolsEnabled`，即点即存。
- **运行时注入**：发送消息时，主进程把「当前模式可用工具目录」追加进 system prompt，并把启用工具转换为 OpenAI function calling 的 `tools` 参数；模型调用工具时由主进程执行并回填结果（最多 8 轮工具调用；模型不支持 tools 时自动降级纯文本重试）。
- **实现情况**：核心工具已实现真实执行——联网搜索、读取网页、下载文件、读取图片 URL、执行命令（危险命令有拦截）、后台任务、运行验证、安装 MCP 服务器、天气、文件读写/编辑/搜索/补丁、Git 族（需 cwd 指向仓库）、翻译（复用已配置模型）、历史回忆、记账。Shorekeeper 专属后端工具（音乐、浏览器面板、朋友圈、知识库、维基、Obsidian、游戏代肝、MCP 等）完整注册了元数据与开关 UI，执行时返回「未接入」占位说明，接入对应后端后即可启用。

## 提示词体系（参照 Shorekeeper prompts 资产结构）

人格与规则分层存放，改文案只需要编辑对应 `.md` 文件，然后 `npm run build` 重新构建即可。

```
src/main/prompts/
  soul.md            # 人格内核：守岸人如何感受、判断、爱人与组织表达（核心）
  harness.md         # 执行人设：每轮 LLM 调用都带的精简人设与表达边界
  chat_identity.md   # 聊天模式身份定位
  code_identity.md   # 代码模式身份定位
  work_identity.md   # 工作模式身份定位
  chat_system.md     # 聊天模式系统规则（模式职责 / 技术身份 / 事实边界）
  code_system.md     # 代码模式系统规则（任务正确性优先 / 代码质量）
  work_system.md     # 工作模式系统规则（交付要求 / 事实区分）
  styles.md          # 默认风格：沉静温柔（自称、停顿、语气词、意象克制）
  worldbook.md       # 触发式世界观：黑海岸 / 蝴蝶 / 泰缇斯 / 自我形象等条目
```

组装顺序（`src/main/prompts.ts` 的 `buildSystemPrompt(mode)`）：

```
harness（执行人设）→ identity（模式身份）→ system（模式规则）→ styles（风格）→ soul（人格内核）→ worldbook（世界观）
```

- `soul.md` 定义「守岸人如何成为自己」；具体经历只由 WorldBook 与记忆注入，不得编造。
- 模式差异通过 identity + system 注入：聊天侧重陪伴，代码侧重正确性，工作侧重结构化交付。
- 修改任何提示词后，执行 `npm run build` 重启应用生效。

## 项目结构

```
src/
  main/           # Electron 主进程（窗口、IPC、LLM 调用、会话存储）
    index.ts      # 窗口创建 + IPC 注册（含 tools:* IPC）
    llm.ts        # OpenAI 兼容接口调用（含 function calling 工具循环）
    tools.ts      # 工具注册表 + 模式过滤 + 工具目录注入（复刻 Shorekeeper ToolRegistry）
    store.ts      # 会话 / 配置 JSON 持久化
    prompts.ts    # 模式 system prompt 组装（读取 prompts/ 资产）
    prompts/      # 提示词资产（soul / harness / identity / system / styles / worldbook）
    md-modules.d.ts   # .md 资产模块类型声明
  preload/        # contextBridge 安全桥接
  shared/         # 主进程与渲染层共享类型
  renderer/       # React 界面
    src/pages/    # 首页 Home、对话页 Chat
    src/components/  # 蝴蝶标志、模式切换、设置弹窗、工具开关（ToolSettingsModal）
```

## 技术栈

Electron 33 · electron-vite · React 18 · TypeScript 5 · Vite 5

## 后续迭代方向

- 流式输出（SSE）
- Agent 工具循环（读文件 / 跑命令）
- Skills 技能系统（SKILL.md 发现式）
- 插件运行时（manifest + 工具注册）
- 长期记忆与 RAG
