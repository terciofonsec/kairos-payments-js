# @kairos/payments-js

SDK JavaScript para integração com o Kairos Payment Hub. Suporta tokenização de cartão e pagamentos via múltiplos PSPs (MercadoPago, PagSeguro, etc.).

## Instalação

```bash
npm install @kairos/payments-js
```

Ou via CDN:

```html
<script src="https://unpkg.com/@kairos/payments-js@latest/dist/kairos.min.js"></script>
```

## Quick Start

### JavaScript/TypeScript

```typescript
import { KairosPayments } from '@kairos/payments-js';

// 1. Inicializar (busca config do tenant automaticamente)
const kairos = await KairosPayments.init({
  tenantId: 'seu-tenant-id',
  environment: 'production' // ou 'sandbox'
});

// 2. Criar formulário de pagamento
await kairos.createCardPayment('#card-form', {
  amount: 100.00,
  maxInstallments: 12,

  onReady: () => {
    console.log('Formulário pronto!');
  },

  onSubmit: async (data) => {
    // Enviar token para seu backend
    await fetch('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        cardToken: data.token,
        installments: data.installments,
        amount: 100.00
      })
    });
  },

  onError: (error) => {
    console.error('Erro:', error.message);
  }
});
```

### React

```tsx
import { CardPaymentForm } from '@kairos/payments-js';

function Checkout() {
  return (
    <CardPaymentForm
      tenantId="seu-tenant-id"
      amount={100.00}
      environment="production"
      onSuccess={(data) => {
        console.log('Token:', data.token);
        // Enviar para seu backend
      }}
      onError={(error) => {
        console.error('Erro:', error.message);
      }}
    />
  );
}
```

### HTML Puro (CDN)

```html
<div id="card-form"></div>

<script src="https://unpkg.com/@kairos/payments-js@latest/dist/kairos.min.js"></script>
<script>
  (async function() {
    const kairos = await Kairos.Payments.init({
      tenantId: 'seu-tenant-id',
      environment: 'production'
    });

    await kairos.createCardPayment('#card-form', {
      amount: 100.00,
      onSubmit: function(data) {
        console.log('Token:', data.token);
      }
    });
  })();
</script>
```

## Configuração

### KairosConfig

| Propriedade | Tipo | Obrigatório | Descrição |
|-------------|------|-------------|-----------|
| `tenantId` | string | Sim | Identificador do tenant |
| `environment` | 'sandbox' \| 'production' | Não | Ambiente (padrão: 'production') |
| `apiUrl` | string | Não | URL da API (padrão: 'https://api.kairoshub.tech') |
| `preferredProvider` | string | Não | PSP preferido ('MERCADOPAGO', 'PAGSEGURO') |
| `locale` | string | Não | Idioma ('pt-BR', 'en-US', 'es') |
| `debug` | boolean | Não | Ativar logs de debug |

### CardPaymentConfig

| Propriedade | Tipo | Obrigatório | Descrição |
|-------------|------|-------------|-----------|
| `amount` | number | Sim | Valor em reais |
| `maxInstallments` | number | Não | Máximo de parcelas (padrão: 12) |
| `showInstallments` | boolean | Não | Mostrar seletor de parcelas |
| `onReady` | () => void | Não | Callback quando formulário está pronto |
| `onSubmit` | (data) => void | Sim | Callback com dados do pagamento |
| `onError` | (error) => void | Não | Callback de erro |
| `onChange` | (state) => void | Não | Callback quando valores mudam |

## PaymentData (Retornado no onSubmit)

```typescript
interface PaymentData {
  token: string;           // Token do cartão (enviar para backend)
  installments: number;    // Parcelas selecionadas
  paymentMethodId: string; // 'visa', 'mastercard', etc.
  issuerId: string;        // ID do emissor
  lastFourDigits: string;  // Últimos 4 dígitos
  cardholderName: string;  // Nome no cartão
  provider: string;        // PSP usado ('MERCADOPAGO', 'PAGSEGURO')
}
```

## PSPs Suportados

| PSP | Cartão | PIX | Boleto |
|-----|--------|-----|--------|
| MercadoPago | ✅ | ✅ | ✅ |
| PagSeguro | ✅ | ✅ | ✅ |

## Como Funciona

1. O SDK busca as credenciais do tenant via API do Kairos
2. Carrega dinamicamente o SDK do PSP configurado
3. Renderiza o formulário de pagamento usando componentes nativos do PSP
4. Tokeniza o cartão diretamente com o PSP (PCI Compliant)
5. Retorna o token para você enviar ao seu backend

```
┌──────────────────────────────────────────────────────────────┐
│  Seu Frontend                                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  @kairos/payments-js                                    │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  SDK do PSP (MercadoPago.js / PagSeguro SDK)     │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│       │                                                       │
│       │ 1. Busca config                                      │
│       ▼                                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Kairos API (/api/v1/tokenization/{tenant}/options)    │  │
│  └────────────────────────────────────────────────────────┘  │
│       │                                                       │
│       │ 2. Tokeniza cartão                                   │
│       ▼                                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  PSP (MercadoPago / PagSeguro)                         │  │
│  └────────────────────────────────────────────────────────┘  │
│       │                                                       │
│       │ 3. Token                                             │
│       ▼                                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Seu Backend → Kairos API → PSP                        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Segurança

- **PCI DSS Compliant**: Dados do cartão nunca passam pelo seu servidor
- **Tokenização**: Apenas tokens são transmitidos
- **HTTPS**: Todas as comunicações são criptografadas

## Documentação

- [Documentação Completa](https://docs.kairoshub.tech/sdk/javascript)
- [Guia de Integração](https://docs.kairoshub.tech/guides/credit-card)
- [API Reference](https://docs.kairoshub.tech/api-reference)

## Suporte

- [GitHub Issues](https://github.com/kairos-payments/kairos-js/issues)
- [Email](mailto:suporte@kairoshub.tech)

## Licença

MIT
