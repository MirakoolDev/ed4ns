import { NextRequest, NextResponse } from "next/server";
import { fetchIpfsJson, getGatewayFallbacks, raceGateways } from "@/config";

// Proxies + caches NFT artwork so the browser never loads a third-party IPFS
// gateway URL directly. That matters for more than CORS/latency: ad blockers
// and privacy extensions commonly block wildcard IPFS-gateway subdomains
// outright, which no client-side fallback logic can work around. Since IPFS
// content is content-addressed (immutable), the response is cacheable
// forever — after the first successful fetch, every later viewer is served
// straight from cache without touching IPFS again.
export async function GET(req: NextRequest) {
  const uri = req.nextUrl.searchParams.get("uri");
  if (!uri) return NextResponse.json({ error: "Missing uri" }, { status: 400 });

  // `uri` may point to metadata JSON (with an `image` field) or directly to
  // an image file; try it as JSON first and fall back to using it as the
  // image reference itself.
  const metadata = await fetchIpfsJson(uri).catch(() => null);
  const imageRef = metadata?.image || uri;
  const candidates = getGatewayFallbacks(imageRef);

  try {
    const { body, contentType } = await raceGateways(candidates, async (candidate, signal) => {
      const res = await fetch(candidate, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.arrayBuffer();
      if (body.byteLength === 0) throw new Error("empty body");
      return { body, contentType: res.headers.get("content-type") || "application/octet-stream" };
    }, 8000);

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
