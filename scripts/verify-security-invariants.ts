#!/usr/bin/env bun
/**
 * verify-security-invariants
 *
 * Lightweight, dependency-free SAST that fails the build when known
 * Resonance-Hub security invariants are violated. Catches regressions that
 * would otherwise only be spotted by a manual review or a paid scanner.
 *
 * Checks:
 *  1. No hard-coded service-role / secret keys in source.
 *  2. The Supabase admin client (`client.server.ts`) is NEVER imported from
 *     client-side code (anything under src/ that isn't `*.server.ts`,
 *     `*.functions.ts(x)`, or `src/routes/api/`).
 *  3. No server credentials or the admin-bootstrap allowlist outside
 *     server-only files, and never expose the allowlist through `VITE_*`.
 *  4. No `dangerouslySetInnerHTML` outside an allowlist.
 *  5. No `eval(` or `new Function(` calls in the codebase.
 *  6. Public API routes (`src/routes/api/public/**`) must mention a known
 *     signature, auth, tier, cron, header-key, or target-allowlist guard
 *     (i.e. some auth/integrity check) — guards against accidentally
 *     shipping an unauthenticated write endpoint.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type Finding = { file: string; line: number; rule: string; detail: string };
const findings: Finding[] = [];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".output" || entry === "dist") continue;
      yield* walk(full);
    } else yield full;
  }
}

const isServerOnly = (f: string) =>
  /\.server\.(ts|tsx)$/.test(f) ||
  /\.functions\.(ts|tsx)$/.test(f) ||
  /(^|\/)src\/routes\/api\//.test(f) ||
  /(^|\/)src\/routes\/email\//.test(f) ||
  /(^|\/)src\/routes\/lovable\//.test(f) ||
  /(^|\/)src\/integrations\/supabase\/(auth-middleware|client\.server|auth-attacher)/.test(f) ||
  /(^|\/)src\/(start|server)\.ts$/.test(f) ||
  f.startsWith("scripts/");

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "supabase-service-role-jwt", re: /eyJhbGciOi[A-Za-z0-9_.-]{40,}/ },
  { name: "supabase-secret-key", re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: "stripe-secret-key", re: /\bsk_live_[A-Za-z0-9]{20,}/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "generic-private-key-block",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
];

const ALLOW_INNER_HTML = new Set<string>([
  "src/routes/sitemap[.]xml.ts", // server-rendered XML, no user input
  "src/routes/index.tsx", // JSON-LD <script> with static schema
  "src/components/ui/chart.tsx", // shadcn-generated CSS variables block
]);

for (const file of walk("src")) {
  const sourcePath = file.replaceAll("\\", "/");
  if (!/\.(ts|tsx|js|jsx)$/.test(sourcePath)) continue;
  if (sourcePath.includes("/integrations/supabase/types.ts")) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  lines.forEach((line, i) => {
    const ln = i + 1;

    // 1. Secrets in source
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) {
        findings.push({
          file: sourcePath,
          line: ln,
          rule: `secret:${name}`,
          detail: line.trim().slice(0, 120),
        });
      }
    }

    // 2. client.server.ts imported from non-server file
    if (
      !isServerOnly(sourcePath) &&
      /from\s+["']@\/integrations\/supabase\/client\.server["']/.test(line)
    ) {
      findings.push({
        file: sourcePath,
        line: ln,
        rule: "admin-client-leak",
        detail: "client.server.ts (service-role) imported from client-side module",
      });
    }

    // 3. Server credential / private allowlist access from client code
    if (
      !isServerOnly(sourcePath) &&
      /process\.env\.(?:[A-Z_]*SERVICE_ROLE|ADMIN_BOOTSTRAP_EMAILS)/.test(line)
    ) {
      findings.push({
        file: sourcePath,
        line: ln,
        rule: "server-secret-in-client",
        detail: "server-only environment value read from client-side module",
      });
    }
    if (/VITE_ADMIN_BOOTSTRAP_EMAILS/.test(line)) {
      findings.push({
        file: sourcePath,
        line: ln,
        rule: "bootstrap-allowlist-public",
        detail: "admin bootstrap allowlist must never use a VITE_ client environment variable",
      });
    }

    // 4. dangerouslySetInnerHTML outside allowlist
    if (/dangerouslySetInnerHTML/.test(line) && !ALLOW_INNER_HTML.has(sourcePath)) {
      findings.push({
        file: sourcePath,
        line: ln,
        rule: "dangerously-set-inner-html",
        detail: "dangerouslySetInnerHTML used outside allowlist",
      });
    }

    // 5. eval / Function constructor
    if (/\beval\s*\(/.test(line) || /\bnew\s+Function\s*\(/.test(line)) {
      findings.push({
        file: sourcePath,
        line: ln,
        rule: "eval-or-function-ctor",
        detail: line.trim().slice(0, 120),
      });
    }
  });

  // 6. Public API routes must show an auth/integrity check
  if (sourcePath.includes("src/routes/api/public/")) {
    const hasGuard =
      /signature/i.test(src) ||
      /requireSupabaseAuth/.test(src) ||
      /has_role/.test(src) ||
      /verifyWebhook|HMAC|hmac/.test(src) ||
      /requireTier(?:FromRequest)?/.test(src) ||
      /assertCronAuthorized/.test(src) ||
      /FORM_ISSUE_ALLOWED_REPOS/.test(src) ||
      /request\.headers\.get\(["'](?:api|x-api)key["']\)/i.test(src);
    // Allowlist read-only/diagnostic endpoints by filename.
    const READ_ONLY_OK = [
      "/entitlement.ts",
      "/analytics/auth-gate.ts",
      "/updates/atom.ts",
      "/updates/rss.ts",
    ];
    if (!hasGuard && !READ_ONLY_OK.some((s) => sourcePath.endsWith(s))) {
      findings.push({
        file: sourcePath,
        line: 1,
        rule: "public-api-no-guard",
        detail:
          "public API route lacks signature / auth / role check — confirm it is read-only or add a guard",
      });
    }
  }
}

if (findings.length) {
  console.error(`❌ verify-security-invariants: ${findings.length} finding(s)\n`);
  for (const f of findings) {
    console.error(`  [${f.rule}] ${f.file}:${f.line}`);
    console.error(`    ${f.detail}`);
  }
  console.error(
    `\nFix or, for a vetted false positive, narrow the rule's allowlist in scripts/verify-security-invariants.ts.`,
  );
  process.exit(1);
}
console.log("✓ verify-security-invariants: no findings.");
