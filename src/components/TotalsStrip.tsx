import {
  Archive,
  Castle,
  CircleDot,
  Gem,
  Hand,
  Library,
  Mountain,
  Plus,
  Skull,
  Sparkle,
  Sword,
} from "lucide-react";
import { getVisibleTotals } from "../domain/field";
import type { RelevantTotalKey } from "../domain/types";
import { useFieldStore } from "../state/useFieldStore";

const ICONS: Partial<Record<RelevantTotalKey, React.ReactNode>> = {
  lands: <Mountain />,
  nonbasicLands: <Gem />,
  artifacts: <ShieldIcon />,
  equipment: <Sword />,
  creatures: <CircleDot />,
  cardsInHand: <Hand />,
  cardsInGraveyard: <Skull />,
  cardsInExile: <Archive />,
  cardsRemainingInLibrary: <Library />,
  tokens: <Sparkle />,
};

export function TotalsStrip() {
  const field = useFieldStore((state) => state.field);
  const openModal = useFieldStore((state) => state.openModal);
  const totals = getVisibleTotals(field);

  return (
    <section className="totals-strip" aria-label="Relevant totals">
      {totals.map((total) => (
        <button
          type="button"
          key={total.key}
          className="total-chip"
          onClick={() => openModal({ kind: "exactTotal", payload: { total } })}
          aria-label={`${total.label}: ${total.value}`}
        >
          <span aria-hidden="true">{ICONS[total.key] ?? <Castle />}</span>
          <span>
            <small>{total.label}</small>
            <strong>{total.value}</strong>
          </span>
        </button>
      ))}
      <button
        type="button"
        className="total-chip settings-chip"
        onClick={() => openModal({ kind: "settings" })}
        aria-label="Open settings"
      >
        <Plus />
        <span>
          <small>Pin</small>
          <strong>Total</strong>
        </span>
      </button>
    </section>
  );
}

function ShieldIcon() {
  return <span className="artifact-glyph">⬟</span>;
}
