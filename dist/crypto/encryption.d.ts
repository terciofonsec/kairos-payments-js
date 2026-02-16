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
export interface CardDataToEncrypt {
    number: string;
    holderName: string;
    expirationMonth: string;
    expirationYear: string;
    cvv: string;
}
/**
 * Encrypt card data for secure transmission to the backend.
 *
 * @param cardData Raw card fields
 * @param apiUrl Kairos API base URL
 * @param tenantId Tenant identifier
 * @returns Base64-encoded encrypted envelope
 */
export declare function encryptCardData(cardData: CardDataToEncrypt, apiUrl: string, tenantId: string): Promise<string>;
/**
 * Check if card encryption is available (endpoint reachable).
 */
export declare function isEncryptionAvailable(apiUrl: string, tenantId: string): Promise<boolean>;
/**
 * Clear the cached public key.
 */
export declare function clearEncryptionCache(): void;
