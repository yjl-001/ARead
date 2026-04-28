import type {
  AgentTaskRecord,
  AgentTaskStatus,
  AgentTimelineEntry,
} from '@shared/types';

export interface AgentPipelineContext<TData> {
  task: AgentTaskRecord;
  timeline: AgentTimelineEntry[];
  data: TData;
}

export interface AgentPipelineStageResult<TData> {
  data?: TData;
  message: string;
  summary?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentPipelineStage<TData> {
  stage: string;
  run: (context: AgentPipelineContext<TData>) => Promise<AgentPipelineStageResult<TData>> | AgentPipelineStageResult<TData>;
}

export interface AgentPipelineHooks<TData> {
  onTaskChange?: (task: AgentTaskRecord, data: TData) => Promise<void> | void;
  onTimelineChange?: (timeline: AgentTimelineEntry[], data: TData) => Promise<void> | void;
  onError?: (task: AgentTaskRecord, error: unknown, data: TData) => Promise<void> | void;
}

export interface AgentPipelineOptions<TData> extends AgentPipelineHooks<TData> {
  agentKey: string;
  title: string;
  initialStage: string;
  initialMessage: string;
  completionStage: string;
  completionSummary: string | ((data: TData) => string);
  initialData: TData;
  stages: AgentPipelineStage<TData>[];
}

export interface AgentPipelineResult<TData> {
  task: AgentTaskRecord;
  timeline: AgentTimelineEntry[];
  data: TData;
}

export interface AgentTaskDraft {
  agentKey: string;
  title: string;
  status: AgentTaskStatus;
  stage: string;
  timestamp: string;
  summary?: string;
  metadata?: Record<string, string | number | boolean | null>;
}
