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

    // Permission mode - bypass for autonomous agents
    if (config.permissionMode === 'bypass') {
      args.push('--dangerously-skip-permissions');
    }

    // Model selection
    if (config.model) {
      args.push('--model', config.model);
    }

    // Chrome browser mode
    if (config.useChrome) {
      args.push('--chrome');
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
    console.log(`[ClaudeBackend] parseResultEvent: usage=${JSON.stringify(event.usage)}, cost=${event.total_cost_usd}`);
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
    return JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: prompt,
      },
    });
  }
}
