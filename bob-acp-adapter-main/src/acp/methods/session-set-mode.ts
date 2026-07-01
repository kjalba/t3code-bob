import {ChatMode, JsonRpcRequest, JsonRpcResponse} from "../types.js";
import {SessionManager} from "../../session/session-manager.js";
import {SetSessionModeRequest, SetSessionModeResponse} from "@agentclientprotocol/sdk";
import {InvalidParamsError, SessionNotFoundError} from "../../utils/errors.js";

const VALID_MODES: ReadonlySet<ChatMode> = new Set(['code', 'ask', 'plan', 'advanced']);

export async function handleSessionSetMode(
    request: JsonRpcRequest,
    sessionManager: SessionManager
): Promise<JsonRpcResponse> {
    const params = request.params as SetSessionModeRequest;
    const {sessionId, modeId} = params;

    const session = sessionManager.getSession(sessionId);
    if (!session) {
        throw new SessionNotFoundError(sessionId);
    }

    if (!VALID_MODES.has(modeId as ChatMode)) {
        throw new InvalidParamsError(`Invalid mode: ${modeId}`, {
            modeId,
            validModes: Array.from(VALID_MODES)
        });
    }

    session.mode = modeId as ChatMode;
    const result: SetSessionModeResponse = {};
    return {
        jsonrpc: '2.0',
        id: request.id,
        result
    };
}
