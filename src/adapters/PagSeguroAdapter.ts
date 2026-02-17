import type {
  PspAdapter,
  CardPaymentConfig,
  CardPaymentInstance,
  InstallmentOption,
  PaymentData
} from '../types';

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
export class PagSeguroAdapter implements PspAdapter {
  readonly provider = 'PAGSEGURO';

  private publicKey: string = '';
  private environment: string = 'sandbox';

  /**
   * Load PagSeguro SDK script dynamically.
   */
  private async loadScript(): Promise<void> {
    if (window.PagSeguro) {
      return;
    }

    const scriptUrl = this.environment === 'production'
      ? 'https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js'
      : 'https://stc.sandbox.pagseguro.uol.com.br/pagseguro/api/v2/checkout/pagseguro.directpayment.js';

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load PagSeguro SDK'));
      document.head.appendChild(script);
    });
  }

  async init(publicKey: string, options?: Record<string, unknown>): Promise<void> {
    this.publicKey = publicKey;
    this.environment = (options?.environment as string) || 'sandbox';

    await this.loadScript();

    // PagSeguro requires session initialization
    // This would typically be done via your backend
  }

  async createCardPayment(
    container: string | HTMLElement,
    config: CardPaymentConfig
  ): Promise<CardPaymentInstance> {
    const containerEl = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!containerEl) {
      throw new Error(`Container not found: ${container}`);
    }

    // PagSeguro doesn't have a pre-built form like MercadoPago Bricks
    // We need to create our own form and use their tokenization API
    const formHtml = this.createFormHtml(config);
    containerEl.innerHTML = formHtml;

    const form = containerEl.querySelector('form') as HTMLFormElement;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      try {
        const formData = new FormData(form);
        const token = await this.tokenizeCard(formData);

        const paymentData: PaymentData = {
          token,
          installments: parseInt(formData.get('installments') as string) || 1,
          paymentMethodId: 'credit_card',
          issuerId: '',
          lastFourDigits: (formData.get('cardNumber') as string)?.slice(-4) || '',
          cardholderName: formData.get('cardholderName') as string || '',
          provider: this.provider
        };

        await config.onSubmit(paymentData);
      } catch (error: any) {
        config.onError?.({
          code: 'TOKENIZATION_ERROR',
          message: error.message || 'Failed to tokenize card',
          cause: error
        });
      }
    });

    config.onReady?.();

    return {
      updateAmount: (amount: number) => {
        const amountEl = form.querySelector('[data-amount]');
        if (amountEl) {
          amountEl.textContent = `R$ ${amount.toFixed(2)}`;
        }
      },
      submit: async () => {
        form.dispatchEvent(new Event('submit'));
        return {} as PaymentData; // Will be handled by onSubmit
      },
      unmount: () => {
        containerEl.innerHTML = '';
      }
    };
  }

  private createFormHtml(config: CardPaymentConfig): string {
    return `
      <form class="kairos-card-form" data-kairos-form>
        <div class="kairos-field">
          <label for="cardNumber">Numero do Cartao</label>
          <input type="text" id="cardNumber" name="cardNumber"
                 placeholder="0000 0000 0000 0000"
                 maxlength="19" required />
        </div>

        <div class="kairos-field-row">
          <div class="kairos-field">
            <label for="expiry">Validade</label>
            <input type="text" id="expiry" name="expiry"
                   placeholder="MM/AA" maxlength="5" required />
          </div>
          <div class="kairos-field">
            <label for="cvv">CVV</label>
            <input type="text" id="cvv" name="cvv"
                   placeholder="123" maxlength="3" required />
          </div>
        </div>

        <div class="kairos-field">
          <label for="cardholderName">Nome no Cartao</label>
          <input type="text" id="cardholderName" name="cardholderName"
                 placeholder="NOME COMO NO CARTAO" required />
        </div>

        ${config.showInstallments !== false ? `
        <div class="kairos-field">
          <label for="installments">Parcelas</label>
          <select id="installments" name="installments">
            <option value="1">1x de R$ ${config.amount.toFixed(2)}</option>
          </select>
        </div>
        ` : ''}

        <button type="submit" class="kairos-submit-btn">
          Pagar <span data-amount>R$ ${config.amount.toFixed(2)}</span>
        </button>
      </form>
    `;
  }

  private async tokenizeCard(formData: FormData): Promise<string> {
    // PagSeguro card tokenization
    // In a real implementation, this would call PagSeguro's API
    const cardNumber = (formData.get('cardNumber') as string)?.replace(/\s/g, '');
    const [expMonth, expYear] = (formData.get('expiry') as string)?.split('/') || [];
    const cvv = formData.get('cvv') as string;
    const cardholderName = formData.get('cardholderName') as string;

    // Call PagSeguro tokenization API
    const response = await fetch('https://api.pagseguro.com/public-keys/card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.publicKey
      },
      body: JSON.stringify({
        card: {
          number: cardNumber,
          exp_month: expMonth,
          exp_year: `20${expYear}`,
          security_code: cvv,
          holder: {
            name: cardholderName
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error('Failed to tokenize card with PagSeguro');
    }

    const data = await response.json();
    return data.encrypted;
  }

  async getInstallments(amount: number, bin: string): Promise<InstallmentOption[]> {
    // PagSeguro installment calculation
    // This would typically be done via your backend
    const maxInstallments = 12;
    const options: InstallmentOption[] = [];

    for (let i = 1; i <= maxInstallments; i++) {
      const interestFree = i <= 3;
      const rate = interestFree ? 0 : 0.0199; // 1.99% per month
      const totalAmount = interestFree ? amount : amount * Math.pow(1 + rate, i);
      const installmentAmount = totalAmount / i;

      if (installmentAmount >= 5) { // Minimum R$ 5 per installment
        options.push({
          installments: i,
          installmentAmount: Math.round(installmentAmount * 100) / 100,
          totalAmount: Math.round(totalAmount * 100) / 100,
          interestFree,
          interestRate: interestFree ? 0 : rate * 100,
          recommended: i === 1
        });
      }
    }

    return options;
  }

  destroy(): void {
    // Cleanup if needed
  }
}
