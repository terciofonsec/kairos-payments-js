import { jsxs, jsx } from 'react/jsx-runtime';
import { useRef, useState, useEffect } from 'react';

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
 * The Kairos backend decrypts with the merchant's RSA private key.
 *
 * Each merchant has its own RSA key pair stored in the database.
 *
 * Flow:
 * 1. Fetch merchant's RSA public key from Kairos tokenization endpoint
 * 2. Generate random AES-256 key
 * 3. Encrypt card JSON with AES-GCM
 * 4. Wrap AES key with RSA-OAEP public key
 * 5. Combine as base64 JSON envelope
 */
// Cache public keys per merchant (keyed by merchantId)
const keyCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (keys are persisted in DB per merchant)
/**
 * Fetch the RSA public key for a specific merchant from the Kairos tokenization endpoint.
 * Cached per merchant for 24 hours.
 */
async function fetchPublicKey(apiUrl, tenantId, merchantId) {
    const cacheKey = merchantId || '__default__';
    const now = Date.now();
    const cached = keyCache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL) {
        return cached.key;
    }
    const params = merchantId ? `?merchantId=${merchantId}` : '';
    const res = await fetch(`${apiUrl}/api/v1/tokenization/${tenantId}/encryption-key${params}`);
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
    const cryptoKey = await crypto.subtle.importKey('spki', bytes.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
    keyCache.set(cacheKey, { key: cryptoKey, timestamp: now });
    return cryptoKey;
}
/**
 * Encrypt card data for secure transmission to the backend.
 *
 * @param cardData Raw card fields
 * @param apiUrl Kairos API base URL
 * @param tenantId Tenant identifier
 * @param merchantId Merchant UUID (each merchant has its own RSA key pair)
 * @returns Base64-encoded encrypted envelope
 */
async function encryptCardData(cardData, apiUrl, tenantId, merchantId) {
    const rsaKey = await fetchPublicKey(apiUrl, tenantId, merchantId);
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
 * Check if card encryption is available for a merchant (endpoint reachable).
 */
async function isEncryptionAvailable(apiUrl, tenantId, merchantId) {
    try {
        await fetchPublicKey(apiUrl, tenantId, merchantId);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Clear the cached public key for a specific merchant, or all if no merchantId.
 */
function clearEncryptionCache(merchantId) {
    if (merchantId) {
        keyCache.delete(merchantId);
    }
    else {
        keyCache.clear();
    }
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
        this.merchantId = '';
    }
    async init(_publicKey, options) {
        this.apiUrl = options?.apiUrl || 'https://api.kairoshub.tech';
        this.tenantId = options?.tenantId || '';
        this.merchantId = options?.merchantId || '';
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
            cvvInput.value = cvvInput.value.replace(/\D/g, '').slice(0, 3);
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
                }, this.apiUrl, this.tenantId, this.merchantId);
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
        if (cvv.length !== 3)
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
        // Kairos brand logo SVG (matches console icon)
        const kairosLogoSvg = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="kairos-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3B82F6"/>
          <stop offset="100%" style="stop-color:#8B5CF6"/>
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#kairos-logo-grad)"/>
      <path d="M16 12 L16 36 M16 24 L32 12 M16 24 L32 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="36" cy="36" r="5" fill="#10B981"/>
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
              maxlength="3"
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
            merchantId: config.merchantId || '',
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
            merchantId: this.config.merchantId,
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
    const containerRef = useRef(null);
    const kairosRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
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
    return (jsxs("div", { className: className, children: [loading && (jsxs("div", { className: "kairos-loading", children: [jsx("div", { className: "kairos-spinner" }), jsx("span", { children: "Carregando formulario de pagamento..." })] })), error && (jsx("div", { className: "kairos-error", children: jsx("span", { children: error }) })), jsx("div", { ref: containerRef, id: "kairos-card-payment-container", style: { display: loading ? 'none' : 'block' } }), !loading && !error && (jsxs("div", { className: "kairos-branding", style: brandingStyles, children: [jsx(KairosLogo, {}), jsx("span", { style: brandingTextStyle, children: "Powered by Kairos" })] }))] }));
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
    return (jsxs("svg", { width: "14", height: "14", viewBox: "0 0 48 48", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: [jsx("defs", { children: jsxs("linearGradient", { id: "kairos-form-grad", x1: "0%", y1: "0%", x2: "100%", y2: "100%", children: [jsx("stop", { offset: "0%", stopColor: "#3B82F6" }), jsx("stop", { offset: "100%", stopColor: "#8B5CF6" })] }) }), jsx("circle", { cx: "24", cy: "24", r: "22", fill: "url(#kairos-form-grad)" }), jsx("path", { d: "M16 12 L16 36 M16 24 L32 12 M16 24 L32 36", stroke: "white", strokeWidth: "4", strokeLinecap: "round", strokeLinejoin: "round" }), jsx("circle", { cx: "36", cy: "36", r: "5", fill: "#10B981" })] }));
}

/**
 * PixQrCode — Renders a PIX QR code with copy-paste ("copia e cola") functionality.
 *
 * This component is framework-agnostic (vanilla DOM). It renders:
 * - QR code image (from base64 or generated client-side via Canvas)
 * - Copy "copia e cola" button
 * - Countdown timer (optional, for dynamic PIX)
 * - Amount display
 *
 * Styling: Uses CSS custom properties (--kairos-*) so host apps can override
 * colors, fonts, and borders. Falls back to sensible defaults.
 *
 * @example
 * ```typescript
 * import { PixQrCode } from '@kairos/payments-js';
 *
 * const pix = new PixQrCode('#pix-container', {
 *   amount: 50.00,
 *   copyPaste: 'MDAwMjAxMjYzMzAwMTR...',
 *   qrCodeBase64: 'data:image/png;base64,...', // optional
 *   expiresAt: '2026-02-17T15:30:00Z',        // optional
 *   onCopy: () => console.log('Copied!'),
 *   onExpired: () => console.log('Expired!'),
 * });
 *
 * // Later:
 * pix.destroy();
 * ```
 */
function createPixQrCode(container, config) {
    const containerEl = typeof container === 'string'
        ? document.querySelector(container)
        : container;
    if (!containerEl) {
        throw new Error(`PixQrCode: container not found: ${container}`);
    }
    const locale = config.locale || 'pt-BR';
    const qrSize = config.qrSize || 200;
    const labels = getLabels(locale);
    let countdownInterval = null;
    let copyTimeout = null;
    let expired = false;
    // Render HTML
    containerEl.innerHTML = buildHtml(config, labels, qrSize);
    // Inject styles (once per page)
    injectStyles();
    // Resolve QR code image
    const qrImg = containerEl.querySelector('[data-kairos-pix-qr]');
    const qrPlaceholder = containerEl.querySelector('[data-kairos-pix-qr-placeholder]');
    resolveQrImage(config, qrSize).then((src) => {
        if (qrImg && src) {
            qrImg.src = src;
            qrImg.style.display = 'block';
            if (qrPlaceholder)
                qrPlaceholder.style.display = 'none';
        }
    });
    // Copy button handler
    const copyBtn = containerEl.querySelector('[data-kairos-pix-copy]');
    const copyLabel = containerEl.querySelector('[data-kairos-pix-copy-label]');
    const doCopy = async () => {
        if (!config.copyPaste || expired)
            return;
        try {
            await navigator.clipboard.writeText(config.copyPaste);
            if (copyLabel) {
                copyLabel.textContent = labels.copied;
                if (copyTimeout)
                    clearTimeout(copyTimeout);
                copyTimeout = setTimeout(() => {
                    if (copyLabel)
                        copyLabel.textContent = labels.copyCode;
                }, 3000);
            }
            config.onCopy?.();
        }
        catch {
            // Fallback: select text from a hidden textarea
            const ta = document.createElement('textarea');
            ta.value = config.copyPaste;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (copyLabel) {
                copyLabel.textContent = labels.copied;
                if (copyTimeout)
                    clearTimeout(copyTimeout);
                copyTimeout = setTimeout(() => {
                    if (copyLabel)
                        copyLabel.textContent = labels.copyCode;
                }, 3000);
            }
            config.onCopy?.();
        }
    };
    copyBtn?.addEventListener('click', doCopy);
    // Countdown timer
    const countdownEl = containerEl.querySelector('[data-kairos-pix-countdown]');
    const expiryRow = containerEl.querySelector('[data-kairos-pix-expiry-row]');
    const expiredOverlay = containerEl.querySelector('[data-kairos-pix-expired]');
    if (config.expiresAt) {
        countdownInterval = setInterval(() => {
            const now = Date.now();
            const expiresMs = new Date(config.expiresAt).getTime();
            const diff = Math.max(0, Math.floor((expiresMs - now) / 1000));
            if (countdownEl) {
                const mins = Math.floor(diff / 60);
                const secs = diff % 60;
                countdownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            }
            if (diff === 0 && !expired) {
                expired = true;
                if (countdownInterval) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                }
                if (expiryRow)
                    expiryRow.style.display = 'none';
                if (expiredOverlay)
                    expiredOverlay.style.display = 'flex';
                if (copyBtn)
                    copyBtn.style.display = 'none';
                config.onExpired?.();
            }
        }, 1000);
    }
    return {
        copyToClipboard: doCopy,
        destroy() {
            if (countdownInterval)
                clearInterval(countdownInterval);
            if (copyTimeout)
                clearTimeout(copyTimeout);
            containerEl.innerHTML = '';
        },
    };
}
// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------
function getLabels(locale) {
    if (locale === 'en-US') {
        return {
            amountLabel: 'Amount to pay',
            copyCode: 'Copy PIX code',
            copied: 'Code copied!',
            waiting: 'Waiting for payment...',
            expiresIn: 'Expires in',
            expired: 'QR Code expired',
        };
    }
    if (locale === 'es') {
        return {
            amountLabel: 'Monto a pagar',
            copyCode: 'Copiar codigo PIX',
            copied: 'Codigo copiado!',
            waiting: 'Esperando pago...',
            expiresIn: 'Expira en',
            expired: 'QR Code expirado',
        };
    }
    // pt-BR (default)
    return {
        amountLabel: 'Valor a pagar',
        copyCode: 'Copiar codigo PIX',
        copied: 'Codigo copiado!',
        waiting: 'Aguardando pagamento...',
        expiresIn: 'Expira em',
        expired: 'QR Code expirado',
    };
}
function buildHtml(config, labels, qrSize) {
    const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(config.amount);
    const hasExpiry = !!config.expiresAt;
    return `
<div class="kairos-pix" data-kairos-pix>
  <div class="kairos-pix__amount">
    <span class="kairos-pix__amount-label">${labels.amountLabel}</span>
    <span class="kairos-pix__amount-value">${formattedAmount}</span>
  </div>

  <div class="kairos-pix__qr-wrapper">
    <img data-kairos-pix-qr
         alt="QR Code PIX"
         width="${qrSize}" height="${qrSize}"
         style="display:none; border-radius: 8px;" />
    <div data-kairos-pix-qr-placeholder class="kairos-pix__qr-placeholder"
         style="width:${qrSize}px; height:${qrSize}px;">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    </div>

    <div data-kairos-pix-expired class="kairos-pix__expired-overlay" style="display:none;">
      <span>${labels.expired}</span>
    </div>
  </div>

  ${hasExpiry ? `
  <div data-kairos-pix-expiry-row class="kairos-pix__status">
    <span class="kairos-pix__pulse"></span>
    <span class="kairos-pix__waiting">${labels.waiting}</span>
    <span class="kairos-pix__timer">${labels.expiresIn} <span data-kairos-pix-countdown>--:--</span></span>
  </div>
  ` : ''}

  <button type="button" data-kairos-pix-copy class="kairos-pix__copy-btn">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
    <span data-kairos-pix-copy-label>${labels.copyCode}</span>
  </button>
</div>`;
}
async function resolveQrImage(config, size) {
    // 1. If base64 provided by PSP
    const b64 = config.qrCodeBase64;
    if (b64) {
        if (b64.startsWith('data:'))
            return b64;
        if (b64.startsWith('PHN2Zy'))
            return `data:image/svg+xml;base64,${b64}`;
        if (!b64.startsWith('http'))
            return `data:image/png;base64,${b64}`;
    }
    // 2. Generate QR from copyPaste using Canvas (no external dependencies)
    if (config.copyPaste) {
        try {
            return await generateQrDataUrl(config.copyPaste, size);
        }
        catch {
            return null;
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Minimal QR Code generator (Canvas-based, no external deps)
// Uses the QR code algorithm for alphanumeric/byte mode.
// For simplicity, delegates to a well-tested inline implementation.
// ---------------------------------------------------------------------------
/**
 * Generate a QR code data URL using the Canvas API.
 * This is a lightweight implementation that encodes the payload as a QR code.
 */
async function generateQrDataUrl(text, size) {
    // Use the qr-code matrix generator and render to canvas
    const modules = generateQrMatrix(text);
    const moduleCount = modules.length;
    const cellSize = Math.floor(size / (moduleCount + 8)); // Add quiet zone
    const offset = Math.floor((size - cellSize * moduleCount) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    // Draw modules
    ctx.fillStyle = '#000000';
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (modules[row][col]) {
                ctx.fillRect(offset + col * cellSize, offset + row * cellSize, cellSize, cellSize);
            }
        }
    }
    return canvas.toDataURL('image/png');
}
// ---------------------------------------------------------------------------
// QR Code Matrix Generator
// Encodes data in byte mode, error correction level M.
// Based on ISO/IEC 18004 and QR code specification.
// ---------------------------------------------------------------------------
function generateQrMatrix(data) {
    const bytes = new TextEncoder().encode(data);
    const version = selectVersion(bytes.length);
    const size = version * 4 + 17;
    // Create module grid
    const grid = Array.from({ length: size }, () => Array(size).fill(null));
    const reserved = Array.from({ length: size }, () => Array(size).fill(false));
    // Place finder patterns
    placeFinder(grid, reserved, 0, 0);
    placeFinder(grid, reserved, size - 7, 0);
    placeFinder(grid, reserved, 0, size - 7);
    // Place alignment patterns
    const alignPos = getAlignmentPositions(version);
    for (const r of alignPos) {
        for (const c of alignPos) {
            if (reserved[r]?.[c])
                continue;
            placeAlignment(grid, reserved, r, c);
        }
    }
    // Place timing patterns
    for (let i = 8; i < size - 8; i++) {
        if (!reserved[6][i]) {
            grid[6][i] = i % 2 === 0;
            reserved[6][i] = true;
        }
        if (!reserved[i][6]) {
            grid[i][6] = i % 2 === 0;
            reserved[i][6] = true;
        }
    }
    // Dark module
    grid[size - 8][8] = true;
    reserved[size - 8][8] = true;
    // Reserve format info areas
    for (let i = 0; i < 8; i++) {
        reserved[8][i] = true;
        reserved[8][size - 1 - i] = true;
        reserved[i][8] = true;
        reserved[size - 1 - i][8] = true;
    }
    reserved[8][8] = true;
    // Reserve version info areas (version >= 7)
    if (version >= 7) {
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 3; j++) {
                reserved[i][size - 11 + j] = true;
                reserved[size - 11 + j][i] = true;
            }
        }
    }
    // Encode data
    const ecLevel = 0; // M level
    const codewords = encodeData(bytes, version);
    // Place data bits
    placeData(grid, reserved, codewords, size);
    // Apply best mask
    const bestMask = selectBestMask(grid, reserved, size);
    applyMask(grid, reserved, bestMask, size);
    // Place format info
    placeFormatInfo(grid, ecLevel, bestMask, size);
    // Place version info
    if (version >= 7) {
        placeVersionInfo(grid, version, size);
    }
    // Convert to boolean matrix
    return grid.map(row => row.map(cell => cell === true));
}
function selectVersion(dataLen) {
    // Byte mode capacity for EC level M
    const capacities = [
        0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
        251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
        711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370,
        1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331,
    ];
    for (let v = 1; v <= 40; v++) {
        if (capacities[v] >= dataLen)
            return v;
    }
    throw new Error('PixQrCode: data too long for QR code');
}
function getAlignmentPositions(version) {
    if (version <= 1)
        return [];
    const positions = [
        [], [],
        [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
        [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
        [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
        [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
        [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
    ];
    return positions[version] || [];
}
function placeFinder(grid, reserved, row, col) {
    for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
            const gr = row + r;
            const gc = col + c;
            if (gr < 0 || gc < 0 || gr >= grid.length || gc >= grid.length)
                continue;
            const inOuter = r === 0 || r === 6 || c === 0 || c === 6;
            const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            grid[gr][gc] = (r >= 0 && r <= 6 && c >= 0 && c <= 6) && (inOuter || inInner);
            reserved[gr][gc] = true;
        }
    }
}
function placeAlignment(grid, reserved, row, col) {
    for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
            const gr = row + r;
            const gc = col + c;
            if (gr < 0 || gc < 0 || gr >= grid.length || gc >= grid.length)
                continue;
            if (reserved[gr][gc])
                return; // Overlap with finder
        }
    }
    for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
            const gr = row + r;
            const gc = col + c;
            const isEdge = Math.abs(r) === 2 || Math.abs(c) === 2;
            const isCenter = r === 0 && c === 0;
            grid[gr][gc] = isEdge || isCenter;
            reserved[gr][gc] = true;
        }
    }
}
// Reed-Solomon & data encoding
function encodeData(data, version, _ecLevel) {
    const totalCodewords = getTotalCodewords(version);
    const ecCodewords = getEcCodewordsPerBlock(version);
    const numBlocks = getNumBlocks(version);
    const dataCodewords = totalCodewords - ecCodewords * numBlocks;
    // Build data stream: mode(4) + count(8 or 16) + data + terminator + padding
    const bits = [];
    // Mode indicator: byte mode = 0100
    pushBits(bits, 0b0100, 4);
    // Character count indicator
    const countBits = version <= 9 ? 8 : 16;
    pushBits(bits, data.length, countBits);
    // Data
    for (const byte of data) {
        pushBits(bits, byte, 8);
    }
    // Terminator
    const dataBits = dataCodewords * 8;
    const terminatorLen = Math.min(4, dataBits - bits.length);
    pushBits(bits, 0, terminatorLen);
    // Pad to byte boundary
    while (bits.length % 8 !== 0)
        bits.push(0);
    // Pad codewords
    const padWords = [0xEC, 0x11];
    let padIdx = 0;
    while (bits.length < dataBits) {
        pushBits(bits, padWords[padIdx % 2], 8);
        padIdx++;
    }
    // Convert to bytes
    const dataBytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) {
            byte = (byte << 1) | (bits[i + j] || 0);
        }
        dataBytes.push(byte);
    }
    // Split into blocks and generate EC
    const blocksData = [];
    const blocksEc = [];
    const shortBlockLen = Math.floor(dataCodewords / numBlocks);
    const longBlocks = dataCodewords % numBlocks;
    let offset = 0;
    for (let b = 0; b < numBlocks; b++) {
        const blockLen = shortBlockLen + (b >= numBlocks - longBlocks ? 1 : 0);
        const block = dataBytes.slice(offset, offset + blockLen);
        blocksData.push(block);
        blocksEc.push(reedSolomonEncode(block, ecCodewords));
        offset += blockLen;
    }
    // Interleave data codewords
    const result = [];
    const maxDataLen = Math.max(...blocksData.map(b => b.length));
    for (let i = 0; i < maxDataLen; i++) {
        for (const block of blocksData) {
            if (i < block.length)
                result.push(block[i]);
        }
    }
    // Interleave EC codewords
    for (let i = 0; i < ecCodewords; i++) {
        for (const block of blocksEc) {
            if (i < block.length)
                result.push(block[i]);
        }
    }
    return result;
}
function pushBits(arr, value, numBits) {
    for (let i = numBits - 1; i >= 0; i--) {
        arr.push((value >> i) & 1);
    }
}
// GF(256) arithmetic for Reed-Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x = x << 1;
        if (x >= 256)
            x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) {
        GF_EXP[i] = GF_EXP[i - 255];
    }
})();
function gfMul(a, b) {
    if (a === 0 || b === 0)
        return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function reedSolomonEncode(data, ecLen) {
    // Build generator polynomial
    let gen = [1];
    for (let i = 0; i < ecLen; i++) {
        const newGen = new Array(gen.length + 1).fill(0);
        for (let j = 0; j < gen.length; j++) {
            newGen[j] ^= gen[j];
            newGen[j + 1] ^= gfMul(gen[j], GF_EXP[i]);
        }
        gen = newGen;
    }
    const msg = new Array(data.length + ecLen).fill(0);
    for (let i = 0; i < data.length; i++)
        msg[i] = data[i];
    for (let i = 0; i < data.length; i++) {
        const coeff = msg[i];
        if (coeff !== 0) {
            for (let j = 0; j < gen.length; j++) {
                msg[i + j] ^= gfMul(gen[j], coeff);
            }
        }
    }
    return msg.slice(data.length);
}
function placeData(grid, reserved, codewords, size) {
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    // Traverse columns right-to-left in pairs, skipping column 6
    let col = size - 1;
    while (col >= 0) {
        if (col === 6)
            col--;
        for (let row = 0; row < size; row++) {
            for (let c = 0; c < 2; c++) {
                const actualCol = col - c;
                if (actualCol < 0)
                    continue;
                // Determine direction: upward for even pair index, downward for odd
                const pairIndex = Math.floor((size - 1 - col + (col < 6 ? 1 : 0)) / 2);
                const isUpward = pairIndex % 2 === 0;
                const actualRow = isUpward ? size - 1 - row : row;
                if (reserved[actualRow][actualCol])
                    continue;
                if (bitIdx < totalBits) {
                    const byteIdx = Math.floor(bitIdx / 8);
                    const bitOff = 7 - (bitIdx % 8);
                    grid[actualRow][actualCol] = ((codewords[byteIdx] >> bitOff) & 1) === 1;
                    bitIdx++;
                }
                else {
                    grid[actualRow][actualCol] = false;
                }
            }
        }
        col -= 2;
    }
}
function applyMask(grid, reserved, mask, size) {
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (reserved[r][c])
                continue;
            if (shouldMask(mask, r, c)) {
                grid[r][c] = !grid[r][c];
            }
        }
    }
}
function shouldMask(mask, row, col) {
    switch (mask) {
        case 0: return (row + col) % 2 === 0;
        case 1: return row % 2 === 0;
        case 2: return col % 3 === 0;
        case 3: return (row + col) % 3 === 0;
        case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
        case 5: return (row * col) % 2 + (row * col) % 3 === 0;
        case 6: return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
        case 7: return ((row + col) % 2 + (row * col) % 3) % 2 === 0;
        default: return false;
    }
}
function selectBestMask(grid, reserved, size) {
    // Simplified: use mask 0 (the spec says to pick the lowest penalty, but
    // a full penalty calculator is complex; mask 0 works well for most data)
    // For production use, evaluate all 8 masks and pick the one with lowest penalty.
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
        // Clone grid
        const test = grid.map(r => [...r]);
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!reserved[r][c] && shouldMask(m, r, c)) {
                    test[r][c] = !test[r][c];
                }
            }
        }
        const penalty = calcPenalty(test, size);
        if (penalty < bestPenalty) {
            bestPenalty = penalty;
            bestMask = m;
        }
    }
    return bestMask;
}
function calcPenalty(grid, size) {
    let penalty = 0;
    // Rule 1: Adjacent same-color modules in rows/cols
    for (let r = 0; r < size; r++) {
        let count = 1;
        for (let c = 1; c < size; c++) {
            if (grid[r][c] === grid[r][c - 1]) {
                count++;
                if (count === 5)
                    penalty += 3;
                else if (count > 5)
                    penalty += 1;
            }
            else {
                count = 1;
            }
        }
    }
    for (let c = 0; c < size; c++) {
        let count = 1;
        for (let r = 1; r < size; r++) {
            if (grid[r][c] === grid[r - 1][c]) {
                count++;
                if (count === 5)
                    penalty += 3;
                else if (count > 5)
                    penalty += 1;
            }
            else {
                count = 1;
            }
        }
    }
    // Rule 3: 1:1:3:1:1 finder-like pattern (simplified check)
    // Rule 4: Proportion of dark modules
    let dark = 0;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c])
                dark++;
        }
    }
    const total = size * size;
    const pct = (dark / total) * 100;
    penalty += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return penalty;
}
// Format info encoding (EC level M = 00, masks 0-7)
const FORMAT_INFO = [
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
];
function placeFormatInfo(grid, ecLevel, mask, size) {
    const info = FORMAT_INFO[mask];
    // Horizontal strip
    const hBits = [
        [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
        [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    ];
    for (let i = 0; i < 15; i++) {
        grid[hBits[i][0]][hBits[i][1]] = ((info >> (14 - i)) & 1) === 1;
    }
    // Vertical strip
    const vBits = [
        [8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4],
        [8, size - 5], [8, size - 6], [8, size - 7], [8, size - 8],
        [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8],
        [size - 3, 8], [size - 2, 8], [size - 1, 8],
    ];
    for (let i = 0; i < 15; i++) {
        grid[vBits[i][0]][vBits[i][1]] = ((info >> (14 - i)) & 1) === 1;
    }
}
function placeVersionInfo(grid, version, size) {
    if (version < 7)
        return;
    // Version info is an 18-bit sequence with BCH error correction
    const versionInfo = getVersionInfo(version);
    for (let i = 0; i < 18; i++) {
        const bit = ((versionInfo >> i) & 1) === 1;
        const row = Math.floor(i / 3);
        const col = size - 11 + (i % 3);
        grid[row][col] = bit;
        grid[col][row] = bit;
    }
}
function getVersionInfo(version) {
    // BCH(18,6) encoding for version info
    let d = version << 12;
    const gen = 0x1F25; // Generator polynomial
    let rem = d;
    for (let i = 5; i >= 0; i--) {
        if (rem & (1 << (i + 12))) {
            rem ^= gen << i;
        }
    }
    return d | rem;
}
// QR version tables for EC level M
function getTotalCodewords(version) {
    const table = [
        0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
        404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
        1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
        2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
    ];
    return table[version] || 26;
}
function getEcCodewordsPerBlock(version) {
    const table = [
        0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26,
        30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
        26, 28, 28, 28, 28, 28, 28, 28, 28, 28,
        28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    ];
    return table[version] || 10;
}
function getNumBlocks(version) {
    const table = [
        0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,
        5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
        17, 17, 18, 20, 21, 23, 25, 26, 28, 29,
        31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
    ];
    return table[version] || 1;
}
// ---------------------------------------------------------------------------
// CSS injection (idempotent — only injected once)
// ---------------------------------------------------------------------------
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected)
        return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
.kairos-pix {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  font-family: var(--kairos-font, inherit);
  color: var(--kairos-text, inherit);
}

.kairos-pix__amount {
  text-align: center;
}

.kairos-pix__amount-label {
  display: block;
  font-size: 0.875rem;
  opacity: 0.7;
}

.kairos-pix__amount-value {
  display: block;
  font-size: 2rem;
  font-weight: 700;
  margin-top: 2px;
}

.kairos-pix__qr-wrapper {
  position: relative;
  padding: 16px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

.kairos-pix__qr-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 8px;
  color: #bbb;
}

.kairos-pix__expired-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.9);
  border-radius: 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--kairos-error, #dc2626);
}

.kairos-pix__status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.kairos-pix__pulse {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--kairos-primary, #2563eb);
  animation: kairos-pix-pulse 1.5s ease-in-out infinite;
}

@keyframes kairos-pix-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

.kairos-pix__waiting {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--kairos-primary, #2563eb);
}

.kairos-pix__timer {
  font-size: 0.75rem;
  opacity: 0.6;
}

.kairos-pix__copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 320px;
  padding: 12px 24px;
  font-size: 0.9375rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--kairos-border, #e2e8f0);
  border-radius: var(--kairos-radius, 8px);
  background: var(--kairos-bg, #fff);
  color: var(--kairos-text, #1a1a1a);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.kairos-pix__copy-btn:hover {
  background: var(--kairos-bg-hover, #f8fafc);
  border-color: var(--kairos-border-hover, #cbd5e1);
}

.kairos-pix__copy-btn:active {
  transform: scale(0.98);
}
`;
    document.head.appendChild(style);
}

/**
 * PaymentPoller - Polls a status endpoint until a terminal status is reached.
 *
 * The SDK doesn't call Kairos API directly (it has no auth tokens).
 * Instead, the integrator provides a `fetchStatus` function that calls their
 * own backend, which in turn proxies to the Kairos transaction status API.
 *
 * @example
 * ```typescript
 * import { PaymentPoller } from '@kairos/payments-js';
 *
 * const poller = new PaymentPoller({
 *   fetchStatus: async () => {
 *     const res = await fetch(`/api/payments/status/${transactionId}`);
 *     return res.json(); // { status: 'CONFIRMED', ... }
 *   },
 *   onStatusChange: (status, data) => {
 *     if (status === 'CONFIRMED') showSuccess();
 *   },
 *   intervalMs: 3000,
 *   timeoutMs: 300000, // 5 minutes
 * });
 *
 * poller.start();
 * // later: poller.stop();
 * ```
 */
const TERMINAL_STATUSES = new Set([
    'CONFIRMED',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
    'REFUNDED',
    'CHARGEBACK',
]);
class PaymentPoller {
    constructor(config) {
        this.timer = null;
        this.timeoutTimer = null;
        this.lastStatus = null;
        this.running = false;
        this.config = {
            fetchStatus: config.fetchStatus,
            onStatusChange: config.onStatusChange || (() => { }),
            onComplete: config.onComplete || (() => { }),
            onError: config.onError || (() => { }),
            intervalMs: config.intervalMs ?? 3000,
            timeoutMs: config.timeoutMs ?? 300000,
        };
    }
    /** Start polling. Safe to call multiple times (no-op if already running). */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.lastStatus = null;
        // First poll immediately
        this.poll();
        // Then poll at interval
        this.timer = setInterval(() => this.poll(), this.config.intervalMs);
        // Auto-stop after timeout
        this.timeoutTimer = setTimeout(() => {
            this.stop();
            this.config.onStatusChange('EXPIRED', { status: 'EXPIRED', reason: 'polling_timeout' });
            this.config.onComplete('EXPIRED', { status: 'EXPIRED', reason: 'polling_timeout' });
        }, this.config.timeoutMs);
    }
    /** Stop polling and clean up timers. */
    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }
    /** Whether the poller is currently active. */
    get isRunning() {
        return this.running;
    }
    async poll() {
        if (!this.running)
            return;
        try {
            const data = await this.config.fetchStatus();
            const status = data.status?.toUpperCase() || 'PENDING';
            if (status !== this.lastStatus) {
                this.lastStatus = status;
                this.config.onStatusChange(status, data);
            }
            if (TERMINAL_STATUSES.has(status)) {
                this.stop();
                this.config.onComplete(status, data);
            }
        }
        catch (error) {
            this.config.onError(error);
        }
    }
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
const VERSION = '0.2.0';

export { CardPaymentForm, KairosEncryptedAdapter, KairosPayments, PaymentPoller, VERSION, clearEncryptionCache, createPixQrCode, encryptCardData, isEncryptionAvailable };
//# sourceMappingURL=kairos.esm.js.map
