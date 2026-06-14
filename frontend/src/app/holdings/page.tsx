"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  usePublicClient,
  useChainId,
} from "wagmi";
import { formatEther } from "viem";
import Link from "next/link";
import { FACTORY_ADDRESS, FACTORY_ADDRESS_V2, STANDALONE_GAMES, getAlchemyUrl, getExplorerUrl } from "@/config";
import { FACTORY_ABI, NFT_ABI } from "@/abi";
import { computeAllStatuses } from "@/lib/gameEngine";

const resolveGatewayUrl = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    if (url.includes(".4everland.store")) return url.replace("ipfs://", "https://");
    return url.replace("ipfs://", "https://cloudflare-ipfs.com/ipfs/");
  }
  if (url.startsWith("ar://"))
    return url.replace("ar://", "https://arweave.net/");
  return url;
};

const STATUS_PILL: Record<string, string> = {
  alive:      "pill-alive",
  eliminated: "pill-eliminated",
  winner:     "pill-winner",
  claimed:    "pill-claimed",
  pending:    "pill-pending",
};

const CARD_BORDER: Record<string, string> = {
  alive:   "2px solid var(--green)",
  winner:  "2px solid var(--text-primary)",
  claimed: "2px solid var(--blue)",
};

interface TokenData {
  id: number;
  status: string;
  imageUrl: string;
  gameAddress: string;
}

function GameHoldings({ gameAddress, userAddress, chainId }: { gameAddress: string; userAddress: string; chainId: number }) {
  const [resolvedArtwork, setResolvedArtwork] = useState("");
  const [ownedTokenIds, setOwnedTokenIds] = useState<number[]>([]);
  const [isScanning, setIsScanning] = useState(true);

  const addr = gameAddress as `0x${string}`;
  const publicClient = usePublicClient();

  // Read game metadata
  const { data: results } = useReadContracts({
    contracts: [
      { address: addr, abi: NFT_ABI, functionName: "totalSupply" },
      { address: addr, abi: NFT_ABI, functionName: "startTokenId" },
      { address: addr, abi: NFT_ABI, functionName: "endTokenId" },
      { address: addr, abi: NFT_ABI, functionName: "mintingOpen" },
      { address: addr, abi: NFT_ABI, functionName: "artworkURI" },
      { address: addr, abi: NFT_ABI, functionName: "gameFinished" },
      { address: addr, abi: NFT_ABI, functionName: "name" },
      { address: addr, abi: NFT_ABI, functionName: "roundCount" },
    ],
  });

  const totalSupply  = results?.[0]?.result as bigint | undefined;
  const startTokenId = results?.[1]?.result as bigint | undefined;
  const endTokenId   = results?.[2]?.result as bigint | undefined;
  const mintingOpen  = results?.[3]?.result as boolean | undefined;
  const artworkURI   = results?.[4]?.result as string | undefined;
  const gameFinished = results?.[5]?.result as boolean | undefined;
  const gameName     = results?.[6]?.result as string | undefined;
  const roundCount   = results?.[7]?.result as bigint | undefined;

  const startId   = Number(startTokenId || 1n);
  const totalCount = mintingOpen
    ? Number(totalSupply || 0n)
    : Number(endTokenId || 0n) >= startId
    ? Number(endTokenId || 0n) - startId + 1
    : 0;

  // Resolve artwork
  useEffect(() => {
    if (!artworkURI) return;
    const url = resolveGatewayUrl(artworkURI);
    (async () => {
      try {
        const r = await fetch(url);
        const j = await r.json();
        setResolvedArtwork(resolveGatewayUrl(j.image || url));
      } catch {
        setResolvedArtwork(url);
      }
    })();
  }, [artworkURI]);

  // ── Owned token IDs via Alchemy asset transfers (no ownerOf scan) ──────────
  useEffect(() => {
    if (!userAddress) return;
    let cancelled = false;
    setIsScanning(true);

    const fetch_owned = async () => {
      try {
        const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
        if (alchemyKey) {
          const url = getAlchemyUrl(alchemyKey, chainId);
          const owned = new Set<number>();
          let pageKey: string | undefined;
          do {
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "alchemy_getAssetTransfers",
                params: [{ fromBlock: "0x0", toBlock: "latest", toAddress: userAddress,
                  contractAddresses: [gameAddress], category: ["erc721"],
                  withMetadata: false, excludeZeroValue: true, maxCount: "0x3e8",
                  ...(pageKey ? { pageKey } : {}) }] }) });
            const json = await res.json();
            for (const t of json?.result?.transfers ?? []) if (t.tokenId) owned.add(Number(BigInt(t.tokenId)));
            pageKey = json?.result?.pageKey;
          } while (pageKey && !cancelled);
          // Remove sent tokens
          let outPage: string | undefined;
          do {
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: 2, jsonrpc: "2.0", method: "alchemy_getAssetTransfers",
                params: [{ fromBlock: "0x0", toBlock: "latest", fromAddress: userAddress,
                  contractAddresses: [gameAddress], category: ["erc721"],
                  withMetadata: false, excludeZeroValue: true, maxCount: "0x3e8",
                  ...(outPage ? { pageKey: outPage } : {}) }] }) });
            const json = await res.json();
            for (const t of json?.result?.transfers ?? []) if (t.tokenId) owned.delete(Number(BigInt(t.tokenId)));
            outPage = json?.result?.pageKey;
          } while (outPage && !cancelled);
          if (!cancelled) setOwnedTokenIds([...owned].sort((a, b) => a - b));
        } else if (publicClient) {
          // Fallback: ownerOf only for owned tokens (small set expected)
          const all = Array.from({ length: totalCount }, (_, i) => startId + i);
          const owners = await Promise.all(all.map(id =>
            publicClient.readContract({ address: addr, abi: NFT_ABI, functionName: "ownerOf", args: [BigInt(id)] })
              .then(o => ({ id, owned: (o as string).toLowerCase() === userAddress.toLowerCase() }))
              .catch(() => ({ id, owned: false }))
          ));
          if (!cancelled) setOwnedTokenIds(owners.filter(r => r.owned).map(r => r.id));
        }
      } catch (e) {
        console.warn("Holdings scan failed:", e);
      } finally {
        if (!cancelled) setIsScanning(false);
      }
    };

    fetch_owned();
    return () => { cancelled = true; };
  }, [userAddress, gameAddress, totalCount]);

  // ── Game engine: compute status locally from round seeds ──────────────────
  const roundSeedContracts = Array.from({ length: Number(roundCount || 0) }, (_, i) => ({
    address: addr, abi: NFT_ABI, functionName: "getRoundSeed" as const, args: [BigInt(i)],
  }));
  const { data: roundSeedResults } = useReadContracts({
    contracts: roundSeedContracts,
    query: { enabled: Number(roundCount || 0) > 0, staleTime: Infinity, gcTime: Infinity },
  });
  const roundSeeds = (roundSeedResults || []).map(r => (r?.result as bigint) ?? 0n);
  const count = Number(roundCount || 0);
  const canCompute = totalCount > 0 && (count === 0 || roundSeeds.length >= count);
  const statusMap = canCompute ? computeAllStatuses(totalCount, roundSeeds, count) : {};

  // Token URIs only for owned tokens (small set — correct to fetch here)
  const uriContracts = ownedTokenIds.map((id) => ({
    address: addr, abi: NFT_ABI, functionName: "tokenURI" as const, args: [BigInt(id)],
  }));
  const { data: uriResults } = useReadContracts({
    contracts: uriContracts,
    query: { enabled: ownedTokenIds.length > 0 },
  });

  const userTokens: TokenData[] = ownedTokenIds.map((id, i) => {
    // Use game engine for status (fast, no extra RPC)
    const rawStatus = statusMap[id];
    let status = "pending";
    if (rawStatus === "alive") status = gameFinished ? "winner" : "alive";
    else if (rawStatus === "eliminated") status = "eliminated";
    return { id, status, imageUrl: resolvedArtwork, gameAddress };
  });

  // Don't render if no tokens owned
  if (isScanning) {
    return (
      <div style={{ padding: "16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="spinner" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Scanning {gameName || gameAddress.slice(0, 8) + "…"}
          </span>
        </div>
      </div>
    );
  }

  if (ownedTokenIds.length === 0) return null;

  return (
    <div style={{ marginBottom: 32 }}>
      {/* Game header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <div className="holdings-header">
          <div>
            <Link href={`/arena/${gameAddress}`} className="game-title">
              {gameName || `Game ${gameAddress.slice(0, 6)}…`}
            </Link>
            <div className="game-contract">
              <a href={getExplorerUrl(gameAddress, chainId)} target="_blank" rel="noopener noreferrer" className="address-link">
                Contract: {gameAddress.slice(0, 6)}…{gameAddress.slice(-4)}
              </a>
            </div>
          </div>
          {gameFinished && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--gold)", marginLeft: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Finished
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/arena/${gameAddress}`} className="btn btn-outline" style={{ fontSize: 9, padding: "4px 12px" }}>
            Arena
          </Link>
          <Link href={`/claim/${gameAddress}`} className="btn btn-outline" style={{ fontSize: 9, padding: "4px 12px" }}>
            Claim
          </Link>
        </div>
      </div>

      {/* Token grid */}
      <div className="nft-grid">
        {userTokens.map((t) => (
          <div
            key={t.id}
            className={`nft-card ${t.status === "eliminated" ? "nft-card--eliminated" : ""}`}
            style={{ borderTop: CARD_BORDER[t.status] || "none" }}
          >
            <div className="nft-card-image">
              {t.imageUrl ? (
                <img src={t.imageUrl} alt={`#${t.id}`} loading="lazy" />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "var(--bg-card-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-muted)",
                  }}
                >
                  #{t.id}
                </div>
              )}
            </div>
            <div className="nft-card-body">
              <span className="nft-card-id">#{t.id}</span>
              <span className={`nft-status-pill ${STATUS_PILL[t.status] || "pill-pending"}`}>
                {t.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HoldingsPage() {
  const { address: userAddress } = useAccount();
  const chainId = useChainId();

  // Fetch all games from factory V1
  const { data: gamesDataV1 } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getGames",
  });

  // Fetch all games from factory V2
  const { data: gamesDataV2 } = useReadContracts({
    contracts: FACTORY_ADDRESS_V2.map((addr) => ({
      address: addr,
      abi: FACTORY_ABI,
      functionName: "getGames",
    })),
  });

  const gamesV1 = (gamesDataV1 as string[]) || [];
  const gamesV2 = gamesDataV2 
    ? gamesDataV2.flatMap((res) => (res.status === 'success' ? (res.result as string[]) : [])) 
    : [];
  const games = Array.from(new Set([
    ...gamesV1,
    ...gamesV2,
    ...(STANDALONE_GAMES || [])
  ]));

  return (
    <div className="page-root">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/">Arena</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Holdings</span>
        {userAddress && (
          <>
            <span className="breadcrumb-sep">/</span>
            <span style={{ color: "var(--text-primary)" }}>
              {userAddress.slice(0, 6)}…{userAddress.slice(-4)}
            </span>
          </>
        )}
      </div>

      {/* Header */}
      <div style={{ padding: "24px 0", borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
        <h1 style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, textTransform: "uppercase", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          My Holdings
        </h1>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 }}>
          Tokens across {games.length} game{games.length !== 1 ? "s" : ""}
        </p>
      </div>

      {!userAddress ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "80px 16px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Wallet not connected
          </p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center", maxWidth: 320 }}>
            Connect your wallet to see your tokens across all games.
          </p>
        </div>
      ) : games.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "80px 16px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            No games deployed
          </p>
        </div>
      ) : (
        <div>
          {games.map((g) => (
            <GameHoldings key={g} gameAddress={g} userAddress={userAddress} chainId={chainId} />
          ))}
        </div>
      )}
    </div>
  );
}
