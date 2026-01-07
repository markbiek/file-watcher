import type { ActionConfig } from '../types.ts';
import { Action } from './base.ts';
import { ShellAction } from './shell.ts';

type ActionConstructor = new (config: ActionConfig | string) => Action;

/**
 * Registry of available action types
 */
const actionRegistry = new Map<string, ActionConstructor>();

/**
 * Register an action type. Used for plugin support.
 */
export function registerAction(type: string, constructor: ActionConstructor): void {
  actionRegistry.set(type, constructor);
}

/**
 * Create an action instance from a configuration
 *
 * Handles both shorthand string syntax (shell command) and
 * explicit object syntax with type field.
 */
export function createAction(config: string | ActionConfig): Action {
  // Shorthand string syntax: treat as shell command
  if (typeof config === 'string') {
    return new ShellAction(config);
  }

  // Object syntax: look up by type
  const actionType = config.type ?? 'shell';
  const Constructor = actionRegistry.get(actionType);

  if (!Constructor) {
    throw new Error(`Unknown action type: "${actionType}". Available types: ${[...actionRegistry.keys()].join(', ')}`);
  }

  return new Constructor(config);
}

/**
 * Get list of registered action types
 */
export function getRegisteredActionTypes(): string[] {
  return [...actionRegistry.keys()];
}

// Register built-in actions
registerAction('shell', ShellAction);
