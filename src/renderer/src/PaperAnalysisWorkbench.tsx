import { type JSX, useEffect, useMemo, useState } from 'react';

import type {
  AnalysisConversationMessage,
  CodeExperimentVerification,
  PaperAnalysisRecord,
  PaperAnalysisSection,
  PaperLibraryPayload,
} from '@shared/types';

interface PaperAnalysisWorkbenchProps {
  library: PaperLibraryPayload;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
  onRefreshLibrary: () => Promise<void>;
}

/**
 * @function PaperAnalysisWorkbench
 * @description 提供单篇论文 AI 深度分析、联网增强结果浏览与追问面板。
 * @param {PaperAnalysisWorkbenchProps} props 组件属性
 * @returns {JSX.Element} 单篇分析工作台界面
 */
export function PaperAnalysisWorkbench(props: PaperAnalysisWorkbenchProps): JSX.Element {
  const { library, onNotify, onRefreshLibrary } = props;
  const availablePapers = useMemo(() => library.papers.filter((paper) => paper.localPdfPath), [library.papers]);
  const [selectedPaperId, setSelectedPaperId] = useState(availablePapers[0]?.id ?? '');
  const [report, setReport] = useState<PaperAnalysisRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [followupQuestion, setFollowupQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);

  useEffect(() => {
    if (!availablePapers.length) {
      setSelectedPaperId('');
      setReport(null);
      return;
    }

    if (!availablePapers.some((paper) => paper.id === selectedPaperId)) {
      setSelectedPaperId(availablePapers[0]?.id ?? '');
    }
  }, [availablePapers, selectedPaperId]);

  useEffect(() => {
    /**
     * @function loadExistingReport
     * @description 在切换论文后读取已保存的分析结果，避免用户重复执行分析。
     * @param {void} 无需参数
     * @returns {Promise<void>} 加载结果
     */
    async function loadExistingReport(): Promise<void> {
      if (!selectedPaperId) {
        setReport(null);
        return;
      }

      setIsLoading(true);

      try {
        const nextReport = await window.desktopApi.getPaperAnalysis(selectedPaperId);
        setReport(nextReport);
      } catch (error) {
        onNotify({
          tone: 'error',
          message: error instanceof Error ? error.message : '分析结果加载失败',
        });
      } finally {
        setIsLoading(false);
      }
    }

    void loadExistingReport();
  }, [onNotify, selectedPaperId]);

  /**
   * @function handleRunAnalysis
   * @description 执行当前选中论文的深度分析，并刷新论文库中的分析状态。
   * @param {void} 无需参数
   * @returns {Promise<void>} 执行结果
   */
  async function handleRunAnalysis(): Promise<void> {
    if (!selectedPaperId) {
      return;
    }

    setIsRunning(true);

    try {
      const result = await window.desktopApi.runPaperAnalysis(selectedPaperId);
      setReport(result.report);

      // 关键逻辑：分析完成后刷新论文库，确保列表页与工作台中的分析状态保持一致。
      await onRefreshLibrary();
      onNotify({
        tone: 'success',
        message: `${result.report.paperTitle} 的结构化分析已生成`,
      });
    } catch (error) {
      await onRefreshLibrary();
      onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '深度分析执行失败',
      });
    } finally {
      setIsRunning(false);
    }
  }

  /**
   * @function handleAskQuestion
   * @description 基于已保存的分析结果执行追问并更新对话历史。
   * @param {void} 无需参数
   * @returns {Promise<void>} 追问结果
   */
  async function handleAskQuestion(): Promise<void> {
    if (!selectedPaperId || !followupQuestion.trim()) {
      return;
    }

    setIsAsking(true);

    try {
      const reply = await window.desktopApi.askPaperAnalysisQuestion({
        paperId: selectedPaperId,
        question: followupQuestion.trim(),
      });
      setReport(reply.report);
      setFollowupQuestion('');
    } catch (error) {
      onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '追问失败',
      });
    } finally {
      setIsAsking(false);
    }
  }

  if (!availablePapers.length) {
    return <p className="muted">请先在论文库中下载至少一篇 PDF，随后即可执行单篇论文深度分析。</p>;
  }

  return (
    <div className="analysis-workbench">
      <div className="analysis-toolbar">
        <label className="field field-wide">
          <span>选择论文</span>
          <select value={selectedPaperId} onChange={(event) => setSelectedPaperId(event.target.value)}>
            {availablePapers.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paper.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary-button" onClick={() => void handleRunAnalysis()} disabled={isRunning || isLoading}>
          {isRunning ? '分析中...' : '执行深度分析'}
        </button>
      </div>

      {isLoading ? <p className="muted">正在读取历史分析结果...</p> : null}

      {report ? (
        <div className="analysis-layout">
          <div className="analysis-main">
            <article className="analysis-summary-card">
              <p className="eyebrow">Task 4</p>
              <h3>{report.paperTitle}</h3>
              <p className="paper-abstract">已生成结构化分析，覆盖动机、难点、现状、方法、实验与结果，并附带代码验证记录。</p>
              <div className="detail-list">
                <div className="detail-row">
                  <span>生成时间</span>
                  <strong>{formatDate(report.generatedAt)}</strong>
                </div>
                <div className="detail-row">
                  <span>联网查询</span>
                  <strong>{report.searchQueries.join(' / ') || '未生成'}</strong>
                </div>
                <div className="detail-row">
                  <span>外部线索</span>
                  <strong>{String(report.internetHits.length)}</strong>
                </div>
              </div>
            </article>

            <div className="analysis-section-list">
              {report.sections.map((section) => (
                <AnalysisSectionCard key={section.key} section={section} />
              ))}
            </div>

            <VerificationCard verification={report.verification} />
          </div>

          <div className="analysis-side">
            <article className="analysis-side-card">
              <h3>联网增强线索</h3>
              <div className="analysis-hit-list">
                {report.internetHits.length ? (
                  report.internetHits.map((hit) => (
                    <a key={`${hit.source}-${hit.url}`} className="analysis-hit-card" href={hit.url} target="_blank" rel="noreferrer">
                      <strong>{hit.title}</strong>
                      <span>{hit.source}{hit.publishedAt ? ` · ${hit.publishedAt}` : ''}</span>
                      <p>{hit.snippet}</p>
                    </a>
                  ))
                ) : (
                  <p className="muted">本次分析未获取到稳定的外部相关工作摘要。</p>
                )}
              </div>
            </article>

            <article className="analysis-side-card">
              <h3>阅读上下文</h3>
              <div className="detail-list">
                <div className="detail-row">
                  <span>笔记摘录</span>
                  <strong>{report.readerContext.noteExcerpt || '暂无'}</strong>
                </div>
                <div className="detail-row">
                  <span>批注数量</span>
                  <strong>{String(report.readerContext.annotationQuotes.length)}</strong>
                </div>
              </div>
              <div className="analysis-quote-list">
                {report.readerContext.annotationQuotes.length ? (
                  report.readerContext.annotationQuotes.map((quote) => (
                    <p key={quote} className="analysis-quote-item">
                      {quote}
                    </p>
                  ))
                ) : (
                  <p className="muted">当前尚未记录阅读批注。</p>
                )}
              </div>
            </article>

            <article className="analysis-side-card">
              <h3>分析追问</h3>
              <div className="analysis-question-form">
                <textarea
                  rows={4}
                  value={followupQuestion}
                  onChange={(event) => setFollowupQuestion(event.target.value)}
                  placeholder="例如：作者的方法相对现有工作最大的优势是什么？"
                />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void handleAskQuestion()}
                  disabled={isAsking || !followupQuestion.trim()}
                >
                  {isAsking ? '追问中...' : '提交追问'}
                </button>
              </div>

              <ConversationList conversation={report.conversation} />
            </article>
          </div>
        </div>
      ) : (
        <p className="muted">当前论文尚未生成深度分析，点击“执行深度分析”即可创建结构化输出与实验验证记录。</p>
      )}
    </div>
  );
}

interface AnalysisSectionCardProps {
  section: PaperAnalysisSection;
}

/**
 * @function AnalysisSectionCard
 * @description 展示单个结构化分析章节的摘要、要点与证据列表。
 * @param {AnalysisSectionCardProps} props 组件属性
 * @returns {JSX.Element} 章节卡片
 */
function AnalysisSectionCard(props: AnalysisSectionCardProps): JSX.Element {
  return (
    <article className="analysis-section-card">
      <div className="paper-card-header">
        <h3>{props.section.title}</h3>
      </div>
      <p className="paper-abstract">{props.section.summary}</p>
      <div className="analysis-bullet-list">
        {props.section.bullets.map((bullet) => (
          <p key={bullet} className="analysis-bullet-item">
            {bullet}
          </p>
        ))}
      </div>
      <div className="analysis-evidence-list">
        {props.section.evidence.map((evidence) => (
          <p key={evidence} className="muted">
            {evidence}
          </p>
        ))}
      </div>
    </article>
  );
}

interface VerificationCardProps {
  verification: CodeExperimentVerification;
}

/**
 * @function VerificationCard
 * @description 展示代码仓库定位、依赖检查、执行尝试与失败反馈记录。
 * @param {VerificationCardProps} props 组件属性
 * @returns {JSX.Element} 代码验证卡片
 */
function VerificationCard(props: VerificationCardProps): JSX.Element {
  return (
    <article className="analysis-section-card">
      <div className="paper-card-header">
        <div>
          <h3>代码实验验证</h3>
          <p>{props.verification.summary}</p>
        </div>
        <span className={`status-badge status-${props.verification.status}`}>{props.verification.status}</span>
      </div>
      <div className="detail-list">
        <div className="detail-row">
          <span>候选仓库</span>
          <strong>{props.verification.repositoryName ?? '未识别'}</strong>
        </div>
        <div className="detail-row">
          <span>仓库链接</span>
          <strong>{props.verification.repositoryUrl ?? '未提供'}</strong>
        </div>
        <div className="detail-row">
          <span>失败原因</span>
          <strong>{props.verification.failureReason ?? '无'}</strong>
        </div>
      </div>
      <div className="analysis-step-list">
        {props.verification.steps.map((step) => (
          <article key={`${step.stage}-${step.detail}`} className="analysis-step-card">
            <div className="paper-card-header">
              <strong>{step.stage}</strong>
              <span className={`status-badge status-${step.status}`}>{step.status}</span>
            </div>
            <p className="paper-abstract">{step.detail}</p>
            {step.command ? <p className="muted">候选命令：{step.command}</p> : null}
            {step.output ? <p className="muted">输出：{step.output}</p> : null}
          </article>
        ))}
      </div>
    </article>
  );
}

interface ConversationListProps {
  conversation: AnalysisConversationMessage[];
}

/**
 * @function ConversationList
 * @description 展示分析追问历史，帮助用户回看上下文。
 * @param {ConversationListProps} props 组件属性
 * @returns {JSX.Element} 追问消息列表
 */
function ConversationList(props: ConversationListProps): JSX.Element {
  return (
    <div className="analysis-conversation-list">
      {props.conversation.length ? (
        props.conversation.map((message) => (
          <article
            key={message.id}
            className={message.role === 'assistant' ? 'reader-chat-message reader-chat-message-assistant' : 'reader-chat-message reader-chat-message-user'}
          >
            <small>{message.role === 'assistant' ? '分析助手' : '你'} · {formatDate(message.createdAt)}</small>
            <p>{message.content}</p>
            {message.references.length ? <small>引用：{message.references.join(' / ')}</small> : null}
          </article>
        ))
      ) : (
        <p className="muted">分析完成后可继续追问方法细节、实验设置或代码验证原因。</p>
      )}
    </div>
  );
}

/**
 * @function formatDate
 * @description 将 ISO 时间转换为中文本地时间字符串。
 * @param {string} value ISO 时间
 * @returns {string} 格式化时间
 */
function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}
