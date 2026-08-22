import { Search, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CardIdentity } from "../domain/types";
import { rankScryfallResults, searchScryfallPage } from "../services/scryfall";

export interface ScryfallSearchAction {
  id: string;
  label: string;
  semanticLabel: string;
  onConfirm: (
    card: CardIdentity,
  ) =>
    | void
    | { valid: boolean; reason: string }
    | Promise<void | { valid: boolean; reason: string }>;
  validate?: (card: CardIdentity) => string | null;
}

interface ScryfallSearchProps {
  label: string;
  actionLabel?: string;
  onConfirm?: (card: CardIdentity) => void;
  actions?: ScryfallSearchAction[];
  initialQuery?: string;
}

export function ScryfallSearch({
  label,
  actionLabel,
  onConfirm,
  actions,
  initialQuery = "",
}: ScryfallSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CardIdentity[]>([]);
  const [selected, setSelected] = useState<CardIdentity | null>(null);
  const [mode, setMode] = useState<"search" | "preview">("search");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  );
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef(query);
  const loadingMoreRef = useRef(false);

  const availableActions = useMemo<ScryfallSearchAction[]>(() => {
    if (actions?.length) return actions;
    if (!actionLabel || !onConfirm) return [];
    return [
      {
        id: "confirm",
        label: actionLabel,
        semanticLabel: actionLabel,
        onConfirm,
      },
    ];
  }, [actionLabel, actions, onConfirm]);

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
    queryRef.current = query;
    setConfirmationError(null);
    if (query.trim().length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setNextPage(null);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestedQuery = query;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setResults([]);
      setNextPage(null);
      void searchScryfallPage(requestedQuery, {
        signal: controller.signal,
      }).then((page) => {
        if (controller.signal.aborted || queryRef.current !== requestedQuery)
          return;
        setResults(page.cards);
        setNextPage(page.nextPage);
        setLoading(false);
      });
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const visibleResults = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((card) => {
      const key = card.oracleId || `${card.name}:${card.typeLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [results]);

  const printings = useMemo(() => {
    if (!selected) return [];
    return results.filter(
      (card) => card.oracleId && card.oracleId === selected.oracleId,
    );
  }, [results, selected]);

  async function loadMore() {
    if (!nextPage || loadingMoreRef.current || loading) return;
    const requestedQuery = query;
    const controller = abortRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const page = await searchScryfallPage(requestedQuery, {
      signal: controller?.signal,
      pageUrl: nextPage,
    });
    if (controller?.signal.aborted || queryRef.current !== requestedQuery) {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      return;
    }
    setResults((current) =>
      rankScryfallResults(requestedQuery, [
        ...current,
        ...page.cards.filter(
          (card) => !current.some((entry) => entry.cardId === card.cardId),
        ),
      ]),
    );
    setNextPage(page.nextPage);
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }

  function clearSearch() {
    abortRef.current?.abort();
    setQuery("");
    setResults([]);
    setSelected(null);
    setMode("search");
    setNextPage(null);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setConfirmationError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className={`search-panel search-panel-${mode}`}>
      <label className="search-box">
        <Search aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input
          ref={inputRef}
          value={query}
          autoFocus
          onFocus={() => {
            if (mode === "preview") setMode("search");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setMode("search");
          }}
          placeholder="Search Scryfall cards"
          autoComplete="off"
        />
        {query.length > 0 && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear card search"
            onClick={clearSearch}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </label>
      {offline && (
        <p className="offline-note">
          <WifiOff /> Offline: showing previously cached card data when
          available.
        </p>
      )}
      {mode === "search" ? (
        <div
          className="search-results"
          role="listbox"
          aria-label="Scryfall search results"
          onScroll={(event) => {
            const element = event.currentTarget;
            if (
              nextPage &&
              element.scrollHeight - element.scrollTop - element.clientHeight <
                160
            ) {
              void loadMore();
            }
          }}
        >
          {loading && <p className="muted">Searching Scryfall...</p>}
          {!loading &&
            visibleResults.length === 0 &&
            query.trim().length >= 2 && (
              <p className="muted">No cached or online results found.</p>
            )}
          {visibleResults.map((card) => (
            <button
              type="button"
              role="option"
              aria-selected={selected?.cardId === card.cardId}
              key={
                card.oracleId ||
                `${card.cardId}-${card.setCode}-${card.collectorNumber}`
              }
              className={
                selected?.cardId === card.cardId
                  ? "search-result selected"
                  : "search-result"
              }
              onClick={() => {
                setSelected(card);
                setMode("preview");
                setConfirmationError(null);
              }}
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
          {loadingMore && (
            <p className="muted search-more-status">Loading more cards...</p>
          )}
          {!loading &&
            !loadingMore &&
            nextPage &&
            visibleResults.length > 0 && (
              <button
                type="button"
                className="quiet-action search-more"
                onClick={() => void loadMore()}
              >
                Load more cards
              </button>
            )}
        </div>
      ) : (
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
              </div>
              {confirmationError && (
                <p className="search-confirmation-error" role="alert">
                  {confirmationError}
                </p>
              )}
              {!confirmationError &&
                availableActions
                  .map((action) => action.validate?.(selected) ?? null)
                  .find(Boolean) && (
                  <p className="muted search-confirmation-error" role="status">
                    {availableActions
                      .map((action) => action.validate?.(selected) ?? null)
                      .find(Boolean)}
                  </p>
                )}
              <div
                className={
                  availableActions.length > 1
                    ? "search-confirmation-actions dual"
                    : "search-confirmation-actions"
                }
              >
                {availableActions.map((action) => {
                  const validationError = action.validate?.(selected) ?? null;
                  return (
                    <button
                      type="button"
                      key={action.id}
                      className="primary-action"
                      aria-label={action.semanticLabel}
                      disabled={
                        Boolean(validationError) || submittingAction !== null
                      }
                      title={validationError ?? undefined}
                      onClick={async () => {
                        if (validationError) {
                          setConfirmationError(validationError);
                          return;
                        }
                        setSubmittingAction(action.id);
                        setConfirmationError(null);
                        const result = await action.onConfirm(selected);
                        if (result && !result.valid) {
                          setConfirmationError(result.reason);
                          setSubmittingAction(null);
                        }
                      }}
                    >
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function supportText(status: CardIdentity["supportStatus"]): string {
  if (status === "fully-automated") return "Fully automated";
  if (status === "partially-automated") return "Partially automated";
  if (status === "quantity-tracking-only") return "Quantity tracking only";
  return "Unsupported";
}
