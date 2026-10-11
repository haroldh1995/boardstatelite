import { useState } from "react";
import { Mountain } from "lucide-react";
import { battlefieldIndex } from "../domain/battlefieldIndex";
import { useFieldStore } from "../state/useFieldStore";
import { usePressLifetime } from "./usePressLifetime";

export function BattlefieldLandCount() {
  const groups = useFieldStore((state) => state.field.groups);
  const counts = battlefieldIndex(groups).counts;
  const total = counts["type:Land"]?.count ?? 0;
  const basic = counts.basic?.count ?? 0;
  const nonbasic = counts.nonbasic?.count ?? 0;
  const [peek, setPeek] = useState(false);
  const press = usePressLifetime(
    () => setPeek(true),
    () => setPeek(false),
  );
  return (
    <button
      type="button"
      className="total-chip land-count"
      {...press}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          setPeek(true);
        }
      }}
      onKeyUp={() => setPeek(false)}
      aria-label={`Battlefield lands: ${total}. Basic ${basic}. Nonbasic ${nonbasic}.`}
    >
      <Mountain aria-hidden="true" />
      <span>
        <small>Lands</small>
        <strong>{total}</strong>
        <span className="land-breakdown" aria-hidden="true">
          {peek ? `Basic ${basic} / Nonbasic ${nonbasic}` : ""}
        </span>
      </span>
    </button>
  );
}
