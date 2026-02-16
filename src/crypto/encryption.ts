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

export interface CardDataToEncrypt {
  number: string;
  holderName: string;
  expirationMonth: string;
  expirationYear: string;
  cvv: string;
}

// Cache public keys per merchant (keyed by merchantId)
const keyCache = new Map<string, { key: CryptoKey; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (keys are persisted in DB per merchant)

/**
 * Fetch the RSA public key for a specific merchant from the Kairos tokenization endpoint.
 * Cached per merchant for 24 hours.
 */
async function fetchPublicKey(apiUrl: string, tenantId: string, merchantId?: string): Promise<CryptoKey> {
  const cacheKey = merchantId || '__default__';
  const now = Date.now();
  const cached = keyCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.key;
  }

  const params = merchantId ? `?merchantId=${merchantId}` : '';
  const res = await fetch(
    `${apiUrl}/api/v1/tokenization/${tenantId}/encryption-key${params}`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch encryption key: ${res.status}`);
  }

  const data = await res.json();
  const publicKeyBase64: string = data.publicKey;

  // Decode base64 -> ArrayBuffer
  const binaryString = atob(publicKeyBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Import as RSA-OAEP public key (SPKI format)
  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    bytes.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey']
  );
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
export async function encryptCardData(
  cardData: CardDataToEncrypt,
  apiUrl: string,
  tenantId: string,
  merchantId?: string
): Promise<string> {
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
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable (needed for RSA wrapping)
    ['encrypt']
  );

  // Generate random 12-byte IV for AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt card data with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    aesKey,
    plaintext
  );

  // Wrap (encrypt) the AES key with RSA-OAEP
  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    aesKey,
    rsaKey,
    { name: 'RSA-OAEP' }
  );

  // Build envelope JSON and base64 encode
  const envelope = JSON.stringify({
    ek: arrayBufferToBase64(wrappedKey),   // encrypted key
    iv: arrayBufferToBase64(iv.buffer),     // initialization vector
    d: arrayBufferToBase64(ciphertext),     // encrypted data (includes GCM auth tag)
  });

  return btoa(envelope);
}

/**
 * Check if card encryption is available for a merchant (endpoint reachable).
 */
export async function isEncryptionAvailable(apiUrl: string, tenantId: string, merchantId?: string): Promise<boolean> {
  try {
    await fetchPublicKey(apiUrl, tenantId, merchantId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the cached public key for a specific merchant, or all if no merchantId.
 */
export function clearEncryptionCache(merchantId?: string): void {
  if (merchantId) {
    keyCache.delete(merchantId);
  } else {
    keyCache.clear();
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
