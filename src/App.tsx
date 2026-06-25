import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Battlefield } from "./components/Battlefield";
import { BottomDock } from "./components/BottomDock";
import { LifeTracker } from "./components/LifeTracker";
import { ModalRoot } from "./components/ModalRoot";
import { TotalsStrip } from "./components/TotalsStrip";
import { isReferenceFixtureMode } from "./dev/referenceMode";
import { useFieldStore } from "./state/useFieldStore";
import "./App.css";

function App() {
  const initialize = useFieldStore((state) => state.initialize);
  const hydrated = useFieldStore((state) => state.hydrated);
  const fieldName = useFieldStore((state) => state.field.name);
  const referenceMode = isReferenceFixtureMode();
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW() {
      // Registration is intentionally prompt-based so updates do not disrupt active games.
    },
  });

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <div
      className={referenceMode ? "app-shell reference-fixture" : "app-shell"}
    >
      <header className="app-header" aria-label="Baord State Lite">
        <div>
          <h1>Baord State Lite</h1>
          <p>{fieldName}</p>
        </div>
        {needRefresh[0] && (
          <button
            type="button"
            className="update-button"
            onClick={() => void updateServiceWorker(true)}
          >
            Update ready
          </button>
        )}
      </header>
      {!hydrated ? (
        <main className="loading-screen">Loading saved field...</main>
      ) : (
        <>
          <LifeTracker />
          <TotalsStrip />
          <Battlefield />
          <BottomDock />
          <ModalRoot />
        </>
      )}
    </div>
  );
}

export default App;
