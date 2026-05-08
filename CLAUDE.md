# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Vibe Reading 是一个基于 Electron 的桌面论文阅读器，支持论文搜索、PDF 阅读、批注、AI 问答、论文分析和主题追踪。

## 开发命令

```bash
npm run dev          # 启动 electron-vite 开发环境（主进程 + 渲染进程热更新）
npm run build        # 生产构建
npm run lint         # ESLint 代码检查
npm run typecheck    # TypeScript 类型检查（tsc --noEmit）
npm run smoke        # 运行冒烟测试脚本
```

## 技术栈

- **框架**: Electron + electron-vite
- **前端**: React 18 + TypeScript + react-router-dom (HashRouter)
- **PDF 渲染**: @react-pdf-viewer (基于 pdfjs-dist 3.x)
- **AI 编排**: @langchain/core (仅用 RunnableLambda 做 pipeline 编排，不涉及 RAG/向量库)
- **AI 模型调用**: 主进程直连 OpenAI-compatible API，支持 stream/non-stream
- **数据存储**: 纯本地 JSON 文件，无数据库

## 项目结构

```
src/
├── main/              # Electron 主进程
│   ├── index.ts               # 应用入口：创建窗口、初始化服务、注册 IPC
│   ├── ipc/registerIpcHandlers.ts  # 所有 IPC handler 注册（通过 ipcMain.handle）
│   ├── workspace/WorkspaceService.ts   # 工作区目录、配置文件管理
│   ├── papers/PaperService.ts          # 论文库 CRUD、PDF 下载、搜索
│   │   └── search/                     # 论文搜索：arXiv / OpenAlex / CVF
│   ├── reader/ReaderService.ts         # 阅读会话、批注、笔记、AI 问答
│   │   ├── PaperTextIndexService.ts    # PDF 文本索引（正文提取）
│   │   └── ReaderInternetContextService.ts  # 联网搜索上下文补充
│   ├── agents/AgentRuntimeService.ts   # Agent pipeline + Loop Agent 引擎
│   │   ├── agentCatalog.ts             # Agent 定义目录
│   │   ├── runtimeTypes.ts             # Pipeline 类型
│   │   ├── loopTypes.ts                # 自治循环类型：Action/Observation/LoopState
│   │   ├── specTypes.ts                # LoopAgentSpec — Agent 目标、planner、收敛策略
│   │   ├── toolTypes.ts                # AgentTool、AgentToolContext、AgentToolResult
│   │   ├── toolRegistry.ts             # 统一工具注册与白名单筛选
│   │   ├── tools/                      # 工具实现：commonTools、readerTools、internetTools
│   │   ├── planners/                   # actionParser + actionSchema — 模型输出解析
│   │   ├── guards/loopGuards.ts        # 循环守卫：步数限制、重复动作检测
│   │   ├── prompts/                    # Agent 系统提示词
│   │   └── specs/                      # 各 Agent 的 LoopAgentSpec 定义
│   ├── ai/AiModelClient.ts             # OpenAI-compatible API 客户端（chat + chatStream）
│   ├── analysis/PaperAnalysisService.ts  # 单篇论文结构化分析
│   ├── topics/TopicTrackingService.ts   # 主题订阅与定期聚合分析
│   └── integrations/                   # 外部接入（飞书 webhook server）
├── preload/index.ts   # contextBridge 暴露 desktopApi 给渲染进程
├── renderer/src/      # React 渲染进程
│   ├── App.tsx        # 根组件：路由、全局状态、AppShell 布局
│   ├── main.tsx       # ReactDOM 入口
│   ├── ReaderPage.tsx         # PDF 阅读器页面
│   ├── SearchPage.tsx         # 论文搜索页面
│   ├── PaperAnalysisWorkbench.tsx  # 论文分析工作台
│   ├── TopicTrackingWorkbench.tsx  # 主题追踪工作台
│   └── styles.css     # 全局样式（单一 CSS 文件）
└── shared/types.ts    # 主进程与渲染进程共享的所有 TypeScript 类型定义
```

## 架构要点

### 构建系统

electron-vite 将代码分为三个构建目标，配置在 `electron.vite.config.ts`：
- **main** — 主进程，使用 `externalizeDepsPlugin`（所有 node_modules 外部化）
- **preload** — preload 脚本，同样外部化依赖
- **renderer** — React 渲染进程，使用 `@vitejs/plugin-react`

生产输出在 `out/`（主进程 + preload）和 `dist/`（渲染进程），均被 `.gitignore` 忽略。

### 进程间通信

渲染进程通过 `window.desktopApi` 调用主进程，该对象由 preload 脚本通过 `contextBridge.exposeInMainWorld` 暴露。每个 API 方法对应一个 `ipcMain.handle` 注册的 channel。`DesktopApi` 接口（定义在 `shared/types.ts`）是通信契约——所有 IPC channel 都由此接口定义。

### 服务初始化链

`src/main/index.ts` 中的 `bootstrapDesktopApp()` 按依赖顺序初始化所有服务：

1. `WorkspaceService` — 工作区目录和配置
2. `AgentRuntimeService` — Agent pipeline 引擎
3. `PaperService` — 论文库
4. `ReaderService` — 阅读器（依赖 PaperService、AgentRuntimeService）
5. `PaperAnalysisService` — 论文分析（依赖 ReaderService）
6. `TopicTrackingService` — 主题追踪（依赖 PaperAnalysisService）
7. `ExternalMediaServer` — 外部接入 HTTP 服务

所有服务共享同一个 `WorkspaceDirectories` 对象，数据按功能分散到不同子目录（papers/、metadata/、notes/、analyses/、tasks/、cache/）。

### Agent 引擎（双重模式）

`AgentRuntimeService` 支持两种执行模式：

1. **Pipeline 模式** (`runPipeline<TData>()`) — 接受一组有序 stages，每个 stage 是一个 `run` 函数，通过 LangChain 的 `RunnableLambda` 串联。自动管理 task 状态流转（queued → running → completed/failed）和 timeline 记录。

2. **Loop Agent 模式** (`runLoopAgent<TGoal, TResult>()`) — 实现了 ReAct (Reasoning + Acting) 自治循环：
   - `LoopAgentSpec` 定义 Agent 的目标类型、最大步数、白名单工具、planner 提示词和结果收敛策略
   - 每步循环：planner 生成 `AgentAction`（thought + action + input）→ `actionParser` 解析模型输出 → 执行工具 → 工具结果回灌为 `AgentObservation`
   - `AgentToolRegistry` 管理所有可用工具，按白名单筛选后提供给 agent
   - `loopGuards` 执行步数限制和重复动作检测，防止无限循环
   - 循环终止条件：模型输出 `finalAnswer` 或触发 guard

Agent 定义统一放在 `agentCatalog.ts` 中，具体 Agent 的 spec 实现在 `specs/` 目录下。

### AI 模型连接

`AiModelClient` 直接调用 OpenAI-compatible `/chat/completions` 接口，支持非流式 (`chat`) 和 SSE 流式 (`chatStream`) 两种模式。流式响应通过 preload 中注册的 `ipcRenderer.on('reader:assistant-stream-event')` 事件推送到渲染进程。

### 数据持久化

所有数据以 JSON 文件存储在用户工作区目录下：
- `metadata/papers.json` + `metadata/papers/*.json` — 论文记录
- `metadata/reading.json` — 阅读进度索引
- `notes/reader-sessions/*.json` — 阅读会话（含批注、AI 对话）
- `analyses/*.json` — 论文分析报告
- `tasks/agent-tasks.json` — 任务记录
- `config.json` — 工作区配置

### 详细设计文档

`docs/` 目录包含以下参考文档，了解业务全貌或具体模块时建议先查阅：
- `current-feature-inventory.md` — 全部已实现功能盘点
- `pdf-index-and-rag-overview.md` — PDF 索引与 RAG 流程
- `current-architecture-overview.md` / `current-architecture-overview-v2.md` — 架构全景
- `search-module-detailed-design.md` — 搜索模块详细设计

## TypeScript 路径别名

tsconfig.json 中配置了三个别名：
- `@main/*` → `src/main/*`
- `@shared/*` → `src/shared/*`
- `@renderer/*` → `src/renderer/src/*`
