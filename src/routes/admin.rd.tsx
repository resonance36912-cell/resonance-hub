import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";

export const Route = createFileRoute("/admin/rd")({
  head: () => ({
    meta: [{ title: "R&D Bridge — Resonance" }, { name: "robots", content: "noindex, nofollow" }],
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
  "remote_list_devices",
  "remote_get_snapshot",
] as const;

type RemoteDevice = {
  device_id: string;
  display_name: string;
  enabled: boolean;
  last_received_at: string | null;
  age_seconds: number | null;
  recent_report: boolean;
};

function ResearchBridgePage() {
  const [copied, setCopied] = useState(false);
  const [profileCopied, setProfileCopied] = useState(false);
  const [healthStatus, setHealthStatus] = useState<"checking" | "ready" | "failed">("checking");
  const [healthDetail, setHealthDetail] = useState("Checking /api/health…");
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [bridgeBusy, setBridgeBusy] = useState(true);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState("Ealiophin");
  const [displayName, setDisplayName] = useState("Ealiophin");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const endpoint = useMemo(() => {
    if (typeof window === "undefined") return "https://reson8.life/mcp";
    return new URL("/mcp", window.location.origin).toString();
  }, []);

  const connectionProfile = useMemo(() => {
    const origin = new URL(endpoint).origin;
    return JSON.stringify(
      {
        name: "RONSAS browser R&D",
        endpoint,
        transport: "remote_http",
        authentication: "oauth",
        admin: `${origin}/admin/rd`,
        controlCenter: `${origin}/admin/rnd`,
        health: `${origin}/api/health`,
        mode: "browser_mcp",
        workflow: [
          "Use governed MCP tools for RONSAS context, DataNest memory, and read-only remote evidence.",
          "Keep source changes in reviewed GitHub pull requests and production deployment in Railway.",
          "Do not paste device tokens, service-role keys, passwords, or recovery credentials into prompts.",
        ],
        boundaries: [
          "No runner recovery through MCP.",
          "No arbitrary shell execution.",
          "No hidden desktop control.",
          "No privileged machine mutation unless the separate production gates are explicitly enabled.",
        ],
      },
      null,
      2,
    );
  }, [endpoint]);

  const checkHealth = useCallback(async () => {
    setHealthStatus("checking");
    setHealthDetail("Checking /api/health…");
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const provider =
        typeof payload.backendProvider === "string"
          ? payload.backendProvider
          : typeof payload.backend_provider === "string"
            ? payload.backend_provider
            : null;
      setHealthStatus("ready");
      setHealthDetail(provider ? `HTTP ${response.status} · ${provider}` : `HTTP ${response.status}`);
    } catch (error) {
      setHealthStatus("failed");
      setHealthDetail((error as Error).message || "Health check failed");
    }
  }, []);

  const invokeBridge = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("remote-bridge-admin", { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const refreshDevices = useCallback(async () => {
    setBridgeBusy(true);
    setBridgeError(null);
    try {
      const data = await invokeBridge({ action: "list" });
      setDevices((data?.devices ?? []) as RemoteDevice[]);
    } catch (error) {
      setBridgeError((error as Error).message);
    } finally {
      setBridgeBusy(false);
    }
  }, [invokeBridge]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  async function enrollDevice(event: React.FormEvent) {
    event.preventDefault();
    setIssuedToken(null);
    setBridgeError(null);
    try {
      const data = await invokeBridge({
        action: "enroll",
        device_id: deviceId,
        display_name: displayName,
      });
      setIssuedToken(data.device_token as string);
      await refreshDevices();
    } catch (error) {
      setBridgeError((error as Error).message);
    }
  }

  async function setEnabled(device: RemoteDevice, enabled: boolean) {
    setBridgeError(null);
    try {
      await invokeBridge({ action: "set_enabled", device_id: device.device_id, enabled });
      await refreshDevices();
    } catch (error) {
      setBridgeError((error as Error).message);
    }
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function copyConnectionProfile() {
    await navigator.clipboard.writeText(connectionProfile);
    setProfileCopied(true);
    window.setTimeout(() => setProfileCopied(false), 1500);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Resonance Admin · R&D
            </p>
            <h1 className="mt-2 text-3xl font-semibold">R&D Bridge</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Governed ChatGPT/MCP development access plus read-only PC evidence. Device reporting
              is outbound-only; runner recovery, unrestricted shell, hidden desktop control,
              credential access, and automatic HOLD bypass are not exposed by this panel or MCP
              catalog.
            </p>
          </div>
          <Link
            to="/admin"
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent"
          >
            Back to Admin
          </Link>
        </header>

        <section className="mb-8 grid gap-4 md:grid-cols-3">
          <StatusCard
            title="Admin auth"
            value="Protected"
            body="Existing Resonance admin login + user_roles=admin authorization."
          />
          <StatusCard
            title="MCP endpoint"
            value="OAuth protected"
            body="Same Supabase identity is used by ChatGPT-compatible MCP clients."
          />
          <StatusCard
            title="Remote evidence"
            value="Read-only"
            body="Device agents can upload reports; MCP clients can only list devices and read snapshots."
          />
        </section>

        <section className="mb-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">ChatGPT / MCP connection</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect this URL from a compatible ChatGPT custom connector, browser extension, or other
            MCP client. OAuth reuses your Resonance/Supabase identity; never paste device tokens,
            service-role keys, or passwords into prompts.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
              {endpoint}
            </code>
            <button
              type="button"
              onClick={copyEndpoint}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {copied ? "Copied" : "Copy endpoint"}
            </button>
            <button
              type="button"
              onClick={copyConnectionProfile}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              {profileCopied ? "Profile copied" : "Copy browser profile"}
            </button>
            <button
              type="button"
              onClick={() => void checkHealth()}
              disabled={healthStatus === "checking"}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"
            >
              {healthStatus === "checking" ? "Checking…" : "Recheck health"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={
                healthStatus === "ready"
                  ? "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-emerald-300"
                  : healthStatus === "failed"
                    ? "rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-red-300"
                    : "rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-200"
              }
            >
              {healthStatus === "ready"
                ? "Browser path ready"
                : healthStatus === "failed"
                  ? "Health check failed"
                  : "Checking browser path"}
            </span>
            <span className="text-muted-foreground">{healthDetail}</span>
          </div>
          <details className="mt-4 rounded-xl border border-border bg-background p-4">
            <summary className="cursor-pointer text-sm font-medium">Portable browser profile</summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Reference profile for compatible browser extensions and MCP clients. Import formats
              differ by client, so the endpoint and OAuth settings remain the authoritative fields.
            </p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {connectionProfile}
            </pre>
          </details>
        </section>

        <section className="mb-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Governed MCP tools</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Project context, approved DataNest operations, and read-only device evidence.
            </p>
            <ul className="mt-4 space-y-2">
              {TOOLS.map((tool) => (
                <li
                  key={tool}
                  className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                >
                  {tool}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Browser-side development workflow</h2>
            <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">1.</span> Sign in here with the
                authorised admin account.
              </li>
              <li>
                <span className="font-medium text-foreground">2.</span> Connect <code>/mcp</code>{" "}
                from the ChatGPT browser extension or compatible MCP client.
              </li>
              <li>
                <span className="font-medium text-foreground">3.</span> Use Nova/DataNest for
                project context and memory; use remote tools for device-reported evidence.
              </li>
              <li>
                <span className="font-medium text-foreground">4.</span> Keep code
                mutation/deployment in reviewed GitHub/Lovable/Railway workflows rather than an
                unrestricted remote shell.
              </li>
            </ol>
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Remote devices</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Latest outbound reports. “Recent” means received less than 90 seconds ago.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshDevices()}
              disabled={bridgeBusy}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              {bridgeBusy ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {bridgeError && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {bridgeError}
            </p>
          )}

          <div className="mt-4 grid gap-3">
            {devices.length === 0 && !bridgeBusy ? (
              <p className="text-sm text-muted-foreground">No remote device enrolled yet.</p>
            ) : null}
            {devices.map((device) => (
              <div
                key={device.device_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4"
              >
                <div>
                  <p className="font-medium">
                    {device.display_name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      ({device.device_id})
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {device.last_received_at
                      ? `Last report ${Math.round(device.age_seconds ?? 0)}s ago`
                      : "No report yet"}{" "}
                    · {device.recent_report ? "recent" : "stale/unreported"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void setEnabled(device, !device.enabled)}
                  className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"
                >
                  {device.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Enroll a report-only PC agent</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Enrollment issues a device token once. Store it only on that PC; the server stores only
            its SHA-256 digest.
          </p>
          <form onSubmit={enrollDevice} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              placeholder="device id"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="display name"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Enroll / rotate token
            </button>
          </form>

          {issuedToken ? (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-medium text-amber-200">Device token — shown once</p>
              <code className="mt-2 block break-all text-xs text-amber-100">{issuedToken}</code>
              <p className="mt-2 text-xs text-amber-100/70">
                Do not paste this token into ChatGPT or commit it to Git.
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
          <h2 className="font-semibold text-amber-200">Production boundary</h2>
          <p className="mt-2 text-sm text-amber-100/80">
            Browser extensions and MCP access do not grant runner-recovery permission, unrestricted
            command execution, credential access, or invisible remote-control capability. The
            existing recovery HOLD remains separate.
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
