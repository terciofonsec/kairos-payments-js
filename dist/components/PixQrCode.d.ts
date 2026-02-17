/**
 * PixQrCode — Renders a PIX QR code with copy-paste ("copia e cola") functionality.
 *
 * This component is framework-agnostic (vanilla DOM). It renders:
 * - QR code image (from base64 or generated client-side via Canvas)
 * - Copy "copia e cola" button
 * - Countdown timer (optional, for dynamic PIX)
 * - Amount display
 *
 * Styling: Uses CSS custom properties (--kairos-*) so host apps can override
 * colors, fonts, and borders. Falls back to sensible defaults.
 *
 * @example
 * ```typescript
 * import { PixQrCode } from '@kairos/payments-js';
 *
 * const pix = new PixQrCode('#pix-container', {
 *   amount: 50.00,
 *   copyPaste: 'MDAwMjAxMjYzMzAwMTR...',
 *   qrCodeBase64: 'data:image/png;base64,...', // optional
 *   expiresAt: '2026-02-17T15:30:00Z',        // optional
 *   onCopy: () => console.log('Copied!'),
 *   onExpired: () => console.log('Expired!'),
 * });
 *
 * // Later:
 * pix.destroy();
 * ```
 */
export interface PixQrCodeConfig {
    /** Payment amount in BRL */
    amount: number;
    /** PIX copia e cola payload (the text string users paste into their bank app) */
    copyPaste: string;
    /** QR code as base64 data URI or raw base64 string (optional — generated from copyPaste if omitted) */
    qrCodeBase64?: string;
    /** Expiration timestamp ISO string (optional — no countdown if omitted) */
    expiresAt?: string;
    /** Locale for labels (default: 'pt-BR') */
    locale?: 'pt-BR' | 'en-US' | 'es';
    /** Callback when the copia e cola code is copied */
    onCopy?: () => void;
    /** Callback when the PIX expires */
    onExpired?: () => void;
    /** QR code size in pixels (default: 200) */
    qrSize?: number;
}
export interface PixQrCodeInstance {
    /** Copy the copia e cola code to clipboard programmatically */
    copyToClipboard(): Promise<void>;
    /** Destroy the component and clean up timers */
    destroy(): void;
}
export declare function createPixQrCode(container: string | HTMLElement, config: PixQrCodeConfig): PixQrCodeInstance;
