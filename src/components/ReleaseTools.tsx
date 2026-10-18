import { useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";

export function ActivitySheet() {
  const activity = useFieldStore((state) => state.field.activity ?? []);
  const last = useFieldStore((state) => state.undoStack.at(-1));
  const undo = useFieldStore((state) => state.undo);
  return (
    <div>
      <h2 id="modal-title">Game Activity</h2>
      {last && (
        <section className="ability-choice">
          <h3>Review Last Action</h3>
          <strong>{last.label}</strong>
          {last.summary.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          <button onClick={undo}>
            <RotateCcw /> Undo Entire Action
          </button>
          <p className="muted">
            Undo, then reapply with the correct choices. Unrelated earlier
            actions stay intact.
          </p>
        </section>
      )}
      {!activity.length && <p>No recorded activity in this game.</p>}
      <ol className="activity-list">
        {[...activity].reverse().map((entry) => (
          <li key={entry.id}>
            <strong>{entry.label}</strong>
            <small>
              {entry.origin} · {new Date(entry.at).toLocaleTimeString()}
            </small>
            {entry.summary.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

const lessons = [
  [
    "Your Physical Game",
    "Start a fresh game from User Tools. Lite follows the table; it does not decide what you may do.",
  ],
  [
    "Life",
    "Tap minus or plus for one. Hold to adjust continuously; release to stop. The signed delta shows your net change.",
  ],
  [
    "Full-Screen Life",
    "Spread two fingers on the battlefield to expand life. Pinch inward to return. Options also provides Full-Screen Life.",
  ],
  [
    "Your Battlefield",
    "Use Add to find a permanent. Long press a card to manage it; keyboard Enter and the counter control offer alternatives.",
  ],
  [
    "Activate Field",
    "Select a triggered ability whose condition happened. Known effects can resolve directly; player choices remain yours.",
  ],
  [
    "Ability Focus",
    "Swipe the Activate Field control horizontally, or use its arrow switch, to highlight activated abilities.",
  ],
  [
    "Inspect Abilities",
    "Double-tap a highlighted card, or use its ability icon. Each ability shows its cost, restrictions and recorded use.",
  ],
  [
    "Costs and Choices",
    "Choose targets and costs before committing activation. Resolve later from Turn Memory. Cancelling an effect does not refund paid costs.",
  ],
  [
    "Turns, Not Phases",
    "Start Turn begins your recorded turn. End Turn moves between turns. Lite does not assume phase or priority.",
  ],
  [
    "Recover Mistakes",
    "Quick Undo reverses the last transaction. User Tools > Game Activity explains it. Catch Me Up corrects state without creating gameplay triggers.",
  ],
];
export function FirstGameSheet() {
  const [step, setStep] = useState(0);
  const update = useFieldStore((state) => state.updateSettings);
  const close = useFieldStore((state) => state.closeModal);
  const done = () => {
    update({ firstGameCompleted: true });
    close();
  };
  return (
    <div className="first-game-guide">
      <h2 id="modal-title">First Game</h2>
      <small>
        {step + 1} / {lessons.length}
      </small>
      <h3>{lessons[step][0]}</h3>
      <p>{lessons[step][1]}</p>
      <div className="ability-workflow-actions">
        <button
          aria-label="Previous lesson"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          <ArrowLeft />
        </button>
        {step < lessons.length - 1 ? (
          <button aria-label="Next lesson" onClick={() => setStep(step + 1)}>
            <ArrowRight />
          </button>
        ) : (
          <button className="primary-action" onClick={done}>
            Ready to Play
          </button>
        )}
        <button onClick={done}>Skip Guide</button>
      </div>
    </div>
  );
}
