import {
  ArrowDown,
  ArrowUp,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { makeId } from "../domain/cards";
import {
  BUILTIN_TRACKER_PRESETS,
  defaultPlayerTrackers,
  trackerDefinitions,
} from "../domain/playerTrackers";
import { useFieldStore } from "../state/useFieldStore";

function CustomTrackerName({
  name,
  onRename,
}: {
  name: string;
  onRename: (value: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <input
      aria-label={`Rename ${name}`}
      maxLength={40}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim() || name;
        setDraft(next);
        if (next !== name) onRename(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function PlayerTrackerLayoutSheet() {
  const preferences = useFieldStore(
    (state) => state.field.settings.playerTrackers,
  );
  const updateSettings = useFieldStore((state) => state.updateSettings);
  const [customName, setCustomName] = useState("");
  const [layoutName, setLayoutName] = useState("");
  const definitions = trackerDefinitions(preferences);
  const update = (change: Partial<typeof preferences>) =>
    updateSettings({ playerTrackers: { ...preferences, ...change } });
  const move = (id: string, delta: number) => {
    const visible = [...preferences.visible];
    const from = visible.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= visible.length) return;
    [visible[from], visible[to]] = [visible[to], visible[from]];
    update({ visible });
  };
  return (
    <div className="tracker-layout-sheet">
      <h2 id="modal-title">Life Screen Counters</h2>
      <label>
        Layout
        <select
          aria-label="Choose counter layout"
          value=""
          onChange={(event) => {
            const preset = [
              ...BUILTIN_TRACKER_PRESETS,
              ...preferences.presets,
            ].find((entry) => entry.id === event.target.value);
            if (preset) update({ visible: [...preset.trackers] });
          }}
        >
          <option value="">Choose a layout</option>
          {[...BUILTIN_TRACKER_PRESETS, ...preferences.presets].map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <ol className="tracker-order-list">
        {preferences.visible.map((id, index) => {
          const tracker = definitions.find((entry) => entry.id === id);
          if (!tracker) return null;
          return (
            <li key={id}>
              {id.startsWith("custom-") ? (
                <CustomTrackerName
                  name={tracker.name}
                  onRename={(name) =>
                    update({
                      custom: preferences.custom.map((entry) =>
                        entry.id === id ? { ...entry, name } : entry,
                      ),
                    })
                  }
                />
              ) : (
                <strong>{tracker.name}</strong>
              )}
              <button
                className="icon-button"
                title={`Move ${tracker.name} up`}
                aria-label={`Move ${tracker.name} up`}
                disabled={index === 0}
                onClick={() => move(id, -1)}
              >
                <ArrowUp />
              </button>
              <button
                className="icon-button"
                title={`Move ${tracker.name} down`}
                aria-label={`Move ${tracker.name} down`}
                disabled={index === preferences.visible.length - 1}
                onClick={() => move(id, 1)}
              >
                <ArrowDown />
              </button>
              <button
                className="icon-button"
                title={`Hide ${tracker.name}`}
                aria-label={`Hide ${tracker.name}`}
                onClick={() =>
                  update({
                    visible: preferences.visible.filter(
                      (entry) => entry !== id,
                    ),
                  })
                }
              >
                <Trash2 />
              </button>
            </li>
          );
        })}
      </ol>
      <label>
        Add Counter
        <select
          aria-label="Add counter tracker"
          value=""
          onChange={(event) => {
            if (event.target.value)
              update({ visible: [...preferences.visible, event.target.value] });
          }}
        >
          <option value="">Select counter</option>
          {definitions
            .filter((entry) => !preferences.visible.includes(entry.id))
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
        </select>
      </label>
      <form
        className="tracker-save-row"
        onSubmit={(event) => {
          event.preventDefault();
          const name = customName.trim();
          if (!name || preferences.custom.length >= 32) return;
          const id = makeId("custom");
          update({
            custom: [...preferences.custom, { id, name }],
            visible: [...preferences.visible, id],
          });
          setCustomName("");
        }}
      >
        <label>
          Custom Counter
          <input
            aria-label="Custom counter name"
            maxLength={40}
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!customName.trim() || preferences.custom.length >= 32}
          aria-label="Add custom counter"
          title="Add custom counter"
        >
          <Plus />
        </button>
      </form>
      <form
        className="tracker-save-row"
        onSubmit={(event) => {
          event.preventDefault();
          const name = layoutName.trim();
          if (!name || preferences.presets.length >= 12) return;
          update({
            presets: [
              ...preferences.presets.filter((entry) => entry.name !== name),
              {
                id: makeId("layout"),
                name,
                trackers: [...preferences.visible],
              },
            ],
          });
          setLayoutName("");
        }}
      >
        <label>
          Save Layout
          <input
            aria-label="Layout name"
            maxLength={40}
            value={layoutName}
            onChange={(event) => setLayoutName(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!layoutName.trim() || preferences.presets.length >= 12}
          title="Save Layout"
          aria-label="Save Layout"
        >
          <Save />
        </button>
      </form>
      {preferences.presets.length > 0 && (
        <details>
          <summary>Saved Layouts</summary>
          {preferences.presets.map((entry) => (
            <div className="tracker-saved-row" key={entry.id}>
              <button onClick={() => update({ visible: [...entry.trackers] })}>
                {entry.name}
              </button>
              <button
                className="icon-button"
                aria-label={`Delete layout ${entry.name}`}
                onClick={() =>
                  update({
                    presets: preferences.presets.filter(
                      (preset) => preset.id !== entry.id,
                    ),
                  })
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </details>
      )}
      <button
        className="quiet-action"
        onClick={() => update({ visible: defaultPlayerTrackers().visible })}
      >
        <RotateCcw /> Restore Default Layout
      </button>
    </div>
  );
}
