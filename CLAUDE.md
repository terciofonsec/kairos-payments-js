# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build     # Build all outputs (ESM, CJS, UMD)
npm run dev       # Build in watch mode
npm run test      # Run tests with Vitest
npm run lint      # Run ESLint
```

## Architecture

This is a JavaScript/TypeScript SDK for PCI-compliant card tokenization that wraps multiple PSP (Payment Service Provider) SDKs behind a unified interface.

### Core Flow

1. `KairosPayments.init()` fetches tokenization options from Kairos API (`/api/v1/tokenization/{tenantId}/options`)
2. Returns available PSPs with their public keys
3. `createCardPayment()` dynamically loads the appropriate PSP SDK and renders their native payment form
4. Card data is tokenized directly with the PSP (never touches merchant servers)
5. Token is returned to the merchant for backend processing

### Key Files

- `src/core/KairosPayments.ts` - Main SDK class, orchestrates PSP selection and initialization
- `src/adapters/MercadoPagoAdapter.ts` - MercadoPago Bricks integration
- `src/adapters/PagSeguroAdapter.ts` - PagSeguro SDK integration
- `src/components/CardPaymentForm.tsx` - React component wrapper
- `src/types.ts` - All TypeScript interfaces

### PSP Adapter Pattern

Each PSP implements the `PspAdapter` interface:
- `init(publicKey, options)` - Load PSP SDK script and initialize
- `createCardPayment(container, config)` - Render payment form
- `getInstallments(amount, bin)` - Fetch installment options
- `destroy()` - Cleanup resources

### Build Outputs

Rollup produces three bundles:
- `dist/kairos.esm.js` - ES modules (npm)
- `dist/kairos.cjs.js` - CommonJS (Node)
- `dist/kairos.min.js` - UMD bundle (CDN/browser)

React is an optional peer dependency - the SDK works without it for vanilla JS usage.

## Documentation Updates

When making changes to this SDK, update the following documentation:

### 1. Backend Integration Guide
**File:** `/kairos-payment-hub/docs/INTEGRATION_GUIDE.md`
- Section 8.2.1: SDK @kairos/payments-js
- Update version, installation instructions, and usage examples
- Update version history at the end of the file

### 2. Frontend Documentation Portal (Nextra)
**File:** `/kairos-payment-hub-docs/content/guides/credit-card.mdx`
- SDK installation and usage examples
- React component documentation
- CDN usage examples

**Related files that may need updates:**
- `/kairos-payment-hub-docs/content/guides/psp-integrations.mdx` - PSP-specific configurations
- `/kairos-payment-hub-docs/content/api-reference/` - If API contracts change

### Documentation Sync Checklist
- [ ] Update SDK version in both docs
- [ ] Update code examples if API changes
- [ ] Add new PSP adapters to supported PSPs table
- [ ] Update TypeScript interfaces documentation
