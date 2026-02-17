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
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'AUTHORIZED' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'CHARGEBACK';
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
export declare class PaymentPoller {
    private config;
    private timer;
    private timeoutTimer;
    private lastStatus;
    private running;
    constructor(config: PaymentPollerConfig);
    /** Start polling. Safe to call multiple times (no-op if already running). */
    start(): void;
    /** Stop polling and clean up timers. */
    stop(): void;
    /** Whether the poller is currently active. */
    get isRunning(): boolean;
    private poll;
}
