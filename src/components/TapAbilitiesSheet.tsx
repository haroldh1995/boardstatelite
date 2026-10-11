import { availablePermanentActions } from "../domain/availableActions";
import { useFieldStore } from "../state/useFieldStore";
export function TapAbilitiesSheet({ groupId }: { groupId?: string }) {
  const group = useFieldStore((state) =>
    state.field.groups.find((entry) => entry.id === groupId),
  );
  const record = useFieldStore((state) => state.recordTapAbility);
  if (!group) return <p>Permanent no longer present.</p>;
  const actions = availablePermanentActions(group);
  return (
    <div>
      <h2 id="modal-title">{group.label}</h2>
      <h3>Tap Abilities</h3>
      {group.statuses.summoningSick && <p>Possible summoning restriction</p>}
      {actions.map((action) => (
        <div className="tap-ability-choice" key={action.id}>
          <p>{action.label}</p>
          {action.manualResolution && (
            <p className="muted">
              Resolve additional costs, choices and effects at the table.
            </p>
          )}
          <button
            type="button"
            className="primary-action"
            onClick={() => record(group.id, action.id)}
          >
            Record Activation
          </button>
        </div>
      ))}
      {!actions.length && <p>No untapped tracked tap abilities.</p>}
    </div>
  );
}
