import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const files: string[] = [];
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(ROOT, path).replaceAll("\\", "/");
    if (rel === "src/routeTree.gen.ts") continue;
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
}
walk(SRC);

const rows = files.map((path) => ({
  path: relative(ROOT, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));
const paths = (needle: RegExp) => rows.filter((r) => needle.test(r.text)).map((r) => r.path).sort();
const authFacade = rows.find((r) => r.path === "src/lib/auth-provider.ts")?.text ?? "";
const directAuth = paths(/supabase\.auth\./).filter((p) => p !== "src/lib/auth-provider.ts");
const adminClient = paths(/supabaseAdmin/);
const rpc = paths(/\.rpc\s*\(/);
const storage = paths(/\.storage\./);
const tableAccess = paths(/\.from\s*\(/);
const ronsServerAuth = paths(/middleware\(\[requireRonsAuth\]\)/);
const hostedServerAuth = paths(/middleware\(\[requireSupabaseAuth\]\)/);
const githubProvider = rows.find((r) => r.path === "src/lib/github-provider.server.ts")?.text ?? "";
const lovableGithubCallers = paths(/connector-gateway\.lovable\.dev\/github/)
  .filter((p) => p !== "src/lib/github-provider.server.ts");
const directGithubCredential = Boolean(
  process.env.RONS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
);
const legacyGithubCredential = Boolean(process.env.LOVABLE_API_KEY && process.env.GITHUB_API_KEY);
const requestedGithubTransport = process.env.RONS_GITHUB_TRANSPORT?.trim().toLowerCase();
const githubTransport = requestedGithubTransport === "direct" || requestedGithubTransport === "lovable"
  ? requestedGithubTransport
  : directGithubCredential ? "direct" : legacyGithubCredential ? "lovable" : "unconfigured";

const report = {
  schema: "rons-sovereign-cutover-readiness/v1",
  generatedAt: new Date().toISOString(),
  sourceFilesScanned: rows.length,
  authoritativeProvider: process.env.RESONANCE_BACKEND_PROVIDER === "sovereign" ? "sovereign" : "supabase",
  shadow: {
    clientAuthFacade: authFacade.includes("RONS auth shadow"),
    entitlementShadow: rows.some((r) => r.text.includes("RONS entitlement shadow")),
    identityShadow: rows.some((r) => r.text.includes("RONS identity shadow")),
    roleShadow: rows.some((r) => r.text.includes("RONS role shadow")),
  },
  github: {
    providerBoundary: githubProvider.includes("https://api.github.com"),
    transport: githubTransport,
    directCredentialPresent: directGithubCredential,
    directVerified: process.env.RONS_GITHUB_DIRECT_VERIFIED === "1",
    compatibilityFallbackPresent: githubProvider.includes("connector-gateway.lovable.dev/github"),
  },
  dependencies: {
    directSupabaseAuthFiles: directAuth,
    supabaseAdminFiles: adminClient,
    rpcFiles: rpc,
    storageFiles: storage,
    tableAccessFiles: tableAccess,
    ronsServerAuthFiles: ronsServerAuth,
    hostedServerAuthFiles: hostedServerAuth,
    lovableGithubCallerFiles: lovableGithubCallers,
  },
  blockers: [
    ...(directAuth.length ? ["direct_supabase_auth_remains"] : []),
    ...(adminClient.length ? ["supabase_admin_paths_remain"] : []),
    ...(rpc.length ? ["supabase_rpc_contracts_remain"] : []),
    ...(storage.length ? ["supabase_storage_paths_remain"] : []),
    ...(lovableGithubCallers.length ? ["lovable_github_calls_outside_provider"] : []),
    ...(githubTransport !== "direct" ? ["github_direct_transport_not_active"] : []),
    ...(githubTransport === "direct" && process.env.RONS_GITHUB_DIRECT_VERIFIED !== "1"
      ? ["github_direct_transport_not_verified"] : []),
    ...(process.env.RONS_SUBSCRIPTION_MIRROR_VERIFIED !== "1" ? ["hosted_subscription_mirror_not_verified"] : []),
    ...(process.env.RONS_ROLE_MIRROR_VERIFIED !== "1" ? ["hosted_role_mirror_not_verified"] : []),
  ],
};

const cutoverReady =
  report.authoritativeProvider === "sovereign" &&
  report.blockers.length === 0 &&
  report.shadow.clientAuthFacade &&
  report.shadow.entitlementShadow &&
  report.shadow.identityShadow &&
  report.shadow.roleShadow;

console.log(JSON.stringify({ ...report, cutoverReady }, null, 2));
