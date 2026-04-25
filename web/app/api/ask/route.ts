import { NextResponse } from "next/server";
import { ask } from "@/lib/agent";
import { getContext } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { user_id?: string; query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const userId = body.user_id?.trim();
  const query = body.query?.trim();
  if (!userId || !query) {
    return NextResponse.json({ error: "user_id and query are required." }, { status: 400 });
  }

  let ctx;
  try {
    ctx = getContext(userId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown user." },
      { status: 404 },
    );
  }

  const trace = await ask(ctx, query);
  return NextResponse.json(trace);
}
