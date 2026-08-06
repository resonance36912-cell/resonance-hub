import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";
import { listReturnToOrigins } from "@/lib/return-to-allowlist.functions";
import {
  COUNTEREXAMPLE_CATEGORY_LABELS,
  RETURN_TO_COUNTEREXAMPLES,
  sanitizeCounterexample,
  sanitizeCounterexamples,
  type CounterexampleCategory,
} from "@/lib/return-to-counterexamples";

/**
 * `?input=` deep link: the CI coverage report links each NEW FAILURE
 * counterexample straight here with the exact stored input, so an admin can see
 * the live verdict for that value without hunting the corpus table.
 */
export const Route = createFileRoute("/admin/return-to-counterexamples")({
  validateSearch: (search: Record<string, unknown>) => ({
    input: typeof search["input"] === "string" ? search["input"].slice(0, 2048) : undefined,
    suite: typeof search["suite"] === "string" ? search["suite"].slice(0, 120) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "return_to counterexamples — Admin" },
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
  component: AdminReturnToCounterexamples,
});

const CATEGORIES = Object.keys(
  COUNTEREXAMPLE_CATEGORY_LABELS,
) as CounterexampleCategory[];

function AdminReturnToCounterexamples() {
  const listFn = useServerFn(listReturnToOrigins);
  const { data: originRows } = useQuery({
    queryKey: ["admin-return-to-origins"],
    queryFn: () => listFn(),
  });

  const { input: inspectedInput, suite: inspectedSuite } = Route.useSearch();

  const [category, setCategory] = useState<"all" | CounterexampleCategory>(
    "all",
  );

  const extras = useMemo(
    () => (originRows ?? []).filter((r) => r.enabled).map((r) => r.origin),
    [originRows],
  );

  const rows = useMemo(() => {
    const all = sanitizeCounterexamples(extras);
    return category === "all"
      ? all
      : all.filter((r) => r.category === category);
  }, [extras, category]);

  const inspected = useMemo(
    () =>
      inspectedInput
        ? sanitizeCounterexample(
            {
              id: "inspected",
              input: inspectedInput,
              category: "scheme",
              attack: inspectedSuite
                ? `Reported by CI suite "${inspectedSuite}"`
                : "Supplied via deep link",
              expectation: "Should be refused before a return_url is signed.",
            },
            extras,
          )
        : null,
    [inspectedInput, inspectedSuite, extras],
  );

  const unexpectedlyAllowed = rows.filter((r) => r.failsAt === "none");

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        return_to counterexamples
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Every synthetic candidate below is expected to be refused — either by
        the structural check that runs before a PayFast{" "}
        <code>return_url</code> is signed, or by the origin allowlist. Fields
        are sanitized: paths, queries and fragments are shown as a structure
        only. Verdicts reflect the live effective policy, including the enabled
        entries on{" "}
        <AppLink to={ROUTES.adminReturnToAllowlist} className="underline">
          the allowlist page
        </AppLink>
        .
      </p>

      {unexpectedlyAllowed.length > 0 ? (
        <p className="mt-6 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {unexpectedlyAllowed.length} counterexample
          {unexpectedlyAllowed.length === 1 ? "" : "s"} currently ACCEPTED — an
          admin-managed origin is likely too broad. Review the allowlist.
        </p>
      ) : (
        <p className="mt-6 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          All {RETURN_TO_COUNTEREXAMPLES.length} counterexamples are refused
          under the current policy.
        </p>
      )}

      {inspected ? (
        <section
          id="inspected-input"
          className={`mt-6 rounded-md border px-4 py-3 text-sm ${
            inspected.failsAt === "none"
              ? "border-destructive bg-destructive/10"
              : "border-border bg-muted"
          }`}
        >
          <h2 className="text-sm font-semibold">
            Inspected input{inspectedSuite ? ` — CI suite ${inspectedSuite}` : ""}
          </h2>
          <p className="mt-1 break-all font-mono text-xs">{inspected.input}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Origin</dt>
              <dd className="font-mono">{inspected.origin ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Shape</dt>
              <dd>{inspected.shape}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Fails at</dt>
              <dd className="font-medium">
                {inspected.failsAt === "none" ? "not refused" : inspected.failsAt}
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-muted-foreground">Verdict</dt>
              <dd>
                <span className="font-mono">{inspected.verdict.code}</span> —{" "}
                {inspected.verdict.reason}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-2">
        <FilterButton
          active={category === "all"}
          onClick={() => setCategory("all")}
          label={`All (${RETURN_TO_COUNTEREXAMPLES.length})`}
        />
        {CATEGORIES.map((c) => (
          <FilterButton
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
            label={COUNTEREXAMPLE_CATEGORY_LABELS[c]}
          />
        ))}
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">Candidate</th>
              <th className="py-2 pr-4">Scheme</th>
              <th className="py-2 pr-4">Host</th>
              <th className="py-2 pr-4">Port</th>
              <th className="py-2 pr-4">Userinfo</th>
              <th className="py-2 pr-4">Shape</th>
              <th className="py-2 pr-4">Origin</th>
              <th className="py-2 pr-4">Fails at</th>
              <th className="py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-3 pr-4">
                  <span className="block font-mono text-xs">{r.input}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {COUNTEREXAMPLE_CATEGORY_LABELS[r.category]} · {r.attack}
                  </span>
                </td>
                <td className="py-3 pr-4 font-mono text-xs">
                  {r.scheme ?? "—"}
                </td>
                <td className="py-3 pr-4 font-mono text-xs">{r.host ?? "—"}</td>
                <td className="py-3 pr-4 font-mono text-xs">{r.port ?? "—"}</td>
                <td className="py-3 pr-4 text-xs">
                  {r.hasUserinfo ? "present" : "—"}
                </td>
                <td className="py-3 pr-4 text-xs text-muted-foreground">
                  {r.shape}
                </td>
                <td className="py-3 pr-4 font-mono text-xs">
                  {r.origin ?? "—"}
                </td>
                <td className="py-3 pr-4 text-xs">
                  {r.failsAt === "signing" ? (
                    <span className="font-medium text-destructive">
                      signing
                    </span>
                  ) : r.failsAt === "allowlist" ? (
                    <span className="font-medium text-destructive">
                      allowlist
                    </span>
                  ) : (
                    <span className="font-medium text-primary">
                      not refused
                    </span>
                  )}
                </td>
                <td className="py-3 text-xs">
                  <span className="block font-mono">{r.verdict.code}</span>
                  <span className="block text-muted-foreground">
                    {r.verdict.reason}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-3 py-1.5 text-xs ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}
