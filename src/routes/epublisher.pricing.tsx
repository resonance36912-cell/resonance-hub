import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/epublisher/pricing")({
  beforeLoad: () => {
    throw redirect({ to: "/pricing", hash: "epublisher" });
  },
  component: () => null,
});
