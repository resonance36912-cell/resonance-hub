import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { ronsAuth } from "@/lib/auth-provider";
import { DataNestShell } from "@/components/datanest/DataNestShell";

export const Route = createFileRoute("/datanest")({
  head: () => ({
    meta: [
      { title: "DataNest · Resonance AppDev" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { next: "/datanest" } });
    }
  },
  component: () => (
    <DataNestShell>
      <Outlet />
    </DataNestShell>
  ),
});
