import { useState } from "react";
import { useFieldStore } from "../state/useFieldStore";
import {
  workflowRequirements,
  type WorkflowRequirement,
} from "../athena/abilityWorkflow";
import type { AbilityChoice } from "../athena/abilityWorkflowTypes";
import { COUNTER_OPTIONS } from "../domain/cards";

export function AbilityWorkflowSheet({ id }: { id: string }) {
  const field = useFieldStore((state) => state.field);
  const choose = useFieldStore((state) => state.setAbilityChoice);
  const advance = useFieldStore((state) => state.advanceAbility);
  const [error, setError] = useState<string | null>(null);
  const item = field.turnContext.triggerMemory.find((entry) => entry.id === id);
  const workflow = item?.workflow;
  if (!workflow) return <p>This action is no longer pending.</p>;
  const requirements = [
    ...workflowRequirements(field, workflow),
    ...(workflow.stage === "selection"
      ? workflowRequirements(field, workflow, true)
      : []),
  ];
  const terminal = !["selection", "resolution"].includes(workflow.stage);
  return (
    <div className="ability-sheet">
      <h2 id="modal-title">{workflow.sourceLabel}</h2>
      <p className="oracle-ability">{workflow.ability.text}</p>
      <p className="ability-stage">
        {workflow.stage === "selection"
          ? "Activation - costs and targets"
          : workflow.stage === "resolution"
            ? "Pending resolution"
            : workflow.stage === "cancelled"
              ? "Cancelled"
              : "Resolved"}
      </p>
      {workflow.costsCommitted && (
        <p className="muted">
          Activation costs recorded. Cancelling the effect does not refund them.
        </p>
      )}
      {!terminal &&
        requirements.map((requirement) => (
          <Choice
            key={requirement.key}
            requirement={requirement}
            choice={workflow.choices[requirement.key] ?? {}}
            onChange={(value) => choose(id, requirement.key, value)}
          />
        ))}
      {error && <p role="alert">{error}</p>}
      {!terminal && (
        <div className="ability-workflow-actions">
          <button
            className="primary-action"
            disabled={requirements.length > 0}
            onClick={() => setError(advance(id))}
          >
            {workflow.stage === "selection"
              ? "Commit Activation"
              : "Resolve Now"}
          </button>
          <button onClick={() => setError(advance(id, "manual"))}>
            Resolved at Table
          </button>
          <button onClick={() => setError(advance(id, "cancel"))}>
            {workflow.costsCommitted ? "Countered / Cancel Effect" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}

function Choice({
  requirement,
  choice,
  onChange,
}: {
  requirement: WorkflowRequirement;
  choice: AbilityChoice;
  onChange: (choice: AbilityChoice) => void;
}) {
  const { instruction, candidates } = requirement;
  const [external, setExternal] = useState(choice.external ?? "");
  const [draft, setDraft] = useState(choice);
  if (instruction.kind === "manual")
    return (
      <section className="ability-choice">
        <p>{instruction.text}</p>
        <p className="muted">{requirement.reason}</p>
      </section>
    );
  if (instruction.kind === "payment" || instruction.kind === "optional")
    return (
      <fieldset className="ability-choice">
        <legend>{instruction.text}</legend>
        <button onClick={() => onChange({ accepted: true })}>
          {instruction.kind === "payment" ? "Paid at Table" : "Yes"}
        </button>
        {instruction.kind === "optional" && (
          <button onClick={() => onChange({ accepted: false })}>No</button>
        )}
      </fieldset>
    );
  if (instruction.kind === "modes")
    return (
      <fieldset className="ability-choice">
        <legend>Choose {instruction.count}</legend>
        {instruction.modes.map((mode, index) => (
          <label className="inline-check" key={index}>
            <input
              type="checkbox"
              checked={draft.modes?.includes(index) ?? false}
              onChange={(event) =>
                setDraft({
                  modes: event.target.checked
                    ? [...(draft.modes ?? []), index]
                    : draft.modes?.filter((value) => value !== index),
                })
              }
            />
            {mode.text}
          </label>
        ))}
        <button
          disabled={draft.modes?.length !== instruction.count}
          onClick={() => onChange(draft)}
        >
          Use Modes
        </button>
      </fieldset>
    );
  if (instruction.kind !== "event") return null;
  return (
    <fieldset className="ability-choice">
      <legend>{instruction.text}</legend>
      <p className="muted">{requirement.reason}</p>
      {!instruction.draft.counterType &&
        /counter/.test(instruction.draft.eventCategory ?? "") && (
          <label>
            Counter type
            <select
              value={draft.counterType ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, counterType: event.target.value })
              }
            >
              <option value="">Select counter</option>
              {COUNTER_OPTIONS.map((counter) => (
                <option key={counter}>{counter}</option>
              ))}
            </select>
          </label>
        )}
      {!instruction.selector?.source &&
        !instruction.selector?.all &&
        candidates.map((group) => (
          <label className="ability-target" key={group.id}>
            <input
              type="checkbox"
              checked={draft.ids?.includes(group.id) ?? false}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  ids: event.target.checked
                    ? [...(draft.ids ?? []), group.id]
                    : draft.ids?.filter((value) => value !== group.id),
                })
              }
            />
            {group.identity?.imageSmall && (
              <img src={group.identity.imageSmall} alt="" />
            )}
            <span>
              {group.label}
              {group.quantity > 1 ? ` (one of ${group.quantity})` : ""}
            </span>
            {instruction.distribution && draft.ids?.includes(group.id) && (
              <input
                type="number"
                min="1"
                max={instruction.distribution}
                aria-label={`Counters for ${group.label}`}
                value={draft.distribution?.[group.id] ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    distribution: {
                      ...draft.distribution,
                      [group.id]: Number(event.target.value),
                    },
                  })
                }
              />
            )}
          </label>
        ))}
      <button onClick={() => onChange(draft)}>Use Selection</button>
      {instruction.selector?.minimum === 0 && (
        <button onClick={() => onChange({ ...choice, ids: [] })}>
          Choose No Targets
        </button>
      )}
      {instruction.selector?.targeting && (
        <details>
          <summary>Untracked target at the table</summary>
          <label>
            Target reference
            <input
              value={external}
              onChange={(event) => setExternal(event.target.value)}
              maxLength={120}
            />
          </label>
          <button
            disabled={!external.trim()}
            onClick={() => onChange({ ...choice, external: external.trim() })}
          >
            Use External Target
          </button>
        </details>
      )}
    </fieldset>
  );
}
