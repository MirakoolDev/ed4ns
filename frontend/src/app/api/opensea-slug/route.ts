import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const chainId = searchParams.get("chainId");

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "No API Key" }, { status: 500 });
  }

  let chain = "sepolia";
  if (chainId === "8453") chain = "base";
  else if (chainId === "84532") chain = "base_sepolia";

  try {
    const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${address}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        "accept": "application/json"
      }
    });

    if (!res.ok) {
        return NextResponse.json({ error: "Failed to fetch" }, { status: res.status });
    }

    const data = await res.json();
    if (data.collection) {
        return NextResponse.json({ slug: data.collection });
    } else {
        return NextResponse.json({ error: "No collection slug found" }, { status: 404 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
