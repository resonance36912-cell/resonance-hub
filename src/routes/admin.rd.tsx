import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";

export const Route = createFileRoute("/admin/rd")({
  head: () => ({
    meta: [
      { title: "R&D Bridge — Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/admin/login" });
  },
  component: ResearchBridgePage,
});

const TOOLS = [
  "datanest_search",
  "datanest_trace",
  "datanest_submit_memory",
  "datanest_submit_correction",
  "datanest_resonance_pulse",
  "datanest_get_coverage",
  "nova_get_project_context",
] as const;

function ResearchBridgePage() {
  const [copied, setCopied] = useState(false);
  const endpoint = useMemo(() => {
    if (typeof window === "undefined") return "https://reson8.life/mcp";
    return new URL("/mcp", window.location.origin).toString();
  }, []);

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Resonance Admin · R&D</p>
            <h1 className="mt-2 text-3xl font-semibold">R&D Bridge</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Governed development access for ChatGPT-compatible MCP clients and browser-side R&D workflows.
              This release is evidence/context access only: no runner recovery, unrestricted shell, hidden desktop
              control, or automatic HOLD bypass.
            </p>
          </div>
          <Link to="/admin" className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent">
            Back to Admin
          </Link>
        </header>

        <section className="grid gap-4 md:grid-cols-3 mb-8">
          <StatusCard title="Admin auth" value="Protected" body="Uses the existing Resonance admin login and user_roles=admin check." />
          <StatusCard title="MCP endpoint" value="Governed" body="Supabase OAuth protects the existing RONSAS Nova + DataNest MCP route." />
          <StatusCard title="Remote bridge" value="Read-only boundary" body="Remote evidence access remains separate from task execution and recovery authorization." />
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 mb-8">
          <h2 className="text-lg font-semibold">ChatGPT / MCP connection</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the authenticated MCP endpoint below from a compatible ChatGPT custom connector or other MCP client.
            OAuth is handled by the existing Supabase issuer; do not paste service-role keys, device tokens, or passwords into prompts.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-border bg-background px-3 py-2 text-xs">{endpoint}</code>
            <button
              type="button"
              onClick={copyEndpoint}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {copied ? "Copied" : "Copy endpoint"}
            </button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2 mb-8">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Governed tools</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              These are the current RONSAS-owned MCP capabilities exposed through the site.
            </p>
            <ul className="mt-4 space-y-2">
              {TOOLS.map((tool) => (
                <li key={tool} className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
                  {tool}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Browser-side development workflow</h2>
            <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li><span className="font-medium text-foreground">1.</span> Sign in here with the admin account.</li>
              <li><span className="font-medium text-foreground">2.</span> Keep the R&D Bridge open while using your chosen ChatGPT browser extension.</li>
              <li><span className="font-medium text-foreground">3.</span> For direct model-to-project context, connect the site MCP endpoint instead of relying on quota-limited desktop plugins.</li>
              <li><span className="font-medium text-foreground">4.</span> Use Nova/DataNest MCP tools for governed project context, memory, provenance, coverage, and review submissions.</li>
              <li><span className="font-medium text-foreground">5.</span> Keep mutations in reviewed application workflows; browser automation must not be treated as implicit recovery authorization.</li>
            </ol>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
          <h2 className="font-semibold text-amber-200">Production boundary</h2>
          <p className="mt-2 text-sm text-amber-100/80">
            Installing or using a browser extension does not grant runner-recovery permission, unrestricted command execution,
            credential access, or invisible remote-control capability. Those remain separately authorized subsystems.
          </p>
        </section>
      </div>
    </main>
  );
}

function StatusCard({ title, value, body }: { title: string; value: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
