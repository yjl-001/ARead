import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type {
  ExternalMediaProtocol,
  WorkspaceConfig,
  ExternalMediaSnapshot,
  FeishuMessageInput,
} from '@shared/types';

import { ExternalMediaService } from './ExternalMediaService';

interface ExternalMediaServerOptions {
  host?: string;
  port?: number;
}

/**
 * @class ExternalMediaServer
 * @description 提供本地 HTTP 协议入口，承接飞书消息触发的论文分析任务与状态查询请求。
 * @param {ExternalMediaService} externalMediaService 外部媒体服务实例
 * @returns {ExternalMediaServer} 外部媒体 HTTP 服务实例
 */
export class ExternalMediaServer {
  private server: Server | null = null;

  private host = '127.0.0.1';

  private port = 17860;

  private readonly getWorkspaceConfig: () => WorkspaceConfig;

  public constructor(
    private readonly externalMediaService: ExternalMediaService,
    configOrOptions: (() => WorkspaceConfig) | ExternalMediaServerOptions = {},
    maybeOptions: ExternalMediaServerOptions = {},
  ) {
    const options = typeof configOrOptions === 'function' ? maybeOptions : configOrOptions;
    this.getWorkspaceConfig =
      typeof configOrOptions === 'function'
        ? configOrOptions
        : () => ({
            version: '0.1.0',
            createdAt: '',
            updatedAt: '',
            defaultTheme: 'system',
            fontSize: 14,
            defaultModel: 'langchain-runtime-placeholder',
            workspaceDirectories: {
              root: '',
              papers: '',
              metadata: '',
              notes: '',
              analyses: '',
              tasks: '',
              cache: '',
            },
            externalMediaConfig: {
              feishuTitle: '飞书论文分析入口',
              feishuEntryUrl: '',
              feishuCommandExample: '分析论文 Graph RAG Pipeline',
            },
            aiModelConfig: {
              provider: 'OpenAI Compatible',
              baseUrl: '',
              apiKey: '',
              model: 'langchain-runtime-placeholder',
            },
          });
    this.host = options.host ?? this.host;
    this.port = options.port ?? this.port;
  }

  /**
   * @function start
   * @description 启动本地 HTTP 服务，暴露飞书任务入口与状态查询接口。
   * @returns {Promise<void>} 启动结果
   */
  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer(async (request, response) => {
      try {
        await this.routeRequest(request, response);
      } catch (error) {
        this.writeJson(response, 500, {
          error: error instanceof Error ? error.message : '外部媒体服务执行失败',
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, () => {
        const address = this.server?.address();

        if (address && typeof address === 'object') {
          this.port = address.port;
        }

        resolve();
      });
    });
  }

  /**
   * @function stop
   * @description 关闭本地 HTTP 服务，便于冒烟测试或应用退出时释放端口。
   * @returns {Promise<void>} 停止结果
   */
  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  /**
   * @function getSnapshot
   * @description 返回当前协议定义以及最近的请求与回调记录。
   * @returns {Promise<ExternalMediaSnapshot>} 外部媒体协议快照
   */
  public async getSnapshot(): Promise<ExternalMediaSnapshot> {
    const state = await this.externalMediaService.getSnapshot();

    return {
      protocols: this.getProtocols(),
      recentRequests: state.recentRequests,
      recentCallbacks: state.recentCallbacks,
    };
  }

  /**
   * @function getBaseUrl
   * @description 返回当前本地 HTTP 服务根地址，供协议说明与调试使用。
   * @returns {string} 服务根地址
   */
  public getBaseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * @function routeRequest
   * @description 根据路径和方法分发外部媒体协议请求。
   * @param {IncomingMessage} request HTTP 请求对象
   * @param {ServerResponse} response HTTP 响应对象
   * @returns {Promise<void>} 处理结果
   */
  private async routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', this.getBaseUrl());

    if (method === 'GET' && url.pathname === '/external-media/protocols') {
      this.writeJson(response, 200, await this.getSnapshot());
      return;
    }

    if (method === 'GET' && url.pathname === '/external-media/status') {
      const requestId = url.searchParams.get('requestId') ?? '';
      const taskRequest = requestId ? await this.externalMediaService.getRequestById(requestId) : null;
      const callbacks = requestId ? await this.externalMediaService.listCallbacksByRequest(requestId) : [];

      this.writeJson(response, requestId && taskRequest ? 200 : 404, {
        request: taskRequest,
        callbacks,
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/external-media/feishu/message') {
      const payload = await this.readJsonBody<FeishuMessageInput>(request);
      const result = await this.externalMediaService.handleFeishuMessage(payload);

      this.writeJson(response, 200, {
        requestId: result.request.requestId,
        taskId: result.task.id,
        status: result.task.status,
        summary: result.summary,
        callbacks: result.callbacks,
      });
      return;
    }

    this.writeJson(response, 404, {
      error: '未找到对应的外部媒体协议入口',
    });
  }

  /**
   * @function getProtocols
   * @description 输出当前支持的外部媒体协议定义。
   * @returns {ExternalMediaProtocol[]} 协议定义列表
   */
  private getProtocols(): ExternalMediaProtocol[] {
    const workspaceConfig = this.getWorkspaceConfig();

    return [
      {
        channel: 'feishu',
        title: workspaceConfig.externalMediaConfig.feishuTitle,
        description: '接收飞书消息中的论文标题、关键词或链接，并触发单篇论文分析任务。',
        method: 'POST',
        path: '/external-media/feishu/message',
        entryUrl:
          workspaceConfig.externalMediaConfig.feishuEntryUrl || `${this.getBaseUrl()}/external-media/feishu/message`,
        commandExample: workspaceConfig.externalMediaConfig.feishuCommandExample,
        status: 'ready',
      },
    ];
  }

  /**
   * @function readJsonBody
   * @description 读取 HTTP 请求体并解析为 JSON 对象。
   * @param {IncomingMessage} request HTTP 请求对象
   * @returns {Promise<T>} 解析后的 JSON 数据
   */
  private async readJsonBody<T>(request: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const content = Buffer.concat(chunks).toString('utf-8').trim();

    if (!content) {
      throw new Error('请求体不能为空');
    }

    return JSON.parse(content) as T;
  }

  /**
   * @function writeJson
   * @description 使用统一 JSON 结构输出 HTTP 响应。
   * @param {ServerResponse} response HTTP 响应对象
   * @param {number} statusCode HTTP 状态码
   * @param {unknown} payload 响应载荷
   * @returns {void} 无返回值
   */
  private writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(payload, null, 2));
  }
}
