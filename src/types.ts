/**
 * SDK Configuration
 */
export interface KairosConfig {
  /** Tenant identifier (e.g., 'faithlink') */
  tenantId: string;

  /** Merchant UUID — required for card encryption (each merchant has its own RSA key pair) */
  merchantId?: string;

  /** Environment: 'sandbox' or 'production' */
  environment?: 'sandbox' | 'production';

  /** Kairos API base URL (defaults to https://api.kairoshub.tech) */
  apiUrl?: string;

  /** Preferred PSP provider (optional - uses tenant's default if not specified) */
  preferredProvider?: 'MERCADOPAGO' | 'PAGSEGURO' | 'KAIROS';

  /** Locale for UI elements */
  locale?: 'pt-BR' | 'en-US' | 'es';

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Card Payment Form Configuration
 */
export interface CardPaymentConfig {
  /** Payment amount in BRL */
  amount: number;

  /** Maximum installments allowed (default: 12) */
  maxInstallments?: number;

  /** Show installment selector (default: true) */
  showInstallments?: boolean;

  /** Custom styles for the form */
  styles?: CardPaymentStyles;

  /** Callback when form is ready */
  onReady?: () => void;

  /** Callback when payment is submitted */
  onSubmit: (data: PaymentData) => void | Promise<void>;

  /** Callback on error */
  onError?: (error: PaymentError) => void;

  /** Callback when form values change */
  onChange?: (state: FormState) => void;
}

/**
 * Card Payment Styles
 */
export interface CardPaymentStyles {
  /** Font family */
  fontFamily?: string;

  /** Base font size */
  fontSize?: string;

  /** Primary color */
  primaryColor?: string;

  /** Error color */
  errorColor?: string;

  /** Border radius */
  borderRadius?: string;
}

/**
 * Payment Data returned after tokenization
 */
export interface PaymentData {
  /** Card token (send this to your backend) */
  token: string;

  /** Encrypted card data (Kairos encryption — use instead of token when provider is KAIROS) */
  encryptedData?: string;

  /** Selected installments */
  installments: number;

  /** Payment method ID (e.g., 'visa', 'mastercard') */
  paymentMethodId: string;

  /** Card issuer ID */
  issuerId: string;

  /** Last 4 digits of the card */
  lastFourDigits: string;

  /** Cardholder name */
  cardholderName: string;

  /** PSP provider used */
  provider: string;
}

/**
 * Installment Option
 */
export interface InstallmentOption {
  /** Number of installments */
  installments: number;

  /** Amount per installment */
  installmentAmount: number;

  /** Total amount with interest */
  totalAmount: number;

  /** Whether it's interest-free */
  interestFree: boolean;

  /** Interest rate (if applicable) */
  interestRate?: number;

  /** Recommended (cheapest option) */
  recommended?: boolean;
}

/**
 * Payment Error
 */
export interface PaymentError {
  /** Error code */
  code: string;

  /** Human-readable message */
  message: string;

  /** Field with error (if applicable) */
  field?: string;

  /** Original error from PSP */
  cause?: unknown;
}

/**
 * Form State
 */
export interface FormState {
  /** Whether form is valid */
  isValid: boolean;

  /** Whether form is submitting */
  isSubmitting: boolean;

  /** Current errors */
  errors: Record<string, string>;

  /** Card BIN (first 6 digits) */
  bin?: string;

  /** Detected card brand */
  cardBrand?: string;
}

/**
 * Tokenization Options from API
 */
export interface TokenizationOptions {
  tenantId: string;
  options: TokenizationOption[];
}

export interface TokenizationOption {
  provider: string;
  providerDisplayName: string;
  environment: string;
  publicKey: string;
  sdk: SdkInfo;
}

export interface SdkInfo {
  name: string;
  version?: string;
  scriptUrl: string;
  initExample?: string;
  documentation?: string;
}

/**
 * PSP Adapter Interface
 * Each PSP (MercadoPago, PagSeguro, etc.) implements this interface
 */
export interface PspAdapter {
  /** PSP provider name */
  readonly provider: string;

  /** Initialize the PSP SDK */
  init(publicKey: string, options?: Record<string, unknown>): Promise<void>;

  /** Create card payment form */
  createCardPayment(
    container: string | HTMLElement,
    config: CardPaymentConfig
  ): Promise<CardPaymentInstance>;

  /** Get installment options for a given amount and BIN */
  getInstallments(amount: number, bin: string): Promise<InstallmentOption[]>;

  /** Destroy and cleanup */
  destroy(): void;
}

/**
 * Card Payment Instance (returned by createCardPayment)
 */
export interface CardPaymentInstance {
  /** Update the payment amount */
  updateAmount(amount: number): void;

  /** Submit the form programmatically */
  submit(): Promise<PaymentData>;

  /** Unmount and cleanup */
  unmount(): void;
}
