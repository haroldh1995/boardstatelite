import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  ClipboardList,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  PRE_TURN_PLANNER_ACTION_TYPES,
  actionTypeLabel,
  createActionStripPlan,
  sortPlannedActions,
} from "../echo/preTurnPlanner";
import type {
  PlannedAction,
  PlannedActionInput,
  PreTurnPlannerActionType,
} from "../echo/preTurnPlannerTypes";
import { useFieldStore } from "../state/useFieldStore";

const DEFAULT_TYPE: PreTurnPlannerActionType = "land-play";

interface PlannerFormState {
  type: PreTurnPlannerActionType;
  title: string;
  relatedGroupId: string;
  relatedPlayer: "you" | "opponent" | "";
  dependencyId: string;
  notes: string;
  reminder: string;
  landPrimary: string;
  landAlternatives: string;
  landCondition: string;
  landHeld: boolean;
  fetchTarget: string;
  manaGeneric: number;
  manaWhite: number;
  manaBlue: number;
  manaBlack: number;
  manaRed: number;
  manaGreen: number;
  manaColorless: number;
  manaNotes: string;
}

export function PreTurnPlannerSheet() {
  const field = useFieldStore((state) => state.field);
  const addAction = useFieldStore((state) => state.plannerAddAction);
  const updateAction = useFieldStore((state) => state.plannerUpdateAction);
  const removeAction = useFieldStore((state) => state.plannerRemoveAction);
  const reorderAction = useFieldStore((state) => state.plannerReorderAction);
  const setActionStatus = useFieldStore(
    (state) => state.plannerSetActionStatus,
  );
  const clearCompleted = useFieldStore((state) => state.plannerClearCompleted);
  const clearAll = useFieldStore((state) => state.plannerClearAll);
  const resetPlanner = useFieldStore((state) => state.plannerReset);
  const setCollapsed = useFieldStore((state) => state.plannerSetGroupCollapsed);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlannerFormState>(createEmptyForm());

  const planner = field.preTurnPlanner;
  const battlefieldOptions = useMemo(
    () =>
      field.groups
        .filter((group) => group.zone === "battlefield")
        .sort((a, b) => a.order - b.order),
    [field.groups],
  );
  const actionStrip = useMemo(
    () => createActionStripPlan(planner).items,
    [planner],
  );
  const sections = useMemo(
    () => groupPlannerActions(planner.actions),
    [planner],
  );
  const readOnly = planner.lifecycle.readOnly;
  const statusCopy =
    planner.lifecycle.availability === "primary"
      ? "Pre-turn preparation"
      : planner.lifecycle.availability === "available"
        ? "Available during opponents' turns"
        : planner.lifecycle.availability === "read-only"
          ? "Read-only during active turn"
          : planner.lifecycle.availability === "minimized"
            ? "Minimized during combat"
            : planner.lifecycle.availability === "recovery"
              ? "Recovery mode"
              : "Temporarily unavailable";

  function updateForm(update: Partial<PlannerFormState>) {
    setForm((current) => ({ ...current, ...update }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = formToInput(form);
    if (editingId) {
      updateAction(editingId, input);
      setEditingId(null);
    } else {
      addAction(input);
    }
    setForm(createEmptyForm());
  }

  function startEdit(action: PlannedAction) {
    setEditingId(action.id);
    setForm(actionToForm(action));
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(createEmptyForm());
  }

  return (
    <div className="planner-sheet">
      <div className="planner-header">
        <span className="planner-icon" aria-hidden="true">
          <ClipboardList />
        </span>
        <div>
          <h2 id="modal-title">One-Minute Pre-Turn Planner</h2>
          <p>{statusCopy}</p>
        </div>
      </div>
      <div className="planner-summary" role="status" aria-live="polite">
        <span>
          {
            planner.actions.filter((action) => action.status === "planned")
              .length
          }{" "}
          active
        </span>
        <span>{actionStrip.length} prepared for future action strip</span>
        <span>{planner.status}</span>
      </div>
      {readOnly && (
        <p className="planner-readonly">
          The planner is preserved for reference in this mode. Return to
          pre-turn preparation to edit it.
        </p>
      )}
      <form className="planner-form" onSubmit={submit}>
        <label>
          Action type
          <select
            value={form.type}
            disabled={readOnly}
            onChange={(event) =>
              updateForm({
                type: event.target.value as PreTurnPlannerActionType,
              })
            }
          >
            {PRE_TURN_PLANNER_ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {actionTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Plan title
          <input
            value={form.title}
            disabled={readOnly}
            onChange={(event) => updateForm({ title: event.target.value })}
            placeholder={actionTypeLabel(form.type)}
          />
        </label>
        <label>
          Related permanent
          <select
            value={form.relatedGroupId}
            disabled={readOnly}
            onChange={(event) =>
              updateForm({ relatedGroupId: event.target.value })
            }
          >
            <option value="">None</option>
            {battlefieldOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Related player
          <select
            value={form.relatedPlayer}
            disabled={readOnly}
            onChange={(event) =>
              updateForm({
                relatedPlayer: event.target
                  .value as PlannerFormState["relatedPlayer"],
              })
            }
          >
            <option value="">None</option>
            <option value="you">You</option>
            <option value="opponent">Opponent</option>
          </select>
        </label>
        <label>
          Depends on
          <select
            value={form.dependencyId}
            disabled={readOnly}
            onChange={(event) =>
              updateForm({ dependencyId: event.target.value })
            }
          >
            <option value="">No dependency</option>
            {planner.actions
              .filter((action) => action.id !== editingId)
              .map((action) => (
                <option key={action.id} value={action.id}>
                  {action.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Reminder
          <input
            value={form.reminder}
            disabled={readOnly}
            onChange={(event) => updateForm({ reminder: event.target.value })}
            placeholder="Hold priority, landfall, upkeep trigger"
          />
        </label>
        {form.type === "land-play" && (
          <fieldset className="planner-fieldset">
            <legend>Land planning</legend>
            <label>
              Land to play
              <input
                value={form.landPrimary}
                disabled={readOnly}
                onChange={(event) =>
                  updateForm({ landPrimary: event.target.value })
                }
              />
            </label>
            <label>
              Alternatives
              <input
                value={form.landAlternatives}
                disabled={readOnly}
                onChange={(event) =>
                  updateForm({ landAlternatives: event.target.value })
                }
                placeholder="Comma-separated choices"
              />
            </label>
            <label>
              Condition
              <input
                value={form.landCondition}
                disabled={readOnly}
                onChange={(event) =>
                  updateForm({ landCondition: event.target.value })
                }
              />
            </label>
            <label>
              Future fetch target
              <input
                value={form.fetchTarget}
                disabled={readOnly}
                onChange={(event) =>
                  updateForm({ fetchTarget: event.target.value })
                }
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={form.landHeld}
                disabled={readOnly}
                onChange={(event) =>
                  updateForm({ landHeld: event.target.checked })
                }
              />
              Intentionally hold this land
            </label>
          </fieldset>
        )}
        {(form.type === "mana-use" || form.type === "spell-sequence") && (
          <fieldset className="planner-fieldset mana-grid">
            <legend>Estimated mana</legend>
            {[
              ["manaGeneric", "Generic"],
              ["manaWhite", "White"],
              ["manaBlue", "Blue"],
              ["manaBlack", "Black"],
              ["manaRed", "Red"],
              ["manaGreen", "Green"],
              ["manaColorless", "Colorless"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={0}
                  value={Number(form[key as keyof PlannerFormState])}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateForm({ [key]: Number(event.target.value) })
                  }
                />
              </label>
            ))}
            <label className="mana-notes">
              Mana note
              <input
                value={form.manaNotes}
                disabled={readOnly}
                onChange={(event) =>
                  updateForm({ manaNotes: event.target.value })
                }
              />
            </label>
          </fieldset>
        )}
        <label className="planner-notes">
          Notes
          <textarea
            value={form.notes}
            disabled={readOnly}
            rows={3}
            onChange={(event) => updateForm({ notes: event.target.value })}
          />
        </label>
        <div className="planner-form-actions">
          <button type="submit" className="primary-action" disabled={readOnly}>
            {editingId ? "Save Planned Action" : "Add Planned Action"}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>
      <div className="planner-actions-toolbar">
        <button type="button" onClick={clearCompleted} disabled={readOnly}>
          Clear completed
        </button>
        <button type="button" onClick={clearAll} disabled={readOnly}>
          Clear all
        </button>
        <button type="button" onClick={resetPlanner} disabled={readOnly}>
          <RotateCcw />
          Reset
        </button>
      </div>
      <div className="planner-section-list">
        {sections.map(({ key, label, actions }) => (
          <section className="planner-section" key={key}>
            <button
              type="button"
              className="planner-section-heading"
              aria-expanded={!planner.collapsedGroups[key]}
              onClick={() => setCollapsed(key, !planner.collapsedGroups[key])}
            >
              <strong>
                {label} <span>({actions.length})</span>
              </strong>
              {planner.collapsedGroups[key] ? <ChevronDown /> : <ChevronUp />}
            </button>
            {!planner.collapsedGroups[key] && (
              <div className="planned-action-list" role="list">
                {actions.map((action, index) => (
                  <PlannedActionRow
                    key={action.id}
                    action={action}
                    index={index}
                    total={actions.length}
                    actions={planner.actions}
                    readOnly={readOnly}
                    onEdit={startEdit}
                    onRemove={removeAction}
                    onMove={reorderAction}
                    onStatus={setActionStatus}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
        {planner.actions.length === 0 && (
          <p className="empty-section">No planned turn actions yet.</p>
        )}
      </div>
    </div>
  );
}

function PlannedActionRow({
  action,
  index,
  total,
  actions,
  readOnly,
  onEdit,
  onRemove,
  onMove,
  onStatus,
}: {
  action: PlannedAction;
  index: number;
  total: number;
  actions: PlannedAction[];
  readOnly: boolean;
  onEdit: (action: PlannedAction) => void;
  onRemove: (actionId: string) => void;
  onMove: (actionId: string, direction: -1 | 1) => void;
  onStatus: (actionId: string, status: PlannedAction["status"]) => void;
}) {
  const dependencyLabels = action.dependencyIds
    .map((id) => actions.find((entry) => entry.id === id)?.title)
    .filter(Boolean);
  return (
    <article
      className={`planned-action planned-action-${action.status}`}
      role="listitem"
      aria-label={`${action.title}, ${action.status}`}
    >
      <div className="planned-order">{index + 1}</div>
      <div className="planned-action-copy">
        <strong>{action.title}</strong>
        <span>{actionTypeLabel(action.type)}</span>
        {action.notes && <p>{action.notes}</p>}
        {action.reminders.length > 0 && (
          <p className="planned-reminder">
            Reminder: {action.reminders.join("; ")}
          </p>
        )}
        {dependencyLabels.length > 0 && (
          <p className="planned-dependency">
            Depends on: {dependencyLabels.join(", ")}
          </p>
        )}
      </div>
      <div className="planned-action-controls">
        <button
          type="button"
          aria-label={`Move ${action.title} earlier`}
          disabled={readOnly || index === 0}
          onClick={() => onMove(action.id, -1)}
        >
          <ArrowUp />
        </button>
        <button
          type="button"
          aria-label={`Move ${action.title} later`}
          disabled={readOnly || index === total - 1}
          onClick={() => onMove(action.id, 1)}
        >
          <ArrowDown />
        </button>
        <button
          type="button"
          aria-label={`Edit ${action.title}`}
          disabled={readOnly}
          onClick={() => onEdit(action)}
        >
          <Pencil />
        </button>
        <button
          type="button"
          aria-label={`Mark ${action.title} complete`}
          disabled={readOnly}
          onClick={() => onStatus(action.id, "completed")}
        >
          <CheckCircle2 />
        </button>
        <button
          type="button"
          aria-label={`Skip ${action.title}`}
          disabled={readOnly}
          onClick={() => onStatus(action.id, "skipped")}
        >
          <CircleSlash />
        </button>
        <button
          type="button"
          aria-label={`Remove ${action.title}`}
          disabled={readOnly}
          onClick={() => onRemove(action.id)}
        >
          <Trash2 />
        </button>
      </div>
    </article>
  );
}

function groupPlannerActions(actions: PlannedAction[]): Array<{
  key: PreTurnPlannerActionType | "completed";
  label: string;
  actions: PlannedAction[];
}> {
  const sorted = sortPlannedActions(actions);
  const groups: Array<{
    key: PreTurnPlannerActionType | "completed";
    label: string;
    actions: PlannedAction[];
  }> = PRE_TURN_PLANNER_ACTION_TYPES.map((type) => ({
    key: type,
    label: actionTypeLabel(type),
    actions: sorted.filter(
      (action) => action.type === type && action.status === "planned",
    ),
  })).filter((group) => group.actions.length > 0);
  const completed = sorted.filter((action) => action.status !== "planned");
  if (completed.length > 0) {
    groups.push({
      key: "completed",
      label: "Completed, skipped, and cancelled",
      actions: completed,
    });
  }
  return groups;
}

function createEmptyForm(): PlannerFormState {
  return {
    type: DEFAULT_TYPE,
    title: "",
    relatedGroupId: "",
    relatedPlayer: "you",
    dependencyId: "",
    notes: "",
    reminder: "",
    landPrimary: "",
    landAlternatives: "",
    landCondition: "",
    landHeld: false,
    fetchTarget: "",
    manaGeneric: 0,
    manaWhite: 0,
    manaBlue: 0,
    manaBlack: 0,
    manaRed: 0,
    manaGreen: 0,
    manaColorless: 0,
    manaNotes: "",
  };
}

function actionToForm(action: PlannedAction): PlannerFormState {
  return {
    type: action.type,
    title: action.title,
    relatedGroupId: action.relatedGroupId ?? "",
    relatedPlayer: action.relatedPlayer ?? "",
    dependencyId: action.dependencyIds[0] ?? "",
    notes: action.notes,
    reminder: action.reminders[0] ?? "",
    landPrimary: action.land?.primary ?? "",
    landAlternatives: action.land?.alternatives.join(", ") ?? "",
    landCondition: action.land?.condition ?? "",
    landHeld: Boolean(action.land?.intentionallyHeld),
    fetchTarget: action.land?.futureFetchTarget ?? "",
    manaGeneric: action.mana?.generic ?? 0,
    manaWhite: action.mana?.white ?? 0,
    manaBlue: action.mana?.blue ?? 0,
    manaBlack: action.mana?.black ?? 0,
    manaRed: action.mana?.red ?? 0,
    manaGreen: action.mana?.green ?? 0,
    manaColorless: action.mana?.colorless ?? 0,
    manaNotes: action.mana?.notes ?? "",
  };
}

function formToInput(form: PlannerFormState): PlannedActionInput {
  const dependencyIds = form.dependencyId ? [form.dependencyId] : [];
  const reminders = form.reminder.trim() ? [form.reminder] : [];
  const land =
    form.type === "land-play"
      ? {
          primary: form.landPrimary,
          alternatives: form.landAlternatives
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
          condition: form.landCondition,
          intentionallyHeld: form.landHeld,
          futureFetchTarget: form.fetchTarget,
        }
      : null;
  const mana =
    form.type === "mana-use" || form.type === "spell-sequence"
      ? {
          generic: form.manaGeneric,
          white: form.manaWhite,
          blue: form.manaBlue,
          black: form.manaBlack,
          red: form.manaRed,
          green: form.manaGreen,
          colorless: form.manaColorless,
          notes: form.manaNotes,
        }
      : null;
  return {
    type: form.type,
    title: form.title,
    relatedGroupId: form.relatedGroupId || null,
    relatedPlayer: form.relatedPlayer || null,
    dependencyIds,
    notes: form.notes,
    reminders,
    land,
    mana,
  };
}
