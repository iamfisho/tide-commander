/**
 * Claude Code CLI Backend
 * Handles argument building and event parsing for Claude Code CLI
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type {
  CLIBackend,
  BackendConfig,
  StandardEvent,
  ClaudeRawEvent,
} from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Backend');

/**
 * Sanitize a string by removing invalid Unicode surrogate pairs.
 * This fixes "no low surrogate in string" JSON errors that occur when
 * strings contain unpaired high surrogates (0xD800-0xDBFF without matching 0xDC00-0xDFFF).
 * Also handles JSON-escaped surrogates like \ud83d that lack their low surrogate pair.
 */
function sanitizeUnicode(str: string): string {
  // First, handle JSON-escaped surrogates (e.g., \ud83d without \udc00-\udfff following)
  // High surrogate: \uD800-\uDBFF -> \u[dD][89aAbB][0-9a-fA-F]{2}
  // Low surrogate: \uDC00-\uDFFF -> \u[dD][cCdDeEfF][0-9a-fA-F]{2}
  const highPattern = /\\u[dD][89aAbB][0-9a-fA-F]{2}/g;
  const lowPattern = /\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/;

  // Replace unpaired JSON-escaped surrogates
  let sanitized = str.replace(highPattern, (match, offset) => {
    // Check if followed by a low surrogate escape
    const afterMatch = str.slice(offset + match.length);
    if (lowPattern.test(afterMatch.slice(0, 6))) {
      return match; // Valid pair, keep it
    }
    return '\\ufffd'; // Replace unpaired high surrogate
  });

  // Also replace orphan low surrogates (not preceded by high)
  sanitized = sanitized.replace(/\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g, (match, offset) => {
    // Check if preceded by a high surrogate
    const beforeMatch = sanitized.slice(Math.max(0, offset - 6), offset);
    if (/\\u[dD][89aAbB][0-9a-fA-F]{2}$/.test(beforeMatch)) {
      return match; // Valid pair, keep it
    }
    return '\\ufffd'; // Replace orphan low surrogate
  });

  // Then handle raw Unicode surrogates at character level
  let result = '';
  for (let i = 0; i < sanitized.length; i++) {
    const code = sanitized.charCodeAt(i);

    // Check if this is a high surrogate (0xD800-0xDBFF)
    if (code >= 0xD800 && code <= 0xDBFF) {
      // Check if next char is a valid low surrogate
      const nextCode = sanitized.charCodeAt(i + 1);
      if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
        // Valid surrogate pair - keep both
        result += sanitized[i] + sanitized[i + 1];
        i++; // Skip the low surrogate since we already added it
      } else {
        // Unpaired high surrogate - replace with replacement char
        result += '\uFFFD';
      }
    }
    // Check if this is a low surrogate without preceding high surrogate
    else if (code >= 0xDC00 && code <= 0xDFFF) {
      // Unpaired low surrogate - replace with replacement char
      result += '\uFFFD';
    }
    else {
      // Normal character
      result += sanitized[i];
    }
  }
  return result;
}

export class ClaudeBackend implements CLIBackend {
  readonly name = 'claude';

  /**
   * Build CLI arguments for Claude Code
   */
  buildArgs(config: BackendConfig): string[] {
    const args: string[] = [];

    // Core output format for streaming JSON
    args.push('--print');
    args.push('--verbose');
    args.push('--output-format', 'stream-json');
    args.push('--input-format', 'stream-json');

    // Resume existing session if available
    if (config.sessionId) {
      args.push('--resume', config.sessionId);
    }

    // Permission mode - bypass for autonomous agents, interactive uses acceptEdits mode
    if (config.permissionMode === 'bypass') {
      args.push('--dangerously-skip-permissions');
    } else if (config.permissionMode === 'interactive') {
      // For interactive mode, use 'acceptEdits' which:
      // - Auto-accepts file edits/writes within the project directory
      // - Denies operations outside the project directory
      // - Provides a balance between usability and safety
      // Permission denials are reported in the result event's permission_denials array
      args.push('--permission-mode', 'acceptEdits');
    }

    // Model selection
    if (config.model) {
      args.push('--model', config.model);
    }

    // Chrome browser mode
    if (config.useChrome) {
      args.push('--chrome');
    }

    // System prompt for boss agents or custom context
    // Use --append-system-prompt when resuming (--system-prompt is ignored on resume)
    // Use --system-prompt for new sessions
    if (config.systemPrompt) {
      if (config.sessionId) {
        // Resuming - append to existing system prompt
        args.push('--append-system-prompt', config.systemPrompt);
      } else {
        // New session - set the system prompt
        args.push('--system-prompt', config.systemPrompt);
      }
    }

    // Disable tools (for boss team questions - forces direct response)
    // Use '""' with escaped quotes since we spawn with shell: true
    if (config.disableTools) {
      args.push('--tools', '""');
    }

    return args;
  }

  /**
   * Parse Claude CLI raw event into normalized StandardEvent
   */
  parseEvent(rawEvent: unknown): StandardEvent | null {
    const event = rawEvent as ClaudeRawEvent;

    switch (event.type) {
      case 'system':
        return this.parseSystemEvent(event);

      case 'assistant':
        return this.parseAssistantEvent(event);

      case 'tool_use':
        return this.parseToolUseEvent(event);

      case 'result':
        return this.parseResultEvent(event);

      case 'stream_event':
        return this.parseStreamEvent(event);

      default:
        return null;
    }
  }

  private parseSystemEvent(event: ClaudeRawEvent): StandardEvent | null {
    if (event.subtype === 'init') {
      console.log(`[Backend] parseSystemEvent init: tools=${JSON.stringify(event.tools)}, agents=${JSON.stringify((event as any).agents)}`);
      return {
        type: 'init',
        sessionId: event.session_id,
        model: event.model,
        tools: event.tools,
      };
    }
    if (event.subtype === 'error' && event.error) {
      return {
        type: 'error',
        errorMessage: event.error,
      };
    }
    return null;
  }

  private parseAssistantEvent(event: ClaudeRawEvent): StandardEvent | null {
    if (!event.message?.content) return null;

    // Process content blocks - return first meaningful one
    for (const block of event.message.content) {
      if (block.type === 'thinking' && block.text) {
        return {
          type: 'thinking',
          text: block.text,
        };
      } else if (block.type === 'text' && block.text) {
        return {
          type: 'text',
          text: block.text,
        };
      } else if (block.type === 'tool_use' && block.name) {
        return {
          type: 'tool_start',
          toolName: block.name,
          toolInput: block.input,
        };
      }
    }
    return null;
  }

  private parseToolUseEvent(event: ClaudeRawEvent): StandardEvent | null {
    const toolName = event.tool_name || 'unknown';

    if (event.subtype === 'input' && event.input) {
      return {
        type: 'tool_start',
        toolName,
        toolInput: event.input,
      };
    } else if (event.subtype === 'result') {
      const output =
        typeof event.result === 'string'
          ? event.result
          : JSON.stringify(event.result);
      return {
        type: 'tool_result',
        toolName,
        toolOutput: output,
      };
    }
    return null;
  }

  private parseResultEvent(event: ClaudeRawEvent): StandardEvent {
    log.log(`parseResultEvent: usage=${JSON.stringify(event.usage)}, cost=${event.total_cost_usd}`);
    // Extract result text if available (used for boss delegation parsing)
    const resultText = typeof event.result === 'string' ? event.result : undefined;

    // Extract permission denials if any
    const permissionDenials = event.permission_denials?.map(denial => ({
      toolName: denial.tool_name,
      toolUseId: denial.tool_use_id,
      toolInput: denial.tool_input,
    }));

    if (permissionDenials && permissionDenials.length > 0) {
      log.log(`parseResultEvent: ${permissionDenials.length} permission denial(s)`);
    }

    return {
      type: 'step_complete',
      durationMs: event.duration_ms,
      cost: event.total_cost_usd,
      tokens: event.usage
        ? {
            input: event.usage.input_tokens,
            output: event.usage.output_tokens,
            cacheCreation: event.usage.cache_creation_input_tokens,
            cacheRead: event.usage.cache_read_input_tokens,
          }
        : undefined,
      resultText,
      permissionDenials,
    };
  }

  private parseStreamEvent(event: ClaudeRawEvent): StandardEvent | null {
    const streamEvent = event.event;
    if (!streamEvent) return null;

    if (streamEvent.type === 'content_block_delta') {
      if (streamEvent.delta?.type === 'text_delta' && streamEvent.delta.text) {
        return {
          type: 'text',
          text: streamEvent.delta.text,
          isStreaming: true,
        };
      } else if (
        streamEvent.delta?.type === 'thinking_delta' &&
        streamEvent.delta.text
      ) {
        return {
          type: 'thinking',
          text: streamEvent.delta.text,
          isStreaming: true,
        };
      }
    } else if (streamEvent.type === 'content_block_start') {
      const blockType = streamEvent.content_block?.type;
      if (blockType === 'text' || blockType === 'thinking') {
        return {
          type: 'block_start',
          blockType: blockType,
        };
      }
    } else if (streamEvent.type === 'content_block_stop') {
      return {
        type: 'block_end',
      };
    }
    return null;
  }

  /**
   * Extract session ID from raw event
   */
  extractSessionId(rawEvent: unknown): string | null {
    const event = rawEvent as ClaudeRawEvent;
    if (event.type === 'system' && event.subtype === 'init') {
      return event.session_id || null;
    }
    return null;
  }

  /**
   * Get Claude Code executable path
   */
  getExecutablePath(): string {
    const detected = this.detectInstallation();
    return detected || 'claude';
  }

  /**
   * Detect Claude Code CLI installation locations
   */
  detectInstallation(): string | null {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';

    const possiblePaths = isWindows
      ? [
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(
            homeDir,
            'AppData',
            'Local',
            'Programs',
            'claude',
            'claude.exe'
          ),
          path.join(homeDir, '.bun', 'bin', 'claude.exe'),
        ]
      : [
          path.join(homeDir, '.local', 'bin', 'claude'),
          path.join(homeDir, '.bun', 'bin', 'claude'),
          '/usr/local/bin/claude',
          '/usr/bin/claude',
        ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Claude requires stdin input for prompts
   */
  requiresStdinInput(): boolean {
    return true;
  }

  /**
   * Format prompt as stdin input for Claude CLI (stream-json format)
   */
  formatStdinInput(prompt: string): string {
    // Sanitize prompt to remove invalid Unicode surrogates that break JSON
    const sanitizedPrompt = sanitizeUnicode(prompt);
    return JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: sanitizedPrompt,
      },
    });
  }
}
