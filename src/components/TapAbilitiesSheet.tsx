import { abilityAvailability, cardAbilities } from "../domain/abilityMetadata";
import { useFieldStore } from "../state/useFieldStore";

export function TapAbilitiesSheet({ groupId }: { groupId?: string }) {
  const field = useFieldStore((state) => state.field);
  const begin = useFieldStore((state) => state.beginAbility);
  const correct = useFieldStore((state) => state.correctAbilityUsage);
  const group = field.groups.find((entry) => entry.id === groupId);
  if (!group) return <p>Permanent no longer present.</p>;
  const actions = cardAbilities(group, field).filter(
    (ability) => ability.kind === "activated",
  );
  return (
    <div className="ability-sheet">
      <h2 id="modal-title">{group.label}</h2>
      {group.identity?.imageSmall && (
        <img
          className="ability-card-thumbnail"
          src={group.identity.imageSmall}
          alt={group.label}
        />
      )}
      <h3>Activated Abilities</h3>
      {actions.map((action) => {
        const state = abilityAvailability(field, group, action);
        return (
          <section className="ability-choice" key={action.id}>
            <p className="oracle-ability">{action.text}</p>
            <small>Cost: {action.cost}</small>
            {[...state.reasons, ...state.advisories].map((reason) => (
              <p className="muted" key={reason}>
                {reason}
              </p>
            ))}
            <button
              className="primary-action"
              onClick={() => begin(group.id, action.id)}
            >
              {state.available ? "Activate" : "Record Physical Activation"}
            </button>
            {state.reasons.some((reason) => reason.startsWith("Recorded")) && (
              <button onClick={() => correct(group.id, action.id)}>
                Correct Recorded Use
              </button>
            )}
          </section>
        );
      })}
      {!actions.length && <p>No tracked activated abilities on this face.</p>}
    </div>
  );
}

export function FieldAbilitiesSheet() {
  const field = useFieldStore((state) => state.field);
  const begin = useFieldStore((state) => state.beginAbility);
  const legacy = useFieldStore((state) => state.activateField);
  const triggers = field.groups.flatMap((group) =>
    cardAbilities(group)
      .filter((ability) => ability.kind === "triggered")
      .map((ability) => ({ group, ability })),
  );
  return (
    <div className="ability-sheet">
      <h2 id="modal-title">Activate Field</h2>
      {triggers.map(({ group, ability }) => (
        <section className="ability-choice" key={`${group.id}:${ability.id}`}>
          <h3>{group.label}</h3>
          <p>{ability.text}</p>
          <button
            className="primary-action"
            onClick={() => begin(group.id, ability.id)}
          >
            Trigger Occurred
          </button>
        </section>
      ))}
      {!triggers.length && <p>No tracked triggered abilities.</p>}
      {field.customEffects.some(
        (effect) => effect.enabled && effect.trigger === "activate-field",
      ) && (
        <button onClick={() => legacy(true)}>Apply Custom Field Effects</button>
      )}
    </div>
  );
}
