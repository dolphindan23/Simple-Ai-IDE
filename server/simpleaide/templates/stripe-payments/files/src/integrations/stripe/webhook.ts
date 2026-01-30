import Stripe from "stripe";
import { stripe } from "./client";

export interface WebhookEvent {
  type: string;
  data: any;
}

export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable is required");
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

export type WebhookHandlers = {
  "checkout.session.completed"?: (session: Stripe.Checkout.Session) => Promise<void>;
  "customer.subscription.created"?: (subscription: Stripe.Subscription) => Promise<void>;
  "customer.subscription.updated"?: (subscription: Stripe.Subscription) => Promise<void>;
  "customer.subscription.deleted"?: (subscription: Stripe.Subscription) => Promise<void>;
  "invoice.payment_succeeded"?: (invoice: Stripe.Invoice) => Promise<void>;
  "invoice.payment_failed"?: (invoice: Stripe.Invoice) => Promise<void>;
};

export async function handleWebhookEvent(
  event: Stripe.Event,
  handlers: WebhookHandlers
): Promise<{ handled: boolean }> {
  const eventType = event.type as keyof WebhookHandlers;
  const handler = handlers[eventType];

  if (handler) {
    await handler(event.data.object as any);
    return { handled: true };
  }

  return { handled: false };
}
