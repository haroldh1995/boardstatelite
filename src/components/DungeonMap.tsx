import { Check, CornerDownRight, MapPin } from "lucide-react";
import type { DungeonDefinition } from "../domain/dungeonCatalog";
import type { DungeonRun } from "../domain/dungeons";

export function DungeonMap({
  dungeon,
  run,
  available,
  onEnter,
}: {
  dungeon: DungeonDefinition;
  run: DungeonRun | null;
  available: string[];
  onEnter: (roomId: string) => void;
}) {
  const rows = [...new Set(dungeon.rooms.map((room) => room.row))];
  return (
    <div className="dungeon-map" aria-label={`${dungeon.name} dungeon map`}>
      {rows.map((row) => (
        <div
          className="dungeon-map-row"
          key={row}
          style={{
            gridTemplateColumns: `repeat(${dungeon.rooms.filter((room) => room.row === row).length}, minmax(0, 1fr))`,
          }}
        >
          {dungeon.rooms
            .filter((room) => room.row === row)
            .map((room) => {
              const current = run?.currentRoomId === room.id;
              const visited = run?.visits.some(
                (visit) => visit.roomId === room.id,
              );
              const next = available.includes(room.id);
              return (
                <div
                  className={`dungeon-room ${current ? "current" : ""} ${visited ? "visited" : ""} ${next ? "available" : ""}`}
                  key={room.id}
                >
                  <button
                    disabled={!next}
                    aria-current={current ? "step" : undefined}
                    aria-label={`${room.name}${current ? ", current room" : visited ? ", visited" : ""}${next ? ", available destination" : ""}. ${room.text}`}
                    onClick={() => onEnter(room.id)}
                  >
                    {current ? (
                      <MapPin />
                    ) : visited ? (
                      <Check />
                    ) : next ? (
                      <CornerDownRight />
                    ) : null}
                    <strong>{room.name}</strong>
                    <span>
                      {current
                        ? "Current"
                        : next
                          ? "Enter"
                          : visited
                            ? "Visited"
                            : ""}
                    </span>
                  </button>
                  <p>{room.text}</p>
                  {room.next.length > 0 && (
                    <small className="dungeon-path">
                      To:{" "}
                      {room.next
                        .map(
                          (id) =>
                            dungeon.rooms.find((entry) => entry.id === id)
                              ?.name,
                        )
                        .join(" / ")}
                    </small>
                  )}
                </div>
              );
            })}
        </div>
      ))}
      <details className="dungeon-original">
        <summary>Official Dungeon Card</summary>
        <img
          src={dungeon.imageUrl}
          alt={`${dungeon.name}, official dungeon card`}
          loading="lazy"
          decoding="async"
        />
        <a
          href={`https://scryfall.com/search?q=oracleid%3A${dungeon.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Card data: Scryfall. Magic artwork: Wizards of the Coast.
        </a>
      </details>
    </div>
  );
}
