import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { COUNTER_OPTIONS } from "../domain/cards";
import { TOTAL_LABELS } from "../domain/field";
import type {
  CounterApplicationMode,
  ModalState,
  PermanentGroup,
  RelevantTotal,
  StackScope,
} from "../domain/types";
import { useFieldStore } from "../state/useFieldStore";
import { ScryfallSearch } from "./ScryfallSearch";

export function ModalRoot() {
  const modal = useFieldStore((state) => state.modal);
  const closeModal = useFieldStore((state) => state.closeModal);
  const startupVisible = useFieldStore((state) => state.startupVisible);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && modal?.kind !== "startup") closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeModal, modal?.kind]);

  if (!modal) return null;
  const blocking = modal.kind === "startup" && startupVisible;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!blocking && event.target === event.currentTarget) closeModal();
      }}
    >
      <section
        className={
          modal.kind === "managePermanent"
            ? "modal-sheet bottom-sheet"
            : "modal-sheet"
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {!blocking && (
          <button
            type="button"
            className="modal-close"
            onClick={closeModal}
            aria-label="Close"
          >
            <X />
          </button>
        )}
        <ModalContent modal={modal} />
      </section>
    </div>
  );
}

function ModalContent({ modal }: { modal: ModalState }) {
  switch (modal.kind) {
    case "startup":
      return <StartupWarning />;
    case "add":
      return <AddSheet />;
    case "preview":
      return <PreviewSheet groupId={modal.groupId} />;
    case "life":
      return <LifeExactSheet />;
    case "playerCounters":
      return <PlayerCountersSheet />;
    case "managePermanent":
      return <ManagePermanentSheet groupId={modal.groupId} />;
    case "removeStack":
      return <RemoveStackSheet groupId={modal.groupId} />;
    case "replaceGeneric":
      return <ReplaceGenericSheet groupId={modal.groupId} />;
    case "transformAll":
      return <TransformAllSheet />;
    case "summary":
      return <SummarySheet />;
    case "details":
      return <DetailsSheet />;
    case "settings":
      return <SettingsSheet />;
    case "exactTotal":
      return (
        <ExactTotalSheet
          total={(modal.payload as { total: RelevantTotal }).total}
        />
      );
    default:
      return <p>Unsupported sheet.</p>;
  }
}

function StartupWarning() {
  const acknowledgeStartup = useFieldStore((state) => state.acknowledgeStartup);
  const openModal = useFieldStore((state) => state.openModal);
  const [learn, setLearn] = useState(false);

  return (
    <div className="startup-warning">
      <h2 id="modal-title">Only add cards whose abilities should be tracked</h2>
      {!learn ? (
        <>
          <p>
            Cards added through Scryfall are treated as active tracked
            permanents. Their supported triggered, replacement, and static
            effects can participate in field activation and automatic background
            event resolution.
          </p>
          <p>
            Do not add creatures or permanents whose abilities are irrelevant or
            should not be active. Represent those permanents with generic
            placeholders instead.
          </p>
          <p>
            Generic placeholders can receive counters, have power and toughness,
            be tapped, transformed, counted by scaling effects, and later be
            replaced with actual cards. They do not contribute card abilities
            until replaced.
          </p>
        </>
      ) : (
        <div className="learn-copy">
          <p>
            Baord State Lite resolves only modeled interactions. Activate Field
            assumes supported initiating conditions happened once, then resolves
            supported replacement effects, tokens, counters, life changes, and
            chained triggers.
          </p>
          <p>
            Unsupported cards remain useful for quantities, counters,
            power/toughness, depower, transformation, and manual custom effects,
            but their Oracle text is never guessed.
          </p>
        </div>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="primary-action"
          onClick={acknowledgeStartup}
        >
          Continue to Field
        </button>
        <button
          type="button"
          onClick={() => {
            acknowledgeStartup();
            openModal({ kind: "add", payload: { tab: "generic" } });
          }}
        >
          Add Generic Placeholder
        </button>
        <button type="button" onClick={() => setLearn((value) => !value)}>
          Learn How Tracking Works
        </button>
      </div>
    </div>
  );
}

function AddSheet() {
  const addCard = useFieldStore((state) => state.addCard);
  const addGeneric = useFieldStore((state) => state.addGeneric);
  const closeModal = useFieldStore((state) => state.closeModal);
  const [tab, setTab] = useState<"card" | "generic">("card");
  const [genericKind, setGenericKind] =
    useState<Parameters<typeof addGeneric>[0]["kind"]>("Creature");
  const [quantity, setQuantity] = useState(1);
  const [label, setLabel] = useState("");
  const [power, setPower] = useState(1);
  const [toughness, setToughness] = useState(1);

  return (
    <div>
      <h2 id="modal-title">Add to Field</h2>
      <div className="segmented">
        <button
          type="button"
          className={tab === "card" ? "selected" : ""}
          onClick={() => setTab("card")}
        >
          Scryfall Card
        </button>
        <button
          type="button"
          className={tab === "generic" ? "selected" : ""}
          onClick={() => setTab("generic")}
        >
          Generic Placeholder
        </button>
      </div>
      {tab === "card" ? (
        <ScryfallSearch
          label="Search card to track"
          actionLabel="Add Tracked Card"
          onConfirm={(card) => {
            addCard(card);
            closeModal();
          }}
        />
      ) : (
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            addGeneric({
              kind: genericKind,
              label: label.trim() || undefined,
              quantity,
              power: ["Creature", "Token"].includes(genericKind) ? power : null,
              toughness: ["Creature", "Token"].includes(genericKind)
                ? toughness
                : null,
              token: genericKind === "Token",
            });
            closeModal();
          }}
        >
          <label>
            Type
            <select
              value={genericKind}
              onChange={(event) =>
                setGenericKind(event.target.value as typeof genericKind)
              }
            >
              {[
                "Creature",
                "Artifact",
                "Equipment",
                "Enchantment",
                "Land",
                "Token",
                "Noncreature permanent",
                "Custom",
              ].map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <label>
            Label
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={`Generic ${genericKind}`}
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <label>
            Power
            <input
              type="number"
              value={power}
              onChange={(event) => setPower(Number(event.target.value))}
            />
          </label>
          <label>
            Toughness
            <input
              type="number"
              value={toughness}
              onChange={(event) => setToughness(Number(event.target.value))}
            />
          </label>
          <button type="submit" className="primary-action">
            Add Placeholder
          </button>
        </form>
      )}
    </div>
  );
}

function PreviewSheet({ groupId }: { groupId?: string }) {
  const group = useGroup(groupId);
  if (!group) return <p>Permanent not found.</p>;
  return (
    <div className="preview-sheet">
      <h2 id="modal-title">{group.label}</h2>
      {group.identity?.imageUrl ? (
        <img
          className="preview-card-image"
          src={group.identity.imageUrl}
          alt={`${group.label} card`}
        />
      ) : (
        <div className="generic-silhouette large-placeholder">
          Generic placeholder
        </div>
      )}
      <p>
        {group.identity?.typeLine ?? group.characteristics.cardTypes.join(" ")}
      </p>
      <p className="oracle-text">
        {group.identity?.oracleText ??
          "Generic placeholders have no card abilities."}
      </p>
      <p>
        Quantity {group.quantity} • Support{" "}
        {group.identity?.supportStatus ?? "none"}
      </p>
    </div>
  );
}

function LifeExactSheet() {
  const life = useFieldStore((state) => state.field.player.life);
  const setLifeExact = useFieldStore((state) => state.setLifeExact);
  const closeModal = useFieldStore((state) => state.closeModal);
  const [value, setValue] = useState(life);
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        setLifeExact(value);
        closeModal();
      }}
    >
      <h2 id="modal-title">Set Life Total</h2>
      <label>
        Exact life
        <input
          type="number"
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      </label>
      <button type="submit" className="primary-action">
        Save
      </button>
    </form>
  );
}

function PlayerCountersSheet() {
  const counters = useFieldStore((state) => state.field.player.counters);
  const setPlayerCounter = useFieldStore((state) => state.setPlayerCounter);
  const keys = [
    "poison",
    "energy",
    "experience",
    "rad",
    "commanderDamage",
  ] as const;
  return (
    <div>
      <h2 id="modal-title">Player Counters</h2>
      <div className="counter-editor-grid">
        {keys.map((key) => (
          <label key={key}>
            {key}
            <input
              type="number"
              min={0}
              value={counters[key]}
              onChange={(event) =>
                setPlayerCounter(key, Number(event.target.value))
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ManagePermanentSheet({ groupId }: { groupId?: string }) {
  const group = useGroup(groupId);
  const applyCounters = useFieldStore((state) => state.applyCounters);
  const toggleStatus = useFieldStore((state) => state.toggleStatus);
  const setDepowerMode = useFieldStore((state) => state.setDepowerMode);
  const setBasePowerToughness = useFieldStore(
    (state) => state.setBasePowerToughness,
  );
  const removeGroup = useFieldStore((state) => state.removeGroup);
  const closeModal = useFieldStore((state) => state.closeModal);
  const [counter, setCounter] = useState("+1/+1");
  const [amount, setAmount] = useState(1);
  const [scope, setScope] = useState<StackScope>("all");
  const [customQuantity, setCustomQuantity] = useState(1);
  const [mode, setMode] = useState<CounterApplicationMode>("game-action");
  const [power, setPower] = useState(group?.pt.basePower ?? 1);
  const [toughness, setToughness] = useState(group?.pt.baseToughness ?? 1);

  if (!group) return <p>Permanent not found.</p>;
  return (
    <div>
      <h2 id="modal-title">{group.label}</h2>
      <div className="sheet-columns">
        <section>
          <h3>Counters</h3>
          <label>
            Counter
            <select
              value={counter}
              onChange={(event) => setCounter(event.target.value)}
            >
              {COUNTER_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
          </label>
          <label>
            Scope
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as StackScope)}
            >
              <option value="one">Apply to one</option>
              <option value="custom">Apply to custom quantity</option>
              <option value="all">Apply to entire stack</option>
            </select>
          </label>
          {scope === "custom" && (
            <label>
              Custom quantity
              <input
                type="number"
                min={1}
                max={group.quantity}
                value={customQuantity}
                onChange={(event) =>
                  setCustomQuantity(Number(event.target.value))
                }
              />
            </label>
          )}
          <label>
            Apply as
            <select
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as CounterApplicationMode)
              }
            >
              <option value="game-action">Game action</option>
              <option value="correction">Correction only</option>
            </select>
          </label>
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              applyCounters(
                group.id,
                counter,
                amount,
                scope,
                customQuantity,
                mode,
              );
              closeModal();
            }}
          >
            Apply Counters
          </button>
        </section>
        <section>
          <h3>Statuses</h3>
          <div className="status-grid">
            {(
              [
                "tapped",
                "attacking",
                "blocking",
                "summoningSick",
                "phasedOut",
                "transformed",
                "faceDown",
                "exerted",
              ] as const
            ).map((status) => (
              <button
                type="button"
                key={status}
                className={group.statuses[status] ? "selected" : ""}
                onClick={() => toggleStatus(group.id, status)}
              >
                {status}
              </button>
            ))}
          </div>
          <h3>Depower</h3>
          <div className="segmented wrap">
            {[
              ["none", "Restore"],
              ["all", "Disable all"],
              ["triggered", "Triggered only"],
              ["selected", "Selected abilities"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={group.depowerMode === value ? "selected" : ""}
                onClick={() =>
                  setDepowerMode(group.id, value as typeof group.depowerMode)
                }
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Base Power/Toughness</h3>
          <label>
            Base power
            <input
              type="number"
              value={power}
              onChange={(event) => setPower(Number(event.target.value))}
            />
          </label>
          <label>
            Base toughness
            <input
              type="number"
              value={toughness}
              onChange={(event) => setToughness(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setBasePowerToughness(group.id, power, toughness);
              closeModal();
            }}
          >
            Save Base Stats
          </button>
          <button
            type="button"
            onClick={() => {
              setBasePowerToughness(
                group.id,
                group.pt.printedPower,
                group.pt.printedToughness,
              );
              closeModal();
            }}
          >
            Restore Printed Values
          </button>
          <button
            type="button"
            className="danger-action"
            onClick={() => {
              removeGroup(group.id, 1);
              closeModal();
            }}
          >
            Remove One Neutrally
          </button>
        </section>
      </div>
    </div>
  );
}

function RemoveStackSheet({ groupId }: { groupId?: string }) {
  const group = useGroup(groupId);
  const removeGroup = useFieldStore((state) => state.removeGroup);
  const closeModal = useFieldStore((state) => state.closeModal);
  const [quantity, setQuantity] = useState(1);
  if (!group) return <p>Permanent not found.</p>;
  return (
    <div>
      <h2 id="modal-title">Remove from Stack</h2>
      <p>
        {group.label} currently has quantity {group.quantity}. Neutral removal
        will not count as dying, sacrifice, destruction, exile, return to hand,
        or library movement.
      </p>
      <label>
        Remove custom number
        <input
          type="number"
          min={1}
          max={group.quantity}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
      </label>
      <div className="modal-actions">
        <button
          type="button"
          className="primary-action"
          onClick={() => {
            removeGroup(group.id, quantity);
            closeModal();
          }}
        >
          Remove Custom Number
        </button>
        <button
          type="button"
          className="danger-action"
          onClick={() => {
            removeGroup(group.id, group.quantity);
            closeModal();
          }}
        >
          Remove All
        </button>
        <button type="button" onClick={closeModal}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReplaceGenericSheet({ groupId }: { groupId?: string }) {
  const replaceGeneric = useFieldStore((state) => state.replaceGeneric);
  const closeModal = useFieldStore((state) => state.closeModal);
  const group = useGroup(groupId);
  const [scope, setScope] = useState<StackScope>("all");
  const [customQuantity, setCustomQuantity] = useState(1);
  if (!groupId || !group) return <p>Generic placeholder not found.</p>;
  return (
    <div>
      <h2 id="modal-title">Identify Placeholder</h2>
      {group.quantity > 1 && (
        <div className="segmented wrap">
          {[
            ["one", "One"],
            ["custom", "Custom number"],
            ["all", "Entire stack"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={scope === value ? "selected" : ""}
              onClick={() => setScope(value as StackScope)}
            >
              {label}
            </button>
          ))}
          {scope === "custom" && (
            <input
              type="number"
              min={1}
              max={group.quantity}
              value={customQuantity}
              onChange={(event) =>
                setCustomQuantity(Number(event.target.value))
              }
            />
          )}
        </div>
      )}
      <ScryfallSearch
        label="Search replacement identity"
        actionLabel="Replace Placeholder"
        onConfirm={(card) => {
          replaceGeneric(groupId, card, scope, customQuantity);
          closeModal();
        }}
      />
    </div>
  );
}

function TransformAllSheet() {
  const transformCreatures = useFieldStore((state) => state.transformCreatures);
  const restoreTransformations = useFieldStore(
    (state) => state.restoreTransformations,
  );
  const closeModal = useFieldStore((state) => state.closeModal);
  const [scope, setScope] = useState<
    "all" | "nontoken" | "tokens" | "selected"
  >("all");
  const [restoreAbilities, setRestoreAbilities] = useState(false);
  return (
    <div>
      <h2 id="modal-title">Transform All Creatures</h2>
      <div className="segmented wrap">
        {[
          ["all", "All creatures"],
          ["nontoken", "Nontoken creatures"],
          ["tokens", "Creature tokens"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={scope === value ? "selected" : ""}
            onClick={() => setScope(value as typeof scope)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={restoreAbilities}
          onChange={(event) => setRestoreAbilities(event.target.checked)}
        />
        Restore abilities on transformed creatures
      </label>
      <ScryfallSearch
        label="Search transformation target"
        actionLabel="Transform All"
        onConfirm={(card) => {
          transformCreatures(card, scope, [], restoreAbilities);
          closeModal();
        }}
      />
      <button
        type="button"
        onClick={() => {
          restoreTransformations();
          closeModal();
        }}
      >
        Restore All Transformed Creatures
      </button>
    </div>
  );
}

function SummarySheet() {
  const result = useFieldStore((state) => state.lastResult);
  const undo = useFieldStore((state) => state.undo);
  const closeModal = useFieldStore((state) => state.closeModal);
  const openModal = useFieldStore((state) => state.openModal);
  if (!result) return <p>No recent resolution.</p>;
  return (
    <div>
      <h2 id="modal-title">{result.title}</h2>
      <ul className="summary-list">
        {result.summary.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
      {result.loopDetected && (
        <div className="warning-block">
          <strong>Repeating interaction detected</strong>
          <p>
            Resolve X iterations, stop here, mark as infinite, or cancel
            activation from the detailed resolver.
          </p>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" onClick={() => openModal({ kind: "details" })}>
          View Details
        </button>
        <button type="button" onClick={undo}>
          Undo
        </button>
        <button type="button" className="primary-action" onClick={closeModal}>
          Close
        </button>
      </div>
    </div>
  );
}

function DetailsSheet() {
  const result = useFieldStore((state) => state.lastResult);
  if (!result) return <p>No recent resolution details.</p>;
  return (
    <div>
      <h2 id="modal-title">Resolution Details</h2>
      <ol className="details-list">
        {result.details.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.label}</strong>
            <span>{entry.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SettingsSheet() {
  const field = useFieldStore((state) => state.field);
  const updateSettings = useFieldStore((state) => state.updateSettings);
  const resetField = useFieldStore((state) => state.resetField);
  const exportField = useFieldStore((state) => state.exportField);
  const importField = useFieldStore((state) => state.importField);
  const [importText, setImportText] = useState("");
  const [exportText, setExportText] = useState("");
  return (
    <div>
      <h2 id="modal-title">Settings</h2>
      <div className="sheet-columns">
        <section>
          <h3>Field</h3>
          <label>
            Card size
            <select
              value={field.settings.cardSize}
              onChange={(event) =>
                updateSettings({
                  cardSize: event.target
                    .value as typeof field.settings.cardSize,
                })
              }
            >
              <option value="compact">Compact</option>
              <option value="standard">Standard</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label>
            Tapped-card style
            <select
              value={field.settings.tappedStyle}
              onChange={(event) =>
                updateSettings({
                  tappedStyle: event.target
                    .value as typeof field.settings.tappedStyle,
                })
              }
            >
              <option value="rotate">Rotate</option>
              <option value="badge">Badge</option>
            </select>
          </label>
          <label>
            Optional effects
            <select
              value={field.settings.optionalEffects}
              onChange={(event) =>
                updateSettings({
                  optionalEffects: event.target
                    .value as typeof field.settings.optionalEffects,
                })
              }
            >
              <option value="always">Always perform</option>
              <option value="never">Never perform</option>
              <option value="ask">Ask when necessary</option>
            </select>
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={field.settings.backgroundWatchers}
              onChange={(event) =>
                updateSettings({ backgroundWatchers: event.target.checked })
              }
            />
            Background watchers
          </label>
        </section>
        <section>
          <h3>Backup</h3>
          <button type="button" onClick={() => setExportText(exportField())}>
            Export JSON Backup
          </button>
          <textarea
            value={exportText}
            readOnly
            rows={5}
            aria-label="Exported field JSON"
          />
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={5}
            placeholder="Paste backup JSON"
            aria-label="Import field JSON"
          />
          <button
            type="button"
            onClick={() => {
              try {
                importField(JSON.parse(importText));
              } catch {
                window.alert("Import failed: invalid JSON.");
              }
            }}
          >
            Import JSON Backup
          </button>
          <button type="button" className="danger-action" onClick={resetField}>
            Reset App Data
          </button>
        </section>
        <section>
          <h3>Scryfall Attribution</h3>
          <p>
            Card names, Oracle text, print data, and images are provided by
            Scryfall. Baord State Lite is unofficial Fan Content and is not
            produced, endorsed, supported, or affiliated with Wizards of the
            Coast.
          </p>
        </section>
      </div>
    </div>
  );
}

function ExactTotalSheet({ total }: { total: RelevantTotal }) {
  const setRelevantTotal = useFieldStore((state) => state.setRelevantTotal);
  const closeModal = useFieldStore((state) => state.closeModal);
  const [value, setValue] = useState(total.value);
  const [mode, setMode] = useState<
    "one-at-a-time" | "simultaneous" | "correction"
  >("correction");
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        setRelevantTotal(total.key, value, mode);
        closeModal();
      }}
    >
      <h2 id="modal-title">{TOTAL_LABELS[total.key]}</h2>
      <label>
        Exact value
        <input
          type="number"
          min={0}
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      </label>
      <label>
        Apply as
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          <option value="correction">Correction only</option>
          <option value="one-at-a-time">Game action: one at a time</option>
          <option value="simultaneous">Game action: simultaneous</option>
        </select>
      </label>
      <button type="submit" className="primary-action">
        Apply
      </button>
    </form>
  );
}

function useGroup(groupId?: string): PermanentGroup | null {
  return useFieldStore(
    (state) => state.field.groups.find((group) => group.id === groupId) ?? null,
  );
}
