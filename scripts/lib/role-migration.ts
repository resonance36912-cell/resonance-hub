const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(["admin", "user"]);

export type MigratableRole = {
  id: string;
  user_id: string;
  role: "admin" | "user";
  created_at: string;
};

export type RoleMigrationDiff = {
  toInsert: MigratableRole[];
  toUpdate: MigratableRole[];
  unchanged: number;
  localOnly: number;
  conflicts: Array<{ user_id: string; role: string; hostedId: string; localId: string }>;
};

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${name}`);
  return value.trim();
}
export function sanitizeRoleRow(input: Record<string, unknown>): MigratableRole {
  const id = requiredString(input.id, "role id").toLowerCase();
  const userId = requiredString(input.user_id, "role user_id").toLowerCase();
  const role = requiredString(input.role, "role");
  const createdAt = requiredString(input.created_at, "created_at");
  if (!UUID_RE.test(id) || !UUID_RE.test(userId)) throw new Error("Role IDs must be UUIDs");
  if (!ROLES.has(role)) throw new Error("Unsupported role value");
  return { id, user_id: userId, role: role as "admin" | "user", created_at: createdAt };
}

function rowKey(row: MigratableRole): string {
  return `${row.user_id}:${row.role}`;
}

function comparable(row: MigratableRole): string {
  return JSON.stringify(row);
}

export function buildRoleMigrationDiff(
  hostedRows: readonly MigratableRole[],
  localRows: readonly MigratableRole[],
): RoleMigrationDiff {
  const localByKey = new Map(localRows.map((row) => [rowKey(row), row]));
  const hostedKeys = new Set(hostedRows.map(rowKey));
  const diff: RoleMigrationDiff = {
    toInsert: [], toUpdate: [], unchanged: 0,
    localOnly: localRows.filter((row) => !hostedKeys.has(rowKey(row))).length,
    conflicts: [],
  };
  for (const hosted of hostedRows) {
    const local = localByKey.get(rowKey(hosted));
    if (!local) { diff.toInsert.push(hosted); continue; }
    if (local.id !== hosted.id) {
      diff.conflicts.push({
        user_id: hosted.user_id, role: hosted.role,
        hostedId: hosted.id, localId: local.id,
      });
      continue;
    }
    if (comparable(local) === comparable(hosted)) diff.unchanged += 1;
    else diff.toUpdate.push(hosted);
  }
  return diff;
}
