import { useEffect, useState } from "react";
import { deckNexusConnection, type DeckNexusSummary } from "../hub/deckNexus";
import { useFieldStore } from "../state/useFieldStore";

export function CurrentDeckSheet() {
  const deck = useFieldStore((state) => state.field.sessionDeck);
  const selectDeck = useFieldStore((state) => state.selectSessionDeck);
  const close = useFieldStore((state) => state.closeModal);
  const [decks, setDecks] = useState<DeckNexusSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(deckNexusConnection.available);
    void deckNexusConnection
      .listDecks(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setDecks(items);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Deck Nexus is unavailable. Your current game is unchanged.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!requestedId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void deckNexusConnection
      .snapshot(requestedId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        if (!snapshot) {
          setError(
            "This deck is no longer available. Your current game is unchanged.",
          );
          return;
        }
        selectDeck(snapshot);
        close();
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load this deck. Your current game is unchanged.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRequestedId(null);
        }
      });
    return () => controller.abort();
  }, [requestedId, selectDeck, close]);
  return (
    <div>
      <h2 id="modal-title">Current Deck</h2>
      {deck && (
        <section>
          <h3>{deck.name}</h3>
          <p>
            {deck.cards
              .filter((card) => card.isCommander)
              .map((card) => card.name)
              .join(" / ")}
          </p>
          <p>
            {deck.cards.reduce((sum, card) => sum + card.quantity, 0)} cards
          </p>
          <button
            type="button"
            className="quiet-action"
            onClick={() => selectDeck(null)}
          >
            Disconnect Deck
          </button>
        </section>
      )}
      <h3>Play With Deck Nexus Deck</h3>
      {!deckNexusConnection.available && (
        <p>Deck Nexus is not connected on this device.</p>
      )}
      {loading && <p role="status">Loading decks...</p>}
      {error && <p role="status">{error}</p>}
      {decks.map((entry) => (
        <button
          type="button"
          className="deck-choice"
          key={entry.id}
          disabled={loading}
          onClick={() => setRequestedId(entry.id)}
        >
          <strong>{entry.name}</strong>
          <small>{entry.commanderNames.join(" / ")}</small>
        </button>
      ))}
      <button
        type="button"
        className="primary-action"
        onClick={() => {
          if (!deck) selectDeck(null);
          close();
        }}
      >
        {deck ? "Continue Game" : "Play Without Deck"}
      </button>
    </div>
  );
}
