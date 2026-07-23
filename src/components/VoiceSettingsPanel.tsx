import {
  CheckCircle2,
  Info,
  Mic,
  MicOff,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
  Volume1,
  Waves,
} from "lucide-react";
import { getCurrentEnrollmentPhrase } from "../echo/voiceEnrollment";
import type {
  EchoCalibrationEnvironment,
  EchoEnrollmentStatus,
  EchoEnrollmentVolume,
  EchoMicrophonePosition,
} from "../echo/voiceEnrollmentTypes";
import type {
  EchoListeningIndicator,
  EchoListeningPermissionStatus,
  EchoListeningStatus,
} from "../echo/listeningTypes";
import { useFieldStore } from "../state/useFieldStore";

const ENVIRONMENT_OPTIONS: Array<{
  value: EchoCalibrationEnvironment;
  label: string;
}> = [
  { value: "home", label: "Home" },
  { value: "localGameStore", label: "Local Game Store" },
  { value: "tournament", label: "Tournament" },
  { value: "quietRoom", label: "Quiet Room" },
  { value: "custom", label: "Custom" },
];

const DEVICE_POSITION_OPTIONS: Array<{
  value: EchoMicrophonePosition;
  label: string;
}> = [
  { value: "phoneInHand", label: "Phone in hand" },
  { value: "phoneOnTable", label: "Phone on table" },
  { value: "besidePlaymat", label: "Beside playmat" },
  { value: "chargingStand", label: "Charging stand" },
  { value: "custom", label: "Custom" },
];

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
  const beginVoiceEnrollment = useFieldStore(
    (state) => state.beginVoiceEnrollment,
  );
  const setVoiceEnrollmentContext = useFieldStore(
    (state) => state.setVoiceEnrollmentContext,
  );
  const recordVoiceEnrollmentSample = useFieldStore(
    (state) => state.recordVoiceEnrollmentSample,
  );
  const deleteVoiceProfile = useFieldStore((state) => state.deleteVoiceProfile);
  const recordEnvironmentCalibration = useFieldStore(
    (state) => state.recordEnvironmentCalibration,
  );
  const stopListening = useFieldStore((state) => state.stopListening);
  const resetVoiceConfiguration = useFieldStore(
    (state) => state.resetVoiceConfiguration,
  );
  const enrollment = voice.enrollment;
  const profile = enrollment.profile;
  const session = enrollment.session;
  const currentPhrase = getCurrentEnrollmentPhrase(enrollment);
  const active = isActiveListeningStatus(listening.status);
  const enrollmentActive =
    session.status === "active" ||
    session.status === "recording" ||
    session.status === "sampleAccepted" ||
    session.status === "sampleRejected";
  const canUseMicrophone =
    voice.voiceFeaturesEnabled && listening.availability !== "unsupported";
  const acceptedCount = profile.samples.filter(
    (sample) => sample.status === "accepted",
  ).length;
  const progressMax = Math.max(enrollment.phrases.length, 1);
  const progressText = `${Math.min(acceptedCount, progressMax)}/${progressMax}`;

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
            Permission: {permissionLabel(listening.permission)} - Session:{" "}
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

      <div className="voice-enrollment-card" aria-live="polite">
        <div className="voice-enrollment-header">
          <div>
            <strong>Personal Voice Enrollment</strong>
            <span>
              {enrollmentStatusLabel(profile.status)} - Progress {progressText}
            </span>
          </div>
          <span
            className={`voice-enrollment-status status-${profile.status}`}
            aria-label={`Enrollment status: ${enrollmentStatusLabel(
              profile.status,
            )}`}
          >
            {profile.status === "complete" ? <CheckCircle2 /> : <Volume1 />}
          </span>
        </div>

        <div
          className="voice-enrollment-progress"
          aria-label={`Enrollment progress ${progressText}`}
        >
          <span style={{ width: `${(acceptedCount / progressMax) * 100}%` }} />
        </div>

        <div className="voice-profile-metadata">
          <span>Samples: {profile.acousticModel.sampleCount}</span>
          <span>
            Volumes: {volumeCoverageLabel(profile.acousticModel.volumeCoverage)}
          </span>
          <span>
            Raw audio:{" "}
            {profile.privacy.rawAudioRetained ? "retained" : "discarded"}
          </span>
        </div>

        {currentPhrase ? (
          <div className="enrollment-step">
            <span className="enrollment-step-kicker">
              {volumeLabel(currentPhrase.volume)} voice
            </span>
            <p className="enrollment-phrase">"{currentPhrase.text}"</p>
            <button
              type="button"
              disabled={!canUseMicrophone || active}
              onClick={() => void recordVoiceEnrollmentSample()}
            >
              <Mic />
              <span>Record Current Sample</span>
            </button>
          </div>
        ) : (
          <p className="voice-settings-copy">
            Enrollment stores compact acoustic features for future speaker
            verification. It does not transcribe speech or retain raw audio.
          </p>
        )}

        {session.lastError ? (
          <p className="voice-enrollment-error" role="status">
            {session.lastError}
          </p>
        ) : null}

        <div className="voice-context-grid">
          <label>
            Environment
            <select
              value={session.currentEnvironment}
              onChange={(event) =>
                setVoiceEnrollmentContext({
                  environment: event.target.value as EchoCalibrationEnvironment,
                })
              }
            >
              {ENVIRONMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Microphone position
            <select
              value={session.currentDevicePosition}
              onChange={(event) =>
                setVoiceEnrollmentContext({
                  devicePosition: event.target.value as EchoMicrophonePosition,
                })
              }
            >
              {DEVICE_POSITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="inline-check">
          <input
            type="checkbox"
            checked={session.alternativePacing}
            onChange={(event) =>
              setVoiceEnrollmentContext({
                alternativePacing: event.target.checked,
              })
            }
          />
          Alternative enrollment pacing
        </label>

        <div className="voice-settings-actions voice-enrollment-actions">
          <button
            type="button"
            onClick={() => beginVoiceEnrollment("new")}
            disabled={enrollmentActive || profile.status !== "notStarted"}
          >
            <Volume1 />
            <span>Begin Voice Enrollment</span>
          </button>
          <button
            type="button"
            onClick={() => beginVoiceEnrollment("replace")}
            disabled={enrollmentActive || profile.status === "notStarted"}
          >
            <RotateCcw />
            <span>Replace Voice Profile</span>
          </button>
          <button
            type="button"
            onClick={() => beginVoiceEnrollment("recalibration")}
            disabled={enrollmentActive || profile.status === "notStarted"}
          >
            <Waves />
            <span>Recalibrate Voice Profile</span>
          </button>
          <button
            type="button"
            onClick={() => beginVoiceEnrollment("additional")}
            disabled={enrollmentActive || profile.status === "notStarted"}
          >
            <Mic />
            <span>Add Additional Samples</span>
          </button>
          <button
            type="button"
            onClick={() => void recordEnvironmentCalibration()}
            disabled={!canUseMicrophone || active}
          >
            <Waves />
            <span>Environmental Calibration</span>
          </button>
          <button
            type="button"
            className="danger-action"
            onClick={() => deleteVoiceProfile()}
            disabled={profile.status === "notStarted"}
          >
            <Trash2 />
            <span>Delete Voice Profile</span>
          </button>
        </div>
      </div>

      <details className="privacy-note">
        <summary>
          <Info />
          <span>Privacy Information</span>
        </summary>
        <p>
          Voice features are opt-in. Enrollment records short samples only when
          you press a recording button, stores acoustic features for future
          speaker verification, discards raw audio, and never uploads audio for
          cloud transcription.
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

function enrollmentStatusLabel(status: EchoEnrollmentStatus): string {
  switch (status) {
    case "enrolling":
      return "Enrolling";
    case "complete":
      return "Complete";
    case "needsRecalibration":
      return "Needs Recalibration";
    default:
      return "Not Started";
  }
}

function volumeLabel(volume: EchoEnrollmentVolume): string {
  if (volume === "acrossTable") return "Across-the-table";
  return volume.replace(/^./, (letter) => letter.toUpperCase());
}

function volumeCoverageLabel(volumes: EchoEnrollmentVolume[]): string {
  return volumes.length === 0 ? "None" : volumes.map(volumeLabel).join(", ");
}
