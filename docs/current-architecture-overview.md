# Vibe Reading 架构梳理 v2

> 目标：为后续“逐功能详细修改”提供一份更适合工程改造的文档。  
> 相比 v1，这一版按 **页面 / 主进程服务 / 数据模型 / 修改影响面** 四个维度拆开。

---

# 1. 阅读指南

本文按下面顺序阅读最有效：

1. 先看 **页面拆分**
2. 再看 **主进程服务拆分**
3. 再看 **核心数据模型**
4. 最后看 **修改影响面清单**

如果后面你要改某个功能，推荐顺序是：

- 先定位页面入口
- 再定位对应 IPC
- 再定位主进程 Service
- 最后确认涉及哪些 shared types

---

# 2. 页面拆分

## 2.1 App 壳层与全局状态

### 页面 / 组件
- [App](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L32-L190)
- [AppShell](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L232-L387)
- [NavItem](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L394-L404)
- [StateScreen](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L1026-L1034)

### 负责什么
- 启动时拉取全局 bootstrap 数据
- 保存全局状态：
  - `bootstrap`
  - `library`
  - `topicTracking`
  - `agentResult`
  - `notice`
- 负责顶层路由分发
- 负责全局通知展示与自动关闭
- 负责把 desktop API 调用结果分发到各页面

### 关键函数
- `loadBootstrap`
- `handleRunAgent`
- `handleImportPaper`
- `handleUpdatePaper`
- `handleRemovePaper`
- `handleSaveWorkspaceConfig`

### 依赖
- `window.desktopApi.*`
- React Router
- 子页面：
  - `SearchPage`
  - `ReaderPage`
  - `PaperAnalysisWorkbench`
  - `TopicTrackingWorkbench`

### 改这里会影响什么
- 几乎所有页面
- 全局 notice
- bootstrap 数据刷新
- 路由切换逻辑

---

## 2.2 论文库页

### 页面 / 组件
- [LibraryPage](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L434-L576)
- [LibraryPaperCard](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L589-L635)

### 当前功能
- 论文库概览统计
- 论文筛选
- 折叠 / 展开论文卡
- 点击标题进入阅读器
- 删除单篇论文
- 展示来源、发布时间、摘要、作者等核心信息

### 关键状态
- `query`
- `source`
- `tag`
- `readingStatus`
- `analysisStatus`
- `timeRange`

### 主要交互
- 标题点击进入 `/reader?paper=...`
- 折叠按钮切换卡片展开态
- 垃圾桶按钮删除论文

### 依赖数据
- `PaperLibraryPayload`
- `PaperRecord`

### 对应主链路
- Renderer → `desktopApi.getLibrary/updatePaper/removePaper`
- IPC → `paper:*`
- Main → `PaperService`

### 改这里会影响什么
- 论文展示结构
- 阅读器进入路径
- 论文元信息展示策略
- 论文库交互体验

---

## 2.3 搜索页

### 页面 / 组件
- [SearchPage](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/SearchPage.tsx)
- [SearchSectionCard](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/SearchPage.tsx#L180-L197)
- [SearchStatusBadge](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/SearchPage.tsx#L199-L203)

### 当前功能
- 输入关键词搜索论文
- 选择来源
- 查看搜索结果
- 导入论文进论文库

### 关键函数
- `handleSearch`
- `handleImport`

### 依赖数据
- `PaperSearchInput`
- `PaperSearchResult`

### 对应主链路
- Renderer → `desktopApi.searchPapers/importPaper`
- IPC → `paper:search` / `paper:import`
- Main → `PaperService.search/importPaper`
- Search Provider：
  - arXiv
  - OpenAlex
  - CVF Open Access

### 改这里会影响什么
- 搜索体验
- 导入流程
- 搜索来源扩展方式
- 搜索结果字段展示

---

## 2.4 阅读器页

### 页面 / 组件
- [ReaderPage](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/ReaderPage.tsx)
- [ReaderPdfPanel](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/ReaderPage.tsx#L331-L418)
- [ReaderSidebar](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/ReaderPage.tsx#L425-L603)
- [ReaderAssistantPanel](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/ReaderPage.tsx#L611-L694)

### 当前功能
- 打开 PDF
- 记录阅读进度
- 保存笔记
- 保存批注
- 阅读问答
- 左侧论文列表切换
- 右侧浮动功能栏

### 关键函数
- `handleSaveNote`
- `loadPdfBinary`

### 依赖数据
- `ReaderSession`
- `ReaderProgressInput`
- `ReaderAnnotationInput`
- `ReaderAssistantInput`

### 对应主链路
- Renderer → `desktopApi.getReaderSession/saveReaderProgress/addReaderAnnotation/removeReaderAnnotation/saveReaderNote/askReaderAssistant`
- IPC → `reader:*`
- Main → `ReaderService`
- 阅读问答进一步依赖 `AgentRuntimeService.runReaderQaAgent`

### 改这里会影响什么
- 阅读体验
- 批注与笔记持久化
- 问答上下文质量
- PDF 工具栏与侧边栏布局

---

## 2.5 AI 工作台页

### 页面 / 组件
- [AiWorkbenchPage](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L654-L685)

### 当前功能
- AI 能力总览
- 最近任务摘要
- 单篇分析入口
- 主题订阅与聚合分析入口

### 子模块
- [PaperAnalysisWorkbench](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/PaperAnalysisWorkbench.tsx)
- [TopicTrackingWorkbench](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/TopicTrackingWorkbench.tsx)

### 改这里会影响什么
- 工作台入口排布
- 任务摘要展示
- 单篇分析和主题分析两个子系统的 UI 编排

---

## 2.6 单篇论文深度分析

### 页面 / 组件
- [PaperAnalysisWorkbench](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/PaperAnalysisWorkbench.tsx)
- [AnalysisSectionCard](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/PaperAnalysisWorkbench.tsx#L279-L302)
- [VerificationCard](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/PaperAnalysisWorkbench.tsx#L314-L353)
- [ConversationList](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/PaperAnalysisWorkbench.tsx#L365-L389)

### 当前功能
- 选论文
- 跑分析
- 查看已有分析
- 基于分析继续提问
- 展示章节 / 验证 / 对话

### 关键函数
- `handleRunAnalysis`
- `handleAskQuestion`
- `loadExistingReport`

### 对应主链路
- Renderer → `desktopApi.getPaperAnalysis/runPaperAnalysis/askPaperAnalysisQuestion`
- IPC → `analysis:*`
- Main → `PaperAnalysisService`

### 改这里会影响什么
- 分析输出结构
- 问答体验
- 代码验证展示
- 互联网检索引用展示

---

## 2.7 主题订阅与聚合分析

### 页面 / 组件
- [TopicTrackingWorkbench](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/TopicTrackingWorkbench.tsx)
- [MetricChip](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/TopicTrackingWorkbench.tsx#L372-L378)
- [TopicSubscriptionCard](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/TopicTrackingWorkbench.tsx#L397-L465)
- [TopicReportCard](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/TopicTrackingWorkbench.tsx#L477-L529)
- [TopicHistoryRow](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/TopicTrackingWorkbench.tsx#L541-L552)

### 当前功能
- 创建 / 更新主题订阅
- 启停每日抓取
- 手动执行聚合分析
- 查看报告
- 查看执行历史
- 调度器状态展示

### 关键函数
- `handleSaveSubscription`
- `handleRunTopic`
- `handleRunScheduler`
- `handleDeleteTopic`
- `handleToggleEnabled`

### 依赖数据
- `TopicSubscription`
- `TopicTrackingSnapshot`
- `TopicAnalysisReport`
- `TopicExecutionHistory`

### 对应主链路
- Renderer → `desktopApi.saveTopicSubscription/deleteTopicSubscription/runTopicAnalysis/runTopicScheduler/getTopicTracking`
- IPC → `topic:*`
- Main → `TopicTrackingService`

### 改这里会影响什么
- 主题配置表单结构
- 调度规则
- 聚合分析报告结构
- 执行历史展示方式

---

## 2.8 设置页

### 页面 / 组件
- [SettingsPage](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L708-L937)
- [SectionCard](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L948-L964)
- 图标组件：
  - [SaveIcon](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L966-L974)
  - [FolderIcon](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L976-L988)
  - [EyeIcon](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L990-L1003)
  - [EyeOffIcon](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx#L1005-L1019)

### 当前功能
- 默认主题设置
- 默认模型标识设置
- 工作区路径编辑
- 调起系统目录选择器
- 外部接入配置
- AI 模型配置
- API Key 显示 / 隐藏

### 关键函数
- `handleSave`
- `handlePickDirectory`

### 对应主链路
- Renderer → `desktopApi.saveWorkspaceConfig/pickDirectory`
- IPC → `workspace:save-config` / `workspace:pick-directory`
- Main → `WorkspaceService`

### 改这里会影响什么
- 所有依赖工作区目录的服务
- 外部接入协议配置
- AI 模型配置来源
- 通知提示逻辑

---

# 3. 主进程服务拆分

## 3.1 WorkspaceService

### 文件
- [WorkspaceService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/workspace/WorkspaceService.ts)

### 职责
- 初始化工作区目录
- 初始化配置文件
- 保证 papers / metadata / notes / analyses / tasks / cache 等目录存在
- 保存设置页配置
- 维护当前工作区目录与配置对象

### 核心方法
- `ensureWorkspace`
- `getDirectories`
- `getConfig`
- `saveConfig`
- `ensureDirectories`
- `ensureConfig`
- `getWorkspaceFiles`

### 依赖关系
- 几乎所有主进程服务都依赖它输出的 `WorkspaceDirectories`

### 变更风险
- 高
- 改路径结构会连带影响：
  - `PaperService`
  - `ReaderService`
  - `PaperAnalysisService`
  - `TopicTrackingService`
  - `ExternalMediaService`

---

## 3.2 PaperService

### 文件
- [PaperService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/papers/PaperService.ts)

### 职责
- 维护论文库
- 搜索入口封装
- 导入论文
- 更新论文状态
- 删除论文
- 返回论文库 summary

### 核心方法
- `getLibrary`
- `getPaperById`
- `search`
- `importPaper`
- `updatePaper`
- `removePaper`

### 依赖关系
- 依赖 `WorkspaceDirectories`
- 依赖 `PaperSearchService`

### 变更风险
- 高
- 它是全文最核心的数据中枢之一

---

## 3.3 PaperSearchService 与 Providers

### 文件
- [PaperSearchService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/papers/search/PaperSearchService.ts)
- [ArxivSearchProvider.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/papers/search/providers/ArxivSearchProvider.ts)
- [OpenAlexSearchProvider.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/papers/search/providers/OpenAlexSearchProvider.ts)
- [CvfOpenAccessSearchProvider.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/papers/search/providers/CvfOpenAccessSearchProvider.ts)

### 职责
- 聚合多搜索源
- 将不同来源结果统一成 `PaperSearchResult`

### 核心方法
- `search`
- `runProvider`
- 各 Provider 的 `search`

### 变更风险
- 中
- 主要影响搜索结果质量与字段兼容性

---

## 3.4 ReaderService

### 文件
- [ReaderService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/reader/ReaderService.ts)

### 职责
- 管理阅读 session
- 保存阅读进度
- 保存批注
- 删除批注
- 保存笔记
- 执行阅读问答

### 核心方法
- `getSession`
- `saveProgress`
- `addAnnotation`
- `removeAnnotation`
- `saveNote`
- `askAssistant`

### 依赖关系
- 依赖 `PaperService`
- 依赖 `AgentRuntimeService`

### 变更风险
- 高
- 改会影响阅读器、问答、批注、笔记

---

## 3.5 AgentRuntimeService

### 文件
- [AgentRuntimeService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/agents/AgentRuntimeService.ts)

### 职责
- 提供 Agent 定义
- 生成演示任务
- 提供阅读器问答 Agent Runtime
- 提供统一任务时间线

### 核心方法
- `getDefinitions`
- `getSeededTasks`
- `runDemoAgent`
- `runReaderQaAgent`

### 变更风险
- 中
- 主要影响工作台和阅读问答链路

---

## 3.6 PaperAnalysisService

### 文件
- [PaperAnalysisService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/analysis/PaperAnalysisService.ts)
- [InternetSearchService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/analysis/InternetSearchService.ts)

### 职责
- 跑单篇论文分析
- 维护分析报告
- 处理分析追问
- 生成任务与时间线
- 组织互联网检索与代码验证内容

### 核心方法
- `getAnalysis`
- `runAnalysis`
- `askQuestion`
- `listTasks`

### 依赖关系
- 依赖 `PaperService`
- 依赖 `ReaderService`
- 可能依赖互联网检索服务

### 变更风险
- 高
- 会影响单篇分析、主题分析、外部接入分析

---

## 3.7 TopicTrackingService

### 文件
- [TopicTrackingService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/topics/TopicTrackingService.ts)

### 职责
- 管理主题订阅
- 启动 / 停止调度器
- 执行主题聚合分析
- 生成主题报告
- 记录执行历史
- 生成主题任务

### 核心方法
- `startScheduler`
- `stopScheduler`
- `getSnapshot`
- `listTasks`
- `saveSubscription`
- `deleteSubscription`
- `runTopicAnalysis`
- `runTopicScheduler`

### 依赖关系
- 依赖 `PaperService`
- 依赖 `PaperAnalysisService`

### 变更风险
- 高
- 会影响：
  - 工作台主题模块
  - 定时任务
  - 报告与历史
  - AI 总览统计

---

## 3.8 ExternalMediaService

### 文件
- [ExternalMediaService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/integrations/ExternalMediaService.ts)

### 职责
- 处理外部媒体消息
- 解析论文查询
- 匹配或导入论文
- 触发分析
- 记录请求与回调状态

### 核心方法
- `getSnapshot`
- `handleFeishuMessage`
- `listCallbacksByRequest`
- `getRequestById`
- `resolvePaper`

### 依赖关系
- 依赖 `PaperService`
- 依赖 `PaperAnalysisService`

### 变更风险
- 中高
- 影响外部平台接入与自动分析流程

---

## 3.9 ExternalMediaServer

### 文件
- [ExternalMediaServer.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/integrations/ExternalMediaServer.ts)

### 职责
- 启动本地 HTTP 服务
- 对外暴露协议入口
- 返回外部接入快照
- 将请求转发给 `ExternalMediaService`

### 核心方法
- `start`
- `stop`
- `getSnapshot`
- `getBaseUrl`
- `routeRequest`
- `getProtocols`

### 依赖关系
- 依赖 `ExternalMediaService`
- 依赖 `WorkspaceConfig`

### 变更风险
- 中
- 主要影响外部协议兼容性和接口地址展示

---

## 3.10 registerIpcHandlers

### 文件
- [registerIpcHandlers.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/ipc/registerIpcHandlers.ts)

### 职责
- 暴露所有渲染层可调用能力
- 充当 Main Service 的统一入口层

### 特点
- 它不是业务核心
- 但它是所有业务能力的“外观层”

### 变更风险
- 高
- IPC 名称、参数、返回值一旦改动，Renderer 与 Preload 都要同步

---

# 4. 数据模型拆分

## 4.1 工作区配置类

### 类型
- [WorkspaceDirectories](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L26-L34)
- [ExternalMediaConfig](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L36-L40)
- [AiModelConfig](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L42-L47)
- [WorkspaceConfig](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L49-L58)
- [WorkspaceConfigInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L60-L66)

### 被谁使用
- `SettingsPage`
- `WorkspaceService`
- `ExternalMediaServer`

### 修改时注意
- 这是设置页和主进程配置的契约层
- 增减字段要同时改：
  - shared types
  - preload
  - IPC
  - SettingsPage
  - WorkspaceService

---

## 4.2 论文类

### 类型
- [PaperRecord](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L68-L90)
- [PaperSearchResult](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L92-L104)
- [PaperSearchInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L106-L110)
- [PaperLibraryPayload](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L120-L123)
- [PaperMutationInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L125-L132)

### 被谁使用
- 搜索页
- 论文库页
- 阅读器
- 单篇分析
- 主题分析
- 外部接入

### 修改时注意
- 这是全项目最核心模型之一
- 任意字段变化都可能影响多个模块

---

## 4.3 阅读器类

### 类型
- [ReadingRecord](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L134-L142)
- [ReaderAnnotation](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L144-L153)
- [ReaderChatMessage](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L155-L161)
- [ReaderSession](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L163-L170)
- [ReaderProgressInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L172-L176)
- [ReaderAnnotationInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L178-L183)
- [ReaderAssistantInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L185-L189)
- [ReaderAssistantReply](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L191-L195)

### 被谁使用
- `ReaderPage`
- `ReaderService`
- `AgentRuntimeService`

### 修改时注意
- 会影响阅读器 UI 和阅读数据持久化

---

## 4.4 工作流与任务类

### 类型
- [AgentTaskRecord](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L197-L206)
- [AgentDefinition](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L211-L217)
- [AgentTimelineEntry](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L219-L222)
- [AgentRunResult](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L224-L227)

### 被谁使用
- `App`
- `AiWorkbenchPage`
- `PaperAnalysisService`
- `TopicTrackingService`
- `ReaderService`
- `ExternalMediaService`

### 修改时注意
- 这是“任务状态展示”的基础类型
- 工作台、阅读问答、主题分析都依赖它

---

## 4.5 单篇分析类

### 类型
- [InternetSearchHit](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L226-L233)
- [PaperAnalysisSection](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L235-L241)
- [CodeExperimentVerification](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L251-L258)
- [PaperAnalysisRecord](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L268-L282)
- [PaperAnalysisRunResult](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L284-L288)
- [PaperAnalysisQuestionInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L290-L293)
- [PaperAnalysisQuestionReply](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L295-L299)

### 被谁使用
- `PaperAnalysisWorkbench`
- `PaperAnalysisService`
- `ExternalMediaService`
- `TopicTrackingService`

### 修改时注意
- 单篇分析和主题分析存在间接耦合

---

## 4.6 主题分析类

### 类型
- [TopicSubscription](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L301-L315)
- [TopicSubscriptionInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L317-L325)
- [TopicPaperDigest](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L327-L334)
- [TopicAnalysisSection](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L336-L341)
- [TopicAnalysisReport](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L343-L359)
- [TopicExecutionHistory](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L361-L372)
- [TopicTrackingSnapshot](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L374-L390)
- [TopicRunResult](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L392-L398)

### 被谁使用
- `TopicTrackingWorkbench`
- `TopicTrackingService`
- `App`
- `AiWorkbenchPage`

### 修改时注意
- 同时影响：
  - 订阅配置
  - 概览统计
  - 聚合报告
  - 执行历史
  - 调度器状态

---

## 4.7 外部接入类

### 类型
- [FeishuMessageInput](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L400-L405)
- [ExternalMediaTaskRequest](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L407-L419)
- [ExternalMediaStatusCallback](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L421-L431)
- [ExternalMediaProtocol](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L433-L442)
- [ExternalMediaSnapshot](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L444-L448)
- [ExternalMediaTaskReceipt](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L450-L456)

### 被谁使用
- `ExternalMediaService`
- `ExternalMediaServer`
- `SettingsPage`
- `App bootstrap`

### 修改时注意
- 同时影响 HTTP 服务、设置页、模拟入口

---

## 4.8 启动与桥接类

### 类型
- [NavigationItem](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L458-L463)
- [BootstrapPayload](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L465-L479)
- [DesktopApi](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts#L481-L508)

### 被谁使用
- `App`
- `preload/index.ts`
- `registerIpcHandlers.ts`

### 修改时注意
- 这是前后端通信契约
- 改动范围最大

---

# 5. 数据流与依赖链

## 5.1 顶层依赖图

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

## 5.2 渲染层调用链

```text
Renderer Component
  -> window.desktopApi
    -> preload/index.ts
      -> ipcRenderer.invoke(...)
        -> registerIpcHandlers.ts
          -> Main Service
            -> 文件系统 / 网络 / 业务计算
```

## 5.3 最核心的数据中枢
1. `WorkspaceService`
2. `PaperService`
3. `PaperAnalysisService`
4. `TopicTrackingService`

---

# 6. 修改影响面清单

后续你逐个功能详细修改时，可以直接拿这个表做预判。

## 6.1 如果改“设置”
至少检查：
- `shared/types.ts`
- `preload/index.ts`
- `registerIpcHandlers.ts`
- `WorkspaceService.ts`
- `App.tsx` 中 `SettingsPage`

## 6.2 如果改“论文字段”
至少检查：
- `PaperRecord`
- `PaperMutationInput`
- `PaperService.ts`
- `LibraryPage`
- `ReaderPage`
- `PaperAnalysisWorkbench`
- `TopicTrackingService`
- `ExternalMediaService`

## 6.3 如果改“阅读器”
至少检查：
- `ReaderSession`
- `ReaderService.ts`
- `ReaderPage.tsx`
- `AgentRuntimeService.ts`

## 6.4 如果改“单篇分析”
至少检查：
- `PaperAnalysisRecord`
- `PaperAnalysisService.ts`
- `PaperAnalysisWorkbench.tsx`
- `TopicTrackingService.ts`
- `ExternalMediaService.ts`

## 6.5 如果改“主题订阅 / 聚合分析”
至少检查：
- `TopicSubscription`
- `TopicAnalysisReport`
- `TopicTrackingSnapshot`
- `TopicTrackingService.ts`
- `TopicTrackingWorkbench.tsx`
- `App.tsx` 中工作台总览

## 6.6 如果改“外部接入”
至少检查：
- `ExternalMediaConfig`
- `ExternalMediaProtocol`
- `ExternalMediaSnapshot`
- `ExternalMediaService.ts`
- `ExternalMediaServer.ts`
- `SettingsPage`

## 6.7 如果改“IPC 接口名 / 参数”
必须同步：
- `shared/types.ts`
- `preload/index.ts`
- `registerIpcHandlers.ts`
- 所有 `window.desktopApi.*` 调用点

---

# 7. 建议的后续逐功能改造顺序

## 7.1 低风险优先
- 纯布局
- 纯展示字段
- 文案
- 局部按钮交互

## 7.2 中风险
- 设置页配置项增删
- 搜索结果字段增删
- 工作台统计口径调整

## 7.3 高风险
- 工作区目录结构
- 论文核心模型
- 阅读 session 结构
- 分析报告结构
- 主题报告结构
- IPC 契约改造

---

# 8. 实战修改模板

后续每次改功能，建议先按下面模板梳理：

## 功能名称
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

# 9. 当前最重要的改造入口

## 9.1 若要优先改 UI 交互
- [App.tsx](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/App.tsx)
- [ReaderPage.tsx](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/ReaderPage.tsx)
- [PaperAnalysisWorkbench.tsx](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/PaperAnalysisWorkbench.tsx)
- [TopicTrackingWorkbench.tsx](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/TopicTrackingWorkbench.tsx)
- [styles.css](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/renderer/src/styles.css)

## 9.2 若要优先改业务能力
- [PaperService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/papers/PaperService.ts)
- [ReaderService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/reader/ReaderService.ts)
- [PaperAnalysisService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/analysis/PaperAnalysisService.ts)
- [TopicTrackingService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/topics/TopicTrackingService.ts)
- [WorkspaceService.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/workspace/WorkspaceService.ts)

## 9.3 若要优先改系统边界
- [registerIpcHandlers.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/main/ipc/registerIpcHandlers.ts)
- [preload/index.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/preload/index.ts)
- [types.ts](file:///Users/yjl/Desktop/vibe_coding/vibe_reading/src/shared/types.ts)

---

# 10. 一句话结论

当前项目已经不是单页原型，而是一个具备完整链路的桌面研究工作台：

**工作区配置 → 搜索导入 → 论文库 → 阅读器 → 单篇分析 → 主题聚合 → 外部接入 → 全局工作台汇总**

后续逐功能深改时，真正要重点盯住的是：

- `shared/types.ts` 的契约稳定性
- `PaperService` 的中枢地位
- `PaperAnalysisService` 与 `TopicTrackingService` 的 AI 能力耦合
- `WorkspaceService` 对所有本地持久化路径的牵引作用
