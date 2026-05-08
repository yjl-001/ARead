import type { AgentDefinition } from '@shared/types';

export const agentCatalog: AgentDefinition[] = [
  {
    key: 'paper-analysis',
    title: '单篇论文分析 Agent',
    description: '统一承接论文详情页和外部入口触发的结构化分析任务。',
    entrypoints: ['论文详情', '飞书入口'],
    status: 'ready',
    runtime: 'langchain',
    mode: 'workflow',
  },
  {
    key: 'reader-qa',
    title: '阅读问答 Agent',
    description: '用于阅读器中的连续问答、上下文召回和回复编排。',
    entrypoints: ['阅读器'],
    status: 'ready',
    runtime: 'langchain',
    mode: 'loop-agent',
  },
  {
    key: 'topic-tracking',
    title: '主题追踪 Agent',
    description: '用于聚合多篇论文并生成周期性主题报告。',
    entrypoints: ['AI 工作台', '每日调度'],
    status: 'ready',
    runtime: 'langchain',
    mode: 'workflow',
  },
  {
    key: 'demo-runtime',
    title: 'Runtime 演示 Agent',
    description: '用于验证统一 Agent Runtime 的基础串联能力。',
    entrypoints: ['工作台演示'],
    status: 'ready',
    runtime: 'langchain',
    mode: 'workflow',
  },
];
