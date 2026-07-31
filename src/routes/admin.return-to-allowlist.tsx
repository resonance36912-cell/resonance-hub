import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/lib/routes";
import {
  listReturnToOrigins,
  upsertReturnToOrigin,
  setReturnToOriginEnabled,
  deleteReturnToOrigin,
  type ReturnToOrigin,
} from "@/lib/return-to-allowlist.functions";
import {
  ALLOWED_RETURN_TO_ORIGINS,
  explainReturnTo,
} from "@/lib/return-to-allowlist";

export const Route = createFileRoute("/admin/return-to-allowlist")({
  head: () => ({
    meta: [
      { title: "return_to allowlist — Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: ROUTES.adminLogin });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: ROUTES.adminLogin });
  },
  component: AdminReturnToAllowlist,
});

const DEFAULT_PREVIEW = [
  "https://reson8.life/account",
  "https://RESON8.LIFE/",
  "https://evil.example/?next=https://reson8.life",
  "https://user:pass@reson8.life/",
  "javascript:alert(1)",
  "/account",
].join("\n");

function AdminReturnToAllowlist() {
  const listFn = useServerFn(listReturnToOrigins);
  const upsertFn = useServerFn(upsertReturnToOrigin);
  const toggleFn = useServerFn(setReturnToOriginEnabled);
  const deleteFn = useServerFn(deleteReturnToOrigin);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-return-to-origins"],
    queryFn: () => listFn(),
  });

  const [origin, setOrigin] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState(DEFAULT_PREVIEW);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["admin-return-to-origins"] });

  const add = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          origin: origin.trim(),
          label: label.trim() || null,
          notes: notes.trim() || null,
          enabled: true,
        },
      }),
    onSuccess: (row: ReturnToOrigin) => {
      setMessage(`Saved ${row.origin}`);
      setOrigin("");
      setLabel("");
      setNotes("");
      void invalidate();
    },
    onError: (e: unknown) =>
      setMessage(e instanceof Error ? e.message : "Failed to save entry."),
  });

  const toggle = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      toggleFn({ data: vars }),
    onSuccess: () => void invalidate(),
    onError: (e: unknown) =>
      setMessage(e instanceof Error ? e.message : "Failed to update entry."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => void invalidate(),
    onError: (e: unknown) =>
      setMessage(e instanceof Error ? e.message : "Failed to delete entry."),
  });

  const enabledExtras = useMemo(
    () => (data ?? []).filter((r) => r.enabled).map((r) => r.origin),
    [data],
  );

  // Live validation of the value being typed into the "add" field.
  const draftVerdict = useMemo(
    () => (origin.trim() ? explainReturnTo(origin.trim(), enabledExtras) : null),
    [origin, enabledExtras],
  );

  const previewRows = useMemo(
    () =>
      preview
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(0, 50)
        .map((candidate) => explainReturnTo(candidate, enabledExtras)),
    [preview, enabledExtras],
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        return_to allowlist
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Post-checkout <code>return_to</code> URLs are accepted only when their
        normalized origin is allowlisted. Built-in Hub and spoke origins are
        defined in code and cannot be removed here — entries below only widen
        the allowlist.
      </p>

      {message ? (
        <p className="mt-4 rounded-md border border-border bg-muted px-4 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Add an origin</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="https://app.example.com"
            aria-label="Origin URL"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            aria-label="Label"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            aria-label="Notes"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        {draftVerdict ? (
          <p
            className={`mt-3 text-sm ${
              draftVerdict.origin ? "text-muted-foreground" : "text-destructive"
            }`}
          >
            {draftVerdict.origin
              ? `Will be stored as ${draftVerdict.origin}${
                  draftVerdict.allowed ? " (already allowlisted)" : ""
                }`
              : draftVerdict.reason}
          </p>
        ) : null}
        <button
          type="button"
          disabled={!draftVerdict?.origin || add.isPending}
          onClick={() => add.mutate()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {add.isPending ? "Saving…" : "Add origin"}
        </button>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Admin-managed entries</h2>
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="mt-3 text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load entries."}
          </p>
        ) : (data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No extra origins. Only the built-in origins below are accepted.
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">Origin</th>
                <th className="py-2">Label</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{row.origin}</td>
                  <td className="py-2">{row.label ?? "—"}</td>
                  <td className="py-2">
                    {row.enabled ? "Enabled" : "Disabled"}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        toggle.mutate({ id: row.id, enabled: !row.enabled })
                      }
                      className="mr-3 text-xs underline"
                    >
                      {row.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(row.id)}
                      className="text-xs text-destructive underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Live preview</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          One candidate URL per line. Each is checked against the built-in
          origins plus the enabled entries above.
        </p>
        <textarea
          value={preview}
          onChange={(e) => setPreview(e.target.value)}
          rows={8}
          aria-label="Candidate return_to URLs"
          className="mt-4 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
        />
        <ul className="mt-4 space-y-2">
          {previewRows.map((v, i) => (
            <li
              key={`${i}-${v.input}`}
              className="rounded-md border border-border px-3 py-2 text-xs"
            >
              <span
                className={
                  v.allowed
                    ? "font-medium text-primary"
                    : "font-medium text-destructive"
                }
              >
                {v.allowed ? "ACCEPT" : "REJECT"}
              </span>{" "}
              <span className="font-mono">{v.input}</span>
              <span className="block text-muted-foreground">{v.reason}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Built-in origins (read-only)</h2>
        <ul className="mt-3 grid gap-1 font-mono text-xs text-muted-foreground sm:grid-cols-2">
          {ALLOWED_RETURN_TO_ORIGINS.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </section>

      <RedirectAuditLog />
    </main>
  );
}

/**
 * Redirect audit trail. Shows the allow/deny verdict, the candidate's ORIGIN
 * only, and the canonical target that was used. Full URLs are never stored.
 */
function RedirectAuditLog() {
  const listFn = useServerFn(listReturnToAuditLog);
  const [verdict, setVerdict] = useState<"all" | "allow" | "deny">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-return-to-audit", verdict],
    queryFn: () =>
      listFn({
        data: verdict === "all" ? { limit: 50 } : { verdict, limit: 50 },
      }),
  });

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Redirect audit log</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Origin-only records of every <code>return_to</code> verdict and the
            canonical target that was used. Paths, query strings and fragments
            of caller-supplied URLs are never stored.
          </p>
        </div>
        <div className="flex gap-2">
          {(["all", "allow", "deny"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdict(v)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wide ${
                verdict === v
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      )}
      {error && (
        <p className="mt-4 text-sm text-destructive">
          {(error as Error).message}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No redirect decisions recorded yet.
        </p>
      )}

      {data && data.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Surface</th>
                <th className="px-3 py-2 font-medium">Verdict</th>
                <th className="px-3 py-2 font-medium">Candidate origin</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Product</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono">{row.surface}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.verdict === "allow"
                          ? "font-medium text-primary"
                          : "font-medium text-destructive"
                      }
                    >
                      {row.verdict.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.candidateOrigin ??
                      (row.candidatePresent ? "—" : "(none supplied)")}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {row.reasonCode}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.targetKind === "external"
                      ? `${row.targetOrigin ?? ""}${row.targetPath ?? ""}`
                      : (row.targetPath ?? "—")}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {row.pack ?? row.sku ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

