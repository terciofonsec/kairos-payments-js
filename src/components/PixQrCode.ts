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

export interface PixQrCodeConfig {
  /** Payment amount in BRL */
  amount: number;

  /** PIX copia e cola payload (the text string users paste into their bank app) */
  copyPaste: string;

  /** QR code as base64 data URI or raw base64 string (optional — generated from copyPaste if omitted) */
  qrCodeBase64?: string;

  /** Expiration timestamp ISO string (optional — no countdown if omitted) */
  expiresAt?: string;

  /** Locale for labels (default: 'pt-BR') */
  locale?: 'pt-BR' | 'en-US' | 'es';

  /** Callback when the copia e cola code is copied */
  onCopy?: () => void;

  /** Callback when the PIX expires */
  onExpired?: () => void;

  /** QR code size in pixels (default: 200) */
  qrSize?: number;
}

export interface PixQrCodeInstance {
  /** Copy the copia e cola code to clipboard programmatically */
  copyToClipboard(): Promise<void>;

  /** Destroy the component and clean up timers */
  destroy(): void;
}

export function createPixQrCode(
  container: string | HTMLElement,
  config: PixQrCodeConfig
): PixQrCodeInstance {
  const containerEl = typeof container === 'string'
    ? document.querySelector<HTMLElement>(container)
    : container;

  if (!containerEl) {
    throw new Error(`PixQrCode: container not found: ${container}`);
  }

  const locale = config.locale || 'pt-BR';
  const qrSize = config.qrSize || 200;
  const labels = getLabels(locale);
  let countdownInterval: ReturnType<typeof setInterval> | null = null;
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  let expired = false;

  // Render HTML
  containerEl.innerHTML = buildHtml(config, labels, qrSize);

  // Inject styles (once per page)
  injectStyles();

  // Resolve QR code image
  const qrImg = containerEl.querySelector('[data-kairos-pix-qr]') as HTMLImageElement | null;
  const qrPlaceholder = containerEl.querySelector('[data-kairos-pix-qr-placeholder]') as HTMLElement | null;

  resolveQrImage(config, qrSize).then((src) => {
    if (qrImg && src) {
      qrImg.src = src;
      qrImg.style.display = 'block';
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
    }
  });

  // Copy button handler
  const copyBtn = containerEl.querySelector('[data-kairos-pix-copy]') as HTMLButtonElement | null;
  const copyLabel = containerEl.querySelector('[data-kairos-pix-copy-label]') as HTMLElement | null;

  const doCopy = async () => {
    if (!config.copyPaste || expired) return;
    try {
      await navigator.clipboard.writeText(config.copyPaste);
      if (copyLabel) {
        copyLabel.textContent = labels.copied;
        if (copyTimeout) clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
          if (copyLabel) copyLabel.textContent = labels.copyCode;
        }, 3000);
      }
      config.onCopy?.();
    } catch {
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
        if (copyTimeout) clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
          if (copyLabel) copyLabel.textContent = labels.copyCode;
        }, 3000);
      }
      config.onCopy?.();
    }
  };

  copyBtn?.addEventListener('click', doCopy);

  // Countdown timer
  const countdownEl = containerEl.querySelector('[data-kairos-pix-countdown]') as HTMLElement | null;
  const expiryRow = containerEl.querySelector('[data-kairos-pix-expiry-row]') as HTMLElement | null;
  const expiredOverlay = containerEl.querySelector('[data-kairos-pix-expired]') as HTMLElement | null;

  if (config.expiresAt) {
    countdownInterval = setInterval(() => {
      const now = Date.now();
      const expiresMs = new Date(config.expiresAt!).getTime();
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
        if (expiryRow) expiryRow.style.display = 'none';
        if (expiredOverlay) expiredOverlay.style.display = 'flex';
        if (copyBtn) copyBtn.style.display = 'none';
        config.onExpired?.();
      }
    }, 1000);
  }

  return {
    copyToClipboard: doCopy,
    destroy() {
      if (countdownInterval) clearInterval(countdownInterval);
      if (copyTimeout) clearTimeout(copyTimeout);
      containerEl.innerHTML = '';
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function getLabels(locale: string) {
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

function buildHtml(
  config: PixQrCodeConfig,
  labels: ReturnType<typeof getLabels>,
  qrSize: number
): string {
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

async function resolveQrImage(config: PixQrCodeConfig, size: number): Promise<string | null> {
  // 1. If base64 provided by PSP
  const b64 = config.qrCodeBase64;
  if (b64) {
    if (b64.startsWith('data:')) return b64;
    if (b64.startsWith('PHN2Zy')) return `data:image/svg+xml;base64,${b64}`;
    if (!b64.startsWith('http')) return `data:image/png;base64,${b64}`;
  }

  // 2. Generate QR from copyPaste using Canvas (no external dependencies)
  if (config.copyPaste) {
    try {
      return await generateQrDataUrl(config.copyPaste, size);
    } catch {
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
async function generateQrDataUrl(text: string, size: number): Promise<string> {
  // Use the qr-code matrix generator and render to canvas
  const modules = generateQrMatrix(text);
  const moduleCount = modules.length;
  const cellSize = Math.floor(size / (moduleCount + 8)); // Add quiet zone
  const offset = Math.floor((size - cellSize * moduleCount) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

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

function generateQrMatrix(data: string): boolean[][] {
  const bytes = new TextEncoder().encode(data);
  const version = selectVersion(bytes.length);
  const size = version * 4 + 17;

  // Create module grid
  const grid: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // Place finder patterns
  placeFinder(grid, reserved, 0, 0);
  placeFinder(grid, reserved, size - 7, 0);
  placeFinder(grid, reserved, 0, size - 7);

  // Place alignment patterns
  const alignPos = getAlignmentPositions(version);
  for (const r of alignPos) {
    for (const c of alignPos) {
      if (reserved[r]?.[c]) continue;
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
  const codewords = encodeData(bytes, version, ecLevel);

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

function selectVersion(dataLen: number): number {
  // Byte mode capacity for EC level M
  const capacities = [
    0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
    251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
    711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370,
    1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331,
  ];
  for (let v = 1; v <= 40; v++) {
    if (capacities[v] >= dataLen) return v;
  }
  throw new Error('PixQrCode: data too long for QR code');
}

function getAlignmentPositions(version: number): number[] {
  if (version <= 1) return [];
  const positions: number[][] = [
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

function placeFinder(grid: (boolean | null)[][], reserved: boolean[][], row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const gr = row + r;
      const gc = col + c;
      if (gr < 0 || gc < 0 || gr >= grid.length || gc >= grid.length) continue;
      const inOuter = r === 0 || r === 6 || c === 0 || c === 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      grid[gr][gc] = (r >= 0 && r <= 6 && c >= 0 && c <= 6) && (inOuter || inInner);
      reserved[gr][gc] = true;
    }
  }
}

function placeAlignment(grid: (boolean | null)[][], reserved: boolean[][], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const gr = row + r;
      const gc = col + c;
      if (gr < 0 || gc < 0 || gr >= grid.length || gc >= grid.length) continue;
      if (reserved[gr][gc]) return; // Overlap with finder
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
function encodeData(data: Uint8Array, version: number, _ecLevel: number): number[] {
  const totalCodewords = getTotalCodewords(version);
  const ecCodewords = getEcCodewordsPerBlock(version);
  const numBlocks = getNumBlocks(version);
  const dataCodewords = totalCodewords - ecCodewords * numBlocks;

  // Build data stream: mode(4) + count(8 or 16) + data + terminator + padding
  const bits: number[] = [];

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
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad codewords
  const padWords = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < dataBits) {
    pushBits(bits, padWords[padIdx % 2], 8);
    padIdx++;
  }

  // Convert to bytes
  const dataBytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i + j] || 0);
    }
    dataBytes.push(byte);
  }

  // Split into blocks and generate EC
  const blocksData: number[][] = [];
  const blocksEc: number[][] = [];
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
  const result: number[] = [];
  const maxDataLen = Math.max(...blocksData.map(b => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocksData) {
      if (i < block.length) result.push(block[i]);
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < ecCodewords; i++) {
    for (const block of blocksEc) {
      if (i < block.length) result.push(block[i]);
    }
  }

  return result;
}

function pushBits(arr: number[], value: number, numBits: number) {
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
    if (x >= 256) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function reedSolomonEncode(data: number[], ecLen: number): number[] {
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
  for (let i = 0; i < data.length; i++) msg[i] = data[i];

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

function placeData(grid: (boolean | null)[][], reserved: boolean[][], codewords: number[], size: number) {
  let bitIdx = 0;
  const totalBits = codewords.length * 8;

  // Traverse columns right-to-left in pairs, skipping column 6
  let col = size - 1;
  while (col >= 0) {
    if (col === 6) col--;

    for (let row = 0; row < size; row++) {
      for (let c = 0; c < 2; c++) {
        const actualCol = col - c;
        if (actualCol < 0) continue;

        // Determine direction: upward for even pair index, downward for odd
        const pairIndex = Math.floor((size - 1 - col + (col < 6 ? 1 : 0)) / 2);
        const isUpward = pairIndex % 2 === 0;
        const actualRow = isUpward ? size - 1 - row : row;

        if (reserved[actualRow][actualCol]) continue;

        if (bitIdx < totalBits) {
          const byteIdx = Math.floor(bitIdx / 8);
          const bitOff = 7 - (bitIdx % 8);
          grid[actualRow][actualCol] = ((codewords[byteIdx] >> bitOff) & 1) === 1;
          bitIdx++;
        } else {
          grid[actualRow][actualCol] = false;
        }
      }
    }
    col -= 2;
  }
}

function applyMask(grid: (boolean | null)[][], reserved: boolean[][], mask: number, size: number) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (shouldMask(mask, r, c)) {
        grid[r][c] = !grid[r][c];
      }
    }
  }
}

function shouldMask(mask: number, row: number, col: number): boolean {
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

function selectBestMask(grid: (boolean | null)[][], reserved: boolean[][], size: number): number {
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

function calcPenalty(grid: (boolean | null)[][], size: number): number {
  let penalty = 0;

  // Rule 1: Adjacent same-color modules in rows/cols
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) {
        count++;
        if (count === 5) penalty += 3;
        else if (count > 5) penalty += 1;
      } else {
        count = 1;
      }
    }
  }
  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === grid[r - 1][c]) {
        count++;
        if (count === 5) penalty += 3;
        else if (count > 5) penalty += 1;
      } else {
        count = 1;
      }
    }
  }

  // Rule 3: 1:1:3:1:1 finder-like pattern (simplified check)
  // Rule 4: Proportion of dark modules
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) dark++;
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

function placeFormatInfo(grid: (boolean | null)[][], ecLevel: number, mask: number, size: number) {
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

function placeVersionInfo(grid: (boolean | null)[][], version: number, size: number) {
  if (version < 7) return;

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

function getVersionInfo(version: number): number {
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
function getTotalCodewords(version: number): number {
  const table = [
    0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
    404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
    1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
    2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
  ];
  return table[version] || 26;
}

function getEcCodewordsPerBlock(version: number): number {
  const table = [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26,
    30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ];
  return table[version] || 10;
}

function getNumBlocks(version: number): number {
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
  if (stylesInjected) return;
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
