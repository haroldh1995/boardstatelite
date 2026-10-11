import {
  normalizeDeckSnapshot,
  type SessionDeckSnapshot,
} from "../domain/deckSnapshot";

export interface DeckNexusSummary {
  id: string;
  name: string;
  commanderNames: string[];
}
/** The ecosystem host installs a transport adapter. Lite never reads another app's storage. */
export interface DeckNexusPort {
  listDecks(signal?: AbortSignal): Promise<DeckNexusSummary[]>;
  snapshot(deckId: string, signal?: AbortSignal): Promise<unknown>;
}
class DeckNexusConnection {
  private port: DeckNexusPort | null = null;
  install(port: DeckNexusPort | null): void {
    this.port = port;
  }
  get available(): boolean {
    return this.port !== null;
  }
  async listDecks(signal?: AbortSignal): Promise<DeckNexusSummary[]> {
    if (!this.port) return [];
    return this.port.listDecks(signal);
  }
  async snapshot(
    id: string,
    signal?: AbortSignal,
  ): Promise<SessionDeckSnapshot | null> {
    if (!this.port) return null;
    const snapshot = normalizeDeckSnapshot(
      await this.port.snapshot(id, signal),
    );
    if (snapshot?.deckId !== id) return null;
    return snapshot;
  }
}
export const deckNexusConnection = new DeckNexusConnection();
