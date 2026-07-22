import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Battlefield } from "./components/Battlefield";
import { ActiveTurnActionStrip } from "./components/ActiveTurnActionStrip";
import { BottomDock } from "./components/BottomDock";
import { LifeTracker } from "./components/LifeTracker";
import { MicrophoneStatusIndicator } from "./components/MicrophoneStatusIndicator";
import { ModalRoot } from "./components/ModalRoot";
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
  const announcements = useFieldStore(
    (state) => state.lastResult?.accessibilityAnnouncements?.join(" ") ?? "",
  );
  const referenceMode = isReferenceFixtureMode();
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
          <ActiveTurnActionStrip />
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
