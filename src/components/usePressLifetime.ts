import { useEffect, useRef } from "react";
import { interactions } from "../domain/interactions";

/** Browser adapter: release anywhere, interruption, capture loss and unmount terminate ownership. */
export function usePressLifetime(onStart: () => void, onEnd: () => void) {
  const callbacks = useRef({ onStart, onEnd });
  callbacks.current = { onStart, onEnd };
  const owner = useRef<{ pointerId: number; release: () => void } | null>(null);
  const finish = () => {
    const current = owner.current;
    if (!current) return;
    owner.current = null;
    current.release();
    callbacks.current.onEnd();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const stop = () => {
      finishRef.current();
      callbacks.current.onEnd();
    };
    const release = (event: PointerEvent) => {
      if (event.pointerId === owner.current?.pointerId) stop();
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("touchend", stop, true);
    window.addEventListener("touchcancel", stop, true);
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hidden);
    const unsubscribe = interactions.subscribe(stop);
    return () => {
      stop();
      unsubscribe();
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("touchend", stop, true);
      window.removeEventListener("touchcancel", stop, true);
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (
        (event.button !== undefined && event.button !== 0) ||
        (event.pointerType === "touch" && event.isPrimary === false)
      )
        return;
      finish();
      const release = interactions.ownHold(() => finishRef.current());
      owner.current = { pointerId: event.pointerId, release };
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Global release listeners still own cancellation when capture is unavailable.
      }
      callbacks.current.onStart();
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onBlur: () => {
      finish();
      callbacks.current.onEnd();
    },
  };
}
