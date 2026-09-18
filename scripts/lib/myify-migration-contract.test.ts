import { expect, test } from "bun:test";

const corePath = "supabase/migrations/20260918110500_myify_datanest_core.sql";
const utcPath = "supabase/migrations/20260918123000_myify_utc_reallocation.sql";

const core = await Bun.file(corePath).text();
const utc = await Bun.file(utcPath).text();

test("settlement rejects expired allocations", () => {
  expect(core).toContain("IF allocation.expires_at <= now() THEN");
  expect(core).toContain("RAISE EXCEPTION 'allocation_expired'");
});

test("unverified packages cannot earn DataNest Participation Units", () => {
  expect(core).toContain(
    "verified_package := COALESCE(package.metadata->>'verification', '') = 'verified'",
  );
  expect(core).toContain("WHEN router.mode = 'simulation' OR NOT verified_package THEN 0");
  expect(core).toContain("IF router.mode <> 'simulation' AND verified_package THEN");
});

test("UTC queue is bounded by its transfer window", () => {
  expect(utc).toContain("IF now() < package.transfer_window_opens_at THEN");
  expect(utc).toContain("RAISE EXCEPTION 'reallocation_window_not_open'");
  expect(utc).toContain("IF now() >= package.transfer_window_closes_at THEN");
  expect(utc).toContain("RAISE EXCEPTION 'reallocation_window_closed'");
});

test("expired UTC reservations are swept without DPU", () => {
  expect(utc).toContain("CREATE OR REPLACE FUNCTION public.myify_sweep_reallocation_queue");
  expect(utc).toContain("SET status = 'expired'");
  expect(utc).toContain("-outstanding_mb, 0, 'released'");
});

test("privileged MYIFY RPCs are not executable by public client roles", () => {
  expect(core).toContain("FROM PUBLIC, anon, authenticated");
  expect(core).toContain("TO service_role");
  expect(utc).toContain("FROM PUBLIC, anon, authenticated");
  expect(utc).toContain("TO service_role");
});
