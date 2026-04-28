import { type JSX, useEffect, useMemo, useState } from 'react';

import type {
  TopicAnalysisReport,
  TopicExecutionHistory,
  TopicSubscription,
  TopicTrackingSnapshot,
} from '@shared/types';

interface TopicTrackingWorkbenchProps {
  topicTracking: TopicTrackingSnapshot;
  onSnapshotChange: (snapshot: TopicTrackingSnapshot) => void;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
}

interface TopicFormState {
  id?: string;
  name: string;
  query: string;
  description: string;
  scheduleTime: string;
  enabled: boolean;
  maxResultsPerRun: number;
}

const DEFAULT_FORM: TopicFormState = {
  name: '',
  query: '',
  description: '',
  scheduleTime: '09:00',
  enabled: true,
  maxResultsPerRun: 5,
};

/**
 * @function TopicTrackingWorkbench
 * @description 提供主题订阅维护、多论文聚合分析、定时抓取与执行历史查看界面。
 * @param {TopicTrackingWorkbenchProps} props 组件属性
 * @returns {JSX.Element} 主题追踪工作台界面
 */
export function TopicTrackingWorkbench(props: TopicTrackingWorkbenchProps): JSX.Element {
  const [form, setForm] = useState<TopicFormState>(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [runningTopicId, setRunningTopicId] = useState('');
  const [isRunningScheduler, setIsRunningScheduler] = useState(false);

  const latestReportMap = useMemo(
    () => new Map(props.topicTracking.reports.map((report) => [report.topicId, report])),
    [props.topicTracking.reports],
  );

  useEffect(() => {
    if (!props.topicTracking.subscriptions.length) {
      setForm(DEFAULT_FORM);
      return;
    }

    const current = form.id
      ? props.topicTracking.subscriptions.find((subscription) => subscription.id === form.id) ?? null
      : null;

    if (!current && !form.name && props.topicTracking.subscriptions[0]) {
      setForm(createFormState(props.topicTracking.subscriptions[0]));
    }
  }, [form.id, form.name, props.topicTracking.subscriptions]);

  /**
   * @function handleSaveSubscription
   * @description 保存当前主题订阅表单，并回写最新主题追踪快照。
   * @param {void} 无需参数
   * @returns {Promise<void>} 保存结果
   */
  async function handleSaveSubscription(): Promise<void> {
    setIsSaving(true);

    try {
      const snapshot = await window.desktopApi.saveTopicSubscription({
        id: form.id,
        name: form.name,
        query: form.query,
        description: form.description,
        scheduleTime: form.scheduleTime,
        enabled: form.enabled,
        maxResultsPerRun: form.maxResultsPerRun,
      });
      props.onSnapshotChange(snapshot);
      const saved = snapshot.subscriptions.find((subscription) => subscription.id === form.id) ?? snapshot.subscriptions[0];
      setForm(saved ? createFormState(saved) : DEFAULT_FORM);
      props.onNotify({
        tone: 'success',
        message: `主题订阅“${form.name || saved?.name || '未命名主题'}”已保存`,
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '主题订阅保存失败',
      });
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * @function handleRunTopic
   * @description 立即执行指定主题的抓取与聚合分析，并同步界面快照。
   * @param {TopicSubscription} subscription 目标主题订阅
   * @returns {Promise<void>} 执行结果
   */
  async function handleRunTopic(subscription: TopicSubscription): Promise<void> {
    setRunningTopicId(subscription.id);

    try {
      const result = await window.desktopApi.runTopicAnalysis(subscription.id);
      const snapshot = await window.desktopApi.getTopicTracking();
      props.onSnapshotChange(snapshot);
      setForm(createFormState(result.subscription));
      props.onNotify({
        tone: 'success',
        message: `${subscription.name} 已完成多论文聚合分析`,
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '主题聚合分析失败',
      });
    } finally {
      setRunningTopicId('');
    }
  }

  /**
   * @function handleRunScheduler
   * @description 强制执行一次所有启用主题的每日抓取任务，便于人工验证调度行为。
   * @param {void} 无需参数
   * @returns {Promise<void>} 执行结果
   */
  async function handleRunScheduler(): Promise<void> {
    setIsRunningScheduler(true);

    try {
      const snapshot = await window.desktopApi.runTopicScheduler(true);
      props.onSnapshotChange(snapshot);
      props.onNotify({
        tone: 'success',
        message: '已执行一次每日定时抓取检查',
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '定时抓取执行失败',
      });
    } finally {
      setIsRunningScheduler(false);
    }
  }

  /**
   * @function handleDeleteTopic
   * @description 删除指定主题订阅，并在界面中恢复默认编辑状态。
   * @param {TopicSubscription} subscription 目标主题订阅
   * @returns {Promise<void>} 删除结果
   */
  async function handleDeleteTopic(subscription: TopicSubscription): Promise<void> {
    try {
      const snapshot = await window.desktopApi.deleteTopicSubscription(subscription.id);
      props.onSnapshotChange(snapshot);
      setForm(snapshot.subscriptions[0] ? createFormState(snapshot.subscriptions[0]) : DEFAULT_FORM);
      props.onNotify({
        tone: 'success',
        message: `${subscription.name} 已删除`,
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '删除主题订阅失败',
      });
    }
  }

  /**
   * @function handleToggleEnabled
   * @description 切换主题订阅的启用状态，并保留其现有配置。
   * @param {TopicSubscription} subscription 目标主题订阅
   * @returns {Promise<void>} 切换结果
   */
  async function handleToggleEnabled(subscription: TopicSubscription): Promise<void> {
    try {
      const snapshot = await window.desktopApi.saveTopicSubscription({
        ...subscription,
        enabled: !subscription.enabled,
      });
      props.onSnapshotChange(snapshot);
      const next = snapshot.subscriptions.find((item) => item.id === subscription.id);

      if (next) {
        setForm(createFormState(next));
      }

      props.onNotify({
        tone: 'success',
        message: `${subscription.name} 已${subscription.enabled ? '停用' : '启用'}`,
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '主题状态切换失败',
      });
    }
  }

  return (
    <div className="topic-workbench">
      <div className="topic-summary-grid">
        <MetricChip label="订阅主题" value={String(props.topicTracking.summary.totalSubscriptions)} />
        <MetricChip label="启用中" value={String(props.topicTracking.summary.enabledSubscriptions)} />
        <MetricChip label="可查看报告" value={String(props.topicTracking.summary.reportsAvailable)} />
        <MetricChip label="历史记录" value={String(props.topicTracking.summary.historyCount)} />
      </div>

      <article className="topic-card topic-form-card">
        <div className="paper-card-header">
          <div>
            <p className="eyebrow">Task 5</p>
            <h3>主题订阅配置</h3>
          </div>
          <div className="badge-row">
            <span className={`status-badge ${props.topicTracking.scheduler.isRunning ? 'status-running' : 'status-idle'}`}>
              {props.topicTracking.scheduler.isRunning ? '调度中' : '未启动'}
            </span>
          </div>
        </div>

        <div className="filter-grid topic-form-grid">
          <label className="field topic-form-pair-field">
            <span>主题名称</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：RAG for scientific discovery"
            />
          </label>
          <label className="field topic-form-pair-field">
            <span>检索词</span>
            <input
              value={form.query}
              onChange={(event) => setForm((current) => ({ ...current, query: event.target.value }))}
              placeholder="输入用于每日抓取的主题检索词"
            />
          </label>
          <label className="field topic-form-pair-field">
            <span>每日执行时间</span>
            <input
              type="time"
              value={form.scheduleTime}
              onChange={(event) => setForm((current) => ({ ...current, scheduleTime: event.target.value }))}
            />
          </label>
          <label className="field topic-form-pair-field">
            <span>单次抓取数量</span>
            <input
              type="number"
              min={3}
              max={8}
              value={form.maxResultsPerRun}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  maxResultsPerRun: Number(event.target.value) || DEFAULT_FORM.maxResultsPerRun,
                }))
              }
            />
          </label>
        </div>

        <label className="field field-wide">
          <span>主题说明</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="记录该主题的研究问题、关注指标或阅读目标"
          />
        </label>

        <div className="toggle-row">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>启用每日定时抓取</span>
          </label>
          <span className="muted">下一次轮询检查：{formatDateTime(props.topicTracking.scheduler.nextCheckAt)}</span>
        </div>

        <div className="action-row topic-form-toolbar">
          <button type="button" className="primary-button" onClick={() => void handleSaveSubscription()} disabled={isSaving}>
            {isSaving ? '保存中...' : form.id ? '更新主题订阅' : '创建主题订阅'}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setForm(DEFAULT_FORM);
            }}
          >
            新建主题
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleRunScheduler()} disabled={isRunningScheduler}>
            {isRunningScheduler ? '执行中...' : '立即执行每日抓取'}
          </button>
        </div>
      </article>

      <div className="topic-subscription-list">
        {props.topicTracking.subscriptions.length ? (
          props.topicTracking.subscriptions.map((subscription) => (
            <TopicSubscriptionCard
              key={subscription.id}
              subscription={subscription}
              latestReport={latestReportMap.get(subscription.id) ?? null}
              isRunning={runningTopicId === subscription.id}
              onEdit={() => {
                setForm(createFormState(subscription));
              }}
              onRun={() => void handleRunTopic(subscription)}
              onToggleEnabled={() => void handleToggleEnabled(subscription)}
              onDelete={() => void handleDeleteTopic(subscription)}
            />
          ))
        ) : (
          <p className="muted">当前还没有主题订阅。创建订阅后即可查看聚合分析与每日执行历史。</p>
        )}
      </div>

      <div className="topic-report-list">
        {props.topicTracking.reports.length ? (
          props.topicTracking.reports.map((report) => <TopicReportCard key={report.id} report={report} />)
        ) : (
          null
        )}
      </div>

      <article className="topic-card">
        <div className="paper-card-header">
          <h3>执行历史</h3>
        </div>
        <div className="topic-history-list">
          {props.topicTracking.history.length ? (
            props.topicTracking.history.map((history) => <TopicHistoryRow key={history.id} history={history} />)
          ) : (
            <p className="muted">暂无执行历史记录。</p>
          )}
        </div>
      </article>
    </div>
  );
}

interface MetricChipProps {
  label: string;
  value: string;
}

/**
 * @function MetricChip
 * @description 展示主题追踪概览指标。
 * @param {MetricChipProps} props 组件属性
 * @returns {JSX.Element} 指标卡片
 */
function MetricChip(props: MetricChipProps): JSX.Element {
  return (
    <article className="topic-card topic-metric-chip">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

interface TopicSubscriptionCardProps {
  subscription: TopicSubscription;
  latestReport: TopicAnalysisReport | null;
  isRunning: boolean;
  onEdit: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

/**
 * @function TopicSubscriptionCard
 * @description 展示单个主题订阅的配置摘要、最近结果与操作按钮。
 * @param {TopicSubscriptionCardProps} props 组件属性
 * @returns {JSX.Element} 订阅卡片
 */
function TopicSubscriptionCard(props: TopicSubscriptionCardProps): JSX.Element {
  return (
    <article className="topic-card">
      <div className="topic-subscription-compact-row">
        <div className="topic-compact-cell">
          <span>名称</span>
          <strong>{props.subscription.name}</strong>
        </div>
        <div className="topic-compact-cell">
          <span>检索词</span>
          <strong className="ellipsis-text">{props.subscription.query}</strong>
        </div>
        <div className="topic-compact-cell topic-compact-cell-status">
          <span>状态</span>
          <div className="badge-row">
            <span className={`status-badge ${props.subscription.enabled ? 'status-ready' : 'status-idle'}`}>
              {props.subscription.enabled ? '已启用' : '已停用'}
            </span>
          </div>
        </div>
        <div className="topic-compact-cell topic-compact-cell-time">
          <span>时间</span>
          <div className="badge-row">
            <span className="status-badge status-running">{props.subscription.scheduleTime}</span>
          </div>
        </div>
      </div>

      <div className="topic-subscription-secondary-row">
        <div className="topic-inline-summary topic-inline-summary-compact">
          <strong>最新摘要</strong>
          <p>{props.subscription.lastResultSummary}</p>
          {props.latestReport ? <small>{props.latestReport.overview}</small> : null}
        </div>
        <div className="detail-list topic-subscription-detail-grid">
          <div className="detail-row">
            <span>最近执行</span>
            <strong>{formatDateTime(props.subscription.lastRunAt)}</strong>
          </div>
          <div className="detail-row">
            <span>抓取上限</span>
            <strong>{String(props.subscription.maxResultsPerRun)}</strong>
          </div>
          <div className="detail-row">
            <span>累计跟踪论文</span>
            <strong>{String(props.subscription.paperIds.length)}</strong>
          </div>
        </div>
      </div>

      <p className="paper-abstract">{props.subscription.description || '当前未填写主题说明。'}</p>

      <div className="action-row">
        <button type="button" className="primary-button" onClick={props.onRun} disabled={props.isRunning}>
          {props.isRunning ? '聚合中...' : '立即聚合'}
        </button>
        <button type="button" className="ghost-button" onClick={props.onEdit}>
          载入编辑
        </button>
        <button type="button" className="ghost-button" onClick={props.onToggleEnabled}>
          {props.subscription.enabled ? '停用调度' : '启用调度'}
        </button>
        <button type="button" className="danger-button" onClick={props.onDelete}>
          删除
        </button>
      </div>
    </article>
  );
}

interface TopicReportCardProps {
  report: TopicAnalysisReport;
}

/**
 * @function TopicReportCard
 * @description 展示主题级聚合报告的摘要、高亮、章节与推荐阅读结果。
 * @param {TopicReportCardProps} props 组件属性
 * @returns {JSX.Element} 主题报告卡片
 */
function TopicReportCard(props: TopicReportCardProps): JSX.Element {
  return (
    <article className="topic-card topic-report-card">
      <div className="paper-card-header">
        <div>
          <p className="eyebrow">主题报告</p>
          <h3>{props.report.topicName}</h3>
          <p>{props.report.overview}</p>
        </div>
        <div className="badge-row">
          <span className={`status-badge ${props.report.trigger === 'scheduled' ? 'status-ready' : 'status-running'}`}>
            {props.report.trigger === 'scheduled' ? '定时抓取' : '手动执行'}
          </span>
        </div>
      </div>

      <div className="topic-highlight-list">
        {props.report.highlights.map((highlight) => (
          <p key={highlight} className="topic-highlight-item">
            {highlight}
          </p>
        ))}
      </div>

      <div className="topic-section-grid">
        {props.report.sections.map((section) => (
          <article key={`${props.report.id}-${section.title}`} className="topic-section-card">
            <h4>{section.title}</h4>
            <p>{section.summary}</p>
            <div className="analysis-bullet-list">
              {section.bullets.map((bullet) => (
                <p key={bullet} className="analysis-bullet-item">
                  {bullet}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="detail-list">
        <div className="detail-row">
          <span>生成时间</span>
          <strong>{formatDateTime(props.report.generatedAt)}</strong>
        </div>
        <div className="detail-row">
          <span>报告文件</span>
          <strong>{props.report.filePath}</strong>
        </div>
      </div>
    </article>
  );
}

interface TopicHistoryRowProps {
  history: TopicExecutionHistory;
}

/**
 * @function TopicHistoryRow
 * @description 展示单条主题执行历史的时间、状态和摘要结果。
 * @param {TopicHistoryRowProps} props 组件属性
 * @returns {JSX.Element} 历史记录行
 */
function TopicHistoryRow(props: TopicHistoryRowProps): JSX.Element {
  return (
    <article className="timeline-item topic-history-row">
      <strong className="ellipsis-text">{props.history.topicName}</strong>
      <p className="ellipsis-text">{props.history.summary}</p>
      <span className={`status-badge status-${props.history.status}`}>{props.history.status}</span>
      <small>
        {props.history.trigger === 'scheduled' ? '定时' : '手动'} · {formatDateTime(props.history.startedAt)}
      </small>
    </article>
  );
}

/**
 * @function createFormState
 * @description 将订阅记录转换为表单状态，便于在界面中编辑。
 * @param {TopicSubscription} subscription 主题订阅
 * @returns {TopicFormState} 表单状态
 */
function createFormState(subscription: TopicSubscription): TopicFormState {
  return {
    id: subscription.id,
    name: subscription.name,
    query: subscription.query,
    description: subscription.description,
    scheduleTime: subscription.scheduleTime,
    enabled: subscription.enabled,
    maxResultsPerRun: subscription.maxResultsPerRun,
  };
}

/**
 * @function formatDateTime
 * @description 将时间字符串格式化为中文可读时间。
 * @param {string | null} value 原始时间
 * @returns {string} 格式化后的时间文本
 */
function formatDateTime(value: string | null): string {
  if (!value) {
    return '尚未执行';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}
