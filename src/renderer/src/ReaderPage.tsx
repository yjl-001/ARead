import { cloneElement, Component, isValidElement, type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SpecialZoomLevel, Viewer, Worker } from '@react-pdf-viewer/core';
import type { DocumentLoadEvent, PageChangeEvent, ZoomEvent } from '@react-pdf-viewer/core';
import { MessageIcon, Trigger, highlightPlugin } from '@react-pdf-viewer/highlight';
import type {
  HighlightArea,
  RenderHighlightContentProps,
  RenderHighlightTargetProps,
  RenderHighlightsProps,
} from '@react-pdf-viewer/highlight';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { zoomPlugin } from '@react-pdf-viewer/zoom';

import type {
  PaperLibraryPayload,
  PaperMutationInput,
  ReaderAnnotation,
  PaperRecord,
  ReaderAnnotationColor,
  ReaderAssistantSession,
  ReaderHighlightArea,
  ReaderSession,
} from '@shared/types';

import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/highlight/lib/styles/index.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

interface ReaderPageProps {
  library: PaperLibraryPayload;
  onSyncPaper: (paperId: string, patch: PaperMutationInput) => Promise<void>;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
}

interface ReaderPdfPanelProps {
  paper: PaperRecord;
  session: ReaderSession;
  currentPage: number;
  zoom: number;
  annotationColor: ReaderAnnotationColor;
  activeAnnotationId: string | null;
  jumpRequest: ReaderAnnotationJumpRequest | null;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onDocumentLoad: (totalPages: number) => void;
  onSessionChange: (session: ReaderSession) => void;
  onActivateAnnotation: (annotationId: string | null) => void;
  onEditAnnotation: (annotation: ReaderAnnotation) => void;
  onAskAssistantFromSelection: (selection: ReaderAssistantSelectionContext) => void;
  onAskAssistantFromAnnotation: (annotation: ReaderAnnotation) => void;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
}

interface ReaderSidebarProps {
  paper: PaperRecord;
  session: ReaderSession;
  currentPage: number;
  noteDraft: string;
  noteFeedbackNonce: number;
  isSavingNote: boolean;
  annotationDraft: ReaderAnnotationDraft;
  isSavingAnnotation: boolean;
  activeAnnotationId: string | null;
  editingAnnotationId: string | null;
  activePanel: ReaderInspectorPanel;
  isVisible: boolean;
  isRailVisible: boolean;
  children: ReactNode;
  onAnnotationDraftChange: (patch: Partial<ReaderAnnotationDraft>) => void;
  onSaveAnnotation: () => Promise<void>;
  onSelectAnnotation: (annotation: ReaderAnnotation) => void;
  onCancelAnnotationEdit: () => void;
  onNoteDraftChange: (value: string) => void;
  onSaveNote: () => Promise<void>;
  onRemoveNote: (entryIndex: number) => Promise<void>;
  onSessionChange: (session: ReaderSession) => void;
  onOpenPanel: (panel: ReaderInspectorPanel) => void;
  onToggleRail: () => void;
  onRemoveAnnotation: (annotationId: string) => Promise<void>;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
}

interface ReaderAssistantPanelProps {
  paper: PaperRecord;
  session: ReaderSession;
  currentPage: number;
  assistantSelection: ReaderAssistantSelectionContext | null;
  onSessionChange: (session: ReaderSession) => void;
  onActivateAnnotation: (annotationId: string | null) => void;
  onJumpToPage: (page: number) => void;
  onClearSelection: () => void;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
  onBusyChange: (isBusy: boolean) => void;
}

type ReaderInspectorPanel = 'annotations' | 'notes' | 'assistant';

interface ReaderAnnotationDraft {
  pageNumber: string;
  quote: string;
  note: string;
  color: ReaderAnnotationColor;
  highlightAreas: ReaderHighlightArea[];
}

interface ReaderAnnotationJumpRequest {
  annotationId: string;
  nonce: number;
}

interface ReaderInlineAnnotationDraft {
  pageNumber: number;
  quote: string;
  note: string;
  color: ReaderAnnotationColor;
  highlightAreas: ReaderHighlightArea[];
  selectionRegion: HighlightArea;
}

interface ReaderAssistantSelectionContext {
  pageNumber: number;
  quote: string;
  color: ReaderAnnotationColor;
  highlightAreas: ReaderHighlightArea[];
  linkedAnnotationCount: number;
  sourceAnnotationId: string | null;
}

interface InlineAnnotationComposerProps {
  draft: ReaderInlineAnnotationDraft;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (draft: ReaderInlineAnnotationDraft) => void;
}

interface MarginAnnotationPosition {
  x: number;
  y: number;
  column: 'left' | 'right';
}

interface MarginAnnotationConnector {
  annotationId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface DraggableMarginAnnotationProps {
  annotation: ReaderAnnotation;
  isActive: boolean;
  isCollapsed: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isFocused: boolean;
  previewText: string;
  position: MarginAnnotationPosition;
  onOpen: (annotation: ReaderAnnotation) => void;
  onAskAssistant: (annotation: ReaderAnnotation) => void;
  onHoverChange: (annotationId: string | null) => void;
  onDragStateChange: (annotationId: string, isDragging: boolean) => void;
  onAssistantTargetHover: (annotationId: string, isHovering: boolean) => void;
  onToggleCollapse: (annotationId: string) => void;
  onPositionChange: (annotationId: string, position: MarginAnnotationPosition) => void;
  onPositionCommit: (annotationId: string, position: MarginAnnotationPosition) => void;
  onStartEdit: (annotation: ReaderAnnotation) => void;
  onCancelEdit: () => void;
  onDraftColorChange: (color: ReaderAnnotationColor) => void;
  onDraftNoteChange: (value: string) => void;
  onElementChange: (annotationId: string, element: HTMLElement | null) => void;
  draftColor: ReaderAnnotationColor;
  draftNote: string;
  assistantDropTargetRect: DOMRect | null;
}

interface PdfViewerErrorBoundaryProps {
  resetKey: string;
  onError: (message: string) => void;
  children: ReactNode;
}

interface PdfViewerErrorBoundaryState {
  hasError: boolean;
}

class PdfViewerErrorBoundary extends Component<PdfViewerErrorBoundaryProps, PdfViewerErrorBoundaryState> {
  public constructor(props: PdfViewerErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
    };
  }

  public static getDerivedStateFromError(): PdfViewerErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  public componentDidCatch(error: unknown): void {
    console.error('PdfViewerErrorBoundary', error);
    this.props.onError(error instanceof Error ? error.message : 'react-pdf-viewer 运行时异常');
  }

  public componentDidUpdate(previousProps: PdfViewerErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({
        hasError: false,
      });
    }
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}

function InlineAnnotationComposer(props: InlineAnnotationComposerProps): JSX.Element {
  const [note, setNote] = useState(props.draft.note);
  const [color, setColor] = useState<ReaderAnnotationColor>(props.draft.color);

  useEffect(() => {
    setNote(props.draft.note);
    setColor(props.draft.color);
  }, [props.draft]);

  return (
    <div className="reader-inline-annotation-composer">
      <div className="reader-inline-annotation-header">
        <strong>保存高亮批注</strong>
        <span>第 {props.draft.pageNumber} 页</span>
      </div>
      <p className="reader-inline-annotation-quote">“{props.draft.quote}”</p>
      <label className="field">
        <span>备注</span>
        <textarea
          rows={4}
          className="reader-inline-annotation-textarea"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          placeholder="写下你的理解、问题或后续行动。"
          autoFocus
        />
      </label>
      <div className="reader-inline-annotation-colors">
        {(['yellow', 'blue', 'pink', 'mint'] as ReaderAnnotationColor[]).map((nextColor) => (
          <button
            key={nextColor}
            type="button"
            className={
              color === nextColor
                ? `reader-color-swatch reader-color-swatch-${nextColor} reader-color-swatch-active`
                : `reader-color-swatch reader-color-swatch-${nextColor}`
            }
            onClick={() => {
              setColor(nextColor);
            }}
            aria-label={`切换为${getAnnotationColorLabel(nextColor)}高亮`}
          />
        ))}
      </div>
      <div className="reader-inline-annotation-actions">
        <button type="button" className="ghost-button" onClick={props.onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={props.isSaving}
          onClick={() =>
            props.onSave({
              ...props.draft,
              note: note.trim(),
              color,
            })
          }
        >
          {props.isSaving ? '保存中...' : '直接保存'}
        </button>
      </div>
    </div>
  );
}

/**
 * @function DraggableMarginAnnotation
 * @description 渲染可拖拽的页边批注卡片，并在拖拽到 AI 目标时触发提问入口。
 * @param {DraggableMarginAnnotationProps} props 批注卡片展示、编辑与拖拽交互所需参数
 * @returns {JSX.Element} 单个页边批注卡片节点
 */
function DraggableMarginAnnotation(props: DraggableMarginAnnotationProps): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    hasMoved: boolean;
  } | null>(null);

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if ((event.target as HTMLElement).closest('button, textarea, input, select')) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: props.position.x,
      startY: props.position.y,
      hasMoved: false,
    };
    setIsDragging(true);
    props.onDragStateChange(props.annotation.id, true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>): void {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragStateRef.current.startClientX;
    const deltaY = event.clientY - dragStateRef.current.startClientY;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragStateRef.current.hasMoved = true;
    }

    props.onAssistantTargetHover(
      props.annotation.id,
      isPointWithinRect(event.clientX, event.clientY, props.assistantDropTargetRect),
    );

    props.onPositionChange(props.annotation.id, {
      ...props.position,
      x: Math.max(-14, Math.min(28, dragStateRef.current.startX + deltaX)),
      y: Math.max(0, dragStateRef.current.startY + deltaY),
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>): void {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragStateRef.current.startClientX;
    const deltaY = event.clientY - dragStateRef.current.startClientY;
    const isDroppingIntoAssistant = isPointWithinRect(event.clientX, event.clientY, props.assistantDropTargetRect);
    const currentPosition = {
      ...props.position,
      x: Math.max(-14, Math.min(28, dragStateRef.current.startX + deltaX)),
      y: Math.max(0, dragStateRef.current.startY + deltaY),
    };
    const shouldOpen = !dragStateRef.current.hasMoved;
    dragStateRef.current = null;
    setIsDragging(false);
    props.onDragStateChange(props.annotation.id, false);
    props.onAssistantTargetHover(props.annotation.id, false);
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (shouldOpen) {
      props.onOpen(props.annotation);
      return;
    }

    if (isDroppingIntoAssistant) {
      props.onPositionCommit(props.annotation.id, {
        ...props.position,
        x: currentPosition.x - deltaX,
        y: currentPosition.y - deltaY,
      });
      props.onAskAssistant(props.annotation);
      return;
    }

    props.onPositionCommit(props.annotation.id, currentPosition);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLElement>): void {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    setIsDragging(false);
    props.onDragStateChange(props.annotation.id, false);
    props.onAssistantTargetHover(props.annotation.id, false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const connectorLength = 18 + (props.position.column === 'left' ? Math.max(0, props.position.x) : Math.abs(Math.min(0, props.position.x)));
  const cardStyle: CSSProperties & Record<'--reader-margin-annotation-connector-length', string> = {
    transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)`,
    '--reader-margin-annotation-connector-length': `${connectorLength}px`,
  };

  return (
    <article
      className={
        props.isActive
          ? `reader-margin-annotation reader-margin-annotation-${props.annotation.color} reader-margin-annotation-side-${props.position.column} reader-margin-annotation-active${props.isFocused ? ' reader-margin-annotation-focused' : ''}${isDragging ? ' reader-margin-annotation-dragging' : ''}`
          : `reader-margin-annotation reader-margin-annotation-${props.annotation.color} reader-margin-annotation-side-${props.position.column}${props.isFocused ? ' reader-margin-annotation-focused' : ''}${isDragging ? ' reader-margin-annotation-dragging' : ''}`
      }
      style={cardStyle}
      ref={(element) => {
        props.onElementChange(props.annotation.id, element);
      }}
      onMouseEnter={() => {
        props.onHoverChange(props.annotation.id);
      }}
      onMouseLeave={() => {
        if (!isDragging) {
          props.onHoverChange(null);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="reader-margin-annotation-header">
        <div className="reader-margin-annotation-header-meta">
          <span className="reader-margin-annotation-grip">⋮⋮</span>
          <strong>第 {props.annotation.pageNumber} 页</strong>
        </div>
        <div className="reader-margin-annotation-actions">
          <button
            type="button"
            className="reader-margin-annotation-toggle"
            onClick={(event) => {
              event.stopPropagation();
              if (props.isEditing) {
                props.onCancelEdit();
                return;
              }
              props.onStartEdit(props.annotation);
            }}
          >
            {props.isEditing ? '取消' : '编辑'}
          </button>
          <button
            type="button"
            className="reader-margin-annotation-toggle"
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleCollapse(props.annotation.id);
            }}
          >
            {props.isCollapsed ? '展开' : '收起'}
          </button>
        </div>
      </div>
      {props.isEditing ? (
        <div className="reader-margin-annotation-editor">
          <p className="reader-margin-annotation-quote">“{props.annotation.quote}”</p>
          <div className="reader-margin-annotation-editor-colors">
            {(['yellow', 'blue', 'pink', 'mint'] as ReaderAnnotationColor[]).map((color) => (
              <button
                key={color}
                type="button"
                className={
                  props.draftColor === color
                    ? `reader-margin-annotation-swatch reader-margin-annotation-swatch-${color} reader-margin-annotation-swatch-active`
                    : `reader-margin-annotation-swatch reader-margin-annotation-swatch-${color}`
                }
                onClick={(event) => {
                  event.stopPropagation();
                  props.onDraftColorChange(color);
                }}
                aria-label={`切换为${getAnnotationColorLabel(color)}高亮`}
              />
            ))}
          </div>
          <textarea
            rows={4}
            className="reader-margin-annotation-textarea"
            value={props.draftNote}
            onClick={(event) => {
              event.stopPropagation();
            }}
            onChange={(event) => {
              props.onDraftNoteChange(event.target.value);
            }}
            placeholder="写下你的理解、问题或后续行动。"
          />
          <span className="reader-margin-annotation-status">{props.isSaving ? '自动保存中…' : '修改会自动保存'}</span>
        </div>
      ) : props.isCollapsed ? (
        <p className="reader-margin-annotation-preview">{props.previewText}</p>
      ) : (
        <>
          <p className="reader-margin-annotation-quote">“{props.annotation.quote}”</p>
          <p className="reader-margin-annotation-note">{props.annotation.note || '暂无备注'}</p>
        </>
      )}
    </article>
  );
}

/**
 * @function ReaderPage
 * @description 构建沉浸式论文阅读页，集成 PDF 浏览、批注、笔记、进度恢复与 AI 对话面板。
 * @param {ReaderPageProps} props 阅读页所需的论文库与同步能力
 * @returns {JSX.Element} 阅读器页面节点
 */
export function ReaderPage(props: ReaderPageProps): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const downloadablePapers = useMemo(
    () => (Array.isArray(props.library.papers) ? props.library.papers : []).filter((paper) => Boolean(paper.localPdfPath)),
    [props.library.papers],
  );
  const selectedPaperId = searchParams.get('paper') ?? downloadablePapers[0]?.id ?? '';
  const selectedPaper = downloadablePapers.find((paper) => paper.id === selectedPaperId) ?? null;
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteFeedbackNonce, setNoteFeedbackNonce] = useState(0);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<ReaderAnnotationDraft>(createEmptyAnnotationDraft(1));
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [annotationJumpRequest, setAnnotationJumpRequest] = useState<ReaderAnnotationJumpRequest | null>(null);
  const [assistantSelection, setAssistantSelection] = useState<ReaderAssistantSelectionContext | null>(null);
  const [activeInspectorPanel, setActiveInspectorPanel] = useState<ReaderInspectorPanel>('annotations');
  const [isInspectorVisible, setIsInspectorVisible] = useState(false);
  const [isInspectorRailVisible, setIsInspectorRailVisible] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => loadReaderInspectorWidth());
  const [isResizingInspector, setIsResizingInspector] = useState(false);
  const isRailCollapsed = searchParams.get('rail') !== 'open';
  const persistedProgressRef = useRef('');
  const readerContentGridRef = useRef<HTMLDivElement | null>(null);
  const inspectorResizeStateRef = useRef<{
    pointerId: number;
    containerLeft: number;
    containerWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!downloadablePapers.length) {
      return;
    }

    if (!selectedPaperId || !downloadablePapers.some((paper) => paper.id === selectedPaperId)) {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous);
        params.set('paper', downloadablePapers[0].id);
        return params;
      });
    }
  }, [downloadablePapers, selectedPaperId, setSearchParams]);

  useEffect(() => {
    if (!selectedPaper) {
      setSession(null);
      return;
    }

    setIsLoadingSession(true);
    setSessionError('');
    void window.desktopApi
      .getReaderSession(selectedPaper.id)
      .then((nextSession) => {
        setSession(nextSession);
        setCurrentPage(nextSession.progress.currentPage || 1);
        setZoom(nextSession.progress.zoom || 1);
        setTotalPages(nextSession.progress.totalPages || 1);
        setNoteDraft('');
        persistedProgressRef.current = createReaderProgressSignature(
          nextSession.progress.currentPage || 1,
          nextSession.progress.zoom || 1,
          nextSession.progress.totalPages || 1,
        );
        setActiveAnnotationId(null);
        setEditingAnnotationId(null);
        setAnnotationJumpRequest(null);
        setAssistantSelection(null);
        setActiveInspectorPanel('annotations');
        setAnnotationDraft(createEmptyAnnotationDraft(nextSession.progress.currentPage || 1));
      })
      .catch((error: unknown) => {
        setSessionError(error instanceof Error ? error.message : '读取阅读会话失败');
      })
      .finally(() => {
        setIsLoadingSession(false);
      });
  }, [selectedPaper]);

  useEffect(() => {
    if (!selectedPaper || !session) {
      return;
    }

    const nextSignature = createReaderProgressSignature(currentPage, zoom, totalPages);

    if (nextSignature === persistedProgressRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void window.desktopApi
        .saveReaderProgress(selectedPaper.id, {
          currentPage,
          totalPages,
          zoom,
        })
        .then((nextSession) => {
          persistedProgressRef.current = createReaderProgressSignature(
            nextSession.progress.currentPage,
            nextSession.progress.zoom,
            nextSession.progress.totalPages,
          );
          setSession((current) => (current ? { ...current, progress: nextSession.progress, updatedAt: nextSession.updatedAt } : nextSession));
        })
        .catch(() => undefined);
    }, 240);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentPage, selectedPaper, session, totalPages, zoom]);

  /**
   * @function handleOpenPaper
   * @description 在阅读器中切换当前论文，并清空临时选区与批注表单状态。
   * @param {string} paperId 目标论文标识
   * @returns {void} 无返回值
   */
  function handleOpenPaper(paperId: string): void {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set('paper', paperId);
      return params;
    });
  }

  function updateRailCollapsed(collapsed: boolean): void {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      if (collapsed) {
        params.delete('rail');
      } else {
        params.set('rail', 'open');
      }
      return params;
    });
  }

  /**
   * @function handleSaveNote
   * @description 保存右侧阅读笔记，供后续阅读与问答继续引用。
   * @returns {Promise<void>} 保存结果
   */
  async function handleSaveNote(): Promise<void> {
    if (!selectedPaper || !session) {
      return;
    }

    if (!noteDraft.trim()) {
      props.onNotify({
        tone: 'error',
        message: '请先输入笔记内容。',
      });
      return;
    }

    setIsSavingNote(true);
    try {
      const nextValue = appendReaderNote(session.note, noteDraft);
      const nextSession = await window.desktopApi.saveReaderNote(selectedPaper.id, nextValue);
      setSession(nextSession);
      setNoteDraft('');
      setNoteFeedbackNonce(Date.now());
      props.onNotify({
        tone: 'success',
        message: '阅读笔记已保存到本地工作区。',
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '保存阅读笔记失败',
      });
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleRemoveNote(entryIndex: number): Promise<void> {
    if (!selectedPaper || !session) {
      return;
    }

    const entries = parseReaderNoteEntries(session.note);
    const nextEntries = entries.filter((_, index) => index !== entryIndex);

    setIsSavingNote(true);

    try {
      const nextSession = await window.desktopApi.saveReaderNote(selectedPaper.id, nextEntries.join('\n\n'));
      setSession(nextSession);
      props.onNotify({
        tone: 'success',
        message: '笔记已删除。',
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '删除笔记失败',
      });
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleSaveAnnotation(): Promise<void> {
    if (!selectedPaper) {
      return;
    }

    if (!annotationDraft.quote.trim()) {
      props.onNotify({
        tone: 'error',
        message: '请先粘贴或输入摘录内容后再保存批注。',
      });
      return;
    }

    const pageNumber = Number(annotationDraft.pageNumber);

    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      props.onNotify({
        tone: 'error',
        message: '页码需为大于 0 的整数。',
      });
      return;
    }

    setIsSavingAnnotation(true);

    try {
      const nextSession = editingAnnotationId
        ? await window.desktopApi.updateReaderAnnotation(selectedPaper.id, editingAnnotationId, {
            note: annotationDraft.note.trim(),
            color: annotationDraft.color,
          })
        : await window.desktopApi.addReaderAnnotation(selectedPaper.id, {
            pageNumber,
            quote: annotationDraft.quote.trim(),
            note: annotationDraft.note.trim(),
            color: annotationDraft.color,
            highlightAreas: annotationDraft.highlightAreas,
          });
      setSession(nextSession);
      const targetAnnotation = editingAnnotationId
        ? nextSession.annotations.find((annotation) => annotation.id === editingAnnotationId) ?? null
        : nextSession.annotations[0] ?? null;

      if (targetAnnotation) {
        setActiveAnnotationId(targetAnnotation.id);
        setAnnotationJumpRequest({
          annotationId: targetAnnotation.id,
          nonce: Date.now(),
        });
      }
      setEditingAnnotationId(null);
      setAnnotationDraft(createEmptyAnnotationDraft(pageNumber, annotationDraft.color));
      props.onNotify({
        tone: 'success',
        message: editingAnnotationId ? '高亮批注已更新。' : '摘录批注已保存到当前论文。',
      });
    } catch (error) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '保存批注失败',
      });
    } finally {
      setIsSavingAnnotation(false);
    }
  }

  function handleStartEditAnnotation(annotation: ReaderAnnotation): void {
    setActiveAnnotationId(annotation.id);
    setEditingAnnotationId(null);
    setAnnotationJumpRequest({
      annotationId: annotation.id,
      nonce: Date.now(),
    });
    setActiveInspectorPanel('annotations');
    setIsInspectorVisible(true);
    setIsInspectorRailVisible(false);
  }

  function handleCancelAnnotationEdit(): void {
    setEditingAnnotationId(null);
    setAnnotationDraft(createEmptyAnnotationDraft(currentPage, annotationDraft.color));
  }

  function handleInspectorResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!isInspectorVisible || !readerContentGridRef.current) {
      return;
    }

    const rect = readerContentGridRef.current.getBoundingClientRect();
    inspectorResizeStateRef.current = {
      pointerId: event.pointerId,
      containerLeft: rect.left,
      containerWidth: rect.width,
    };
    setIsResizingInspector(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleInspectorResizeMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!inspectorResizeStateRef.current || inspectorResizeStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    const { containerLeft, containerWidth } = inspectorResizeStateRef.current;
    const nextWidth = clampValue(
      containerLeft + containerWidth - event.clientX,
      320,
      Math.max(360, containerWidth - 420),
    );
    setInspectorWidth(nextWidth);
  }

  function handleInspectorResizeEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!inspectorResizeStateRef.current || inspectorResizeStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    inspectorResizeStateRef.current = null;
    setIsResizingInspector(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    persistReaderInspectorWidth(inspectorWidth);
  }, [inspectorWidth]);

  if (!downloadablePapers.length) {
    return (
      <section className="reader-empty-state">
        <p className="eyebrow">Task 3</p>
        <h3>阅读器暂时没有可打开的 PDF</h3>
        <p>请先前往论文搜索或论文库导入带有本地 PDF 文件的论文。</p>
        <div className="action-row">
          <Link className="primary-button" to="/search">
            去搜索论文
          </Link>
          <Link className="ghost-button" to="/library">
            返回论文库
          </Link>
        </div>
      </section>
    );
  }

  if (!selectedPaper) {
    return (
      <section className="reader-empty-state">
        <p className="eyebrow">Task 3</p>
        <h3>未找到目标论文</h3>
        <p>当前阅读器路由中的论文标识无效，请重新从论文库进入。</p>
        <button type="button" className="ghost-button" onClick={() => navigate('/library')}>
          返回论文库
        </button>
      </section>
    );
  }

  return (
    <section className={isRailCollapsed ? 'reader-layout reader-layout-rail-collapsed' : 'reader-layout'}>
      {!isRailCollapsed ? (
        <aside className="reader-rail">
          <div className="reader-rail-header">
            <h3>本地论文库</h3>
            <button
              type="button"
              className="reader-rail-toggle"
              aria-label="收起左栏"
              onClick={() => updateRailCollapsed(true)}
            >
              ‹
            </button>
          </div>
          <div className="reader-paper-list">
            {downloadablePapers.map((paper) => (
              <button
                key={paper.id}
                type="button"
                className={paper.id === selectedPaper.id ? 'reader-paper-chip reader-paper-chip-active' : 'reader-paper-chip'}
                onClick={() => handleOpenPaper(paper.id)}
              >
                <strong>{paper.title}</strong>
                <small className={`reader-paper-status reader-paper-status-${paper.readingStatus}`}>{getReadingStatusLabel(paper.readingStatus)}</small>
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      <div
        className={
          isInspectorVisible
            ? 'reader-main reader-main-inspector-open'
            : isInspectorRailVisible
              ? 'reader-main reader-main-inspector-rail'
              : 'reader-main'
        }
      >
        <div className="reader-floating-controls">
          {isRailCollapsed ? (
            <button
              type="button"
              className="reader-rail-toggle reader-rail-toggle-floating"
              aria-label="展开论文库"
              onClick={() => updateRailCollapsed(false)}
            >
              ›
            </button>
          ) : null}
        </div>

        <header className="reader-topbar">
          <div className="reader-topbar-title">
            <h2>{selectedPaper.title}</h2>
            <p className="muted">{joinTextList(selectedPaper.authors, ' · ', '作者信息缺失')}</p>
          </div>
        </header>

        {isLoadingSession ? <p className="muted">正在恢复阅读进度、批注与对话记录...</p> : null}
        {sessionError ? <p className="error-text">{sessionError}</p> : null}

        {session ? (
          <div
            ref={readerContentGridRef}
            className={
              isInspectorVisible
                ? 'reader-content-grid reader-content-grid-inspector-open'
                : isInspectorRailVisible
                  ? 'reader-content-grid reader-content-grid-inspector-rail'
                  : 'reader-content-grid'
            }
            style={isInspectorVisible ? { '--reader-inspector-width': `${inspectorWidth}px` } as CSSProperties : undefined}
          >
            <div className="reader-center-column">
              <ReaderPdfPanel
                paper={selectedPaper}
                session={session}
                currentPage={currentPage}
                zoom={zoom}
                annotationColor={annotationDraft.color}
                activeAnnotationId={activeAnnotationId}
                jumpRequest={annotationJumpRequest}
                onPageChange={setCurrentPage}
                onZoomChange={setZoom}
                onDocumentLoad={setTotalPages}
                onSessionChange={setSession}
                onActivateAnnotation={(annotationId) => {
                  setActiveAnnotationId(annotationId);
                  setEditingAnnotationId(null);
                  if (annotationId) {
                    setAnnotationJumpRequest({
                      annotationId,
                      nonce: Date.now(),
                    });
                  }
                }}
                onEditAnnotation={handleStartEditAnnotation}
              onAskAssistantFromSelection={(selection) => {
                setAssistantSelection(selection);
                setActiveInspectorPanel('assistant');
                setIsInspectorVisible(true);
                setIsInspectorRailVisible(false);
              }}
              onAskAssistantFromAnnotation={(annotation) => {
                setAssistantSelection({
                  pageNumber: annotation.pageNumber,
                  quote: annotation.quote,
                  color: annotation.color,
                  highlightAreas: annotation.highlightAreas ?? [],
                  linkedAnnotationCount: session.annotations.filter((currentAnnotation) =>
                    currentAnnotation.pageNumber === annotation.pageNumber
                    && currentAnnotation.quote.trim() === annotation.quote.trim()
                    && areHighlightAreaCollectionsEqual(currentAnnotation.highlightAreas ?? [], annotation.highlightAreas ?? [])
                  ).length,
                  sourceAnnotationId: annotation.id,
                });
                setActiveAnnotationId(annotation.id);
                setActiveInspectorPanel('assistant');
                setIsInspectorVisible(true);
                setIsInspectorRailVisible(false);
              }}
                onNotify={props.onNotify}
              />
            </div>
            {isInspectorVisible ? (
              <div
                className={isResizingInspector ? 'reader-content-divider reader-content-divider-active' : 'reader-content-divider'}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整阅读区与功能区宽度"
                onPointerDown={handleInspectorResizeStart}
                onPointerMove={handleInspectorResizeMove}
                onPointerUp={handleInspectorResizeEnd}
                onPointerCancel={handleInspectorResizeEnd}
              />
            ) : null}
            <ReaderSidebar
              paper={selectedPaper}
              session={session}
              currentPage={currentPage}
              noteDraft={noteDraft}
              noteFeedbackNonce={noteFeedbackNonce}
              isSavingNote={isSavingNote}
              annotationDraft={annotationDraft}
              isSavingAnnotation={isSavingAnnotation}
              activeAnnotationId={activeAnnotationId}
              editingAnnotationId={editingAnnotationId}
              activePanel={activeInspectorPanel}
              isVisible={isInspectorVisible}
              onAnnotationDraftChange={(patch) => {
                setAnnotationDraft((current) => ({
                  ...current,
                  ...patch,
                }));
              }}
              onSaveAnnotation={handleSaveAnnotation}
              onSelectAnnotation={handleStartEditAnnotation}
              onCancelAnnotationEdit={handleCancelAnnotationEdit}
              onNoteDraftChange={setNoteDraft}
              onSaveNote={handleSaveNote}
              onRemoveNote={handleRemoveNote}
              onSessionChange={setSession}
              onOpenPanel={(panel) => {
                setActiveInspectorPanel(panel);
                setIsInspectorVisible(true);
                setIsInspectorRailVisible(false);
              }}
              isRailVisible={isInspectorRailVisible}
              onToggleRail={() => {
                setIsInspectorVisible(false);
                setIsInspectorRailVisible(true);
              }}
              onRemoveAnnotation={async (annotationId) => {
                const nextSession = await window.desktopApi.removeReaderAnnotation(selectedPaper.id, annotationId);
                setSession(nextSession);
                setActiveAnnotationId((current) => (current === annotationId ? null : current));
                setEditingAnnotationId((current) => {
                  if (current === annotationId) {
                    setAnnotationDraft(createEmptyAnnotationDraft(currentPage));
                    return null;
                  }

                  return current;
                });
                props.onNotify({
                  tone: 'success',
                  message: '批注已删除。',
                });
              }}
              onNotify={props.onNotify}
            >
              <ReaderAssistantPanel
                paper={selectedPaper}
                session={session}
                currentPage={currentPage}
                assistantSelection={assistantSelection}
                onSessionChange={setSession}
                onActivateAnnotation={setActiveAnnotationId}
                onJumpToPage={(page) => {
                  setCurrentPage(page);
                }}
                onClearSelection={() => {
                  setAssistantSelection(null);
                }}
                onNotify={props.onNotify}
                onBusyChange={() => {
                  return;
                }}
              />
            </ReaderSidebar>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * @function ReaderPdfPanel
 * @description 使用 react-pdf-viewer 承载本地文件，统一工具栏能力并同步阅读状态。
 * @param {ReaderPdfPanelProps} props PDF 渲染配置与交互回调
 * @returns {JSX.Element} PDF 阅读面板
 */
function ReaderPdfPanel(props: ReaderPdfPanelProps): JSX.Element {
  const { activeAnnotationId, annotationColor, currentPage, paper, session, zoom } = props;
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [error, setError] = useState('');
  const [isViewerToolbarVisible, setIsViewerToolbarVisible] = useState(false);
  const [viewerPageCount, setViewerPageCount] = useState(0);
  const [inlineDraft, setInlineDraft] = useState<ReaderInlineAnnotationDraft | null>(null);
  const [isSavingInlineAnnotation, setIsSavingInlineAnnotation] = useState(false);
  const [collapsedMarginAnnotationIds, setCollapsedMarginAnnotationIds] = useState<string[]>([]);
  const [marginAnnotationPositions, setMarginAnnotationPositions] = useState<Record<string, MarginAnnotationPosition>>({});
  const [editingMarginAnnotationId, setEditingMarginAnnotationId] = useState<string | null>(null);
  const [marginAnnotationDraft, setMarginAnnotationDraft] = useState<{ note: string; color: ReaderAnnotationColor }>({
    note: '',
    color: 'yellow',
  });
  const [isSavingMarginAnnotation, setIsSavingMarginAnnotation] = useState(false);
  const [focusedMarginAnnotationId, setFocusedMarginAnnotationId] = useState<string | null>(null);
  const [marginAnnotationConnectors, setMarginAnnotationConnectors] = useState<MarginAnnotationConnector[]>([]);
  const [hoveredMarginAnnotationId, setHoveredMarginAnnotationId] = useState<string | null>(null);
  const [draggingMarginAnnotationId, setDraggingMarginAnnotationId] = useState<string | null>(null);
  const [assistantTargetHoverAnnotationId, setAssistantTargetHoverAnnotationId] = useState<string | null>(null);
  const [assistantDropTargetRect, setAssistantDropTargetRect] = useState<DOMRect | null>(null);
  const [assistantDropTargetPosition, setAssistantDropTargetPosition] = useState<{ top: number; left: number } | null>(null);
  const annotationsRef = useRef(session.annotations);
  const annotationColorRef = useRef(annotationColor);
  const activeAnnotationIdRef = useRef(activeAnnotationId);
  const inlineDraftRef = useRef<ReaderInlineAnnotationDraft | null>(inlineDraft);
  const isSavingInlineAnnotationRef = useRef(isSavingInlineAnnotation);
  const onSessionChangeRef = useRef(props.onSessionChange);
  const onActivateAnnotationRef = useRef(props.onActivateAnnotation);
  const onEditAnnotationRef = useRef(props.onEditAnnotation);
  const onNotifyRef = useRef(props.onNotify);
  const handledJumpRequestNonceRef = useRef<number | null>(null);
  const pdfViewerShellRef = useRef<HTMLDivElement | null>(null);
  const marginAnnotationElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const highlightAnchorElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusedMarginAnnotationTimeoutRef = useRef<number | null>(null);
  const marginAnnotationAutosaveRequestRef = useRef(0);
  const marginAnnotationConnectorFrameRef = useRef<number | null>(null);
  const assistantDropTargetRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    annotationsRef.current = session.annotations;
  }, [session.annotations]);

  useEffect(() => {
    annotationColorRef.current = annotationColor;
  }, [annotationColor]);

  useEffect(() => {
    activeAnnotationIdRef.current = activeAnnotationId;
  }, [activeAnnotationId]);

  useEffect(() => {
    inlineDraftRef.current = inlineDraft;
  }, [inlineDraft]);

  useEffect(() => {
    isSavingInlineAnnotationRef.current = isSavingInlineAnnotation;
  }, [isSavingInlineAnnotation]);

  useEffect(() => {
    onSessionChangeRef.current = props.onSessionChange;
  }, [props.onSessionChange]);

  useEffect(() => {
    onActivateAnnotationRef.current = props.onActivateAnnotation;
  }, [props.onActivateAnnotation]);

  useEffect(() => {
    onEditAnnotationRef.current = props.onEditAnnotation;
  }, [props.onEditAnnotation]);

  useEffect(() => {
    onNotifyRef.current = props.onNotify;
  }, [props.onNotify]);

  const pageNavigationPluginInstance = pageNavigationPlugin();
  const zoomPluginInstance = zoomPlugin();
  const leftMarginAnnotationsRef = useRef<HTMLDivElement | null>(null);
  const rightMarginAnnotationsRef = useRef<HTMLDivElement | null>(null);
  const pageNavigationPluginInstanceRef = useRef(pageNavigationPluginInstance);
  const zoomPluginInstanceRef = useRef(zoomPluginInstance);
  const [viewerVariant, setViewerVariant] = useState<'base' | 'annotate'>('base');
  const [marginColumnWidths, setMarginColumnWidths] = useState({
    left: 0,
    right: 0,
  });
  const canGoToPreviousPage = currentPage > 1;
  const canGoToNextPage = viewerPageCount > 0 && currentPage < viewerPageCount;
  const normalizedZoom = zoom > 0 ? zoom : 1;
  const zoomPercent = Math.round(normalizedZoom * 100);
  const assistantDropTargetAnchorId =
    draggingMarginAnnotationId ?? hoveredMarginAnnotationId ?? assistantTargetHoverAnnotationId;
  const isAssistantDropTargetVisible = Boolean(assistantDropTargetAnchorId && assistantDropTargetPosition);
  const currentPageAnnotations = useMemo(
    () => session.annotations.filter((annotation) => annotation.pageNumber === currentPage),
    [currentPage, session.annotations],
  );
  const marginAnnotationColumns = useMemo(
    () => ({
      left: currentPageAnnotations.filter((_, index) => index % 2 === 0),
      right: currentPageAnnotations.filter((_, index) => index % 2 === 1),
    }),
    [currentPageAnnotations],
  );

  const highlightPluginInstanceRef = useRef<ReturnType<typeof highlightPlugin> | null>(null);

  function setMarginAnnotationElement(annotationId: string, element: HTMLElement | null): void {
    marginAnnotationElementRefs.current[annotationId] = element;
  }

  function setHighlightAnchorElement(annotationId: string, element: HTMLDivElement | null): void {
    highlightAnchorElementRefs.current[annotationId] = element;
  }

  function revealMarginAnnotation(annotationId: string): void {
    onActivateAnnotationRef.current(annotationId);
    setCollapsedMarginAnnotationIds((current) => current.filter((id) => id !== annotationId));
    setFocusedMarginAnnotationId(annotationId);
    if (focusedMarginAnnotationTimeoutRef.current) {
      window.clearTimeout(focusedMarginAnnotationTimeoutRef.current);
    }
    focusedMarginAnnotationTimeoutRef.current = window.setTimeout(() => {
      setFocusedMarginAnnotationId((current) => (current === annotationId ? null : current));
    }, 1400);

    window.requestAnimationFrame(() => {
      const shellElement = pdfViewerShellRef.current;
      const cardElement = marginAnnotationElementRefs.current[annotationId];
      const anchorElement = highlightAnchorElementRefs.current[annotationId];

      if (!shellElement || !cardElement || !anchorElement) {
        return;
      }

      const shellRect = shellElement.getBoundingClientRect();
      const cardRect = cardElement.getBoundingClientRect();
      const anchorRect = anchorElement.getBoundingClientRect();
      const visibleTop = 96;
      const visibleBottom = shellRect.height - 24;
      const cardTop = cardRect.top - shellRect.top;
      const cardBottom = cardRect.bottom - shellRect.top;

      if (cardTop >= visibleTop && cardBottom <= visibleBottom) {
        return;
      }

      const anchorCenterY = anchorRect.top + anchorRect.height / 2 - shellRect.top;
      const nextY = clampValue(anchorCenterY - 56, 0, Math.max(0, shellRect.height - cardRect.height - 24));

      setMarginAnnotationPositions((current) => {
        const currentPosition = current[annotationId];

        if (!currentPosition) {
          return current;
        }

        return {
          ...current,
          [annotationId]: {
            ...currentPosition,
            y: nextY,
          },
        };
      });
    });
  }

  useEffect(() => {
    setMarginAnnotationPositions(loadMarginAnnotationPositions(paper.id));
  }, [paper.id]);

  useEffect(() => {
    pageNavigationPluginInstanceRef.current = pageNavigationPluginInstance;
    zoomPluginInstanceRef.current = zoomPluginInstance;
  }, [pageNavigationPluginInstance, zoomPluginInstance]);

  useEffect(() => {
    const updateMarginColumnWidths = (): void => {
      setMarginColumnWidths({
        left: leftMarginAnnotationsRef.current?.clientWidth ?? 0,
        right: rightMarginAnnotationsRef.current?.clientWidth ?? 0,
      });
    };

    updateMarginColumnWidths();
    window.addEventListener('resize', updateMarginColumnWidths);

    return () => {
      window.removeEventListener('resize', updateMarginColumnWidths);
    };
  }, [marginAnnotationColumns.left.length, marginAnnotationColumns.right.length]);

  async function handleSaveInlineAnnotation(
    draft: ReaderInlineAnnotationDraft,
    cancel: () => void,
  ): Promise<void> {
    setIsSavingInlineAnnotation(true);

    try {
      const nextSession = await window.desktopApi.addReaderAnnotation(paper.id, {
        pageNumber: draft.pageNumber,
        quote: draft.quote.trim(),
        note: draft.note.trim(),
        color: draft.color,
        highlightAreas: draft.highlightAreas,
      });
      onSessionChangeRef.current(nextSession);
      const createdAnnotation = nextSession.annotations[0] ?? null;
      onActivateAnnotationRef.current(createdAnnotation?.id ?? null);
      setInlineDraft(null);
      cancel();
      onNotifyRef.current({
        tone: 'success',
        message: '高亮批注已保存。',
      });
    } catch (error) {
      onNotifyRef.current({
        tone: 'error',
        message: error instanceof Error ? error.message : '保存高亮批注失败',
      });
    } finally {
      setIsSavingInlineAnnotation(false);
    }
  }

  function createAssistantSelectionContextFromHighlight(
    selectedText: string,
    highlightAreas: HighlightArea[],
  ): ReaderAssistantSelectionContext {
    const normalizedHighlightAreas = highlightAreas.map(normalizeHighlightArea);
    const selectionPageNumber = Math.max(1, (highlightAreas[0]?.pageIndex ?? 0) + 1);
    const linkedAnnotationCount = session.annotations.filter((annotation) =>
      annotation.pageNumber === selectionPageNumber
      && annotation.quote.trim() === selectedText.trim()
      && areHighlightAreaCollectionsEqual(annotation.highlightAreas ?? [], normalizedHighlightAreas)
    ).length;

    return {
      pageNumber: selectionPageNumber,
      quote: selectedText.trim(),
      color: annotationColorRef.current,
      highlightAreas: normalizedHighlightAreas,
      linkedAnnotationCount,
      sourceAnnotationId: null,
    };
  }

  function findAnnotationsForHighlight(selectedText: string, highlightAreas: HighlightArea[]): ReaderAnnotation[] {
    const normalizedHighlightAreas = highlightAreas.map(normalizeHighlightArea);
    const selectionPageNumber = Math.max(1, (highlightAreas[0]?.pageIndex ?? 0) + 1);

    return session.annotations.filter((annotation) =>
      annotation.pageNumber === selectionPageNumber
      && annotation.quote.trim() === selectedText.trim()
      && areHighlightAreaCollectionsEqual(annotation.highlightAreas ?? [], normalizedHighlightAreas)
    );
  }

  const highlightPluginInstance = highlightPlugin({
    renderHighlightTarget(renderProps: RenderHighlightTargetProps) {
      const linkedAnnotations = findAnnotationsForHighlight(renderProps.selectedText, renderProps.highlightAreas);
      const selectionContext = createAssistantSelectionContextFromHighlight(
        renderProps.selectedText,
        renderProps.highlightAreas,
      );

      return (
        <div
          className="reader-selection-actions"
          style={{
            left: `${renderProps.selectionRegion.left + renderProps.selectionRegion.width}%`,
            top: `${renderProps.selectionRegion.top + renderProps.selectionRegion.height}%`,
          }}
        >
          <button
            type="button"
            className="reader-selection-action"
            onClick={() => {
              setInlineDraft(
                createInlineAnnotationDraft(
                  renderProps.selectedText,
                  renderProps.highlightAreas,
                  renderProps.selectionRegion,
                  annotationColorRef.current,
                ),
              );
              renderProps.toggle();
            }}
          >
            <MessageIcon />
            <span>高亮批注</span>
          </button>
          {linkedAnnotations.length ? (
            <button
              type="button"
              className="reader-selection-action reader-selection-action-secondary"
              onClick={() => {
                revealMarginAnnotation(linkedAnnotations[0].id);
                renderProps.cancel();
              }}
            >
              <span>查看已有批注</span>
            </button>
          ) : (
            <button
              type="button"
              className="reader-selection-action reader-selection-action-secondary"
              onClick={() => {
                props.onAskAssistantFromSelection(selectionContext);
                renderProps.cancel();
              }}
            >
              <span>AI 提问</span>
            </button>
          )}
        </div>
      );
    },
    renderHighlightContent(renderProps: RenderHighlightContentProps) {
      const currentDraft = inlineDraftRef.current
        ?? createInlineAnnotationDraft(
          renderProps.selectedText,
          renderProps.highlightAreas,
          renderProps.selectionRegion,
          annotationColorRef.current,
        );
      const shouldPlaceAbove = renderProps.selectionRegion.top > 62;
      const shouldShiftLeft = renderProps.selectionRegion.left > 62;
      const popoverTransform = `${shouldShiftLeft ? 'translateX(calc(-100% + 36px))' : 'translateX(0)'} ${shouldPlaceAbove ? 'translateY(calc(-100% - 18px))' : 'translateY(0)'}`;

      return (
        <div
          className="reader-inline-annotation-popover"
          style={{
            left: `${shouldShiftLeft ? renderProps.selectionRegion.left + renderProps.selectionRegion.width : renderProps.selectionRegion.left}%`,
            top: `${shouldPlaceAbove ? renderProps.selectionRegion.top : renderProps.selectionRegion.top + renderProps.selectionRegion.height + 1}%`,
            transform: popoverTransform,
          }}
        >
          <InlineAnnotationComposer
            key={`${currentDraft.pageNumber}-${currentDraft.selectionRegion.pageIndex}-${currentDraft.selectionRegion.top}-${currentDraft.selectionRegion.left}-${currentDraft.quote}`}
            draft={currentDraft}
            isSaving={isSavingInlineAnnotationRef.current}
            onCancel={() => {
              setInlineDraft(null);
              renderProps.cancel();
            }}
            onSave={(draft) => {
              setInlineDraft(draft);
              void handleSaveInlineAnnotation(draft, renderProps.cancel);
            }}
          />
        </div>
      );
    },
    renderHighlights(renderProps: RenderHighlightsProps) {
      return (
        <>
          {annotationsRef.current.flatMap((annotation) =>
            (annotation.highlightAreas ?? [])
              .filter((area) => area.pageIndex === renderProps.pageIndex)
              .map((area, index) => (
                <div
                  key={`${annotation.id}-${renderProps.pageIndex}-${index}`}
                  ref={index === 0 ? (element) => setHighlightAnchorElement(annotation.id, element) : undefined}
                  className={
                    annotation.id === activeAnnotationIdRef.current
                      ? `reader-highlight-overlay reader-highlight-overlay-${annotation.color} reader-highlight-overlay-active`
                      : `reader-highlight-overlay reader-highlight-overlay-${annotation.color}`
                  }
                  style={renderProps.getCssProperties(area, renderProps.rotation)}
                  title={annotation.note || annotation.quote}
                  onClick={() => {
                    revealMarginAnnotation(annotation.id);
                  }}
                />
              )),
          )}
        </>
      );
    },
    trigger: Trigger.TextSelection,
  });
  useEffect(() => {
    highlightPluginInstanceRef.current = highlightPluginInstance;
  }, [highlightPluginInstance]);
  useEffect(() => {
    let isMounted = true;
    setError('');
    setPdfData(null);
    setPdfBlobUrl('');
    setViewerPageCount(0);
    setInlineDraft(null);
    setCollapsedMarginAnnotationIds([]);
    setMarginAnnotationPositions(loadMarginAnnotationPositions(paper.id));
    setEditingMarginAnnotationId(null);
    setFocusedMarginAnnotationId(null);
    setMarginAnnotationConnectors([]);
    handledJumpRequestNonceRef.current = null;
    setViewerVariant('base');
    void loadPdfBinary(paper.localPdfPath)
      .then((base64) => {
        if (!isMounted) {
          return;
        }
        setPdfData(decodeBase64Pdf(base64));
      })
      .catch((reason: unknown) => {
        if (!isMounted) {
          return;
        }
        setError(reason instanceof Error ? reason.message : 'PDF 渲染失败');
      });

    return () => {
      isMounted = false;
    };
  }, [paper.id, paper.localPdfPath]);

  useEffect(() => {
    if (!pdfData) {
      setPdfBlobUrl('');
      return;
    }

    const arrayBuffer = pdfData.buffer.slice(
      pdfData.byteOffset,
      pdfData.byteOffset + pdfData.byteLength,
    ) as ArrayBuffer;
    const nextBlobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/pdf' }));
    setPdfBlobUrl(nextBlobUrl);

    return () => {
      URL.revokeObjectURL(nextBlobUrl);
    };
  }, [pdfData]);

  useEffect(() => {
    if (!isViewerToolbarVisible) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsViewerToolbarVisible(false);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isViewerToolbarVisible]);

  useEffect(() => {
    setMarginAnnotationPositions((current) => {
      const next = { ...current };
      let hasChanged = false;

      marginAnnotationColumns.left.forEach((annotation, index) => {
        const position = next[annotation.id];

        if (!position || position.column !== 'left') {
          next[annotation.id] = getDefaultMarginAnnotationPosition('left', index);
          hasChanged = true;
        }
      });

      marginAnnotationColumns.right.forEach((annotation, index) => {
        const position = next[annotation.id];

        if (!position || position.column !== 'right') {
          next[annotation.id] = getDefaultMarginAnnotationPosition('right', index);
          hasChanged = true;
        }
      });

      return hasChanged ? next : current;
    });
  }, [marginAnnotationColumns.left, marginAnnotationColumns.right]);

  useEffect(() => {
    setCollapsedMarginAnnotationIds(currentPageAnnotations.map((annotation) => annotation.id));
    setEditingMarginAnnotationId(null);
    setHoveredMarginAnnotationId(null);
    setDraggingMarginAnnotationId(null);
    setAssistantTargetHoverAnnotationId(null);
  }, [currentPage, currentPageAnnotations]);

  useEffect(() => {
    setMarginAnnotationPositions((current) => {
      const validAnnotationIds = new Set(session.annotations.map((annotation) => annotation.id));
      const nextEntries = Object.entries(current).filter(([annotationId]) => validAnnotationIds.has(annotationId));

      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(nextEntries);
    });
  }, [session.annotations]);

  useEffect(() => {
    if (!editingMarginAnnotationId) {
      return;
    }

    const targetAnnotation = session.annotations.find((annotation) => annotation.id === editingMarginAnnotationId);

    if (!targetAnnotation) {
      setEditingMarginAnnotationId(null);
      return;
    }

    setMarginAnnotationDraft({
      note: targetAnnotation.note,
      color: targetAnnotation.color,
    });
  }, [editingMarginAnnotationId, session.annotations]);

  useEffect(() => {
    persistMarginAnnotationPositions(paper.id, marginAnnotationPositions);
  }, [marginAnnotationPositions, paper.id]);

  useEffect(() => {
    if (!assistantDropTargetAnchorId) {
      setAssistantDropTargetPosition(null);
      return undefined;
    }

    /**
     * @function updateAssistantDropTargetPosition
     * @description 根据当前悬浮或拖拽中的批注卡片，更新局部 AI 入口在视口中的锚点位置。
     * @returns {void} 仅同步局部入口位置
     */
    const updateAssistantDropTargetPosition = (): void => {
      const anchorElement = marginAnnotationElementRefs.current[assistantDropTargetAnchorId];

      if (!anchorElement) {
        setAssistantDropTargetPosition(null);
        return;
      }

      const anchorRect = anchorElement.getBoundingClientRect();
      const viewportInset = 24;
      setAssistantDropTargetPosition({
        left: Math.min(window.innerWidth - viewportInset, Math.max(viewportInset, anchorRect.right - 12)),
        top: Math.min(window.innerHeight - viewportInset, Math.max(viewportInset, anchorRect.bottom - 12)),
      });
    };

    updateAssistantDropTargetPosition();
    window.addEventListener('resize', updateAssistantDropTargetPosition);
    window.addEventListener('scroll', updateAssistantDropTargetPosition, true);

    return () => {
      window.removeEventListener('resize', updateAssistantDropTargetPosition);
      window.removeEventListener('scroll', updateAssistantDropTargetPosition, true);
    };
  }, [assistantDropTargetAnchorId]);

  useEffect(() => {
    if (!isAssistantDropTargetVisible) {
      setAssistantDropTargetRect(null);
      return undefined;
    }

    /**
     * @function updateAssistantDropTargetRect
     * @description 在局部 AI 入口完成定位后，读取其矩形区域供拖拽命中检测使用。
     * @returns {void} 仅同步命中区域
     */
    const updateAssistantDropTargetRect = (): void => {
      setAssistantDropTargetRect(assistantDropTargetRef.current?.getBoundingClientRect() ?? null);
    };

    updateAssistantDropTargetRect();
    window.addEventListener('resize', updateAssistantDropTargetRect);
    window.addEventListener('scroll', updateAssistantDropTargetRect, true);

    return () => {
      window.removeEventListener('resize', updateAssistantDropTargetRect);
      window.removeEventListener('scroll', updateAssistantDropTargetRect, true);
    };
  }, [isAssistantDropTargetVisible, assistantDropTargetPosition]);

  useEffect(() => {
    if (!editingMarginAnnotationId) {
      return undefined;
    }

    const targetAnnotation = session.annotations.find((annotation) => annotation.id === editingMarginAnnotationId);

    if (!targetAnnotation) {
      return undefined;
    }

    const nextNote = marginAnnotationDraft.note.trim();

    if (nextNote === targetAnnotation.note && marginAnnotationDraft.color === targetAnnotation.color) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const requestId = marginAnnotationAutosaveRequestRef.current + 1;
      marginAnnotationAutosaveRequestRef.current = requestId;
      setIsSavingMarginAnnotation(true);

      void window.desktopApi
        .updateReaderAnnotation(paper.id, editingMarginAnnotationId, {
          note: nextNote,
          color: marginAnnotationDraft.color,
        })
        .then((nextSession) => {
          if (marginAnnotationAutosaveRequestRef.current !== requestId) {
            return;
          }

          onSessionChangeRef.current(nextSession);
          onActivateAnnotationRef.current(editingMarginAnnotationId);
        })
        .catch((error) => {
          if (marginAnnotationAutosaveRequestRef.current !== requestId) {
            return;
          }

          onNotifyRef.current({
            tone: 'error',
            message: error instanceof Error ? error.message : '自动保存批注失败',
          });
        })
        .finally(() => {
          if (marginAnnotationAutosaveRequestRef.current === requestId) {
            setIsSavingMarginAnnotation(false);
          }
        });
    }, 420);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editingMarginAnnotationId, marginAnnotationDraft.color, marginAnnotationDraft.note, paper.id, session.annotations]);

  useEffect(() => {
    const shellElement = pdfViewerShellRef.current;

    if (!shellElement) {
      return undefined;
    }

    const updateMarginAnnotationConnectors = (): void => {
      if (marginAnnotationConnectorFrameRef.current) {
        window.cancelAnimationFrame(marginAnnotationConnectorFrameRef.current);
      }

      marginAnnotationConnectorFrameRef.current = window.requestAnimationFrame(() => {
        const hostElement = pdfViewerShellRef.current;

        if (!hostElement) {
          return;
        }

        const hostRect = hostElement.getBoundingClientRect();
        const nextConnectors = currentPageAnnotations.flatMap((annotation) => {
          const anchorElement = highlightAnchorElementRefs.current[annotation.id];
          const cardElement = marginAnnotationElementRefs.current[annotation.id];

          if (!anchorElement || !cardElement) {
            return [];
          }

          const anchorRect = anchorElement.getBoundingClientRect();
          const cardRect = cardElement.getBoundingClientRect();
          const isLeftColumn = (marginAnnotationPositions[annotation.id]?.column ?? 'left') === 'left';
          const startX = anchorRect.left + anchorRect.width / 2 - hostRect.left;
          const startY = anchorRect.top + anchorRect.height / 2 - hostRect.top;
          const endX = isLeftColumn ? cardRect.right - hostRect.left : cardRect.left - hostRect.left;
          const endY = clampValue(startY, cardRect.top - hostRect.top + 18, cardRect.bottom - hostRect.top - 18);

          return [
            {
              annotationId: annotation.id,
              startX,
              startY,
              endX,
              endY,
            },
          ];
        });

        setMarginAnnotationConnectors(nextConnectors);
      });
    };

    const scrollHost = shellElement.querySelector('.rpv-core__inner-pages') as HTMLElement | null;

    updateMarginAnnotationConnectors();
    window.addEventListener('resize', updateMarginAnnotationConnectors);
    scrollHost?.addEventListener('scroll', updateMarginAnnotationConnectors, { passive: true });

    return () => {
      if (marginAnnotationConnectorFrameRef.current) {
        window.cancelAnimationFrame(marginAnnotationConnectorFrameRef.current);
      }
      window.removeEventListener('resize', updateMarginAnnotationConnectors);
      scrollHost?.removeEventListener('scroll', updateMarginAnnotationConnectors);
    };
  }, [currentPageAnnotations, editingMarginAnnotationId, marginAnnotationPositions, pdfBlobUrl, viewerVariant, zoom]);

  useEffect(() => {
    if (!props.jumpRequest) {
      return;
    }
    if (handledJumpRequestNonceRef.current === props.jumpRequest.nonce) {
      return;
    }

    const targetAnnotation = session.annotations.find((annotation) => annotation.id === props.jumpRequest?.annotationId);

    if (!targetAnnotation) {
      return;
    }

    handledJumpRequestNonceRef.current = props.jumpRequest.nonce;

    if (viewerVariant === 'annotate' && targetAnnotation.highlightAreas?.length) {
      highlightPluginInstanceRef.current?.jumpToHighlightArea(targetAnnotation.highlightAreas[0]);
      return;
    }

    pageNavigationPluginInstanceRef.current.jumpToPage(Math.max(0, targetAnnotation.pageNumber - 1));
  }, [props.jumpRequest, session.annotations, viewerVariant]);

  return (
    <section className="section-card reader-pdf-card">
      {error ? <p className="error-text">{error}</p> : null}
      <div ref={pdfViewerShellRef} className={isViewerToolbarVisible ? 'pdf-viewer-shell pdf-viewer-shell-toolbar-open' : 'pdf-viewer-shell'}>
        <button
          type="button"
          className="pdf-toolbar-toggle"
          onClick={() => setIsViewerToolbarVisible((value) => !value)}
        >
          {isViewerToolbarVisible ? '收起工具栏' : '展开工具栏'}
        </button>
        <div className={isViewerToolbarVisible ? 'reader-react-toolbar reader-react-toolbar-open' : 'reader-react-toolbar'}>
          <div className="reader-react-toolbar-card">
            <span className="reader-react-toolbar-badge">{`第 ${currentPage} / ${viewerPageCount || '—'} 页`}</span>
            <div className="reader-react-toolbar-group">
              <button
                type="button"
                className="reader-react-toolbar-button"
                disabled={!canGoToPreviousPage}
                onClick={() => pageNavigationPluginInstanceRef.current.jumpToPreviousPage()}
              >
                上一页
              </button>
              <button
                type="button"
                className="reader-react-toolbar-button"
                disabled={!canGoToNextPage}
                onClick={() => pageNavigationPluginInstanceRef.current.jumpToNextPage()}
              >
                下一页
              </button>
              <button
                type="button"
                className="reader-react-toolbar-button reader-react-toolbar-button-icon"
                aria-label="缩小"
                onClick={() => zoomPluginInstanceRef.current.zoomTo(Math.max(0.4, Number((normalizedZoom - 0.1).toFixed(2))))}
              >
                −
              </button>
              <span className="reader-react-toolbar-badge reader-react-toolbar-badge-secondary">{zoomPercent}%</span>
              <button
                type="button"
                className="reader-react-toolbar-button"
                onClick={() => zoomPluginInstanceRef.current.zoomTo(SpecialZoomLevel.PageFit)}
              >
                适合页面
              </button>
              <button
                type="button"
                className="reader-react-toolbar-button reader-react-toolbar-button-icon"
                aria-label="放大"
                onClick={() => zoomPluginInstanceRef.current.zoomTo(Math.min(4, Number((normalizedZoom + 0.1).toFixed(2))))}
              >
                +
              </button>
            </div>
          </div>
        </div>
        {marginAnnotationConnectors.length ? (
          <svg className="reader-margin-connector-layer" aria-hidden="true">
            {marginAnnotationConnectors.map((connector) => (
              <g key={connector.annotationId}>
                <path
                  className={
                    connector.annotationId === activeAnnotationId
                      ? 'reader-margin-connector reader-margin-connector-active'
                      : 'reader-margin-connector'
                  }
                  d={createMarginConnectorPath(connector)}
                />
                <circle
                  className={
                    connector.annotationId === activeAnnotationId
                      ? 'reader-margin-connector-dot reader-margin-connector-dot-active'
                      : 'reader-margin-connector-dot'
                  }
                  cx={connector.startX}
                  cy={connector.startY}
                  r="3.5"
                />
              </g>
            ))}
          </svg>
        ) : null}
        <button
          ref={assistantDropTargetRef}
          type="button"
          style={
            assistantDropTargetPosition
              ? {
                  top: `${assistantDropTargetPosition.top}px`,
                  left: `${assistantDropTargetPosition.left}px`,
                }
              : undefined
          }
          className={
            assistantTargetHoverAnnotationId
              ? 'reader-ai-drop-target reader-ai-drop-target-visible reader-ai-drop-target-active'
              : isAssistantDropTargetVisible
                ? 'reader-ai-drop-target reader-ai-drop-target-visible'
                : 'reader-ai-drop-target'
          }
          aria-label="拖动批注卡片到这里发起 AI 提问"
          tabIndex={-1}
        >
          <ChatBotIcon />
        </button>
        {marginAnnotationColumns.left.length ? (
          <div ref={leftMarginAnnotationsRef} className="reader-margin-annotations reader-margin-annotations-left">
            {marginAnnotationColumns.left.map((annotation) => {
              const isCollapsed = collapsedMarginAnnotationIds.includes(annotation.id);
              const position = marginAnnotationPositions[annotation.id] ?? {
                x: 0,
                y: 0,
                column: 'left' as const,
              };

              return (
                <DraggableMarginAnnotation
                  key={annotation.id}
                  annotation={annotation}
                  isActive={annotation.id === activeAnnotationId}
                  isCollapsed={isCollapsed}
                  isEditing={editingMarginAnnotationId === annotation.id}
                  isSaving={isSavingMarginAnnotation && editingMarginAnnotationId === annotation.id}
                  isFocused={focusedMarginAnnotationId === annotation.id}
                  previewText={truncateAnnotationPreview(annotation.quote)}
                  position={position}
                  onOpen={(targetAnnotation) => revealMarginAnnotation(targetAnnotation.id)}
                  onAskAssistant={(targetAnnotation) => {
                    props.onAskAssistantFromAnnotation(targetAnnotation);
                  }}
                  onHoverChange={setHoveredMarginAnnotationId}
                  onDragStateChange={(annotationId, isDragging) => {
                    if (isDragging) {
                      setDraggingMarginAnnotationId(annotationId);
                    } else {
                      setDraggingMarginAnnotationId((current) => (current === annotationId ? null : current));
                    }
                    if (!isDragging) {
                      setHoveredMarginAnnotationId((current) => (current === annotationId ? null : current));
                    }
                  }}
                  onAssistantTargetHover={(annotationId, isHovering) => {
                    if (isHovering) {
                      setAssistantTargetHoverAnnotationId(annotationId);
                    } else {
                      setAssistantTargetHoverAnnotationId((current) => (current === annotationId ? null : current));
                    }
                  }}
                  onToggleCollapse={(annotationId) => {
                    setCollapsedMarginAnnotationIds((current) =>
                      current.includes(annotationId)
                        ? current.filter((id) => id !== annotationId)
                        : [...current, annotationId],
                    );
                  }}
                  onPositionChange={(annotationId, nextPosition) => {
                    setMarginAnnotationPositions((current) => ({
                      ...current,
                      [annotationId]: nextPosition,
                    }));
                  }}
                  onPositionCommit={(annotationId, nextPosition) => {
                    setMarginAnnotationPositions((current) => ({
                      ...current,
                      [annotationId]: snapMarginAnnotationPosition(nextPosition, marginColumnWidths.left),
                    }));
                  }}
                  onStartEdit={(targetAnnotation) => {
                    setEditingMarginAnnotationId(targetAnnotation.id);
                    setMarginAnnotationDraft({
                      note: targetAnnotation.note,
                      color: targetAnnotation.color,
                    });
                    setCollapsedMarginAnnotationIds((current) => current.filter((id) => id !== targetAnnotation.id));
                    onActivateAnnotationRef.current(targetAnnotation.id);
                  }}
                  onCancelEdit={() => {
                    setEditingMarginAnnotationId(null);
                  }}
                  onDraftColorChange={(color) => {
                    setMarginAnnotationDraft((current) => ({
                      ...current,
                      color,
                    }));
                  }}
                  onDraftNoteChange={(value) => {
                    setMarginAnnotationDraft((current) => ({
                      ...current,
                      note: value,
                    }));
                  }}
                  onElementChange={setMarginAnnotationElement}
                  draftColor={marginAnnotationDraft.color}
                  draftNote={marginAnnotationDraft.note}
                  assistantDropTargetRect={assistantDropTargetRect}
                />
              );
            })}
          </div>
        ) : null}
        {marginAnnotationColumns.right.length ? (
          <div ref={rightMarginAnnotationsRef} className="reader-margin-annotations reader-margin-annotations-right">
            {marginAnnotationColumns.right.map((annotation) => {
              const isCollapsed = collapsedMarginAnnotationIds.includes(annotation.id);
              const position = marginAnnotationPositions[annotation.id] ?? {
                x: 0,
                y: 0,
                column: 'right' as const,
              };

              return (
                <DraggableMarginAnnotation
                  key={annotation.id}
                  annotation={annotation}
                  isActive={annotation.id === activeAnnotationId}
                  isCollapsed={isCollapsed}
                  isEditing={editingMarginAnnotationId === annotation.id}
                  isSaving={isSavingMarginAnnotation && editingMarginAnnotationId === annotation.id}
                  isFocused={focusedMarginAnnotationId === annotation.id}
                  previewText={truncateAnnotationPreview(annotation.quote)}
                  position={position}
                  onOpen={(targetAnnotation) => revealMarginAnnotation(targetAnnotation.id)}
                  onAskAssistant={(targetAnnotation) => {
                    props.onAskAssistantFromAnnotation(targetAnnotation);
                  }}
                  onHoverChange={setHoveredMarginAnnotationId}
                  onDragStateChange={(annotationId, isDragging) => {
                    if (isDragging) {
                      setDraggingMarginAnnotationId(annotationId);
                    } else {
                      setDraggingMarginAnnotationId((current) => (current === annotationId ? null : current));
                    }
                    if (!isDragging) {
                      setHoveredMarginAnnotationId((current) => (current === annotationId ? null : current));
                    }
                  }}
                  onAssistantTargetHover={(annotationId, isHovering) => {
                    if (isHovering) {
                      setAssistantTargetHoverAnnotationId(annotationId);
                    } else {
                      setAssistantTargetHoverAnnotationId((current) => (current === annotationId ? null : current));
                    }
                  }}
                  onToggleCollapse={(annotationId) => {
                    setCollapsedMarginAnnotationIds((current) =>
                      current.includes(annotationId)
                        ? current.filter((id) => id !== annotationId)
                        : [...current, annotationId],
                    );
                  }}
                  onPositionChange={(annotationId, nextPosition) => {
                    setMarginAnnotationPositions((current) => ({
                      ...current,
                      [annotationId]: nextPosition,
                    }));
                  }}
                  onPositionCommit={(annotationId, nextPosition) => {
                    setMarginAnnotationPositions((current) => ({
                      ...current,
                      [annotationId]: snapMarginAnnotationPosition(nextPosition, marginColumnWidths.right),
                    }));
                  }}
                  onStartEdit={(targetAnnotation) => {
                    setEditingMarginAnnotationId(targetAnnotation.id);
                    setMarginAnnotationDraft({
                      note: targetAnnotation.note,
                      color: targetAnnotation.color,
                    });
                    setCollapsedMarginAnnotationIds((current) => current.filter((id) => id !== targetAnnotation.id));
                    onActivateAnnotationRef.current(targetAnnotation.id);
                  }}
                  onCancelEdit={() => {
                    setEditingMarginAnnotationId(null);
                  }}
                  onDraftColorChange={(color) => {
                    setMarginAnnotationDraft((current) => ({
                      ...current,
                      color,
                    }));
                  }}
                  onDraftNoteChange={(value) => {
                    setMarginAnnotationDraft((current) => ({
                      ...current,
                      note: value,
                    }));
                  }}
                  onElementChange={setMarginAnnotationElement}
                  draftColor={marginAnnotationDraft.color}
                  draftNote={marginAnnotationDraft.note}
                  assistantDropTargetRect={assistantDropTargetRect}
                />
              );
            })}
          </div>
        ) : null}
        {pdfBlobUrl ? (
          <PdfViewerErrorBoundary
            resetKey={paper.id}
            onError={(message) => {
              setInlineDraft(null);
              setError(message);
            }}
          >
            <Worker workerUrl={pdfWorkerUrl}>
              <Viewer
                key={`${paper.id}-${viewerVariant}`}
                fileUrl={pdfBlobUrl}
                initialPage={Math.max(0, currentPage - 1)}
                defaultScale={zoom > 0 ? zoom : SpecialZoomLevel.PageFit}
                plugins={
                  viewerVariant === 'annotate'
                    ? [pageNavigationPluginInstance, zoomPluginInstance, highlightPluginInstance]
                    : [pageNavigationPluginInstance, zoomPluginInstance]
                }
                onDocumentLoad={(event: DocumentLoadEvent) => {
                  setError('');
                  setViewerPageCount(event.doc.numPages);
                  props.onDocumentLoad(event.doc.numPages);
                  if (viewerVariant === 'base') {
                    setViewerVariant('annotate');
                  }
                }}
                onPageChange={(event: PageChangeEvent) => {
                  props.onPageChange(event.currentPage + 1);
                }}
                onZoom={(event: ZoomEvent) => {
                  props.onZoomChange(event.scale);
                }}
              />
            </Worker>
          </PdfViewerErrorBoundary>
        ) : (
          <p className="muted">正在加载 PDF 文件...</p>
        )}
      </div>
    </section>
  );
}

/**
 * @function ReaderSidebar
 * @description 展示论文详情、批注列表与阅读笔记编辑区，完成阅读器与论文库详情联动。
 * @param {ReaderSidebarProps} props 右侧信息栏配置
 * @returns {JSX.Element} 右侧信息栏节点
 */
function ReaderSidebar(props: ReaderSidebarProps): JSX.Element {
  const annotations = Array.isArray(props.session.annotations) ? props.session.annotations : [];
  const activeAssistantSession = getCurrentReaderAssistantSession(props.session);
  const noteEntries = parseReaderNoteEntries(props.session.note)
    .map((entry, index) => ({ entry, index }))
    .reverse();
  const inspectorMeta = getReaderInspectorMeta(props.activePanel);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isNoteComposerFlashing, setIsNoteComposerFlashing] = useState(false);
  const [isAssistantBusy, setIsAssistantBusy] = useState(false);
  const inspectorTabs: Array<{
    panel: ReaderInspectorPanel;
    label: string;
    shortLabel: string;
    count?: number;
  }> = [
    {
      panel: 'annotations',
      label: '批注',
      shortLabel: '批',
      count: annotations.length || undefined,
    },
    {
      panel: 'notes',
      label: '笔记',
      shortLabel: '笔',
    },
    {
      panel: 'assistant',
      label: 'AI',
      shortLabel: 'AI',
      count: props.session.assistantSessions.length || activeAssistantSession?.conversation.length || undefined,
    },
  ];

  useEffect(() => {
    const textareaElement = noteTextareaRef.current;

    if (!textareaElement || props.activePanel !== 'notes') {
      return;
    }

    textareaElement.style.height = '0px';
    const nextHeight = Math.min(Math.max(textareaElement.scrollHeight, 120), 240);
    textareaElement.style.height = `${nextHeight}px`;
    textareaElement.style.overflowY = textareaElement.scrollHeight > 240 ? 'auto' : 'hidden';
  }, [props.activePanel, props.noteDraft]);

  useEffect(() => {
    if (!props.noteFeedbackNonce) {
      return;
    }

    setIsNoteComposerFlashing(true);
    const timeoutId = window.setTimeout(() => {
      setIsNoteComposerFlashing(false);
    }, 720);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [props.noteFeedbackNonce]);

  /**
   * @function handleCreateAssistantSession
   * @description 在标题栏直接新建 AI 会话，减少进入不同问题分支的操作成本。
   * @returns {Promise<void>} 创建结果
   */
  async function handleCreateAssistantSession(): Promise<void> {
    if (isAssistantBusy || props.activePanel !== 'assistant') {
      return;
    }

    try {
      const nextSession = await window.desktopApi.createReaderAssistantSession(props.paper.id);
      props.onSessionChange(nextSession);
      props.onNotify({
        tone: 'success',
        message: '已新建 AI 会话。',
      });
    } catch (error: unknown) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '新建 AI 会话失败',
      });
    }
  }

  /**
   * @function handleSaveAssistantSession
   * @description 在标题栏保存当前 AI 会话，便于后续从索引中继续回看与追问。
   * @returns {Promise<void>} 保存结果
   */
  async function handleSaveAssistantSession(): Promise<void> {
    if (isAssistantBusy || props.activePanel !== 'assistant' || !activeAssistantSession) {
      return;
    }

    try {
      const nextSession = await window.desktopApi.saveReaderAssistantSession(props.paper.id, activeAssistantSession.id);
      props.onSessionChange(nextSession);
      props.onNotify({
        tone: 'success',
        message: '当前 AI 会话已保存。',
      });
    } catch (error: unknown) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '保存 AI 会话失败',
      });
    }
  }

  return (
    <aside
      className={
        props.isVisible ? 'reader-inspector reader-inspector-open' : 'reader-inspector reader-inspector-collapsed'
      }
    >
      {props.isVisible ? (
        <section
          className={
            props.activePanel === 'notes'
              ? 'section-card reader-inspector-panel reader-inspector-panel-notes'
              : props.activePanel === 'assistant'
                ? 'section-card reader-inspector-panel reader-inspector-panel-assistant'
              : 'section-card reader-inspector-panel'
          }
        >
          <header className="section-header reader-inspector-panel-header">
            <div className="reader-inspector-panel-title">
              <h3>{inspectorMeta.title}</h3>
              {props.activePanel === 'assistant' ? (
                <div className="reader-inspector-panel-actions">
                  <button
                    type="button"
                    className="reader-assistant-session-action"
                    disabled={isAssistantBusy}
                    onClick={() => void handleCreateAssistantSession()}
                  >
                    新建
                  </button>
                  <button
                    type="button"
                    className="reader-assistant-session-action reader-assistant-session-action-primary"
                    disabled={isAssistantBusy || !activeAssistantSession}
                    onClick={() => void handleSaveAssistantSession()}
                  >
                    保存当前会话
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="reader-inspector-rail-toggle"
                aria-label={props.isRailVisible ? '隐藏功能栏' : '展开功能栏'}
                onClick={props.onToggleRail}
              >
                {props.isRailVisible ? '‹' : '›'}
              </button>
            </div>
          </header>

          {props.activePanel === 'annotations' ? (
            <div className="reader-annotation-list">
              {annotations.length ? (
                annotations.map((annotation) => (
                  <article
                    key={annotation.id}
                    className={
                      annotation.id === props.activeAnnotationId
                        ? `reader-annotation-card reader-annotation-${annotation.color} reader-annotation-card-active`
                        : `reader-annotation-card reader-annotation-${annotation.color}`
                    }
                    onClick={() => props.onSelectAnnotation(annotation)}
                  >
                    <div className="reader-annotation-card-header">
                      <strong>第 {annotation.pageNumber} 页</strong>
                      <button
                        type="button"
                        className="reader-annotation-delete-button"
                        aria-label="删除批注"
                        onClick={(event) => {
                          event.stopPropagation();
                          void props.onRemoveAnnotation(annotation.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                    <p className="reader-annotation-quote">“{annotation.quote}”</p>
                    <p className="muted">{annotation.note || '暂无备注'}</p>
                  </article>
                ))
              ) : (
                <p className="muted">当前论文还没有保存批注。请直接在 PDF 中划线并填写备注。</p>
              )}
            </div>
          ) : null}

          {props.activePanel === 'notes' ? (
            <section className="reader-notes-panel">
              <div className="reader-notes-list">
                {noteEntries.length ? (
                  noteEntries.map((entry, index) => (
                    <article key={`${entry.entry.slice(0, 24)}-${entry.index}`} className="reader-note-entry">
                      <div className="reader-note-entry-header">
                        <span className="reader-note-entry-index">#{noteEntries.length - index}</span>
                        <button
                          type="button"
                          className="reader-note-delete-button"
                          aria-label="删除笔记"
                          onClick={() => void props.onRemoveNote(entry.index)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      <p>{entry.entry}</p>
                    </article>
                  ))
                ) : (
                  <p className="muted">还没有阅读笔记。你可以先在下方写下一条想法。</p>
                )}
              </div>
              <div className="reader-note-composer">
                <label className="field reader-note-composer-field">
                  <span>输入新笔记</span>
                  <div className={isNoteComposerFlashing ? 'reader-note-composer-input reader-note-composer-input-flash' : 'reader-note-composer-input'}>
                    <textarea
                      ref={noteTextareaRef}
                      className="reader-note-composer-textarea"
                      value={props.noteDraft}
                      onChange={(event) => props.onNoteDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !props.isSavingNote && props.noteDraft.trim()) {
                          event.preventDefault();
                          void props.onSaveNote();
                        }
                      }}
                      rows={5}
                      placeholder="记录这篇论文的核心贡献、实验疑问和自己的后续行动。"
                    />
                    <span className="reader-note-shortcut-hint">⌘/Ctrl + Enter</span>
                    <button
                      type="button"
                      className="reader-note-send-button"
                      aria-label="发送笔记"
                      disabled={props.isSavingNote || !props.noteDraft.trim()}
                      onClick={() => void props.onSaveNote()}
                    >
                      <SendArrowIcon />
                    </button>
                  </div>
                </label>
              </div>
            </section>
          ) : null}

          {props.activePanel === 'assistant'
            ? isValidElement<ReaderAssistantPanelProps>(props.children)
              ? cloneElement(props.children, {
                  onBusyChange: setIsAssistantBusy,
                })
              : props.children
            : null}
        </section>
      ) : null}

      {props.isRailVisible ? (
        <div className="reader-inspector-rail">
          {inspectorTabs.map((tab) => (
            <button
              key={tab.panel}
              type="button"
              className={
                props.isVisible && props.activePanel === tab.panel
                  ? 'reader-inspector-tab reader-inspector-tab-active'
                  : 'reader-inspector-tab'
              }
              onClick={() => props.onOpenPanel(tab.panel)}
            >
              <span className="reader-inspector-tab-icon">{tab.shortLabel}</span>
              <span className="reader-inspector-tab-label">{tab.label}</span>
              {tab.count ? <span className="reader-inspector-tab-count">{tab.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function getReaderInspectorMeta(panel: ReaderInspectorPanel): { title: string; description: string } {
  if (panel === 'annotations') {
    return {
      title: '摘录批注',
      description: '',
    };
  }

  if (panel === 'notes') {
    return {
      title: '阅读笔记',
      description: '',
    };
  }

  if (panel === 'assistant') {
    return {
      title: '阅读内 AI 对话',
      description: '',
    };
  }

  return {
    title: '摘录批注',
    description: '',
  };
}


/**
 * @function ReaderAssistantPanel
 * @description 在阅读器侧边提供连续问答面板，并将回复写回本地阅读会话。
 * @param {ReaderAssistantPanelProps} props AI 面板所需的会话与消息回调
 * @returns {JSX.Element} AI 对话面板节点
 */
function ReaderAssistantPanel(props: ReaderAssistantPanelProps): JSX.Element {
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [isSessionStripCollapsed, setIsSessionStripCollapsed] = useState(true);
  const [timelineSummary, setTimelineSummary] = useState<string[]>([]);
  const [isAssistantComposerFlashing, setIsAssistantComposerFlashing] = useState(false);
  const assistantSessions = getReaderAssistantSessions(props.session);
  const activeAssistantSession = getCurrentReaderAssistantSession(props.session);
  const conversation = activeAssistantSession?.conversation ?? [];
  const questionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const textareaElement = questionTextareaRef.current;

    if (!textareaElement) {
      return;
    }

    textareaElement.style.height = '0px';
    const nextHeight = Math.min(Math.max(textareaElement.scrollHeight, 120), 240);
    textareaElement.style.height = `${nextHeight}px`;
    textareaElement.style.overflowY = textareaElement.scrollHeight > 240 ? 'auto' : 'hidden';
  }, [question]);

  useEffect(() => {
    props.onBusyChange(isAsking);
  }, [isAsking, props]);

  useEffect(() => {
    if (!isAssistantComposerFlashing) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsAssistantComposerFlashing(false);
    }, 720);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAssistantComposerFlashing]);

  useEffect(() => {
    setTimelineSummary([]);
  }, [activeAssistantSession?.id]);

  useEffect(() => {
    const threadElement = threadRef.current;

    if (!threadElement) {
      return;
    }

    threadElement.scrollTo({
      top: threadElement.scrollHeight,
      behavior: 'smooth',
    });
  }, [conversation.length, isAsking]);

  async function handleAskAssistant(): Promise<void> {
    if (isAsking || !question.trim() || !activeAssistantSession) {
      return;
    }

    setIsAsking(true);

    try {
      const result = await window.desktopApi.askReaderAssistant({
        paperId: props.paper.id,
        question,
        currentPage: props.currentPage,
        assistantSessionId: activeAssistantSession.id,
      });
      let nextSession = result.session;
      const nextAssistantSession = getCurrentReaderAssistantSession(result.session);
      const latestAssistantReply = nextAssistantSession?.conversation.at(-1)?.content ?? '';

      if (props.assistantSelection) {
        nextSession = await window.desktopApi.addReaderAnnotation(props.paper.id, {
          pageNumber: props.assistantSelection.pageNumber,
          quote: props.assistantSelection.quote,
          note: createAssistantAnnotationNote(question, latestAssistantReply),
          color: props.assistantSelection.color,
          highlightAreas: props.assistantSelection.highlightAreas,
        });
        props.onActivateAnnotation(nextSession.annotations[0]?.id ?? null);
        props.onClearSelection();
      }

      props.onSessionChange(nextSession);
      setTimelineSummary(result.timeline.map((entry) => `${entry.stage}：${entry.message}`));
      setQuestion('');
      setIsAssistantComposerFlashing(true);
      props.onNotify({
        tone: 'success',
        message: props.assistantSelection ? '阅读问答已生成，并已沉淀为对应选区批注。' : '阅读问答已生成，可继续在同一面板中追问。',
      });
    } catch (error: unknown) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '阅读问答失败',
      });
    } finally {
      setIsAsking(false);
    }
  }

  /**
   * @function handleSelectAssistantSession
   * @description 切换当前活跃 AI 会话，保持不同问题线索的上下文隔离。
   * @param {string} assistantSessionId 目标会话标识
   * @returns {Promise<void>} 切换结果
   */
  async function handleSelectAssistantSession(assistantSessionId: string): Promise<void> {
    if (isAsking || assistantSessionId === activeAssistantSession?.id) {
      return;
    }

    try {
      const nextSession = await window.desktopApi.selectReaderAssistantSession(props.paper.id, assistantSessionId);
      props.onSessionChange(nextSession);
      setIsSessionStripCollapsed(true);
    } catch (error: unknown) {
      props.onNotify({
        tone: 'error',
        message: error instanceof Error ? error.message : '切换 AI 会话失败',
      });
    }
  }

  return (
    <section className="reader-assistant-panel">
      <div className="reader-assistant-session-strip">
        <div className="reader-assistant-session-strip-header">
          <button
            type="button"
            className={isSessionStripCollapsed ? 'reader-assistant-session-strip-toggle' : 'reader-assistant-session-strip-toggle reader-assistant-session-strip-toggle-expanded'}
            aria-expanded={!isSessionStripCollapsed}
            aria-label={isSessionStripCollapsed ? '展开对话索引' : '收起对话索引'}
            onClick={() => {
              setIsSessionStripCollapsed((current) => !current);
            }}
          >
            <div className="reader-assistant-session-strip-heading">
              <span>论文会话</span>
              <strong>对话索引</strong>
            </div>
            <div className="reader-assistant-session-strip-summary">
              <span className="reader-assistant-session-strip-count">{assistantSessions.length} 条</span>
              <span className="reader-assistant-session-strip-caret">{isSessionStripCollapsed ? '展开' : '收起'}</span>
            </div>
          </button>
        </div>
        {!isSessionStripCollapsed ? (
          <div className="reader-assistant-session-list">
            {assistantSessions.map((assistantSession, index) => (
              <button
                key={assistantSession.id}
                type="button"
                className={
                  assistantSession.id === activeAssistantSession?.id
                    ? 'reader-assistant-session-chip reader-assistant-session-chip-active'
                    : 'reader-assistant-session-chip'
                }
                onClick={() => void handleSelectAssistantSession(assistantSession.id)}
              >
                <div className="reader-assistant-session-chip-topline">
                  <span className="reader-assistant-session-chip-index">{String(index + 1).padStart(2, '0')}</span>
                  <span
                    className={
                      assistantSession.isSaved
                        ? 'reader-assistant-session-chip-status reader-assistant-session-chip-status-saved'
                        : 'reader-assistant-session-chip-status'
                    }
                  >
                    {assistantSession.isSaved ? '已保存' : '草稿'}
                  </span>
                  <time className="reader-assistant-session-chip-time">{formatChatMessageTime(assistantSession.updatedAt) || '--:--'}</time>
                </div>
                <strong className="reader-assistant-session-chip-title">{assistantSession.title || '未命名会话'}</strong>
                <p className="reader-assistant-session-chip-preview">{getAssistantSessionPreview(assistantSession)}</p>
                <div className="reader-assistant-session-chip-meta">
                  <span>{getAssistantSessionTurnCount(assistantSession)} 轮追问</span>
                  <span>{assistantSession.conversation.length} 条消息</span>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div ref={threadRef} className="reader-assistant-thread">
        {conversation.length ? (
          conversation.map((message) => (
            <article
              key={message.id}
              className={
                message.role === 'assistant'
                  ? 'reader-chat-row reader-chat-row-assistant'
                  : 'reader-chat-row reader-chat-row-user'
              }
            >
              <div
                className={
                  message.role === 'assistant'
                    ? 'reader-chat-message reader-chat-message-assistant'
                    : 'reader-chat-message reader-chat-message-user'
                }
              >
                <div className="reader-chat-message-meta">
                  <strong>{message.role === 'assistant' ? 'AI 助手' : '我'}</strong>
                  <span>{formatChatMessageTime(message.createdAt)}</span>
                </div>
                <p>{message.content}</p>
                {message.references.length ? (
                  <div className="reader-chat-message-references">
                    {message.references.map((reference) => (
                      <button
                        key={`${message.id}-${reference}`}
                        type="button"
                        className={
                          extractPageNumberFromReference(reference)
                            ? 'reader-chat-reference-chip reader-chat-reference-chip-clickable'
                            : 'reader-chat-reference-chip'
                        }
                        onClick={() => {
                          const targetPage = extractPageNumberFromReference(reference);

                          if (targetPage) {
                            props.onJumpToPage(targetPage);
                          }
                        }}
                      >
                        {reference}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="reader-assistant-empty">
            <p>试试提问“这篇论文的核心贡献是什么？”或“第 3 页的方法和基线差异在哪里？”</p>
          </div>
        )}
        {isAsking ? (
          <article className="reader-chat-row reader-chat-row-assistant">
            <div className="reader-chat-message reader-chat-message-assistant reader-chat-message-thinking">
              <div className="reader-chat-message-meta">
                <strong>AI 助手</strong>
                <span>思考中</span>
              </div>
              <p>正在结合当前页、批注和笔记整理回答…</p>
            </div>
          </article>
        ) : null}
      </div>
      <div className="reader-assistant-composer">
        {timelineSummary.length ? (
          <div className="reader-assistant-status-list">
            {timelineSummary.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        ) : null}
        {props.assistantSelection ? (
          <div className="reader-assistant-selection-card">
            <div className="reader-assistant-selection-meta">
              <strong>
                {props.assistantSelection.sourceAnnotationId ? '当前关联批注' : '当前选区'} · 第 {props.assistantSelection.pageNumber} 页
              </strong>
              <button type="button" className="reader-assistant-selection-clear" onClick={props.onClearSelection}>
                取消选区
              </button>
            </div>
            <p className="reader-assistant-selection-quote">“{props.assistantSelection.quote}”</p>
            <span className="reader-assistant-selection-hint">
              {props.assistantSelection.sourceAnnotationId
                ? `本次问答会直接沿用这张批注卡片对应的段落上下文，自动追加新的批注。`
                : props.assistantSelection.linkedAnnotationCount
                ? `这段文字已有 ${props.assistantSelection.linkedAnnotationCount} 条批注，请优先从已有批注卡片发起 AI 提问。`
                : '这段文字当前还没有批注，本次问答会自动沉淀为新的批注。'}
            </span>
          </div>
        ) : null}
        <label className="field reader-note-composer-field">
          <span>继续提问</span>
          <div
            className={
              isAssistantComposerFlashing
                ? 'reader-note-composer-input reader-assistant-composer-input reader-note-composer-input-flash'
                : 'reader-note-composer-input reader-assistant-composer-input'
            }
          >
            <textarea
              ref={questionTextareaRef}
              className="reader-note-composer-textarea reader-assistant-composer-textarea"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isAsking && question.trim()) {
                  event.preventDefault();
                  void handleAskAssistant();
                }
              }}
              rows={5}
              placeholder={`围绕第 ${props.currentPage} 页继续提问，AI 会结合摘要、批注和笔记回答。`}
            />
            <span className="reader-note-shortcut-hint">⌘/Ctrl + Enter</span>
            <button
              type="button"
              className="reader-note-send-button"
              aria-label="发送问题"
              disabled={isAsking || !question.trim() || !activeAssistantSession}
              onClick={() => void handleAskAssistant()}
            >
              <SendArrowIcon />
            </button>
          </div>
        </label>
      </div>
    </section>
  );
}

/**
 * @function loadPdfBinary
 * @description 通过桌面端 IPC 读取本地 PDF 二进制内容，避免渲染层直接请求 file 协议导致失败。
 * @param {string | null} filePath 本地文件绝对路径
 * @returns {Promise<Uint8Array>} PDF 二进制内容
 */
async function loadPdfBinary(filePath: string | null): Promise<string> {
  if (!filePath) {
    throw new Error('当前论文缺少本地 PDF 文件路径');
  }

  return window.desktopApi.readLocalPdf(filePath);
}

function decodeBase64Pdf(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const raw = atob(cleaned);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

function createReaderProgressSignature(currentPage: number, zoom: number, totalPages: number): string {
  return [currentPage, Number(zoom.toFixed(2)), totalPages].join(':');
}

function getMarginAnnotationStorageKey(paperId: string): string {
  return `reader-margin-annotation-layout:${paperId}`;
}

function loadReaderInspectorWidth(): number {
  try {
    const raw = window.localStorage.getItem('reader-inspector-width');
    const width = Number(raw);

    if (!Number.isFinite(width)) {
      return 420;
    }

    return clampValue(width, 320, 640);
  } catch {
    return 420;
  }
}

function persistReaderInspectorWidth(width: number): void {
  try {
    window.localStorage.setItem('reader-inspector-width', String(width));
  } catch {
    return;
  }
}

function loadMarginAnnotationPositions(paperId: string): Record<string, MarginAnnotationPosition> {
  try {
    const raw = window.localStorage.getItem(getMarginAnnotationStorageKey(paperId));

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, Partial<MarginAnnotationPosition>>;

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([annotationId, value]) => {
        if ((value.column !== 'left' && value.column !== 'right') || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
          return [];
        }

        const position: MarginAnnotationPosition = {
          x: Number(value.x),
          y: Number(value.y),
          column: value.column,
        };

        return [
          [
            annotationId,
            position,
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

function persistMarginAnnotationPositions(paperId: string, positions: Record<string, MarginAnnotationPosition>): void {
  try {
    window.localStorage.setItem(getMarginAnnotationStorageKey(paperId), JSON.stringify(positions));
  } catch {
    return;
  }
}

function getDefaultMarginAnnotationPosition(column: MarginAnnotationPosition['column'], index: number): MarginAnnotationPosition {
  return {
    x: column === 'left' ? 18 : -18,
    y: index * 144,
    column,
  };
}

function snapMarginAnnotationPosition(position: MarginAnnotationPosition, columnWidth: number): MarginAnnotationPosition {
  if (columnWidth >= 188) {
    return {
      ...position,
      y: Math.max(0, position.y),
    };
  }

  const snappedX = position.column === 'left' ? (position.x > 9 ? 18 : 0) : (position.x < -9 ? -18 : 0);

  return {
    ...position,
    x: snappedX,
    y: Math.max(0, position.y),
  };
}

function isPointWithinRect(x: number, y: number, rect: DOMRect | null): boolean {
  if (!rect) {
    return false;
  }

  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getReaderAssistantSessions(session: ReaderSession): ReaderAssistantSession[] {
  return Array.isArray(session.assistantSessions) ? session.assistantSessions : [];
}

function getCurrentReaderAssistantSession(session: ReaderSession): ReaderAssistantSession | null {
  const assistantSessions = getReaderAssistantSessions(session);

  if (!assistantSessions.length) {
    return null;
  }

  return assistantSessions.find((assistantSession) => assistantSession.id === session.currentAssistantSessionId) ?? assistantSessions[0];
}

/**
 * @function getAssistantSessionPreview
 * @description 为会话索引卡片提炼一行摘要，突出最近一次研究线索或对话主题。
 * @param {ReaderAssistantSession} assistantSession 单条 AI 会话
 * @returns {string} 用于索引列表展示的摘要文案
 */
function getAssistantSessionPreview(assistantSession: ReaderAssistantSession): string {
  const latestQuestion = [...assistantSession.conversation].reverse().find((message) => message.role === 'user');
  const latestReply = [...assistantSession.conversation].reverse().find((message) => message.role === 'assistant');
  const previewSource = latestQuestion?.content || latestReply?.content || '';
  const normalizedPreview = previewSource.replace(/\s+/g, ' ').trim();

  if (!normalizedPreview) {
    return '从批注拖拽、划词提问或直接输入问题，建立一条新的研究线索。';
  }

  // 关键逻辑：索引卡片优先展示最近问题线，保证侧栏能像学术工具一样先看主题再决定切换。
  return normalizedPreview.length > 72 ? `${normalizedPreview.slice(0, 72)}…` : normalizedPreview;
}

/**
 * @function getAssistantSessionTurnCount
 * @description 根据消息数量估算当前会话的问答轮次，帮助用户快速判断讨论深度。
 * @param {ReaderAssistantSession} assistantSession 单条 AI 会话
 * @returns {number} 适合在索引卡片中展示的轮次数
 */
function getAssistantSessionTurnCount(assistantSession: ReaderAssistantSession): number {
  return Math.max(1, Math.ceil(assistantSession.conversation.length / 2));
}

function formatChatMessageTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createAssistantAnnotationNote(question: string, answer: string): string {
  const normalizedQuestion = question.trim();
  const normalizedAnswer = answer.replace(/\s+/g, ' ').trim();
  const summary = normalizedAnswer.length > 200 ? `${normalizedAnswer.slice(0, 200)}…` : normalizedAnswer;

  return [`问题：${normalizedQuestion}`, `结论：${summary}`].join('\n');
}

function extractPageNumberFromReference(reference: string): number | null {
  const match = reference.match(/第\s*(\d+)\s*页/);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function areHighlightAreaCollectionsEqual(
  leftAreas: ReaderHighlightArea[],
  rightAreas: ReaderHighlightArea[],
): boolean {
  if (leftAreas.length !== rightAreas.length) {
    return false;
  }

  return leftAreas.every((leftArea, index) => {
    const rightArea = rightAreas[index];

    return Boolean(rightArea)
      && leftArea.pageIndex === rightArea.pageIndex
      && leftArea.top === rightArea.top
      && leftArea.left === rightArea.left
      && leftArea.width === rightArea.width
      && leftArea.height === rightArea.height;
  });
}

function parseReaderNoteEntries(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function appendReaderNote(existingValue: string, nextEntry: string): string {
  const cleanEntry = nextEntry.trim();

  if (!cleanEntry) {
    return existingValue.trim();
  }

  return existingValue.trim() ? `${existingValue.trim()}\n\n${cleanEntry}` : cleanEntry;
}

function truncateAnnotationPreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();

  if (compact.length <= 44) {
    return compact;
  }

  return `${compact.slice(0, 44)}…`;
}

function createMarginConnectorPath(connector: MarginAnnotationConnector): string {
  const deltaX = connector.endX - connector.startX;
  const controlOffset = Math.max(28, Math.min(72, Math.abs(deltaX) * 0.32));
  const controlX1 = connector.startX + (deltaX > 0 ? controlOffset : -controlOffset);
  const controlX2 = connector.endX - (deltaX > 0 ? controlOffset : -controlOffset);

  return `M ${connector.startX} ${connector.startY} C ${controlX1} ${connector.startY}, ${controlX2} ${connector.endY}, ${connector.endX} ${connector.endY}`;
}

function joinTextList(values: string[] | null | undefined, separator: string, fallback: string): string {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }

  return values.join(separator) || fallback;
}

function normalizeHighlightArea(area: HighlightArea): ReaderHighlightArea {
  return {
    pageIndex: area.pageIndex,
    top: area.top,
    left: area.left,
    width: area.width,
    height: area.height,
  };
}

function createInlineAnnotationDraft(
  selectedText: string,
  highlightAreas: HighlightArea[],
  selectionRegion: HighlightArea,
  color: ReaderAnnotationColor,
): ReaderInlineAnnotationDraft {
  return {
    pageNumber: Math.max(1, selectionRegion.pageIndex + 1),
    quote: selectedText.trim(),
    note: '',
    color,
    highlightAreas: highlightAreas.map((area) => normalizeHighlightArea(area)),
    selectionRegion,
  };
}

function createEmptyAnnotationDraft(pageNumber: number, color: ReaderAnnotationColor = 'yellow'): ReaderAnnotationDraft {
  return {
    pageNumber: String(pageNumber),
    quote: '',
    note: '',
    color,
    highlightAreas: [],
  };
}

/**
 * @function getReadingStatusLabel
 * @description 将阅读状态枚举转换为中文标签，便于在阅读器侧边栏展示。
 * @param {PaperRecord['readingStatus']} status 阅读状态枚举
 * @returns {string} 中文标签
 */
function getReadingStatusLabel(status: PaperRecord['readingStatus']): string {
  if (status === 'completed') {
    return '已读完';
  }

  if (status === 'reading') {
    return '阅读中';
  }

  return '未开始';
}

function getAnnotationColorLabel(color: ReaderAnnotationColor): string {
  if (color === 'blue') {
    return '蓝色';
  }

  if (color === 'pink') {
    return '粉色';
  }

  if (color === 'mint') {
    return '薄荷';
  }

  return '黄色';
}

function TrashIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.25 2.75H10.75M2.75 4.25H13.25M6.25 1.75H9.75C10.1642 1.75 10.5 2.08579 10.5 2.5V2.75H5.5V2.5C5.5 2.08579 5.83579 1.75 6.25 1.75ZM4.25 4.25L4.75 12.5C4.80208 13.3591 5.5137 14.0312 6.375 14.0312H9.625C10.4863 14.0312 11.1979 13.3591 11.25 12.5L11.75 4.25M6.5 6.5V11M9.5 6.5V11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendArrowIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 13.75V4.25M8 4.25L4.5 7.75M8 4.25L11.5 7.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * @function ChatBotIcon
 * @description 渲染阅读器内 AI 入口使用的机器人线框图标。
 * @returns {JSX.Element} 机器人图标节点
 */
function ChatBotIcon(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.25 9.25H8.258M15.75 9.25H15.758M9 14.25H15M12 3.75C7.44365 3.75 3.75 7.10786 3.75 11.25C3.75 13.2182 4.58931 15.0081 5.96472 16.3577C6.25391 16.6415 6.42036 17.0284 6.39762 17.4331L6.25 20.25L9.44935 18.6355C9.7756 18.4708 10.1469 18.4166 10.5069 18.4781C10.9905 18.5607 11.4884 18.75 12 18.75C16.5563 18.75 20.25 15.3921 20.25 11.25C20.25 7.10786 16.5563 3.75 12 3.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
