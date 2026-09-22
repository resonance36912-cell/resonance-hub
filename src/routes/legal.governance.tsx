import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/governance")({
  beforeLoad: () => {
    throw redirect({ to: "/governance", replace: true });
  },
});
