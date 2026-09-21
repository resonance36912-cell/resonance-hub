// @no-back-to-hub redirect route — server-side redirects to /pricing
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/youtube-optimizer/pricing")({
  beforeLoad: () => {
    throw redirect({ to: "/pricing", hash: "youtube-optimizer" });
  },
  component: () => null,
});
