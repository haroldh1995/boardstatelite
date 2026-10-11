export type InteractionEnd = "commit" | "discard";

// Adapters own gestures; this coordinator owns cancellation, never game state.
class InteractionCoordinator {
  private hold: (() => void) | null = null;
  private listeners = new Set<(reason: InteractionEnd) => void>();
  ownHold(cancel: () => void): () => void {
    this.cancelHold();
    this.hold = cancel;
    return () => {
      if (this.hold === cancel) this.hold = null;
    };
  }
  cancelHold(): void {
    const cancel = this.hold;
    this.hold = null;
    cancel?.();
  }
  subscribe(listener: (reason: InteractionEnd) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  end(reason: InteractionEnd = "commit"): void {
    this.cancelHold();
    for (const listener of [...this.listeners]) listener(reason);
  }
}
export const interactions = new InteractionCoordinator();

export interface RepeatScheduler {
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}
export class HoldRepeater {
  private handle: unknown = null;
  private generation = 0;
  private active = false;
  private readonly scheduler: RepeatScheduler;
  constructor(scheduler: RepeatScheduler) {
    this.scheduler = scheduler;
  }
  start(step: () => void): void {
    this.stop();
    this.active = true;
    const generation = this.generation;
    let count = 0;
    const repeat = () => {
      if (!this.active || generation !== this.generation) return;
      this.handle = null;
      step();
      if (!this.active || generation !== this.generation) return;
      count += 1;
      this.handle = this.scheduler.schedule(repeat, count > 20 ? 95 : 140);
    };
    step();
    if (this.active && generation === this.generation)
      this.handle = this.scheduler.schedule(repeat, 430);
  }
  stop(): void {
    this.active = false;
    this.generation += 1;
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
  }
}
