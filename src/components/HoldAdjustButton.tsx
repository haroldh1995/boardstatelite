import { useEffect, useRef } from "react";

export function HoldAdjustButton({
  label,
  className,
  step,
  onPreview,
  onCommit,
  children,
}: {
  label: string;
  className?: string;
  step: number;
  onPreview?: (delta: number) => void;
  onCommit: (delta: number) => void;
  children: React.ReactNode;
}) {
  const deltaRef = useRef(0);
  const delayRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const pointerActiveRef = useRef(false);

  useEffect(() => stopTimers, []);

  function addStep() {
    deltaRef.current += step;
    onPreview?.(deltaRef.current);
  }

  function start(event: React.PointerEvent<HTMLButtonElement>) {
    if (pointerActiveRef.current) return;
    pointerActiveRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    deltaRef.current = 0;
    addStep();
    delayRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(addStep, 115);
    }, 430);
  }

  function finish() {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    stopTimers();
    const delta = deltaRef.current;
    deltaRef.current = 0;
    onPreview?.(0);
    if (delta !== 0) onCommit(delta);
  }

  function stopTimers() {
    if (delayRef.current !== null) window.clearTimeout(delayRef.current);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    delayRef.current = null;
    intervalRef.current = null;
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event) => {
        if (event.repeat || (event.key !== "Enter" && event.key !== " "))
          return;
        event.preventDefault();
        onCommit(step);
      }}
    >
      {children}
    </button>
  );
}
