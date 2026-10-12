import type { PlayerCounters } from "./types";

export const PLAYER_TRACKERS = [
  { id: "poison", name: "Poison" },
  { id: "energy", name: "Energy" },
  { id: "experience", name: "Experience" },
  { id: "rad", name: "Rad" },
  { id: "ticket", name: "Ticket" },
  { id: "acorn", name: "Acorn" },
] as const;
export interface TrackerDefinition {
  id: string;
  name: string;
}
export interface TrackerPreset {
  id: string;
  name: string;
  trackers: string[];
}
export interface PlayerTrackerPreferences {
  visible: string[];
  custom: TrackerDefinition[];
  presets: TrackerPreset[];
}
export const BUILTIN_TRACKER_PRESETS: TrackerPreset[] = [
  {
    id: "standard",
    name: "Standard Commander",
    trackers: ["poison", "energy", "experience"],
  },
  { id: "poison", name: "Poison Game", trackers: ["poison"] },
  { id: "energy", name: "Energy Game", trackers: ["energy"] },
  { id: "life", name: "Life Only", trackers: [] },
];
export function defaultPlayerTrackers(): PlayerTrackerPreferences {
  return { visible: ["poison"], custom: [], presets: [] };
}
export function normalizePlayerTrackers(
  value: unknown,
): PlayerTrackerPreferences {
  const defaults = defaultPlayerTrackers();
  if (!value || typeof value !== "object") return defaults;
  const input = value as Partial<PlayerTrackerPreferences>;
  const custom = (Array.isArray(input.custom) ? input.custom : [])
    .filter(
      (entry) =>
        entry &&
        /^custom-[a-zA-Z0-9-]+$/.test(entry.id) &&
        typeof entry.name === "string" &&
        entry.name.trim(),
    )
    .slice(0, 32)
    .map((entry) => ({ id: entry.id, name: entry.name.trim().slice(0, 40) }));
  const uniqueCustom = custom.filter(
    (entry, i) => custom.findIndex((other) => other.id === entry.id) === i,
  );
  const allowed = new Set<string>([
    ...PLAYER_TRACKERS.map((entry) => entry.id),
    ...uniqueCustom.map((entry) => entry.id),
  ]);
  const clean = (ids: unknown) =>
    Array.isArray(ids)
      ? [
          ...new Set(
            ids.filter(
              (id): id is string => typeof id === "string" && allowed.has(id),
            ),
          ),
        ]
      : [];
  return {
    visible:
      input.visible === undefined ? defaults.visible : clean(input.visible),
    custom: uniqueCustom,
    presets: (Array.isArray(input.presets) ? input.presets : [])
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.name === "string" &&
          entry.name.trim(),
      )
      .slice(0, 12)
      .map((entry) => ({
        id: entry.id,
        name: entry.name.trim().slice(0, 40),
        trackers: clean(entry.trackers),
      })),
  };
}
export function trackerDefinitions(
  preferences: PlayerTrackerPreferences,
): TrackerDefinition[] {
  return [...PLAYER_TRACKERS, ...preferences.custom];
}
export function playerCounterValue(
  counters: PlayerCounters,
  id: string,
): number {
  return id === "poison" ||
    id === "energy" ||
    id === "experience" ||
    id === "rad"
    ? counters[id]
    : (counters.custom[id] ?? 0);
}
export function withPlayerCounter(
  counters: PlayerCounters,
  id: string,
  value: number,
): PlayerCounters {
  const amount = Number.isFinite(value)
    ? Math.max(0, Math.min(999999, Math.trunc(value)))
    : 0;
  if (id === "poison" || id === "energy" || id === "experience" || id === "rad")
    return { ...counters, [id]: amount };
  if (
    !PLAYER_TRACKERS.some((entry) => entry.id === id) &&
    !/^custom-[a-zA-Z0-9-]+$/.test(id)
  )
    return counters;
  const custom = { ...counters.custom };
  if (amount) custom[id] = amount;
  else delete custom[id];
  return { ...counters, custom };
}
