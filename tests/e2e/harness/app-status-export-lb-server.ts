/**
 * Minimal HTTP/1.1 reverse proxy / load balancer for the app-status export
 * harness, used by `tests/e2e/app-status-export-lb-proxy.py`.
 *
 * Round-robins each request across the given upstream instances, keeps the
 * upstream connections pooled (fetch keep-alive), and forwards the response
 * through untouched apart from hop-by-hop headers. Every response carries
 * `X-Proxy-Pid` and `X-Upstream` so a test can attribute a response to the
 * upstream instance that produced it, while `X-Worker-Pid` from the upstream
 * survives the hop.
 *
 * Usage:
 *   bun tests/e2e/harness/app-status-export-lb-server.ts <listen-port> <host:port>...
 */
const port = Number(process.argv[2] ?? 8420);
const upstreams = process.argv.slice(3);
if (upstreams.length === 0) throw new Error("at least one upstream host:port is required");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "te",
  "trailer",
  "content-length",
]);

let cursor = 0;

function copyHeaders(source: Headers, extraSkip: readonly string[] = []): Headers {
  const skip = new Set([...HOP_BY_HOP, ...extraSkip]);
  const out = new Headers();
  source.forEach((value, key) => {
    if (!skip.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

function gatewayError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Proxy-Pid": String(process.pid),
    },
  });
}

Bun.serve({
  port,
  idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = upstreams[cursor++ % upstreams.length]!;
    const target = `http://${upstream}${url.pathname}${url.search}`;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(target, {
        method: request.method,
        headers: copyHeaders(request.headers, ["host"]),
        redirect: "manual",
      });
    } catch {
      return gatewayError(`Upstream ${upstream} is unavailable.`, 502);
    }

    const headers = copyHeaders(upstreamResponse.headers);
    headers.set("X-Proxy-Pid", String(process.pid));
    headers.set("X-Upstream", upstream);
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers });
  },
});

console.log(`lb pid=${process.pid} port=${port} upstreams=${upstreams.join(",")}`);
