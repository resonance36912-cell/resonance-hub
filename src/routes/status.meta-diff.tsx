import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { APP_REGISTRY, type AppRegistryEntry } from "@/lib/app-registry";
import { statusMeaning } from "@/lib/app-status-meaning";
import { appDetailMeta, type HeadMetaTag } from "@/lib/app-status-meta";
import { ROUTES } from "@/lib/routes";

/**
 * Visual verification surface: registry-derived meta (left) versus the meta
 * actually rendered by /apps/<key> (right), one row per tag.
 *
 * Read-only. Fetches each app page's HTML in the browser and parses its head
 * so a drift between the registry and a shipped page is visible at a glance
 * without opening devtools or running the smoke tests.
 */
export const Route = createFileRoute("/status/meta-diff")({
  head: () => ({
    meta: [
      { title: "Registry vs rendered meta diff — Resonance" },
      {
        name: "description",
        content:
          "Side-by-side comparison of registry-derived status meta and the tags each Resonance app page actually renders.",
      },
      { property: "og:title", content: "Registry vs rendered meta diff — Resonance" },
      {
        property: "og:description",
        content:
          "Spot drift between the app registry status and the OpenGraph/Twitter meta rendered on each app page.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reson8.life/status/meta-diff" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://reson8.life/status/meta-diff" }],
  }),
  component: MetaDiffPage,
});

type TagKey = { kind: "title" } | { kind: "name"; key: string } | { kind: "property"; key: string };

type ExpectedTag = { id: string; label: string; selectorHint: TagKey; expected: string };

type RowState = {
  id: string;
  label: string;
  expected: string;
  actual: string | null;
};

type AppDiff = {
  entry: AppRegistryEntry;
  status: "loading" | "ok" | "error";
  error?: string;
  rows: RowState[];
};

function toExpectedTags(entry: AppRegistryEntry): ExpectedTag[] {
  return appDetailMeta(entry).map((tag: HeadMetaTag) => {
    if ("title" in tag) {
      return { id: "title", label: "title", selectorHint: { kind: "title" }, expected: tag.title };
    }
    if ("name" in tag) {
      return {
        id: `name:${tag.name}`,
        label: tag.name,
        selectorHint: { kind: "name", key: tag.name },
        expected: tag.content,
      };
    }
    return {
      id: `property:${tag.property}`,
      label: tag.property,
      selectorHint: { kind: "property", key: tag.property },
      expected: tag.content,
    };
  });
}

function readActual(doc: Document, hint: TagKey): string | null {
  if (hint.kind === "title") {
    const t = doc.querySelector("title")?.textContent?.trim();
    return t && t.length > 0 ? t : null;
  }
  const attr = hint.kind === "name" ? "name" : "property";
  const el = doc.querySelector(`meta[${attr}="${cssEscape(hint.key)}"]`);
  const content = el?.getAttribute("content");
  return content == null ? null : content.trim();
}

function cssEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function matches(row: RowState): boolean {
  return row.actual !== null && norm(row.actual) === norm(row.expected);
}

function MetaDiffPage() {
  const entries = useMemo(() => Object.values(APP_REGISTRY) as AppRegistryEntry[], []);
  const [diffs, setDiffs] = useState<AppDiff[]>(() =>
    entries.map((entry) => ({
      entry,
      status: "loading" as const,
      rows: toExpectedTags(entry).map((t) => ({
        id: t.id,
        label: t.label,
        expected: t.expected,
        actual: null,
      })),
    })),
  );
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDiffs(
      entries.map((entry) => ({
        entry,
        status: "loading" as const,
        rows: toExpectedTags(entry).map((t) => ({
          id: t.id,
          label: t.label,
          expected: t.expected,
          actual: null,
        })),
      })),
    );

    (async () => {
      for (const entry of entries) {
        const expectedTags = toExpectedTags(entry);
        try {
          const res = await fetch(`/apps/${entry.key}`, {
            headers: { Accept: "text/html" },
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          const rows = expectedTags.map((t) => ({
            id: t.id,
            label: t.label,
            expected: t.expected,
            actual: readActual(doc, t.selectorHint),
          }));
          if (cancelled) return;
          setDiffs((prev) =>
            prev.map((d) => (d.entry.key === entry.key ? { ...d, status: "ok", rows } : d)),
          );
        } catch (err) {
          if (cancelled) return;
          setDiffs((prev) =>
            prev.map((d) =>
              d.entry.key === entry.key
                ? {
                    ...d,
                    status: "error",
                    error: err instanceof Error ? err.message : "Fetch failed",
                  }
                : d,
            ),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entries, reloadKey]);

  const checked = diffs.filter((d) => d.status !== "loading");
  const mismatched = checked.filter(
    (d) => d.status === "error" || d.rows.some((r) => !matches(r)),
  );

  return (
    <main className="mx-auto max-w-6xl p-6">
      <BackToHubHeader />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">
        Registry vs rendered meta diff
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Left column is derived from the app registry and status meanings. Right column is parsed
        from the HTML each <code className="font-mono">/apps/&lt;key&gt;</code> page actually
        returns. Any highlighted row means a shipped page disagrees with the registry.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span
          className={
            checked.length === 0
              ? "rounded-md border border-border bg-muted/40 px-3 py-1.5 text-muted-foreground"
              : mismatched.length === 0
                ? "rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-medium text-primary"
                : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 font-medium text-destructive"
          }
        >
          {checked.length === 0
            ? "Checking app pages…"
            : mismatched.length === 0
              ? `All ${checked.length} app pages match the registry`
              : `${mismatched.length} of ${checked.length} app pages drifted`}
        </span>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted/50"
        >
          Re-check
        </button>
        <a
          href="/api/public/app-status/health"
          className="font-mono text-xs text-primary underline underline-offset-2"
        >
          /api/public/app-status/health
        </a>
      </div>

      {diffs.map((diff) => {
        const meaning = statusMeaning(diff.entry.status);
        const bad = diff.rows.filter((r) => !matches(r)).length;
        return (
          <section key={diff.entry.key} className="mt-8">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold">{diff.entry.label}</h2>
              <span className="font-mono text-xs text-muted-foreground">{diff.entry.key}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                {meaning.label} — {meaning.access}
              </span>
              {diff.status === "loading" && (
                <span className="text-xs text-muted-foreground">loading…</span>
              )}
              {diff.status === "error" && (
                <span className="text-xs font-medium text-destructive">
                  could not load page ({diff.error})
                </span>
              )}
              {diff.status === "ok" && (
                <span
                  className={
                    bad === 0
                      ? "text-xs font-medium text-primary"
                      : "text-xs font-medium text-destructive"
                  }
                >
                  {bad === 0 ? "✓ in sync" : `✗ ${bad} tag${bad === 1 ? "" : "s"} differ`}
                </span>
              )}
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-40 px-3 py-2">Tag</th>
                    <th className="px-3 py-2">Registry-derived</th>
                    <th className="px-3 py-2">Rendered on page</th>
                    <th className="w-16 px-3 py-2 text-center">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.rows.map((row) => {
                    const ok = matches(row);
                    const pending = diff.status === "loading";
                    return (
                      <tr
                        key={row.id}
                        className={
                          pending || ok
                            ? "border-t border-border align-top"
                            : "border-t border-border bg-destructive/5 align-top"
                        }
                      >
                        <td className="px-3 py-2 font-mono text-xs">{row.label}</td>
                        <td className="px-3 py-2 break-words text-muted-foreground">
                          {row.expected}
                        </td>
                        <td className="px-3 py-2 break-words">
                          {pending ? (
                            <span className="text-muted-foreground">…</span>
                          ) : row.actual === null ? (
                            <span className="font-medium text-destructive">missing</span>
                          ) : (
                            row.actual
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {pending ? "·" : ok ? "✓" : "✗"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <p className="mt-8 flex flex-wrap gap-4 text-sm">
        <AppLink to="/status/apps" className="text-primary underline underline-offset-2">
          Status table →
        </AppLink>
        <AppLink to={ROUTES.apps} className="text-primary underline underline-offset-2">
          App catalog →
        </AppLink>
      </p>
    </main>
  );
}
