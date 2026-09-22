// Fetch recorder — preloaded by CI (bun test --preload) so every HTTP
// response body from the security-scan integration tests is persisted to
// disk. On failure the CI job uploads the resulting directory as an
// artifact, giving triagers the exact wire payloads the assertions ran
// against (which the RPC envelope + Seroval encoding otherwise make
// non-obvious from a test log alone).
//
// Activation is env-gated: without SECURITY_SCAN_ARTIFACT_DIR this module
// is inert, so it's safe to preload unconditionally. Only responses from
// TanStack Start serverFn RPC calls (`/_serverFn/`) are captured — the
// only fetches these suites make — to avoid polluting the directory with
// unrelated traffic if a test evolves.
//
// Files:
//   <dir>/<seq>-<status>-<slug>.json  — one file per response, ordered
//   <dir>/latest.json                 — always the most recent response
//   <dir>/index.jsonl                 — one JSON line per response with
//                                       method, url, status, headers,
//                                       and the artifact filename

import { mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";

const dir = process.env.SECURITY_SCAN_ARTIFACT_DIR;
if (dir) {
  mkdirSync(dir, { recursive: true });
  const originalFetch = globalThis.fetch;
  let seq = 0;

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const res = await originalFetch(input, init);
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (!url.includes("/_serverFn/")) return res;

      // Clone so the test's own res.text()/res.json() still works.
      const clone = res.clone();
      const body = await clone.text();
      seq += 1;
      const slug =
        url
          .split("/_serverFn/")[1]
          ?.slice(0, 24)
          .replace(/[^a-zA-Z0-9]+/g, "_") ?? "unknown";
      const filename = `${String(seq).padStart(4, "0")}-${res.status}-${slug}.json`;
      const method = (init?.method ?? "GET").toUpperCase();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));

      const payload = {
        seq,
        method,
        url,
        status: res.status,
        headers,
        body,
        recorded_at: new Date().toISOString(),
      };
      const json = JSON.stringify(payload, null, 2);
      writeFileSync(join(dir, filename), json);
      writeFileSync(join(dir, "latest.json"), json);
      appendFileSync(
        join(dir, "index.jsonl"),
        JSON.stringify({
          seq,
          method,
          url,
          status: res.status,
          file: filename,
        }) + "\n",
      );
    } catch {
      // Recording is best-effort — never let a capture failure fail the
      // test itself.
    }
    return res;
  }) as typeof fetch;
}
