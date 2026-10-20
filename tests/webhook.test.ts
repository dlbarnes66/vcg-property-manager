// Run with the react-server condition (see package.json "test") so server-only modules load.
import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

test("webhook rejects unsigned and forged requests, accepts a valid signature", async () => {
  const { POST } = await import("../src/app/api/stripe/webhook/route");
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.created", data: { object: {} } });

  const unsigned = await POST(new Request("http://x/api/stripe/webhook", { method: "POST", body: payload }));
  assert.equal(unsigned.status, 400);

  const forged = await POST(new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": "t=1,v1=deadbeef" } }));
  assert.equal(forged.status, 400);

  const header = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
  const good = await POST(new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  assert.equal(good.status, 200); // unhandled event type is acknowledged and ignored
});
