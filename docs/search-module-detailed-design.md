# 搜索模块详细设计

## 1. 设计目标

搜索模块承担“跨站点检索论文并返回统一结果”的职责。此次重构的目标不是单纯把代码拆文件，而是把搜索逻辑从“单文件堆叠实现”升级为“可持续扩展的模块化架构”，以满足后续这些演进场景：

- 增加新的搜索来源
- 为不同来源配置不同鉴权方式
- 支持 HTML 抓取型站点与结构化 API 型站点共存
- 在 `all` 模式下统一调度多个来源
- 把前端搜索界面与应用总壳层解耦

当前已接入来源：

- arXiv
- OpenAlex
- CVF Open Access

## 2. 重构后的目录结构

```text
src/
  main/
    papers/
      PaperService.ts
      search/
        PaperSearchService.ts
        types.ts
        providers/
          ArxivSearchProvider.ts
          OpenAlexSearchProvider.ts
          CvfOpenAccessSearchProvider.ts
  renderer/
    src/
      SearchPage.tsx
      paperSources.ts
```

各文件职责如下：

- `PaperService.ts`
  - 论文导入、存储、元数据维护
  - 搜索只作为委托入口，不再处理具体站点细节
- `search/PaperSearchService.ts`
  - 聚合搜索总入口
  - Provider 注册、调度、上下文构造、结果排序
- `search/types.ts`
  - Provider 接口、鉴权模型、搜索上下文抽象
- `search/providers/*.ts`
  - 每个站点各自的搜索实现
- `SearchPage.tsx`
  - 前端搜索页的表单、结果渲染、导入交互
- `paperSources.ts`
  - 来源文案统一映射

## 3. 核心架构

### 3.1 总体分层

搜索模块分成三层：

1. **页面层**
   - 由 `SearchPage.tsx` 负责
   - 负责用户输入、按钮状态、结果列表、错误提示

2. **应用服务层**
   - 由 `PaperSearchService.ts` 负责
   - 负责来源调度、聚合策略、上下文装配、结果排序

3. **站点适配层**
   - 由 `providers/*.ts` 负责
   - 负责具体站点的请求、解析、字段映射

这种设计把“搜索业务流程”和“单站点实现细节”明确切开，新增站点时只需要增加新的 Provider，而不需要在全局服务里持续堆积 if/else。

### 3.2 Provider 模型

所有来源都实现统一接口：

```ts
export interface SearchProvider {
  source: PaperSourceKey;
  label: string;
  search(input: SearchProviderSearchInput, context: SearchProviderContext): Promise<PaperSearchResult[]>;
}
```

这意味着每个来源都必须回答同样的问题：

- 这个来源的唯一 key 是什么
- 这个来源的展示名称是什么
- 给定 query 和 limit，如何返回统一的 `PaperSearchResult[]`

统一接口带来的收益：

- 上层可以不关心来源内部细节
- `all` 模式可以直接遍历 Provider 集合并行搜索
- 新来源注册方式标准化

## 4. 搜索流程

### 4.1 单来源搜索

流程如下：

1. 前端通过 `window.desktopApi.searchPapers(...)` 发起搜索
2. IPC 转发给主进程的 `PaperService.search`
3. `PaperService` 把请求委托给 `PaperSearchService.search`
4. `PaperSearchService` 根据 `source` 找到目标 Provider
5. Provider 发请求并解析结果
6. 返回统一的 `PaperSearchResult[]`

### 4.2 all 聚合搜索

当 `source === 'all'` 时：

1. `PaperSearchService` 取出所有已注册 Provider
2. 并行执行每个 Provider 的 `search`
3. 用 `Promise.allSettled` 收集成功和失败结果
4. 如果至少有一个来源成功，则合并成功结果继续返回
5. 如果所有来源都失败，则把错误信息拼接后抛出

这种策略的优势在于：

- 某个来源临时 429 或站点波动，不会拖垮整个搜索
- 聚合模式下容错性更高
- 错误收口统一，前端拿到的是面向用户的中文错误信息

## 5. 鉴权与扩展点设计

### 5.1 SearchProviderCredentials

当前在 `types.ts` 中抽象了：

- `cookie`
- `token`
- `headers`

这三类配置已经覆盖绝大多数外部站点接入需求。比如：

- 需要登录态的站点：注入 `cookie`
- 需要 Bearer Token 的站点：注入 `token`
- 需要 Referer / User-Agent / 特殊 Header 的站点：注入 `headers`

### 5.2 SearchProviderContext

Provider 不直接自己拼接所有请求头，而是通过：

```ts
createRequestInit(init?: RequestInit): RequestInit
```

由 `PaperSearchService` 统一完成请求配置合并。

这样设计的价值在于：

- Provider 保持轻量，只关注站点本身的请求与解析
- 鉴权逻辑集中收口，便于后续统一演进
- 后续加入重试、限流、代理、签名等策略时，不需要挨个修改 Provider

### 5.3 后续可继续演进的方向

如果后续某个来源需要更复杂能力，建议优先在 `PaperSearchService.createContext` 继续扩展，而不是让每个 Provider 各写一套：

- 动态 Referer
- Session 刷新
- CSRF Token
- 请求重试
- 指数退避
- 代理与超时控制
- 来源级缓存

## 6. 各 Provider 设计说明

### 6.1 ArxivSearchProvider

特点：

- 使用官方 Atom API
- 数据源稳定
- 返回 XML，需要解析 `<entry>`

实现要点：

- 请求地址：`https://export.arxiv.org/api/query`
- 按 `all:${query}` 进行搜索
- 从 `<id>`、`<title>`、`<summary>`、`<author>` 中抽字段
- 优先读取显式的 PDF 链接，若缺失则通过 abs 链接推导 PDF

适合继续扩展的点：

- 429 自动重试
- User-Agent 配置化
- 分类过滤与更细粒度排序

### 6.2 OpenAlexSearchProvider

特点：

- 使用结构化 JSON API
- 支持开放获取过滤
- 可恢复结构化摘要

实现要点：

- 请求地址：`https://api.openalex.org/works`
- 使用 `is_oa:true,has_fulltext:true` 过滤开放获取全文
- 从 `best_oa_location` / `primary_location` 中提取 PDF 和落地页
- 将 `abstract_inverted_index` 恢复成普通摘要文本

适合继续扩展的点：

- 增加领域过滤
- 增加机构、作者等高级检索维度
- 保留更多元数据用于排序和标签推荐

### 6.3 CvfOpenAccessSearchProvider

特点：

- 没有稳定 JSON API，属于 HTML 抓取型来源
- 适合验证“非结构化站点也能接入同一框架”

实现要点：

- 请求地址：`https://openaccess.thecvf.com/search`
- 从搜索结果 HTML 中提取详情页链接和作者字段
- 根据 URL 规则推导 PDF 地址
- 从会议名与年份中推导 `publishedAt`

适合继续扩展的点：

- 增强摘要提取
- 区分 CVPR / ICCV / ECCV / WACV 的来源标签
- 加入 HTML 结构变动时的兼容处理

## 7. 前端搜索页设计

### 7.1 SearchPage 的职责

`SearchPage.tsx` 被单独拆出来后，职责明确为：

- 管理 query/source/results/searching/error 等本地状态
- 展示搜索表单
- 渲染结果卡片
- 处理导入按钮的局部 loading
- 复用已有论文库状态，标记结果是否已入库

### 7.2 为什么要从 App.tsx 拆出

拆分前的问题：

- `App.tsx` 同时承载壳层、路由、论文库、搜索页、设置页等逻辑
- 搜索页交互细节过多，持续修改会不断推高主文件复杂度

拆分后的好处：

- 搜索页可以独立演化
- 结果卡片、搜索表单后续还能继续拆子组件
- `App.tsx` 回归“页面路由与全局容器”定位

## 8. 来源文案统一设计

`paperSources.ts` 是一个很小但很重要的抽象层。

它解决的问题是：

- 后端历史数据可能残留旧的 `sourceLabel`
- 前端不同页面不应该到处手写 `openalex -> OpenAlex`

因此统一通过 `getPaperSourceLabel(...)` 完成映射，保证：

- 搜索结果页
- 论文库卡片
- 阅读器详情面板

都能显示同一套来源名称。

## 9. 与 PaperService 的关系

重构后：

- `PaperService` 继续保留“论文导入、存储、更新、删除”职责
- 搜索职责被下沉到 `PaperSearchService`

这符合“单一职责”原则：

- `PaperService` 关注本地论文库生命周期
- `PaperSearchService` 关注远程检索与聚合

这意味着以后就算搜索来源变成 10 个，也不会让 `PaperService` 越来越臃肿。

## 10. 当前局限与后续建议

当前版本已经具备扩展基础，但仍有进一步演进空间：

### 10.1 限流处理

例如 arXiv 已经出现过 429。建议后续补充：

- 自动重试
- 指数退避
- 来源级降级提示

### 10.2 请求缓存

建议对“相同 query + source”增加短时缓存，减少重复请求。

### 10.3 Provider 配置外置

当前 credentials 仍以构造参数注入为主，后续可以考虑：

- 工作区配置文件
- 环境变量
- 设置页可编辑配置

### 10.4 更细粒度的前端拆分

SearchPage 后续还可以拆成：

- SearchForm
- SearchResultList
- SearchResultCard
- SearchMetricsPanel

这样能进一步提升可维护性。

## 11. 新增来源的标准接入步骤

以后新增一个站点时，建议按以下步骤接入：

1. 在 `src/main/papers/search/providers/` 下新增 `XXXSearchProvider.ts`
2. 实现 `SearchProvider` 接口
3. 将站点原始结果映射成 `PaperSearchResult`
4. 在 `PaperSearchService` 中注册 Provider
5. 在共享类型中补充 `PaperSourceKey`
6. 在前端筛选项中增加来源选项
7. 在 `paperSources.ts` 中补充来源文案
8. 在 smoke 或集成测试中补 mock

按照这个流程接入，基本不需要动现有来源的实现。

## 12. 总结

这次重构的核心价值不是“把搜索代码拆散”，而是建立了一个明确的演进边界：

- 页面层只负责交互和展示
- 服务层只负责调度和聚合
- Provider 层只负责站点适配

这套设计已经能够支持：

- 多来源扩展
- 异构站点接入
- 鉴权扩展
- 聚合搜索容错

后续继续增强限流、缓存、鉴权与配置管理时，都可以在当前结构上平滑推进，而不需要再次大规模推倒重来。
