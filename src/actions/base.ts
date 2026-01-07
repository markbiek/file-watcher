import type { ActionConfig, ActionContext, ActionResult } from '../types.ts';

/**
 * Base class for all actions. Extend this to create new action types.
 */
export abstract class Action {
  protected config: ActionConfig;

  constructor(config: ActionConfig) {
    this.config = config;
  }

  /**
   * Execute the action and return a result.
   * Implementations should handle their own errors and return a failure result
   * rather than throwing.
   */
  abstract execute(context: ActionContext): Promise<ActionResult>;

  /**
   * Returns the action type identifier
   */
  abstract get type(): string;

  /**
   * Validate the action configuration.
   * Returns an array of error messages, or empty array if valid.
   */
  validate(): string[] {
    return [];
  }
}
