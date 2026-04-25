import fs from "node:fs";
import path from "node:path";
import type { Capability, RBACContext, RoleName, User } from "./types";

const ROLE_CAPABILITIES: Record<RoleName, Record<Capability, boolean>> = {
  "Group CFO":           { read_actuals: true, read_budget: true,  read_projects: true, export: true  },
  "BU General Manager":  { read_actuals: true, read_budget: true,  read_projects: true, export: true  },
  "Regional Finance BP": { read_actuals: true, read_budget: true,  read_projects: true, export: true  },
  "BU Finance BP":       { read_actuals: true, read_budget: true,  read_projects: true, export: true  },
  Analyst:               { read_actuals: true, read_budget: false, read_projects: true, export: false },
};

let cachedUsers: User[] | null = null;

export function loadUsers(): User[] {
  if (cachedUsers) return cachedUsers;
  const file = path.join(process.cwd(), "lib", "data", "users.json");
  cachedUsers = JSON.parse(fs.readFileSync(file, "utf8")) as User[];
  return cachedUsers;
}

export function getContext(userId: string): RBACContext {
  const user = loadUsers().find((u) => u.user_id === userId);
  if (!user) throw new Error(`Unknown user_id: ${userId}`);
  return {
    ...user,
    capabilities: { ...ROLE_CAPABILITIES[user.role] },
  };
}

export function can(ctx: RBACContext, capability: Capability): boolean {
  return ctx.capabilities[capability] === true;
}

export function require_(ctx: RBACContext, capability: Capability): void {
  if (!can(ctx, capability)) {
    throw new PermissionDeniedError(
      `Access denied: role '${ctx.role}' lacks capability '${capability}'.`,
    );
  }
}

export function scopeDescription(ctx: RBACContext): string {
  const bu = ctx.bu_scope === "*" ? "all BUs" : `BU=${ctx.bu_scope}`;
  const rg = ctx.region_scope === "*" ? "all regions" : `region=${ctx.region_scope}`;
  return `${bu}, ${rg}`;
}

export function filterByScope<T extends { bu?: string; region?: string }>(
  ctx: RBACContext,
  rows: T[],
): T[] {
  return rows.filter((r) => {
    if (ctx.bu_scope !== "*" && r.bu !== undefined && r.bu !== ctx.bu_scope) return false;
    if (ctx.region_scope !== "*" && r.region !== undefined && r.region !== ctx.region_scope)
      return false;
    return true;
  });
}

export class PermissionDeniedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PermissionDeniedError";
  }
}
