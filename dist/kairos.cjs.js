'use strict';

var jsxRuntime = require('react/jsx-runtime');
var react = require('react');

/**
 * MercadoPago Adapter
 *
 * Uses MercadoPago Bricks for card payment UI.
 * @see https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks
 */
class MercadoPagoAdapter {
    constructor() {
        this.provider = 'MERCADOPAGO';
        this.mp = null;
        this.bricksBuilder = null;
        this.cardPaymentBrick = null;
        this.publicKey = '';
    }
    /**
     * Load MercadoPago SDK script dynamically.
     */
    async loadScript() {
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
    async init(publicKey, options) {
        this.publicKey = publicKey;
        await this.loadScript();
        this.mp = new window.MercadoPago(publicKey, {
            locale: options?.locale || 'pt-BR'
        });
        this.bricksBuilder = this.mp.bricks();
    }
    async createCardPayment(container, config) {
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
                onSubmit: async (cardFormData) => {
                    const paymentData = {
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
                onError: (error) => {
                    config.onError?.({
                        code: error.type || 'UNKNOWN',
                        message: error.message || 'An error occurred',
                        cause: error
                    });
                }
            }
        };
        this.cardPaymentBrick = await this.bricksBuilder.create('cardPayment', containerId, settings);
        return {
            updateAmount: (amount) => {
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
    async getInstallments(amount, bin) {
        const response = await this.mp.getInstallments({
            amount: String(amount),
            bin: bin
        });
        if (!response || response.length === 0) {
            return [];
        }
        const payerCosts = response[0].payer_costs || [];
        return payerCosts.map((cost, index) => ({
            installments: cost.installments,
            installmentAmount: cost.installment_amount,
            totalAmount: cost.total_amount,
            interestFree: cost.installment_rate === 0,
            interestRate: cost.installment_rate,
            recommended: index === 0
        }));
    }
    destroy() {
        if (this.cardPaymentBrick) {
            this.cardPaymentBrick.unmount();
            this.cardPaymentBrick = null;
        }
        this.mp = null;
        this.bricksBuilder = null;
    }
}

/**
 * PagSeguro (PagBank) Adapter
 *
 * @see https://dev.pagbank.uol.com.br/docs
 */
class PagSeguroAdapter {
    constructor() {
        this.provider = 'PAGSEGURO';
        this.publicKey = '';
        this.environment = 'sandbox';
    }
    /**
     * Load PagSeguro SDK script dynamically.
     */
    async loadScript() {
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
    async init(publicKey, options) {
        this.publicKey = publicKey;
        this.environment = options?.environment || 'sandbox';
        await this.loadScript();
        // PagSeguro requires session initialization
        // This would typically be done via your backend
    }
    async createCardPayment(container, config) {
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
        const form = containerEl.querySelector('form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const formData = new FormData(form);
                const token = await this.tokenizeCard(formData);
                const paymentData = {
                    token,
                    installments: parseInt(formData.get('installments')) || 1,
                    paymentMethodId: 'credit_card',
                    issuerId: '',
                    lastFourDigits: formData.get('cardNumber')?.slice(-4) || '',
                    cardholderName: formData.get('cardholderName') || '',
                    provider: this.provider
                };
                await config.onSubmit(paymentData);
            }
            catch (error) {
                config.onError?.({
                    code: 'TOKENIZATION_ERROR',
                    message: error.message || 'Failed to tokenize card',
                    cause: error
                });
            }
        });
        config.onReady?.();
        return {
            updateAmount: (amount) => {
                const amountEl = form.querySelector('[data-amount]');
                if (amountEl) {
                    amountEl.textContent = `R$ ${amount.toFixed(2)}`;
                }
            },
            submit: async () => {
                form.dispatchEvent(new Event('submit'));
                return {}; // Will be handled by onSubmit
            },
            unmount: () => {
                containerEl.innerHTML = '';
            }
        };
    }
    createFormHtml(config) {
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
                   placeholder="123" maxlength="4" required />
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
    async tokenizeCard(formData) {
        // PagSeguro card tokenization
        // In a real implementation, this would call PagSeguro's API
        const cardNumber = formData.get('cardNumber')?.replace(/\s/g, '');
        const [expMonth, expYear] = formData.get('expiry')?.split('/') || [];
        const cvv = formData.get('cvv');
        const cardholderName = formData.get('cardholderName');
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
    async getInstallments(amount, bin) {
        // PagSeguro installment calculation
        // This would typically be done via your backend
        const maxInstallments = 12;
        const options = [];
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
    destroy() {
        // Cleanup if needed
    }
}

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
class KairosPayments {
    constructor(config) {
        this.options = [];
        this.adapter = null;
        this.cardInstance = null;
        this.config = {
            tenantId: config.tenantId,
            environment: config.environment || 'production',
            apiUrl: config.apiUrl || 'https://api.kairoshub.tech',
            preferredProvider: config.preferredProvider || undefined,
            locale: config.locale || 'pt-BR',
            debug: config.debug || false
        };
    }
    /**
     * Initialize the Kairos Payments SDK.
     * Fetches available PSPs and their public keys from the Kairos API.
     */
    static async init(config) {
        const instance = new KairosPayments(config);
        await instance.fetchOptions();
        return instance;
    }
    /**
     * Fetch tokenization options from Kairos API.
     */
    async fetchOptions() {
        const url = `${this.config.apiUrl}/api/v1/tokenization/${this.config.tenantId}/options`;
        this.log('Fetching tokenization options from', url);
        const response = await fetch(url);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `Failed to fetch tokenization options: ${response.status}`);
        }
        const data = await response.json();
        this.options = data.options;
        this.log('Available PSPs:', this.options.map(o => o.provider));
    }
    /**
     * Get the best available PSP adapter.
     */
    async getAdapter() {
        if (this.adapter) {
            return this.adapter;
        }
        // Find preferred or first available PSP
        let option = this.options[0];
        if (this.config.preferredProvider) {
            const preferred = this.options.find(o => o.provider === this.config.preferredProvider);
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
    async createCardPayment(container, config) {
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
    async getInstallments(amount, bin) {
        const adapter = await this.getAdapter();
        return adapter.getInstallments(amount, bin);
    }
    /**
     * Get available PSP options for this tenant.
     */
    getAvailableProviders() {
        return [...this.options];
    }
    /**
     * Get current configuration.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Destroy the SDK instance and cleanup resources.
     */
    destroy() {
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
    log(...args) {
        if (this.config.debug) {
            console.log('[Kairos]', ...args);
        }
    }
}

function CardPaymentForm({ tenantId, amount, environment = 'production', apiUrl, preferredProvider, maxInstallments = 12, onSuccess, onError, onReady, className, debug = false }) {
    const containerRef = react.useRef(null);
    const kairosRef = react.useRef(null);
    const [loading, setLoading] = react.useState(true);
    const [error, setError] = react.useState(null);
    react.useEffect(() => {
        let mounted = true;
        async function initKairos() {
            if (!containerRef.current)
                return;
            try {
                setLoading(true);
                setError(null);
                const config = {
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
                const paymentConfig = {
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
            }
            catch (err) {
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
    return (jsxRuntime.jsxs("div", { className: className, children: [loading && (jsxRuntime.jsxs("div", { className: "kairos-loading", children: [jsxRuntime.jsx("div", { className: "kairos-spinner" }), jsxRuntime.jsx("span", { children: "Carregando formulario de pagamento..." })] })), error && (jsxRuntime.jsx("div", { className: "kairos-error", children: jsxRuntime.jsx("span", { children: error }) })), jsxRuntime.jsx("div", { ref: containerRef, id: "kairos-card-payment-container", style: { display: loading ? 'none' : 'block' } })] }));
}

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
// Version
const VERSION = '0.1.0';

exports.CardPaymentForm = CardPaymentForm;
exports.KairosPayments = KairosPayments;
exports.VERSION = VERSION;
//# sourceMappingURL=kairos.cjs.js.map
