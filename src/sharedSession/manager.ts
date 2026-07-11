import type { FieldState } from "../domain/types";
import { createSessionSnapshot, normalizeSessionMetadata } from "./metadata";
import { serializeSessionExport } from "./serializer";
import type {
  SessionDiagnostics,
  SessionHookResult,
  SharedSessionMetadata,
  SharedSessionSnapshot,
} from "./types";

const UNAVAILABLE_REASON =
  "Shared sessions require future BoardState ecosystem support.";

export class SharedSessionManager {
  private lastError: string | null = null;
  private lastUnavailableReason: string | null = null;
  private lastSession: SharedSessionMetadata | null = null;

  ensureSession(field: FieldState): SharedSessionMetadata {
    const session = normalizeSessionMetadata(field.session, {
      fallbackTimestamp: field.updatedAt,
    });
    this.lastSession = session;
    return session;
  }

  snapshot(field: FieldState): SharedSessionSnapshot {
    return createSessionSnapshot(this.ensureSession(field));
  }

  export(field: FieldState): string {
    return serializeSessionExport(field);
  }

  diagnostics(field?: FieldState): SessionDiagnostics | null {
    const session = field ? this.ensureSession(field) : this.lastSession;
    if (!session) return null;
    return {
      sessionId: session.id,
      status: session.status,
      currentRulesAuthority: session.currentRulesAuthority,
      currentSessionAuthority: session.currentSessionAuthority,
      participantCount: session.participants.length,
      capabilities: { ...session.capabilities },
      synchronizationVersion: session.synchronizationVersion,
      lastError: this.lastError,
      lastUnavailableReason: this.lastUnavailableReason,
    };
  }

  connect(): SessionHookResult {
    return this.unavailable();
  }

  disconnect(): SessionHookResult {
    return this.unavailable();
  }

  synchronize(): SessionHookResult {
    return this.unavailable();
  }

  publishSnapshot(): SessionHookResult {
    return this.unavailable();
  }

  receiveSnapshot(): SessionHookResult {
    return this.unavailable();
  }

  private unavailable(): SessionHookResult {
    this.lastUnavailableReason = UNAVAILABLE_REASON;
    return {
      ok: false,
      reason: UNAVAILABLE_REASON,
      status: "localOnly",
    };
  }
}

export const sharedSessionManager = new SharedSessionManager();

installSharedSessionDiagnosticsGlobal();

function installSharedSessionDiagnosticsGlobal(): void {
  if (typeof globalThis === "undefined") return;
  const target = globalThis as typeof globalThis & {
    __BAORD_STATE_LITE_SHARED_SESSION__?: {
      getDiagnostics: (field?: FieldState) => SessionDiagnostics | null;
    };
  };
  target.__BAORD_STATE_LITE_SHARED_SESSION__ = {
    getDiagnostics: (field?: FieldState) =>
      sharedSessionManager.diagnostics(field),
  };
}
