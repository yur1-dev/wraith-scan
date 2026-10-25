import { NextResponse } from "next/server";
import { getSolUsd } from "@/lib/marketProviders";

export const dynamic = "force-dynamic";

export async function GET() {
  const solUsd = await getSolUsd();
  return NextResponse.json({ solUsd }, { headers: { "Cache-Control": "no-store" } });
}
