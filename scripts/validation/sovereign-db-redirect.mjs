import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSovereignDb } from "../../src/integrations/sovereign/db.server.ts";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("sovereign gateway transport keeps queries and procedure keys on the configured endpoint", async (t) => {
  const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  const savedKey = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
  const directory = await mkdtemp(join(tmpdir(), "rons-redirect-test-"));
  const key = "test-only-procedure-key-".repeat(3);
  const keyPath = join(directory, "procedure.key");
  await writeFile(keyPath, key, { mode: 0o600 });
  process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = keyPath;

  let destinationHits = 0;
  const destination = createServer((request, response) => {
    destinationHits++;
    request.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("[]");
  });
  const target = await listen(destination);

  try {
    for (const status of [301, 302, 303, 307, 308]) {
      for (const procedure of [false, true]) {
        await t.test(`${status} redirect is rejected for ${procedure ? "procedure" : "query"}`, async () => {
          let initialHits = 0;
          let initialKey;
          const gateway = createServer((request, response) => {
            initialHits++;
            initialKey = request.headers["x-rons-procedure-key"];
            request.resume();
            response.writeHead(status, { Location: `${target}/redirect-target` });
            response.end();
          });
          process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = await listen(gateway);
          const before = destinationHits;
          try {
            const db = createSovereignDb();
            const result = procedure
              ? await db.rpc("nova_transition_job", { p_reason: "isolated transport test" })
              : await db.from("nova_projects").select("id");
            assert.equal(initialHits, 1);
            assert.equal(initialKey, procedure ? key : undefined);
            assert.equal(destinationHits, before, "redirect destination must receive no request");
            assert.equal(result.data, null);
            assert.ok(result.error instanceof Error, "redirect must fail closed");
            assert.ok(!result.error.message.includes(key));
          } finally {
            await close(gateway);
          }
        });
      }
    }

    await t.test("direct query and governed procedure responses still succeed", async () => {
      const gateway = createServer((request, response) => {
        request.resume();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(request.url === "/v1/db/procedure" ? { job: { id: "job-1" } } : [{ id: "project-1" }]));
      });
      process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = await listen(gateway);
      try {
        const db = createSovereignDb();
        assert.deepEqual(await db.from("nova_projects").select("id"), {
          data: [{ id: "project-1" }], error: null,
        });
        assert.deepEqual(await db.rpc("nova_transition_job", {}), {
          data: { id: "job-1" }, error: null,
        });
      } finally {
        await close(gateway);
      }
    });
  } finally {
    await close(destination);
    await rm(directory, { recursive: true, force: true });
    if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
    else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
    if (savedKey === undefined) delete process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
    else process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = savedKey;
  }
});
