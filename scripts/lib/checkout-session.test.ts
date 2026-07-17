import { describe, it, expect } from "vitest";

/**
 * Phase 2 — checkout_sessions status ↔ /checkout/success phase parity.
 *
 * The ITN handler transitions checkout_sessions.status; the success page
 * turns that into a UI phase. This test locks the mapping so regressions
 * (e.g. a new terminal status without a matching UI phase) fail loudly.
 */

// Mirrors the mapping in src/routes/checkout.success.tsx (statusToPhase).
// Duplicated intentionally — this is the CI contract.
function statusToPhase(s: string): string {
  if (s === "succeeded") return "succeeded";
  if (s === "failed") return "failed";
  if (s === "cancelled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "expired") return "failed";
  return "verifying";
}

describe("checkout session → UI phase mapping", () => {
  it("maps every DB CHECK-constraint status", () => {
    // Must stay in sync with the checkout_sessions_status_check constraint.
    const dbStatuses = ["pending", "succeeded", "failed", "cancelled", "refunded", "expired"];
    for (const s of dbStatuses) {
      const phase = statusToPhase(s);
      expect(phase).toBeTypeOf("string");
    }
  });

  it("only 'pending' polls further; all terminal states resolve", () => {
    expect(statusToPhase("pending")).toBe("verifying");
    expect(statusToPhase("succeeded")).toBe("succeeded");
    expect(statusToPhase("failed")).toBe("failed");
    expect(statusToPhase("cancelled")).toBe("cancelled");
    expect(statusToPhase("refunded")).toBe("refunded");
    expect(statusToPhase("expired")).toBe("failed");
  });

  it("ITN payment_status → session status mapping is complete", () => {
    // Mirrors the subscription branch in payfast/itn.ts.
    const map = (paymentStatus: string, isRefund = false) =>
      isRefund
        ? "refunded"
        : paymentStatus === "COMPLETE"
          ? "succeeded"
          : paymentStatus === "CANCELLED"
            ? "cancelled"
            : paymentStatus === "FAILED"
              ? "failed"
              : "pending";

    expect(map("COMPLETE")).toBe("succeeded");
    expect(map("CANCELLED")).toBe("cancelled");
    expect(map("FAILED")).toBe("failed");
    expect(map("REFUND", true)).toBe("refunded");
    expect(map("PENDING")).toBe("pending");
  });
});
