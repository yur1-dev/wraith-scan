// Digital Asset Links: lets the Android app (Trusted Web Activity) open wraith.farm full screen, without a browser bar.
// Set ANDROID_SHA256 (comma-separated, from `bubblewrap fingerprint` / Play Console app signing) in Vercel.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const prints = (process.env.ANDROID_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const body = prints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: process.env.ANDROID_PACKAGE ?? "farm.wraith.app", sha256_cert_fingerprints: prints } }]
    : [];
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
}
