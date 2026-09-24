import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { DataNestShell } from "@/components/datanest/DataNestShell";
import { ronsAuth } from "@/lib/auth-provider";

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
  component: DataNestLayout,
});

function DataNestLayout() {
  return (
    <DataNestShell>
      <Outlet />
    </DataNestShell>
  );
}
