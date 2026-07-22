import {
  Info,
  Mic,
  MicOff,
  RotateCcw,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";
import type {
  EchoListeningIndicator,
  EchoListeningPermissionStatus,
  EchoListeningStatus,
} from "../echo/listeningTypes";

export function VoiceSettingsPanel() {
  const voice = useFieldStore((state) => state.field.settings.voice);
  const listening = useFieldStore((state) => state.field.listening);
  const setVoiceSettings = useFieldStore((state) => state.setVoiceSettings);
  const requestPermission = useFieldStore(
    (state) => state.requestMicrophonePermission,
  );
  const startMicrophoneTest = useFieldStore(
    (state) => state.startMicrophoneTest,
  );
  const stopListening = useFieldStore((state) => state.stopListening);
  const resetVoiceConfiguration = useFieldStore(
    (state) => state.resetVoiceConfiguration,
  );
  const active = isActiveListeningStatus(listening.status);
  const canUseMicrophone =
    voice.voiceFeaturesEnabled && listening.availability !== "unsupported";

  return (
    <section className="voice-settings-panel">
      <h3>Voice &amp; Microphone</h3>
      <div
        className={`microphone-status-card microphone-status-${listening.indicator}`}
      >
        <span className="microphone-status-icon" aria-hidden="true">
          {statusIcon(listening.indicator)}
        </span>
        <div>
          <strong>{statusLabel(listening.indicator)}</strong>
          <span>
            Permission: {permissionLabel(listening.permission)} • Session:{" "}
            {listeningStatusLabel(listening.status)}
          </span>
        </div>
      </div>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={voice.voiceFeaturesEnabled}
          onChange={(event) =>
            void setVoiceSettings({
              voiceFeaturesEnabled: event.target.checked,
              ambientListeningEnabled:
                event.target.checked && voice.ambientListeningEnabled,
            })
          }
        />
        Enable Voice Features
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={voice.ambientListeningEnabled}
          disabled={!voice.voiceFeaturesEnabled}
          onChange={(event) =>
            void setVoiceSettings({
              ambientListeningEnabled: event.target.checked,
            })
          }
        />
        Enable Ambient Listening
      </label>
      <label className="inline-check unavailable-setting">
        <input type="checkbox" checked={false} disabled readOnly />
        Push-to-Talk (future)
      </label>
      <label className="inline-check unavailable-setting">
        <input type="checkbox" checked={false} disabled readOnly />
        Always Listening (future)
      </label>
      <div className="voice-settings-actions">
        <button
          type="button"
          disabled={!canUseMicrophone}
          onClick={() => void requestPermission()}
        >
          <ShieldCheck />
          <span>Request Permission</span>
        </button>
        <button
          type="button"
          disabled={!canUseMicrophone || !voice.microphoneTestEnabled || active}
          onClick={() => void startMicrophoneTest()}
        >
          <Mic />
          <span>Microphone Test</span>
        </button>
        <button
          type="button"
          disabled={!active}
          onClick={() => void stopListening()}
        >
          <Square />
          <span>Stop</span>
        </button>
        <button
          type="button"
          className="quiet-action"
          onClick={() => void resetVoiceConfiguration()}
        >
          <RotateCcw />
          <span>Reset Voice Configuration</span>
        </button>
      </div>
      <details className="privacy-note">
        <summary>
          <Info />
          <span>Privacy Information</span>
        </summary>
        <p>
          Voice features are opt-in. The microphone is inactive unless enabled
          and started by an explicit action. Raw audio is not retained, cloud
          transcription is not enabled, and stopping voice features shuts down
          any active audio session immediately.
        </p>
      </details>
    </section>
  );
}

function statusIcon(indicator: EchoListeningIndicator) {
  if (indicator === "ready" || indicator === "listening") return <Mic />;
  if (indicator === "recovering") return <RotateCcw />;
  if (indicator === "permission-needed") return <ShieldCheck />;
  return <MicOff />;
}

function isActiveListeningStatus(status: EchoListeningStatus): boolean {
  return (
    status === "listening" ||
    status === "initializing" ||
    status === "temporarilyPaused" ||
    status === "interrupted" ||
    status === "recovering" ||
    status === "stopping"
  );
}

function statusLabel(indicator: EchoListeningIndicator): string {
  switch (indicator) {
    case "unavailable":
      return "Microphone Unavailable";
    case "permission-needed":
      return "Permission Needed";
    case "ready":
      return "Microphone Ready";
    case "listening":
      return "Listening";
    case "paused":
      return "Temporarily Paused";
    case "recovering":
      return "Recovering";
    case "failed":
      return "Microphone Failed";
    default:
      return "Microphone Inactive";
  }
}

function permissionLabel(permission: EchoListeningPermissionStatus): string {
  switch (permission) {
    case "unsupported":
      return "Unsupported";
    case "prompt":
      return "Needs Request";
    case "granted":
      return "Granted";
    case "denied":
      return "Denied";
    case "permanentlyDenied":
      return "Blocked";
    default:
      return "Unknown";
  }
}

function listeningStatusLabel(status: EchoListeningStatus): string {
  return status
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}
