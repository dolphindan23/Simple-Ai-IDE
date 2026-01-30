import { Router, Request, Response } from "express";
import { createCheckoutSession, createCustomerPortalSession } from "../integrations/stripe/client";
import { verifyWebhookSignature, handleWebhookEvent, WebhookHandlers } from "../integrations/stripe/webhook";
import { PLANS } from "../billing/plans";

const router = Router();

router.post("{{BILLING_ROUTE_PREFIX}}/stripe/checkout", async (req: Request, res: Response) => {
  try {
    const { priceId, customerId } = req.body;
    
    if (!priceId) {
      return res.status(400).json({ error: "priceId is required" });
    }

    const successUrl = `${req.protocol}://${req.get("host")}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${req.protocol}://${req.get("host")}/billing/cancel`;

    const session = await createCheckoutSession({
      priceId,
      customerId,
      successUrl,
      cancelUrl,
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error("Checkout error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("{{WEBHOOK_PATH}}", async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"] as string;
  
  if (!signature) {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }

  try {
    const event = verifyWebhookSignature(req.body, signature);

    const handlers: WebhookHandlers = {
      "checkout.session.completed": async (session) => {
        console.log("Checkout completed:", session.id);
      },
      "customer.subscription.created": async (subscription) => {
        console.log("Subscription created:", subscription.id);
      },
      "customer.subscription.updated": async (subscription) => {
        console.log("Subscription updated:", subscription.id, subscription.status);
      },
      "customer.subscription.deleted": async (subscription) => {
        console.log("Subscription cancelled:", subscription.id);
      },
      "invoice.payment_failed": async (invoice) => {
        console.log("Payment failed for invoice:", invoice.id);
      },
    };

    const result = await handleWebhookEvent(event, handlers);
    
    res.json({ received: true, handled: result.handled });
  } catch (error: any) {
    console.error("Webhook error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("{{BILLING_ROUTE_PREFIX}}/stripe/portal", async (req: Request, res: Response) => {
  try {
    const customerId = req.query.customerId as string;
    
    if (!customerId) {
      return res.status(400).json({ error: "customerId is required" });
    }

    const returnUrl = `${req.protocol}://${req.get("host")}/billing`;
    const session = await createCustomerPortalSession(customerId, returnUrl);

    res.json({ url: session.url });
  } catch (error: any) {
    console.error("Portal error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("{{BILLING_ROUTE_PREFIX}}/plans", (req: Request, res: Response) => {
  res.json({ plans: PLANS });
});

export default router;
