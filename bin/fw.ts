#!/usr/bin/env node --experimental-strip-types

import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

import { findConfigFile, loadConfig, getSettings, expandPath } from '../src/config.ts';
import { Watcher } from '../src/watcher.ts';
import log, { setLogLevel } from '../src/logger.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

program
  .name('fw')
  .description('File watcher CLI - trigger actions when files change')
  .version(pkg.version);

// ============================================================================
// start command
// ============================================================================
program
  .command('start')
  .description('Start watching configured paths')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    // Find config file
    const configPath = findConfigFile(options.config);
    if (!configPath) {
      log.error('No config file found');
      log.info('Searched locations:');
      log.info('  ./fw.yaml, ./fw.yml, ./.fw.yaml, ./.fw.yml');
      log.info('  ~/.config/fw/config.yaml, ~/.config/fw/config.yml');
      log.info('Or specify with: fw start -c /path/to/config.yaml');
      process.exit(1);
    }

    log.info(`Using config: ${configPath}`);

    // Load and validate config
    const loaded = loadConfig(configPath);
    if (!loaded) {
      process.exit(1);
    }

    const { config, normalized } = loaded;
    const settings = getSettings(config);

    // Set log level
    if (options.verbose) {
      setLogLevel('debug');
    } else {
      setLogLevel(settings.logLevel);
    }

    // Show loaded rules
    const enabledRules = normalized.filter((r) => r.enabled);
    log.info(`Loaded ${enabledRules.length} enabled rule(s)`);
    for (const rule of enabledRules) {
      log.debug(`  - ${rule.name}: ${rule.paths.join(', ')} [${rule.pattern}]`);
    }

    // Create and start watcher
    const watcher = new Watcher(normalized, {
      debounceMs: settings.debounceMs,
      processExisting: false,
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      log.info('');
      log.info('Shutting down...');
      await watcher.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      await watcher.start();
      log.info('Press Ctrl+C to stop');
    } catch (err) {
      log.error(`Failed to start watcher: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ============================================================================
// list command
// ============================================================================
program
  .command('list')
  .description('List all configured rules')
  .option('-c, --config <path>', 'Path to config file')
  .action((options) => {
    const configPath = findConfigFile(options.config);
    if (!configPath) {
      log.error('No config file found');
      process.exit(1);
    }

    const loaded = loadConfig(configPath);
    if (!loaded) {
      process.exit(1);
    }

    const { normalized } = loaded;

    console.log(chalk.bold(`\nRules from ${configPath}:\n`));

    for (const rule of normalized) {
      const status = rule.enabled ? chalk.green('enabled') : chalk.gray('disabled');
      const failMode =
        rule.onFailure === 'stop' ? chalk.yellow(' [critical]') : '';

      console.log(`${chalk.cyan(rule.name)} ${status}${failMode}`);
      console.log(`  Path:    ${rule.paths.join(', ')}`);
      console.log(`  Pattern: ${rule.pattern}`);
      console.log(`  Events:  ${rule.events.join(', ')}`);
      console.log(`  Action:  ${typeof rule.action === 'string' ? rule.action : JSON.stringify(rule.action)}`);
      console.log('');
    }
  });

// ============================================================================
// test command
// ============================================================================
program
  .command('test')
  .description('Test which rules would match a file')
  .argument('<filepath>', 'File path to test')
  .option('-c, --config <path>', 'Path to config file')
  .option('-e, --event <type>', 'Event type to simulate', 'add')
  .action((filepath, options) => {
    const configPath = findConfigFile(options.config);
    if (!configPath) {
      log.error('No config file found');
      process.exit(1);
    }

    const loaded = loadConfig(configPath);
    if (!loaded) {
      process.exit(1);
    }

    const { normalized } = loaded;
    const resolvedPath = expandPath(filepath);
    const event = options.event as 'add' | 'change' | 'unlink';

    console.log(chalk.bold(`\nTesting: ${resolvedPath}`));
    console.log(chalk.bold(`Event:   ${event}\n`));

    // Import matcher dynamically to avoid issues with unused import
    import('../src/matcher.ts').then(({ findMatchingRules }) => {
      const matches = findMatchingRules(normalized, resolvedPath, event);

      if (matches.length === 0) {
        console.log(chalk.yellow('No rules matched'));
        return;
      }

      console.log(chalk.green(`${matches.length} rule(s) would match:\n`));

      matches.forEach((match, i) => {
        console.log(`${i + 1}. ${chalk.cyan(match.rule.name)}`);
        console.log(`   Matched path: ${match.matchedPath}`);
        console.log(`   Action: ${typeof match.rule.action === 'string' ? match.rule.action : JSON.stringify(match.rule.action)}`);
      });
    });
  });

// ============================================================================
// config command
// ============================================================================
program
  .command('config')
  .description('Show config file location or validate config')
  .option('-c, --config <path>', 'Path to config file')
  .option('--validate', 'Validate the config file')
  .action((options) => {
    const configPath = findConfigFile(options.config);

    if (!configPath) {
      log.error('No config file found');
      process.exit(1);
    }

    if (options.validate) {
      const loaded = loadConfig(configPath);
      if (loaded) {
        log.success(`Config is valid: ${configPath}`);
        log.info(`  ${loaded.normalized.length} rule(s) defined`);
        log.info(`  ${loaded.normalized.filter((r) => r.enabled).length} rule(s) enabled`);
      } else {
        process.exit(1);
      }
    } else {
      console.log(configPath);
    }
  });

// ============================================================================
// init command
// ============================================================================
program
  .command('init')
  .description('Create a sample config file')
  .option('-f, --force', 'Overwrite existing config file')
  .action((options) => {
    import('node:fs').then(({ existsSync, writeFileSync }) => {
      const targetPath = './fw.yaml';

      if (existsSync(targetPath) && !options.force) {
        log.error(`Config file already exists: ${targetPath}`);
        log.info('Use --force to overwrite');
        process.exit(1);
      }

      const sampleConfig = `# File Watcher Configuration
# Documentation: https://github.com/yourname/file-watcher

rules:
  # Example: Process new images
  - name: "Process new images"
    path: ~/Pictures/incoming
    pattern: "*.{jpg,jpeg,png}"
    events: [add]
    action: "echo 'New image: {filepath}'"
    # onFailure: stop  # Uncomment to make this rule critical

  # Example: Backup markdown files on change
  - name: "Backup markdown"
    path: ~/Documents
    pattern: "**/*.md"
    events: [add, change]
    action: "cp {filepath} ~/Backups/{filename}"

settings:
  logLevel: info    # debug, info, warn, error
  debounceMs: 300   # Wait for file writes to settle
`;

      writeFileSync(targetPath, sampleConfig);
      log.success(`Created config file: ${targetPath}`);
      log.info('Edit the file to configure your rules, then run: fw start');
    });
  });

program.parse();
