// ─── Deployed Addresses ───────────────────────────────────────────────────────
// Update these after deploying via Remix.

export const FACTORY_ADDRESS_BASE = "0x18c6FAa50C3a5e66C8E0EA02Aef9012Cb63095BF"; // Ed4nsFactory (V1)
export const FACTORY_ADDRESS_V2_BASE: `0x${string}`[] = ["0xe81Fb3F6b3b09Ddf7d6a101EF456F99101Ac1887"]; // Ed4nsFactoryV2 (V2) - Update after deployment


export const FACTORY_ADDRESS_ROBINHOOD = "0x009245A58fbF48C46243424a28C033fA908c2457"; // Ed4nsFactory on Robinhood Mainnet

export const PROTOCOL_ADDRESS = "0xa0a6e5C0F17DA5e5337C9CD5bf353C61BA375c0D"; // 10% fee recipient
export const STANDALONE_GAMES = ["0x99b9311f3b3C2f724c45DDB371A7B9b9b7DFF2F5"];
// The only wallet allowed to see the deploy form on the /launch page
export const AUTHORIZED_CREATOR = "0x420944b441715E34Dd672AE0Eb4526A7AD7d1EEF"; // Update to your wallet

export const getExplorerUrl = (address: string, chainId?: number) => {
    if (chainId === 4663) return `https://robinhoodchain.blockscout.com/address/${address}`;
    if (chainId === 46630) return `https://explorer.testnet.chain.robinhood.com/address/${address}`;

    if (chainId === 8453) return `https://base.blockscout.com/address/${address}`;
    if (chainId === 84532) return `https://base-sepolia.blockscout.com/address/${address}`;
    return `https://eth-sepolia.blockscout.com/address/${address}`;
};

export const getAlchemyUrl = (key: string, chainId?: number) => {
    if (chainId === 4663) return `https://robinhood-mainnet.g.alchemy.com/v2/${key}`;
    if (chainId === 46630) return `https://robinhood-testnet.g.alchemy.com/v2/${key}`;
    if (chainId === 8453) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
    if (chainId === 84532) return `https://base-sepolia.g.alchemy.com/v2/${key}`;
    return `https://eth-sepolia.g.alchemy.com/v2/${key}`;
};

export const getAlchemyNftUrl = (key: string, chainId?: number) => {
    if (chainId === 4663) return `https://robinhood-mainnet.g.alchemy.com/nft/v3/${key}`;
    if (chainId === 46630) return `https://robinhood-testnet.g.alchemy.com/nft/v3/${key}`;
    if (chainId === 8453) return `https://base-mainnet.g.alchemy.com/nft/v3/${key}`;
    if (chainId === 84532) return `https://base-sepolia.g.alchemy.com/nft/v3/${key}`;
    return `https://eth-sepolia.g.alchemy.com/nft/v3/${key}`;
};

export const nativeToken = (chainId?: number) => "ETH";

// ─── IPFS Gateway Resolution ────────────────────────────────────────────────
// Artwork is pinned on 4everland (see app/api/upload/route.ts), which also
// hosts a dedicated gateway for it — fast and not rate-limited like the
// shared public gateways. Try that first and only fall back to the public
// ones if it's unreachable, instead of routing everything through them.
const IPFS_GATEWAY_HOSTS: Array<(cid: string, path: string) => string> = [
  (cid, path) => `https://${cid}.ipfs.4everland.io${path}`,
  (cid, path) => `https://${cid}.ipfs.dweb.link${path}`,
  (cid, path) => `https://ipfs.io/ipfs/${cid}${path}`,
];

function parseIpfsUri(url: string): { cid: string; path: string } | null {
  if (!url) return null;
  if (url.startsWith("ipfs://")) {
    const cid = url.replace("ipfs://", "").split("/")[0];
    const path = url.replace(`ipfs://${cid}`, "");
    return { cid, path };
  }
  const gatewayMatch = url.match(/https:\/\/([^.]+)\.(?:ipfs\.(?:4everland|dweb)\.[a-z]+|ipfs4everland\.io)(\/.*)?$/);
  if (gatewayMatch) return { cid: gatewayMatch[1], path: gatewayMatch[2] || "" };
  const pathMatch = url.match(/https:\/\/ipfs\.io\/ipfs\/([^/]+)(\/.*)?$/);
  if (pathMatch) return { cid: pathMatch[1], path: pathMatch[2] || "" };
  return null;
}

// Resolves an ipfs://, 4everland, dweb.link, or ipfs.io URL to our fastest
// (dedicated) gateway. ar:// and plain http(s) URLs pass through unchanged.
export const resolveGatewayUrl = (url: string): string => {
  if (!url) return "";
  const parsed = parseIpfsUri(url);
  if (parsed) return IPFS_GATEWAY_HOSTS[0](parsed.cid, parsed.path);
  if (url.startsWith("ar://")) return url.replace("ar://", "https://arweave.net/");
  return url;
};

// All candidate gateway URLs for an IPFS reference, fastest-first, for use
// as <img onError> fallbacks. Non-IPFS URLs return a single-element array.
export const getGatewayFallbacks = (url: string): string[] => {
  const parsed = parseIpfsUri(url);
  if (!parsed) return [resolveGatewayUrl(url)];
  return IPFS_GATEWAY_HOSTS.map((g) => g(parsed.cid, parsed.path));
};

// Races a fetch against every gateway candidate at once (rather than trying
// them one after another) so a slow/dead gateway costs nothing — total wait
// time is bounded by timeoutMs regardless of how many candidates there are.
// Aborts the losing candidates once a winner is found (or all fail) so they
// don't keep consuming bandwidth in the background.
export async function raceGateways<T>(
  candidates: string[],
  run: (candidate: string, signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.any(candidates.map((c) => run(c, controller.signal)));
  } catch {
    throw new Error("All IPFS gateways failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// Fetches JSON metadata from IPFS, racing all gateways at once with a shared
// timeout so one slow/dead gateway can't hang the page forever.
export async function fetchIpfsJson(url: string, timeoutMs = 5000): Promise<any> {
  const candidates = getGatewayFallbacks(url);
  return raceGateways(candidates, async (candidate, signal) => {
    const res = await fetch(candidate, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, timeoutMs);
}

// Client-side: builds a same-origin URL for an NFT's artwork instead of
// pointing <img> tags directly at third-party IPFS gateways. This matters
// beyond CORS/latency — ad blockers and privacy extensions (e.g. uBlock
// Origin) commonly block wildcard IPFS-gateway subdomains outright
// (net::ERR_BLOCKED_BY_RESPONSE), which no amount of client-side gateway
// fallback can work around. Routing through our own domain sidesteps that
// entirely, and /api/artwork-image caches the (immutable, content-addressed)
// result so repeat views never re-hit IPFS at all.
export function artworkImageSrc(uri: string): string {
  return `/api/artwork-image?uri=${encodeURIComponent(uri)}`;
}