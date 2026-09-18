import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type ReactNode } from "react";
import { ronsAuth } from "@/lib/auth-provider";
import {
  createMyifyPackage,
  getMyifyDashboard,
  queueMyifyReallocation,
  registerMyifyRouter,
  releaseMyifyAllocation,
  settleMyifyAllocation,
} from "@/lib/myify/functions";
import {
  availableMb,
  expiryBand,
  hoursUntilUtc,
  reallocationPriorityScore,
  recommendReserveMb,
  transferWindowUtc,
} from "@/lib/myify/core";

export const Route = createFileRoute("/myify")({
  head: () => ({
    meta: [
      { title: "MYIFY · DataNest · RONSAS" },
      {
        name: "description",
        content:
          "MYIFY — May Your Intentions Find You. Preserve eligible unused data value through DataNest and a governed Mirror Router allocation ledger.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { next: "/myify" } });
    }
  },
  component: MyifyWorkspace,
});

type DataPackage = {
  id: string;
  carrier: string;
  package_label: string;
  total_mb: number;
  remaining_mb: number;
  reserved_mb: number;
  expires_at: string;
  rollover_eligible: boolean;
  transferable: boolean;
  router_share_permitted: boolean;
  status: string;
  transfer_window_opens_at: string;
  transfer_window_closes_at: string;
  expires_epoch_seconds: number;
  metadata?: { verification?: string };
};

type RouterMirror = {
  id: string;
  label: string;
  mode: "simulation" | "generic" | "openwrt" | "mikrotik";
  status: string;
};

type Allocation = {
  id: string;
  reserved_mb: number;
  settled_mb: number;
  status: string;
  intent: string;
};

type Dashboard = {
  nest: {
    id: string;
    name: string;
    settled_mb: number;
    participation_units: number | string;
  };
  packages: DataPackage[];
  routers: RouterMirror[];
  allocations: Allocation[];
  reallocationQueue: Array<{
    id: string;
    allocation_id: string;
    package_id: string;
    target_scope: "datanest" | "subscriber" | "business_pool";
    requested_mb: number;
    priority_score: number;
    window_opens_at: string;
    window_closes_at: string;
    status: string;
    interest_basis: string;
    created_at: string;
  }>;
  ledger: Array<{
    id: number;
    event_type: string;
    mb_delta: number;
    units_delta: number | string;
    status: string;
    basis: string;
    created_at: string;
  }>;
};

function MyifyWorkspace() {
  const qc = useQueryClient();
  const loadDashboard = useServerFn(getMyifyDashboard);
  const createPackage = useServerFn(createMyifyPackage);
  const registerRouter = useServerFn(registerMyifyRouter);
  const queueReallocation = useServerFn(queueMyifyReallocation);
  const settleAllocation = useServerFn(settleMyifyAllocation);
  const releaseAllocation = useServerFn(releaseMyifyAllocation);

  const [carrier, setCarrier] = useState("");
  const [packageLabel, setPackageLabel] = useState("");
  const [totalMb, setTotalMb] = useState("2048");
  const [remainingMb, setRemainingMb] = useState("2048");
  const [expiresAt, setExpiresAt] = useState("");
  const [rolloverEligible, setRolloverEligible] = useState(false);
  const [transferable, setTransferable] = useState(false);
  const [routerSharePermitted, setRouterSharePermitted] = useState(false);
  const [routerLabel, setRouterLabel] = useState("DataNest Mirror");
  const [routerMode, setRouterMode] = useState<RouterMirror["mode"]>("simulation");
  const [targetScope, setTargetScope] = useState<"datanest" | "subscriber" | "business_pool">(
    "business_pool",
  );
  const [settleAllocationId, setSettleAllocationId] = useState("");
  const [settleMb, setSettleMb] = useState("256");

  const dashboardQ = useQuery({
    queryKey: ["myify-dashboard"],
    queryFn: async () => (await loadDashboard()) as Dashboard,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["myify-dashboard"] });

  const packageMutation = useMutation({
    mutationFn: () =>
      createPackage({
        data: {
          carrier,
          package_label: packageLabel,
          total_mb: Number(totalMb),
          remaining_mb: Number(remainingMb),
          expires_at: new Date(expiresAt).toISOString(),
          rollover_eligible: rolloverEligible,
          transferable,
          router_share_permitted: routerSharePermitted,
        },
      }),
    onSuccess: async () => {
      setCarrier("");
      setPackageLabel("");
      setRolloverEligible(false);
      setTransferable(false);
      setRouterSharePermitted(false);
      await refresh();
    },
  });

  const routerMutation = useMutation({
    mutationFn: () => registerRouter({ data: { label: routerLabel, mode: routerMode } }),
    onSuccess: refresh,
  });

  const readyRouter = useMemo(
    () => dashboardQ.data?.routers.find((router) => router.status === "ready"),
    [dashboardQ.data?.routers],
  );

  const queueMutation = useMutation({
    mutationFn: ({ packageId, requestedMb }: { packageId: string; requestedMb: number }) => {
      if (!readyRouter) throw new Error("Create or connect a ready Mirror Router first.");
      return queueReallocation({
        data: {
          package_id: packageId,
          router_id: readyRouter.id,
          requested_mb: requestedMb,
          target_scope: targetScope,
          intent:
            "Reallocate eligible expiring sovereign data through the UTC-aligned DataNest transfer window.",
        },
      });
    },
    onSuccess: refresh,
  });

  const settleMutation = useMutation({
    mutationFn: () =>
      settleAllocation({
        data: {
          allocation_id: settleAllocationId,
          settle_mb: Number(settleMb),
        },
      }),
    onSuccess: async () => {
      setSettleAllocationId("");
      await refresh();
    },
  });

  const releaseMutation = useMutation({
    mutationFn: (allocationId: string) =>
      releaseAllocation({ data: { allocation_id: allocationId } }),
    onSuccess: refresh,
  });

  const dashboard = dashboardQ.data;
  const activeAllocations =
    dashboard?.allocations.filter((item) =>
      ["reserved", "partially_settled"].includes(item.status),
    ) ?? [];
  const expiringSoon =
    dashboard?.packages.filter((item) => ["urgent", "soon"].includes(expiryBand(item.expires_at)))
      .length ?? 0;
  const mutationError =
    packageMutation.error ||
    routerMutation.error ||
    queueMutation.error ||
    settleMutation.error ||
    releaseMutation.error;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1500px] px-4 py-8 md:px-6">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              RONSAS · MYIFY
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">MYIFY</h1>
            <p className="mt-1 text-sm font-medium text-primary">May Your Intentions Find You</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              DataNest preserves the accountable value of eligible unused data on a canonical UTC
              timeline. A Mirror Router places eligible capacity into a sovereign transfer window,
              records settlement, and credits participation only after verification.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/governance/workspace" className="text-primary hover:underline">
              Governance
            </Link>
            <Link to="/" className="text-primary hover:underline">
              Back to Hub
            </Link>
          </div>
        </header>

        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6">
          <strong>DataNest accounting boundary:</strong> data bundles remain carrier entitlements.
          MYIFY does not extend expiry or create transferable data outside operator rules. DataNest
          Participation Units (DPU) are an internal contribution measure, not shares, cash,
          cryptocurrency, a deposit, or a guaranteed return.
        </div>

        {mutationError && (
          <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {mutationError instanceof Error ? mutationError.message : "MYIFY action failed"}
          </div>
        )}

        {dashboardQ.isLoading && (
          <section className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            Opening DataNest…
          </section>
        )}

        {dashboard && (
          <>
            <section className="mb-6 grid gap-4 md:grid-cols-5">
              <Metric label="Settled contribution" value={formatGb(dashboard.nest.settled_mb)} />
              <Metric
                label="Participation units"
                value={Number(dashboard.nest.participation_units).toFixed(3) + " DPU"}
              />
              <Metric label="Packages near expiry" value={String(expiringSoon)} />
              <Metric
                label="Ready Mirror Routers"
                value={String(dashboard.routers.filter((r) => r.status === "ready").length)}
              />
              <Metric
                label="UTC reallocation queue"
                value={String(
                  dashboard.reallocationQueue.filter((item) =>
                    ["queued", "claimed"].includes(item.status),
                  ).length,
                )}
              />
            </section>

            <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
              <aside className="space-y-5">
                <section className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold">Add data package</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Record the operator-reported balance and permissions that apply. Expiry is
                    normalized to UTC when saved.
                  </p>
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      packageMutation.mutate();
                    }}
                  >
                    <Field value={carrier} onChange={setCarrier} placeholder="Carrier, e.g. MTN" />
                    <Field
                      value={packageLabel}
                      onChange={setPackageLabel}
                      placeholder="Package label"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Field
                        value={totalMb}
                        onChange={setTotalMb}
                        placeholder="Total MB"
                        type="number"
                      />
                      <Field
                        value={remainingMb}
                        onChange={setRemainingMb}
                        placeholder="Remaining MB"
                        type="number"
                      />
                    </div>
                    <input
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      required
                    />
                    <Check
                      checked={rolloverEligible}
                      onChange={setRolloverEligible}
                      label="Operator rollover eligible"
                    />
                    <Check
                      checked={transferable}
                      onChange={setTransferable}
                      label="Carrier transfer permitted"
                    />
                    <Check
                      checked={routerSharePermitted}
                      onChange={setRouterSharePermitted}
                      label="Wi-Fi/router sharing permitted by package terms"
                    />
                    <button
                      disabled={packageMutation.isPending}
                      className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                    >
                      {packageMutation.isPending ? "Adding…" : "Add to DataNest"}
                    </button>
                  </form>
                </section>

                <section className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold">Mirror Router</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Simulation is operational now but earns zero DPU. Hardware modes remain offline
                    until a device adapter is paired; router credentials are never stored here.
                  </p>
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      routerMutation.mutate();
                    }}
                  >
                    <Field
                      value={routerLabel}
                      onChange={setRouterLabel}
                      placeholder="Router label"
                    />
                    <select
                      value={routerMode}
                      onChange={(e) => setRouterMode(e.target.value as RouterMirror["mode"])}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="simulation">Simulation mirror</option>
                      <option value="generic">Generic adapter</option>
                      <option value="openwrt">OpenWrt</option>
                      <option value="mikrotik">MikroTik</option>
                    </select>
                    <select
                      value={targetScope}
                      onChange={(e) =>
                        setTargetScope(
                          e.target.value as "datanest" | "subscriber" | "business_pool",
                        )
                      }
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="business_pool">DataNest business pool</option>
                      <option value="datanest">Own DataNest reallocation</option>
                      <option value="subscriber">Eligible subscriber transfer</option>
                    </select>
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      Target scope is an allocation instruction. It does not override carrier
                      transfer permissions or create a financial security.
                    </p>
                    <button
                      disabled={routerMutation.isPending}
                      className="w-full rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                    >
                      {routerMutation.isPending ? "Registering…" : "Register mirror"}
                    </button>
                  </form>
                  <div className="mt-4 space-y-2">
                    {dashboard.routers.map((router) => (
                      <div key={router.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{router.label}</span>
                          <Status value={router.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{router.mode}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>

              <main className="space-y-5">
                <section className="rounded-xl border bg-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">Expiry-aware package pool</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Recommendations favor data closest to expiry; settlement still requires an
                        eligible package and a ready Mirror Router.
                      </p>
                    </div>
                    <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
                      {dashboard.packages.length} packages
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {dashboard.packages.map((item) => {
                      const band = expiryBand(item.expires_at);
                      const available = availableMb(item.remaining_mb, item.reserved_mb);
                      const hoursLeft = hoursUntilUtc(item.expires_at);
                      const transferOpen = hoursLeft > 0 && hoursLeft <= 72;
                      const verified = item.metadata?.verification === "verified";
                      const priority = reallocationPriorityScore({
                        remainingMb: item.remaining_mb,
                        reservedMb: item.reserved_mb,
                        expiresAt: item.expires_at,
                        transferable: item.transferable,
                        routerSharePermitted: item.router_share_permitted,
                        rolloverEligible: item.rollover_eligible,
                        verified,
                      });
                      const recommended = recommendReserveMb({
                        remainingMb: item.remaining_mb,
                        reservedMb: item.reserved_mb,
                        expiresAt: item.expires_at,
                        transferable: item.transferable || item.router_share_permitted,
                        rolloverEligible: item.rollover_eligible,
                      });
                      const window = transferWindowUtc(item.expires_at);
                      return (
                        <article key={item.id} className="rounded-xl border p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">{item.package_label}</p>
                              <p className="text-xs text-muted-foreground">{item.carrier}</p>
                            </div>
                            <Status value={band} />
                          </div>
                          <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                            <Mini label="Remaining" value={formatGb(item.remaining_mb)} />
                            <Mini label="Reserved" value={formatGb(item.reserved_mb)} />
                            <Mini label="Available" value={formatGb(available)} />
                            <Mini label="Priority" value={String(priority)} />
                          </div>
                          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                            <p>Expires {formatUtcDate(item.expires_at)}</p>
                            <p>
                              UTC window {formatUtcDate(window.opensAtUtc)} →{" "}
                              {formatUtcDate(window.closesAtUtc)}
                            </p>
                            <p>UTC epoch {item.expires_epoch_seconds}</p>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <Tag ok={item.rollover_eligible}>rollover</Tag>
                            <Tag ok={item.transferable}>carrier transfer</Tag>
                            <Tag ok={item.router_share_permitted}>router share</Tag>
                            <Tag ok={verified}>verified source</Tag>
                            <Tag ok={transferOpen}>UTC transfer window</Tag>
                          </div>
                          <button
                            disabled={
                              recommended <= 0 ||
                              priority <= 0 ||
                              !transferOpen ||
                              !readyRouter ||
                              queueMutation.isPending ||
                              item.status !== "active"
                            }
                            onClick={() =>
                              queueMutation.mutate({
                                packageId: item.id,
                                requestedMb: recommended,
                              })
                            }
                            className="mt-4 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40"
                          >
                            {transferOpen && recommended > 0
                              ? "Queue UTC reallocation " + formatGb(recommended)
                              : hoursLeft > 72
                                ? "Transfer window opens " + formatUtcDate(window.opensAtUtc)
                                : "No eligible reallocation"}
                          </button>
                        </article>
                      );
                    })}
                    {dashboard.packages.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Add a package to begin building the DataNest pool.
                      </p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold">Allocation settlement</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Settlement means the reserved amount was actually consumed or transferred
                    through an eligible path. Only verified non-simulation settlement may earn DPU.
                  </p>
                  <form
                    className="mt-4 grid gap-3 md:grid-cols-[1fr_140px_auto]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      settleMutation.mutate();
                    }}
                  >
                    <select
                      value={settleAllocationId}
                      onChange={(e) => setSettleAllocationId(e.target.value)}
                      className="rounded-md border bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Choose active allocation</option>
                      {activeAllocations.map((allocation) => (
                        <option key={allocation.id} value={allocation.id}>
                          {allocation.intent.slice(0, 45)} ·{" "}
                          {formatGb(allocation.reserved_mb - allocation.settled_mb)} open
                        </option>
                      ))}
                    </select>
                    <Field value={settleMb} onChange={setSettleMb} placeholder="MB" type="number" />
                    <button
                      disabled={settleMutation.isPending}
                      className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                    >
                      Settle
                    </button>
                  </form>

                  <div className="mt-4 space-y-2">
                    {activeAllocations.map((allocation) => (
                      <div
                        key={allocation.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs"
                      >
                        <div>
                          <p className="font-medium">{allocation.intent}</p>
                          <p className="mt-1 text-muted-foreground">
                            {formatGb(allocation.settled_mb)} settled of{" "}
                            {formatGb(allocation.reserved_mb)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Status value={allocation.status} />
                          <button
                            onClick={() => releaseMutation.mutate(allocation.id)}
                            className="rounded border px-2 py-1 hover:bg-accent"
                          >
                            Release open
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </main>

              <aside className="space-y-5">
                <section className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold">UTC reallocation queue</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sovereign bundle reservations ranked by UTC expiry priority. Queue position is
                    operational only; it is not a financial valuation.
                  </p>
                  <div className="mt-4 space-y-2">
                    {dashboard.reallocationQueue.slice(0, 20).map((item) => (
                      <div key={item.id} className="rounded-lg border p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            Priority {item.priority_score} ·{" "}
                            {item.target_scope.replaceAll("_", " ")}
                          </span>
                          <Status value={item.status} />
                        </div>
                        <p className="mt-2">
                          {formatGb(item.requested_mb)} reserved for reallocation
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Closes {formatUtcDate(item.window_closes_at)}
                        </p>
                        <p className="mt-1 text-muted-foreground">{item.interest_basis}</p>
                      </div>
                    ))}
                    {dashboard.reallocationQueue.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No sovereign bundle is currently queued for UTC reallocation.
                      </p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold">DataNest interest ledger</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Append-only evidence of reservation, settlement, and release.
                  </p>
                  <div className="mt-4 space-y-2">
                    {dashboard.ledger.slice(0, 20).map((entry) => (
                      <div key={entry.id} className="rounded-lg border p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium capitalize">{entry.event_type}</span>
                          <Status value={entry.status} />
                        </div>
                        <p className="mt-2">
                          {entry.mb_delta > 0 ? "+" : ""}
                          {entry.mb_delta} MB · {Number(entry.units_delta).toFixed(6)} DPU
                        </p>
                        <p className="mt-1 text-muted-foreground">{entry.basis}</p>
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          {formatUtcDate(entry.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-5 text-sm leading-6">
                  <h2 className="font-semibold">Operating rule</h2>
                  <p className="mt-2 text-muted-foreground">
                    UTC is the canonical operational clock for package expiry, transfer windows,
                    queue priority, and settlement evidence. MYIFY never treats an unverified or
                    simulated reservation as earned participation. Hardware adapters must obey
                    operator terms, subscriber consent, RONSAS governance, and network security.
                  </p>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      required
      min={type === "number" ? 0 : undefined}
    />
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>{label}</span>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function Tag({ ok, children }: { ok: boolean; children: ReactNode }) {
  const className =
    "rounded-full border px-2 py-1 " +
    (ok ? "border-primary/40 text-primary" : "text-muted-foreground");
  return (
    <span className={className}>
      {ok ? "✓ " : "— "}
      {children}
    </span>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {value.replaceAll("_", " ")}
    </span>
  );
}

function formatGb(mb: number) {
  if (!Number.isFinite(Number(mb))) return "0 GB";
  const gb = Number(mb) / 1024;
  return gb >= 10 ? gb.toFixed(1) + " GB" : gb.toFixed(2) + " GB";
}

function formatUtcDate(value: string) {
  return (
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
      hour12: false,
    }).format(new Date(value)) + " UTC"
  );
}
