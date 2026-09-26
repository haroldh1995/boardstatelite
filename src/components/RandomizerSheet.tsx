import { Coins, Dices, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useFieldStore } from "../state/useFieldStore";

export function RandomizerSheet({ mode }: { mode: "dice" | "coin" }) {
  const state = useFieldStore((store) => store.field.randomizer);
  const reducedMotion = useFieldStore(
    (store) => store.field.settings.reducedMotion,
  );
  const run = useFieldStore((store) => store.runRandomizer);
  const [count, setCount] = useState(1);
  const [sideSelection, setSideSelection] = useState("20");
  const [customSides, setCustomSides] = useState(30);
  const sides =
    sideSelection === "custom" ? customSides : Number(sideSelection);
  const latest = state.latest?.kind === mode ? state.latest : null;
  const runCurrent = () => run({ kind: mode, count, sides });
  return (
    <div className="randomizer-sheet">
      <h2 id="modal-title">{mode === "dice" ? "Dice" : "Coin Flip"}</h2>
      <div className="randomizer-controls">
        <label>
          Number
          <input
            type="number"
            min={1}
            max={mode === "dice" ? 40 : 100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        {mode === "dice" && (
          <label>
            Sides
            <select
              value={sideSelection}
              onChange={(event) => setSideSelection(event.target.value)}
            >
              {[4, 6, 8, 10, 12, 20, 100].map((value) => (
                <option value={value} key={value}>
                  D{value}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
        )}
        {mode === "dice" && sideSelection === "custom" && (
          <label>
            Custom sides
            <input
              type="number"
              min={2}
              max={1_000_000}
              value={customSides}
              onChange={(event) => setCustomSides(Number(event.target.value))}
            />
          </label>
        )}
      </div>
      <button
        type="button"
        className="primary-action randomizer-run"
        onClick={runCurrent}
      >
        {mode === "dice" ? <Dices /> : <Coins />}
        {mode === "dice" ? "Roll" : "Flip"}
      </button>
      <div
        className={[
          "randomizer-stage",
          latest ? "has-result" : "",
          reducedMotion ? "reduced-motion" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-live="polite"
      >
        {latest ? (
          latest.kind === "dice" ? (
            <>
              <div className="dice-result" aria-hidden="true">
                {latest.values.join(" · ")}
              </div>
              <strong>Total {latest.total}</strong>
              <span className="sr-only">
                Rolled {latest.values.join(", ")}. Total {latest.total}.
              </span>
            </>
          ) : (
            <>
              <div className="coin-result" aria-hidden="true">
                {latest.values.join(" · ")}
              </div>
              <strong>{latest.values.join(", ")}</strong>
              <span className="sr-only">
                Coin result: {latest.values.join(", ")}.
              </span>
            </>
          )
        ) : (
          <span>{mode === "dice" ? "Ready to roll" : "Ready to flip"}</span>
        )}
      </div>
      {latest && (
        <button type="button" onClick={runCurrent}>
          <RotateCcw /> {mode === "dice" ? "Reroll" : "Flip Again"}
        </button>
      )}
      <section className="recent-randomizer-results">
        <h3>Recent</h3>
        {state.history
          .slice(-5)
          .reverse()
          .map((result) => (
            <p key={result.id}>
              {result.kind === "dice"
                ? `${result.count}D${result.sides}: ${result.values.join(", ")}`
                : result.values.join(", ")}
            </p>
          ))}
      </section>
    </div>
  );
}
