import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/rcgf")({
  beforeLoad: () => {
    throw redirect({ to: "/governance", replace: true });
  },
});
