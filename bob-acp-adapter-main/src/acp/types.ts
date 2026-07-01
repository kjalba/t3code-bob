/**
 * ACP (Agentic Client Protocol) Type Definitions
 * Based on the ACP specification for IntelliJ integration
 */
import {SessionUpdate} from "@agentclientprotocol/sdk";

// JSON-RPC 2.0 base types
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: JsonRpcError;
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

// Standard JSON-RPC error codes
export enum JsonRpcErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32003,
    // Custom error codes
    SessionNotFound = -32001,
    SecurityViolation = -32002,
    SessionBusy = -32004,
}

// ACP Protocol Methods
export type AcpMethod =
    | 'initialize'
    | 'session/new'
    | 'session/prompt'
    | 'session/cancel'
    | 'session/load';

// Initialize method
export interface InitializeParams {
    clientInfo: {
        name: string;
        version: string;
    };
}

export interface InitializeResult {
    protocolVersion: number;
    agentCapabilities: AgentCapabilities;
    agentInfo: AgentInfo;
}

export interface AgentCapabilities {
    loadSession: boolean;
    mcpCapabilities: McpCapabilities;
}

export interface McpCapabilities {
    http: boolean;
    sse: boolean;
}

export interface AgentInfo {
    name: string;
    version: string;
}

export interface McpServerConfig {
    type?: 'stdio' | 'sse' | 'http';  // Transport type from IntelliJ
    name: string;
    command: string;
    args?: string[];
    env?: Array<{ name: string; value: string }> | Record<string, string>;  // Support both formats
    url?: string;  // For SSE transport
    httpURL?: string;  // For HTTP transport
    headers?: Record<string, string>;  // For SSE/HTTP transport
    cwd?: string;  // Working directory
    timeout?: number;  // Request timeout
    alwaysAllow?: string[];  // Tools to auto-approve
    disabled?: boolean;  // Whether server is disabled
}

export type ChatMode = 'code' | 'plan' | 'advanced' | 'ask';

// Stop reasons for prompt completion
export type StopReason = 'end_turn' | 'max_tokens' | 'cancelled';

// Session/prompt method
export interface SessionPromptParams {
    sessionId: string;
    prompt: PromptMessage | ContentBlock[] | string; // Supports SDK object, block array, or plain string
    context?: PromptContext;
}

export interface PromptMessage {
    content: ContentBlock[];
}

export interface ContentBlock {
    type: 'text';
    text: string;
}

export interface SessionPromptResult {
    stopReason: StopReason;
}

export interface PromptContext {
    files?: string[];
    selection?: {
        file: string;
        start: number;
        end: number;
    };
}

// Session/cancel method
export interface SessionCancelParams {
    sessionId: string;
}

// Message history
export interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export type SessionEventMapping = SessionUpdate | SessionUpdate[] | null;
