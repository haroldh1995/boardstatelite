import { makeId } from "../domain/cards";
import type {
  AmbientGameplayMode,
  AmbientLifecycleEvent,
} from "./ambientTypes";
import {
  ECHO_LISTENING_STATE_VERSION,
  ECHO_VOICE_SETTINGS_VERSION,
  type EchoAudioSessionInterruption,
  type EchoAudioSampleMetrics,
  type EchoAudioSampleRequest,
  type EchoAudioSessionState,
  type EchoListeningDiagnostics,
  type EchoListeningIndicator,
  type EchoListeningPermissionStatus,
  type EchoListeningState,
  type EchoListeningStatus,
  type EchoListeningTransitionReason,
  type EchoListeningTransitionRecord,
  type EchoMicrophoneAvailability,
  type EchoVoiceSettings,
} from "./listeningTypes";
import {
  createDefaultVoiceEnrollmentSettings,
  normalizeVoiceEnrollmentSettings,
} from "./voiceEnrollment";
import {
  createDefaultSpeakerVerificationSettings,
  normalizeSpeakerVerificationSettings,
} from "./speakerVerification";

const DEFAULT_AUDIO_BUFFER_MS = 0;

const VALID_LISTENING_TRANSITIONS: Record<
  EchoListeningStatus,
  EchoListeningStatus[]
> = {
  idle: ["preparing", "requestingPermission", "stopped", "failed"],
  preparing: [
    "requestingPermission",
    "permissionGranted",
    "permissionDenied",
    "initializing",
    "ready",
    "stopped",
    "failed",
  ],
  requestingPermission: [
    "permissionGranted",
    "permissionDenied",
    "initializing",
    "ready",
    "stopped",
    "failed",
  ],
  permissionGranted: ["initializing", "ready", "stopped", "failed"],
  permissionDenied: ["requestingPermission", "stopped", "failed"],
  initializing: ["ready", "listening", "interrupted", "stopping", "failed"],
  ready: [
    "initializing",
    "listening",
    "temporarilyPaused",
    "interrupted",
    "stopping",
    "failed",
  ],
  listening: ["temporarilyPaused", "interrupted", "stopping", "failed"],
  temporarilyPaused: [
    "listening",
    "recovering",
    "stopping",
    "stopped",
    "failed",
  ],
  interrupted: ["recovering", "stopping", "stopped", "failed"],
  recovering: ["ready", "listening", "stopped", "failed"],
  stopping: ["stopped", "failed"],
  stopped: ["idle", "preparing", "requestingPermission"],
  failed: ["recovering", "stopped", "idle", "requestingPermission"],
};

export interface EchoAudioSession {
  id: string;
  sampleRate: number | null;
  channelCount: number | null;
  deviceId: string | null;
  deviceLabel: string | null;
  stop: () => void;
}

export interface MicrophonePlatformAdapter {
  readonly platform: "web" | "android" | "ios" | "unknown";
  isMicrophoneSupported(): boolean;
  queryPermission(): Promise<EchoListeningPermissionStatus>;
  requestPermission(): Promise<EchoListeningPermissionStatus>;
  createAudioSession(): Promise<EchoAudioSession>;
  captureAudioSample?(
    request: EchoAudioSampleRequest,
  ): Promise<EchoAudioSampleMetrics>;
  openPermissionSettings?(): Promise<boolean>;
  subscribeToPermissionChanges?(
    callback: (permission: EchoListeningPermissionStatus) => void,
  ): () => void;
  subscribeToDeviceChanges?(
    callback: (reason: EchoAudioSessionInterruption) => void,
  ): () => void;
}

export type EchoListeningListener = (state: EchoListeningState) => void;

export function createDefaultEchoVoiceSettings(): EchoVoiceSettings {
  return {
    version: ECHO_VOICE_SETTINGS_VERSION,
    voiceFeaturesEnabled: false,
    ambientListeningEnabled: false,
    pushToTalkEnabled: false,
    alwaysListeningEnabled: false,
    microphoneTestEnabled: true,
    permissionPrimed: false,
    privacyAcknowledged: false,
    lastResetAt: null,
    enrollment: createDefaultVoiceEnrollmentSettings(),
    verification: createDefaultSpeakerVerificationSettings(),
  };
}

export function normalizeEchoVoiceSettings(value: unknown): EchoVoiceSettings {
  const defaults = createDefaultEchoVoiceSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoVoiceSettings>;
  const voiceFeaturesEnabled = Boolean(candidate.voiceFeaturesEnabled);
  return {
    ...defaults,
    version: ECHO_VOICE_SETTINGS_VERSION,
    voiceFeaturesEnabled,
    ambientListeningEnabled:
      voiceFeaturesEnabled && Boolean(candidate.ambientListeningEnabled),
    pushToTalkEnabled: false,
    alwaysListeningEnabled: false,
    microphoneTestEnabled:
      candidate.microphoneTestEnabled === undefined
        ? defaults.microphoneTestEnabled
        : Boolean(candidate.microphoneTestEnabled),
    permissionPrimed: Boolean(candidate.permissionPrimed),
    privacyAcknowledged: Boolean(candidate.privacyAcknowledged),
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
    enrollment: normalizeVoiceEnrollmentSettings(candidate.enrollment),
    verification: normalizeSpeakerVerificationSettings(candidate.verification),
  };
}

export function createDefaultEchoListeningState(
  options: {
    timestamp?: string;
    ambientMode?: AmbientGameplayMode;
  } = {},
): EchoListeningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const ambientMode = options.ambientMode ?? "passive";
  return {
    version: ECHO_LISTENING_STATE_VERSION,
    status: "idle",
    previousStatus: null,
    requestedStatus: null,
    permission: "unknown",
    availability: "unknown",
    indicator: "hidden",
    ambientMode,
    transitionReason: "initialization",
    transitionTimestamp: timestamp,
    lastTransition: null,
    invalidTransitionCount: 0,
    lastError: null,
    lastInterruption: null,
    activeSession: createInactiveAudioSession(),
    privacy: createPrivacyState(),
  };
}

export function normalizeEchoListeningState(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    ambientMode?: AmbientGameplayMode;
    settings?: EchoVoiceSettings;
    allowActiveSession?: boolean;
  },
): EchoListeningState {
  const defaults = createDefaultEchoListeningState({
    timestamp: options.fallbackTimestamp,
    ambientMode: options.ambientMode,
  });
  if (!value || typeof value !== "object") {
    return withIndicator(defaults, options.settings);
  }
  const candidate = value as Partial<EchoListeningState>;
  const status = normalizeStatus(candidate.status) ?? defaults.status;
  const safeStatus =
    options.allowActiveSession || !isActiveStatus(status) ? status : "stopped";
  const activeSession =
    options.allowActiveSession && safeStatus !== "stopped"
      ? normalizeAudioSession(candidate.activeSession)
      : createInactiveAudioSession({
          stoppedAt:
            typeof candidate.activeSession?.stoppedAt === "string"
              ? candidate.activeSession.stoppedAt
              : options.fallbackTimestamp,
        });
  return withIndicator(
    {
      ...defaults,
      status: safeStatus,
      previousStatus: normalizeStatus(candidate.previousStatus),
      requestedStatus: normalizeStatus(candidate.requestedStatus),
      permission: normalizePermission(candidate.permission),
      availability: normalizeAvailability(candidate.availability),
      ambientMode: options.ambientMode ?? defaults.ambientMode,
      transitionReason: normalizeReason(candidate.transitionReason),
      transitionTimestamp:
        typeof candidate.transitionTimestamp === "string"
          ? candidate.transitionTimestamp
          : options.fallbackTimestamp,
      lastTransition: normalizeTransition(candidate.lastTransition),
      invalidTransitionCount: Number.isFinite(candidate.invalidTransitionCount)
        ? Math.max(0, Math.trunc(candidate.invalidTransitionCount ?? 0))
        : 0,
      lastError: sanitizeNullableText(candidate.lastError),
      lastInterruption: normalizeInterruption(candidate.lastInterruption),
      activeSession,
      privacy: createPrivacyState(),
    },
    options.settings,
  );
}

export function isEchoListeningTransitionAllowed(
  from: EchoListeningStatus,
  to: EchoListeningStatus,
): boolean {
  return from === to || VALID_LISTENING_TRANSITIONS[from].includes(to);
}

export function transitionEchoListeningState(
  state: EchoListeningState,
  targetStatus: EchoListeningStatus,
  input: {
    reason: EchoListeningTransitionReason;
    timestamp?: string;
    message?: string;
    error?: string | null;
    permission?: EchoListeningPermissionStatus;
    availability?: EchoMicrophoneAvailability;
    interruption?: EchoAudioSessionInterruption | null;
    activeSession?: EchoAudioSessionState;
    ambientMode?: AmbientGameplayMode;
    settings?: EchoVoiceSettings;
  },
): EchoListeningState {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const accepted = isEchoListeningTransitionAllowed(state.status, targetStatus);
  const transition = createTransition({
    from: state.status,
    to: targetStatus,
    reason: input.reason,
    timestamp,
    accepted,
    message:
      input.message ??
      (accepted
        ? `Listening transitioned from ${state.status} to ${targetStatus}.`
        : `Invalid listening transition from ${state.status} to ${targetStatus}.`),
  });
  if (!accepted) {
    return withIndicator(
      {
        ...state,
        requestedStatus: targetStatus,
        transitionReason: input.reason,
        transitionTimestamp: timestamp,
        lastTransition: transition,
        invalidTransitionCount: state.invalidTransitionCount + 1,
        lastError: input.error ?? transition.message,
      },
      input.settings,
    );
  }
  return withIndicator(
    {
      ...state,
      status: targetStatus,
      previousStatus: state.status,
      requestedStatus: targetStatus,
      permission: input.permission ?? state.permission,
      availability: input.availability ?? state.availability,
      ambientMode: input.ambientMode ?? state.ambientMode,
      transitionReason: input.reason,
      transitionTimestamp: timestamp,
      lastTransition: transition,
      lastError: input.error ?? null,
      lastInterruption:
        input.interruption === undefined
          ? state.lastInterruption
          : input.interruption,
      activeSession: input.activeSession ?? state.activeSession,
    },
    input.settings,
  );
}

export function deriveEchoListeningIndicator(
  state: Pick<EchoListeningState, "status" | "permission" | "availability">,
  settings: EchoVoiceSettings = createDefaultEchoVoiceSettings(),
): EchoListeningIndicator {
  if (!settings.voiceFeaturesEnabled && state.status !== "listening") {
    return "hidden";
  }
  if (
    state.availability === "unsupported" ||
    state.availability === "unavailable"
  ) {
    return "unavailable";
  }
  if (
    state.permission === "prompt" ||
    state.permission === "unknown" ||
    state.status === "requestingPermission"
  ) {
    return "permission-needed";
  }
  if (
    state.permission === "denied" ||
    state.permission === "permanentlyDenied" ||
    state.status === "permissionDenied"
  ) {
    return "permission-needed";
  }
  if (state.status === "listening") return "listening";
  if (state.status === "temporarilyPaused" || state.status === "interrupted") {
    return "paused";
  }
  if (state.status === "recovering" || state.status === "preparing") {
    return "recovering";
  }
  if (state.status === "failed") return "failed";
  return "ready";
}

export function getEchoListeningDiagnostics(
  state: EchoListeningState,
  listenerCount = 0,
  hasActiveStream = false,
): EchoListeningDiagnostics {
  return {
    version: state.version,
    status: state.status,
    previousStatus: state.previousStatus,
    permission: state.permission,
    availability: state.availability,
    indicator: state.indicator,
    ambientMode: state.ambientMode,
    activeSessionId: state.activeSession.sessionId,
    invalidTransitionCount: state.invalidTransitionCount,
    lastError: state.lastError,
    lastInterruption: state.lastInterruption,
    listenerCount,
    hasActiveStream,
    rawAudioRetained: false,
  };
}

export function createWebMicrophonePlatformAdapter(
  scope: typeof globalThis = globalThis,
): MicrophonePlatformAdapter {
  const browserNavigator = scope.navigator;
  return {
    platform: "web",
    isMicrophoneSupported() {
      return Boolean(browserNavigator?.mediaDevices?.getUserMedia);
    },
    async queryPermission() {
      if (!browserNavigator?.mediaDevices?.getUserMedia) return "unsupported";
      if (!browserNavigator.permissions?.query) return "unknown";
      try {
        const status = await browserNavigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        return permissionStateToEchoStatus(status.state);
      } catch {
        return "unknown";
      }
    },
    async requestPermission() {
      if (!browserNavigator?.mediaDevices?.getUserMedia) return "unsupported";
      try {
        const stream = await browserNavigator.mediaDevices.getUserMedia({
          audio: true,
        });
        for (const track of stream.getTracks()) track.stop();
        return "granted";
      } catch (error) {
        return permissionErrorToStatus(error);
      }
    },
    async createAudioSession() {
      if (!browserNavigator?.mediaDevices?.getUserMedia) {
        throw new Error("Microphone API is unavailable on this platform.");
      }
      const stream = await browserNavigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const track = stream.getAudioTracks()[0] ?? stream.getTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      return {
        id: makeId("audio-session"),
        sampleRate:
          typeof settings.sampleRate === "number" ? settings.sampleRate : null,
        channelCount:
          typeof settings.channelCount === "number"
            ? settings.channelCount
            : null,
        deviceId:
          typeof settings.deviceId === "string" ? settings.deviceId : null,
        deviceLabel: track?.label || null,
        stop() {
          for (const entry of stream.getTracks()) entry.stop();
        },
      };
    },
    async captureAudioSample(request) {
      return captureWebAudioSample(browserNavigator, request);
    },
    async openPermissionSettings() {
      return false;
    },
    subscribeToPermissionChanges(callback) {
      let disposed = false;
      let permissionStatus: PermissionStatus | null = null;
      if (!browserNavigator?.permissions?.query) return () => undefined;
      void browserNavigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((status) => {
          if (disposed) return;
          permissionStatus = status;
          status.onchange = () =>
            callback(permissionStateToEchoStatus(status.state));
        })
        .catch(() => undefined);
      return () => {
        disposed = true;
        if (permissionStatus) permissionStatus.onchange = null;
      };
    },
    subscribeToDeviceChanges(callback) {
      const mediaDevices = browserNavigator?.mediaDevices;
      if (!mediaDevices?.addEventListener) return () => undefined;
      const onDeviceChange = () => callback("audio-device-changed");
      mediaDevices.addEventListener("devicechange", onDeviceChange);
      return () =>
        mediaDevices.removeEventListener("devicechange", onDeviceChange);
    },
  };
}

export class EchoMicrophoneService {
  private state: EchoListeningState;
  private settings: EchoVoiceSettings;
  private readonly adapter: MicrophonePlatformAdapter;
  private readonly listeners = new Set<EchoListeningListener>();
  private activeSession: EchoAudioSession | null = null;
  private permissionUnsubscribe: (() => void) | null = null;
  private deviceUnsubscribe: (() => void) | null = null;

  constructor(
    adapter: MicrophonePlatformAdapter = createWebMicrophonePlatformAdapter(),
    options: {
      settings?: EchoVoiceSettings;
      state?: EchoListeningState;
      ambientMode?: AmbientGameplayMode;
      timestamp?: string;
    } = {},
  ) {
    this.adapter = adapter;
    this.settings = normalizeEchoVoiceSettings(options.settings);
    this.state = normalizeEchoListeningState(options.state, {
      fallbackTimestamp: options.timestamp ?? new Date().toISOString(),
      ambientMode: options.ambientMode,
      settings: this.settings,
      allowActiveSession: true,
    });
  }

  hydrate(
    state: unknown,
    settings: unknown,
    ambientMode: AmbientGameplayMode,
    timestamp = new Date().toISOString(),
  ): EchoListeningState {
    this.settings = normalizeEchoVoiceSettings(settings);
    this.state = normalizeEchoListeningState(state, {
      fallbackTimestamp: timestamp,
      ambientMode,
      settings: this.settings,
      allowActiveSession: true,
    });
    this.emit();
    return this.getState();
  }

  getState(): EchoListeningState {
    return cloneListeningValue(this.state);
  }

  getSettings(): EchoVoiceSettings {
    return cloneListeningValue(this.settings);
  }

  subscribe(listener: EchoListeningListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  startEnvironmentListeners(): void {
    if (!this.permissionUnsubscribe) {
      this.permissionUnsubscribe =
        this.adapter.subscribeToPermissionChanges?.((permission) => {
          void this.handlePermissionChange(permission);
        }) ?? null;
    }
    if (!this.deviceUnsubscribe) {
      this.deviceUnsubscribe =
        this.adapter.subscribeToDeviceChanges?.((interruption) => {
          void this.handleInterruption(interruption);
        }) ?? null;
    }
  }

  async configure(
    settings: Partial<EchoVoiceSettings>,
    ambientMode: AmbientGameplayMode,
  ): Promise<EchoListeningState> {
    this.settings = normalizeEchoVoiceSettings({
      ...this.settings,
      ...settings,
    });
    if (!this.settings.voiceFeaturesEnabled) {
      await this.stop("settings-updated", "manual-stop");
      this.transition("idle", {
        reason: "settings-updated",
        ambientMode,
      });
      return this.getState();
    }
    this.transition(this.state.status, {
      reason: "settings-updated",
      ambientMode,
    });
    return this.refreshAvailability(ambientMode);
  }

  async refreshAvailability(
    ambientMode: AmbientGameplayMode = this.state.ambientMode,
  ): Promise<EchoListeningState> {
    const availability = this.adapter.isMicrophoneSupported()
      ? "available"
      : "unsupported";
    const permission = await this.adapter.queryPermission();
    this.state = withIndicator(
      {
        ...this.state,
        availability,
        permission,
        ambientMode,
        transitionReason: "availability-refresh",
        transitionTimestamp: new Date().toISOString(),
        lastError:
          availability === "unsupported"
            ? "Microphone API is unavailable on this platform."
            : this.state.lastError,
      },
      this.settings,
    );
    this.emit();
    return this.getState();
  }

  async requestPermission(
    ambientMode: AmbientGameplayMode = this.state.ambientMode,
  ): Promise<EchoListeningState> {
    this.transition("requestingPermission", {
      reason: "permission-request",
      ambientMode,
    });
    if (!this.adapter.isMicrophoneSupported()) {
      this.transition("failed", {
        reason: "failure",
        availability: "unsupported",
        permission: "unsupported",
        error: "Microphone API is unavailable on this platform.",
        ambientMode,
      });
      return this.getState();
    }
    const permission = await this.adapter.requestPermission();
    if (permission === "granted") {
      this.settings = normalizeEchoVoiceSettings({
        ...this.settings,
        permissionPrimed: true,
        privacyAcknowledged: true,
      });
      this.transition("permissionGranted", {
        reason: "permission-granted",
        availability: "available",
        permission,
        ambientMode,
      });
      this.transition("ready", {
        reason: "audio-ready",
        permission,
        ambientMode,
      });
      return this.getState();
    }
    this.transition("permissionDenied", {
      reason: "permission-denied",
      availability: permission === "unsupported" ? "unsupported" : "available",
      permission,
      error:
        permission === "unsupported"
          ? "Microphone API is unavailable on this platform."
          : "Microphone permission was denied.",
      ambientMode,
    });
    return this.getState();
  }

  async startListening(
    input: {
      ambientMode?: AmbientGameplayMode;
      testSession?: boolean;
    } = {},
  ): Promise<EchoListeningState> {
    const ambientMode = input.ambientMode ?? this.state.ambientMode;
    if (!this.settings.voiceFeaturesEnabled) {
      this.transition("failed", {
        reason: "failure",
        error: "Voice features are disabled.",
        ambientMode,
      });
      return this.getState();
    }
    if (ambientMode === "recovery") {
      this.transition("temporarilyPaused", {
        reason: "ambient-mode-changed",
        interruption: "unknown",
        ambientMode,
      });
      return this.getState();
    }
    if (this.activeSession && this.state.status === "listening") {
      return this.getState();
    }
    if (this.state.status === "idle" || this.state.status === "stopped") {
      this.transition("preparing", {
        reason: "initialization",
        ambientMode,
      });
    }
    await this.refreshAvailability(ambientMode);
    if (this.state.availability !== "available") {
      this.transition("failed", {
        reason: "failure",
        error: "Microphone is unavailable.",
        ambientMode,
      });
      return this.getState();
    }
    if (this.state.permission !== "granted") {
      const permissionResult = await this.requestPermission(ambientMode);
      if (permissionResult.permission !== "granted") return permissionResult;
    }
    this.transition("initializing", {
      reason: "audio-initialization",
      ambientMode,
    });
    try {
      this.stopActiveSession(new Date().toISOString());
      this.activeSession = await this.adapter.createAudioSession();
      const audioState = audioSessionToState(this.activeSession);
      this.transition("listening", {
        reason: "listening-started",
        activeSession: audioState,
        availability: "available",
        permission: "granted",
        ambientMode,
      });
      if (input.testSession) {
        globalThis.setTimeout(() => {
          void this.stop("session-stopped", "test-complete");
        }, 1_200);
      }
    } catch (error) {
      this.stopActiveSession(new Date().toISOString());
      this.transition("failed", {
        reason: "failure",
        error:
          error instanceof Error
            ? error.message
            : "Audio initialization failed.",
        ambientMode,
      });
    }
    return this.getState();
  }

  async captureAudioSample(
    request: EchoAudioSampleRequest,
    ambientMode: AmbientGameplayMode = this.state.ambientMode,
  ): Promise<EchoAudioSampleMetrics> {
    if (!this.settings.voiceFeaturesEnabled) {
      this.transition("failed", {
        reason: "failure",
        error: "Voice features are disabled.",
        ambientMode,
      });
      throw new Error("Voice features are disabled.");
    }
    if (!this.adapter.captureAudioSample) {
      this.transition("failed", {
        reason: "failure",
        error: "Audio sampling is unavailable on this platform.",
        ambientMode,
      });
      throw new Error("Audio sampling is unavailable on this platform.");
    }
    if (this.state.status === "idle" || this.state.status === "stopped") {
      this.transition("preparing", {
        reason: "initialization",
        ambientMode,
      });
    }
    await this.refreshAvailability(ambientMode);
    if (this.state.availability !== "available") {
      this.transition("failed", {
        reason: "failure",
        error: "Microphone is unavailable.",
        ambientMode,
      });
      throw new Error("Microphone is unavailable.");
    }
    if (this.state.permission !== "granted") {
      const permissionResult = await this.requestPermission(ambientMode);
      if (permissionResult.permission !== "granted") {
        throw new Error("Microphone permission was not granted.");
      }
    }
    this.transition("initializing", {
      reason: "audio-initialization",
      ambientMode,
    });
    const sampleSession = createSampleSessionState();
    this.transition("listening", {
      reason: "listening-started",
      activeSession: sampleSession,
      permission: "granted",
      availability: "available",
      ambientMode,
    });
    try {
      return await this.adapter.captureAudioSample(request);
    } catch (error) {
      this.transition("failed", {
        reason: "failure",
        error:
          error instanceof Error ? error.message : "Audio sampling failed.",
        ambientMode,
      });
      throw error;
    } finally {
      const stoppedAt = new Date().toISOString();
      const interruption =
        request.purpose === "microphone-test" ? "test-complete" : "manual-stop";
      if (this.state.status !== "failed") {
        this.transition("stopping", {
          reason: "session-stopped",
          interruption,
          activeSession: {
            ...sampleSession,
            stoppedAt,
            sessionId: null,
          },
        });
      }
      this.transition("stopped", {
        reason: "session-stopped",
        interruption,
        activeSession: createInactiveAudioSession({ stoppedAt }),
      });
    }
  }

  async stop(
    reason: EchoListeningTransitionReason = "manual-stop",
    interruption: EchoAudioSessionInterruption = "manual-stop",
  ): Promise<EchoListeningState> {
    if (!isActiveStatus(this.state.status) && !this.activeSession) {
      this.transition("stopped", { reason, interruption });
      return this.getState();
    }
    this.transition("stopping", { reason, interruption });
    const stoppedAt = new Date().toISOString();
    this.stopActiveSession(stoppedAt);
    this.transition("stopped", {
      reason: "session-stopped",
      interruption,
      activeSession: createInactiveAudioSession({ stoppedAt }),
    });
    return this.getState();
  }

  async pause(
    interruption: EchoAudioSessionInterruption = "unknown",
  ): Promise<EchoListeningState> {
    if (this.state.status !== "listening") return this.getState();
    this.stopActiveSession(new Date().toISOString());
    this.transition("temporarilyPaused", {
      reason: "temporary-pause",
      interruption,
      activeSession: createInactiveAudioSession({
        stoppedAt: new Date().toISOString(),
      }),
    });
    return this.getState();
  }

  async recover(
    ambientMode: AmbientGameplayMode = this.state.ambientMode,
  ): Promise<EchoListeningState> {
    if (
      this.state.status !== "interrupted" &&
      this.state.status !== "temporarilyPaused" &&
      this.state.status !== "failed"
    ) {
      return this.refreshAvailability(ambientMode);
    }
    this.transition("recovering", {
      reason: "recovery",
      ambientMode,
    });
    if (!this.settings.voiceFeaturesEnabled) {
      this.transition("stopped", { reason: "recovery", ambientMode });
      return this.getState();
    }
    return this.refreshAvailability(ambientMode);
  }

  async handleInterruption(
    interruption: EchoAudioSessionInterruption,
  ): Promise<EchoListeningState> {
    if (interruption === "permission-revoked") {
      this.stopActiveSession(new Date().toISOString());
      this.transition("interrupted", {
        reason: "permission-revoked",
        permission: "denied",
        interruption,
        error: "Microphone permission was revoked.",
        activeSession: createInactiveAudioSession({
          stoppedAt: new Date().toISOString(),
        }),
      });
      return this.getState();
    }
    if (this.state.status === "listening" || this.state.status === "ready") {
      this.stopActiveSession(new Date().toISOString());
      this.transition("interrupted", {
        reason: "interruption",
        interruption,
        activeSession: createInactiveAudioSession({
          stoppedAt: new Date().toISOString(),
        }),
      });
    }
    return this.getState();
  }

  async handleLifecycleEvent(
    event: AmbientLifecycleEvent,
  ): Promise<EchoListeningState> {
    if (event.type === "app-backgrounded") {
      return this.handleInterruption("app-backgrounded");
    }
    if (event.type === "app-foregrounded") {
      return this.recover(this.state.ambientMode);
    }
    return this.pause("unknown");
  }

  async openPermissionSettings(): Promise<boolean> {
    return (await this.adapter.openPermissionSettings?.()) ?? false;
  }

  resetVoiceConfiguration(
    timestamp = new Date().toISOString(),
  ): EchoListeningState {
    this.stopActiveSession(timestamp);
    this.settings = createDefaultEchoVoiceSettings();
    this.state = transitionEchoListeningState(
      {
        ...createDefaultEchoListeningState({
          timestamp,
          ambientMode: this.state.ambientMode,
        }),
        permission: this.state.permission,
        availability: this.state.availability,
      },
      "stopped",
      {
        reason: "reset",
        timestamp,
        settings: this.settings,
        activeSession: createInactiveAudioSession({ stoppedAt: timestamp }),
      },
    );
    this.emit();
    return this.getState();
  }

  dispose(): void {
    this.stopActiveSession(new Date().toISOString());
    this.permissionUnsubscribe?.();
    this.permissionUnsubscribe = null;
    this.deviceUnsubscribe?.();
    this.deviceUnsubscribe = null;
    this.listeners.clear();
  }

  getDiagnostics(): EchoListeningDiagnostics {
    return getEchoListeningDiagnostics(
      this.state,
      this.listeners.size,
      Boolean(this.activeSession),
    );
  }

  private async handlePermissionChange(
    permission: EchoListeningPermissionStatus,
  ): Promise<void> {
    if (permission === "denied" && this.state.status === "listening") {
      await this.handleInterruption("permission-revoked");
      return;
    }
    this.state = withIndicator(
      {
        ...this.state,
        permission,
        transitionReason:
          permission === "granted"
            ? "permission-granted"
            : "permission-revoked",
        transitionTimestamp: new Date().toISOString(),
      },
      this.settings,
    );
    this.emit();
  }

  private transition(
    status: EchoListeningStatus,
    input: Omit<Parameters<typeof transitionEchoListeningState>[2], "settings">,
  ): void {
    this.state = transitionEchoListeningState(this.state, status, {
      ...input,
      settings: this.settings,
    });
    this.emit();
  }

  private stopActiveSession(stoppedAt: string): void {
    if (!this.activeSession) return;
    try {
      this.activeSession.stop();
    } finally {
      this.activeSession = null;
      this.state = {
        ...this.state,
        activeSession: {
          ...this.state.activeSession,
          stoppedAt,
          sessionId: null,
        },
      };
    }
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const echoMicrophoneService = new EchoMicrophoneService();

function withIndicator(
  state: EchoListeningState,
  settings = createDefaultEchoVoiceSettings(),
): EchoListeningState {
  return {
    ...state,
    indicator: deriveEchoListeningIndicator(state, settings),
    privacy: createPrivacyState(),
    activeSession: {
      ...state.activeSession,
      rawAudioRetained: false,
    },
  };
}

function createInactiveAudioSession(
  options: { stoppedAt?: string | null } = {},
): EchoAudioSessionState {
  return {
    sessionId: null,
    startedAt: null,
    stoppedAt: options.stoppedAt ?? null,
    sampleRate: null,
    channelCount: null,
    bufferMilliseconds: DEFAULT_AUDIO_BUFFER_MS,
    activeDeviceId: null,
    activeDeviceLabel: null,
    rawAudioRetained: false,
  };
}

function createSampleSessionState(): EchoAudioSessionState {
  const timestamp = new Date().toISOString();
  return {
    sessionId: makeId("audio-sample"),
    startedAt: timestamp,
    stoppedAt: null,
    sampleRate: null,
    channelCount: null,
    bufferMilliseconds: DEFAULT_AUDIO_BUFFER_MS,
    activeDeviceId: null,
    activeDeviceLabel: null,
    rawAudioRetained: false,
  };
}

function audioSessionToState(session: EchoAudioSession): EchoAudioSessionState {
  return {
    sessionId: session.id,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    sampleRate: session.sampleRate,
    channelCount: session.channelCount,
    bufferMilliseconds: DEFAULT_AUDIO_BUFFER_MS,
    activeDeviceId: session.deviceId,
    activeDeviceLabel: session.deviceLabel,
    rawAudioRetained: false,
  };
}

function createPrivacyState() {
  return {
    explicitOptInRequired: true as const,
    cloudTranscriptionEnabled: false as const,
    continuousConversationRecording: false as const,
    rawAudioRetention: "none" as const,
    localProcessingPreferred: true as const,
    activeIndicatorRequired: true as const,
  };
}

async function captureWebAudioSample(
  browserNavigator: Navigator | undefined,
  request: EchoAudioSampleRequest,
): Promise<EchoAudioSampleMetrics> {
  if (!browserNavigator?.mediaDevices?.getUserMedia) {
    throw new Error("Microphone API is unavailable on this platform.");
  }
  const durationMs = clampSampleDuration(request.durationMs);
  const stream = await browserNavigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const track = stream.getAudioTracks()[0] ?? stream.getTracks()[0] ?? null;
  const settings = track?.getSettings?.() ?? {};
  const audioWindow = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor =
    audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextCtor) {
    for (const entry of stream.getTracks()) entry.stop();
    throw new Error("Web Audio API is unavailable on this platform.");
  }
  const audioContext = new AudioContextCtor();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.25;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  const timeData = new Float32Array(analyser.fftSize);
  const frequencyData = new Uint8Array(analyser.frequencyBinCount);
  const rmsValues: number[] = [];
  const peakValues: number[] = [];
  let zeroCrossings = 0;
  let frameCount = 0;
  let weightedFrequency = 0;
  let frequencyMagnitude = 0;
  const startedAt = globalThis.performance?.now?.() ?? Date.now();

  try {
    while (
      (globalThis.performance?.now?.() ?? Date.now()) - startedAt <
      durationMs
    ) {
      analyser.getFloatTimeDomainData(timeData);
      analyser.getByteFrequencyData(frequencyData);
      let squareSum = 0;
      let peak = 0;
      let previous = timeData[0] ?? 0;
      for (const value of timeData) {
        squareSum += value * value;
        peak = Math.max(peak, Math.abs(value));
        if ((previous < 0 && value >= 0) || (previous >= 0 && value < 0)) {
          zeroCrossings += 1;
        }
        previous = value;
      }
      const rms = Math.sqrt(squareSum / Math.max(timeData.length, 1));
      rmsValues.push(amplitudeToDb(rms));
      peakValues.push(amplitudeToDb(peak));
      for (let index = 0; index < frequencyData.length; index += 1) {
        const magnitude = frequencyData[index];
        const frequency =
          (index * audioContext.sampleRate) / Math.max(analyser.fftSize, 1);
        weightedFrequency += frequency * magnitude;
        frequencyMagnitude += magnitude;
      }
      frameCount += 1;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 80));
    }
  } finally {
    source.disconnect();
    for (const entry of stream.getTracks()) entry.stop();
    await audioContext.close().catch(() => undefined);
  }

  const sortedRms = [...rmsValues].sort((a, b) => a - b);
  const rmsDb = average(rmsValues);
  const peakDb = Math.max(...peakValues, -120);
  const noiseFloorDb = sortedRms[Math.floor(sortedRms.length * 0.18)] ?? -120;
  const clippingRatio =
    peakValues.filter((value) => value >= -1).length /
    Math.max(peakValues.length, 1);

  return {
    capturedAt: new Date().toISOString(),
    durationMs,
    sampleRate:
      typeof settings.sampleRate === "number"
        ? settings.sampleRate
        : audioContext.sampleRate,
    channelCount:
      typeof settings.channelCount === "number" ? settings.channelCount : null,
    activeDeviceId:
      typeof settings.deviceId === "string" ? settings.deviceId : null,
    activeDeviceLabel: track?.label || null,
    rmsDb,
    peakDb,
    noiseFloorDb,
    dynamicRangeDb: peakDb - noiseFloorDb,
    clippingRatio,
    zeroCrossingRate: zeroCrossings / Math.max(frameCount * timeData.length, 1),
    spectralCentroidHz:
      frequencyMagnitude > 0 ? weightedFrequency / frequencyMagnitude : 0,
    corrupted: rmsValues.length === 0 || !Number.isFinite(rmsDb),
    rawAudioRetained: false,
  };
}

function clampSampleDuration(value: number): number {
  if (!Number.isFinite(value)) return 1_400;
  return Math.min(5_000, Math.max(700, Math.trunc(value)));
}

function amplitudeToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return -120;
  return Math.max(-120, 20 * Math.log10(value));
}

function average(values: number[]): number {
  if (values.length === 0) return -120;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createTransition(input: {
  from: EchoListeningStatus;
  to: EchoListeningStatus;
  reason: EchoListeningTransitionReason;
  timestamp: string;
  accepted: boolean;
  message: string;
}): EchoListeningTransitionRecord {
  return {
    from: input.from,
    to: input.to,
    reason: input.reason,
    requestedAt: input.timestamp,
    accepted: input.accepted,
    message: input.message,
  };
}

function normalizeAudioSession(value: unknown): EchoAudioSessionState {
  if (!value || typeof value !== "object") return createInactiveAudioSession();
  const candidate = value as Partial<EchoAudioSessionState>;
  return {
    sessionId:
      typeof candidate.sessionId === "string" ? candidate.sessionId : null,
    startedAt:
      typeof candidate.startedAt === "string" ? candidate.startedAt : null,
    stoppedAt:
      typeof candidate.stoppedAt === "string" ? candidate.stoppedAt : null,
    sampleRate:
      typeof candidate.sampleRate === "number" ? candidate.sampleRate : null,
    channelCount:
      typeof candidate.channelCount === "number"
        ? candidate.channelCount
        : null,
    bufferMilliseconds: Number.isFinite(candidate.bufferMilliseconds)
      ? Math.max(0, Math.trunc(candidate.bufferMilliseconds ?? 0))
      : DEFAULT_AUDIO_BUFFER_MS,
    activeDeviceId:
      typeof candidate.activeDeviceId === "string"
        ? candidate.activeDeviceId
        : null,
    activeDeviceLabel:
      typeof candidate.activeDeviceLabel === "string"
        ? candidate.activeDeviceLabel.slice(0, 120)
        : null,
    rawAudioRetained: false,
  };
}

function normalizeTransition(
  value: unknown,
): EchoListeningTransitionRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoListeningTransitionRecord>;
  const from = normalizeStatus(candidate.from);
  const to = normalizeStatus(candidate.to);
  const reason = normalizeReason(candidate.reason);
  if (!from || !to) return null;
  return {
    from,
    to,
    reason,
    requestedAt:
      typeof candidate.requestedAt === "string"
        ? candidate.requestedAt
        : new Date().toISOString(),
    accepted: Boolean(candidate.accepted),
    message: sanitizeText(candidate.message, "Listening transition restored."),
  };
}

function permissionStateToEchoStatus(
  state: PermissionState,
): EchoListeningPermissionStatus {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "prompt";
}

function permissionErrorToStatus(
  error: unknown,
): EchoListeningPermissionStatus {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "NotAllowedError"
  ) {
    return "denied";
  }
  return "denied";
}

function cloneListeningValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeStatus(value: unknown): EchoListeningStatus | null {
  const statuses: EchoListeningStatus[] = [
    "idle",
    "preparing",
    "requestingPermission",
    "permissionGranted",
    "permissionDenied",
    "initializing",
    "ready",
    "listening",
    "temporarilyPaused",
    "interrupted",
    "recovering",
    "stopping",
    "stopped",
    "failed",
  ];
  return typeof value === "string" &&
    statuses.includes(value as EchoListeningStatus)
    ? (value as EchoListeningStatus)
    : null;
}

function normalizePermission(value: unknown): EchoListeningPermissionStatus {
  const permissions: EchoListeningPermissionStatus[] = [
    "unknown",
    "unsupported",
    "prompt",
    "granted",
    "denied",
    "permanentlyDenied",
  ];
  return typeof value === "string" &&
    permissions.includes(value as EchoListeningPermissionStatus)
    ? (value as EchoListeningPermissionStatus)
    : "unknown";
}

function normalizeAvailability(value: unknown): EchoMicrophoneAvailability {
  if (
    value === "unknown" ||
    value === "available" ||
    value === "unavailable" ||
    value === "unsupported"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeReason(value: unknown): EchoListeningTransitionReason {
  const reasons: EchoListeningTransitionReason[] = [
    "initialization",
    "availability-refresh",
    "permission-request",
    "permission-granted",
    "permission-denied",
    "permission-revoked",
    "audio-initialization",
    "audio-ready",
    "listening-started",
    "temporary-pause",
    "interruption",
    "recovery",
    "manual-stop",
    "session-stopped",
    "failure",
    "settings-updated",
    "ambient-mode-changed",
    "reset",
  ];
  return typeof value === "string" &&
    reasons.includes(value as EchoListeningTransitionReason)
    ? (value as EchoListeningTransitionReason)
    : "initialization";
}

function normalizeInterruption(
  value: unknown,
): EchoAudioSessionInterruption | null {
  const interruptions: EchoAudioSessionInterruption[] = [
    "app-backgrounded",
    "app-foregrounded",
    "audio-device-changed",
    "microphone-lost",
    "system-interruption",
    "permission-revoked",
    "manual-stop",
    "test-complete",
    "unknown",
  ];
  return typeof value === "string" &&
    interruptions.includes(value as EchoAudioSessionInterruption)
    ? (value as EchoAudioSessionInterruption)
    : null;
}

function isActiveStatus(status: EchoListeningStatus): boolean {
  return [
    "preparing",
    "requestingPermission",
    "permissionGranted",
    "initializing",
    "ready",
    "listening",
    "temporarilyPaused",
    "interrupted",
    "recovering",
    "stopping",
  ].includes(status);
}

function sanitizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 240)
    : null;
}

function sanitizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 240)
    : fallback;
}
