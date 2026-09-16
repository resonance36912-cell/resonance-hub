export type TransactionalEmail = {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  idempotencyKey?: string;
};

export class EmailTransportError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "EmailTransportError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function resendApiKey(): string {
  const key = process.env.RONS_RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim();
  if (!key) throw new EmailTransportError("RONS outbound email is not configured.", 503);
  return key;
}

function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export async function sendTransactionalEmail(message: TransactionalEmail) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${resendApiKey()}`,
    "Content-Type": "application/json",
  };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(process.env.RONS_RESEND_API_URL?.trim() || RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: process.env.RONS_EMAIL_FROM?.trim() || message.from,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
  } catch (error) {
    throw new EmailTransportError(
      error instanceof Error ? `Email transport unavailable: ${error.message}` : "Email transport unavailable.",
      503,
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new EmailTransportError(
      `Email provider rejected request (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status,
      retryAfterSeconds(response.headers),
    );
  }

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  return { id: payload?.id ?? null, provider: "resend" as const };
}
