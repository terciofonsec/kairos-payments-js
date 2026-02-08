import type { KairosConfig, CardPaymentConfig, TokenizationOption, InstallmentOption, CardPaymentInstance } from '../types';
/**
 * Main entry point for Kairos Payments SDK.
 *
 * @example
 * ```typescript
 * const kairos = await KairosPayments.init({
 *   tenantId: 'faithlink',
 *   environment: 'production'
 * });
 *
 * await kairos.createCardPayment('#card-form', {
 *   amount: 100.00,
 *   onSubmit: (data) => console.log(data.token)
 * });
 * ```
 */
export declare class KairosPayments {
    private config;
    private options;
    private adapter;
    private cardInstance;
    private constructor();
    /**
     * Initialize the Kairos Payments SDK.
     * Fetches available PSPs and their public keys from the Kairos API.
     */
    static init(config: KairosConfig): Promise<KairosPayments>;
    /**
     * Fetch tokenization options from Kairos API.
     */
    private fetchOptions;
    /**
     * Get the best available PSP adapter.
     */
    private getAdapter;
    /**
     * Create a card payment form.
     *
     * @param container - CSS selector or HTMLElement where the form will be mounted
     * @param config - Payment configuration
     * @returns Promise resolving to a CardPaymentInstance
     */
    createCardPayment(container: string | HTMLElement, config: CardPaymentConfig): Promise<CardPaymentInstance>;
    /**
     * Get installment options for a given amount.
     *
     * @param amount - Payment amount in BRL
     * @param bin - First 6 digits of the card number
     * @returns Promise resolving to installment options
     */
    getInstallments(amount: number, bin: string): Promise<InstallmentOption[]>;
    /**
     * Get available PSP options for this tenant.
     */
    getAvailableProviders(): TokenizationOption[];
    /**
     * Get current configuration.
     */
    getConfig(): Readonly<KairosConfig>;
    /**
     * Destroy the SDK instance and cleanup resources.
     */
    destroy(): void;
    private log;
}
