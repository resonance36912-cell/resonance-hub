import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { ronsAuth } from "@/lib/auth-provider";

export const Route = createFileRoute("/nova")({
  head: () => ({ meta: [{ title: "Nova Studio · RONSAS" }, { name: "robots", content: "noindex, nofollow" }] }),
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) throw redirect({ to: "/login", search: { next: "/nova" } });
  },
  component: () => <Outlet />,
});
