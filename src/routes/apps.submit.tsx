import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { submitAppSubmission } from "@/lib/app-submissions.functions";

export const Route = createFileRoute("/apps/submit")({
  head: () => ({
    meta: [
      { title: "Submit an App — Resonance" },
      {
        name: "description",
        content:
          "Propose a new app for the Resonance ecosystem catalog. Submissions are reviewed before publication.",
      },
      { property: "og:title", content: "Submit an App — Resonance" },
      {
        property: "og:description",
        content: "Propose a new app for the Resonance ecosystem catalog.",
      },
    ],
  }),
  component: SubmitAppPage,
});

function SubmitAppPage() {
  const submitFn = useServerFn(submitAppSubmission);
  const [form, setForm] = useState({
    name: "",
    url: "",
    tagline: "",
    description: "",
    useCase: "",
    contactEmail: "",
    accentColor: "",
  });

  const mut = useMutation({
    mutationFn: async () =>
      submitFn({
        data: {
          name: form.name,
          url: form.url,
          tagline: form.tagline,
          description: form.description || null,
          useCase: form.useCase || null,
          contactEmail: form.contactEmail,
          accentColor: form.accentColor || null,
        },
      }),
  });

  if (mut.isSuccess) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <BackToHubHeader />
        <div className="mt-8 rounded-xl border border-green-300 bg-green-50 p-6">
          <h1 className="text-2xl font-semibold text-green-900">Submission received</h1>
          <p className="mt-2 text-green-900/80">
            Thanks — we'll review your app and get back to you at{" "}
            <strong>{form.contactEmail}</strong>. Approved apps appear on the{" "}
            <Link to="/apps" className="underline">apps catalog</Link>.
          </p>
          <button
            onClick={() => {
              mut.reset();
              setForm({
                name: "",
                url: "",
                tagline: "",
                description: "",
                useCase: "",
                contactEmail: "",
                accentColor: "",
              });
            }}
            className="mt-4 rounded-md border border-green-700 px-3 py-1.5 text-sm text-green-900 hover:bg-green-100"
          >
            Submit another
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <BackToHubHeader />
      <header className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight">Submit an app</h1>
        <p className="mt-2 text-muted-foreground">
          Propose a new app for the Resonance catalog. Submissions are reviewed
          before publication.
        </p>
      </header>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <Field label="App name" required>
          <input
            required
            minLength={2}
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputCls}
          />
        </Field>

        <Field label="App URL" required hint="Full https:// URL">
          <input
            required
            type="url"
            maxLength={500}
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            className={inputCls}
            placeholder="https://your-app.example.com"
          />
        </Field>

        <Field label="Tagline" required hint="One line, 10–160 characters">
          <input
            required
            minLength={10}
            maxLength={160}
            value={form.tagline}
            onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
            className={inputCls}
          />
        </Field>

        <Field label="Description" hint="Optional, up to 2000 chars">
          <textarea
            maxLength={2000}
            rows={5}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className={inputCls}
          />
        </Field>

        <Field label="Primary use case" hint="Optional short phrase">
          <input
            maxLength={160}
            value={form.useCase}
            onChange={(e) => setForm((f) => ({ ...f, useCase: e.target.value }))}
            className={inputCls}
            placeholder="e.g. Publishing, Video, Growth"
          />
        </Field>

        <Field label="Contact email" required>
          <input
            required
            type="email"
            maxLength={320}
            value={form.contactEmail}
            onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            className={inputCls}
          />
        </Field>

        <Field label="Accent color" hint="Optional hex, e.g. #4f46e5">
          <input
            pattern="^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
            maxLength={7}
            value={form.accentColor}
            onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
            className={inputCls}
            placeholder="#4f46e5"
          />
        </Field>

        {mut.error ? (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {(mut.error as Error).message}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mut.isPending}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {mut.isPending ? "Submitting…" : "Submit for review"}
          </button>
          <Link to="/apps" className="text-sm text-muted-foreground underline">
            Back to catalog
          </Link>
        </div>
      </form>
    </main>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      {children}
    </label>
  );
}
