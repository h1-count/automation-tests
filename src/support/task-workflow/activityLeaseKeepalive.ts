/**
 * Host-side lease keeper for long-running candidate fragment generation.
 * It owns no work and starts no executor: a host that is already generating a
 * fragment starts it, checks it before publication, and always stops it.
 */
export class ActivityLeaseKeepalive {
  readonly intervalMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private failure?: Error;

  constructor(
    leaseMs: number,
    private readonly renew: () => Promise<unknown>
  ) {
    if (!Number.isFinite(leaseMs) || leaseMs < 3) {
      throw new Error("Activity lease keepalive requires a lease of at least 3ms.");
    }
    this.intervalMs = Math.max(1, Math.floor(leaseMs / 3));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.renewNow();
    }, this.intervalMs);
  }

  async renewNow(): Promise<void> {
    if (this.failure) return;
    try {
      await this.renew();
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      this.stop();
    }
  }

  assertHealthy(): void {
    if (this.failure) {
      throw new Error(`Activity lease renewal failed; stop new calls and reconcile: ${this.failure.message}`);
    }
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
