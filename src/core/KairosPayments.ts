import type {
  KairosConfig,
  CardPaymentConfig,
  TokenizationOptions,
  TokenizationOption,
  InstallmentOption,
  PspAdapter,
  CardPaymentInstance
} from '../types';
import { MercadoPagoAdapter } from '../adapters/MercadoPagoAdapter';
import { PagSeguroAdapter } from '../adapters/PagSeguroAdapter';

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
export class KairosPayments {
  private config: Required<KairosConfig>;
  private options: TokenizationOption[] = [];
  private adapter: PspAdapter | null = null;
  private cardInstance: CardPaymentInstance | null = null;

  private constructor(config: KairosConfig) {
    this.config = {
      tenantId: config.tenantId,
      environment: config.environment || 'production',
      apiUrl: config.apiUrl || 'https://api.kairoshub.tech',
      preferredProvider: config.preferredProvider || undefined as any,
      locale: config.locale || 'pt-BR',
      debug: config.debug || false
    };
  }

  /**
   * Initialize the Kairos Payments SDK.
   * Fetches available PSPs and their public keys from the Kairos API.
   */
  static async init(config: KairosConfig): Promise<KairosPayments> {
    const instance = new KairosPayments(config);
    await instance.fetchOptions();
    return instance;
  }

  /**
   * Fetch tokenization options from Kairos API.
   */
  private async fetchOptions(): Promise<void> {
    const url = `${this.config.apiUrl}/api/v1/tokenization/${this.config.tenantId}/options`;

    this.log('Fetching tokenization options from', url);

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Failed to fetch tokenization options: ${response.status}`
      );
    }

    const data: TokenizationOptions = await response.json();
    this.options = data.options;

    this.log('Available PSPs:', this.options.map(o => o.provider));
  }

  /**
   * Get the best available PSP adapter.
   */
  private async getAdapter(): Promise<PspAdapter> {
    if (this.adapter) {
      return this.adapter;
    }

    // Find preferred or first available PSP
    let option = this.options[0];

    if (this.config.preferredProvider) {
      const preferred = this.options.find(
        o => o.provider === this.config.preferredProvider
      );
      if (preferred) {
        option = preferred;
      }
    }

    if (!option) {
      throw new Error('No PSP available for card payments. Contact your administrator.');
    }

    this.log('Using PSP:', option.provider);

    // Create adapter based on provider
    switch (option.provider) {
      case 'MERCADOPAGO':
        this.adapter = new MercadoPagoAdapter();
        break;
      case 'PAGSEGURO':
        this.adapter = new PagSeguroAdapter();
        break;
      default:
        throw new Error(`Unsupported PSP provider: ${option.provider}`);
    }

    // Initialize adapter with public key
    await this.adapter.init(option.publicKey, {
      locale: this.config.locale,
      environment: option.environment
    });

    return this.adapter;
  }

  /**
   * Create a card payment form.
   *
   * @param container - CSS selector or HTMLElement where the form will be mounted
   * @param config - Payment configuration
   * @returns Promise resolving to a CardPaymentInstance
   */
  async createCardPayment(
    container: string | HTMLElement,
    config: CardPaymentConfig
  ): Promise<CardPaymentInstance> {
    const adapter = await this.getAdapter();

    this.log('Creating card payment form with amount:', config.amount);

    this.cardInstance = await adapter.createCardPayment(container, config);
    return this.cardInstance;
  }

  /**
   * Get installment options for a given amount.
   *
   * @param amount - Payment amount in BRL
   * @param bin - First 6 digits of the card number
   * @returns Promise resolving to installment options
   */
  async getInstallments(amount: number, bin: string): Promise<InstallmentOption[]> {
    const adapter = await this.getAdapter();
    return adapter.getInstallments(amount, bin);
  }

  /**
   * Get available PSP options for this tenant.
   */
  getAvailableProviders(): TokenizationOption[] {
    return [...this.options];
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<KairosConfig> {
    return { ...this.config };
  }

  /**
   * Destroy the SDK instance and cleanup resources.
   */
  destroy(): void {
    if (this.cardInstance) {
      this.cardInstance.unmount();
      this.cardInstance = null;
    }
    if (this.adapter) {
      this.adapter.destroy();
      this.adapter = null;
    }
    this.options = [];
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[Kairos]', ...args);
    }
  }
}
