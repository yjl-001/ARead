import type { AiModelConfig } from '@shared/types';

export type AiChatRole = 'system' | 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiChatResult {
  content: string;
  model: string;
}

interface OpenAiCompatibleChatResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{
        type?: string;
        text?: string;
      }> | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

type OpenAiCompatibleMessageContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>
  | null
  | undefined;

interface OpenAiCompatibleStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

interface AiModelClientOptions {
  fetchImpl?: typeof fetch;
}

const DEFAULT_CHAT_COMPLETIONS_PATH = '/chat/completions';

/**
 * @class AiModelClient
 * @description 使用设置页中的 OpenAI Compatible 配置发起主进程模型调用。
 */
export class AiModelClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(
    private readonly config: AiModelConfig,
    options: AiModelClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public isConfigured(): boolean {
    return Boolean(
      this.config.baseUrl.trim()
      && this.config.apiKey.trim()
      && this.config.model.trim()
      && this.config.model !== 'langchain-runtime-placeholder',
    );
  }

  public async chat(request: AiChatRequest): Promise<AiChatResult> {
    if (!this.isConfigured()) {
      throw new Error('AI 模型尚未配置，请先在设置页填写接口地址、模型名和 API Key');
    }

    const response = await this.fetchImpl(this.resolveChatCompletionsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model.trim(),
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 900,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as OpenAiCompatibleChatResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `AI 模型调用失败：${response.status}`);
    }

    const content = this.extractChatContent(payload.choices?.[0]?.message?.content);

    if (!content) {
      throw new Error(this.buildEmptyResponseError(payload));
    }

    return {
      content,
      model: this.config.model.trim(),
    };
  }

  public async chatStream(request: AiChatRequest, onDelta?: (delta: string) => void): Promise<AiChatResult> {
    if (!this.isConfigured()) {
      throw new Error('AI 模型尚未配置，请先在设置页填写接口地址、模型名和 API Key');
    }

    const response = await this.fetchImpl(this.resolveChatCompletionsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model.trim(),
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 900,
        stream: true,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as OpenAiCompatibleChatResponse;
      throw new Error(payload.error?.message ?? `AI 模型调用失败：${response.status}`);
    }

    if (!response.body) {
      return this.chat(request);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/g);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const delta = this.parseStreamLine(line);

        if (!delta) {
          continue;
        }

        content += delta;
        onDelta?.(delta);
      }
    }

    if (buffer.trim()) {
      const delta = this.parseStreamLine(buffer);

      if (delta) {
        content += delta;
        onDelta?.(delta);
      }
    }

    if (!content.trim()) {
      throw new Error(`AI 模型流式返回内容为空（model=${this.config.model.trim()}）。`);
    }

    return {
      content: content.trim(),
      model: this.config.model.trim(),
    };
  }

  private parseStreamLine(line: string): string {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith('data:')) {
      return '';
    }

    const data = trimmedLine.slice(5).trim();

    if (!data || data === '[DONE]') {
      return '';
    }

    try {
      const payload = JSON.parse(data) as OpenAiCompatibleStreamChunk;
      return payload.choices?.[0]?.delta?.content ?? '';
    } catch {
      return '';
    }
  }

  /**
   * @function extractChatContent
   * @description 从 OpenAI Compatible 响应中提取文本内容，并兼容数组型 content。
   * @param {OpenAiCompatibleMessageContent} content 原始 content 字段
   * @returns {string} 归一化后的文本内容
   */
  private extractChatContent(content: OpenAiCompatibleMessageContent): string {
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((item: { type?: string; text?: string }) => (typeof item.text === 'string' ? item.text : ''))
        .join('')
        .trim();
    }

    return '';
  }

  /**
   * @function buildEmptyResponseError
   * @description 在模型返回空内容时拼接可诊断信息，便于定位兼容层或模型格式问题。
   * @param {OpenAiCompatibleChatResponse} payload 模型响应载荷
   * @returns {string} 可读的错误信息
   */
  private buildEmptyResponseError(payload: OpenAiCompatibleChatResponse): string {
    const firstChoice = payload.choices?.[0];
    const finishReason = firstChoice?.finish_reason ?? 'unknown';
    const rawContent = firstChoice?.message?.content;
    const contentKind = Array.isArray(rawContent) ? 'array' : typeof rawContent;
    const contentPreview = typeof rawContent === 'string'
      ? rawContent.slice(0, 80)
      : Array.isArray(rawContent)
        ? JSON.stringify(rawContent).slice(0, 120)
        : String(rawContent);

    return [
      `AI 模型返回内容为空（model=${this.config.model.trim()}）`,
      `finish_reason=${finishReason}`,
      `content_type=${contentKind}`,
      `content_preview=${contentPreview || 'empty'}`,
    ].join('；');
  }

  private resolveChatCompletionsUrl(): string {
    const baseUrl = this.config.baseUrl.trim().replace(/\/+$/g, '');

    if (baseUrl.endsWith(DEFAULT_CHAT_COMPLETIONS_PATH)) {
      return baseUrl;
    }

    return `${baseUrl}${DEFAULT_CHAT_COMPLETIONS_PATH}`;
  }
}
