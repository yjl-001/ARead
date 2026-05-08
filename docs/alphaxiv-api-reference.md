# alphaXiv API 参考文档

> 调研日期：2026-05-08
> 已集成：`/overview/en`（作为 AI 助手上下文）

## 基础信息

- **API 域名**：`https://api.alphaxiv.org`
- **认证方式**：Clerk（读操作大多无需认证）
- **CORS**：`Access-Control-Allow-Origin: https://alphaxiv.org`
- **请求头**：需带 `Origin: https://alphaxiv.org` 和 `Referer: https://alphaxiv.org/`

## 论文相关 API

### 获取论文 AI 概述（已集成）

```
GET /papers/v3/{uuid}/overview/en
```

无需认证。返回论文的结构化 AI 分析。

**响应结构**：
```json
{
  "title": "论文标题",
  "abstract": "摘要原文",
  "summary": {
    "summary": "一句话概述",
    "originalProblem": ["研究问题 1", "研究问题 2", "..."],
    "solution": ["解决方案 1", "..."],
    "keyInsights": ["关键洞察 1", "..."],
    "results": ["实验结果 1", "..."]
  },
  "overview": "Markdown 格式的详细概述",
  "citations": [...]
}
```

**集成位置**：`src/main/reader/AlphaXivContextService.ts`
- 作为 AI 阅读助手的补充上下文
- 仅对 arXiv 来源论文生效
- 8 秒超时，失败静默降级

---

### 论文信息查询（通过 arXiv ID）

```
GET /papers/v3/legacy/{arxivId}
```

无需认证。通过 arXiv ID 查询论文元数据和评论。

**示例**：`GET /papers/v3/legacy/1706.03762`

**响应结构**：
```json
{
  "paper": {
    "paper_version": {
      "id": "0189b531-a930-7613-9d2e-dd918c8435a5",
      "title": "...",
      "abstract": "...",
      "publication_date": "...",
      "version_label": "v7",
      "version_order": 7
    },
    "paper_group": {
      "id": "015c9ef4-ac30-768d-928b-847320902575",
      "universal_paper_id": "1706.03762",
      "title": "..."
    },
    "authors": [...],
    "verified_authors": [...],
    "pdf_info": { "fetcher_url": "..." },
    "implementation": null,
    "organization_info": [...]
  },
  "comments": [...]
}
```

**用途**：
- arXiv ID → alphaXiv UUID 映射（已在 `AlphaXivContextService` 中使用）
- 获取论文的社区讨论（评论质量参差不齐，未集成）

---

### 获取评论

```
GET /papers/v3/legacy/{paperGroupId}/comments
```

无需认证。获取论文的全部评论树。

**评论结构**：
```json
{
  "id": "uuid",
  "title": "评论标题",
  "body": "Markdown 格式的评论正文",
  "date": "2023-08-21T05:54:33.073Z",
  "upvotes": 31,
  "isAuthor": false,
  "tag": "general | question | endorsement",
  "author": {
    "realName": "...",
    "username": "...",
    "avatar": "...",
    "institution": "..."
  },
  "responses": [
    {
      "id": "...",
      "body": "...",
      "author": {...},
      "date": "...",
      "upvotes": 5
    }
  ],
  "annotation": null,
  "paperVersionId": "..."
}
```

**注意**：评论质量一般，当前未集成。

---

### AI 生成内容检测

```
GET /papers/v3/{uuid}/ai-detection
```

无需认证。返回论文的 AI 生成内容检测结果。

```json
{
  "state": "done",
  "fractionAi": 0,
  "fractionAiAssisted": 0,
  "fractionHuman": 1,
  "predictionShort": "Human",
  "headline": "Fully Human Written",
  "windows": [
    { "text": "段落文本...", ... }
  ]
}
```

**注意**：学术上敏感，实用价值低，未集成。

---

### 模型链接

```
GET /papers/v3/{uuid}/model-links
POST /papers/v3/{uuid}/model-links
```

无需认证。识别论文中引用的 AI 模型。

```json
{
  "state": "done",
  "matches": [
    {
      "matchedText": "BERT",
      "pageIndex": 3,
      "model": {
        "modelId": "google/bert-base",
        "providerName": "Google",
        "modelName": "BERT",
        "description": "...",
        "releaseDate": 1540000000000
      }
    }
  ]
}
```

**注意**：匹配有噪音（普通词汇可能误匹配为模型名），未集成。

---

### 论文预览

```
GET /papers/v3/{arxivId}/preview
```

无需认证。返回论文的简短预览卡片。

---

### 阅读计数

```
POST /papers/v3/{uuid}/view
```

无需认证。记录一次论文阅读。对本地阅读器无用。

---

## 讨论/评论 API（需认证）

| 操作 | 端点 | 方法 |
|---|---|---|
| 发表评论 | `/papers/v3/{version}/comment` | POST |
| 编辑评论 | `/comments/v1/{commentId}` | PATCH |
| 删除评论 | `/comments/v2/{commentId}` | DELETE |

---

## AI 助手 API（需认证）

| 端点 | 说明 |
|---|---|
| `GET /assistant/v2?variant=paper&paperVersion={uuid}` | 论文 AI 对话 |
| `GET /assistant/v2/messages` | 对话消息 |
| `GET /assistant/v2/url-metadata?url=...` | URL 元数据提取 |
| `GET /assistant/v2/usage` | 使用量统计 |

---

## 用户相关 API（需认证）

| 端点 | 说明 |
|---|---|
| `/users/v3/profile` | 用户资料 |
| `/users/v3/by-username` | 按用户名查找 |
| `/users/v3/leaderboard` | 用户排行榜 |
| `/users/v3/preferences` | 偏好设置 |
| `/users/v3/viewed-history` | 浏览历史 |
| `/users/v3/search` | 用户搜索 |

---

## 基础设施

| 服务 | 域名 | 说明 |
|---|---|---|
| PDF 获取器 | `fetcher.alphaxiv.org/v2/pdf/{arxivId}` | 302 重定向到 CDN |
| PDF CDN | `papers-pdfs.assets.alphaxiv.org/` | PDF 文件存储 |
| 论文资产 | `paper-assets.alphaxiv.org/` | 图片等静态资源 |
| 论文渲染 | `paper-renders.alphaxiv.org/` | 论文渲染缓存 |
| 论文播客 | `paper-podcasts.alphaxiv.org/` | AI 生成的论文播客 |

---

## 当前项目集成状态

| 功能 | 状态 | 文件 |
|---|---|---|
| 论文 AI 概述 → AI 助手上下文 | **已集成** | `src/main/reader/AlphaXivContextService.ts` |
| arXiv ID → UUID 映射 | **已集成** | 同上（内部使用） |
| 论文评论 | 未集成（质量一般） | - |
| 模型链接 | 未集成 | - |
| AI 检测 | 未集成（不推荐） | - |
