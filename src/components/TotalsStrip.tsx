import {
  Archive,
  Castle,
  CircleDot,
  Gem,
  Hand,
  Library,
  Mountain,
  Settings,
  Shield,
  Skull,
  Sparkle,
  Sword,
} from "lucide-react";
import {
  isReferenceFixtureMode,
  referenceTotalValue,
  REFERENCE_TOTAL_KEYS,
} from "../dev/referenceMode";
import { getVisibleTotals } from "../domain/field";
import type { RelevantTotalKey } from "../domain/types";
import { useFieldStore } from "../state/useFieldStore";

const ICONS: Partial<Record<RelevantTotalKey, React.ReactNode>> = {
  lands: <Mountain />,
  nonbasicLands: <Gem />,
  artifacts: <Shield />,
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
  const visibleTotals = getVisibleTotals(field);
  const totals = isReferenceFixtureMode()
    ? REFERENCE_TOTAL_KEYS.map((key) => {
        const total = visibleTotals.find((entry) => entry.key === key);
        return (
          total ?? {
            key,
            label: key,
            value: 0,
            required: false,
          }
        );
      })
    : visibleTotals;

  return (
    <section className="totals-strip" aria-label="Relevant totals">
      {totals.map((total) => {
        const value = referenceTotalValue(total.key, total.value);
        return (
          <button
            type="button"
            key={total.key}
            className="total-chip"
            onClick={() =>
              openModal({ kind: "exactTotal", payload: { total } })
            }
            aria-label={`${total.label}: ${value}`}
          >
            <span aria-hidden="true">{ICONS[total.key] ?? <Castle />}</span>
            <span>
              <small>{total.label}</small>
              <strong>{value}</strong>
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className="total-chip settings-chip"
        onClick={() => openModal({ kind: "settings" })}
        aria-label="Open settings"
      >
        <Settings />
      </button>
    </section>
  );
}
