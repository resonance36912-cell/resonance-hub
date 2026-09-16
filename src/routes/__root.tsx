import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { VisitTracker } from "@/components/VisitTracker";
import { ROUTES } from "@/lib/routes";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to={ROUTES.home}
            className="inline-flex items-center justify-center rounded-md bg-primary-surface px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-surface-hover"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary-surface px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-surface-hover"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "RONSAS" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "google-site-verification", content: "cyauvD1JwPPom3ad_AbEip05fQr_BpFJF_Xfkcvblpw" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=Lora:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function isPrivateDemoHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  const match = /^172\.(\d+)\./.exec(host);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function LocalDemoLauncher() {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    const current = window.location.hostname;
    if (isPrivateDemoHost(current)) setHost(current);
  }, []);
  if (!host) return null;
  const apps = [
    ["ePublisher", 3101],
    ["Creative Studio", 3201],
    ["Sync Vision", 3301],
    ["YouTube Optimizer", 3401],
  ] as const;
  return (
    <aside className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-xs font-semibold text-foreground">RONS Local Demo</span>
        <span className="text-[10px] text-muted-foreground">public URLs unchanged</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {apps.map(([label, port]) => (
          <a
            key={port}
            href={`http://${host}:${port}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            {label}
          </a>
        ))}
      </div>
    </aside>
  );
}
function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <VisitTracker />
      <LocalDemoLauncher />
      <Outlet />
    </QueryClientProvider>
  );
}
