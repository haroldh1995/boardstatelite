export interface BoardStateRuntime {
  nowMs(): number;
  monotonicNowMs(): number;
  randomToken(length: number): string;
  setTimer(callback: () => void, milliseconds: number): RuntimeTimer;
  clearTimer(timer: RuntimeTimer): void;
  sleepMs(milliseconds: number): Promise<void>;
}

export type RuntimeTimer = ReturnType<typeof setTimeout>;

let activeRuntime: BoardStateRuntime = createDefaultRuntime();

export function configureBoardStateRuntime(
  runtime: Partial<BoardStateRuntime>,
): void {
  activeRuntime = {
    ...activeRuntime,
    ...runtime,
  };
}

export function resetBoardStateRuntime(): void {
  activeRuntime = createDefaultRuntime();
}

export function nowMs(): number {
  return activeRuntime.nowMs();
}

export function monotonicNowMs(): number {
  return activeRuntime.monotonicNowMs();
}

export function randomToken(length: number): string {
  return activeRuntime.randomToken(length);
}

export function createPortableId(prefix: string): string {
  return `${prefix}-${randomToken(32).toLowerCase()}`;
}

export function setRuntimeTimer(
  callback: () => void,
  milliseconds: number,
): RuntimeTimer {
  return activeRuntime.setTimer(callback, milliseconds);
}

export function clearRuntimeTimer(timer: RuntimeTimer): void {
  activeRuntime.clearTimer(timer);
}

export function sleepMs(milliseconds: number): Promise<void> {
  return activeRuntime.sleepMs(milliseconds);
}

function createDefaultRuntime(): BoardStateRuntime {
  return {
    nowMs: () => Date.now(),
    monotonicNowMs: () => globalThis.performance?.now?.() ?? Date.now(),
    randomToken: (length) => defaultRandomToken(length),
    setTimer: (callback, milliseconds) =>
      globalThis.setTimeout(callback, milliseconds),
    clearTimer: (timer) => globalThis.clearTimeout(timer),
    sleepMs: (milliseconds) =>
      new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)),
  };
}

function defaultRandomToken(length: number): string {
  const cryptoSource = globalThis.crypto;
  const source =
    cryptoSource && "randomUUID" in cryptoSource
      ? cryptoSource.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return source.toUpperCase().padEnd(length, "0").slice(0, length);
}
