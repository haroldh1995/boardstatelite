import { makeId } from "../domain/cards";
import type {
  EchoAudioSession,
  MicrophonePlatformAdapter,
} from "../echo/microphoneService";
import type {
  EchoAudioSampleMetrics,
  EchoAudioSampleRequest,
  EchoListeningPermissionStatus,
} from "../echo/listeningTypes";
import { monotonicNowMs, sleepMs } from "./runtime";

type WebMicrophoneScope = typeof globalThis & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

export function createWebMicrophonePlatformAdapter(
  scope: WebMicrophoneScope = globalThis,
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
    async createAudioSession(): Promise<EchoAudioSession> {
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
      return captureWebAudioSample(scope, browserNavigator, request);
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

async function captureWebAudioSample(
  scope: WebMicrophoneScope,
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
  const AudioContextCtor = scope.AudioContext ?? scope.webkitAudioContext;
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
  const startedAt = monotonicNowMs();

  try {
    while (monotonicNowMs() - startedAt < durationMs) {
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
      await sleepMs(80);
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
