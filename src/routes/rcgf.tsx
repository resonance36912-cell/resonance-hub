import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";

export const Route = createFileRoute("/rcgf")({
  beforeLoad: () => {
    throw redirect({ to: "/governance", replace: true });
  },
  // Fallback UI if redirect fails (e.g. JS disabled).
  component: () => (
    <main className="mx-auto max-w-xl px-6 py-16 text-sm space-y-4">
      <p className="text-muted-foreground">
        Redirecting to <Link to="/governance" className="underline">/governance</Link>…
      </p>
      <BackToHubHeader linkClassName="underline" />
    </main>
  ),
});

