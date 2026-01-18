import { access, constants } from 'node:fs/promises';
import type { NormalizedRule, EventType, ActionContext, ActionResult } from './types.ts';
import { FailureMode } from './types.ts';
import { findMatchingRules, parsePathComponents } from './matcher.ts';
import { createAction } from './actions/index.ts';
import log from './logger.ts';

export interface PipelineResult {
  originalPath: string;
  event: EventType;
  rulesMatched: number;
  rulesExecuted: number;
  success: boolean;
  results: Array<{ rule: string; result: ActionResult }>;
  finalPath?: string;
  stoppedEarly: boolean;
  stopReason?: string;
}

/**
 * Check if a file exists at the given path
 */
async function fileExists(filepath: string): Promise<boolean> {
  try {
    await access(filepath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Process a file event through all matching rules
 */
export async function processFileEvent(
  filepath: string,
  event: EventType,
  rules: NormalizedRule[]
): Promise<PipelineResult> {
  const matchingRules = findMatchingRules(rules, filepath, event);

  const pipelineResult: PipelineResult = {
    originalPath: filepath,
    event,
    rulesMatched: matchingRules.length,
    rulesExecuted: 0,
    success: true,
    results: [],
    stoppedEarly: false,
  };

  if (matchingRules.length === 0) {
    log.debug(`No rules matched: ${filepath}`);
    return pipelineResult;
  }

  log.info(`Processing ${filepath} (${matchingRules.length} rule${matchingRules.length === 1 ? '' : 's'} matched)`);

  let currentPath = filepath;
  const context: ActionContext = {
    filepath: currentPath,
    originalPath: filepath,
    event,
    previousResults: [],
    pathComponents: parsePathComponents(currentPath),
    matchedPath: '', // Will be set per-rule
  };

  for (const match of matchingRules) {
    const { rule, matchedPath } = match;

    // Update context for this iteration
    context.filepath = currentPath;
    context.pathComponents = parsePathComponents(currentPath);
    context.matchedPath = matchedPath;

    log.rule(rule.name, currentPath, 'start');

    // Create the action
    let action;
    try {
      action = createAction(rule.action);
    } catch (err) {
      const errorMsg = (err as Error).message;
      log.error(`Failed to create action for rule "${rule.name}": ${errorMsg}`);
      pipelineResult.results.push({
        rule: rule.name,
        result: { success: false, filepath: currentPath, error: errorMsg },
      });

      if (rule.onFailure === FailureMode.Stop) {
        pipelineResult.success = false;
        pipelineResult.stoppedEarly = true;
        pipelineResult.stopReason = `Action creation failed for critical rule "${rule.name}"`;
        break;
      }
      continue;
    }

    // Execute the action
    let result: ActionResult;
    try {
      result = await action.execute(context);
    } catch (err) {
      const errorMsg = (err as Error).message;
      log.error(`Rule "${rule.name}" threw unexpected error: ${errorMsg}`);
      result = { success: false, filepath: currentPath, error: errorMsg };
    }

    pipelineResult.results.push({ rule: rule.name, result });
    pipelineResult.rulesExecuted++;
    context.previousResults.push(result);

    // Handle failure
    if (!result.success) {
      log.rule(rule.name, currentPath, 'fail');
      log.error(`Rule "${rule.name}" failed: ${result.error}`);

      if (rule.onFailure === FailureMode.Stop) {
        pipelineResult.success = false;
        pipelineResult.stoppedEarly = true;
        pipelineResult.stopReason = `Critical rule "${rule.name}" failed: ${result.error}`;
        log.error(`Pipeline stopped: rule "${rule.name}" is marked as critical`);
        break;
      }

      // Continue to next rule
      continue;
    }

    log.rule(rule.name, currentPath, 'success');

    // Handle file deletion
    if (result.deleted) {
      const remainingRules = matchingRules.length - matchingRules.indexOf(match) - 1;
      if (remainingRules > 0) {
        log.warn(
          `Rule "${rule.name}" deleted the file, but ${remainingRules} more ` +
            `rule${remainingRules === 1 ? ' was' : 's were'} pending. Check your rule order.`
        );
      }
      pipelineResult.stoppedEarly = true;
      pipelineResult.stopReason = `File deleted by rule "${rule.name}"`;
      break;
    }

    // Handle file move/rename
    if (result.newFilepath && result.newFilepath !== currentPath) {
      log.info(`File moved: ${currentPath} → ${result.newFilepath}`);
      currentPath = result.newFilepath;
    }
  }

  pipelineResult.finalPath = currentPath;

  if (pipelineResult.stoppedEarly) {
    log.pipeline(filepath, pipelineResult.rulesExecuted, pipelineResult.success);
  } else {
    log.pipeline(filepath, pipelineResult.rulesExecuted, true);
  }

  return pipelineResult;
}
