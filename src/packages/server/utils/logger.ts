/**
 * NestJS-style colorized logger for Tide Commander
 * Includes caller file and line number
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

const levelConfig: Record<LogLevel, { label: string; color: string }> = {
  log: { label: 'LOG', color: colors.green },
  error: { label: 'ERROR', color: colors.red },
  warn: { label: 'WARN', color: colors.yellow },
  debug: { label: 'DEBUG', color: colors.magenta },
  verbose: { label: 'VERBOSE', color: colors.cyan },
};

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

interface CallerInfo {
  file: string;
  line: number;
  column: number;
}

function getCallerInfo(): CallerInfo | null {
  const err = new Error();
  const stack = err.stack?.split('\n');

  if (!stack || stack.length < 5) return null;

  // Stack trace format: "    at functionName (file:line:column)"
  // We need to skip: Error, formatMessage, log/error/warn method, and get the actual caller
  // Index 0: "Error"
  // Index 1: getCallerInfo
  // Index 2: formatMessage
  // Index 3: log/error/warn
  // Index 4: actual caller
  const callerLine = stack[4];

  if (!callerLine) return null;

  // Match patterns like:
  // "    at functionName (/path/to/file.ts:123:45)"
  // "    at /path/to/file.ts:123:45"
  const match = callerLine.match(/at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?$/);

  if (!match) return null;

  let filePath = match[1];

  // Clean up the path - show only the relevant part
  // Remove everything before src/packages/server
  const serverIndex = filePath.indexOf('src/packages/server');
  if (serverIndex !== -1) {
    filePath = filePath.slice(serverIndex + 'src/packages/server/'.length);
  } else {
    // Fallback: just show filename
    filePath = filePath.split('/').pop() || filePath;
  }

  return {
    file: filePath,
    line: parseInt(match[2], 10),
    column: parseInt(match[3], 10),
  };
}

function formatMessage(level: LogLevel, context: string, message: string, ...args: unknown[]): string {
  const { label, color } = levelConfig[level];
  const timestamp = formatTimestamp();
  const pid = process.pid;
  const caller = getCallerInfo();

  const appName = `${colors.green}[Tide]${colors.reset}`;
  const pidStr = `${colors.dim}${pid}${colors.reset}`;
  const timestampStr = `${colors.dim}${timestamp}${colors.reset}`;
  const levelStr = `${color}${colors.bright}${label.padStart(7)}${colors.reset}`;
  const contextStr = `${colors.yellow}[${context}]${colors.reset}`;

  // Format caller info
  const callerStr = caller
    ? `${colors.dim}${caller.file}:${caller.line}${colors.reset}`
    : '';

  let formattedMessage = message;
  if (args.length > 0) {
    const argsStr = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    formattedMessage = `${message} ${colors.cyan}${argsStr}${colors.reset}`;
  }

  return `${appName} ${pidStr}  - ${timestampStr}  ${levelStr} ${contextStr} ${callerStr} ${formattedMessage}`;
}

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  log(message: string, ...args: unknown[]): void {
    console.log(formatMessage('log', this.context, message, ...args));
  }

  error(message: string, ...args: unknown[]): void {
    console.error(formatMessage('error', this.context, message, ...args));
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(formatMessage('warn', this.context, message, ...args));
  }

  debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG) {
      console.debug(formatMessage('debug', this.context, message, ...args));
    }
  }

  verbose(message: string, ...args: unknown[]): void {
    if (process.env.VERBOSE) {
      console.log(formatMessage('verbose', this.context, message, ...args));
    }
  }
}

// Factory function to create loggers
export function createLogger(context: string): Logger {
  return new Logger(context);
}

// Pre-configured loggers for common contexts
export const logger = {
  server: createLogger('Server'),
  http: createLogger('HTTP'),
  ws: createLogger('WebSocket'),
  claude: createLogger('Claude'),
  agent: createLogger('Agent'),
  files: createLogger('Files'),
  supervisor: createLogger('Supervisor'),
};

export { Logger };
