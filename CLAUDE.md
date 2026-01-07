# CLAUDE.md

## Project Context

Read `PROJECT_NOTES.md` for full architecture details, design decisions, and rationale. Key points:

- **What this is**: CLI tool (`fw`) that watches folders and triggers actions on file changes
- **Stack**: Node.js v24+, native TypeScript, chokidar, commander, chalk
- **Config**: YAML format, supports globs, variable substitution in shell commands

## Quick Reference

```bash
npm install              # Install dependencies
npm run fw start         # Start watcher
npm run fw start -- -v   # Verbose mode
npm run fw list          # Show rules
npm run fw test <file>   # Test rule matching
npm run typecheck        # Run tsc --noEmit
```

## Communication Style

- Be direct and honest, never harsh
- Don't validate approaches unless they're actually sound
- If something is wrong or heading in a bad direction, say so clearly
- Wit and humor are welcome, especially for casual questions

## Coding Standards

This project uses TypeScript with WordPress-influenced JavaScript standards, adapted for modern ESM.

### Formatting

- **Indentation**: Tabs, not spaces
- **Quotes**: Single quotes for strings
- **Line length**: Aim for 100 characters, not strictly enforced
- **Braces**: Required for all blocks (if/else/for/while/try), even single-line
- **Statements**: Each on its own line
- **Whitespace**: Liberal use for readability

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables, functions | camelCase | `processFileEvent`, `configPath` |
| Classes, interfaces, types | UpperCamelCase | `ActionResult`, `ShellAction` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_DEBOUNCE_MS` |
| Const objects (enum alternatives) | UpperCamelCase | `EventType`, `FailureMode` |

### Variables

- Use `const` by default
- Use `let` only when reassignment is needed
- Never use `var`

### Equality

- Always use strict equality (`===` and `!==`)
- Never use abstract equality (`==` and `!=`)

### TypeScript Specifics

Native Node.js type stripping requires:

```typescript
// ✓ Explicit .ts extensions in imports
import { processFileEvent } from './pipeline.ts';

// ✗ Extension-less imports won't work
import { processFileEvent } from './pipeline';

// ✓ Use const objects instead of enums
export const EventType = {
  Add: 'add',
  Change: 'change',
  Unlink: 'unlink',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

// ✗ Enums are not supported
enum EventType { Add, Change, Unlink }
```

### Comments & Documentation

- JSDoc format for public functions and interfaces
- Comments precede the relevant code
- Blank line before comment blocks

```typescript
/**
 * Process a file event through all matching rules
 *
 * @param filepath - Absolute path to the changed file
 * @param event - The type of change that occurred
 * @param rules - Normalized rules to match against
 * @returns Pipeline result with execution details
 */
export async function processFileEvent(
  filepath: string,
  event: EventType,
  rules: NormalizedRule[]
): Promise<PipelineResult> {
  // ...
}
```

### Error Handling

- Wrap async operations in try/catch
- Actions should return `ActionResult` with success/failure, not throw
- Log errors with context (rule name, filepath)

```typescript
// ✓ Return failure result
if (!result.success) {
  return failureResult(filepath, `Command failed: ${stderr}`);
}

// ✗ Don't throw from action execute()
throw new Error('Command failed');
```

### File Organization

- One primary export per file where practical
- Group related types in `types.ts`
- Keep functions focused and concise
- Barrel exports in `index.ts` for directories with multiple modules

## Project Structure

```
src/
├── types.ts          # Core type definitions
├── config.ts         # Config loading/validation  
├── logger.ts         # Colored console output
├── matcher.ts        # Glob pattern matching
├── pipeline.ts       # Rule execution engine
├── watcher.ts        # Chokidar wrapper
└── actions/
    ├── base.ts       # Abstract Action class
    ├── shell.ts      # Shell command implementation
    └── index.ts      # Factory and registry
```

## Key Patterns

### Adding a New Action Type

1. Create `src/actions/myaction.ts` extending `Action`
2. Implement `execute(context): Promise<ActionResult>`
3. Register in `src/actions/index.ts`:
   ```typescript
   import { MyAction } from './myaction.ts';
   registerAction('myaction', MyAction);
   ```

### ActionResult Contract

Actions must return `ActionResult` indicating what happened:

```typescript
// Success, file unchanged
return successResult(filepath);

// Success, file was moved
return successResult(filepath, { newFilepath: '/new/path' });

// Success, file was deleted
return successResult(filepath, { deleted: true });

// Failure
return failureResult(filepath, 'Error message');
```

### Pipeline Behavior

- All matching rules execute in config order
- If a rule moves a file, subsequent rules see the new path
- If a rule deletes a file, pipeline stops with a warning
- `onFailure: stop` halts pipeline on that rule's failure
- `onFailure: continue` (default) logs and proceeds

## Testing Changes

1. Create a test config:
   ```yaml
   rules:
     - name: "Test rule"
       path: /tmp/test-watch
       pattern: "*"
       events: [add, change]
       action: "echo '{event}: {filepath}'"
   ```

2. Run with verbose logging:
   ```bash
   npm run fw start -- -c test-config.yaml -v
   ```

3. Test rule matching without execution:
   ```bash
   npm run fw test /tmp/test-watch/file.txt
   ```

## Common Tasks

| Task | Command/Location |
|------|------------------|
| Add CLI command | `bin/fw.ts` — add new `.command()` |
| Add config option | `src/types.ts` (types), `src/config.ts` (validation) |
| Change log format | `src/logger.ts` |
| Modify glob matching | `src/matcher.ts` |
| Change pipeline logic | `src/pipeline.ts` |
| Add action type | `src/actions/` — see pattern above |
