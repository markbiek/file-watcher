import chalk from 'chalk';

export const LogLevel = {
  Debug: 0,
  Info: 1,
  Warn: 2,
  Error: 3,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

const levelNames: Record<string, LogLevel> = {
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warn: LogLevel.Warn,
  error: LogLevel.Error,
};

let currentLevel: LogLevel = LogLevel.Info;

export function setLogLevel(level: string | LogLevel): void {
  if (typeof level === 'string') {
    currentLevel = levelNames[level.toLowerCase()] ?? LogLevel.Info;
  } else {
    currentLevel = level;
  }
}

function timestamp(): string {
  return chalk.gray(new Date().toISOString().substring(11, 19));
}

export const log = {
  debug: (msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LogLevel.Debug) {
      console.log(timestamp(), chalk.magenta('●'), msg, ...args);
    }
  },

  info: (msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LogLevel.Info) {
      console.log(timestamp(), chalk.blue('ℹ'), msg, ...args);
    }
  },

  success: (msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LogLevel.Info) {
      console.log(timestamp(), chalk.green('✓'), msg, ...args);
    }
  },

  warn: (msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LogLevel.Warn) {
      console.log(timestamp(), chalk.yellow('⚠'), msg, ...args);
    }
  },

  error: (msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LogLevel.Error) {
      console.log(timestamp(), chalk.red('✖'), msg, ...args);
    }
  },

  /** Log a rule execution event */
  rule: (ruleName: string, filepath: string, status: 'start' | 'success' | 'skip' | 'fail'): void => {
    if (currentLevel > LogLevel.Info) return;

    const ruleTag = chalk.cyan(`[${ruleName}]`);
    const pathStr = chalk.gray(filepath);

    switch (status) {
      case 'start':
        console.log(timestamp(), chalk.blue('▶'), ruleTag, pathStr);
        break;
      case 'success':
        console.log(timestamp(), chalk.green('✓'), ruleTag, pathStr);
        break;
      case 'skip':
        console.log(timestamp(), chalk.yellow('⊘'), ruleTag, pathStr, chalk.yellow('(skipped)'));
        break;
      case 'fail':
        console.log(timestamp(), chalk.red('✖'), ruleTag, pathStr, chalk.red('(failed)'));
        break;
    }
  },

  /** Log a file event from the watcher */
  fileEvent: (event: string, filepath: string): void => {
    if (currentLevel > LogLevel.Debug) return;

    const eventColors: Record<string, typeof chalk.green> = {
      add: chalk.green,
      change: chalk.yellow,
      unlink: chalk.red,
    };
    const colorFn = eventColors[event] ?? chalk.white;

    console.log(timestamp(), colorFn(`[${event}]`), chalk.gray(filepath));
  },

  /** Log pipeline completion */
  pipeline: (originalPath: string, rulesRun: number, success: boolean): void => {
    if (currentLevel > LogLevel.Info) return;

    if (success) {
      console.log(
        timestamp(),
        chalk.green('✓'),
        chalk.bold('Pipeline complete:'),
        chalk.gray(originalPath),
        chalk.gray(`(${rulesRun} rule${rulesRun === 1 ? '' : 's'})`)
      );
    } else {
      console.log(
        timestamp(),
        chalk.red('✖'),
        chalk.bold('Pipeline stopped:'),
        chalk.gray(originalPath),
        chalk.gray(`(after ${rulesRun} rule${rulesRun === 1 ? '' : 's'})`)
      );
    }
  },

  /** Simple divider for visual separation */
  divider: (): void => {
    if (currentLevel <= LogLevel.Info) {
      console.log(chalk.gray('─'.repeat(50)));
    }
  },
};

export default log;
