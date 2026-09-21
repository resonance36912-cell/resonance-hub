export class WebhookError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

async function computeSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function parseTimestamp(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new WebhookError("invalid_timestamp", "Invalid webhook timestamp");
  return parsed;
}

export async function verifyWebhookRequest<T>({
  req,
  secret,
  parser,
  toleranceMs = 5 * 60 * 1000,
  maxBodyBytes = 1 << 20,
}: {
  req: Request;
  secret: string;
  parser: (body: string) => T;
  toleranceMs?: number;
  maxBodyBytes?: number;
}): Promise<{ body: string; payload: T; timestamp: string }> {
  const signature =
    req.headers.get("x-rons-signature") ?? req.headers.get("x-lovable-signature");
  const timestamp =
    req.headers.get("x-rons-timestamp") ?? req.headers.get("x-lovable-timestamp");
  if (!timestamp) throw new WebhookError("missing_timestamp", "Missing webhook timestamp");
  if (!signature) throw new WebhookError("invalid_signature", "Missing webhook signature");
  const timestampMs = parseTimestamp(timestamp);
  if (Math.abs(Date.now() - timestampMs) > toleranceMs) {
    throw new WebhookError("stale_timestamp", "Webhook timestamp outside tolerance window");
  }
  const body = await req.text();
  if (new TextEncoder().encode(body).length > maxBodyBytes) {
    throw new WebhookError("body_too_large", "Webhook body exceeds size limit");
  }
  const expected = await computeSignature(`${timestamp}.${body}`, secret);
  if (!constantTimeEqual(signature, expected)) {
    throw new WebhookError("invalid_signature", "Invalid webhook signature");
  }
  let payload: T;
  try {
    payload = parser(body);
  } catch {
    throw new WebhookError("invalid_payload", "Failed to parse webhook payload");
  }
  return { body, payload, timestamp };
}