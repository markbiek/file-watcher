# File Watcher (fw)

A CLI tool for watching folders and triggering actions when files change.

## Requirements

- Node.js v24+ (uses native TypeScript support)

## Installation

```bash
npm install
```

## Quick Start

1. Create a config file:
   ```bash
   npm run fw init
   ```

2. Edit `fw.yaml` to configure your rules

3. Start watching:
   ```bash
   npm run fw start
   ```

## CLI Commands

```bash
# Start watching (foreground)
npm run fw start
npm run fw start -- -c /path/to/config.yaml  # Custom config
npm run fw start -- -v                        # Verbose mode

# List configured rules
npm run fw list

# Test which rules match a file
npm run fw test ~/Pictures/photo.jpg
npm run fw test ~/Pictures/photo.jpg -- -e change  # Simulate change event

# Validate config file
npm run fw config -- --validate

# Create sample config
npm run fw init
```

## Configuration

Config files are loaded from (in order):
- `./fw.yaml` or `./fw.yml`
- `./.fw.yaml` or `./.fw.yml`  
- `~/.config/fw/config.yaml` or `~/.config/fw/config.yml`

Or specify explicitly with `-c /path/to/config.yaml`

### Example Config

```yaml
rules:
  - name: "Process new images"
    path: ~/Pictures/incoming
    pattern: "*.{jpg,jpeg,png}"
    events: [add]
    action: "convert {filepath} -resize 800x600 {dir}/resized/{filename}"

  - name: "Backup markdown"
    path: ~/Documents
    pattern: "**/*.md"
    events: [add, change]
    action: "cp {filepath} ~/Backups/{filename}"
    onFailure: continue  # Default: keep going if this fails

  - name: "Critical step"
    path: ~/Data
    pattern: "*.csv"
    events: [add]
    action: "validate-csv {filepath}"
    onFailure: stop  # Stop pipeline if this fails

  - name: "Compress images from multiple sources"
    path:
      - ~/Pictures
      - ~/Downloads
      - /Volumes/external/photos
    pattern: "*.{jpg,jpeg}"
    events: [add]
    action: "magick {filepath} -quality 85 {filepath}"

settings:
  logLevel: info    # debug, info, warn, error
  debounceMs: 300   # Wait for writes to settle
```

### Rule Options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | - | Unique identifier for the rule |
| `path` | Yes | - | Directory or array of directories to watch (supports `~`) |
| `pattern` | Yes | - | Glob pattern to match files |
| `events` | No | `[add, change]` | Event types: `add`, `change`, `unlink` |
| `action` | Yes | - | Shell command or action config |
| `onFailure` | No | `continue` | `continue` or `stop` |
| `enabled` | No | `true` | Whether the rule is active |

### Multiple Paths

A single rule can watch multiple directories by specifying `path` as an array:

```yaml
- name: "Process images from anywhere"
  path:
    - ~/Pictures
    - ~/Downloads
    - /Volumes/external/photos
  pattern: "*.jpg"
  action: "echo 'Found {filename} in {path}'"
```

When using multiple paths, the `{path}` variable expands to whichever watched directory contained the matched file.

### Variable Substitution

Use these variables in your action commands:

| Variable | Description | Example |
|----------|-------------|---------|
| `{filepath}` | Full absolute path | `/home/user/Pictures/photo.jpg` |
| `{dir}` | Directory containing file | `/home/user/Pictures` |
| `{filename}` | Filename with extension | `photo.jpg` |
| `{basename}` | Filename without extension | `photo` |
| `{ext}` | Extension only | `jpg` |
| `{event}` | Event type | `add` |
| `{path}` | The watched path that matched | `/home/user/Pictures` |

### Glob Patterns

- `*` - Match any characters except `/`
- `**` - Match any characters including `/`
- `?` - Match single character
- `{a,b,c}` - Match any alternative
- `[abc]` - Match any character in brackets

Examples:
- `*.jpg` - All JPG files
- `*.{jpg,png,gif}` - All JPG, PNG, or GIF files
- `**/*.md` - All Markdown files in any subdirectory
- `photo?.jpg` - photo1.jpg, photoA.jpg, etc.

## Pipeline Behavior

When a file event occurs, all matching rules execute in config order:

1. If a rule **fails** and `onFailure: stop`, pipeline halts
2. If a rule **fails** and `onFailure: continue` (default), next rule runs
3. If a rule **deletes** the file, pipeline halts with a warning
4. If a rule **moves** the file, subsequent rules receive the new path

## Running as a Service

### macOS (launchd)

Create `~/Library/LaunchAgents/com.user.fw.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.fw</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>--experimental-strip-types</string>
        <string>/path/to/file-watcher/bin/fw.ts</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/fw.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/fw.error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.user.fw.plist
```

### Linux (systemd)

Create `~/.config/systemd/user/fw.service`:

```ini
[Unit]
Description=File Watcher
After=network.target

[Service]
ExecStart=/usr/bin/node --experimental-strip-types /path/to/file-watcher/bin/fw.ts start
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable fw
systemctl --user start fw
```

## Future: Plugin Actions

The architecture supports custom action types. Currently only `shell` (the default) is implemented, but the config format is forward-compatible:

```yaml
# Current: shorthand shell command
action: "cp {filepath} /backup/"

# Future: explicit action type
action:
  type: shell
  command: "cp {filepath} /backup/"

# Future: custom plugin
action:
  type: s3-upload
  bucket: my-backups
  prefix: photos/
```

## License

MIT
