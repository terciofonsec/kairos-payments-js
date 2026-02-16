/**
 * React component for card payment form.
 *
 * @example
 * ```tsx
 * import { CardPaymentForm } from '@kairos/payments-js';
 *
 * function Checkout() {
 *   return (
 *     <CardPaymentForm
 *       tenantId="faithlink"
 *       amount={100.00}
 *       onSuccess={(data) => console.log('Token:', data.token)}
 *       onError={(error) => console.error(error)}
 *     />
 *   );
 * }
 * ```
 */
import type { PaymentData, PaymentError } from '../types';
export interface CardPaymentFormProps {
    /** Tenant identifier */
    tenantId: string;
    /** Payment amount in BRL */
    amount: number;
    /** Environment */
    environment?: 'sandbox' | 'production';
    /** API URL (optional) */
    apiUrl?: string;
    /** Preferred PSP provider */
    preferredProvider?: 'MERCADOPAGO' | 'PAGSEGURO' | 'KAIROS';
    /** Maximum installments */
    maxInstallments?: number;
    /** Callback on successful payment */
    onSuccess: (data: PaymentData) => void;
    /** Callback on error */
    onError?: (error: PaymentError) => void;
    /** Callback when form is ready */
    onReady?: () => void;
    /** Custom class name */
    className?: string;
    /** Debug mode */
    debug?: boolean;
}
export declare function CardPaymentForm({ tenantId, amount, environment, apiUrl, preferredProvider, maxInstallments, onSuccess, onError, onReady, className, debug }: CardPaymentFormProps): import("react/jsx-runtime").JSX.Element;
