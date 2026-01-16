/**
 * Claude Code Process Runner
 * Spawns and manages Claude Code CLI processes with streaming output
 */

import { spawn, ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type {
  CLIBackend,
  RunnerRequest,
  RunnerCallbacks,
  ActiveProcess,
  StandardEvent,
} from './types.js';
import { ClaudeBackend } from './backend.js';

export class ClaudeRunner {
  private backend: CLIBackend;
  private activeProcesses: Map<string, ActiveProcess> = new Map();
  private callbacks: RunnerCallbacks;

  constructor(callbacks: RunnerCallbacks) {
    this.backend = new ClaudeBackend();
    this.callbacks = callbacks;
  }

  /**
   * Run a prompt for an agent
   */
  async run(request: RunnerRequest): Promise<void> {
    const { agentId, prompt, workingDir, sessionId, model, useChrome } = request;

    // Kill existing process for this agent if any
    await this.stop(agentId);

    // Build CLI arguments
    const args = this.backend.buildArgs({
      sessionId,
      model,
      workingDir,
      permissionMode: 'bypass',
      useChrome,
    });

    // Get executable path
    const executable = this.backend.getExecutablePath();

    console.log(`[ClaudeRunner] Starting: ${executable} ${args.join(' ')}`);
    console.log(`[ClaudeRunner] Working dir: ${workingDir}`);

    // Spawn process with its own process group (detached: true)
    // This allows us to kill the entire process tree when stopping
    const childProcess = spawn(executable, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
      shell: true,
      detached: true,
    });

    // Track the active process
    const activeProcess: ActiveProcess = {
      agentId,
      sessionId,
      startTime: Date.now(),
      process: childProcess,
    };
    this.activeProcesses.set(agentId, activeProcess);

    // Handle stdout (stream-json events)
    this.handleStdout(agentId, childProcess);

    // Handle stderr
    this.handleStderr(agentId, childProcess);

    // Handle process exit
    childProcess.on('close', (code, signal) => {
      console.log(`[ClaudeRunner] Process exited for ${agentId} with code=${code} signal=${signal}`);
      this.activeProcesses.delete(agentId);
      this.callbacks.onComplete(agentId, code === 0);
    });

    childProcess.on('error', (err) => {
      console.error(`[ClaudeRunner] Process spawn error for ${agentId}:`, err);
      this.activeProcesses.delete(agentId);
      this.callbacks.onError(agentId, err.message);
    });

    // Log process start
    childProcess.on('spawn', () => {
      console.log(`[ClaudeRunner] Process spawned for ${agentId} (pid: ${childProcess.pid})`);
    });

    // Send the prompt via stdin (keep stdin open for additional messages)
    if (this.backend.requiresStdinInput()) {
      const stdinInput = this.backend.formatStdinInput(prompt);
      console.log(`[ClaudeRunner] Sending stdin: ${stdinInput.substring(0, 100)}...`);
      childProcess.stdin?.write(stdinInput + '\n');
      // Don't close stdin - allow sending additional messages
    }
  }

  /**
   * Send an additional message to a running agent process
   * Returns true if message was sent, false if no running process
   */
  sendMessage(agentId: string, message: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess || !activeProcess.process.stdin?.writable) {
      console.log(`[ClaudeRunner] No writable stdin for agent ${agentId}`);
      return false;
    }

    const stdinInput = this.backend.formatStdinInput(message);
    console.log(`[ClaudeRunner] Sending additional message to ${agentId}: ${stdinInput.substring(0, 100)}...`);
    activeProcess.process.stdin.write(stdinInput + '\n');
    return true;
  }

  /**
   * Handle stdout streaming with UTF-8 safe parsing
   */
  private handleStdout(agentId: string, process: ChildProcess): void {
    const decoder = new StringDecoder('utf8');
    let buffer = '';

    process.stdout?.on('data', (data: Buffer) => {
      // Decode with UTF-8 safety for multi-byte characters
      buffer += decoder.write(data);

      // Split by newlines
      const lines = buffer.split('\n');
      // Keep incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processLine(agentId, line);
      }
    });

    // Handle remaining buffer on end
    process.stdout?.on('end', () => {
      const remaining = buffer + decoder.end();
      if (remaining.trim()) {
        this.processLine(agentId, remaining);
      }
    });
  }

  /**
   * Process a single JSON line from stdout
   */
  private processLine(agentId: string, line: string): void {
    try {
      const rawEvent = JSON.parse(line);

      // Log result events for debugging context tracking
      if (rawEvent.type === 'result') {
        console.log(`[ClaudeRunner] Got result event for ${agentId}:`, JSON.stringify(rawEvent).substring(0, 500));
      }

      // Extract session ID if present
      const sessionId = this.backend.extractSessionId(rawEvent);
      if (sessionId) {
        const activeProcess = this.activeProcesses.get(agentId);
        if (activeProcess) {
          activeProcess.sessionId = sessionId;
        }
        this.callbacks.onSessionId(agentId, sessionId);
      }

      // Parse to normalized event
      const event = this.backend.parseEvent(rawEvent);
      if (event) {
        this.handleEvent(agentId, event);
      }
    } catch {
      // Not JSON - raw output
      this.callbacks.onOutput(agentId, `[raw] ${line}`);
    }
  }

  /**
   * Handle a normalized event
   */
  private handleEvent(agentId: string, event: StandardEvent): void {
    // Send to callback
    this.callbacks.onEvent(agentId, event);

    // Also generate human-readable output
    switch (event.type) {
      case 'init':
        this.callbacks.onOutput(
          agentId,
          `Session started: ${event.sessionId} (${event.model})`
        );
        break;

      case 'text':
        if (event.text) {
          this.callbacks.onOutput(agentId, event.text, event.isStreaming);
        }
        break;

      case 'thinking':
        if (event.text) {
          this.callbacks.onOutput(
            agentId,
            `[thinking] ${event.text}`,
            event.isStreaming
          );
        }
        break;

      case 'tool_start':
        // Send tool name and input as separate messages for better formatting
        this.callbacks.onOutput(agentId, `Using tool: ${event.toolName}`);
        if (event.toolInput) {
          try {
            const inputStr = typeof event.toolInput === 'string'
              ? event.toolInput
              : JSON.stringify(event.toolInput, null, 2);
            this.callbacks.onOutput(agentId, `Tool input: ${inputStr}`);
          } catch {
            // Ignore serialization errors
          }
        }
        break;

      case 'tool_result':
        const output = event.toolOutput?.substring(0, 500) || '';
        this.callbacks.onOutput(
          agentId,
          `Tool result: ${output}${output.length >= 500 ? '...' : ''}`
        );
        break;

      case 'step_complete':
        if (event.tokens) {
          this.callbacks.onOutput(
            agentId,
            `Tokens: ${event.tokens.input} in, ${event.tokens.output} out`
          );
        }
        if (event.cost !== undefined) {
          this.callbacks.onOutput(agentId, `Cost: $${event.cost.toFixed(4)}`);
        }
        break;

      case 'error':
        this.callbacks.onError(agentId, event.errorMessage || 'Unknown error');
        break;
    }
  }

  /**
   * Handle stderr
   */
  private handleStderr(agentId: string, process: ChildProcess): void {
    const decoder = new StringDecoder('utf8');

    process.stderr?.on('data', (data: Buffer) => {
      const text = decoder.write(data);
      console.error(`[ClaudeRunner] stderr for ${agentId}:`, text);
      // Don't treat all stderr as errors - some is just logging
      if (text.toLowerCase().includes('error')) {
        this.callbacks.onError(agentId, text);
      }
    });
  }

  /**
   * Stop a running process for an agent
   */
  async stop(agentId: string): Promise<void> {
    const activeProcess = this.activeProcesses.get(agentId);
    if (activeProcess) {
      const pid = activeProcess.process.pid;
      console.log(`[ClaudeRunner] Stopping process for ${agentId} (pid: ${pid})`);

      // Remove from tracking immediately
      this.activeProcesses.delete(agentId);

      // Try to kill the process group first (negative pid kills the group)
      if (pid) {
        try {
          // Kill the entire process group
          process.kill(-pid, 'SIGTERM');
          console.log(`[ClaudeRunner] Sent SIGTERM to process group ${pid}`);
        } catch (e) {
          // Process group kill failed, try direct kill
          console.log(`[ClaudeRunner] Process group kill failed, trying direct kill`);
        }
      }

      // Also send SIGTERM to the main process
      try {
        activeProcess.process.kill('SIGTERM');
      } catch (e) {
        // Ignore if already dead
      }

      // Notify that the process was stopped (so UI updates)
      this.callbacks.onComplete(agentId, false);

      // Give it a moment to terminate gracefully, then force kill
      setTimeout(() => {
        try {
          if (pid && !activeProcess.process.killed) {
            console.log(`[ClaudeRunner] Force killing process ${pid} with SIGKILL`);
            process.kill(-pid, 'SIGKILL');
            activeProcess.process.kill('SIGKILL');
          }
        } catch (e) {
          // Process already dead, ignore
        }
      }, 1000);
    }
  }

  /**
   * Stop all running processes
   */
  async stopAll(): Promise<void> {
    for (const [agentId] of this.activeProcesses) {
      await this.stop(agentId);
    }
  }

  /**
   * Check if an agent has an active process
   */
  isRunning(agentId: string): boolean {
    return this.activeProcesses.has(agentId);
  }

  /**
   * Get session ID for an agent
   */
  getSessionId(agentId: string): string | undefined {
    return this.activeProcesses.get(agentId)?.sessionId;
  }
}
