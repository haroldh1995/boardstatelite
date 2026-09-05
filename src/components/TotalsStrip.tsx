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
  Check,
} from "lucide-react";
import {
  isReferenceFixtureMode,
  referenceTotalValue,
  REFERENCE_TOTAL_KEYS,
} from "../dev/referenceMode";
import { getVisibleTotals } from "../domain/field";
import type { RelevantTotalKey } from "../domain/types";
import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
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
  const landPlay = getLandPlayTurnStatus(field.preTurnPlanner);
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
        const isLand = total.key === "lands";
        return (
          <button
            type="button"
            key={total.key}
            className={[
              "total-chip",
              isLand
                ? landPlay.complete
                  ? "land-play-complete"
                  : "land-play-pending"
                : "",
              isLand &&
              !landPlay.complete &&
              field.settings.gameplayReminders &&
              !field.settings.reducedMotion
                ? "land-play-reminder-active"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              if (isLand) {
                openModal({ kind: "landPlay" });
                return;
              }
              if (
                total.key === "cardsInGraveyard" ||
                total.key === "cardsInExile"
              ) {
                openModal({
                  kind: "zoneComposition",
                  payload: {
                    zone:
                      total.key === "cardsInGraveyard" ? "graveyard" : "exile",
                  },
                });
                return;
              }
              openModal({ kind: "exactTotal", payload: { total } });
            }}
            aria-label={
              isLand
                ? `${total.label}: ${value}. ${landPlay.accessibilityLabel}`
                : `${total.label}: ${value}`
            }
          >
            <span aria-hidden="true">{ICONS[total.key] ?? <Castle />}</span>
            <span>
              <small>{total.label}</small>
              <strong>{value}</strong>
              {isLand && (
                <em className="land-play-cue" aria-hidden="true">
                  {landPlay.complete ? (
                    <>
                      <Check /> Played
                    </>
                  ) : landPlay.expected > 1 ? (
                    `${landPlay.marked}/${landPlay.expected}`
                  ) : (
                    "Not played"
                  )}
                </em>
              )}
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
