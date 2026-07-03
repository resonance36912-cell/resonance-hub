import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/creative-studio/pricing")({
  beforeLoad: () => {
    throw redirect({ to: "/pricing", hash: "creative-studio" });
  },
  component: () => null,
});
