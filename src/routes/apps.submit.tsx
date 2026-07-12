import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import {
  submitAppSubmission,
  checkSubmissionAvailability,
  type SubmissionAvailability,
} from "@/lib/app-submissions.functions";
import { supabase } from "@/integrations/supabase/client";
import { slugify, validateAppUrl } from "@/lib/app-submission-validation";


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

const MAX_LOGO_MB = 2;
const MAX_SHOT_MB = 5;
const MAX_SHOTS = 4;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

function extFor(file: File): string {
  const byName = file.name.split(".").pop()?.toLowerCase();
  if (byName && /^(png|jpe?g|webp|gif|svg)$/.test(byName)) return byName === "jpeg" ? "jpg" : byName;
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  };
  return map[file.type] ?? "png";
}

async function uploadImage(file: File): Promise<string> {
  const id = crypto.randomUUID();
  const path = `incoming/${id}.${extFor(file)}`;
  const { error } = await supabase.storage
    .from("app-submissions")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

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
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [shotFiles, setShotFiles] = useState<File[]>([]);
  const [shotPreviews, setShotPreviews] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  const resetAll = () => {
    setForm({
      name: "",
      url: "",
      tagline: "",
      description: "",
      useCase: "",
      contactEmail: "",
      accentColor: "",
    });
    setLogoFile(null);
    setLogoPreview(null);
    setShotFiles([]);
    setShotPreviews([]);
    setFileError(null);
  };

  const mut = useMutation({
    mutationFn: async () => {
      let logoPath: string | null = null;
      const screenshotPaths: string[] = [];
      if (logoFile) logoPath = await uploadImage(logoFile);
      for (const f of shotFiles) screenshotPaths.push(await uploadImage(f));
      return submitFn({
        data: {
          name: form.name,
          url: form.url,
          tagline: form.tagline,
          description: form.description || null,
          useCase: form.useCase || null,
          contactEmail: form.contactEmail,
          accentColor: form.accentColor || null,
          logoPath,
          screenshotPaths,
        },
      });
    },
  });

  const onLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(f.type)) {
      setFileError("Logo must be PNG, JPEG, WebP, GIF, or SVG.");
      return;
    }
    if (f.size > MAX_LOGO_MB * 1024 * 1024) {
      setFileError(`Logo must be under ${MAX_LOGO_MB} MB.`);
      return;
    }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  };

  const onShotsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (shotFiles.length + files.length > MAX_SHOTS) {
      setFileError(`Up to ${MAX_SHOTS} screenshots allowed.`);
      return;
    }
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setFileError("Screenshots must be PNG, JPEG, WebP, GIF, or SVG.");
        return;
      }
      if (f.size > MAX_SHOT_MB * 1024 * 1024) {
        setFileError(`Each screenshot must be under ${MAX_SHOT_MB} MB.`);
        return;
      }
    }
    setShotFiles((prev) => [...prev, ...files]);
    setShotPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    e.target.value = "";
  };

  const removeShot = (idx: number) => {
    setShotFiles((prev) => prev.filter((_, i) => i !== idx));
    setShotPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  if (mut.isSuccess) {
    const submissionId = mut.data?.id;
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
          {submissionId ? (
            <p className="mt-3 text-sm text-green-900/80">
              Track review progress:{" "}
              <Link
                to="/apps/submissions/$id"
                params={{ id: submissionId }}
                className="font-medium underline"
              >
                View submission status
              </Link>
              . Bookmark that link — it shows the timeline as your submission is reviewed and published.
            </p>
          ) : null}
          <button
            onClick={() => {
              mut.reset();
              resetAll();
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

        <Field label="App logo" hint={`Optional. PNG/JPEG/WebP/SVG, up to ${MAX_LOGO_MB} MB. Square works best.`}>
          <input
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            onChange={onLogoChange}
            className="mt-1 block w-full text-sm"
          />
          {logoPreview ? (
            <div className="mt-3 flex items-center gap-3">
              <img
                src={logoPreview}
                alt="Logo preview"
                className="h-16 w-16 rounded-md border border-border bg-background object-contain"
              />
              <button
                type="button"
                onClick={() => {
                  setLogoFile(null);
                  setLogoPreview(null);
                }}
                className="text-xs text-muted-foreground underline"
              >
                Remove
              </button>
            </div>
          ) : null}
        </Field>

        <Field
          label="Screenshots"
          hint={`Optional. Up to ${MAX_SHOTS} images, ${MAX_SHOT_MB} MB each.`}
        >
          <input
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            multiple
            onChange={onShotsChange}
            className="mt-1 block w-full text-sm"
          />
          {shotPreviews.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {shotPreviews.map((src, i) => (
                <div key={src} className="relative">
                  <img
                    src={src}
                    alt={`Screenshot ${i + 1} preview`}
                    className="h-24 w-full rounded-md border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeShot(i)}
                    className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white"
                    aria-label={`Remove screenshot ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Field>

        {fileError ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {fileError}
          </p>
        ) : null}

        {mut.error ? (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {(mut.error as Error).message}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mut.isPending || !!fileError}
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
