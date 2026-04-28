# LangChain Agent Runtime 迁移计划

## Summary

- 目标是将当前仅在 `src/main/langgraph/WorkflowService.ts` 中落地的 LangGraph 编排，替换为基于 LangChain 的统一 Agent Runtime 层，并把阅读问答、单篇分析、主题追踪三条 AI 能力链路统一接入。
- 本次迁移同时抽离独立的 agent 能力抽象层，主进程业务服务不再直接承担“编排 + 任务状态流转 + 时间线拼装”职责，只负责准备上下文、持久化结果和对外暴露能力。
- 迁移后优先保持现有桌面端体验平滑：保留现有 `agent-tasks.json` 主结构和界面主入口，但将类型与命名从 `workflow` 逐步转向 `agent/runtime`，并在必要处做兼容映射。

## Current State Analysis

- LangGraph 的唯一真实执行点是 `src/main/langgraph/WorkflowService.ts`：通过 `StateGraph` 运行 demo 流程，并提供阅读问答的任务/时间线拼装。
- `src/main/reader/ReaderService.ts` 直接依赖 `WorkflowService`，阅读器问答链路已经绑定到当前工作流服务。
- `src/main/analysis/PaperAnalysisService.ts` 与 `src/main/topics/TopicTrackingService.ts` 当前并未使用 LangGraph，而是各自手写任务状态推进、时间线记录和持久化逻辑，说明“Agent 能力”尚未被统一抽象。
- `src/main/index.ts`、`src/main/ipc/registerIpcHandlers.ts`、`src/preload/index.ts` 负责注入和暴露当前工作流能力；渲染层主要在 `src/renderer/src/App.tsx`、`src/renderer/src/ReaderPage.tsx` 消费 `workflows`、`seededTasks`、`timeline`。
- `src/shared/types.ts` 仍以 `WorkflowDefinition`、`WorkflowTimelineEntry`、`WorkflowRunResult` 为中心；任务记录则统一复用了 `AgentTaskRecord`，这为平滑迁移提供了基础。
- 工作区默认配置和部分外部接入仍写死 `langgraph-placeholder`，见 `src/main/workspace/WorkspaceService.ts`、`src/main/integrations/ExternalMediaServer.ts`、`src/renderer/src/App.tsx`。
- `package.json` 当前已存在 `@langchain/core`，但源码没有直接使用；真实 LangGraph 依赖为 `@langchain/langgraph`。当前仓库也未安装具体模型 provider 包，因此本次迁移以 LangChain Runtime 抽象替换编排层为主，不额外引入真实模型调用。

## Proposed Changes

### 1. 新建统一 Agent Runtime 层

- 新增目录 `src/main/agents/`，替代当前 `src/main/langgraph/` 作为主进程中的 AI 编排边界。
- 新增 `src/main/agents/AgentRuntimeService.ts`
  - 作为统一运行时入口，负责注册 agent 定义、执行 LangChain runnable 链、生成任务状态、收敛 timeline。
  - 基于 `@langchain/core/runnables` 的 `RunnableSequence` / `RunnableLambda` 组织阶段链，而不是继续依赖 LangGraph `StateGraph`。
  - 输出统一结果对象，供阅读问答、单篇分析、主题追踪复用。
- 新增 `src/main/agents/runtimeTypes.ts`
  - 定义运行时上下文、阶段输出、agent 执行输入/输出、兼容映射辅助类型。
- 新增 `src/main/agents/agentCatalog.ts`
  - 统一声明 `reader-qa`、`paper-analysis`、`topic-tracking`、`demo-runtime` 等 agent 定义，替换 `WorkflowService.getDefinitions()`。

### 2. 用 Runtime 统一三条 AI 能力链路

- 更新 `src/main/reader/ReaderService.ts`
  - 将依赖从 `WorkflowService` 改为 `AgentRuntimeService`。
  - 阅读问答只负责收集 `paper/session/question/currentPage`，再调用运行时的 `runReaderQaAgent()`。
- 更新 `src/main/analysis/PaperAnalysisService.ts`
  - 将当前手写的“任务创建 → 联网增强 → 结构化章节 → 验证总结”流程拆成“上下文准备 + runtime 编排 + 报告落盘”三层。
  - 由运行时统一维护任务状态和时间线，本服务仅保留数据查询、结果构建、报告持久化。
- 更新 `src/main/topics/TopicTrackingService.ts`
  - 将当前“抓取论文 → 聚合分析 → 写报告”迁移为 runtime 执行模式。
  - 保留调度器、订阅存储和报告文件读写；把聚合步骤的阶段管理交给统一运行时。
- 保持 `src/main/integrations/ExternalMediaService.ts` 继续通过 `PaperAnalysisService` 触发单篇分析，以便外部入口无需感知编排层替换。

### 3. 重构共享类型并保留兼容层

- 更新 `src/shared/types.ts`
  - 新增以 `AgentDefinition`、`AgentTimelineEntry`、`AgentRunResult` 为核心的类型。
  - `AgentTaskRecord` 增加 `agentKey`、`runtime`、`metadata` 等可选字段。
  - 为兼容已有任务文件和 UI，短期保留 `workflowKey?: string` 作为兼容字段，并在运行时写入与 `agentKey` 一致的值。
- 更新 `BootstrapPayload` 与 `DesktopApi`
  - 将 `workflows` 迁移为 `agents` 作为首选字段。
  - 视渲染层改造成本，临时保留 `workflows` 映射字段一个版本，用于平滑过渡。

### 4. 替换主进程装配与 IPC 暴露

- 更新 `src/main/index.ts`
  - 将 `WorkflowService` 注入替换为 `AgentRuntimeService`。
  - 统一向 `ReaderService`、`PaperAnalysisService`、`TopicTrackingService` 注入 runtime。
- 更新 `src/main/ipc/registerIpcHandlers.ts`
  - 类型与注入参数由 `workflowService` 改为 `agentRuntimeService`。
  - `app:get-bootstrap` 返回 agent 定义而不是 workflow 定义。
  - 保留现有 IPC channel 名称以降低前端改造成本；若实现阶段发现命名割裂，再统一调整 channel 命名并同步 preload / renderer。
- 更新 `src/preload/index.ts`
  - 同步桥接返回值类型，保证渲染层能够读取新的 agent 元数据和运行结果。

### 5. 调整渲染层展示与命名

- 更新 `src/renderer/src/App.tsx`
  - AI 工作台总览从“工作流”文案调整为“Agent 能力 / Runtime”文案。
  - 总览统计与最近任务面板改为基于 `agents` 字段渲染。
  - 设置页中的模型占位示例从 `langgraph-placeholder` 改为中性或 LangChain 导向命名。
- 更新 `src/renderer/src/ReaderPage.tsx`
  - 继续展示 timeline，但消费新的运行时结果类型。
  - 若结果结构增加 `agentKey` / `runtime` 元数据，则在 UI 中只选择必要字段展示，不暴露实现细节。
- 按需检查 `src/renderer/src/PaperAnalysisWorkbench.tsx`、`src/renderer/src/TopicTrackingWorkbench.tsx`
  - 若任务字段或状态摘要有变化，同步调整渲染逻辑，确保旧任务文件也能正常展示。

### 6. 清理命名、依赖与文档

- 删除或迁移 `src/main/langgraph/WorkflowService.ts`，由 `src/main/agents/` 取代。
- 更新 `package.json` 与 `package-lock.json`
  - 移除 `@langchain/langgraph`。
  - 保留并实际使用 `@langchain/core`。
  - 不预设新增模型 provider 依赖，除非实现时发现 `@langchain/core` 无法满足 runnable 编排。
- 更新 `scripts/smoke.ts`
  - 冒烟脚本改为初始化新 runtime，并验证 demo、阅读问答、单篇分析、主题追踪链路仍可在无界面环境跑通。
- 更新文档
  - `docs/current-architecture-overview.md`
  - `docs/current-architecture-overview-v2.md`
  - 将 LangGraph 表述替换为新的 LangChain Agent Runtime 架构。

## Assumptions & Decisions

- 决策：采用“统一运行时层”方案，不为三条业务线各自维护独立编排器。
- 决策：本次迁移重点是运行时抽象和链路统一，不引入真实外部大模型调用；现有结果生成仍保持本地可运行、可冒烟验证的确定性逻辑。
- 决策：优先兼容现有 `agent-tasks.json` 持久化结构，不做一次性数据迁移脚本；通过新增可选字段和兼容读取实现平滑过渡。
- 决策：前端体验保持稳定，必要时允许接口和类型升级，但会同步更新 preload、IPC 与渲染层，避免半迁移状态。
- 假设：当前唯一需要真正移除的 LangGraph 执行代码只有 `WorkflowService`；其余服务虽不依赖 LangGraph，但都应接入统一 Agent Runtime，以满足“统一 AI 编排层”的目标。

## Verification Steps

- 运行 `npm run typecheck`，确认主进程、preload、renderer、共享类型在重构后全部通过 TypeScript 校验。
- 运行 `npm run smoke`，验证以下链路：
  - runtime demo 执行成功
  - 阅读问答可返回任务与 timeline
  - 单篇分析可生成报告与验证摘要
  - 主题追踪可生成聚合报告与执行历史
  - 外部媒体入口仍能复用单篇分析链路
- 运行 `npm run build`，确认 Electron + renderer 构建可通过。
- 手动验证桌面界面至少以下页面不报错：
  - AI 工作台
  - 阅读器问答面板
  - 设置页模型占位与配置保存
