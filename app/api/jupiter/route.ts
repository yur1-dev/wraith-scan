import { NextRequest, NextResponse } from "next/server";

const JUP_BASE = "https://api.jup.ag/swap/v1";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") || "quote";
  searchParams.delete("endpoint");

  const upstreamUrl = `${JUP_BASE}/${endpoint}?${searchParams.toString()}`;

  try {
    const res = await fetch(upstreamUrl, {
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") || "swap";

  const upstreamUrl = `${JUP_BASE}/${endpoint}`;
  const body = await req.json();

  try {
    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
