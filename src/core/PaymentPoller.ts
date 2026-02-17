/**
 * PaymentPoller - Polls a status endpoint until a terminal status is reached.
 *
 * The SDK doesn't call Kairos API directly (it has no auth tokens).
 * Instead, the integrator provides a `fetchStatus` function that calls their
 * own backend, which in turn proxies to the Kairos transaction status API.
 *
 * @example
 * ```typescript
 * import { PaymentPoller } from '@kairos/payments-js';
 *
 * const poller = new PaymentPoller({
 *   fetchStatus: async () => {
 *     const res = await fetch(`/api/payments/status/${transactionId}`);
 *     return res.json(); // { status: 'CONFIRMED', ... }
 *   },
 *   onStatusChange: (status, data) => {
 *     if (status === 'CONFIRMED') showSuccess();
 *   },
 *   intervalMs: 3000,
 *   timeoutMs: 300000, // 5 minutes
 * });
 *
 * poller.start();
 * // later: poller.stop();
 * ```
 */

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AUTHORIZED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'CHARGEBACK';

const TERMINAL_STATUSES: Set<string> = new Set([
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'CHARGEBACK',
]);

export interface PaymentStatusResponse {
  status: string;
  [key: string]: unknown;
}

export interface PaymentPollerConfig {
  /** Function that fetches the current payment status from your backend */
  fetchStatus: () => Promise<PaymentStatusResponse>;

  /** Called when status changes (including the first poll) */
  onStatusChange?: (status: string, data: PaymentStatusResponse) => void;

  /** Called when a terminal status is reached (CONFIRMED, FAILED, etc.) */
  onComplete?: (status: string, data: PaymentStatusResponse) => void;

  /** Called on fetch errors */
  onError?: (error: unknown) => void;

  /** Polling interval in milliseconds (default: 3000) */
  intervalMs?: number;

  /** Maximum polling duration in milliseconds (default: 300000 = 5 min) */
  timeoutMs?: number;
}

export class PaymentPoller {
  private config: Required<PaymentPollerConfig>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStatus: string | null = null;
  private running = false;

  constructor(config: PaymentPollerConfig) {
    this.config = {
      fetchStatus: config.fetchStatus,
      onStatusChange: config.onStatusChange || (() => {}),
      onComplete: config.onComplete || (() => {}),
      onError: config.onError || (() => {}),
      intervalMs: config.intervalMs ?? 3000,
      timeoutMs: config.timeoutMs ?? 300_000,
    };
  }

  /** Start polling. Safe to call multiple times (no-op if already running). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastStatus = null;

    // First poll immediately
    this.poll();

    // Then poll at interval
    this.timer = setInterval(() => this.poll(), this.config.intervalMs);

    // Auto-stop after timeout
    this.timeoutTimer = setTimeout(() => {
      this.stop();
      this.config.onStatusChange('EXPIRED', { status: 'EXPIRED', reason: 'polling_timeout' });
      this.config.onComplete('EXPIRED', { status: 'EXPIRED', reason: 'polling_timeout' });
    }, this.config.timeoutMs);
  }

  /** Stop polling and clean up timers. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /** Whether the poller is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const data = await this.config.fetchStatus();
      const status = data.status?.toUpperCase() || 'PENDING';

      if (status !== this.lastStatus) {
        this.lastStatus = status;
        this.config.onStatusChange(status, data);
      }

      if (TERMINAL_STATUSES.has(status)) {
        this.stop();
        this.config.onComplete(status, data);
      }
    } catch (error) {
      this.config.onError(error);
    }
  }
}
