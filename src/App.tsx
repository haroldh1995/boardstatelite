import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Battlefield } from "./components/Battlefield";
import { ActiveTurnActionStrip } from "./components/ActiveTurnActionStrip";
import { AthenaDecisionSurface } from "./components/AthenaDecisionSurface";
import { BottomDock } from "./components/BottomDock";
import { LifeTracker } from "./components/LifeTracker";
import { MicrophoneStatusIndicator } from "./components/MicrophoneStatusIndicator";
import { ModalRoot } from "./components/ModalRoot";
import { SmartSuggestionsTray } from "./components/SmartSuggestionsTray";
import { TotalsStrip } from "./components/TotalsStrip";
import { isReferenceFixtureMode } from "./dev/referenceMode";
import { useFieldStore } from "./state/useFieldStore";
import "./App.css";

function App() {
  const initialize = useFieldStore((state) => state.initialize);
  const initializeListening = useFieldStore(
    (state) => state.initializeListening,
  );
  const handleListeningLifecycleEvent = useFieldStore(
    (state) => state.handleListeningLifecycleEvent,
  );
  const hydrated = useFieldStore((state) => state.hydrated);
  const fieldName = useFieldStore((state) => state.field.name);
  const announcements = useFieldStore((state) =>
    [
      state.lastResult?.accessibilityAnnouncements?.join(" ") ?? "",
      state.field.athena.reconciliation.recent.at(-1)?.semanticSummary ?? "",
      state.field.athena.cardIdentification.activeRequestId
        ? "Choose the card entering the battlefield."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const catchUpSuggested = useFieldStore(
    (state) => state.field.athena.reconciliation.catchUpSuggested,
  );
  const openModal = useFieldStore((state) => state.openModal);
  const modalKind = useFieldStore((state) => state.modal?.kind ?? null);
  const pendingCardIdentificationId = useFieldStore(
    (state) => state.field.athena.cardIdentification.activeRequestId,
  );
  const dismissCatchUpSuggestion = useFieldStore(
    (state) => state.dismissCatchUpSuggestion,
  );
  const referenceMode = isReferenceFixtureMode();
  const automaticallyPresentedCardIds = useRef(new Set<string>());
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW() {
      // Registration is intentionally prompt-based so updates do not disrupt active games.
    },
  });

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!hydrated) return;
    void initializeListening();
  }, [hydrated, initializeListening]);

  useEffect(() => {
    if (!pendingCardIdentificationId) {
      automaticallyPresentedCardIds.current.clear();
      return;
    }
    if (
      !hydrated ||
      modalKind ||
      automaticallyPresentedCardIds.current.has(pendingCardIdentificationId)
    ) {
      return;
    }
    automaticallyPresentedCardIds.current.add(pendingCardIdentificationId);
    openModal({ kind: "cardIdentification" });
  }, [hydrated, modalKind, openModal, pendingCardIdentificationId]);

  useEffect(() => {
    if (!hydrated) return;
    const handleVisibilityChange = () => {
      void handleListeningLifecycleEvent({
        type: document.hidden ? "app-backgrounded" : "app-foregrounded",
        timestamp: new Date().toISOString(),
      });
    };
    const handlePageHide = () => {
      void handleListeningLifecycleEvent({
        type: "app-backgrounded",
        timestamp: new Date().toISOString(),
      });
    };
    const handlePageShow = () => {
      void handleListeningLifecycleEvent({
        type: "app-foregrounded",
        timestamp: new Date().toISOString(),
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [handleListeningLifecycleEvent, hydrated]);

  return (
    <div
      className={referenceMode ? "app-shell reference-fixture" : "app-shell"}
    >
      <header className="app-header" aria-label="Baord State Lite">
        <div>
          <h1>Baord State Lite</h1>
          <p>{fieldName}</p>
        </div>
      </header>
      {needRefresh[0] && (
        <aside className="pwa-update-toast" role="status" aria-live="polite">
          <span>New visual update ready</span>
          <button
            type="button"
            className="update-button"
            onClick={() => void updateServiceWorker(true)}
          >
            Refresh app
          </button>
        </aside>
      )}
      {!hydrated ? (
        <main className="loading-screen">Loading saved field...</main>
      ) : (
        <>
          <LifeTracker />
          <TotalsStrip />
          <MicrophoneStatusIndicator />
          {catchUpSuggested && (
            <aside
              className="recovery-toast"
              role="status"
              aria-label="Lite may be behind the physical game. Catch Me Up corrects current state without generating gameplay events."
            >
              <button
                type="button"
                className="primary-action"
                onClick={() => openModal({ kind: "catchUp" })}
              >
                Catch Me Up
              </button>
              <button
                type="button"
                className="quiet-action"
                onClick={dismissCatchUpSuggestion}
              >
                Dismiss
              </button>
            </aside>
          )}
          {pendingCardIdentificationId &&
            modalKind !== "cardIdentification" && (
              <aside
                className="recovery-toast"
                role="status"
                aria-label="A resolving effect is waiting for the entering card to be identified."
              >
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => openModal({ kind: "cardIdentification" })}
                >
                  Choose Entering Card
                </button>
              </aside>
            )}
          <SmartSuggestionsTray />
          <ActiveTurnActionStrip />
          <AthenaDecisionSurface />
          <Battlefield />
          <BottomDock />
          <ModalRoot />
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {announcements}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
