/**
 * Claude Backend Types
 * Modular abstraction for CLI backend communication
 */

// Standard normalized event format (backend-agnostic)
export interface StandardEvent {
  type:
    | 'init'
    | 'text'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'step_complete'
    | 'error'
    | 'block_start'
    | 'block_end';
  blockType?: 'text' | 'thinking';
  sessionId?: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  tokens?: {
    input: number;
    output: number;
    cacheCreation?: number;  // cache_creation_input_tokens
    cacheRead?: number;      // cache_read_input_tokens
  };
  cost?: number;
  durationMs?: number;
  isStreaming?: boolean;
  model?: string;
  tools?: string[];
  errorMessage?: string;
  resultText?: string;  // Full result text from result event (for boss delegation parsing)
  permissionDenials?: Array<{  // Tools that were denied permission (from result event)
    toolName: string;
    toolUseId: string;
    toolInput: Record<string, unknown>;
  }>;
}

// Configuration for backend
export interface BackendConfig {
  sessionId?: string;
  model?: string;
  workingDir: string;
  permissionMode?: 'bypass' | 'interactive';
  prompt?: string;
  systemPrompt?: string;
  useChrome?: boolean;
  disableTools?: boolean;  // Disable all tools (for boss team questions)
}

// Raw event from Claude CLI (partial typing for flexibility)
export interface ClaudeRawEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  tools?: string[];
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  tool_name?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  event?: {
    type: string;
    delta?: {
      type: string;
      text?: string;
    };
    content_block?: {
      type: string;
    };
  };
  error?: string;
  permission_denials?: Array<{
    tool_name: string;
    tool_use_id: string;
    tool_input: Record<string, unknown>;
  }>;
}

// Backend interface (allows for multiple CLI backends)
export interface CLIBackend {
  readonly name: string;

  // Build CLI arguments
  buildArgs(config: BackendConfig): string[];

  // Parse raw event to normalized format
  parseEvent(rawEvent: unknown): StandardEvent | null;

  // Extract session ID from raw event
  extractSessionId(rawEvent: unknown): string | null;

  // Get executable path
  getExecutablePath(): string;

  // Detect CLI installation
  detectInstallation(): string | null;

  // Whether stdin input is required
  requiresStdinInput(): boolean;

  // Format stdin input for the CLI
  formatStdinInput(prompt: string): string;
}

// Runner request
export interface RunnerRequest {
  agentId: string;
  prompt: string;
  workingDir: string;
  sessionId?: string;
  model?: string;
  useChrome?: boolean;
  permissionMode?: 'bypass' | 'interactive';
  systemPrompt?: string;
  disableTools?: boolean;  // Disable all tools (for boss team questions)
  forceNewSession?: boolean;  // Don't resume existing session (for boss team questions)
}

// Runner callbacks
export interface RunnerCallbacks {
  onEvent: (agentId: string, event: StandardEvent) => void;
  onOutput: (agentId: string, text: string, isStreaming?: boolean) => void;
  onSessionId: (agentId: string, sessionId: string) => void;
  onComplete: (agentId: string, success: boolean) => void;
  onError: (agentId: string, error: string) => void;
}

// Active process tracking
export interface ActiveProcess {
  agentId: string;
  sessionId?: string;
  startTime: number;
  process: import('child_process').ChildProcess;
}
