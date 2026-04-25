import { NextResponse } from "next/server";
import { dataCatalog } from "@/lib/data-loader";
import { getContext, loadUsers, scopeDescription } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const users = loadUsers().map((u) => {
    const ctx = getContext(u.user_id);
    return {
      ...u,
      scope_description: scopeDescription(ctx),
      capabilities: ctx.capabilities,
      catalog: dataCatalog(ctx),
    };
  });
  return NextResponse.json({ users });
}
