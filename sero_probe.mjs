import { toJSON } from "seroval";
const status = process.argv[2] || "succeeded";
const view = {
  id: "11111111-1111-4111-8111-111111111111",
  sku: "all_access:creator_pass:monthly",
  app: "all_access", tier: "creator_pass", cycle: "monthly",
  amountCents: 49900, currency: "ZAR", status,
  pfPaymentId: null, lastEventAt: "2026-01-01T00:00:00.000Z",
  errorMessage: status === "failed" ? "Card declined" : null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  events: [],
};
// Server envelope: { result, error, context }
const envelope = { result: view, error: undefined, context: {} };
const j = toJSON(envelope);
// Print just the inner node (this matches what the server returns).
console.log(JSON.stringify(j.t));
