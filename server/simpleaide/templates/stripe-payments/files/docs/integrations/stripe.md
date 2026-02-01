# Stripe Integration Setup Guide

## Prerequisites

1. A Stripe account (test or live mode)
2. Node.js 18+ installed

## Setup Steps

### 1. Get your Stripe API keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copy your **Secret key** (starts with `sk_test_` or `sk_live_`)
3. Add it to your `.env` file:

```bash
STRIPE_SECRET_KEY=sk_test_your_key_here
```

### 2. Create Products and Prices

1. Go to [Stripe Products](https://dashboard.stripe.com/products)
2. Create products for each plan (Pro, Enterprise, etc.)
3. Create prices for each product
4. Copy the price IDs and update `src/billing/plans.ts`

### 3. Set up Webhooks

1. Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Set the endpoint URL: `https://your-domain.com{{WEBHOOK_PATH}}`
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the webhook signing secret and add to `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

### 4. Local Development with Stripe CLI

For local testing, use the Stripe CLI:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000{{WEBHOOK_PATH}}
```

The CLI will provide a webhook signing secret for local testing.

## API Endpoints

### Create Checkout Session
```
POST {{BILLING_ROUTE_PREFIX}}/stripe/checkout
Content-Type: application/json

{
  "priceId": "price_xxx",
  "customerId": "cus_xxx" (optional)
}
```

### Access Customer Portal
```
GET {{BILLING_ROUTE_PREFIX}}/stripe/portal?customerId=cus_xxx
```

### List Available Plans
```
GET {{BILLING_ROUTE_PREFIX}}/plans
```

## Testing

Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Requires auth: `4000 0025 0000 3155`

## Security Checklist

- [ ] Never log or expose your secret key
- [ ] Always verify webhook signatures
- [ ] Use HTTPS in production
- [ ] Store customer IDs, not payment details
- [ ] Validate all input before sending to Stripe
