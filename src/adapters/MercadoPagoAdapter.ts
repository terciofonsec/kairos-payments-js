import type {
  PspAdapter,
  CardPaymentConfig,
  CardPaymentInstance,
  InstallmentOption,
  PaymentData
} from '../types';

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
export class MercadoPagoAdapter implements PspAdapter {
  readonly provider = 'MERCADOPAGO';

  private mp: any = null;
  private bricksBuilder: any = null;
  private cardPaymentBrick: any = null;
  private publicKey: string = '';

  /**
   * Load MercadoPago SDK script dynamically.
   */
  private async loadScript(): Promise<void> {
    if (window.MercadoPago) {
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdk.mercadopago.com/js/v2';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load MercadoPago SDK'));
      document.head.appendChild(script);
    });
  }

  async init(publicKey: string, options?: Record<string, unknown>): Promise<void> {
    this.publicKey = publicKey;

    await this.loadScript();

    this.mp = new window.MercadoPago(publicKey, {
      locale: options?.locale || 'pt-BR'
    });

    this.bricksBuilder = this.mp.bricks();
  }

  async createCardPayment(
    container: string | HTMLElement,
    config: CardPaymentConfig
  ): Promise<CardPaymentInstance> {
    const containerId = typeof container === 'string'
      ? container.replace('#', '')
      : container.id;

    // Clear any existing brick
    if (this.cardPaymentBrick) {
      await this.cardPaymentBrick.unmount();
    }

    const settings = {
      initialization: {
        amount: config.amount,
        payer: {
          email: ''
        }
      },
      customization: {
        visual: {
          style: {
            customVariables: {
              formBackgroundColor: config.styles?.primaryColor || '#ffffff',
              baseColor: config.styles?.primaryColor || '#1a1a1a'
            }
          }
        },
        paymentMethods: {
          maxInstallments: config.maxInstallments || 12
        }
      },
      callbacks: {
        onReady: () => {
          config.onReady?.();
        },
        onSubmit: async (cardFormData: any) => {
          const paymentData: PaymentData = {
            token: cardFormData.token,
            installments: cardFormData.installments,
            paymentMethodId: cardFormData.payment_method_id,
            issuerId: cardFormData.issuer_id,
            lastFourDigits: cardFormData.last_four_digits || '',
            cardholderName: cardFormData.cardholder?.name || '',
            provider: this.provider
          };

          await config.onSubmit(paymentData);
        },
        onError: (error: any) => {
          config.onError?.({
            code: error.type || 'UNKNOWN',
            message: error.message || 'An error occurred',
            cause: error
          });
        }
      }
    };

    this.cardPaymentBrick = await this.bricksBuilder.create(
      'cardPayment',
      containerId,
      settings
    );

    return {
      updateAmount: (amount: number) => {
        // MercadoPago Bricks doesn't support dynamic amount update
        // Would need to recreate the brick
        console.warn('MercadoPago Bricks does not support dynamic amount update');
      },
      submit: async () => {
        // Bricks handles submission internally
        throw new Error('Use form submission instead');
      },
      unmount: () => {
        this.cardPaymentBrick?.unmount();
        this.cardPaymentBrick = null;
      }
    };
  }

  async getInstallments(amount: number, bin: string): Promise<InstallmentOption[]> {
    const response = await this.mp.getInstallments({
      amount: String(amount),
      bin: bin
    });

    if (!response || response.length === 0) {
      return [];
    }

    const payerCosts = response[0].payer_costs || [];

    return payerCosts.map((cost: any, index: number) => ({
      installments: cost.installments,
      installmentAmount: cost.installment_amount,
      totalAmount: cost.total_amount,
      interestFree: cost.installment_rate === 0,
      interestRate: cost.installment_rate,
      recommended: index === 0
    }));
  }

  destroy(): void {
    if (this.cardPaymentBrick) {
      this.cardPaymentBrick.unmount();
      this.cardPaymentBrick = null;
    }
    this.mp = null;
    this.bricksBuilder = null;
  }
}
