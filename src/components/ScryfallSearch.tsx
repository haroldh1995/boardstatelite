import { Search, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CardIdentity } from "../domain/types";
import { searchScryfall } from "../services/scryfall";

interface ScryfallSearchProps {
  label: string;
  actionLabel: string;
  onConfirm: (card: CardIdentity) => void;
  initialQuery?: string;
}

export function ScryfallSearch({
  label,
  actionLabel,
  onConfirm,
  initialQuery = "",
}: ScryfallSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CardIdentity[]>([]);
  const [selected, setSelected] = useState<CardIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void searchScryfall(query, { signal: controller.signal }).then(
        (cards) => {
          if (!controller.signal.aborted) {
            setResults(cards.slice(0, 40));
            setLoading(false);
          }
        },
      );
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const printings = useMemo(() => {
    if (!selected) return [];
    return results.filter(
      (card) => card.oracleId && card.oracleId === selected.oracleId,
    );
  }, [results, selected]);

  return (
    <div className="search-panel">
      <label className="search-box">
        <Search aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Scryfall cards"
          autoComplete="off"
        />
      </label>
      {offline && (
        <p className="offline-note">
          <WifiOff /> Offline: showing previously cached card data when
          available.
        </p>
      )}
      <div className="search-content">
        <div
          className="search-results"
          role="listbox"
          aria-label="Scryfall search results"
        >
          {loading && <p className="muted">Searching Scryfall...</p>}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <p className="muted">No cached or online results found.</p>
          )}
          {results.map((card) => (
            <button
              type="button"
              key={`${card.cardId}-${card.setCode}-${card.collectorNumber}`}
              className={
                selected?.cardId === card.cardId
                  ? "search-result selected"
                  : "search-result"
              }
              onClick={() => setSelected(card)}
            >
              {card.imageSmall && (
                <img src={card.imageSmall} alt="" loading="lazy" />
              )}
              <span>
                <strong>{card.name}</strong>
                <small>{card.typeLine}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="card-preview-pane" aria-live="polite">
          {selected ? (
            <>
              {selected.imageUrl && (
                <img
                  className="preview-card-image"
                  src={selected.imageUrl}
                  alt={`${selected.name} card`}
                />
              )}
              <div className="preview-copy">
                <h3>{selected.name}</h3>
                <p>{selected.typeLine}</p>
                <p className="oracle-text">
                  {selected.oracleText || "No Oracle text."}
                </p>
                <p>
                  <strong>Support:</strong>{" "}
                  {supportText(selected.supportStatus)}
                </p>
                {printings.length > 1 && (
                  <label>
                    Printing
                    <select
                      value={selected.cardId}
                      onChange={(event) => {
                        const printing = printings.find(
                          (card) => card.cardId === event.target.value,
                        );
                        if (printing) setSelected(printing);
                      }}
                    >
                      {printings.map((card) => (
                        <option key={card.cardId} value={card.cardId}>
                          {card.setCode?.toUpperCase()} #{card.collectorNumber}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => onConfirm(selected)}
                >
                  {actionLabel}
                </button>
              </div>
            </>
          ) : (
            <p className="muted">
              Select a result to preview. Nothing changes until you confirm.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function supportText(status: CardIdentity["supportStatus"]): string {
  if (status === "fully-automated") return "Fully automated";
  if (status === "partially-automated") return "Partially automated";
  if (status === "quantity-tracking-only") return "Quantity tracking only";
  return "Unsupported";
}
