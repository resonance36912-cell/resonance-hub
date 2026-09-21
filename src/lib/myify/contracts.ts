import { z } from "zod";

const Uuid = z.string().uuid();
const PositiveMb = z.coerce.number().int().positive().max(10_000_000);

export const CreatePackageInput = z
  .object({
    carrier: z.string().trim().min(2).max(80),
    package_label: z.string().trim().min(2).max(120),
    total_mb: PositiveMb,
    remaining_mb: z.coerce.number().int().nonnegative().max(10_000_000),
    expires_at: z.string().datetime({ offset: true }),
    rollover_eligible: z.boolean().default(false),
    transferable: z.boolean().default(false),
    router_share_permitted: z.boolean().default(false),
  })
  .refine((v) => v.remaining_mb <= v.total_mb, {
    message: "Remaining data cannot exceed the package total.",
    path: ["remaining_mb"],
  });

export const RegisterRouterInput = z.object({
  label: z.string().trim().min(2).max(120),
  mode: z.enum(["simulation", "generic", "openwrt", "mikrotik"]),
  local_fingerprint: z.string().trim().max(180).optional(),
});

export const ReserveAllocationInput = z.object({
  package_id: Uuid,
  router_id: Uuid,
  reserve_mb: PositiveMb,
  intent: z.string().trim().min(3).max(500),
});

export const SettleAllocationInput = z.object({
  allocation_id: Uuid,
  settle_mb: PositiveMb,
});

export const ReleaseAllocationInput = z.object({
  allocation_id: Uuid,
});

export const QueueReallocationInput = z.object({
  package_id: Uuid,
  router_id: Uuid,
  requested_mb: PositiveMb,
  target_scope: z.enum(["datanest", "subscriber", "business_pool"]),
  intent: z.string().trim().min(3).max(500),
});
