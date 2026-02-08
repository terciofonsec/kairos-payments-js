import type { PspAdapter, CardPaymentConfig, CardPaymentInstance, InstallmentOption } from '../types';
declare global {
    interface Window {
        MercadoPago: any;
    }
}
/**
 * MercadoPago Adapter
 *
 * Uses MercadoPago Bricks for card payment UI.
 * @see https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks
 */
export declare class MercadoPagoAdapter implements PspAdapter {
    readonly provider = "MERCADOPAGO";
    private mp;
    private bricksBuilder;
    private cardPaymentBrick;
    private publicKey;
    /**
     * Load MercadoPago SDK script dynamically.
     */
    private loadScript;
    init(publicKey: string, options?: Record<string, unknown>): Promise<void>;
    createCardPayment(container: string | HTMLElement, config: CardPaymentConfig): Promise<CardPaymentInstance>;
    getInstallments(amount: number, bin: string): Promise<InstallmentOption[]>;
    destroy(): void;
}
