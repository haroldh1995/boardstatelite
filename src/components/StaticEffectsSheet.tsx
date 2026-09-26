import { Eye, EyeOff, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExternalSourceObject } from "../domain/externalGameState";
import type {
  EffectSourceKind,
  EffectSourceReference,
  ManualEffectModification,
  ManualEffectTarget,
} from "../domain/manualEffects";
import { useFieldStore } from "../state/useFieldStore";

const KEYWORDS = [
  "Flying",
  "Haste",
  "Vigilance",
  "Trample",
  "Deathtouch",
  "Lifelink",
  "Menace",
  "Reach",
  "Indestructible",
];

export function StaticEffectsSheet() {
  const field = useFieldStore((state) => state.field);
  const openModal = useFieldStore((state) => state.openModal);
  const addEffect = useFieldStore((state) => state.addManualStaticEffect);
  const setEnabled = useFieldStore(
    (state) => state.setManualStaticEffectEnabled,
  );
  const removeEffect = useFieldStore((state) => state.removeManualStaticEffect);
  const sources = useMemo(
    () =>
      [...field.groups]
        .filter(
          (group) => group.zone === "battlefield" && Boolean(group.identity),
        )
        .reverse(),
    [field.groups],
  );
  const externalSources = useMemo(
    () => field.externalGameState.sources.filter((source) => source.active),
    [field.externalGameState.sources],
  );
  const creatures = useMemo(
    () =>
      field.groups.filter(
        (group) =>
          group.zone === "battlefield" && group.characteristics.isCreature,
      ),
    [field.groups],
  );
  const [sourceKey, setSourceKey] = useState(
    sources[0] ? `permanent:${sources[0].id}` : "custom",
  );
  const [customSourceLabel, setCustomSourceLabel] = useState(
    "Custom Table Effect",
  );
  const [target, setTarget] = useState<ManualEffectTarget>(
    "controlled-creatures",
  );
  const [targetGroupId, setTargetGroupId] = useState(creatures[0]?.id ?? "");
  const [kind, setKind] =
    useState<ManualEffectModification["kind"]>("power-toughness");
  const [power, setPower] = useState(1);
  const [toughness, setToughness] = useState(1);
  const [keyword, setKeyword] = useState("Flying");
  const [subtype, setSubtype] = useState("Goblin");
  const [duration, setDuration] = useState<
    "while-source-active" | "until-end-of-turn" | "until-removed"
  >("while-source-active");
  const source = resolveSource(
    sourceKey,
    customSourceLabel,
    sources,
    externalSources,
  );
  const validTarget = target !== "selected-creature" || Boolean(targetGroupId);

  return (
    <div className="static-effects-sheet">
      <h2 id="modal-title">Static Effects</h2>
      <section className="effect-builder">
        <h3>Add Effect</h3>
        <label>
          Source
          <select
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
          >
            {sources.length > 0 && (
              <optgroup label="Battlefield">
                {sources.map((group) => (
                  <option key={group.id} value={`permanent:${group.id}`}>
                    {group.label}
                  </option>
                ))}
              </optgroup>
            )}
            {externalSources.length > 0 && (
              <optgroup label="External Game State">
                {externalSources.map((entry) => (
                  <option key={entry.id} value={`external:${entry.id}`}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="custom">Custom Table Effect</option>
          </select>
        </label>
        {sourceKey === "custom" && (
          <label>
            Source name
            <input
              value={customSourceLabel}
              onChange={(event) => setCustomSourceLabel(event.target.value)}
              placeholder="Table effect"
            />
          </label>
        )}
        <button
          type="button"
          className="secondary-action find-effect-source"
          onClick={() =>
            openModal({
              kind: "add",
              payload: {
                tab: "card",
                correctionOnly: true,
                returnTo: "staticEffects",
              },
            })
          }
        >
          <Search /> Find &amp; Add Source Card
        </button>
        <label>
          Affected cards
          <select
            value={target}
            onChange={(event) =>
              setTarget(event.target.value as ManualEffectTarget)
            }
          >
            <option value="controlled-creatures">Creatures I control</option>
            <option value="other-controlled-creatures">
              Other creatures I control
            </option>
            <option value="tokens">Tokens I control</option>
            <option value="nontoken-creatures">
              Nontoken creatures I control
            </option>
            <option value="creature-type">Creature type I control</option>
            <option value="selected-creature">Selected creature</option>
          </select>
        </label>
        {target === "creature-type" && (
          <label>
            Creature type
            <input
              value={subtype}
              onChange={(event) => setSubtype(event.target.value)}
            />
          </label>
        )}
        {target === "selected-creature" && (
          <label>
            Creature
            <select
              value={targetGroupId}
              onChange={(event) => setTargetGroupId(event.target.value)}
            >
              <option value="">Choose creature</option>
              {creatures.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Effect
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as ManualEffectModification["kind"])
            }
          >
            <option value="power-toughness">Power / toughness</option>
            <option value="grant-keyword">Grant keyword</option>
            <option value="remove-keyword">Remove keyword</option>
          </select>
        </label>
        {kind === "power-toughness" ? (
          <div className="numeric-pair">
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
          </div>
        ) : (
          <label>
            Keyword
            <select
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            >
              {KEYWORDS.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Duration
          <select
            value={duration}
            onChange={(event) =>
              setDuration(event.target.value as typeof duration)
            }
          >
            <option value="while-source-active">While source is active</option>
            <option value="until-end-of-turn">Until end of turn</option>
            <option value="until-removed">Until removed</option>
          </select>
        </label>
        <button
          type="button"
          className="primary-action"
          disabled={!source || !validTarget}
          onClick={() => {
            if (!source || !validTarget) return;
            const modification: ManualEffectModification =
              kind === "power-toughness"
                ? { kind, power, toughness }
                : { kind, keyword };
            addEffect({
              source,
              target,
              targetGroupId:
                target === "selected-creature" ? targetGroupId : null,
              subtype: target === "creature-type" ? subtype : null,
              modification,
              duration,
            });
          }}
        >
          <Plus /> Add Effect
        </button>
      </section>
      <section>
        <h3>Active Effects</h3>
        <div className="active-effect-list">
          {field.manualEffects.effects.length === 0 && (
            <p className="empty-copy">No manual effects.</p>
          )}
          {field.manualEffects.effects.map((effect) => (
            <article
              key={effect.id}
              className={
                effect.enabled ? "active-effect" : "active-effect disabled"
              }
            >
              <span>
                <strong>{effect.name}</strong>
                <small>Source: {effect.source.label}</small>
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEnabled(effect.id, !effect.enabled)}
                aria-label={
                  effect.enabled
                    ? `Disable ${effect.name}`
                    : `Enable ${effect.name}`
                }
              >
                {effect.enabled ? <Eye /> : <EyeOff />}
              </button>
              <button
                type="button"
                className="icon-button danger-action"
                onClick={() => removeEffect(effect.id)}
                aria-label={`Remove ${effect.name}`}
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function resolveSource(
  key: string,
  customLabel: string,
  permanents: Array<{ id: string; label: string }>,
  external: ExternalSourceObject[],
): EffectSourceReference | null {
  if (key === "custom") {
    const label = customLabel.trim();
    return label
      ? {
          kind: "custom-table-effect",
          id: null,
          label,
          controller: "shared",
        }
      : null;
  }
  const [type, id] = key.split(":", 2);
  if (type === "permanent") {
    const source = permanents.find((entry) => entry.id === id);
    return source
      ? {
          kind: "permanent",
          id: source.id,
          label: source.label,
          controller: "you",
        }
      : null;
  }
  const source = external.find((entry) => entry.id === id);
  return source
    ? {
        kind: externalSourceKind(source.kind),
        id: source.id,
        label: source.name,
        controller: "shared",
      }
    : null;
}

function externalSourceKind(
  kind: ExternalSourceObject["kind"],
): EffectSourceKind {
  if (kind === "dungeon") return "dungeon-room";
  if (kind === "custom") return "global-game-state";
  return kind;
}
