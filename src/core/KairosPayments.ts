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
import { KairosEncryptedAdapter } from '../adapters/KairosEncryptedAdapter';

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
   * Non-fatal: if no PSP options are available, KairosEncryptedAdapter is used as fallback.
   */
  private async fetchOptions(): Promise<void> {
    const url = `${this.config.apiUrl}/api/v1/tokenization/${this.config.tenantId}/options`;

    this.log('Fetching tokenization options from', url);

    try {
      const response = await fetch(url);

      if (!response.ok) {
        this.log('Failed to fetch tokenization options:', response.status);
        this.options = [];
        return;
      }

      const data: TokenizationOptions = await response.json();
      this.options = data.options || [];

      this.log('Available PSPs:', this.options.map(o => o.provider));
    } catch (err) {
      // Network error — Kairos encrypted adapter will be used as fallback
      this.log('Error fetching tokenization options, will use Kairos encryption:', err);
      this.options = [];
    }
  }

  /**
   * Get the best available PSP adapter.
   *
   * Selection priority:
   * 1. If preferredProvider is 'KAIROS', use KairosEncryptedAdapter (our own encryption)
   * 2. If preferredProvider matches a PSP option, use that PSP adapter
   * 3. Use the first available PSP option
   * 4. Fallback to KairosEncryptedAdapter when no PSP has client-side tokenization
   */
  private async getAdapter(): Promise<PspAdapter> {
    if (this.adapter) {
      return this.adapter;
    }

    // If KAIROS is explicitly preferred, use our encrypted adapter directly
    if (this.config.preferredProvider === 'KAIROS') {
      this.log('Using Kairos Encrypted adapter (preferred)');
      return this.initKairosAdapter();
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

    // Fallback to Kairos encryption when no PSP with client-side tokenization
    if (!option) {
      this.log('No PSP with client-side tokenization available, falling back to Kairos encryption');
      return this.initKairosAdapter();
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
        // Unknown PSP — try Kairos encrypted adapter as fallback
        this.log(`Unknown PSP provider "${option.provider}", falling back to Kairos encryption`);
        return this.initKairosAdapter();
    }

    // Initialize adapter with public key
    await this.adapter.init(option.publicKey, {
      locale: this.config.locale,
      environment: option.environment
    });

    return this.adapter;
  }

  /**
   * Initialize the Kairos Encrypted adapter (our own card form + encryption).
   */
  private async initKairosAdapter(): Promise<PspAdapter> {
    this.adapter = new KairosEncryptedAdapter();
    await this.adapter.init('', {
      apiUrl: this.config.apiUrl,
      tenantId: this.config.tenantId,
      locale: this.config.locale,
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
