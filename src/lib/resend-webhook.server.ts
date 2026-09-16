import { createHmac, timingSafeEqual } from "node:crypto";

export type SuppressionReason = "bounce" | "complaint" | "unsubscribe" | "suppressed";

export type ResendSuppressionPayload = {
  email: string;
  reason: SuppressionReason;
  messageId?: string;
  metadata: Record<string, unknown>;
};

export class ResendWebhookError extends Error {
  readonly code: "missing_signature" | "stale_timestamp" | "invalid_signature" | "invalid_secret" | "invalid_payload";

  constructor(code: ResendWebhookError["code"], message: string) {
    super(message);
    this.name = "ResendWebhookError";
    this.code = code;
  }
}

type EventData = Record<string, unknown>;
type ResendEvent = { type?: unknown; created_at?: unknown; data?: EventData };

function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  if (!raw) throw new ResendWebhookError("invalid_secret", "Webhook signing secret is empty.");
  const key = Buffer.from(raw, "base64");
  if (!key.length) throw new ResendWebhookError("invalid_secret", "Webhook signing secret is invalid.");
  return key;
}

export function verifyResendWebhookSignature(
  body: string,
  headers: Headers,
  secret: string,
  nowMs = Date.now(),
): void {
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  const signatureHeader = headers.get("svix-signature") ?? "";
  if (!id || !timestamp || !signatureHeader) {
    throw new ResendWebhookError("missing_signature", "Missing Svix signature headers.");
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(nowMs / 1000 - seconds) > 300) {
    throw new ResendWebhookError("stale_timestamp", "Webhook timestamp is outside the allowed window.");
  }

  const expected = createHmac("sha256", decodeSecret(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  const valid = signatureHeader.split(/\s+/).some((entry) => {
    if (!entry.startsWith("v1,")) return false;
    const candidate = entry.slice(3);
    const candidateBuffer = Buffer.from(candidate, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
  });

  if (!valid) throw new ResendWebhookError("invalid_signature", "Webhook signature does not match.");
}

function parseEvent(body: string): ResendEvent {
  try {
    const parsed = JSON.parse(body) as ResendEvent;
    if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") {
      throw new Error("missing data");
    }
    return parsed;
  } catch {
    throw new ResendWebhookError("invalid_payload", "Webhook payload is not valid JSON with an event data object.");
  }
}

function firstEmailRecipient(data: EventData): string | null {
  const to = data.to;
  if (!Array.isArray(to)) return null;
  const value = to.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return value?.trim() ?? null;
}

function stringField(data: EventData, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseResendSuppressionEvent(body: string): ResendSuppressionPayload | null {
  const event = parseEvent(body);
  const type = typeof event.type === "string" ? event.type : "";
  const data = event.data!;
  const metadata: Record<string, unknown> = { event_type: type };

  if (type === "email.bounced" || type === "email.complained" || type === "email.suppressed") {
    const email = firstEmailRecipient(data);
    if (!email) throw new ResendWebhookError("invalid_payload", `${type} is missing a recipient.`);
    if (data.bounce && typeof data.bounce === "object") metadata.bounce = data.bounce;
    if (data.suppressed && typeof data.suppressed === "object") metadata.suppressed = data.suppressed;
    return {
      email,
      reason: type === "email.bounced" ? "bounce" : type === "email.complained" ? "complaint" : "suppressed",
      messageId: stringField(data, "email_id") ?? undefined,
      metadata,
    };
  }

  if (type === "contact.updated") {
    if (data.unsubscribed !== true) return null;
    const email = stringField(data, "email");
    if (!email) throw new ResendWebhookError("invalid_payload", "contact.updated unsubscribe event is missing email.");
    metadata.contact_id = stringField(data, "id");
    return { email, reason: "unsubscribe", metadata };
  }

  if (type === "suppression.added") {
    const email = stringField(data, "email");
    if (!email) throw new ResendWebhookError("invalid_payload", "suppression.added is missing email.");
    const origin = stringField(data, "origin");
    metadata.origin = origin;
    metadata.suppression_id = stringField(data, "id");
    metadata.source_id = stringField(data, "source_id");
    return {
      email,
      reason: origin === "bounce" ? "bounce" : origin === "complaint" ? "complaint" : "suppressed",
      messageId: stringField(data, "source_id") ?? undefined,
      metadata,
    };
  }

  return null;
}
