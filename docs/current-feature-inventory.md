# Vibe Reading 当前功能盘点

> 梳理日期：2026-04-28  
> 范围：基于当前仓库源码、IPC、页面组件、主进程服务和现有测试脚本整理。

## 1. 项目定位

Vibe Reading 当前实现的是一个 Electron 桌面论文阅读与研究工作台。它把论文搜索、下载入库、PDF 阅读、批注笔记、阅读问答、单篇论文分析、主题追踪和外部入口触发分析串在同一个本地工作区里。

技术栈与运行形态：

- 桌面壳：Electron + electron-vite。
- 前端：React 18 + React Router。
- PDF 阅读：`@react-pdf-viewer/*` + `pdfjs-dist`。
- Agent 编排：基于 `@langchain/core` 的本地 Pipeline Runtime。
- 数据存储：本地文件系统 JSON + PDF 文件，不依赖数据库。

## 2. 顶层应用能力

### 2.1 桌面应用启动与全局壳层

已实现能力：

- 启动 Electron 主窗口，开发环境加载 Vite，生产环境加载构建后的静态页面。
- 初始化本地工作区。
- 注册主进程 IPC，并通过 preload 暴露 `window.desktopApi`。
- 提供左侧导航、顶部统计、页面路由和全局通知。
- 支持侧边栏收起/展开。
- 支持阅读页错误边界，避免 PDF 页面异常导致整个应用白屏。

主要入口：

- `src/main/index.ts`
- `src/main/ipc/registerIpcHandlers.ts`
- `src/preload/index.ts`
- `src/renderer/src/App.tsx`

### 2.2 页面导航

当前导航包含 5 个主要页面：

- 论文库：管理已入库论文。
- 搜索：跨来源搜索并下载论文。
- 阅读：打开 PDF、保存进度、批注、笔记和阅读问答。
- 工作台：承载单篇分析和主题追踪。
- 设置：管理工作区路径、界面偏好、外部接入和 AI 模型配置。

## 3. 工作区与设置

### 3.1 本地工作区初始化

已实现能力：

- 首次启动自动创建本地工作区目录。
- 自动创建基础配置和数据文件。
- 工作区目录分为：
  - `papers`：PDF 文件。
  - `metadata`：论文索引、阅读索引、主题订阅等元数据。
  - `notes`：阅读会话、批注、笔记。
  - `analyses`：单篇分析报告、主题报告。
  - `tasks`：Agent 任务、主题历史、外部入口请求与回调。
  - `cache`：预留缓存目录。
- 支持保存用户修改后的目录配置，并保证新目录存在。

主要实现：

- `src/main/workspace/WorkspaceService.ts`

### 3.2 设置页

已实现能力：

- 配置默认主题：跟随系统、深色、浅色。
- 配置全局字体大小，范围为 12 到 18，并在前端即时预览。
- 配置默认模型标识。
- 编辑各工作区目录路径。
- 调起系统目录选择器。
- 配置外部接入标题和入口地址。
- 配置 AI 模型提供方、兼容接口地址、模型名和 API Key。
- API Key 支持显示/隐藏。

当前限制：

- AI 模型配置已用于阅读器问答：配置 OpenAI Compatible 接口后，阅读问答会优先调用真实模型；未配置或调用失败时降级为本地上下文兜底回答。
- 主题配置和路径切换依赖当前服务实例中的目录对象，已保存配置会影响后续启动和部分后续落盘，运行中已有服务实例不会整体重建。

## 4. 论文搜索与入库

### 4.1 跨来源论文搜索

已实现能力：

- 支持关键词搜索论文。
- 支持选择来源：
  - 全部来源。
  - arXiv。
  - OpenAlex。
  - CVF Open Access。
- 搜索结果统一展示标题、作者、摘要、来源、发布时间、开放获取状态和原文链接。
- `all` 模式会并行调用多个 Provider。
- 聚合搜索具备容错：只要至少一个来源成功，就会返回成功来源的结果。
- 结果按发布时间倒序排列。
- 单次 limit 会被限制在 1 到 20 之间。

主要实现：

- `src/renderer/src/SearchPage.tsx`
- `src/main/papers/search/PaperSearchService.ts`
- `src/main/papers/search/providers/ArxivSearchProvider.ts`
- `src/main/papers/search/providers/OpenAlexSearchProvider.ts`
- `src/main/papers/search/providers/CvfOpenAccessSearchProvider.ts`

### 4.2 论文入库与 PDF 下载

已实现能力：

- 搜索结果可一键“下载并入库”。
- 如果搜索结果包含 PDF URL，会下载 PDF 到本地 `papers` 目录。
- 同时写入单篇论文元数据文件和论文索引文件。
- 支持重复导入同一论文，表现为重新下载并同步元数据。
- 为论文生成默认标签。
- 根据是否有 PDF 标记状态：
  - 有 PDF：`downloaded`。
  - 无 PDF：`metadata-only`。

主要实现：

- `src/main/papers/PaperService.ts`

当前限制：

- 当前没有手动导入本地 PDF 的入口。
- 删除论文会删除论文记录和本地 PDF，但不会级联清理该论文已生成的阅读会话、分析报告等相关文件。

## 5. 论文库

已实现能力：

- 展示论文库统计：
  - 总数。
  - 已下载。
  - 重点关注。
  - 已归档。
  - 顶部还展示已索引、阅读记录等全局指标。
- 支持多维筛选：
  - 关键词。
  - 来源。
  - 标签。
  - 发布时间范围：全部、近 1 年、近 3 年、近 5 年。
  - 阅读状态。
  - 分析状态。
- 已归档论文默认不显示在论文列表中。
- 论文卡片可折叠/展开。
- 有本地 PDF 的论文可点击标题进入阅读器。
- 支持删除单篇论文。
- 论文列表排序优先收藏，其次按更新时间倒序。

主要实现：

- `src/renderer/src/App.tsx` 中的 `LibraryPage` 和 `LibraryPaperCard`
- `src/main/papers/PaperService.ts`

当前限制：

- 页面中已有状态和标签数据模型，但当前论文库卡片没有完整提供收藏、归档、标签编辑、阅读状态编辑等所有写操作入口。

## 6. PDF 阅读器

### 6.1 PDF 打开与阅读进度

已实现能力：

- 只展示已有本地 PDF 的论文。
- 支持从论文库跳转到指定论文阅读。
- 支持在阅读页左侧论文列表切换论文。
- 支持读取本地 PDF 并以 base64 传给渲染层显示。
- 支持页码变化、缩放变化、总页数加载后保存阅读进度。
- 阅读进度包含：
  - 当前页。
  - 总页数。
  - 缩放比例。
  - 完成度。
  - 最后位置。
- 进度写入阅读索引和单篇阅读会话。
- 阅读页侧边检查器支持显示/隐藏、宽度拖拽调整，并把宽度写入 localStorage。

主要实现：

- `src/renderer/src/ReaderPage.tsx`
- `src/main/reader/ReaderService.ts`

### 6.2 高亮批注

已实现能力：

- 支持在 PDF 中选择文本后创建高亮批注。
- 支持高亮颜色：
  - yellow。
  - blue。
  - pink。
  - mint。
- 批注保存内容包括页码、摘录文本、备注、颜色和高亮区域坐标。
- 支持批注更新、删除。
- 支持点击批注跳转到对应页。
- 支持页边批注卡片：
  - 左右列展示。
  - 拖拽调整位置。
  - 折叠/展开。
  - 连接线指向正文高亮区域。
  - 位置保存在 localStorage。
- 支持把批注拖到 AI 提问入口，基于批注内容发起阅读问答。

### 6.3 阅读笔记

已实现能力：

- 支持在阅读器侧栏编辑并保存笔记。
- 笔记以条目形式追加。
- 支持删除指定笔记条目。
- 笔记会进入阅读问答和单篇分析的上下文。

### 6.4 阅读问答

已实现能力：

- 支持围绕当前论文发起问答。
- 回答会结合：
  - 论文标题。
  - 论文摘要。
  - 当前页码。
  - 最近批注。
  - 阅读笔记。
- 支持多轮对话保存到阅读会话。
- 支持创建新的 AI 对话会话。
- 支持切换历史会话。
- 支持保存会话并自动生成标题。
- 问答结果会返回任务状态和时间线。
- 如果问题来自选区，问答后可把回答摘要自动形成关联批注。

主要实现：

- `src/main/reader/ReaderService.ts`
- `src/main/agents/AgentRuntimeService.ts`
- `src/renderer/src/ReaderPage.tsx`

当前限制：

- 阅读问答已支持调用设置页中的 OpenAI Compatible 模型；当前上下文仍主要来自摘要、批注、笔记、当前页码和历史对话，尚未真正解析 PDF 全文内容。
- PDF 文本选择与高亮依赖 `react-pdf-viewer` 的可选中文本层能力，扫描版 PDF 不会自动 OCR。

## 7. Agent Runtime

已实现能力：

- 定义统一 Agent 任务模型：
  - `idle`
  - `queued`
  - `running`
  - `completed`
  - `failed`
- 支持任务标题、阶段、摘要、元数据和时间线。
- 基于 LangChain `RunnableLambda` 编排多阶段 Pipeline。
- Pipeline 支持：
  - 阶段执行。
  - 任务状态更新回调。
  - 时间线更新。
  - 完成摘要。
  - 错误态任务。
- 当前注册 4 个 Agent：
  - 单篇论文分析 Agent。
  - 阅读问答 Agent。
  - 主题追踪 Agent。
  - Runtime 演示 Agent。

主要实现：

- `src/main/agents/AgentRuntimeService.ts`
- `src/main/agents/agentCatalog.ts`
- `src/main/agents/runtimeTypes.ts`

当前限制：

- Runtime 框架已打通，阅读问答已接入 OpenAI Compatible 模型配置；单篇分析和主题追踪多数输出仍是确定性规则和模板生成。

## 8. 单篇论文深度分析

### 8.1 分析执行

已实现能力：

- 工作台可选择论文执行单篇分析。
- 支持加载已有分析报告。
- 执行分析时会更新论文的分析状态：
  - queued。
  - running。
  - completed。
  - failed。
- 分析流程包含多个阶段：
  - 整理阅读上下文。
  - 联网检索增强。
  - 结构化输出完成。
  - 代码实验验证。
- 分析结果会保存到本地 `analyses/reports`，并在 `analysis-index.json` 建索引。
- 分析任务会写入统一任务文件，供工作台展示。

主要实现：

- `src/renderer/src/PaperAnalysisWorkbench.tsx`
- `src/main/analysis/PaperAnalysisService.ts`

### 8.2 分析内容结构

已实现的结构化章节：

- 研究动机。
- 核心难点。
- 研究现状。
- 方法介绍。
- 实验设置。
- 实验结果。

每个章节包含：

- 标题。
- 摘要。
- 要点。
- 证据说明。

分析上下文来源：

- 论文标题、摘要和元数据。
- 阅读器笔记。
- 阅读器批注。
- OpenAlex 相关工作检索结果。
- GitHub 候选代码仓库信息。

### 8.3 联网增强与代码验证记录

已实现能力：

- 使用 OpenAlex 检索相关工作线索。
- 尝试从论文链接、摘要或搜索结果中识别 GitHub 仓库。
- 读取 GitHub 仓库根目录，检测常见依赖文件：
  - `package.json`
  - `requirements.txt`
  - `pyproject.toml`
  - `environment.yml`
  - `Dockerfile`
- 基于依赖文件推断候选运行命令。
- 生成代码验证状态：
  - `not-found`：未找到仓库。
  - `blocked`：找到仓库但未自动执行。
  - `verified`：类型已预留，当前实现中不会真正自动执行第三方代码。

当前限制：

- 出于安全策略，当前不会自动 clone 或执行第三方仓库代码，只记录候选仓库、依赖、候选命令和阻塞原因。
- 联网增强依赖 OpenAlex 和 GitHub API，网络不可用或 API 限制时会降级为空结果。

### 8.4 分析追问

已实现能力：

- 可基于已有分析报告继续提问。
- 追问会按关键词匹配相关分析章节。
- 涉及“代码、实验、复现、运行、仓库”等关键词时，会补充代码验证信息。
- 问答历史会写回分析报告文件。

## 9. 主题订阅与聚合分析

### 9.1 主题订阅管理

已实现能力：

- 创建或更新主题订阅。
- 配置主题名称、检索词、描述、每日执行时间、启用状态、单次最大结果数。
- 删除主题订阅。
- 启用/停用主题。
- 展示主题订阅统计、报告数量、历史数量和调度器状态。

主要实现：

- `src/renderer/src/TopicTrackingWorkbench.tsx`
- `src/main/topics/TopicTrackingService.ts`

### 9.2 手动和定时执行

已实现能力：

- 可手动对单个主题执行聚合分析。
- 可手动强制运行一次调度器，执行全部启用主题。
- 应用启动时会启动主题调度器。
- 调度器每 60 秒检查一次到期主题。
- 主题每日按 `scheduleTime` 判断是否需要执行。
- 单个主题失败不会阻塞其他主题执行。

### 9.3 主题聚合报告

已实现能力：

- 执行主题时会：
  - 用主题检索词跨来源搜索论文。
  - 导入新论文并去重。
  - 选择主题相关论文。
  - 复用已有单篇分析结果。
  - 生成主题报告。
  - 更新订阅的最后执行时间、摘要、报告路径和论文集合。
- 主题报告包含：
  - 主题概览。
  - 高亮摘要。
  - 纳入论文。
  - 新增论文。
  - 论文摘要卡片。
  - 主题综述。
  - 方法脉络。
  - 共性难点。
  - 近期趋势。
  - 推荐阅读。
- 执行历史会保存状态、开始/结束时间、摘要、新增论文数和报告 ID。

当前限制：

- 聚合分析主要基于标题、摘要、标签和已有单篇分析，暂未做真正全文级主题建模。
- 每次主题报告会写入新文件，删除主题只清理最近一次报告路径。

## 10. 外部媒体接入

### 10.1 本地 HTTP 服务

已实现能力：

- 应用启动时尝试启动本地 HTTP 服务。
- 默认地址：`127.0.0.1:17860`。
- 如果启动失败，会降级为仅本地桌面模式。
- 支持协议查询接口：
  - `GET /external-media/protocols`
- 支持状态查询接口：
  - `GET /external-media/status?requestId=...`
- 支持飞书消息入口：
  - `POST /external-media/feishu/message`

主要实现：

- `src/main/integrations/ExternalMediaServer.ts`
- `src/main/integrations/ExternalMediaService.ts`

### 10.2 飞书论文分析入口

已实现能力：

- 接收飞书消息格式输入。
- 从消息中解析论文标题、关键词或链接。
- 支持中文和英文命令前缀：
  - 分析论文。
  - 论文分析。
  - 分析。
  - analyze。
  - paper analysis。
- 支持从 arXiv / OpenAlex 链接中提取查询词。
- 先尝试匹配本地论文库，找不到时自动搜索并导入论文。
- 定位论文后复用单篇论文分析服务。
- 持久化外部请求记录。
- 持久化状态回调记录：
  - accepted。
  - running。
  - completed。
  - failed。
- 返回 requestId、taskId、状态、摘要和回调记录。

当前限制：

- 当前是本地 HTTP 协议入口和模拟飞书消息处理，并未包含真实飞书机器人鉴权、签名校验、消息回发 API 调用。
- 设置页展示外部接入协议，但没有独立的外部请求调试页面。

## 11. 测试与验证

已实现能力：

- 提供 `npm run smoke` 冒烟脚本。
- 冒烟脚本使用临时工作区和 mock fetch 验证核心链路：
  - 工作区初始化。
  - Agent Runtime 演示。
  - 论文搜索。
  - 论文导入、更新、删除。
  - 阅读进度。
  - 批注。
  - 笔记。
  - 阅读问答。
  - 单篇分析。
  - 分析追问。
  - 主题订阅。
  - 主题聚合。
  - 调度器强制执行。
  - 外部媒体 HTTP 入口。
  - 外部状态查询。

主要实现：

- `scripts/smoke.ts`

可用脚本：

- `npm run dev`：启动开发环境。
- `npm run build`：构建应用。
- `npm run lint`：运行 ESLint。
- `npm run typecheck`：运行 TypeScript 类型检查。
- `npm run smoke`：运行核心链路冒烟测试。

## 12. 当前数据文件概览

当前应用主要通过本地文件持久化：

- `metadata/papers.json`：论文库索引。
- `metadata/papers/*.json`：单篇论文元数据。
- `metadata/reading.json`：阅读进度索引。
- `notes/reader-sessions/*.json`：单篇阅读会话、批注、笔记、问答。
- `analyses/analysis-index.json`：单篇分析索引。
- `analyses/reports/*.json`：单篇分析报告。
- `metadata/topic-subscriptions.json`：主题订阅。
- `analyses/topic-reports/*.json`：主题报告。
- `tasks/agent-tasks.json`：Agent 任务记录。
- `tasks/topic-history.json`：主题执行历史。
- `tasks/external-media-requests.json`：外部入口请求。
- `tasks/external-media-callbacks.json`：外部入口状态回调。

## 13. 功能完成度简表

| 模块 | 当前状态 | 说明 |
| --- | --- | --- |
| 桌面壳与路由 | 已实现 | Electron、React 路由、导航、通知、初始化已完成 |
| 工作区初始化 | 已实现 | 本地目录和 JSON 文件自动创建 |
| 设置页 | 基本实现 | 配置可落盘，阅读问答已使用 AI 模型配置 |
| 论文搜索 | 已实现 | arXiv、OpenAlex、CVF Open Access 三源接入 |
| 论文下载入库 | 已实现 | 可下载 PDF、写入元数据、去重同步 |
| 论文库筛选 | 已实现 | 支持关键词、来源、标签、时间、阅读状态、分析状态 |
| PDF 阅读 | 已实现 | 本地 PDF 显示、翻页、缩放、进度保存 |
| 高亮批注 | 已实现 | 支持选区高亮、颜色、备注、更新、删除、页边卡片 |
| 阅读笔记 | 已实现 | 支持追加和删除笔记条目 |
| 阅读问答 | 基本实现 | 会话、多轮、保存、引用已实现；优先调用模型，未配置时本地兜底 |
| 单篇论文分析 | 基本实现 | 结构化报告、联网增强、追问已实现；非真实 LLM 深度分析 |
| 代码验证 | 验证记录已实现 | 只定位仓库和推断命令，不自动执行第三方代码 |
| 主题追踪 | 已实现 | 订阅、手动执行、调度器、报告、历史已实现 |
| 外部飞书入口 | 协议链路已实现 | 本地 HTTP 接口和模拟飞书输入已实现，未接真实飞书鉴权 |
| 冒烟测试 | 已实现 | 覆盖主要服务链路 |

## 14. 后续优先补强建议

1. 继续扩大真实大模型调用范围，让同一套 AI 模型配置驱动单篇分析和主题报告生成。
2. 增加本地 PDF 手动导入能力，支持不经过在线搜索的论文入库。
3. 完善论文库卡片上的收藏、归档、标签编辑和状态编辑入口。
4. 增加删除论文时的关联数据清理策略，避免分析报告和阅读会话孤立残留。
5. 为外部媒体入口补真实飞书鉴权、签名校验和消息回发能力。
6. 为搜索 Provider 增加重试、限流、缓存和来源级配置。
7. 增加更多自动化测试，尤其是 ReaderService、TopicTrackingService 和 ExternalMediaService 的边界场景。
