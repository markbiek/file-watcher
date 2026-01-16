import { basename, dirname, extname, resolve } from 'node:path';
import type { NormalizedRule, EventType, PathComponents } from './types.ts';

/**
 * Simple glob pattern matching
 *
 * Supports:
 *   - * matches any characters except /
 *   - ** matches any characters including /
 *   - ? matches single character
 *   - {a,b,c} matches any of the alternatives
 *   - [abc] matches any character in brackets
 */
export function matchGlob(pattern: string, filepath: string): boolean {
  // Handle brace expansion first {jpg,png,gif}
  const expandedPatterns = expandBraces(pattern);

  return expandedPatterns.some((p) => {
    const regex = globToRegex(p);
    return regex.test(filepath);
  });
}

/**
 * Expand brace patterns like {a,b,c} into multiple patterns
 */
function expandBraces(pattern: string): string[] {
  const braceMatch = pattern.match(/\{([^}]+)\}/);
  if (!braceMatch) {
    return [pattern];
  }

  const [fullMatch, alternatives] = braceMatch;
  const parts = alternatives.split(',');
  const results: string[] = [];

  for (const part of parts) {
    const expanded = pattern.replace(fullMatch, part);
    // Recursively expand any remaining braces
    results.push(...expandBraces(expanded));
  }

  return results;
}

/**
 * Convert a glob pattern to a regular expression
 */
function globToRegex(pattern: string): RegExp {
  let regex = pattern
    // Escape special regex chars (including * and ? which we'll convert to glob patterns)
    .replace(/[.+^${}()|[\]\\*?]/g, '\\$&')
    // ** matches anything including /
    .replace(/\\\*\\\*/g, '.*')
    // * matches anything except /
    .replace(/\\\*/g, '[^/]*')
    // ? matches single char except /
    .replace(/\\\?/g, '[^/]');

  // Anchor to end (pattern should match the filename or path suffix)
  return new RegExp(`${regex}$`, 'i');
}

/**
 * Check if a rule matches a file event
 */
export function ruleMatches(rule: NormalizedRule, filepath: string, event: EventType): boolean {
  // Check if rule is enabled
  if (!rule.enabled) {
    return false;
  }

  // Check if event type matches
  if (!rule.events.includes(event)) {
    return false;
  }

  // Check if file is within the watched path
  const normalizedPath = resolve(filepath);
  const normalizedRulePath = resolve(rule.path);

  if (!normalizedPath.startsWith(normalizedRulePath)) {
    return false;
  }

  // Get the relative path from the watched directory
  const relativePath = normalizedPath.slice(normalizedRulePath.length + 1);

  // Check if filename matches the pattern
  const filename = basename(filepath);

  // Pattern could match filename only or relative path (for **)
  return matchGlob(rule.pattern, filename) || matchGlob(rule.pattern, relativePath);
}

/**
 * Find all rules that match a file event
 */
export function findMatchingRules(
  rules: NormalizedRule[],
  filepath: string,
  event: EventType
): NormalizedRule[] {
  return rules.filter((rule) => ruleMatches(rule, filepath, event));
}

/**
 * Parse a filepath into its components for variable substitution
 */
export function parsePathComponents(filepath: string): PathComponents {
  const resolved = resolve(filepath);
  const dir = dirname(resolved);
  const filename = basename(resolved);
  const ext = extname(filename).slice(1); // Remove leading dot
  const base = basename(filename, extname(filename));

  return {
    filepath: resolved,
    dir,
    filename,
    basename: base,
    ext,
  };
}
