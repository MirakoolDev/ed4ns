import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { address, chainId } = await req.json();

    if (!address) {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    const apiKey = process.env.BLOCKSCOUT_API_KEY;
    if (!apiKey) {
      // If no key is configured, just exit gracefully so it doesn't break the frontend flow
      console.warn("BLOCKSCOUT_API_KEY not set in environment.");
      return NextResponse.json({ success: false, reason: "No API Key" });
    }

    let baseUrl = "https://eth-sepolia.blockscout.com";
    if (chainId === 8453) baseUrl = "https://base.blockscout.com";
    else if (chainId === 84532) baseUrl = "https://base-sepolia.blockscout.com";

    // Most Blockscout v2 API endpoints accept the API key via query parameter
    const url = `${baseUrl}/api/v2/tokens/${address}/instances/refetch-metadata?apikey=${apiKey}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "accept": "application/json"
      }
    });

    const data = await response.text();

    if (!response.ok) {
      console.error("Blockscout refresh failed:", response.status, data);
      return NextResponse.json({ success: false, error: data }, { status: response.status });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("Error refreshing blockscout:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
