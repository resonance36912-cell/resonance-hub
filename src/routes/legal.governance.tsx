import { createFileRoute, Link, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/governance")({
  beforeLoad: () => {
    throw redirect({ to: "/governance", replace: true });
  },
  // Fallback UI if redirect fails (e.g. JS disabled). Also satisfies the
  // back-to-hub verifier for every user-facing route.
  component: () => (
    <main className="mx-auto max-w-xl px-6 py-16 text-sm">
      <p className="text-muted-foreground">
        Redirecting to <Link to="/governance" className="underline">/governance</Link>…
      </p>
      <p className="mt-4">
        <Link to="/" className="underline">Back to Hub</Link>
      </p>
    </main>
  ),
});
