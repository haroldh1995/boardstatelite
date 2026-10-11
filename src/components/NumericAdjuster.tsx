import { Minus, Plus } from "lucide-react";
import { HoldAdjustButton } from "./HoldAdjustButton";
import { useGroupedNumericAdjustment } from "./useGroupedNumericAdjustment";

export function NumericAdjuster({
  label,
  value,
  onCommit,
  maximum = 999999,
}: {
  label: string;
  value: number;
  onCommit: (delta: number) => void;
  maximum?: number;
}) {
  const adjustment = useGroupedNumericAdjustment({
    value,
    onCommit,
    minimum: 0,
    maximum,
  });
  return (
    <div className="numeric-adjuster">
      <span>{label}</span>
      <div className="direct-adjust" role="group" aria-label={label}>
        <HoldAdjustButton
          label={`Decrease ${label}`}
          step={-1}
          onStep={adjustment.adjust}
        >
          <Minus />
        </HoldAdjustButton>
        <strong aria-live="off">{adjustment.displayedValue}</strong>
        <HoldAdjustButton
          label={`Increase ${label}`}
          step={1}
          onStep={adjustment.adjust}
        >
          <Plus />
        </HoldAdjustButton>
      </div>
      <span className="numeric-delta" aria-live="polite">
        {adjustment.displayedDelta
          ? `${adjustment.displayedDelta > 0 ? "+" : ""}${adjustment.displayedDelta}`
          : ""}
      </span>
    </div>
  );
}
