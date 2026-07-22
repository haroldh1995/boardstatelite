import {
  AlertTriangle,
  LoaderCircle,
  Mic,
  MicOff,
  PauseCircle,
  Square,
} from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";
import type { EchoListeningIndicator } from "../echo/listeningTypes";

export function MicrophoneStatusIndicator() {
  const listening = useFieldStore((state) => state.field.listening);
  const stopListening = useFieldStore((state) => state.stopListening);

  if (listening.indicator === "hidden") return null;

  return (
    <aside
      className={`microphone-indicator microphone-indicator-${listening.indicator}`}
      role="status"
      aria-live="polite"
      aria-label={statusLabel(listening.indicator)}
    >
      {indicatorIcon(listening.indicator)}
      <span>{statusLabel(listening.indicator)}</span>
      {listening.status === "listening" && (
        <button
          type="button"
          aria-label="Stop microphone listening"
          onClick={() => void stopListening()}
        >
          <Square />
        </button>
      )}
    </aside>
  );
}

function indicatorIcon(indicator: EchoListeningIndicator) {
  if (indicator === "listening") return <Mic />;
  if (indicator === "ready") return <Mic />;
  if (indicator === "paused") return <PauseCircle />;
  if (indicator === "recovering") return <LoaderCircle />;
  if (indicator === "failed" || indicator === "unavailable") {
    return <AlertTriangle />;
  }
  return <MicOff />;
}

function statusLabel(indicator: EchoListeningIndicator): string {
  switch (indicator) {
    case "unavailable":
      return "Microphone unavailable";
    case "permission-needed":
      return "Microphone permission needed";
    case "ready":
      return "Microphone ready";
    case "listening":
      return "Microphone listening";
    case "paused":
      return "Microphone paused";
    case "recovering":
      return "Microphone recovering";
    case "failed":
      return "Microphone failed";
    default:
      return "Microphone inactive";
  }
}
