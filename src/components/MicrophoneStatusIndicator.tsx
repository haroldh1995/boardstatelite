import {
  AlertTriangle,
  LoaderCircle,
  Mic,
  MicOff,
  PauseCircle,
} from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";
import type {
  EchoListeningIndicator,
  EchoListeningStatus,
} from "../echo/listeningTypes";

export function MicrophoneStatusIndicator() {
  const listening = useFieldStore((state) => state.field.listening);
  const voice = useFieldStore((state) => state.field.settings.voice);
  const toggleListeningMute = useFieldStore(
    (state) => state.toggleListeningMute,
  );

  if (listening.indicator === "hidden") return null;

  const muted = isListeningMuted(
    listening.status,
    voice.ambientListeningEnabled,
  );
  const canToggle =
    voice.voiceFeaturesEnabled &&
    voice.ambientListeningEnabled &&
    listening.availability !== "unsupported" &&
    listening.availability !== "unavailable" &&
    !isBusyListeningStatus(listening.status);
  const label = muted
    ? "Unmute microphone listening"
    : "Mute microphone listening";

  return (
    <aside
      className={`microphone-indicator microphone-indicator-${listening.indicator}`}
      role="status"
      aria-live="polite"
      aria-label={
        muted ? "Microphone listening muted" : statusLabel(listening.indicator)
      }
    >
      {muted ? <MicOff /> : indicatorIcon(listening.indicator)}
      <span>
        {muted ? "Listening muted" : statusLabel(listening.indicator)}
      </span>
      <button
        type="button"
        className="microphone-toggle"
        aria-pressed={!muted && listening.status === "listening"}
        aria-label={label}
        title={label}
        disabled={!canToggle}
        onClick={() => void toggleListeningMute()}
      >
        {muted ? <Mic /> : <MicOff />}
      </button>
    </aside>
  );
}

function isListeningMuted(
  status: EchoListeningStatus,
  ambientListeningEnabled: boolean,
): boolean {
  return (
    ambientListeningEnabled &&
    (status === "stopped" || status === "temporarilyPaused")
  );
}

function isBusyListeningStatus(status: EchoListeningStatus): boolean {
  return (
    status === "preparing" ||
    status === "requestingPermission" ||
    status === "initializing" ||
    status === "recovering" ||
    status === "stopping"
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
