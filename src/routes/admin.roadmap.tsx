import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";
import {
  listRoadmapItems,
  upsertRoadmapItem,
  deleteRoadmapItem,
  ROADMAP_STATUSES,
  type RoadmapItem,
  type RoadmapStatus,
} from "@/lib/roadmap.functions";

export const Route = createFileRoute("/admin/roadmap")({
  head: () => ({
    meta: [
      { title: "Roadmap — Admin" },
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
  component: AdminRoadmap,
});

type Draft = {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  publicNote: string;
  sortOrder: number;
};

const EMPTY: Draft = {
  id: "",
  title: "",
  description: "",
  status: "planned",
  publicNote: "",
  sortOrder: 100,
};

function toDraft(r: RoadmapItem): Draft {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    publicNote: r.publicNote ?? "",
    sortOrder: r.sortOrder,
  };
}

function AdminRoadmap() {
  const listFn = useServerFn(listRoadmapItems);
  const upsertFn = useServerFn(upsertRoadmapItem);
  const deleteFn = useServerFn(deleteRoadmapItem);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-roadmap"],
    queryFn: () => listFn(),
    refetchOnWindowFocus: true,
  });

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const upsert = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          id: draft.id.trim(),
          title: draft.title.trim(),
          description: draft.description.trim(),
          status: draft.status,
          publicNote: draft.publicNote.trim() ? draft.publicNote.trim() : null,
          sortOrder: Number(draft.sortOrder) || 100,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-roadmap"] });
      setDraft(EMPTY);
      setEditingId(null);
      setMessage("Saved.");
    },
    onError: (e: unknown) => setMessage(e instanceof Error ? e.message : "Save failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-roadmap"] });
      setMessage("Deleted.");
    },
    onError: (e: unknown) => setMessage(e instanceof Error ? e.message : "Delete failed"),
  });

  const rows = (data ?? []) as RoadmapItem[];

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Roadmap</h1>
          <p className="mt-1 text-muted-foreground">
            Manage the homepage &ldquo;What&apos;s coming next&rdquo; section.
          </p>
        </div>
        <AppLink to={ROUTES.admin} className="text-sm underline">← Admin home</AppLink>
      </div>

      {message ? (
        <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">{message}</p>
      ) : null}

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">
          {editingId ? `Edit “${editingId}”` : "New item"}
        </h2>
        <form
          className="mt-3 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            upsert.mutate();
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Slug / ID</span>
            <input
              className="rounded border border-border bg-background px-2 py-1.5"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              placeholder="unified-hub-login"
              disabled={editingId !== null}
              required
              maxLength={80}
              pattern="[a-z0-9-]+"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Title</span>
            <input
              className="rounded border border-border bg-background px-2 py-1.5"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
              maxLength={120}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Description (card body)</span>
            <textarea
              className="min-h-[64px] rounded border border-border bg-background px-2 py-1.5"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              required
              maxLength={500}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Lifecycle status</span>
              <select
                className="rounded border border-border bg-background px-2 py-1.5"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as RoadmapStatus })}
              >
                {ROADMAP_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Sort order</span>
              <input
                type="number"
                className="rounded border border-border bg-background px-2 py-1.5"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                min={0}
                max={9999}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Public note (optional)</span>
            <textarea
              className="min-h-[56px] rounded border border-border bg-background px-2 py-1.5"
              value={draft.publicNote}
              onChange={(e) => setDraft({ ...draft, publicNote: e.target.value })}
              maxLength={500}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-primary-surface px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={upsert.isPending}
            >
              {upsert.isPending ? "Saving…" : editingId ? "Update" : "Create"}
            </button>
            {editingId ? (
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5 text-sm"
                onClick={() => {
                  setDraft(EMPTY);
                  setEditingId(null);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Current items</h2>
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {error instanceof Error ? error.message : "Failed to load"}
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No roadmap items yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                      {r.status}
                    </span>
                    <h3 className="font-medium">{r.title}</h3>
                    <span className="text-xs text-muted-foreground">#{r.sortOrder} · {r.id}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                  {r.publicNote ? (
                    <p className="mt-1 text-xs text-muted-foreground/80">{r.publicNote}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => {
                      setDraft(toDraft(r));
                      setEditingId(r.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                    onClick={() => {
                      if (confirm(`Delete “${r.title}”?`)) remove.mutate(r.id);
                    }}
                    disabled={remove.isPending}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
