# PDF 索引与阅读 RAG 当前实现梳理

> 梳理日期：2026-04-28  
> 范围：当前阅读器问答链路、PDF 正文索引、联网补充、RAG prompt 组装、后续增强建议。

## 1. 当前目标

当前阅读问答已经从最初的“论文摘要 + 批注 + 笔记”升级为：

- 本地 PDF 正文抽取
- 按页索引
- 当前页上下文
- 附近页上下文
- 关键词相关段落召回
- 阅读批注
- 阅读笔记
- 最近对话
- 按需联网补充资料
- OpenAI Compatible 模型流式回答

核心目标是让 AI 回答更贴近用户正在阅读的 PDF 页面，而不是只基于论文摘要泛泛回答。

## 2. 当前调用链路

阅读器中发送问题后的链路如下：

1. Renderer 调用 `window.desktopApi.askReaderAssistantStream(...)`
2. Preload 为本次请求生成 `requestId`
3. Main IPC 接收 `reader:ask-assistant-stream`
4. `ReaderService.askAssistant(...)` 读取论文与阅读会话
5. `PaperTextIndexService.getReaderTextContext(...)` 获取 PDF 正文上下文
6. `ReaderInternetContextService.collect(...)` 判断是否需要联网，并按需获取 OpenAlex / GitHub 补充资料
7. `AgentRuntimeService.runReaderQaAgent(...)` 组装 prompt
8. `AiModelClient.chatStream(...)` 调用 OpenAI Compatible `/chat/completions`
9. 主进程通过 IPC event 推送 token delta 到 Renderer
10. Renderer 流式显示助手消息
11. 模型完成后，`ReaderService` 将用户消息和助手消息正式写入阅读会话 JSON
12. Renderer 用正式会话替换临时消息

主要文件：

- `src/renderer/src/ReaderPage.tsx`
- `src/preload/index.ts`
- `src/main/ipc/registerIpcHandlers.ts`
- `src/main/reader/ReaderService.ts`
- `src/main/reader/PaperTextIndexService.ts`
- `src/main/agents/AgentRuntimeService.ts`
- `src/main/ai/AiModelClient.ts`

## 3. PDF 正文索引方式

### 3.1 触发时机

当前 PDF 正文索引是“按需触发”的：

- 用户第一次在某篇论文阅读器里提问时触发。
- 如果缓存已存在且 PDF 文件未变化，则直接复用缓存。
- 如果 PDF 文件路径、mtime 或 size 变化，则重新抽取。

也就是说，目前不是导入论文时立即索引，而是首次问答时懒加载。

### 3.2 文本抽取

实现位置：

- `src/main/reader/PaperTextIndexService.ts`

当前使用：

- `pdfjs-dist/legacy/build/pdf.js`
- `page.getTextContent()`
- 只抽取 PDF 文本层，不做 OCR。

抽取流程：

1. 读取本地 PDF buffer。
2. 用 `pdfjs.getDocument(...)` 打开 PDF。
3. 遍历每一页。
4. 调用 `page.getTextContent()`。
5. 过滤 `TextItem`。
6. 将 `item.str` 拼接为页面文本。
7. 做空白字符归一化。

当前限制：

- 扫描版 PDF 或图片型 PDF 抽不到正文。
- 文本顺序依赖 PDF 文本层，复杂双栏论文可能出现段落顺序不完美。
- 没有识别章节标题、公式、表格、图片说明。
- 没有按 layout 重建阅读顺序。

### 3.3 缓存结构

缓存目录：

```text
cache/paper-text-indexes/
```

单篇索引结构：

```ts
interface PaperTextIndex {
  paperId: string;
  sourcePdfPath: string;
  sourcePdfMtimeMs: number;
  sourcePdfSize: number;
  generatedAt: string;
  pages: PaperTextPage[];
  chunks: PaperTextChunk[];
}
```

页面结构：

```ts
interface PaperTextPage {
  pageNumber: number;
  text: string;
}
```

段落块结构：

```ts
interface PaperTextChunk {
  id: string;
  pageStart: number;
  pageEnd: number;
  text: string;
}
```

## 4. Chunk 切分与召回方式

### 4.1 当前切分方式

当前 chunk 是按单页内字符长度切分：

- `CHUNK_SIZE = 1600`
- `CHUNK_OVERLAP = 240`
- chunk 不跨页。
- 每页文本为空则不生成 chunk。

优点：

- 实现简单。
- 能保留页码引用。
- 不需要额外向量数据库。

缺点：

- 不是语义段落切分。
- 不识别论文结构。
- 长公式、表格、双栏内容可能被切断。
- 不适合复杂跨页论证。

### 4.2 当前召回方式

当前召回是关键词 + 页码邻近的轻量检索：

1. 从用户问题中提取 query tokens。
2. 对每个 chunk 打分。
3. 分数由两部分组成：
   - token 命中分：命中一个 token 加 3。
   - 页码距离分：离当前页越近分越高，最高 4。
4. 取 Top 4 个 chunk。

当前伪逻辑：

```ts
score = tokenMatchScore + pageDistanceScore
```

优点：

- 不依赖 embedding。
- 离线可用。
- 速度快。
- 适合“当前页附近”的阅读问答。

缺点：

- 语义召回弱。
- 同义词、缩写、方法别名不容易召回。
- 中文问题问英文论文时，关键词匹配很弱。
- 无法做跨论文或外部知识召回。

## 5. 当前 RAG 上下文组装

当前问答 prompt 中包含这些信息：

1. 论文标题、作者、来源、发布时间。
2. 当前页码。
3. 论文摘要。
4. PDF 当前页正文。
5. PDF 附近页正文。
6. 相关正文段落。
7. 最近批注。
8. 阅读笔记。
9. 最近 6 条对话。
10. 用户问题。

实现位置：

- `AgentRuntimeService.buildReaderQaPrompt(...)`

当前正文上下文限制：

- 当前页正文最多约 4000 字符。
- 附近页正文最多约 5000 字符。
- 相关 chunk 每段最多约 1200 字符。
- prompt 总体没有做模型上下文窗口自适应。

## 6. 当前引用方式

当前 AI 回复的引用来源包括：

- `第 N 页`
- `第 N 页正文`
- `相关段落：第 N 页`
- 最近批注引用
- `论文摘要`
- `阅读笔记`

前端会尝试从引用文本中解析页码：

- 能解析页码的引用可点击跳转到对应页。

当前限制：

- 引用是“回答级引用”，不是逐句 citation。
- 没有记录具体 chunk id。
- 没有展示命中的 chunk 文本预览。

## 7. 当前模型调用方式

实现位置：

- `src/main/ai/AiModelClient.ts`

当前模型协议：

- OpenAI Compatible `/chat/completions`
- 支持普通调用。
- 支持 `stream: true` SSE 流式调用。

当前模型配置：

- 来自设置页 `aiModelConfig`
- 字段包括：
  - provider
  - baseUrl
  - apiKey
  - model

当前安全边界：

- API Key 只在主进程使用。
- Renderer 不直接调用模型接口。

## 8. 当前联网增强能力

联网能力已经接入：不是每个问题都联网，而是由阅读问答在主进程里根据问题意图按需触发。当前意图分三类：

- `none`：不联网，只使用本地 PDF RAG。
- `paper-context`：论文相关外部补充，使用 OpenAlex / GitHub。
- `general-web`：通用网页搜索，使用 DuckDuckGo HTML 搜索结果。

实现位置：

- `src/main/reader/ReaderInternetContextService.ts`
- `src/main/reader/ReaderService.ts`
- `src/main/agents/AgentRuntimeService.ts`

### 8.1 触发规则

默认不联网。问题包含以下意图时触发：

- 相关工作
- 对比 / 相比
- 背景
- 最新
- 代码 / 仓库 / 复现
- benchmark
- dataset
- GitHub / repository / implementation
- related work / compare / background / SOTA

### 8.2 联网上下文结构

```ts
interface ReaderInternetContext {
  intent: 'none' | 'paper-context' | 'general-web';
  shouldSearch: boolean;
  isAvailable: boolean;
  queries: string[];
  hits: InternetSearchHit[];
  repository: ReaderRepositoryCandidate | null;
  failureReason: string | null;
  usedAt: string;
}
```

### 8.3 当前检索源

- OpenAlex：相关论文与学术背景。
- GitHub Search：当问题涉及代码、仓库、复现时搜索候选仓库。
- DuckDuckGo HTML：当问题明显是普通互联网查询时搜索网页结果。

### 8.4 缓存策略

- 缓存目录：`cache/reader-internet-context/`
- 缓存 key：`paperId + query`
- TTL：7 天

这样同一篇论文反复问相似的相关工作或代码问题时，不会每次都重新联网。

### 8.5 Prompt 组装

联网结果会进入独立的 `联网补充资料` 区域，包括：

- 外部论文或网页标题。
- 摘要片段。
- URL。
- 来源。
- 发布时间。
- 候选 GitHub 仓库名称、语言、stars、说明、URL。

系统 prompt 明确要求：

- 必须区分论文正文内容和联网补充资料。
- 必须区分论文相关外部资料和普通网页资料。
- 不能把联网资料误写成当前论文原文结论。

### 8.6 引用方式

当前联网引用会出现在回答引用 chip 中：

- `联网：OpenAlex · paper title`
- `网页：Web · page title`
- `代码仓库：owner/repo`

## 9. 后续联网增强建议

当前联网能力还是第一版，建议后续继续增强：

1. **增加更多学术来源**
   - Semantic Scholar
   - arXiv 版本信息
   - Papers With Code
   - 数据集/benchmark 官方页面

2. **更智能的联网触发**
   - 当前是规则关键词判断。
   - 后续可以让模型先判断是否需要联网。
   - 也可以在 UI 上加“联网回答”开关。

3. **联网结果 rerank**
   - 当前 OpenAlex 和 GitHub 结果只做简单截断。
   - 后续可以按标题重叠、年份、引用量、代码仓库 star 数等重排。

4. **网页正文抓取**
   - 当前只拿 API 返回摘要。
   - 后续可以抓官方项目页、README、论文主页。

5. **逐句 citation**
   - 当前引用是回答级引用。
   - 后续可以要求模型每个关键结论后标注来源类型和页码/URL。

## 10. 混合 RAG 架构方向

后续可以把上下文分成四层：

1. Local Page Context：当前页和附近页。
2. Local Paper Retrieval：PDF 全文相关段落。
3. User Context：批注、笔记、历史对话。
4. Internet Context：外部论文、代码仓库、网页背景。

最终 prompt 明确分区：

```text
[论文正文证据]
...

[用户笔记与批注]
...

[联网补充资料]
...

[问题]
...
```

这会比把所有内容混在一起更可控。

## 11. 更长期的增强方向

PDF 索引增强：

- 按章节切分。
- 识别 Abstract / Introduction / Method / Experiments / Conclusion。
- 双栏阅读顺序修复。
- OCR 扫描版 PDF。
- 表格和公式单独提取。
- 图注识别。

RAG 增强：

- Embedding 向量召回。
- BM25 + Vector hybrid search。
- Cross-encoder rerank。
- Query rewrite。
- Multi-query retrieval。
- Context window 自适应压缩。
- 逐句 citation。

联网增强：

- OpenAlex 相关论文。
- Semantic Scholar。
- arXiv 版本信息。
- Papers With Code。
- GitHub 仓库 README 和依赖文件。
- 官方项目页。
- 数据集/benchmark 官方页面。

我建议近期不要一下子全做，下一步优先考虑“联网结果 rerank”和“更多学术来源”，比直接上复杂代理更稳。
