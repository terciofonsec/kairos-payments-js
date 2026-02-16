import type {
  PspAdapter,
  CardPaymentConfig,
  CardPaymentInstance,
  InstallmentOption,
  PaymentData
} from '../types';
import { encryptCardData } from '../crypto/encryption';

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
export class KairosEncryptedAdapter implements PspAdapter {
  readonly provider = 'KAIROS';

  private apiUrl: string = '';
  private tenantId: string = '';

  async init(_publicKey: string, options?: Record<string, unknown>): Promise<void> {
    this.apiUrl = (options?.apiUrl as string) || 'https://api.kairoshub.tech';
    this.tenantId = (options?.tenantId as string) || '';
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

    // Inject styles + form HTML
    containerEl.innerHTML = this.buildFormHtml(config);

    const form = containerEl.querySelector('[data-kairos-enc-form]') as HTMLFormElement;
    const errorEl = containerEl.querySelector('[data-kairos-enc-error]') as HTMLElement;
    const submitBtn = containerEl.querySelector('[data-kairos-enc-submit]') as HTMLButtonElement;
    const cardNumberInput = containerEl.querySelector('[data-kairos-enc-card-number]') as HTMLInputElement;
    const expiryInput = containerEl.querySelector('[data-kairos-enc-expiry]') as HTMLInputElement;
    const cvvInput = containerEl.querySelector('[data-kairos-enc-cvv]') as HTMLInputElement;
    const nameInput = containerEl.querySelector('[data-kairos-enc-name]') as HTMLInputElement;
    const installmentsSelect = containerEl.querySelector('[data-kairos-enc-installments]') as HTMLSelectElement;
    const brandBadge = containerEl.querySelector('[data-kairos-enc-brand]') as HTMLElement;

    // Card number formatting
    cardNumberInput.addEventListener('input', () => {
      const digits = cardNumberInput.value.replace(/\D/g, '').slice(0, 16);
      cardNumberInput.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
      // Detect brand
      const brand = detectCardBrand(digits);
      if (brandBadge) {
        brandBadge.textContent = brand ? brand.toUpperCase() : '';
        brandBadge.style.display = brand ? 'block' : 'none';
      }
    });

    // Expiry formatting
    expiryInput.addEventListener('input', () => {
      const digits = expiryInput.value.replace(/\D/g, '').slice(0, 4);
      if (digits.length >= 3) {
        expiryInput.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      } else {
        expiryInput.value = digits;
      }
    });

    // CVV: digits only
    cvvInput.addEventListener('input', () => {
      cvvInput.value = cvvInput.value.replace(/\D/g, '').slice(0, 4);
    });

    // Name: uppercase
    nameInput.addEventListener('input', () => {
      nameInput.value = nameInput.value.toUpperCase();
    });

    // Load installments
    if (installmentsSelect) {
      const installments = await this.getInstallments(config.amount, '');
      const limited = installments.filter(o => o.installments <= (config.maxInstallments || 12));
      installmentsSelect.innerHTML = limited.map(opt => {
        const amountStr = opt.installmentAmount.toFixed(2).replace('.', ',');
        const suffix = opt.interestFree
          ? ' sem juros'
          : ` (Total: R$ ${opt.totalAmount.toFixed(2).replace('.', ',')})`;
        return `<option value="${opt.installments}">${opt.installments}x de R$ ${amountStr}${suffix}</option>`;
      }).join('');
    }

    // Submit handler
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;

      // Validate
      const validationError = this.validate(cardNumberInput.value, expiryInput.value, cvvInput.value, nameInput.value);
      if (validationError) {
        errorEl.textContent = validationError;
        errorEl.style.display = 'block';
        config.onError?.({ code: 'VALIDATION_ERROR', message: validationError });
        return;
      }

      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = this.getLoadingButtonHtml();

      try {
        const cleanNumber = cardNumberInput.value.replace(/\D/g, '');
        const [mm, yy] = expiryInput.value.split('/');
        const expirationYear = (2000 + parseInt(yy || '0', 10)).toString();

        // Encrypt card data client-side
        const encrypted = await encryptCardData(
          {
            number: cleanNumber,
            holderName: nameInput.value.trim(),
            expirationMonth: mm,
            expirationYear,
            cvv: cvvInput.value,
          },
          this.apiUrl,
          this.tenantId
        );

        const paymentData: PaymentData = {
          token: '',
          encryptedData: encrypted,
          installments: installmentsSelect ? parseInt(installmentsSelect.value) : 1,
          paymentMethodId: detectCardBrand(cleanNumber) || 'unknown',
          issuerId: '',
          lastFourDigits: cleanNumber.slice(-4),
          cardholderName: nameInput.value.trim(),
          provider: this.provider,
        };

        await config.onSubmit(paymentData);
      } catch (err: any) {
        errorEl.textContent = err.message || 'Erro ao processar pagamento';
        errorEl.style.display = 'block';
        config.onError?.({
          code: 'ENCRYPTION_ERROR',
          message: err.message || 'Failed to encrypt card data',
          cause: err,
        });
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });

    config.onReady?.();

    return {
      updateAmount: (amount: number) => {
        const amountEl = containerEl.querySelector('[data-kairos-enc-amount]');
        if (amountEl) {
          amountEl.textContent = `R$ ${amount.toFixed(2).replace('.', ',')}`;
        }
      },
      submit: async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return {} as PaymentData;
      },
      unmount: () => {
        containerEl.innerHTML = '';
      },
    };
  }

  async getInstallments(amount: number, _bin: string): Promise<InstallmentOption[]> {
    const maxInstallments = 12;
    const options: InstallmentOption[] = [];

    for (let i = 1; i <= maxInstallments; i++) {
      const interestFree = i <= 3;
      const rate = interestFree ? 0 : 0.0199;
      const totalAmount = interestFree ? amount : amount * Math.pow(1 + rate, i);
      const installmentAmount = totalAmount / i;

      if (installmentAmount >= 5) {
        options.push({
          installments: i,
          installmentAmount: Math.round(installmentAmount * 100) / 100,
          totalAmount: Math.round(totalAmount * 100) / 100,
          interestFree,
          interestRate: interestFree ? 0 : rate * 100,
          recommended: i === 1,
        });
      }
    }

    return options;
  }

  destroy(): void {
    // No external SDK to clean up
  }

  private validate(cardNumber: string, expiry: string, cvv: string, name: string): string | null {
    const cleanNumber = cardNumber.replace(/\D/g, '');
    if (cleanNumber.length < 13) return 'Numero do cartao invalido';
    if (expiry.length < 5) return 'Data de validade invalida';

    const [mm, yy] = expiry.split('/');
    const month = parseInt(mm, 10);
    if (month < 1 || month > 12) return 'Mes invalido';

    const year = 2000 + parseInt(yy || '0', 10);
    const now = new Date();
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
      return 'Cartao expirado';
    }

    if (cvv.length < 3) return 'CVV invalido';
    if (name.trim().length < 3) return 'Nome invalido';
    return null;
  }

  private getLoadingButtonHtml(): string {
    return `
      <svg class="kairos-enc-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="32">
          <animate attributeName="stroke-dashoffset" values="32;0;32" dur="1.2s" repeatCount="indefinite"/>
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </circle>
      </svg>
      <span>Criptografando...</span>
    `;
  }

  private buildFormHtml(config: CardPaymentConfig): string {
    const amountFormatted = config.amount.toFixed(2).replace('.', ',');

    return `
      <style>
        .kairos-enc-form {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .kairos-enc-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .kairos-enc-field label {
          font-size: 13px;
          font-weight: 500;
          color: #374151;
        }
        .kairos-enc-field input,
        .kairos-enc-field select {
          height: 44px;
          padding: 0 12px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 15px;
          color: #111827;
          background: #fff;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          -webkit-appearance: none;
        }
        .kairos-enc-field input:focus,
        .kairos-enc-field select:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .kairos-enc-field input::placeholder {
          color: #9ca3af;
        }
        .kairos-enc-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .kairos-enc-card-number-wrapper {
          position: relative;
        }
        .kairos-enc-brand {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11px;
          font-weight: 700;
          color: #6b7280;
          letter-spacing: 0.05em;
          display: none;
        }
        .kairos-enc-error {
          display: none;
          padding: 10px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #dc2626;
          font-size: 13px;
        }
        .kairos-enc-security {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 10px;
        }
        .kairos-enc-security-icon {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          color: #059669;
        }
        .kairos-enc-security-text {
          flex: 1;
        }
        .kairos-enc-security-text strong {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #065f46;
        }
        .kairos-enc-security-text span {
          font-size: 11px;
          color: #047857;
          opacity: 0.8;
        }
        .kairos-enc-security-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .kairos-enc-security-badge svg {
          width: 12px;
          height: 12px;
          color: #10b981;
        }
        .kairos-enc-security-badge span {
          font-size: 9px;
          font-weight: 800;
          color: #047857;
          letter-spacing: 0.12em;
        }
        .kairos-enc-submit {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          height: 52px;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          color: #fff;
          background: linear-gradient(135deg, #7c3aed 0%, #9333ea 100%);
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .kairos-enc-submit:hover:not(:disabled) {
          opacity: 0.92;
        }
        .kairos-enc-submit:active:not(:disabled) {
          transform: scale(0.98);
        }
        .kairos-enc-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .kairos-enc-submit svg {
          width: 20px;
          height: 20px;
        }
        .kairos-enc-spinner {
          animation: kairos-enc-spin 0.8s linear infinite;
        }
        @keyframes kairos-enc-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-color-scheme: dark) {
          .kairos-enc-field label { color: #d1d5db; }
          .kairos-enc-field input,
          .kairos-enc-field select {
            background: #1f2937;
            border-color: #374151;
            color: #f3f4f6;
          }
          .kairos-enc-field input:focus,
          .kairos-enc-field select:focus {
            border-color: #8b5cf6;
            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
          }
          .kairos-enc-field input::placeholder { color: #6b7280; }
          .kairos-enc-brand { color: #9ca3af; }
          .kairos-enc-error {
            background: #451a1a;
            border-color: #7f1d1d;
            color: #fca5a5;
          }
          .kairos-enc-security {
            background: linear-gradient(135deg, #064e3b20 0%, #06543420 100%);
            border-color: rgba(16, 185, 129, 0.15);
          }
          .kairos-enc-security-text strong { color: #6ee7b7; }
          .kairos-enc-security-text span { color: #34d399; }
          .kairos-enc-security-badge span { color: #6ee7b7; }
        }
      </style>

      <form class="kairos-enc-form" data-kairos-enc-form>
        <div data-kairos-enc-error class="kairos-enc-error"></div>

        <div class="kairos-enc-field">
          <label>Numero do Cartao</label>
          <div class="kairos-enc-card-number-wrapper">
            <input
              type="text"
              inputmode="numeric"
              placeholder="0000 0000 0000 0000"
              maxlength="19"
              autocomplete="cc-number"
              data-kairos-enc-card-number
            />
            <span class="kairos-enc-brand" data-kairos-enc-brand></span>
          </div>
        </div>

        <div class="kairos-enc-row">
          <div class="kairos-enc-field">
            <label>Validade</label>
            <input
              type="text"
              inputmode="numeric"
              placeholder="MM/AA"
              maxlength="5"
              autocomplete="cc-exp"
              data-kairos-enc-expiry
            />
          </div>
          <div class="kairos-enc-field">
            <label>CVV</label>
            <input
              type="text"
              inputmode="numeric"
              placeholder="123"
              maxlength="4"
              autocomplete="cc-csc"
              data-kairos-enc-cvv
            />
          </div>
        </div>

        <div class="kairos-enc-field">
          <label>Nome no Cartao</label>
          <input
            type="text"
            placeholder="NOME COMO NO CARTAO"
            autocomplete="cc-name"
            data-kairos-enc-name
          />
        </div>

        ${config.showInstallments !== false ? `
        <div class="kairos-enc-field">
          <label>Parcelas</label>
          <select data-kairos-enc-installments>
            <option value="1">1x de R$ ${amountFormatted} sem juros</option>
          </select>
        </div>
        ` : ''}

        <div class="kairos-enc-security">
          <svg class="kairos-enc-security-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
          <div class="kairos-enc-security-text">
            <strong>Pagamento Seguro</strong>
            <span>Dados criptografados de ponta a ponta via Kairos Payment Hub</span>
          </div>
          <div class="kairos-enc-security-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>KAIROS</span>
          </div>
        </div>

        <button type="submit" class="kairos-enc-submit" data-kairos-enc-submit>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          <span>Pagar <span data-kairos-enc-amount>R$ ${amountFormatted}</span></span>
        </button>
      </form>
    `;
  }
}

/** Detect card brand from BIN (first digits). */
function detectCardBrand(number: string): string {
  const clean = number.replace(/\D/g, '');
  if (/^4/.test(clean)) return 'visa';
  if (/^5[1-5]/.test(clean)) return 'mastercard';
  if (/^3[47]/.test(clean)) return 'amex';
  if (/^(636368|438935|504175|451416|636297)/.test(clean) || /^(5067|4576|4011)/.test(clean)) return 'elo';
  if (/^606282/.test(clean)) return 'hipercard';
  return '';
}
