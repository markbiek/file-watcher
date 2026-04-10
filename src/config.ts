import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import {
  type Config,
  type Rule,
  type NormalizedRule,
  type Settings,
  EventType,
  FailureMode,
} from './types.ts';
import log from './logger.ts';

const DEFAULT_CONFIG_PATHS = [
  './fw.yaml',
  './fw.yml',
  './.fw.yaml',
  './.fw.yml',
  '~/.config/fw/config.yaml',
  '~/.config/fw/config.yml',
];

const DEFAULT_EVENTS: EventType[] = [EventType.Add, EventType.Change];
const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * Expand ~ to home directory
 */
export function expandPath(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return resolve(homedir(), filepath.slice(2));
  }
  return resolve(filepath);
}

/**
 * Find the config file from default locations or a specified path
 */
export function findConfigFile(specifiedPath?: string): string | null {
  if (specifiedPath) {
    const expanded = expandPath(specifiedPath);
    if (existsSync(expanded)) {
      return expanded;
    }
    return null;
  }

  for (const configPath of DEFAULT_CONFIG_PATHS) {
    const expanded = expandPath(configPath);
    if (existsSync(expanded)) {
      return expanded;
    }
  }

  return null;
}

/**
 * Validate a single rule and return errors
 */
function validateRule(rule: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `Rule ${index + 1}`;

  if (typeof rule !== 'object' || rule === null) {
    errors.push(`${prefix}: Must be an object`);
    return errors;
  }

  const r = rule as Record<string, unknown>;

  if (typeof r.name !== 'string' || r.name.trim() === '') {
    errors.push(`${prefix}: "name" is required and must be a non-empty string`);
  }

  if (r.path === undefined) {
    errors.push(`${prefix}: "path" is required`);
  } else if (typeof r.path === 'string') {
    if (r.path.trim() === '') {
      errors.push(`${prefix}: "path" must be a non-empty string`);
    }
  } else if (Array.isArray(r.path)) {
    if (r.path.length === 0) {
      errors.push(`${prefix}: "path" array must not be empty`);
    } else {
      for (let i = 0; i < r.path.length; i++) {
        const p = r.path[i];
        if (typeof p !== 'string' || p.trim() === '') {
          errors.push(`${prefix}: "path[${i}]" must be a non-empty string`);
        }
      }
    }
  } else {
    errors.push(`${prefix}: "path" must be a string or array of strings`);
  }

  if (typeof r.pattern !== 'string' || r.pattern.trim() === '') {
    errors.push(`${prefix}: "pattern" is required and must be a non-empty string`);
  }

  if (r.action === undefined) {
    errors.push(`${prefix}: "action" is required`);
  } else if (typeof r.action !== 'string' && typeof r.action !== 'object') {
    errors.push(`${prefix}: "action" must be a string or an object`);
  }

  if (r.events !== undefined) {
    if (!Array.isArray(r.events)) {
      errors.push(`${prefix}: "events" must be an array`);
    } else {
      const validEvents = Object.values(EventType);
      for (const event of r.events) {
        if (!validEvents.includes(event as EventType)) {
          errors.push(`${prefix}: Invalid event "${event}". Valid events: ${validEvents.join(', ')}`);
        }
      }
    }
  }

  if (r.onFailure !== undefined) {
    const validModes = Object.values(FailureMode);
    if (!validModes.includes(r.onFailure as FailureMode)) {
      errors.push(`${prefix}: Invalid onFailure "${r.onFailure}". Valid modes: ${validModes.join(', ')}`);
    }
  }

  if (r.enabled !== undefined && typeof r.enabled !== 'boolean') {
    errors.push(`${prefix}: "enabled" must be a boolean`);
  }

  return errors;
}

/**
 * Normalize paths to an array and expand each one
 */
function normalizePaths(path: string | string[]): string[] {
  const paths = Array.isArray(path) ? path : [path];
  // Expand and deduplicate
  const expanded = paths.map(expandPath);
  return [...new Set(expanded)];
}

/**
 * Normalize a rule by applying defaults
 */
function normalizeRule(rule: Rule): NormalizedRule {
  return {
    name: rule.name,
    paths: normalizePaths(rule.path),
    pattern: rule.pattern,
    events: rule.events ?? DEFAULT_EVENTS,
    action: rule.action,
    onFailure: rule.onFailure ?? FailureMode.Continue,
    enabled: rule.enabled ?? true,
  };
}

/**
 * Load and validate configuration from a file
 */
export function loadConfig(configPath: string): { config: Config; normalized: NormalizedRule[] } | null {
  let rawContent: string;
  try {
    rawContent = readFileSync(configPath, 'utf-8');
  } catch (err) {
    log.error(`Failed to read config file: ${configPath}`);
    log.error((err as Error).message);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(rawContent);
  } catch (err) {
    log.error(`Failed to parse YAML in config file: ${configPath}`);
    log.error((err as Error).message);
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    log.error('Config file must contain a YAML object');
    return null;
  }

  const config = parsed as Record<string, unknown>;

  // Validate rules
  if (!Array.isArray(config.rules)) {
    log.error('Config must contain a "rules" array');
    return null;
  }

  const allErrors: string[] = [];
  for (let i = 0; i < config.rules.length; i++) {
    const errors = validateRule(config.rules[i], i);
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    log.error('Configuration validation failed:');
    for (const error of allErrors) {
      log.error(`  ${error}`);
    }
    return null;
  }

  // Check for duplicate rule names
  const names = new Set<string>();
  for (const rule of config.rules as Rule[]) {
    if (names.has(rule.name)) {
      log.warn(`Duplicate rule name: "${rule.name}"`);
    }
    names.add(rule.name);
  }

  const validConfig: Config = {
    rules: config.rules as Rule[],
    settings: config.settings as Settings | undefined,
  };

  const normalized = validConfig.rules.map(normalizeRule);

  return { config: validConfig, normalized };
}

/**
 * Get settings with defaults applied
 */
export function getSettings(config: Config): Required<Settings> {
  return {
    logLevel: config.settings?.logLevel ?? 'info',
    debounceMs: config.settings?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
  };
}
