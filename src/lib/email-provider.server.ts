export type RonsEmailPayload = {
  to: string;
  from: string;
  subject: string;
  sender_domain?: string;
  html?: string;
  text?: string;
  purpose?: string;
  label?: string;
  idempotency_key?: string;
  message_id?: string;
  run_id?: string;
  unsubscribe_token?: string;
  [key: string]: unknown;
};

export class EmailAPIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "EmailAPIError";
  }

  get retryable() {
    return this.status === 429 || (this.status >= 500 && this.status < 600);
  }
}
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const numeric = Number(header);
  if (!Number.isNaN(numeric)) return numeric;
  const date = new Date(header);
  return Number.isNaN(date.getTime())
    ? null
    : Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

function resolveEmailConfig() {
  const apiKey = process.env.RONS_EMAIL_API_KEY ?? process.env.LOVABLE_API_KEY;
  const sendUrl =
    process.env.RONS_EMAIL_SEND_URL ??
    process.env.LOVABLE_SEND_URL ??
    (process.env.LOVABLE_API_KEY
      ? "https://api.lovable.dev/v1/messaging/email/send"
      : undefined);

  if (!apiKey || !sendUrl) {
    throw new Error(
      "Email provider is not configured. Set RONS_EMAIL_API_KEY and RONS_EMAIL_SEND_URL.",
    );
  }
  return { apiKey, sendUrl };
}

export async function sendRonsEmail(payload: RonsEmailPayload): Promise<unknown> {
  const { apiKey, sendUrl } = resolveEmailConfig();
  const idempotencyKey = payload.idempotency_key ?? payload.run_id;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = String(idempotencyKey);

  const response = await fetch(sendUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const raw = await response.text();
    const safe = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
    throw new EmailAPIError(
      response.status,
      `Email API error: ${response.status} ${safe}`,
      parseRetryAfter(response.headers.get("Retry-After")),
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? await response.json()
    : await response.text();
}