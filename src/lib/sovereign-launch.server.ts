import { readFile } from "node:fs/promises";

const SESSION_COOKIE = "rons_sovereign_session";
const GATEWAY = "http://127.0.0.1:58600";
const BROKER = "http://127.0.0.1:4450";
const TARGETS = {
  epublisher: "https://epublisher.reson8.life",
  creative_studio: "https://creative.reson8.life",
  sync_vision: "https://sync.reson8.life",
  youtube_optimizer: "https://youtube.reson8.life",
} as const;

export type LaunchApp = keyof typeof TARGETS;

function loopbackServiceUrl(raw: string, label: string): string {
  const url = new URL(raw);
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !loopback ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(`${label} must be loopback HTTP`);
  }
  return url.origin;
}

function readCookie(request: Request): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function exchangeSecret(): Promise<string> {
  const path = process.env.RONS_AUTH_EXCHANGE_KEY_FILE?.trim();
  if (!path) throw new Error("exchange key path missing");
  const value = (await readFile(path, "utf8")).trim();
  if (value.length < 32 || value.length > 4096) throw new Error("exchange key invalid");
  return value;
}

export function isLaunchApp(value: string): value is LaunchApp {
  return Object.prototype.hasOwnProperty.call(TARGETS, value);
}

export async function prepareSovereignLaunch(request: Request, app: LaunchApp): Promise<Response> {
  if (process.env.RONS_SOVEREIGN_PROXY_ENABLED !== "1")
    return Response.json({ error: "Not found" }, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  const session = readCookie(request);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  let secret: string;
  try {
    secret = await exchangeSecret();
  } catch {
    return Response.json({ error: "Launch service unavailable" }, { status: 503 });
  }
  let gateway: string;
  let broker: string;
  try {
    gateway = loopbackServiceUrl(
      process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? GATEWAY,
      "Sovereign gateway",
    );
    broker = loopbackServiceUrl(process.env.RONS_LAUNCH_BROKER_URL ?? BROKER, "Launch broker");
  } catch {
    return Response.json({ error: "Launch service unavailable" }, { status: 503 });
  }
  let issued: Response;
  try {
    issued = await fetch(`${gateway}/v1/auth/launch-ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
        "X-RONS-Exchange-Key": secret,
      },
      body: JSON.stringify({ app }),
    });
  } catch {
    return Response.json({ error: "Launch service unavailable" }, { status: 503 });
  }
  if (!issued.ok)
    return Response.json(
      { error: issued.status === 401 ? "Authentication required" : "Launch denied" },
      { status: issued.status },
    );
  const issueBody = (await issued.json()) as { ticket?: string };
  if (!issueBody.ticket)
    return Response.json({ error: "Invalid launch response" }, { status: 502 });
  let prepared: Response;
  try {
    prepared = await fetch(`${broker}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RONS-Exchange-Key": secret },
      body: JSON.stringify({ app, ticket: issueBody.ticket }),
    });
  } catch {
    return Response.json({ error: "Launch broker unavailable" }, { status: 503 });
  }
  if (!prepared.ok)
    return Response.json({ error: "Launch preparation failed" }, { status: prepared.status });
  const body = (await prepared.json()) as { code?: string };
  if (!body.code || body.code.length > 512)
    return Response.json({ error: "Invalid launch preparation" }, { status: 502 });
  const target = process.env[`RONS_APP_ORIGIN_${app.toUpperCase()}`]?.trim() || TARGETS[app];
  const destination = new URL("/_rons/launch", target);
  destination.searchParams.set("code", body.code);
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
