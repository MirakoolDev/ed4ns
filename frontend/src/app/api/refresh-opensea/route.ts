import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { address, chainId, tokenIds } = await req.json();

    if (!address) {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    if (!tokenIds || !Array.isArray(tokenIds)) {
      return NextResponse.json({ error: "Missing tokenIds array" }, { status: 400 });
    }

    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      console.warn("OPENSEA_API_KEY not set in environment.");
      return NextResponse.json({ success: false, reason: "No API Key" });
    }

    let chain = "sepolia";
    if (chainId === 8453) chain = "base";
    else if (chainId === 84532) chain = "base_sepolia";

    // We only process up to 30 token IDs to prevent hitting rate limits or timeouts.
    const maxTokensToRefresh = 30;
    const tokensToProcess = tokenIds.slice(0, maxTokensToRefresh);

    const refreshPromises = tokensToProcess.map(async (tokenId) => {
      const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${address}/nfts/${tokenId}/refresh`;
      return fetch(url, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "accept": "application/json"
        }
      });
    });

    await Promise.allSettled(refreshPromises);

    return NextResponse.json({ success: true, refreshed: tokensToProcess.length });
  } catch (err: any) {
    console.error("Error refreshing opensea:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
