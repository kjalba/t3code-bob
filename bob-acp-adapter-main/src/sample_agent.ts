#!/usr/bin/env node

import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

interface AgentSession {
  pendingPrompt: AbortController | null;
}

class ExampleAgent implements acp.Agent {
  private connection: acp.AgentSideConnection;
  private sessions: Map<string, AgentSession>;

  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection;
    this.sessions = new Map();
  }

  async initialize(
    _params: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
    };
  }

  async newSession(
    _params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    this.sessions.set(sessionId, {
      pendingPrompt: null,
    });

    return {
      sessionId,
    };
  }

  async authenticate(
    _params: acp.AuthenticateRequest,
  ): Promise<acp.AuthenticateResponse | void> {
    // No auth needed - return empty response
    return {};
  }

  async setSessionMode(
    _params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    // Session mode changes not implemented in this example
    return {};
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);

    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    session.pendingPrompt?.abort();
    session.pendingPrompt = new AbortController();

    try {
      await this.simulateTurn(params.sessionId, session.pendingPrompt.signal);
    } catch (err) {
      if (session.pendingPrompt.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      throw err;
    }

    session.pendingPrompt = null;

    return {
      stopReason: "end_turn",
    };
  }

  private async simulateTurn(
    sessionId: string,
    abortSignal: AbortSignal,
  ): Promise<void> {
    // Send initial text chunk
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "I'll help you with that. Let me start by reading some files to understand the current situation.",
        },
      },
    });

    await this.simulateModelInteraction(abortSignal);

    // Send a tool call that doesn't need permission
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "Reading project files",
        kind: "read",
        status: "in_progress",
        locations: [{ path: "/Users/olira/Development/src/github.ibm.com/ai-content/aia-agentic-core/README.md" }],
        rawInput: { path: "/Users/olira/Development/src/github.ibm.com/ai-content/aia-agentic-core/README.md" },
      },
    });

    await this.simulateModelInteraction(abortSignal);

    const file = await this.connection.readTextFile({
        sessionId,
        path: "/Users/olira/Development/src/github.ibm.com/ai-content/aia-agentic-core/README.md"
    });

    // Update tool call to completed
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_1",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: file.content,
            },
          },
        ],
        rawOutput: { content: file.content },
      },
    });

    await this.simulateModelInteraction(abortSignal);

    // Send more text
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: " Now I understand the project structure. I need to make some changes to improve it.",
        },
      },
    });

    await this.simulateModelInteraction(abortSignal);

    const newContent = file.content.replace("simple_agent", "awesome_agent");

    // Send a tool call that DOES need permission
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_2",
        title: "Modifying critical configuration file",
        kind: "edit",
        status: "in_progress",
        content: [
            {"type": "diff",
                oldText: file.content,
                newText: newContent,
                path: "/Users/olira/Development/src/github.ibm.com/ai-content/aia-agentic-core/README.md"
            }
        ],
      },
    });

//2026-03-12 14:58:44,686 [  85208]   FINE - AcpTransport - IN: {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"019ce256-6c29-7330-9519-f7857aecfaa5","update":{"sessionUpdate":"tool_call","toolCallId":"call_pjflD2IPeW08z2HZ5kvqiXte","title":"Editing files","kind":"edit","status":"in_progress","content":[{"type":"diff","oldText":"tt-platform\n\nMonorepo boilerplate for a NestJS API, Tampermonkey userscript, and future workers.\r\n","newText":"tt-platform\n\nMonorepo boilerplate for a NestJS API, Tampermonkey userscript, and awesome workers.\n","path":"C:\\devel\\src\\github.com\\olira\\tt-platform\\README.md","_meta":{"kind":"update"}}]}}}

    // Request permission for the sensitive operation
    const permissionResponse = await this.connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: "call_2",
        title: "Modifying critical configuration file",
        kind: "edit",
        status: "pending"
      },
      options: [
        {
          kind: "allow_once",
          name: "Allow this change",
          optionId: "allow",
        },
        {
          kind: "reject_once",
          name: "Skip this change",
          optionId: "reject",
        },
      ],
    });

    if (permissionResponse.outcome.outcome === "cancelled") {
      return;
    }

    switch (permissionResponse.outcome.optionId) {
      case "allow": {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_2",
            status: "completed",
            rawOutput: { success: true, message: "Configuration updated" },
          },
        });

        await this.simulateModelInteraction(abortSignal);

        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: " Perfect! I've successfully updated the configuration. The changes have been applied.",
            },
          },
        });
        break;
      }
      case "reject": {
        await this.simulateModelInteraction(abortSignal);

        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: " I understand you prefer not to make that change. I'll skip the configuration update.",
            },
          },
        });
        break;
      }
      default:
        throw new Error(
          `Unexpected permission outcome ${permissionResponse.outcome}`,
        );
    }
  }

  private simulateModelInteraction(abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        // In a real agent, you'd pass this abort signal to the LLM client
        if (abortSignal.aborted) {
          reject();
        } else {
          resolve();
        }
      }, 2000),
    );
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.pendingPrompt?.abort();
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;

const stream = acp.ndJsonStream(input, output);
new acp.AgentSideConnection((conn) => new ExampleAgent(conn), stream);