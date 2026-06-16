# File Watcher Project Context

This document summarizes the design decisions and architecture for the `file-watcher` (fw) CLI tool, intended to provide context for future development.

## Project Overview

A cross-platform CLI tool that watches folders for file changes and triggers configurable actions. Designed to run on macOS and Linux (Ubuntu/Debian).

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js v24+ | Native TypeScript support, strong async/event model |
| TypeScript | Native (--experimental-strip-types) | Zero build step, direct .ts execution |
| File watching | chokidar 3 (pinned, not 4) | Battle-tested, handles FSEvents (macOS) and inotify (Linux) seamlessly. See "Why chokidar 3, not 4" below |
| CLI framework | commander | Mature, clean API |
| Config format | YAML (js-yaml) | Human-readable, supports comments |
| Colored output | chalk | Chainable API, good ecosystem |

### Why Not Other Options

- **PHP**: No good native file-watching; not designed for long-running processes
- **Python**: Viable (watchdog library), but developer more fluent in Node.js
- **Go/Rust**: Would provide single binary distribution, but slower iteration for a personal tool
- **tsx**: Considered as fallback if native TS limitations became problematic (didn't happen)

### Why chokidar 3, not 4

The `chokidar` dependency is pinned to `^3.6.0`. Do **not** upgrade to v4 without
revisiting this.

chokidar 4 dropped the `fsevents` native binding and watches each entry via
kqueue, which holds roughly **one open file descriptor per watched file**. With
the real config (Downloads + an external volume + a large notes tree) that was
~11,500 open fds. When an action spawns a child process (`mv`, `magick`, etc.),
Node has to manage that entire fd set, and while chokidar's watcher thread churns
those descriptors `posix_spawn` intermittently references one mid-close and fails
with **`spawn EBADF`**. The failure probability scales with the fd count, so it
hit reliably in practice.

chokidar 3 uses FSEvents on macOS (one stream per root) — ~17 fds total for the
same config — which eliminates the race entirely. Its API is identical for what
`src/watcher.ts` uses (`add`/`change`/`unlink`/`ready`, `awaitWriteFinish`, and a
RegExp `ignored`), so the downgrade required no source changes.

Note: the `ignored` option behaves differently between versions (v3 runs it
through anymatch; v4 expects functions/anymatch-without-globs). The current
RegExp works in both, but a future re-upgrade attempt must recheck it.

### Native TypeScript Constraints

Using Node.js native type stripping means:
- No `enum` — use `as const` object pattern instead
- Must use explicit `.ts` extensions in imports
- No `namespace`, decorators, or tsconfig `paths` aliases

## Architecture

### Core Data Flow

```
File Event (chokidar)
    ↓
Watcher (debounce, normalize)
    ↓
Pipeline (find matching rules, execute in order)
    ↓
Action (execute command, return ActionResult)
    ↓
Pipeline (update file path if moved, stop if deleted)
    ↓
Next matching rule...
```

### Key Components

**src/types.ts** — Core type definitions
- `Rule` / `NormalizedRule`: Watch configuration
- `ActionContext`: Passed to each action with filepath, event, previous results
- `ActionResult`: Returned by actions with success/failure, new path if moved, deleted flag

**src/watcher.ts** — Chokidar wrapper
- Manages multiple watched paths
- Debounces rapid events
- Delegates to pipeline for processing

**src/pipeline.ts** — Rule execution engine
- Finds all matching rules for a file event
- Executes rules in config order
- Tracks file path changes between rules
- Handles failure modes (continue vs stop)

**src/matcher.ts** — Glob pattern matching
- Supports `*`, `**`, `?`, `{a,b,c}`, `[abc]`
- Matches against filename or relative path

**src/actions/** — Plugin-ready action system
- `base.ts`: Abstract `Action` class
- `shell.ts`: Shell command execution with variable substitution
- `index.ts`: Factory/registry for action types

**src/config.ts** — Configuration loading
- Searches default locations for config file
- Validates and normalizes rules
- Expands `~` in paths

**src/logger.ts** — Colored console output
- Log levels: debug, info, warn, error
- Specialized formatters for rules, file events, pipeline status

### Plugin Architecture

Actions are designed for extensibility:

```typescript
// Current: string shorthand (assumes shell)
action: "cp {filepath} /backup/"

// Current: explicit shell action
action:
  type: shell
  command: "cp {filepath} /backup/"

// Future: custom action types
action:
  type: s3-upload
  bucket: my-backups
```

To add a new action type:
1. Create class extending `Action` in `src/actions/`
2. Implement `execute(context)` returning `ActionResult`
3. Register with `registerAction('typename', MyAction)` in `src/actions/index.ts`

## Configuration Format

```yaml
rules:
  - name: "Rule name"           # Required, should be unique
    path: ~/Watch/folder        # Required, supports ~
    pattern: "*.{jpg,png}"      # Required, glob pattern
    events: [add, change]       # Optional, defaults to [add, change]
    action: "command {filepath}" # Required, shell command or action config
    onFailure: continue         # Optional: continue (default) | stop
    enabled: true               # Optional, defaults to true

settings:
  logLevel: info                # debug | info | warn | error
  debounceMs: 300               # Milliseconds to wait for writes to settle
```

### Variable Substitution

| Variable | Description |
|----------|-------------|
| `{filepath}` | Full absolute path |
| `{dir}` | Directory containing file |
| `{filename}` | Filename with extension |
| `{basename}` | Filename without extension |
| `{ext}` | Extension only |
| `{event}` | Event type (add, change, unlink) |

## Pipeline Behavior

Key decisions:

1. **Multiple rules can match** — All matching rules execute in config order
2. **File moves update path** — If rule A moves a file, rule B sees the new location
3. **File deletion stops pipeline** — With a warning, since this usually indicates misconfigured rule order
4. **Failure handling is per-rule** — `onFailure: stop` makes a rule critical; `onFailure: continue` (default) logs and proceeds

## CLI Commands

| Command | Description |
|---------|-------------|
| `fw start` | Start watching (foreground) |
| `fw start -v` | Verbose/debug mode |
| `fw start -c path` | Use specific config file |
| `fw list` | Show all configured rules |
| `fw test <filepath>` | Test which rules would match a file |
| `fw config --validate` | Validate config file |
| `fw init` | Create sample config file |

## What's NOT Implemented (Future Considerations)

1. **Daemon mode** — Decided to skip; use tmux/screen, or OS service (launchd/systemd). README has examples.

2. **Built-in action types** — Only `shell` exists. Could add: `copy`, `move`, `delete`, `http-webhook`, etc.

3. **Rule priority field** — Currently rules execute in config file order. Could add explicit priority.

4. **`terminal: true` flag** — For rules that intentionally end the pipeline (e.g., "move to archive").

5. **Retry logic** — Failed actions don't retry. Could add `retries` and `retryDelay` to rules.

6. **Dry-run mode** — `fw start --dry-run` to log what would happen without executing.

7. **Config file watching** — Auto-reload when config changes.

8. **Per-rule debounce** — Currently global; could make configurable per-rule.

## File Structure

```
file-watcher/
├── bin/
│   └── fw.ts                 # CLI entry point
├── src/
│   ├── types.ts              # Core type definitions
│   ├── config.ts             # Config loading/validation
│   ├── logger.ts             # Colored output
│   ├── matcher.ts            # Glob pattern matching
│   ├── pipeline.ts           # Rule execution
│   ├── watcher.ts            # Chokidar wrapper
│   └── actions/
│       ├── base.ts           # Abstract Action class
│       ├── shell.ts          # Shell command action
│       └── index.ts          # Action factory/registry
├── config.example.yaml
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Running the Project

```bash
pnpm install
cp config.example.yaml fw.yaml
# Edit fw.yaml with your rules
pnpm run fw start
```

## Testing Notes

The `fw test <filepath>` command is useful for debugging rule matching without triggering actions. Example:

```bash
pnpm run fw test ~/Pictures/photo.jpg
pnpm run fw test ~/Pictures/photo.jpg -- -e change
```

## Design Principles

1. **Minimal dependencies** — Only what's necessary (chokidar, commander, js-yaml, chalk)
2. **Plugin-ready but not over-engineered** — Shell actions cover 90% of use cases; architecture supports more
3. **Fail gracefully** — Log errors, continue processing unless explicitly told to stop
4. **Cross-platform** — No platform-specific code; chokidar handles the differences
5. **Human-readable config** — YAML with sensible defaults
