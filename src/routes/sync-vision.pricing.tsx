// @no-back-to-hub redirect route — server-side redirects to /pricing
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/sync-vision/pricing")({
  beforeLoad: () => {
    throw redirect({ to: "/pricing", hash: "sync-vision" });
  },
  component: () => null,
});
