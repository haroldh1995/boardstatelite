import { useRef } from "react";
import { HoldRepeater, interactions } from "../domain/interactions";
import { usePressLifetime } from "./usePressLifetime";

export function HoldAdjustButton({
  label,
  className,
  step,
  onStep,
  children,
  disabled = false,
}: {
  label: string;
  className?: string;
  step: number;
  onStep: (delta: number) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const latest = useRef({ step, onStep, disabled });
  latest.current = { step, onStep, disabled };
  const repeater = useRef(
    new HoldRepeater({
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
    }),
  );
  const addStep = () => {
    if (!latest.current.disabled) latest.current.onStep(latest.current.step);
    else repeater.current.stop();
  };
  const press = usePressLifetime(
    () => repeater.current.start(addStep),
    () => repeater.current.stop(),
  );

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      disabled={disabled}
      {...press}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.detail === 0) {
          interactions.cancelHold();
          addStep();
        }
      }}
      onKeyDown={(event) => {
        if (event.repeat) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
