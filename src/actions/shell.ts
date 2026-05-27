import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';
import { Action } from './base.ts';
import type { ActionConfig, ActionContext, ActionResult, PathComponents } from '../types.ts';
import { successResult, failureResult } from '../types.ts';
import log from '../logger.ts';

const execAsync = promisify(exec);

export interface ShellActionConfig extends ActionConfig {
  type: 'shell';
  command: string;
  /** Working directory for the command (defaults to file's directory) */
  cwd?: string;
  /** Timeout in milliseconds (defaults to 30000) */
  timeout?: number;
}

/**
 * Action that executes a shell command with variable substitution
 */
export class ShellAction extends Action {
  private command: string;
  private cwd?: string;
  private timeout: number;

  constructor(config: ShellActionConfig | string) {
    // Handle shorthand string syntax
    const normalized: ShellActionConfig =
      typeof config === 'string'
        ? { type: 'shell', command: config }
        : config;

    super(normalized);
    this.command = normalized.command;
    this.cwd = normalized.cwd;
    this.timeout = normalized.timeout ?? 30000;
  }

  get type(): string {
    return 'shell';
  }

  validate(): string[] {
    const errors: string[] = [];
    if (!this.command || this.command.trim() === '') {
      errors.push('Shell action requires a non-empty "command"');
    }
    return errors;
  }

  /**
   * Interpolate variables in the command string
   */
  private interpolate(
    command: string,
    components: PathComponents,
    event: string,
    matchedPath: string
  ): string {
    return command
      .replace(/\{filepath\}/g, components.filepath)
      .replace(/\{dir\}/g, components.dir)
      .replace(/\{filename\}/g, components.filename)
      .replace(/\{basename\}/g, components.basename)
      .replace(/\{ext\}/g, components.ext)
      .replace(/\{event\}/g, event)
      .replace(/\{path\}/g, matchedPath);
  }

  /**
   * Detect if the command might move or delete the file
   */
  private detectFileOperation(command: string, filepath: string): { mightMove: boolean; mightDelete: boolean } {
    const normalizedCmd = command.toLowerCase();
    const escapedPath = filepath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pathRegex = new RegExp(escapedPath, 'i');

    // Check for move/rename commands
    const mightMove =
      (normalizedCmd.includes('mv ') && pathRegex.test(command)) ||
      (normalizedCmd.includes('move ') && pathRegex.test(command)) ||
      (normalizedCmd.includes('rename ') && pathRegex.test(command));

    // Check for delete commands
    const mightDelete =
      (normalizedCmd.includes('rm ') && pathRegex.test(command)) ||
      (normalizedCmd.includes('del ') && pathRegex.test(command)) ||
      (normalizedCmd.includes('unlink ') && pathRegex.test(command));

    return { mightMove, mightDelete };
  }

  /**
   * Try to extract the destination path from a mv command.
   *
   * Returns null when the destination can't be resolved statically — most
   * importantly when it contains shell expansions like $(...), backticks, or
   * $VAR, since we only see the command text and can't know what the shell
   * produced at runtime.
   */
  private extractMoveDestination(command: string): string | null {
    // Simple heuristic: look for "mv source dest" pattern
    const mvMatch = command.match(/\bmv\s+(?:-[a-z]+\s+)*["']?([^"'\s]+)["']?\s+["']?([^"'\s]+)["']?/i);
    const destination = mvMatch?.[2];
    if (!destination) {
      return null;
    }

    // Shell metacharacters mean the path we parsed isn't the real destination
    if (/[$`*?]/.test(destination)) {
      return null;
    }

    return destination;
  }

  async execute(context: ActionContext): Promise<ActionResult> {
    const { filepath, pathComponents, event, matchedPath } = context;
    const interpolatedCommand = this.interpolate(this.command, pathComponents, event, matchedPath);

    log.debug(`Executing: ${interpolatedCommand}`);

    const { mightMove, mightDelete } = this.detectFileOperation(interpolatedCommand, filepath);

    try {
      const { stdout, stderr } = await execAsync(interpolatedCommand, {
        cwd: this.cwd ?? pathComponents.dir,
        timeout: this.timeout,
      });

      if (stderr) {
        log.debug(`Command stderr: ${stderr}`);
      }
      if (stdout) {
        log.debug(`Command stdout: ${stdout}`);
      }

      // Check if file was deleted
      if (mightDelete) {
        try {
          await access(filepath, constants.F_OK);
        } catch {
          // File no longer exists
          return successResult(filepath, { deleted: true });
        }
      }

      // Check if file was moved
      if (mightMove) {
        try {
          await access(filepath, constants.F_OK);
          // File still exists at original location - wasn't moved
        } catch {
          // File no longer at original location - try to find new location
          const destination = this.extractMoveDestination(interpolatedCommand);
          if (destination) {
            try {
              await access(destination, constants.F_OK);
              return successResult(filepath, { newFilepath: destination });
            } catch {
              // Couldn't verify destination, but file is gone from source
              log.warn(`File moved but couldn't verify destination: ${destination}`);
              return successResult(filepath, { newFilepath: destination });
            }
          }
          // File left the source but we can't determine where it went (e.g.
          // a dynamic shell destination). Stop tracking it through the pipeline.
          log.info(`File moved out of ${filepath} (destination not statically determinable)`);
          return successResult(filepath, { deleted: true });
        }
      }

      return successResult(filepath, {
        metadata: { stdout, stderr },
      });
    } catch (err) {
      const error = err as Error & { code?: string; killed?: boolean };

      if (error.killed) {
        return failureResult(filepath, `Command timed out after ${this.timeout}ms`);
      }

      return failureResult(filepath, error.message);
    }
  }
}
