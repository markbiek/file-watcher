import chokidar, { type FSWatcher } from 'chokidar';
import type { NormalizedRule, EventType } from './types.ts';
import { EventType as EventTypes } from './types.ts';
import { processFileEvent } from './pipeline.ts';
import log from './logger.ts';

export interface WatcherOptions {
  /** Debounce delay in milliseconds */
  debounceMs: number;
  /** Whether to process existing files on startup */
  processExisting?: boolean;
}

interface PendingEvent {
  filepath: string;
  event: EventType;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * macOS metadata/system directories found on mounted volumes. Watching them
 * fails with EACCES and spams the logs, so skip them.
 */
const IGNORED_PATHS =
  /(?:^|\/)\.(?:Trashes|TemporaryItems|DocumentRevisions-V100|Spotlight-V100|fseventsd)(?:\/|$)/;

/**
 * File watcher that monitors configured paths and triggers rule pipelines
 */
export class Watcher {
  private rules: NormalizedRule[];
  private options: WatcherOptions;
  private watchers: Map<string, FSWatcher> = new Map();
  private pendingEvents: Map<string, PendingEvent> = new Map();
  private isRunning = false;

  constructor(rules: NormalizedRule[], options: WatcherOptions) {
    this.rules = rules.filter((r) => r.enabled);
    this.options = options;
  }

  /**
   * Start watching all configured paths
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Watcher is already running');
      return;
    }

    // Get unique paths to watch (flatten since each rule can have multiple paths)
    const pathsToWatch = [...new Set(this.rules.flatMap((r) => r.paths))];

    if (pathsToWatch.length === 0) {
      log.warn('No enabled rules to watch');
      return;
    }

    log.info(`Starting watcher for ${pathsToWatch.length} path(s)...`);

    for (const watchPath of pathsToWatch) {
      await this.watchPath(watchPath);
    }

    this.isRunning = true;
    log.success('Watcher started');
    log.divider();
  }

  /**
   * Stop all watchers
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping watcher...');

    // Clear pending events
    for (const pending of this.pendingEvents.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingEvents.clear();

    // Close all watchers
    const closePromises = [...this.watchers.values()].map((w) => w.close());
    await Promise.all(closePromises);
    this.watchers.clear();

    this.isRunning = false;
    log.success('Watcher stopped');
  }

  /**
   * Watch a single path
   */
  private async watchPath(watchPath: string): Promise<void> {
    return new Promise((resolve) => {
      const watcher = chokidar.watch(watchPath, {
        persistent: true,
        ignoreInitial: !this.options.processExisting,
        ignored: IGNORED_PATHS,
        followSymlinks: true,
        awaitWriteFinish: {
          stabilityThreshold: this.options.debounceMs,
          pollInterval: 100,
        },
      });

      watcher
        .on('ready', () => {
          log.info(`Watching: ${watchPath}`);
          resolve();
        })
        .on('add', (filepath) => this.handleEvent(filepath, EventTypes.Add))
        .on('change', (filepath) => this.handleEvent(filepath, EventTypes.Change))
        .on('unlink', (filepath) => this.handleEvent(filepath, EventTypes.Unlink))
        .on('error', (error) => {
          log.error(`Watcher error on ${watchPath}: ${error.message}`);
        });

      this.watchers.set(watchPath, watcher);
    });
  }

  /**
   * Handle a file event with debouncing
   */
  private handleEvent(filepath: string, event: EventType): void {
    log.fileEvent(event, filepath);

    // Key for deduplication: filepath + event type
    const key = `${filepath}:${event}`;

    // Clear any pending event for this file
    const existing = this.pendingEvents.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Schedule the event processing
    const timer = setTimeout(() => {
      this.pendingEvents.delete(key);
      this.processEvent(filepath, event);
    }, this.options.debounceMs);

    this.pendingEvents.set(key, { filepath, event, timer });
  }

  /**
   * Process a file event through the pipeline
   */
  private async processEvent(filepath: string, event: EventType): Promise<void> {
    try {
      await processFileEvent(filepath, event, this.rules);
    } catch (err) {
      log.error(`Pipeline error for ${filepath}: ${(err as Error).message}`);
    }
  }

  /**
   * Get the current status of the watcher
   */
  getStatus(): { running: boolean; watchedPaths: string[]; enabledRules: number } {
    return {
      running: this.isRunning,
      watchedPaths: [...this.watchers.keys()],
      enabledRules: this.rules.length,
    };
  }
}
