import type { PspAdapter, CardPaymentConfig, CardPaymentInstance, InstallmentOption } from '../types';
declare global {
    interface Window {
        PagSeguro: any;
    }
}
/**
 * PagSeguro (PagBank) Adapter
 *
 * @see https://dev.pagbank.uol.com.br/docs
 */
export declare class PagSeguroAdapter implements PspAdapter {
    readonly provider = "PAGSEGURO";
    private publicKey;
    private environment;
    /**
     * Load PagSeguro SDK script dynamically.
     */
    private loadScript;
    init(publicKey: string, options?: Record<string, unknown>): Promise<void>;
    createCardPayment(container: string | HTMLElement, config: CardPaymentConfig): Promise<CardPaymentInstance>;
    private createFormHtml;
    private tokenizeCard;
    getInstallments(amount: number, bin: string): Promise<InstallmentOption[]>;
    destroy(): void;
}
