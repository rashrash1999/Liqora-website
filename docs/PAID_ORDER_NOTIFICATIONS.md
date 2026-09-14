# Paid order notifications

The site itself is static. Payment verification and Unifonic credentials must therefore stay on a server-side endpoint. The repository includes a Vercel Function at `api/orders/paid.mjs`.

## Flow

1. The payment backend verifies the payment with the selected gateway.
2. It sends one canonical `payment.succeeded` event to `POST /api/orders/paid`.
3. The endpoint authenticates the caller using `x-liqora-webhook-secret`.
4. The event ID is reserved to prevent duplicate notifications.
5. Unifonic sends the alert via SMS or an approved WhatsApp template.

## Canonical event

```json
{
  "eventId": "payment_evt_01JXYZ",
  "eventType": "payment.succeeded",
  "order": {
    "id": "LQ-260830-1234",
    "amount": 399,
    "currency": "SAR",
    "customerName": "سارة أحمد",
    "customerPhone": "0500000000",
    "paymentMethod": "mada",
    "paidAt": "2026-08-30T09:15:00+03:00"
  }
}
```

Header:

```text
x-liqora-webhook-secret: <PAID_ORDER_WEBHOOK_SECRET>
```

## WhatsApp template

For `UNIFONIC_CHANNEL=whatsapp`, create and approve a Utility template in Unifonic/Meta with six body variables in this order:

1. Order ID
2. Amount
3. Currency
4. Customer name
5. Payment method
6. Paid-at time

Suggested Arabic body:

```text
طلب مدفوع جديد 🟢
رقم الطلب: {{1}}
المبلغ: {{2}} {{3}}
العميل: {{4}}
طريقة الدفع: {{5}}
وقت الدفع: {{6}}
```

## Idempotency

For local development, the endpoint uses an in-memory idempotency store. For production/serverless deployment, configure Upstash Redis using the two environment variables in `.env.example` so duplicate payment webhooks do not send duplicate alerts.

## Security rules

- Never place Unifonic credentials in `js/*.js`, HTML, or GitHub-tracked `.env` files.
- The browser must never be trusted to claim that a payment succeeded.
- Only the payment backend/provider adapter should call this endpoint after payment verification.
- Use HTTPS in production.
