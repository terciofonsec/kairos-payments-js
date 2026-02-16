/**
 * Kairos Payments JavaScript SDK
 *
 * A unified SDK for card tokenization and payments across multiple PSPs.
 *
 * @example
 * ```typescript
 * import { KairosPayments } from '@kairos/payments-js';
 *
 * const kairos = await KairosPayments.init({
 *   tenantId: 'faithlink',
 *   environment: 'production'
 * });
 *
 * await kairos.createCardPayment('#container', {
 *   amount: 100.00,
 *   onSubmit: async (data) => {
 *     // Send data.token to your backend
 *   }
 * });
 * ```
 */

export { KairosPayments } from './core/KairosPayments';
export { CardPaymentForm } from './components/CardPaymentForm';
export { KairosEncryptedAdapter } from './adapters/KairosEncryptedAdapter';

// Encryption utilities
export { encryptCardData, isEncryptionAvailable, clearEncryptionCache } from './crypto/encryption';
export type { CardDataToEncrypt } from './crypto/encryption';

// Types
export type {
  KairosConfig,
  CardPaymentConfig,
  PaymentData,
  InstallmentOption,
  TokenizationOptions,
  PspAdapter
} from './types';

// Version
export const VERSION = '0.1.0';
