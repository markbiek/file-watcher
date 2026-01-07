/**
 * Core type definitions for file-watcher
 */

// Using const object instead of enum for native Node.js TS compatibility
export const EventType = {
  Add: 'add',
  Change: 'change',
  Unlink: 'unlink',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const FailureMode = {
  Continue: 'continue',
  Stop: 'stop',
} as const;
export type FailureMode = (typeof FailureMode)[keyof typeof FailureMode];

/**
 * Configuration for a specific action type (for future plugin support)
 */
export interface ActionConfig {
  type: string;
  [key: string]: unknown;
}

/**
 * A rule defining what to watch and how to respond
 */
export interface Rule {
  name: string;
  path: string;
  pattern: string;
  events?: EventType[];
  action: string | ActionConfig;
  onFailure?: FailureMode;
  enabled?: boolean;
}

/**
 * Normalized rule with all defaults applied
 */
export interface NormalizedRule {
  name: string;
  path: string;
  pattern: string;
  events: EventType[];
  action: string | ActionConfig;
  onFailure: FailureMode;
  enabled: boolean;
}

/**
 * Application settings
 */
export interface Settings {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  debounceMs?: number;
}

/**
 * Top-level configuration file structure
 */
export interface Config {
  rules: Rule[];
  settings?: Settings;
}

/**
 * Context passed to each action during execution
 */
export interface ActionContext {
  /** Current file path (may differ from original if previous rule moved it) */
  filepath: string;
  /** Original file path when the event was triggered */
  originalPath: string;
  /** The event type that triggered this pipeline */
  event: EventType;
  /** Results from previous actions in the pipeline */
  previousResults: ActionResult[];
  /** Parsed path components for variable substitution */
  pathComponents: PathComponents;
}

/**
 * Parsed components of a file path for variable substitution
 */
export interface PathComponents {
  /** Full absolute path */
  filepath: string;
  /** Directory containing the file */
  dir: string;
  /** Filename with extension */
  filename: string;
  /** Filename without extension */
  basename: string;
  /** Extension only (without dot) */
  ext: string;
}

/**
 * Result returned by every action execution
 */
export interface ActionResult {
  /** Whether the action completed successfully */
  success: boolean;
  /** The filepath that was operated on */
  filepath: string;
  /** New filepath if the file was moved or renamed */
  newFilepath?: string;
  /** Whether the file was deleted */
  deleted?: boolean;
  /** Error message if success is false */
  error?: string;
  /** Arbitrary metadata for chaining actions */
  metadata?: Record<string, unknown>;
}

/**
 * Creates a successful ActionResult
 */
export function successResult(
  filepath: string,
  options: Partial<Omit<ActionResult, 'success' | 'filepath'>> = {}
): ActionResult {
  return {
    success: true,
    filepath,
    ...options,
  };
}

/**
 * Creates a failed ActionResult
 */
export function failureResult(filepath: string, error: string): ActionResult {
  return {
    success: false,
    filepath,
    error,
  };
}
