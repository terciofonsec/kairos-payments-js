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

import { useEffect, useRef, useState } from 'react';
import { KairosPayments } from '../core/KairosPayments';
import type { CardPaymentConfig, PaymentData, PaymentError, KairosConfig } from '../types';

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
  preferredProvider?: 'MERCADOPAGO' | 'PAGSEGURO';

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

export function CardPaymentForm({
  tenantId,
  amount,
  environment = 'production',
  apiUrl,
  preferredProvider,
  maxInstallments = 12,
  onSuccess,
  onError,
  onReady,
  className,
  debug = false
}: CardPaymentFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const kairosRef = useRef<KairosPayments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initKairos() {
      if (!containerRef.current) return;

      try {
        setLoading(true);
        setError(null);

        const config: KairosConfig = {
          tenantId,
          environment,
          apiUrl,
          preferredProvider,
          debug
        };

        const kairos = await KairosPayments.init(config);

        if (!mounted) {
          kairos.destroy();
          return;
        }

        kairosRef.current = kairos;

        const paymentConfig: CardPaymentConfig = {
          amount,
          maxInstallments,
          onReady: () => {
            setLoading(false);
            onReady?.();
          },
          onSubmit: async (data) => {
            onSuccess(data);
          },
          onError: (err) => {
            setError(err.message);
            onError?.(err);
          }
        };

        await kairos.createCardPayment(containerRef.current, paymentConfig);
      } catch (err: any) {
        if (mounted) {
          const errorMessage = err.message || 'Failed to initialize payment form';
          setError(errorMessage);
          setLoading(false);
          onError?.({
            code: 'INIT_ERROR',
            message: errorMessage,
            cause: err
          });
        }
      }
    }

    initKairos();

    return () => {
      mounted = false;
      if (kairosRef.current) {
        kairosRef.current.destroy();
        kairosRef.current = null;
      }
    };
  }, [tenantId, amount, environment, apiUrl, preferredProvider]);

  return (
    <div className={className}>
      {loading && (
        <div className="kairos-loading">
          <div className="kairos-spinner" />
          <span>Carregando formulario de pagamento...</span>
        </div>
      )}

      {error && (
        <div className="kairos-error">
          <span>{error}</span>
        </div>
      )}

      <div
        ref={containerRef}
        id="kairos-card-payment-container"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  );
}
