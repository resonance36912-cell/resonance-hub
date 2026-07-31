/**
 * Privacy + correctness contract for redirect audit records.
 *
 * The audit trail must be able to answer "allow or deny, and where did we send
 * them?" while retaining NO caller-supplied path, query, or fragment — those
 * carry tokens, emails, and phishing payloads. These tests pin that invariant
 * against adversarial and legitimate `return_to` inputs.
 */
import { describe, expect, it } from "bun:test";
import { buildReturnToAuditRecord } from "../../src/lib/return-to-audit";
import { resolveCheckoutContext } from "../../src/lib/checkout-return";
import { computeCheckoutSuccessCtas } from "../../src/lib/checkout-success-ctas";
import { ALLOWED_RETURN_TO_ORIGINS } from "../../src/lib/return-to-allowlist";

const HUB = "https://reson8.life";
const SECRET_PATH = "/account?token=SUPERSECRET#frag";

const allowedSpoke = ALLOWED_RETURN_TO_ORIGINS.find((o) =>
  o.includes("resonanceonline.life"),
)!;

const hostile: readonly string[] = [
  "https://evil.example/phish?token=abc#x",
  "https://reson8.life.evil.example/steal?jwt=eyJ",
  "https://user:pass@reson8.life/account",
  "http://reson8.life/account",
  "javascript:alert(1)",
  "//reson8.life/account",
  "/account",
  "not a url",
];

function primaryTarget(sku?: string, pack?: string, return_to?: string) {
  const ctx = resolveCheckoutContext({
    sku: sku ?? null,
    pack: pack ?? null,
    return_to: return_to ?? null,
  });
  const cta = computeCheckoutSuccessCtas({ phase: "succeeded", ctx }).find(
    (c) => c.id === "primary",
  );
  return cta?.target ?? null;
}

describe("buildReturnToAuditRecord — verdicts", () => {
  it("records an allow verdict with origin only for an allowlisted candidate", () => {
    const candidate = `${allowedSpoke}/library?ref=hub#top`;
    const rec = buildReturnToAuditRecord({
      surface: "checkout_success",
      candidate,
      target: primaryTarget(undefined, "epublisher_starter_pack", candidate),
      pack: "epublisher_starter_pack",
    });
    expect(rec.verdict).toBe("allow");
    expect(rec.candidatePresent).toBe(true);
    expect(rec.candidateOrigin).toBe(allowedSpoke);
    expect(rec.reasonCode).toBe("allowed_base");
  });

  it.each(hostile)("records a deny verdict for %s", (candidate) => {
    const rec = buildReturnToAuditRecord({
      surface: "checkout_success",
      candidate,
      target: primaryTarget("all_access:creator_pass:monthly", undefined, candidate),
      sku: "all_access:creator_pass:monthly",
    });
    expect(rec.verdict).toBe("deny");
    expect(rec.candidatePresent).toBe(true);
    expect(rec.reasonCode).not.toBe("allowed_base");
    expect(rec.reasonCode).not.toBe("allowed_extra");
  });

  it("distinguishes 'no return_to supplied' from a denial", () => {
    const rec = buildReturnToAuditRecord({
      surface: "checkout_cancel",
      candidate: null,
      target: primaryTarget("all_access:creator_pass:monthly"),
      sku: "all_access:creator_pass:monthly",
    });
    expect(rec.verdict).toBe("deny");
    expect(rec.candidatePresent).toBe(false);
    expect(rec.candidateOrigin).toBeNull();
    expect(rec.reasonCode).toBe("empty");
  });
});

describe("buildReturnToAuditRecord — no sensitive URL data is retained", () => {
  const candidates = [
    `${HUB}${SECRET_PATH}`,
    `${allowedSpoke}/doc/abc123?email=a%40b.com&token=zzz#s`,
    ...hostile,
  ];

  it.each(candidates)("never stores path/query/fragment of %s", (candidate) => {
    const rec = buildReturnToAuditRecord({
      surface: "payfast_launch",
      candidate,
      target: primaryTarget(undefined, "epublisher_starter_pack", candidate),
      pack: "epublisher_starter_pack",
    });

    const serialized = JSON.stringify(rec);
    // The raw candidate string itself must never appear.
    expect(serialized).not.toContain(candidate);
    for (const secret of ["SUPERSECRET", "token=", "jwt=", "eyJ", "a%40b.com", "#"]) {
      expect(serialized).not.toContain(secret);
    }
    // Whatever origin we kept must be a bare origin (no path segment).
    if (rec.candidateOrigin) {
      expect(new URL(rec.candidateOrigin).pathname).toBe("/");
      expect(rec.candidateOrigin).toBe(new URL(rec.candidateOrigin).origin);
    }
  });

  it("keeps the canonical target as origin + path with no query or fragment", () => {
    const candidate = `${allowedSpoke}/library?ref=hub#top`;
    const rec = buildReturnToAuditRecord({
      surface: "checkout_success",
      candidate,
      target: primaryTarget(undefined, "epublisher_starter_pack", candidate),
      pack: "epublisher_starter_pack",
    });
    expect(rec.targetKind).toBe("external");
    expect(rec.targetOrigin).toBe(allowedSpoke);
    expect(rec.targetPath).toBe("/library");
    expect(rec.targetPath).not.toContain("?");
    expect(rec.targetPath).not.toContain("#");
  });

  it("records internal pricing fallbacks as a path + hash", () => {
    const rec = buildReturnToAuditRecord({
      surface: "checkout_success",
      candidate: "https://evil.example/",
      target: primaryTarget("all_access:creator_pass:monthly", undefined, "https://evil.example/"),
      sku: "all_access:creator_pass:monthly",
    });
    expect(rec.targetKind).toBe("internal");
    expect(rec.targetPath).toBe("/pricing#passes");
    expect(rec.targetOrigin).toBeNull();
  });

  it("target for a denied candidate never derives from the attacker input", () => {
    for (const bad of hostile) {
      const rec = buildReturnToAuditRecord({
        surface: "checkout_success",
        candidate: bad,
        target: primaryTarget(undefined, "epublisher_starter_pack", bad),
        pack: "epublisher_starter_pack",
      });
      if (rec.targetOrigin) {
        expect(ALLOWED_RETURN_TO_ORIGINS).toContain(rec.targetOrigin);
      }
    }
  });
});
