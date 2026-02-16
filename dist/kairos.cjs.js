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
 * Client-side card data encryption using Web Crypto API.
 *
 * Uses hybrid encryption: RSA-OAEP (key wrapping) + AES-256-GCM (data encryption).
 * The Kairos backend decrypts with the corresponding RSA private key.
 *
 * Flow:
 * 1. Fetch RSA public key from Kairos tokenization endpoint
 * 2. Generate random AES-256 key
 * 3. Encrypt card JSON with AES-GCM
 * 4. Wrap AES key with RSA-OAEP public key
 * 5. Combine as base64 JSON envelope
 */
let cachedPublicKey = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
/**
 * Fetch the RSA public key from the Kairos tokenization endpoint.
 * Cached for 30 minutes.
 */
async function fetchPublicKey(apiUrl, tenantId) {
    const now = Date.now();
    if (cachedPublicKey && now - cacheTimestamp < CACHE_TTL) {
        return cachedPublicKey;
    }
    const res = await fetch(`${apiUrl}/api/v1/tokenization/${tenantId}/encryption-key`);
    if (!res.ok) {
        throw new Error(`Failed to fetch encryption key: ${res.status}`);
    }
    const data = await res.json();
    const publicKeyBase64 = data.publicKey;
    // Decode base64 -> ArrayBuffer
    const binaryString = atob(publicKeyBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    // Import as RSA-OAEP public key (SPKI format)
    cachedPublicKey = await crypto.subtle.importKey('spki', bytes.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
    cacheTimestamp = now;
    return cachedPublicKey;
}
/**
 * Encrypt card data for secure transmission to the backend.
 *
 * @param cardData Raw card fields
 * @param apiUrl Kairos API base URL
 * @param tenantId Tenant identifier
 * @returns Base64-encoded encrypted envelope
 */
async function encryptCardData(cardData, apiUrl, tenantId) {
    const rsaKey = await fetchPublicKey(apiUrl, tenantId);
    // Compact JSON with short keys to minimize payload
    const cardJson = JSON.stringify({
        n: cardData.number,
        h: cardData.holderName,
        m: cardData.expirationMonth,
        y: cardData.expirationYear,
        c: cardData.cvv,
    });
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(cardJson);
    // Generate random AES-256 key
    const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, // extractable (needed for RSA wrapping)
    ['encrypt']);
    // Generate random 12-byte IV for AES-GCM
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // Encrypt card data with AES-GCM
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, plaintext);
    // Wrap (encrypt) the AES key with RSA-OAEP
    const wrappedKey = await crypto.subtle.wrapKey('raw', aesKey, rsaKey, { name: 'RSA-OAEP' });
    // Build envelope JSON and base64 encode
    const envelope = JSON.stringify({
        ek: arrayBufferToBase64(wrappedKey), // encrypted key
        iv: arrayBufferToBase64(iv.buffer), // initialization vector
        d: arrayBufferToBase64(ciphertext), // encrypted data (includes GCM auth tag)
    });
    return btoa(envelope);
}
/**
 * Check if card encryption is available (endpoint reachable).
 */
async function isEncryptionAvailable(apiUrl, tenantId) {
    try {
        await fetchPublicKey(apiUrl, tenantId);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Clear the cached public key.
 */
function clearEncryptionCache() {
    cachedPublicKey = null;
    cacheTimestamp = 0;
}
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

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
 *
 * Styling: Uses CSS custom properties (--kairos-*) so host apps can override
 * colors, fonts, and borders. Falls back to sensible defaults and inherits
 * font-family from the parent element.
 */
class KairosEncryptedAdapter {
    constructor() {
        this.provider = 'KAIROS';
        this.apiUrl = '';
        this.tenantId = '';
    }
    async init(_publicKey, options) {
        this.apiUrl = options?.apiUrl || 'https://api.kairoshub.tech';
        this.tenantId = options?.tenantId || '';
    }
    async createCardPayment(container, config) {
        const containerEl = typeof container === 'string'
            ? document.querySelector(container)
            : container;
        if (!containerEl) {
            throw new Error(`Container not found: ${container}`);
        }
        // Inject styles + form HTML
        containerEl.innerHTML = this.buildFormHtml(config);
        const form = containerEl.querySelector('[data-kairos-enc-form]');
        const errorEl = containerEl.querySelector('[data-kairos-enc-error]');
        const submitBtn = containerEl.querySelector('[data-kairos-enc-submit]');
        const cardNumberInput = containerEl.querySelector('[data-kairos-enc-card-number]');
        const expiryInput = containerEl.querySelector('[data-kairos-enc-expiry]');
        const cvvInput = containerEl.querySelector('[data-kairos-enc-cvv]');
        const nameInput = containerEl.querySelector('[data-kairos-enc-name]');
        const installmentsSelect = containerEl.querySelector('[data-kairos-enc-installments]');
        const brandBadge = containerEl.querySelector('[data-kairos-enc-brand]');
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
            }
            else {
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
            if (submitBtn.disabled)
                return;
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
                const encrypted = await encryptCardData({
                    number: cleanNumber,
                    holderName: nameInput.value.trim(),
                    expirationMonth: mm,
                    expirationYear,
                    cvv: cvvInput.value,
                }, this.apiUrl, this.tenantId);
                const paymentData = {
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
            }
            catch (err) {
                errorEl.textContent = err.message || 'Erro ao processar pagamento';
                errorEl.style.display = 'block';
                config.onError?.({
                    code: 'ENCRYPTION_ERROR',
                    message: err.message || 'Failed to encrypt card data',
                    cause: err,
                });
            }
            finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
        config.onReady?.();
        return {
            updateAmount: (amount) => {
                const amountEl = containerEl.querySelector('[data-kairos-enc-amount]');
                if (amountEl) {
                    amountEl.textContent = `R$ ${amount.toFixed(2).replace('.', ',')}`;
                }
            },
            submit: async () => {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return {};
            },
            unmount: () => {
                containerEl.innerHTML = '';
            },
        };
    }
    async getInstallments(amount, _bin) {
        const maxInstallments = 12;
        const options = [];
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
    destroy() {
        // No external SDK to clean up
    }
    validate(cardNumber, expiry, cvv, name) {
        const cleanNumber = cardNumber.replace(/\D/g, '');
        if (cleanNumber.length < 13)
            return 'Numero do cartao invalido';
        if (expiry.length < 5)
            return 'Data de validade invalida';
        const [mm, yy] = expiry.split('/');
        const month = parseInt(mm, 10);
        if (month < 1 || month > 12)
            return 'Mes invalido';
        const year = 2000 + parseInt(yy || '0', 10);
        const now = new Date();
        if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
            return 'Cartao expirado';
        }
        if (cvv.length < 3)
            return 'CVV invalido';
        if (name.trim().length < 3)
            return 'Nome invalido';
        return null;
    }
    getLoadingButtonHtml() {
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
    buildFormHtml(config) {
        const amountFormatted = config.amount.toFixed(2).replace('.', ',');
        // Kairos hexagonal logo SVG (inline)
        const kairosLogoSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M12 7v10M8 9l4 3 4-3M8 15l4-3 4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
        return `
      <style>
        /*
         * Kairos Payments SDK — Card Form Styles
         *
         * Override with CSS custom properties on the parent element:
         *   --kairos-font:        Font family (default: inherit)
         *   --kairos-text:        Text color (default: inherit)
         *   --kairos-text-muted:  Muted text / labels (default: inherit with opacity)
         *   --kairos-bg:          Input background (default: transparent)
         *   --kairos-border:      Border color (default: currentColor with opacity)
         *   --kairos-radius:      Border radius (default: 8px)
         *   --kairos-focus:       Focus ring color (default: #7c3aed)
         *   --kairos-accent:      Button gradient start (default: #7c3aed)
         *   --kairos-accent-end:  Button gradient end (default: #9333ea)
         *   --kairos-success:     Security badge color (default: #059669)
         */
        .kairos-enc-form {
          font-family: var(--kairos-font, inherit);
          color: var(--kairos-text, inherit);
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
          opacity: 0.7;
        }
        .kairos-enc-field input,
        .kairos-enc-field select {
          height: 44px;
          padding: 0 12px;
          border: 1px solid var(--kairos-border, color-mix(in srgb, currentColor 25%, transparent));
          border-radius: var(--kairos-radius, 8px);
          font-size: 15px;
          font-family: inherit;
          color: inherit;
          background: var(--kairos-bg, transparent);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          -webkit-appearance: none;
        }
        .kairos-enc-field input:focus,
        .kairos-enc-field select:focus {
          border-color: var(--kairos-focus, #7c3aed);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--kairos-focus, #7c3aed) 15%, transparent);
        }
        .kairos-enc-field input::placeholder {
          color: inherit;
          opacity: 0.4;
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
          opacity: 0.5;
          letter-spacing: 0.05em;
          display: none;
        }
        .kairos-enc-error {
          display: none;
          padding: 10px 14px;
          background: color-mix(in srgb, #ef4444 10%, transparent);
          border: 1px solid color-mix(in srgb, #ef4444 25%, transparent);
          border-radius: var(--kairos-radius, 8px);
          color: #ef4444;
          font-size: 13px;
        }
        .kairos-enc-security {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          background: color-mix(in srgb, var(--kairos-success, #059669) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--kairos-success, #059669) 20%, transparent);
          border-radius: var(--kairos-radius, 8px);
        }
        .kairos-enc-security-icon {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          color: var(--kairos-success, #059669);
        }
        .kairos-enc-security-text {
          flex: 1;
          min-width: 0;
        }
        .kairos-enc-security-text strong {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--kairos-success, #059669);
        }
        .kairos-enc-security-text span {
          font-size: 11px;
          color: var(--kairos-success, #059669);
          opacity: 0.75;
        }
        .kairos-enc-security-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
          color: var(--kairos-success, #059669);
          opacity: 0.85;
        }
        .kairos-enc-security-badge svg {
          width: 18px;
          height: 18px;
        }
        .kairos-enc-security-lock {
          width: 10px;
          height: 10px;
          opacity: 0.7;
        }
        .kairos-enc-submit {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          height: 52px;
          border: none;
          border-radius: var(--kairos-radius, 8px);
          font-size: 16px;
          font-weight: 600;
          font-family: inherit;
          color: #fff;
          background: linear-gradient(135deg, var(--kairos-accent, #7c3aed) 0%, var(--kairos-accent-end, #9333ea) 100%);
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
            <span>Criptografia ponta a ponta via Kairos Payment Hub</span>
          </div>
          <div class="kairos-enc-security-badge">
            <svg class="kairos-enc-security-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            ${kairosLogoSvg}
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
function detectCardBrand(number) {
    const clean = number.replace(/\D/g, '');
    if (/^4/.test(clean))
        return 'visa';
    if (/^5[1-5]/.test(clean))
        return 'mastercard';
    if (/^3[47]/.test(clean))
        return 'amex';
    if (/^(636368|438935|504175|451416|636297)/.test(clean) || /^(5067|4576|4011)/.test(clean))
        return 'elo';
    if (/^606282/.test(clean))
        return 'hipercard';
    return '';
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
     * Non-fatal: if no PSP options are available, KairosEncryptedAdapter is used as fallback.
     */
    async fetchOptions() {
        const url = `${this.config.apiUrl}/api/v1/tokenization/${this.config.tenantId}/options`;
        this.log('Fetching tokenization options from', url);
        try {
            const response = await fetch(url);
            if (!response.ok) {
                this.log('Failed to fetch tokenization options:', response.status);
                this.options = [];
                return;
            }
            const data = await response.json();
            this.options = data.options || [];
            this.log('Available PSPs:', this.options.map(o => o.provider));
        }
        catch (err) {
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
    async getAdapter() {
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
            const preferred = this.options.find(o => o.provider === this.config.preferredProvider);
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
    async initKairosAdapter() {
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
    return (jsxRuntime.jsxs("div", { className: className, children: [loading && (jsxRuntime.jsxs("div", { className: "kairos-loading", children: [jsxRuntime.jsx("div", { className: "kairos-spinner" }), jsxRuntime.jsx("span", { children: "Carregando formulario de pagamento..." })] })), error && (jsxRuntime.jsx("div", { className: "kairos-error", children: jsxRuntime.jsx("span", { children: error }) })), jsxRuntime.jsx("div", { ref: containerRef, id: "kairos-card-payment-container", style: { display: loading ? 'none' : 'block' } }), !loading && !error && (jsxRuntime.jsxs("div", { className: "kairos-branding", style: brandingStyles, children: [jsxRuntime.jsx(KairosLogo, {}), jsxRuntime.jsx("span", { style: brandingTextStyle, children: "Powered by Kairos" })] }))] }));
}
const brandingStyles = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '8px 0 4px',
    opacity: 0.6,
};
const brandingTextStyle = {
    fontSize: '11px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#6b7280',
    letterSpacing: '0.02em',
};
function KairosLogo() {
    return (jsxRuntime.jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: [jsxRuntime.jsx("path", { d: "M12 2L2 7v10l10 5 10-5V7L12 2z", stroke: "#6b7280", strokeWidth: "1.5", strokeLinejoin: "round" }), jsxRuntime.jsx("path", { d: "M12 7v10M8 9l4 3 4-3M8 15l4-3 4 3", stroke: "#6b7280", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" })] }));
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
exports.KairosEncryptedAdapter = KairosEncryptedAdapter;
exports.KairosPayments = KairosPayments;
exports.VERSION = VERSION;
exports.clearEncryptionCache = clearEncryptionCache;
exports.encryptCardData = encryptCardData;
exports.isEncryptionAvailable = isEncryptionAvailable;
//# sourceMappingURL=kairos.cjs.js.map
