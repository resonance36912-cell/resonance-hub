import { afterEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EmailTransportError, sendTransactionalEmail } from "../../src/lib/email-transport.server";
import {
  parseResendSuppressionEvent,
  ResendWebhookError,
  verifyResendWebhookSignature,
} from "../../src/lib/resend-webhook.server";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.RONS_RESEND_API_KEY;
const originalResendKey = process.env.RESEND_API_KEY;
const originalApiUrl = process.env.RONS_RESEND_API_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.RONS_RESEND_API_KEY;
  else process.env.RONS_RESEND_API_KEY = originalApiKey;
  if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendKey;
  if (originalApiUrl === undefined) delete process.env.RONS_RESEND_API_URL;
  else process.env.RONS_RESEND_API_URL = originalApiUrl;
});

function signedHeaders(body: string, nowSeconds = 1_700_000_000) {
  const id = "msg_test_123";
  const rawSecret = "RONSAS-test-webhook-secret-32bytes";
  const secret = `whsec_${Buffer.from(rawSecret).toString("base64")}`;
  const timestamp = String(nowSeconds);
  const signature = createHmac("sha256", Buffer.from(rawSecret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    secret,
    nowMs: nowSeconds * 1000,
    headers: new Headers({
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    }),
  };
}

describe("sovereign Resend email transport", () => {
  it("sends directly to the configured Resend endpoint with bearer auth and idempotency", async () => {
    process.env.RONS_RESEND_API_KEY = "re_test_key";
    process.env.RONS_RESEND_API_URL = "https://mail.invalid/emails";
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await sendTransactionalEmail({
      to: "person@example.com",
      from: "RONSAS <noreply@reson8.life>",
      subject: "Test",
      html: "<p>Hello</p>",
      text: "Hello",
      idempotencyKey: "test/123",
    });

    expect(capturedUrl).toBe("https://mail.invalid/emails");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("test/123");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      from: "RONSAS <noreply@reson8.life>",
      to: ["person@example.com"],
      subject: "Test",
      html: "<p>Hello</p>",
      text: "Hello",
    });
    expect(result).toEqual({ id: "email_123", provider: "resend" });
  });

  it("fails closed when no RONS-owned outbound email credential is configured", async () => {
    delete process.env.RONS_RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      await sendTransactionalEmail({ to: "a@example.com", from: "b@example.com", subject: "x", html: "x" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(EmailTransportError);
      expect((error as EmailTransportError).status).toBe(503);
    }
  });

  it("preserves provider rate-limit metadata for the retry workers", async () => {
    process.env.RONS_RESEND_API_KEY = "re_test_key";
    globalThis.fetch = (async () => new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "7" },
    })) as typeof fetch;
    try {
      await sendTransactionalEmail({ to: "a@example.com", from: "b@example.com", subject: "x", html: "x" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(EmailTransportError);
      expect((error as EmailTransportError).status).toBe(429);
      expect((error as EmailTransportError).retryAfterSeconds).toBe(7);
    }
  });
});

describe("Resend webhook verification and suppression mapping", () => {
  it("accepts a valid Svix-style signature and rejects a tampered body", () => {
    const body = JSON.stringify({ type: "email.bounced", data: { to: ["a@example.com"], email_id: "e1" } });
    const signed = signedHeaders(body);
    expect(() => verifyResendWebhookSignature(body, signed.headers, signed.secret, signed.nowMs)).not.toThrow();
    expect(() => verifyResendWebhookSignature(body + "x", signed.headers, signed.secret, signed.nowMs)).toThrow(ResendWebhookError);
  });

  it("rejects stale signed webhook requests", () => {
    const body = JSON.stringify({ type: "email.bounced", data: { to: ["a@example.com"] } });
    const signed = signedHeaders(body);
    try {
      verifyResendWebhookSignature(body, signed.headers, signed.secret, signed.nowMs + 301_000);
      throw new Error("expected stale failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResendWebhookError);
      expect((error as ResendWebhookError).code).toBe("stale_timestamp");
    }
  });

  it("maps bounce, complaint and provider suppression events without inventing reasons", () => {
    expect(parseResendSuppressionEvent(JSON.stringify({
      type: "email.bounced", data: { to: ["bounce@example.com"], email_id: "b1" },
    }))?.reason).toBe("bounce");
    expect(parseResendSuppressionEvent(JSON.stringify({
      type: "email.complained", data: { to: ["spam@example.com"], email_id: "c1" },
    }))?.reason).toBe("complaint");
    expect(parseResendSuppressionEvent(JSON.stringify({
      type: "email.suppressed", data: { to: ["blocked@example.com"], email_id: "s1" },
    }))?.reason).toBe("suppressed");
  });

  it("suppresses contact.updated only when the contact is actually unsubscribed", () => {
    const subscribed = parseResendSuppressionEvent(JSON.stringify({
      type: "contact.updated", data: { email: "person@example.com", unsubscribed: false },
    }));
    const unsubscribed = parseResendSuppressionEvent(JSON.stringify({
      type: "contact.updated", data: { id: "contact_1", email: "person@example.com", unsubscribed: true },
    }));
    expect(subscribed).toBeNull();
    expect(unsubscribed?.reason).toBe("unsubscribe");
    expect(unsubscribed?.email).toBe("person@example.com");
  });

  it("maps suppression.added origin while ignoring unrelated events", () => {
    const manual = parseResendSuppressionEvent(JSON.stringify({
      type: "suppression.added", data: { id: "sup_1", email: "manual@example.com", origin: "manual" },
    }));
    expect(manual?.reason).toBe("suppressed");
    expect(parseResendSuppressionEvent(JSON.stringify({
      type: "email.delivered", data: { to: ["ok@example.com"] },
    }))).toBeNull();
  });
});

describe("RONSAS email source sovereignty", () => {
  it("keeps active send paths free of Lovable email credentials and SDK calls", () => {
    const paths = [
      "src/lib/admin-bootstrap.functions.ts",
      "src/lib/email-transport.server.ts",
      "src/lib/email-domain.functions.ts",
      "src/routes/admin.email-domain.tsx",
      "src/routes/api/public/hooks/process-subscription-emails.ts",
      "src/routes/lovable/email/queue/process.ts",
      "src/routes/lovable/email/suppression.ts",
      "src/routes/lovable/email/transactional/preview.ts",
      "src/routes/api/public/email/suppression.ts",
    ];
    const joined = paths.map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");
    expect(joined).not.toContain("sendLovableEmail");
    expect(joined).not.toContain("LOVABLE_API_KEY");
    expect(joined).not.toContain("LOVABLE_SEND_URL");
    expect(joined).not.toContain("@lovable.dev/email-js");
    expect(joined).not.toContain("@lovable.dev/webhooks-js");
    expect(joined).toContain("/api/public/email/suppression");
  });
});
