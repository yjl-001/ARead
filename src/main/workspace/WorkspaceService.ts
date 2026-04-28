import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  BootstrapPayload,
  PaperRecord,
  ReadingRecord,
  WorkspaceConfig,
  WorkspaceConfigInput,
  WorkspaceDirectories,
} from '@shared/types';

interface WorkspaceFiles {
  configFile: string;
}

interface WorkspaceDataFiles {
  papersFile: string;
  readingFile: string;
  tasksFile: string;
}

const DEFAULT_WORKSPACE_FONT_SIZE = 14;

const MIN_WORKSPACE_FONT_SIZE = 12;

const MAX_WORKSPACE_FONT_SIZE = 18;

/**
 * @class WorkspaceService
 * @description 管理本地工作区目录、配置文件与基础数据模型初始化。
 * @param {string} rootPath 工作区根目录路径
 * @returns {WorkspaceService} 工作区服务实例
 */
export class WorkspaceService {
  private readonly defaultDirectories: WorkspaceDirectories;

  private readonly files: WorkspaceFiles;

  private currentDirectories: WorkspaceDirectories;

  private currentConfig: WorkspaceConfig | null = null;

  public constructor(rootPath: string) {
    this.defaultDirectories = {
      root: rootPath,
      papers: path.join(rootPath, 'papers'),
      metadata: path.join(rootPath, 'metadata'),
      notes: path.join(rootPath, 'notes'),
      analyses: path.join(rootPath, 'analyses'),
      tasks: path.join(rootPath, 'tasks'),
      cache: path.join(rootPath, 'cache'),
    };
    this.currentDirectories = this.defaultDirectories;

    this.files = {
      configFile: path.join(rootPath, 'config.json'),
    };
  }

  /**
   * @function ensureWorkspace
   * @description 初始化本地工作区目录、配置和基础数据文件。
   * @returns {Promise<BootstrapPayload['workspace']>} 工作区摘要信息
   */
  public async ensureWorkspace(): Promise<BootstrapPayload['workspace']> {
    const config = await this.ensureConfig();
    this.applyDirectories(config.workspaceDirectories);
    await this.ensureDirectories(this.currentDirectories);

    const workspaceFiles = this.getWorkspaceFiles(this.currentDirectories);
    const papers = await this.ensureCollection<PaperRecord>(workspaceFiles.papersFile, []);
    const reading = await this.ensureCollection<ReadingRecord>(workspaceFiles.readingFile, []);
    const tasks = await this.ensureCollection(workspaceFiles.tasksFile, []);

    return {
      directories: this.currentDirectories,
      config,
      paperCount: papers.length,
      readingCount: reading.length,
      taskCount: tasks.length,
    };
  }

  /**
   * @function getDirectories
   * @description 返回当前工作区目录映射。
   * @returns {WorkspaceDirectories} 工作区目录集合
   */
  public getDirectories(): WorkspaceDirectories {
    return this.currentDirectories;
  }

  public getConfig(): WorkspaceConfig {
    return this.currentConfig ?? this.buildDefaultConfig();
  }

  /**
   * @function saveConfig
   * @description 保存用户在设置页修改的工作区偏好配置。
   * @param {WorkspaceConfigInput} input 允许用户调整的工作区偏好
   * @returns {Promise<WorkspaceConfig>} 最新配置对象
   */
  public async saveConfig(input: WorkspaceConfigInput): Promise<WorkspaceConfig> {
    const currentConfig = await this.ensureConfig();
    const nextConfig: WorkspaceConfig = {
      ...currentConfig,
      defaultTheme: input.defaultTheme,
      fontSize: this.normalizeFontSize(input.fontSize),
      defaultModel: input.defaultModel.trim() || currentConfig.defaultModel,
      workspaceDirectories: this.normalizeDirectories(input.workspaceDirectories, currentConfig.workspaceDirectories),
      externalMediaConfig: {
        feishuTitle: input.externalMediaConfig.feishuTitle.trim() || currentConfig.externalMediaConfig.feishuTitle,
        feishuEntryUrl: input.externalMediaConfig.feishuEntryUrl.trim() || currentConfig.externalMediaConfig.feishuEntryUrl,
        feishuCommandExample:
          input.externalMediaConfig.feishuCommandExample.trim() || currentConfig.externalMediaConfig.feishuCommandExample,
      },
      aiModelConfig: {
        provider: input.aiModelConfig.provider.trim() || currentConfig.aiModelConfig.provider,
        baseUrl: input.aiModelConfig.baseUrl.trim(),
        apiKey: input.aiModelConfig.apiKey.trim(),
        model: input.aiModelConfig.model.trim() || currentConfig.aiModelConfig.model,
      },
      updatedAt: new Date().toISOString(),
    };

    await writeFile(this.files.configFile, JSON.stringify(nextConfig, null, 2), 'utf-8');
    this.currentConfig = nextConfig;
    this.applyDirectories(nextConfig.workspaceDirectories);
    await this.ensureDirectories(this.currentDirectories);

    const workspaceFiles = this.getWorkspaceFiles(this.currentDirectories);
    await this.ensureCollection<PaperRecord>(workspaceFiles.papersFile, []);
    await this.ensureCollection<ReadingRecord>(workspaceFiles.readingFile, []);
    await this.ensureCollection(workspaceFiles.tasksFile, []);

    return nextConfig;
  }

  /**
   * @function ensureDirectories
   * @description 确保工作区需要的所有目录已存在。
   * @returns {Promise<void>} 目录创建结果
   */
  private async ensureDirectories(directories: WorkspaceDirectories): Promise<void> {
    const directoryList = Object.values(directories);

    // 关键逻辑：逐个创建工作区目录，保证首次启动具备完整本地存储结构。
    await Promise.all(directoryList.map(async (directory) => mkdir(directory, { recursive: true })));
  }

  /**
   * @function ensureConfig
   * @description 确保工作区配置文件存在，并在缺失时写入默认配置。
   * @returns {Promise<WorkspaceConfig>} 工作区配置对象
   */
  private async ensureConfig(): Promise<WorkspaceConfig> {
    const config = await this.ensureJsonFile(this.files.configFile, this.buildDefaultConfig());
    const mergedConfig: WorkspaceConfig = {
      ...this.buildDefaultConfig(),
      ...config,
      workspaceDirectories: this.normalizeDirectories(
        config.workspaceDirectories ?? this.defaultDirectories,
        this.defaultDirectories,
      ),
      externalMediaConfig: {
        ...this.buildDefaultConfig().externalMediaConfig,
        ...config.externalMediaConfig,
      },
      aiModelConfig: {
        ...this.buildDefaultConfig().aiModelConfig,
        ...config.aiModelConfig,
      },
      fontSize: this.normalizeFontSize(config.fontSize),
    };

    this.currentConfig = mergedConfig;
    return mergedConfig;
  }

  private buildDefaultConfig(): WorkspaceConfig {
    const now = new Date().toISOString();

    return {
      version: '0.1.0',
      createdAt: now,
      updatedAt: now,
      defaultTheme: 'system',
      fontSize: DEFAULT_WORKSPACE_FONT_SIZE,
      defaultModel: 'langchain-runtime-placeholder',
      workspaceDirectories: this.defaultDirectories,
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
    };
  }

  /**
   * @function normalizeFontSize
   * @description 约束界面字体大小到预设区间，兼容旧配置缺失该字段的场景。
   * @param {number | undefined} value 用户输入或历史配置中的字体大小
   * @returns {number} 可安全写入配置并用于界面缩放的字体大小
   */
  private normalizeFontSize(value: number | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return DEFAULT_WORKSPACE_FONT_SIZE;
    }

    // 关键逻辑：统一在主进程兜底裁剪，避免旧配置或异常输入破坏渲染层字号比例。
    return Math.min(Math.max(Math.round(value), MIN_WORKSPACE_FONT_SIZE), MAX_WORKSPACE_FONT_SIZE);
  }

  private applyDirectories(directories: WorkspaceDirectories): void {
    this.currentDirectories = this.normalizeDirectories(directories, this.defaultDirectories);
  }

  private normalizeDirectories(input: WorkspaceDirectories, fallback: WorkspaceDirectories): WorkspaceDirectories {
    return {
      root: input.root.trim() || fallback.root,
      papers: input.papers.trim() || fallback.papers,
      metadata: input.metadata.trim() || fallback.metadata,
      notes: input.notes.trim() || fallback.notes,
      analyses: input.analyses.trim() || fallback.analyses,
      tasks: input.tasks.trim() || fallback.tasks,
      cache: input.cache.trim() || fallback.cache,
    };
  }

  private getWorkspaceFiles(directories: WorkspaceDirectories): WorkspaceDataFiles {
    return {
      papersFile: path.join(directories.metadata, 'papers.json'),
      readingFile: path.join(directories.metadata, 'reading.json'),
      tasksFile: path.join(directories.tasks, 'agent-tasks.json'),
    };
  }

  /**
   * @function ensureCollection
   * @description 确保集合型 JSON 文件存在并返回其内容。
   * @param {string} filePath JSON 文件路径
   * @param {T[]} fallback 缺失时写入的默认数组
   * @returns {Promise<T[]>} 集合数据
   */
  private async ensureCollection<T>(filePath: string, fallback: T[]): Promise<T[]> {
    return this.ensureJsonFile(filePath, fallback);
  }

  /**
   * @function ensureJsonFile
   * @description 读取 JSON 文件，文件不存在时自动写入默认值。
   * @param {string} filePath JSON 文件路径
   * @param {T} fallback 默认数据
   * @returns {Promise<T>} 文件内容
   */
  private async ensureJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      // 关键逻辑：首次启动时落盘默认 JSON，后续所有模块都基于该约定读取数据。
      await writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf-8');
      return fallback;
    }
  }
}
