export function sortSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSerializable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortSerializable(entry)]),
  );
}

export function serializeStable(value: unknown, space?: number): string {
  return JSON.stringify(sortSerializable(value), null, space);
}
