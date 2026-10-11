import { useEffect, useRef } from "react";
import { interactions } from "../domain/interactions";

export function magnificationDestination(
  scale: number,
  expanded: boolean,
): boolean {
  return expanded ? scale > 0.8 : scale >= 1.22;
}

export function useLifeMagnification(
  blocked: boolean,
  expanded: boolean,
  change: (expanded: boolean) => void,
  reducedMotion: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const surface = ref.current;
    if (!surface || blocked) return;
    let startDistance = 0;
    let scale = 1;
    let intentional = false;
    const incompatible = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(
        'button,input,select,textarea,[role="dialog"],[role="menu"],.modal-overlay,[contenteditable="true"]',
      );
    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
    const reset = () => {
      startDistance = 0;
      scale = 1;
      intentional = false;
      surface.style.removeProperty("--life-gesture-scale");
      surface.classList.remove("life-magnifying");
    };
    const start = (event: TouchEvent) => {
      if (
        event.touches.length !== 2 ||
        Array.from(event.touches).some((touch) => incompatible(touch.target))
      ) {
        reset();
        return;
      }
      startDistance = distance(event.touches);
      interactions.cancelHold();
    };
    const move = (event: TouchEvent) => {
      if (!startDistance || event.touches.length !== 2) return;
      scale = distance(event.touches) / startDistance;
      if (Math.abs(scale - 1) < 0.06 && !intentional) return;
      if (!intentional) interactions.end();
      intentional = true;
      event.preventDefault();
      surface.classList.add("life-magnifying");
      if (!reducedMotion)
        surface.style.setProperty(
          "--life-gesture-scale",
          String(Math.min(1.2, Math.max(0.85, scale))),
        );
    };
    const end = () => {
      if (intentional) {
        const destination = magnificationDestination(scale, expanded);
        if (destination !== expanded) change(destination);
      }
      reset();
    };
    const interrupt = () => {
      interactions.end();
      reset();
    };
    surface.addEventListener("touchstart", start, { passive: true });
    surface.addEventListener("touchmove", move, { passive: false });
    surface.addEventListener("touchend", end);
    surface.addEventListener("touchcancel", reset);
    window.addEventListener("blur", interrupt);
    return () => {
      reset();
      surface.removeEventListener("touchstart", start);
      surface.removeEventListener("touchmove", move);
      surface.removeEventListener("touchend", end);
      surface.removeEventListener("touchcancel", reset);
      window.removeEventListener("blur", interrupt);
    };
  }, [blocked, expanded, change, reducedMotion]);
  return ref;
}
