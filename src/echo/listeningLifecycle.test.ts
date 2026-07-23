import { describe, expect, it, vi } from "vitest";
import {
  EchoMicrophoneService,
  createDefaultEchoListeningState,
  createDefaultEchoVoiceSettings,
  isEchoListeningTransitionAllowed,
  normalizeEchoListeningState,
  transitionEchoListeningState,
} from "./microphoneService";
import type {
  EchoAudioSession,
  MicrophonePlatformAdapter,
} from "./microphoneService";
import type {
  EchoAudioSessionInterruption,
  EchoAudioSampleMetrics,
  EchoAudioSampleRequest,
  EchoListeningPermissionStatus,
} from "./listeningTypes";

class FakeMicrophoneAdapter implements MicrophonePlatformAdapter {
  readonly platform = "web" as const;
  supported = true;
  permission: EchoListeningPermissionStatus = "prompt";
  createdSessions = 0;
  stoppedSessions = 0;
  capturedSamples = 0;
  captureFailure: Error | null = null;
  permissionListener:
    | ((permission: EchoListeningPermissionStatus) => void)
    | null = null;
  deviceListener: ((reason: EchoAudioSessionInterruption) => void) | null =
    null;

  isMicrophoneSupported() {
    return this.supported;
  }

  async queryPermission() {
    return this.supported ? this.permission : "unsupported";
  }

  async requestPermission() {
    if (!this.supported) return "unsupported";
    return this.permission;
  }

  async createAudioSession(): Promise<EchoAudioSession> {
    if (!this.supported) {
      throw new Error("No microphone available.");
    }
    this.createdSessions += 1;
    const id = `session-${this.createdSessions}`;
    return {
      id,
      sampleRate: 48_000,
      channelCount: 1,
      deviceId: "fake-device",
      deviceLabel: "Fake microphone",
      stop: () => {
        this.stoppedSessions += 1;
      },
    };
  }

  async captureAudioSample(
    request: EchoAudioSampleRequest,
  ): Promise<EchoAudioSampleMetrics> {
    if (this.captureFailure) throw this.captureFailure;
    this.capturedSamples += 1;
    return {
      capturedAt: "2026-07-22T00:00:00.000Z",
      durationMs: request.durationMs,
      sampleRate: 48_000,
      channelCount: 1,
      activeDeviceId: "fake-device",
      activeDeviceLabel: "Fake microphone",
      rmsDb: -36,
      peakDb: -8,
      noiseFloorDb: -64,
      dynamicRangeDb: 56,
      clippingRatio: 0.001,
      zeroCrossingRate: 0.05,
      spectralCentroidHz: 1_200,
      corrupted: false,
      rawAudioRetained: false,
    };
  }

  subscribeToPermissionChanges(
    callback: (permission: EchoListeningPermissionStatus) => void,
  ) {
    this.permissionListener = callback;
    return () => {
      this.permissionListener = null;
    };
  }

  subscribeToDeviceChanges(
    callback: (reason: EchoAudioSessionInterruption) => void,
  ) {
    this.deviceListener = callback;
    return () => {
      this.deviceListener = null;
    };
  }

  emitPermission(permission: EchoListeningPermissionStatus) {
    this.permission = permission;
    this.permissionListener?.(permission);
  }

  emitDeviceChange(reason: EchoAudioSessionInterruption) {
    this.deviceListener?.(reason);
  }
}

describe("Echo listening lifecycle and microphone privacy architecture", () => {
  it("initializes with opt-in privacy defaults and no exposed listening state", () => {
    const state = createDefaultEchoListeningState({
      timestamp: "2026-07-21T00:00:00.000Z",
    });

    expect(state.status).toBe("idle");
    expect(state.indicator).toBe("hidden");
    expect(state.activeSession.rawAudioRetained).toBe(false);
    expect(state.privacy.rawAudioRetention).toBe("none");
    expect(state.privacy.cloudTranscriptionEnabled).toBe(false);
    expect(createDefaultEchoVoiceSettings().voiceFeaturesEnabled).toBe(false);
  });

  it("allows valid transitions and rejects invalid transitions without crashing", () => {
    const state = createDefaultEchoListeningState({
      timestamp: "2026-07-21T00:00:00.000Z",
    });
    expect(
      isEchoListeningTransitionAllowed("idle", "requestingPermission"),
    ).toBe(true);
    expect(isEchoListeningTransitionAllowed("idle", "listening")).toBe(false);

    const invalid = transitionEchoListeningState(state, "listening", {
      reason: "listening-started",
      timestamp: "2026-07-21T00:00:01.000Z",
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
      },
    });

    expect(invalid.status).toBe("idle");
    expect(invalid.invalidTransitionCount).toBe(1);
    expect(invalid.lastTransition?.accepted).toBe(false);
  });

  it("requests permission and reaches ready state without retaining audio", async () => {
    const adapter = new FakeMicrophoneAdapter();
    adapter.permission = "granted";
    const service = new EchoMicrophoneService(adapter, {
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
      },
    });

    const state = await service.requestPermission("preTurnPreparation");

    expect(state.status).toBe("ready");
    expect(state.permission).toBe("granted");
    expect(service.getSettings().permissionPrimed).toBe(true);
    expect(adapter.createdSessions).toBe(0);
    expect(state.activeSession.rawAudioRetained).toBe(false);
  });

  it("starts one active session, ignores duplicate start requests, and cleans up on stop", async () => {
    const adapter = new FakeMicrophoneAdapter();
    adapter.permission = "granted";
    const service = new EchoMicrophoneService(adapter, {
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
        ambientListeningEnabled: true,
      },
    });

    const listening = await service.startListening({
      ambientMode: "activeTurn",
    });
    const duplicate = await service.startListening({
      ambientMode: "activeTurn",
    });

    expect(listening.status).toBe("listening");
    expect(duplicate.activeSession.sessionId).toBe("session-1");
    expect(adapter.createdSessions).toBe(1);

    const stopped = await service.stop();
    expect(stopped.status).toBe("stopped");
    expect(stopped.activeSession.sessionId).toBeNull();
    expect(adapter.stoppedSessions).toBe(1);
  });

  it("handles denied and unsupported permission states safely", async () => {
    const deniedAdapter = new FakeMicrophoneAdapter();
    deniedAdapter.permission = "denied";
    const denied = new EchoMicrophoneService(deniedAdapter, {
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
      },
    });

    const deniedState = await denied.startListening();
    expect(deniedState.status).toBe("permissionDenied");
    expect(deniedState.permission).toBe("denied");
    expect(deniedAdapter.createdSessions).toBe(0);

    const unsupportedAdapter = new FakeMicrophoneAdapter();
    unsupportedAdapter.supported = false;
    const unsupported = new EchoMicrophoneService(unsupportedAdapter, {
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
      },
    });

    const unsupportedState = await unsupported.startListening();
    expect(unsupportedState.status).toBe("failed");
    expect(unsupportedState.availability).toBe("unsupported");
  });

  it("handles interruptions, permission revocation, and foreground recovery", async () => {
    const adapter = new FakeMicrophoneAdapter();
    adapter.permission = "granted";
    const service = new EchoMicrophoneService(adapter, {
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
      },
    });
    service.startEnvironmentListeners();
    await service.startListening({ ambientMode: "combat" });

    adapter.emitDeviceChange("audio-device-changed");
    expect(service.getState().status).toBe("interrupted");
    expect(service.getState().lastInterruption).toBe("audio-device-changed");
    expect(adapter.stoppedSessions).toBe(1);

    const recovered = await service.handleLifecycleEvent({
      type: "app-foregrounded",
      timestamp: "2026-07-21T00:00:00.000Z",
    });
    expect(recovered.status).toBe("recovering");

    await service.startListening({ ambientMode: "activeTurn" });
    adapter.emitPermission("denied");
    expect(service.getState().status).toBe("interrupted");
    expect(service.getState().permission).toBe("denied");
  });

  it("normalizes unsafe persisted active sessions to a stopped safe fallback", () => {
    const normalized = normalizeEchoListeningState(
      {
        status: "listening",
        permission: "granted",
        availability: "available",
        activeSession: {
          sessionId: "stale-session",
          startedAt: "2026-07-21T00:00:00.000Z",
          rawAudioRetained: true,
        },
      },
      {
        fallbackTimestamp: "2026-07-21T00:00:01.000Z",
        allowActiveSession: false,
      },
    );

    expect(normalized.status).toBe("stopped");
    expect(normalized.activeSession.sessionId).toBeNull();
    expect(normalized.activeSession.rawAudioRetained).toBe(false);
  });

  it("stops and disposes active resources when voice features are disabled", async () => {
    vi.useFakeTimers();
    const adapter = new FakeMicrophoneAdapter();
    adapter.permission = "granted";
    const service = new EchoMicrophoneService(adapter, {
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
      },
    });

    await service.startListening({ testSession: true });
    expect(service.getState().status).toBe("listening");

    const disabled = await service.configure(
      { voiceFeaturesEnabled: false },
      "passive",
    );
    expect(disabled.status).toBe("idle");
    expect(service.getSettings().voiceFeaturesEnabled).toBe(false);
    expect(adapter.stoppedSessions).toBe(1);

    service.dispose();
    vi.useRealTimers();
  });

  it("captures short privacy-safe audio samples through the single microphone service", async () => {
    const adapter = new FakeMicrophoneAdapter();
    adapter.permission = "granted";
    const service = new EchoMicrophoneService(adapter, {
      settings: {
        ...createDefaultEchoVoiceSettings(),
        voiceFeaturesEnabled: true,
      },
    });

    const metrics = await service.captureAudioSample({
      purpose: "voice-enrollment",
      durationMs: 1_500,
    });

    expect(metrics.rawAudioRetained).toBe(false);
    expect(metrics.rmsDb).toBe(-36);
    expect(adapter.capturedSamples).toBe(1);
    expect(service.getState().status).toBe("stopped");
    expect(service.getState().activeSession.rawAudioRetained).toBe(false);
  });
});
