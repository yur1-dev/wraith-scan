import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/proxy-img?url=<encoded-url>
 *
 * Proxies an external image through the Next.js server so html2canvas
 * can capture it without hitting CORS restrictions.
 * Only allows image content-types for safety.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing url param", { status: 400 });
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
    // Basic safety — only allow http/https
    if (!/^https?:\/\//i.test(decoded)) throw new Error("bad protocol");
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  try {
    const upstream = await fetch(decoded, {
      headers: {
        // Mimic a browser request so CDNs don't reject us
        "User-Agent":
          "Mozilla/5.0 (compatible; WraithBot/1.0; +https://wraith.app)",
        Accept: "image/*,*/*;q=0.8",
      },
      // 5 second timeout
      signal: AbortSignal.timeout(5000),
    });

    if (!upstream.ok) {
      return new NextResponse("Upstream error", { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/png";
    // Safety: only pass through actual image types
    if (!contentType.startsWith("image/")) {
      return new NextResponse("Not an image", { status: 415 });
    }

    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        // Allow the browser to use this cross-origin
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[proxy-img] fetch failed", err);
    return new NextResponse("Fetch failed", { status: 502 });
  }
}
