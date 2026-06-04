"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { FACTORY_ADDRESS, getExplorerUrl } from "@/config";
import { FACTORY_ABI, NFT_ABI } from "@/abi";

const now = () => Math.floor(Date.now() / 1000);

function relativeTime(ts: bigint) {
  const secs = Number(ts) - now();
  if (secs < 0) return "Ended";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

const resolveGatewayUrl = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    if (url.includes(".4everland.store")) return url.replace("ipfs://", "https://");
    return url.replace("ipfs://", "https://cloudflare-ipfs.com/ipfs/");
  }
  if (url.startsWith("ar://")) return url.replace("ar://", "https://arweave.net/");
  return url;
};

export function GameCard({ address }: { address: string }) {
  const [, setTick] = useState(0);
  const [artworkUrl, setArtworkUrl] = useState("");
  const chainId = useChainId();
  useEffect(() => {
    const t = setInterval(() => setTick((p) => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: results } = useReadContracts({
    contracts: [
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "totalSupply" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "mintPrice" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "mintCloseTime" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "aliveCount" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "gameFinished" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "prizePool" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "mintingOpen" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "name" },
      { address: address as `0x${string}`, abi: NFT_ABI, functionName: "artworkURI" },
    ],
    query: { refetchInterval: 10000 },
  });

  const supply      = results?.[0]?.result as bigint | undefined;
  const price       = results?.[1]?.result as bigint | undefined;
  const closeTime   = results?.[2]?.result as bigint | undefined;
  const alive       = results?.[3]?.result as bigint | undefined;
  const finished    = results?.[4]?.result as boolean | undefined;
  const pool        = results?.[5]?.result as bigint | undefined;
  const mintingOpen = results?.[6]?.result as boolean | undefined;
  const gameName    = results?.[7]?.result as string | undefined;
  const artworkURI  = results?.[8]?.result as string | undefined;

  // Resolve artwork
  useEffect(() => {
    if (!artworkURI) return;
    const url = resolveGatewayUrl(artworkURI);
    (async () => {
      try {
        const r = await fetch(url);
        const j = await r.json();
        setArtworkUrl(resolveGatewayUrl(j.image || url));
      } catch {
        setArtworkUrl(url);
      }
    })();
  }, [artworkURI]);

  const phase = finished ? "Finished" : mintingOpen ? "Minting" : alive !== undefined && alive > 0n ? "Arena" : "Pending";
  const phaseColor = finished ? "var(--gold)" : mintingOpen ? "var(--green)" : alive !== undefined && alive > 0n ? "var(--red)" : "var(--text-muted)";

  return (
    <div
      className="nft-card"
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Artwork */}
      <div style={{ aspectRatio: "1", background: "var(--bg-card-2)", overflow: "hidden", position: "relative" }}>
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt={gameName || "Game artwork"}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loading="lazy"
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              No artwork
            </span>
          </div>
        )}
        {/* Phase badge overlay */}
        <div style={{
          position: "absolute",
          top: 8,
          right: 8,
          padding: "3px 8px",
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(4px)",
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: phaseColor,
          border: `1px solid ${phaseColor}`,
        }}>
          {phase}
          {closeTime && !finished && (
            <span style={{ marginLeft: 6, color: "var(--text-muted)" }}>
              {relativeTime(closeTime)}
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Name + address */}
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "-0.02em", marginBottom: 2 }}>
            {gameName || "Untitled"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.08em" }}>
              <a href={getExplorerUrl(address, chainId)} target="_blank" rel="noopener noreferrer" className="address-link" onClick={(e) => e.stopPropagation()}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </a>
            </span>
            <button
              onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(address); }}
              style={{ cursor: "pointer", background: "none", border: "none", color: "var(--text-muted)", padding: 0, lineHeight: 1 }}
              title="Copy Address"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 2 }}>
          {[
            { label: "Minted", value: supply?.toString() ?? "—" },
            { label: "Pool", value: pool !== undefined ? `${Number(formatEther(pool)).toFixed(3)}` : "—" },
            { label: "Price", value: price !== undefined ? `${Number(formatEther(price)).toFixed(4)}` : "—" },
            { label: "Alive", value: alive?.toString() ?? "—", color: "var(--green)" },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: s.color || "var(--text-primary)" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          <Link href={`/mint/${address}`} className="btn btn-outline" style={{ flex: 1, textAlign: "center", fontSize: 9, padding: "7px 0" }}>
            Mint
          </Link>
          <Link href={`/arena/${address}`} className="btn btn-primary" style={{ flex: 1, textAlign: "center", fontSize: 9, padding: "7px 0" }}>
            Arena
          </Link>
          <Link href={`/claim/${address}`} className="btn btn-outline" style={{ flex: 1, textAlign: "center", fontSize: 9, padding: "7px 0" }}>
            Claim
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function HomeGallery() {
  const { data: gamesData } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getGames",
  });

  const games = (gamesData as string[]) || [];

  return (
    <div className="page-root" style={{ padding: "64px 40px" }}>
      <div style={{ marginBottom: 40, textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-sans)", fontSize: 32, letterSpacing: "-0.04em", fontWeight: 700 }}>
          ed4ns Explorer
        </h1>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
          {games.length} active survival games deployed
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 16,
        maxWidth: 1200,
        margin: "0 auto"
      }}>
        {games.length === 0 ? (
          <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "64px 0", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase" }}>
            No games found
          </div>
        ) : (
          [...games].reverse().map((g) => <GameCard key={g} address={g} />)
        )}
      </div>
    </div>
  );
}
