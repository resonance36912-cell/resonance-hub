/**
 * Serialize a mocked `CheckoutSessionView` into the exact seroval envelope
 * that TanStack Start's server-fn client expects. Consumed by
 * `tests/e2e/checkout-success-redirect.py` to fulfill the intercepted
 * `getCheckoutSession` POST without hitting the real (auth-gated) handler.
 *
 * Usage: bun scripts/e2e/checkout-success-seroval.mjs <status> <sessionId>
 * Emits the JSON envelope on stdout.
 */
import { toJSON } from "seroval";

const status = process.argv[2];
const sessionId = process.argv[3];
if (!status || !sessionId) {
  console.error("usage: checkout-success-seroval.mjs <status> <sessionId>");
  process.exit(2);
}

const view = {
  id: sessionId,
  sku: "all_access:creator_pass:monthly",
  app: "all_access",
  tier: "creator_pass",
  cycle: "monthly",
  amountCents: 49900,
  currency: "ZAR",
  status,
  pfPaymentId: null,
  lastEventAt: "2026-01-01T00:00:00.000Z",
  errorMessage: status === "failed" ? "Card declined" : null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  events: [],
};

// Envelope matches what start-server-core returns: { result, error, context }.
const envelope = { result: view, error: undefined, context: {} };
const j = toJSON(envelope);
// The server response body is the inner seroval node (see probe: no `f`/`m`
// wrapper on the wire — x-tss-serialized: true does the tagging).
process.stdout.write(JSON.stringify(j.t));
