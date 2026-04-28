# Vibe Reading 架构梳理 v2

> 目标：为后续“逐功能详细修改”提供一份更适合工程改造的文档。  
> 相比 v1，这一版按 **页面 / 主进程服务 / 数据模型 / 修改影响面** 四个维度拆开。

## 1. 阅读指南

本文按下面顺序阅读最有效：

1. 先看 **页面拆分**
2. 再看 **主进程服务拆分**
3. 再看 **核心数据模型**
4. 最后看 **修改影响面清单**

如果后面要改某个功能，推荐顺序是：

- 先定位页面入口
- 再定位对应 IPC
- 再定位主进程 Service
- 最后确认涉及哪些 shared types

---

## 2. 页面拆分

### 2.1 App 壳层与全局状态

**页面 / 组件**
- `src/renderer/src/App.tsx`
- `App`
- `AppShell`
- `NavItem`
- `StateScreen`

**负责什么**
- 启动时拉取全局 bootstrap 数据
- 托管全局状态：
  - `bootstrap`
  - `library`
  - `topicTracking`
  - `agentResult`
  - `notice`
- 顶层路由分发
- 全局通知展示与自动关闭
- 把 desktop API 调用结果分发到各页面

**关键函数**
- `loadBootstrap`
- `handleRunAgent`
- `handleImportPaper`
- `handleUpdatePaper`
- `handleRemovePaper`
- `handleSaveWorkspaceConfig`

**依赖**
- `window.desktopApi.*`
- React Router
- 子页面：
  - `SearchPage`
  - `ReaderPage`
  - `PaperAnalysisWorkbench`
  - `TopicTrackingWorkbench`

**改这里会影响什么**
- 几乎所有页面
- 全局 notice
- bootstrap 数据刷新
- 路由切换逻辑

### 2.2 论文库页

**页面 / 组件**
- `src/renderer/src/App.tsx`
- `LibraryPage`
- `LibraryPaperCard`

**当前功能**
- 论文库概览统计
- 论文筛选
- 折叠 / 展开论文卡
- 点击标题进入阅读器
- 删除单篇论文
- 展示来源、发布时间、摘要、作者等核心信息

**关键状态**
- `query`
- `source`
- `tag`
- `readingStatus`
- `analysisStatus`
- `timeRange`

**主要交互**
- 标题点击进入 `/reader?paper=...`
- 折叠按钮切换卡片展开态
- 垃圾桶按钮删除论文

**依赖数据**
- `PaperLibraryPayload`
- `PaperRecord`

**对应主链路**
- Renderer → `desktopApi.getLibrary/updatePaper/removePaper`
- IPC → `paper:*`
- Main → `PaperService`

**改这里会影响什么**
- 论文展示结构
- 阅读器进入路径
- 论文元信息展示策略
- 论文库交互体验

### 2.3 搜索页

**页面 / 组件**
- `src/renderer/src/SearchPage.tsx`
- `SearchPage`
- `SearchSectionCard`
- `SearchStatusBadge`

**当前功能**
- 输入关键词搜索论文
- 选择来源
- 查看搜索结果
- 导入论文进论文库

**关键函数**
- `handleSearch`
- `handleImport`

**依赖数据**
- `PaperSearchInput`
- `PaperSearchResult`

**对应主链路**
- Renderer → `desktopApi.searchPapers/importPaper`
- IPC → `paper:search` / `paper:import`
- Main → `PaperService.search/importPaper`
- Search Provider：
  - arXiv
  - OpenAlex
  - CVF Open Access

**改这里会影响什么**
- 搜索体验
- 导入流程
- 搜索来源扩展方式
- 搜索结果字段展示

### 2.4 阅读器页

**页面 / 组件**
- `src/renderer/src/ReaderPage.tsx`
- `ReaderPage`
- `ReaderPdfPanel`
- `ReaderSidebar`
- `ReaderAssistantPanel`

**当前功能**
- 打开 PDF
- 记录阅读进度
- 保存笔记
- 保存批注
- 阅读问答
- 左侧论文列表切换
- 右侧浮动功能栏

**关键函数**
- `handleSaveNote`
- `loadPdfBinary`

**依赖数据**
- `ReaderSession`
- `ReaderProgressInput`
- `ReaderAnnotationInput`
- `ReaderAssistantInput`

**对应主链路**
- Renderer → `desktopApi.getReaderSession/saveReaderProgress/addReaderAnnotation/removeReaderAnnotation/saveReaderNote/askReaderAssistant`
- IPC → `reader:*`
- Main → `ReaderService`
- 阅读问答进一步依赖 `AgentRuntimeService.runReaderQaAgent`

**改这里会影响什么**
- 阅读体验
- 批注与笔记持久化
- 问答上下文质量
- PDF 工具栏与侧边栏布局

### 2.5 AI 工作台页

**页面 / 组件**
- `src/renderer/src/App.tsx`
- `AiWorkbenchPage`

**当前功能**
- AI 能力总览
- 最近任务摘要
- 单篇分析入口
- 主题订阅与聚合分析入口

**子模块**
- `src/renderer/src/PaperAnalysisWorkbench.tsx`
- `src/renderer/src/TopicTrackingWorkbench.tsx`

**改这里会影响什么**
- 工作台入口排布
- 任务摘要展示
- 单篇分析和主题分析两个子系统的 UI 编排

### 2.6 单篇论文深度分析

**页面 / 组件**
- `src/renderer/src/PaperAnalysisWorkbench.tsx`
- `PaperAnalysisWorkbench`
- `AnalysisSectionCard`
- `VerificationCard`
- `ConversationList`

**当前功能**
- 选论文
- 跑分析
- 查看已有分析
- 基于分析继续提问
- 展示章节 / 验证 / 对话

**关键函数**
- `handleRunAnalysis`
- `handleAskQuestion`
- `loadExistingReport`

**对应主链路**
- Renderer → `desktopApi.getPaperAnalysis/runPaperAnalysis/askPaperAnalysisQuestion`
- IPC → `analysis:*`
- Main → `PaperAnalysisService`

**改这里会影响什么**
- 分析输出结构
- 问答体验
- 代码验证展示
- 互联网检索引用展示

### 2.7 主题订阅与聚合分析

**页面 / 组件**
- `src/renderer/src/TopicTrackingWorkbench.tsx`
- `TopicTrackingWorkbench`
- `MetricChip`
- `TopicSubscriptionCard`
- `TopicReportCard`
- `TopicHistoryRow`

**当前功能**
- 创建 / 更新主题订阅
- 启停每日抓取
- 手动执行聚合分析
- 查看报告
- 查看执行历史
- 调度器状态展示

**关键函数**
- `handleSaveSubscription`
- `handleRunTopic`
- `handleRunScheduler`
- `handleDeleteTopic`
- `handleToggleEnabled`

**依赖数据**
- `TopicSubscription`
- `TopicTrackingSnapshot`
- `TopicAnalysisReport`
- `TopicExecutionHistory`

**对应主链路**
- Renderer → `desktopApi.saveTopicSubscription/deleteTopicSubscription/runTopicAnalysis/runTopicScheduler/getTopicTracking`
- IPC → `topic:*`
- Main → `TopicTrackingService`

**改这里会影响什么**
- 主题配置表单结构
- 调度规则
- 聚合分析报告结构
- 执行历史展示方式

### 2.8 设置页

**页面 / 组件**
- `src/renderer/src/App.tsx`
- `SettingsPage`
- `SectionCard`
- `SaveIcon`
- `FolderIcon`
- `EyeIcon`
- `EyeOffIcon`

**当前功能**
- 默认主题设置
- 默认模型标识设置
- 工作区路径编辑
- 调起系统目录选择器
- 外部接入配置
- AI 模型配置
- API Key 显示 / 隐藏

**关键函数**
- `handleSave`
- `handlePickDirectory`

**对应主链路**
- Renderer → `desktopApi.saveWorkspaceConfig/pickDirectory`
- IPC → `workspace:save-config` / `workspace:pick-directory`
- Main → `WorkspaceService`

**改这里会影响什么**
- 所有依赖工作区目录的服务
- 外部接入协议配置
- AI 模型配置来源
- 通知提示逻辑

---

## 3. 主进程服务拆分

### 3.1 WorkspaceService

**文件**
- `src/main/workspace/WorkspaceService.ts`

**职责**
- 初始化工作区目录
- 初始化配置文件
- 保证 `papers / metadata / notes / analyses / tasks / cache` 目录存在
- 保存设置页配置
- 维护当前工作区目录与配置对象

**核心方法**
- `ensureWorkspace`
- `getDirectories`
- `getConfig`
- `saveConfig`
- `ensureDirectories`
- `ensureConfig`
- `getWorkspaceFiles`

**依赖关系**
- 几乎所有主进程服务都依赖它输出的 `WorkspaceDirectories`

**变更风险**
- 高
- 改路径结构会连带影响：
  - `PaperService`
  - `ReaderService`
  - `PaperAnalysisService`
  - `TopicTrackingService`
  - `ExternalMediaService`

### 3.2 PaperService

**文件**
- `src/main/papers/PaperService.ts`

**职责**
- 维护论文库
- 搜索入口封装
- 导入论文
- 更新论文状态
- 删除论文
- 返回论文库 summary

**核心方法**
- `getLibrary`
- `getPaperById`
- `search`
- `importPaper`
- `updatePaper`
- `removePaper`

**依赖关系**
- 依赖 `WorkspaceDirectories`
- 依赖 `PaperSearchService`

**变更风险**
- 高
- 它是全文最核心的数据中枢之一

### 3.3 PaperSearchService 与 Providers

**文件**
- `src/main/papers/search/PaperSearchService.ts`
- `src/main/papers/search/providers/ArxivSearchProvider.ts`
- `src/main/papers/search/providers/OpenAlexSearchProvider.ts`
- `src/main/papers/search/providers/CvfOpenAccessSearchProvider.ts`

**职责**
- 聚合多搜索源
- 将不同来源结果统一成 `PaperSearchResult`

**核心方法**
- `search`
- `runProvider`
- 各 Provider 的 `search`

**变更风险**
- 中
- 主要影响搜索结果质量与字段兼容性

### 3.4 ReaderService

**文件**
- `src/main/reader/ReaderService.ts`

**职责**
- 管理阅读 session
- 保存阅读进度
- 保存批注
- 删除批注
- 保存笔记
- 执行阅读问答

**核心方法**
- `getSession`
- `saveProgress`
- `addAnnotation`
- `removeAnnotation`
- `saveNote`
- `askAssistant`

**依赖关系**
- 依赖 `PaperService`
- 依赖 `AgentRuntimeService`

**变更风险**
- 高
- 改会影响阅读器、问答、批注、笔记

### 3.5 AgentRuntimeService

**文件**
- `src/main/agents/AgentRuntimeService.ts`

**职责**
- 提供 Agent 定义
- 生成演示任务
- 提供阅读器问答 Agent Runtime
- 提供统一任务时间线

**核心方法**
- `getDefinitions`
- `getSeededTasks`
- `runDemoAgent`
- `runReaderQaAgent`

**变更风险**
- 中
- 主要影响工作台和阅读问答链路

### 3.6 PaperAnalysisService

**文件**
- `src/main/analysis/PaperAnalysisService.ts`
- `src/main/analysis/InternetSearchService.ts`

**职责**
- 跑单篇论文分析
- 维护分析报告
- 处理分析追问
- 生成任务与时间线
- 组织互联网检索与代码验证内容

**核心方法**
- `getAnalysis`
- `runAnalysis`
- `askQuestion`
- `listTasks`

**依赖关系**
- 依赖 `PaperService`
- 依赖 `ReaderService`
- 间接依赖 `AgentRuntimeService`

**变更风险**
- 高
- 会影响单篇分析、主题分析、外部接入分析

### 3.7 TopicTrackingService

**文件**
- `src/main/topics/TopicTrackingService.ts`

**职责**
- 管理主题订阅
- 启动 / 停止调度器
- 执行主题聚合分析
- 生成主题报告
- 记录执行历史
- 生成主题任务

**核心方法**
- `startScheduler`
- `stopScheduler`
- `getSnapshot`
- `listTasks`
- `saveSubscription`
- `deleteSubscription`
- `runTopicAnalysis`
- `runTopicScheduler`

**依赖关系**
- 依赖 `PaperService`
- 依赖 `PaperAnalysisService`

**变更风险**
- 高
- 会影响：
  - 工作台主题模块
  - 定时任务
  - 报告与历史
  - AI 总览统计

### 3.8 ExternalMediaService

**文件**
- `src/main/integrations/ExternalMediaService.ts`

**职责**
- 处理外部媒体消息
- 解析论文查询
- 匹配或导入论文
- 触发分析
- 记录请求与回调状态

**核心方法**
- `getSnapshot`
- `handleFeishuMessage`
- `listCallbacksByRequest`
- `getRequestById`
- `resolvePaper`

**依赖关系**
- 依赖 `PaperService`
- 依赖 `PaperAnalysisService`

**变更风险**
- 中高
- 影响外部平台接入与自动分析流程

### 3.9 ExternalMediaServer

**文件**
- `src/main/integrations/ExternalMediaServer.ts`

**职责**
- 启动本地 HTTP 服务
- 对外暴露协议入口
- 返回外部接入快照
- 将请求转发给 `ExternalMediaService`

**核心方法**
- `start`
- `stop`
- `getSnapshot`
- `getBaseUrl`
- `routeRequest`
- `getProtocols`

**依赖关系**
- 依赖 `ExternalMediaService`
- 依赖 `WorkspaceConfig`

**变更风险**
- 中
- 主要影响外部协议兼容性和接口地址展示

### 3.10 registerIpcHandlers

**文件**
- `src/main/ipc/registerIpcHandlers.ts`

**职责**
- 暴露所有渲染层可调用能力
- 充当 Main Service 的统一入口层

**特点**
- 它不是业务核心
- 但它是所有业务能力的“外观层”

**变更风险**
- 高
- IPC 名称、参数、返回值一旦改动，Renderer 与 Preload 都要同步

---

## 4. 数据模型拆分

### 4.1 工作区配置类

**类型**
- `WorkspaceDirectories`
- `ExternalMediaConfig`
- `AiModelConfig`
- `WorkspaceConfig`
- `WorkspaceConfigInput`

**被谁使用**
- `SettingsPage`
- `WorkspaceService`
- `ExternalMediaServer`

**修改时注意**
- 这是设置页和主进程配置的契约层
- 增减字段要同时改：
  - `src/shared/types.ts`
  - `src/preload/index.ts`
  - `src/main/ipc/registerIpcHandlers.ts`
  - `SettingsPage`
  - `WorkspaceService`

### 4.2 论文类

**类型**
- `PaperRecord`
- `PaperSearchResult`
- `PaperSearchInput`
- `PaperLibraryPayload`
- `PaperMutationInput`

**被谁使用**
- 搜索页
- 论文库页
- 阅读器
- 单篇分析
- 主题分析
- 外部接入

**修改时注意**
- 这是全项目最核心模型之一
- 任意字段变化都可能影响多个模块

### 4.3 阅读器类

**类型**
- `ReadingRecord`
- `ReaderAnnotation`
- `ReaderChatMessage`
- `ReaderSession`
- `ReaderProgressInput`
- `ReaderAnnotationInput`
- `ReaderAssistantInput`
- `ReaderAssistantReply`

**被谁使用**
- `ReaderPage`
- `ReaderService`
- `AgentRuntimeService`

**修改时注意**
- 会影响阅读器 UI 和阅读数据持久化

### 4.4 工作流与任务类

**类型**
- `AgentTaskRecord`
- `AgentDefinition`
- `AgentTimelineEntry`
- `AgentRunResult`

**被谁使用**
- `App`
- `AiWorkbenchPage`
- `PaperAnalysisService`
- `TopicTrackingService`
- `ReaderService`
- `ExternalMediaService`

**修改时注意**
- 这是“任务状态展示”的基础类型
- 工作台、阅读问答、主题分析都依赖它

### 4.5 单篇分析类

**类型**
- `InternetSearchHit`
- `PaperAnalysisSection`
- `CodeExperimentVerification`
- `PaperAnalysisRecord`
- `PaperAnalysisRunResult`
- `PaperAnalysisQuestionInput`
- `PaperAnalysisQuestionReply`

**被谁使用**
- `PaperAnalysisWorkbench`
- `PaperAnalysisService`
- `ExternalMediaService`
- `TopicTrackingService`

**修改时注意**
- 单篇分析和主题分析存在间接耦合

### 4.6 主题分析类

**类型**
- `TopicSubscription`
- `TopicSubscriptionInput`
- `TopicPaperDigest`
- `TopicAnalysisSection`
- `TopicAnalysisReport`
- `TopicExecutionHistory`
- `TopicTrackingSnapshot`
- `TopicRunResult`

**被谁使用**
- `TopicTrackingWorkbench`
- `TopicTrackingService`
- `App`
- `AiWorkbenchPage`

**修改时注意**
- 同时影响：
  - 订阅配置
  - 概览统计
  - 聚合报告
  - 执行历史
  - 调度器状态

### 4.7 外部接入类

**类型**
- `FeishuMessageInput`
- `ExternalMediaTaskRequest`
- `ExternalMediaStatusCallback`
- `ExternalMediaProtocol`
- `ExternalMediaSnapshot`
- `ExternalMediaTaskReceipt`

**被谁使用**
- `ExternalMediaService`
- `ExternalMediaServer`
- `SettingsPage`
- `App bootstrap`

**修改时注意**
- 同时影响 HTTP 服务、设置页、模拟入口

### 4.8 启动与桥接类

**类型**
- `NavigationItem`
- `BootstrapPayload`
- `DesktopApi`

**被谁使用**
- `App`
- `src/preload/index.ts`
- `registerIpcHandlers.ts`

**修改时注意**
- 这是前后端通信契约
- 改动范围最大

---

## 5. 数据流与依赖链

### 5.1 顶层依赖图

```text
WorkspaceService
  ├─> PaperService
  │    ├─> ReaderService
  │    │    └─> AgentRuntimeService
  │    ├─> PaperAnalysisService
  │    │    └─> InternetSearchService
  │    ├─> TopicTrackingService
  │    │    └─> PaperAnalysisService
  │    └─> ExternalMediaService
  │         └─> PaperAnalysisService
  └─> ExternalMediaServer
       └─> ExternalMediaService
```

### 5.2 渲染层调用链

```text
Renderer Component
  -> window.desktopApi
    -> preload/index.ts
      -> ipcRenderer.invoke(...)
        -> registerIpcHandlers.ts
          -> Main Service
            -> 文件系统 / 网络 / 业务计算
```

### 5.3 最核心的数据中枢
1. `WorkspaceService`
2. `PaperService`
3. `PaperAnalysisService`
4. `TopicTrackingService`

---

## 6. 真实持久化文件清单

### 6.1 工作区层
- `config.json`

### 6.2 论文库层
- `metadata/papers.json`
- `metadata/papers/*.json`
- `papers/*.pdf`

### 6.3 阅读器层
- `metadata/reading.json`
- `notes/reader-sessions/*.json`

### 6.4 分析层
- `analyses/analysis-index.json`
- `analyses/reports/*.json`

### 6.5 任务层
- `tasks/agent-tasks.json`

### 6.6 主题层
- 主题订阅、报告、历史相关文件由 `TopicTrackingService` 维护在工作区目录下的 JSON 存储中

### 6.7 外部接入层
- 外部请求与回调 JSON 存储由 `ExternalMediaService` 管理

---

## 7. 修改影响面清单

### 7.1 如果改“设置”
至少检查：
- `src/shared/types.ts`
- `src/preload/index.ts`
- `src/main/ipc/registerIpcHandlers.ts`
- `src/main/workspace/WorkspaceService.ts`
- `SettingsPage`

### 7.2 如果改“论文字段”
至少检查：
- `PaperRecord`
- `PaperMutationInput`
- `PaperService.ts`
- `LibraryPage`
- `ReaderPage`
- `PaperAnalysisWorkbench`
- `TopicTrackingService`
- `ExternalMediaService`

### 7.3 如果改“阅读器”
至少检查：
- `ReaderSession`
- `ReaderService.ts`
- `ReaderPage.tsx`
- `AgentRuntimeService.ts`

### 7.4 如果改“单篇分析”
至少检查：
- `PaperAnalysisRecord`
- `PaperAnalysisService.ts`
- `PaperAnalysisWorkbench.tsx`
- `TopicTrackingService.ts`
- `ExternalMediaService.ts`

### 7.5 如果改“主题订阅 / 聚合分析”
至少检查：
- `TopicSubscription`
- `TopicAnalysisReport`
- `TopicTrackingSnapshot`
- `TopicTrackingService.ts`
- `TopicTrackingWorkbench.tsx`
- `AiWorkbenchPage`

### 7.6 如果改“外部接入”
至少检查：
- `ExternalMediaConfig`
- `ExternalMediaProtocol`
- `ExternalMediaSnapshot`
- `ExternalMediaService.ts`
- `ExternalMediaServer.ts`
- `SettingsPage`

### 7.7 如果改“IPC 接口名 / 参数”
必须同步：
- `src/shared/types.ts`
- `src/preload/index.ts`
- `src/main/ipc/registerIpcHandlers.ts`
- 所有 `window.desktopApi.*` 调用点

---

## 8. 回归测试点清单

### 8.1 设置
- 设置保存成功
- 目录选择器可正常打开
- 路径修改后可回填
- AI Key 显示 / 隐藏按钮正常

### 8.2 搜索
- 搜索可返回结果
- 导入成功后论文库刷新

### 8.3 论文库
- 列表正常显示
- 标题进入阅读器
- 折叠 / 展开正常
- 删除正常

### 8.4 阅读器
- PDF 可打开
- 阅读进度可保存
- 批注增删正常
- 笔记可保存
- 阅读问答可返回结果

### 8.5 单篇分析
- 可跑分析
- 历史报告可读取
- 追问可写回 conversation

### 8.6 主题订阅
- 创建 / 编辑 / 删除订阅正常
- 手动执行聚合正常
- 调度器状态展示正常
- 执行历史正常刷新

### 8.7 外部接入
- 协议快照正常返回
- 模拟飞书消息可进入链路
- 请求 / 回调记录正常写入

---

## 9. 可替换扩展点

### 9.1 Agent 编排层
- 当前：`AgentRuntimeService`
- 可替换方向：
  - LangChain
  - 自定义 Orchestrator
  - 更完整的 Agent Runtime

### 9.2 搜索源层
- 当前：
  - arXiv
  - OpenAlex
  - CVF Open Access
- 可扩展：
  - Semantic Scholar
  - Crossref
  - 本地知识库索引

### 9.3 模型接入层
- 当前设置层已经有：
  - provider
  - baseUrl
  - apiKey
  - model
- 后续可扩展：
  - 多模型切换
  - provider adapter
  - 连接测试
  - fallback 策略

### 9.4 外部接入层
- 当前主要是飞书
- 可扩展：
  - Slack
  - 邮件入口
  - Webhook
  - 本地 CLI 入口

---

## 10. 实战修改模板

后续每次改功能，建议先按下面模板梳理：

### 功能名称
- 入口页面：
- Renderer 组件：
- 相关 shared types：
- 对应 desktopApi 方法：
- IPC handler：
- Main Service：
- 持久化文件：
- 会影响的下游模块：
- 回归测试点：

---

## 11. 当前最重要的改造入口

### 11.1 若要优先改 UI 交互
- `src/renderer/src/App.tsx`
- `src/renderer/src/ReaderPage.tsx`
- `src/renderer/src/PaperAnalysisWorkbench.tsx`
- `src/renderer/src/TopicTrackingWorkbench.tsx`
- `src/renderer/src/styles.css`

### 11.2 若要优先改业务能力
- `src/main/papers/PaperService.ts`
- `src/main/reader/ReaderService.ts`
- `src/main/analysis/PaperAnalysisService.ts`
- `src/main/topics/TopicTrackingService.ts`
- `src/main/workspace/WorkspaceService.ts`

### 11.3 若要优先改系统边界
- `src/main/ipc/registerIpcHandlers.ts`
- `src/preload/index.ts`
- `src/shared/types.ts`

---

## 12. 一句话结论

当前项目已经不是单页原型，而是一个具备完整链路的桌面研究工作台：

**工作区配置 → 搜索导入 → 论文库 → 阅读器 → 单篇分析 → 主题聚合 → 外部接入 → 全局工作台汇总**

后续逐功能深改时，真正要重点盯住的是：

- `src/shared/types.ts` 的契约稳定性
- `PaperService` 的中枢地位
- `PaperAnalysisService` 与 `TopicTrackingService` 的 AI 能力耦合
- `WorkspaceService` 对所有本地持久化路径的牵引作用
