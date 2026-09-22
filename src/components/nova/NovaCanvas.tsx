import type { ReactNode } from "react";

export const NOVA_STARTER_ACTIONS = [
  "Build an App",
  "Create Content",
  "Develop a Product",
  "Research Something",
  "Create Media",
  "Launch a Campaign",
  "Automate Work",
  "Continue a Project",
] as const;

export function NovaCanvas({
  children,
  showStarterActions = false,
  onStarterAction,
}: {
  children: ReactNode;
  showStarterActions?: boolean;
  onStarterAction?: (action: string) => void;
}) {
  return (
    <main className="min-w-0 rounded-[18px] bg-white px-5 pb-5 pt-6 shadow-sm dark:bg-card sm:px-7">
      {showStarterActions && (
        <section className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Nova Studio</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1a1c26] dark:text-foreground sm:text-4xl">
            What would you like to create today?
          </h1>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {NOVA_STARTER_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => onStarterAction?.(action)}
                className="rounded-2xl border border-border/70 bg-muted/35 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {action}
              </button>
            ))}
          </div>
        </section>
      )}
      {children}
    </main>
  );
}
