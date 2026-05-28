import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import resonanceLockup from "@/assets/resonance-lockup.png";

const Search = z.object({
  sku: z.string().optional(),
  return_to: z.string().url().optional(),
});

export const Route = createFileRoute("/checkout/cancel")({
  head: () => ({
    meta: [
      { title: "Payment cancelled — The Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>) => Search.parse(raw),
  component: CancelPage,
});

function CancelPage() {
  const { sku, return_to } = Route.useSearch();
  return (
    <div className="min-h-screen text-foreground">
      <nav className="fixed top-0 w-full z-50 px-6 py-4 backdrop-blur-xl bg-background/60 border-b border-white/5">
        <Link to="/" className="inline-flex">
          <img src={resonanceLockup} alt="The Resonance" className="h-6 sm:h-7 w-auto brightness-0 invert" />
        </Link>
      </nav>
      <main className="pt-32 pb-24 px-6 max-w-xl mx-auto text-center">
        <div className="rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl p-10">
          <h1 className="text-3xl font-extrabold tracking-tight mb-3">Checkout cancelled</h1>
          <p className="text-white/70 mb-8">
            No charge was made. You can try again whenever you&apos;re ready.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/checkout"
              search={{ sku }}
              className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
            >
              Try again
            </Link>
            {return_to && (
              <a
                href={return_to}
                className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-sm font-bold"
              >
                Back to app
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
