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

      {!loading && !error && (
        <div className="kairos-branding" style={brandingStyles}>
          <KairosLogo />
          <span style={brandingTextStyle}>Powered by Kairos</span>
        </div>
      )}
    </div>
  );
}

const brandingStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '8px 0 4px',
  opacity: 0.6,
};

const brandingTextStyle: React.CSSProperties = {
  fontSize: '11px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#6b7280',
  letterSpacing: '0.02em',
};

function KairosLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2L2 7v10l10 5 10-5V7L12 2z"
        stroke="#6b7280"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 7v10M8 9l4 3 4-3M8 15l4-3 4 3"
        stroke="#6b7280"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
