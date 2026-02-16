import type { PspAdapter, CardPaymentConfig, CardPaymentInstance, InstallmentOption } from '../types';
/**
 * Kairos Encrypted Adapter
 *
 * Renders a native card payment form and encrypts card data client-side
 * using RSA-OAEP + AES-256-GCM before transmission.
 *
 * Used as fallback when no PSP with client-side tokenization is available
 * (e.g., Asaas), or when the tenant explicitly prefers Kairos encryption.
 *
 * Card data never leaves the browser unencrypted.
 */
export declare class KairosEncryptedAdapter implements PspAdapter {
    readonly provider = "KAIROS";
    private apiUrl;
    private tenantId;
    init(_publicKey: string, options?: Record<string, unknown>): Promise<void>;
    createCardPayment(container: string | HTMLElement, config: CardPaymentConfig): Promise<CardPaymentInstance>;
    getInstallments(amount: number, _bin: string): Promise<InstallmentOption[]>;
    destroy(): void;
    private validate;
    private getLoadingButtonHtml;
    private buildFormHtml;
}
