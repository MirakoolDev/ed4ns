"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { FACTORY_ADDRESS, FACTORY_ADDRESS_V2, STANDALONE_GAMES, getExplorerUrl } from "@/config";
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

export function GameCard({ address, version }: { address: string; version: string }) {
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

  const supply = results?.[0]?.result as bigint | undefined;
  const price = results?.[1]?.result as bigint | undefined;
  const closeTime = results?.[2]?.result as bigint | undefined;
  const alive = results?.[3]?.result as bigint | undefined;
  const finished = results?.[4]?.result as boolean | undefined;
  const pool = results?.[5]?.result as bigint | undefined;
  const mintingOpen = results?.[6]?.result as boolean | undefined;
  const gameName = results?.[7]?.result as string | undefined;
  const artworkURI = results?.[8]?.result as string | undefined;

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
        {/* Version Badge */}
        <div style={{
          position: "absolute",
          top: 8,
          left: 8,
          background: "rgba(0,0,0,0.6)",
          color: "white",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 8,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          zIndex: 10,
          backdropFilter: "blur(4px)",
        }}>
          {version}
        </div>
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
  const { data: gamesDataV1 } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getGames",
  });

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

  const allGames = [
    ...gamesV1.map(addr => ({ address: addr, version: "V1" })),
    ...gamesV2.map(addr => ({ address: addr, version: "V2" })),
    ...(STANDALONE_GAMES || []).map(addr => ({ address: addr, version: "V2-SeaDrop" }))
  ];

  return (
    <div className="page-root">
      {/* ── Hero Section ── */}
      <section className="hero-section">
        <div className="hero-inner">
          <div className="hero-eyebrow">On-Chain Survival Game</div>
          <h1 className="hero-title">ed4ns</h1>
          <p className="hero-subtitle">
            An open-edition NFT survival game. Fully on-chain.
            Mint a token. Cuts happen every round. The final 4 share the prize pool.
          </p>

          <div className="hero-steps">
            <div className="hero-step">
              <div className="hero-step-num">01</div>
              <div className="hero-step-label">Mint</div>
              <div className="hero-step-desc">Mint during the open edition window. Your ETH funds the prize pool.</div>
            </div>
            <div className="hero-step-divider" />
            <div className="hero-step">
              <div className="hero-step-num">02</div>
              <div className="hero-step-label">Survive</div>
              <div className="hero-step-desc">Each round, ~half the tokens are eliminated using on-chain randomness.</div>
            </div>
            <div className="hero-step-divider" />
            <div className="hero-step">
              <div className="hero-step-num">03</div>
              <div className="hero-step-label">Win</div>
              <div className="hero-step-desc">The last 4 survivors split the entire prize pool. Claim directly on-chain.</div>
            </div>
          </div>

          <div className="hero-actions">
            <Link href="/how-to-play" className="btn btn-primary btn-large">How It Works</Link>
            <Link href="/arena" className="btn btn-outline btn-large">
              Enter Arena
            </Link>
          </div>

          <div className="hero-trust">
            <div className="hero-trust-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              Verified on Basescan
            </div>
            <div className="hero-trust-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" /></svg>
              Open Source
            </div>
            <div className="hero-trust-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
              Fully On-Chain
            </div>
          </div>
        </div>
      </section>

      {/* ── Explorer Section ── */}
      <section style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ padding: "32px 40px" }}>
          <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-primary)" }}>
                Active Games
              </h2>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 4, letterSpacing: "0.08em" }}>
                {allGames.length} survival game{allGames.length !== 1 ? "s" : ""} deployed
              </p>
            </div>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
            maxWidth: 1200,
            margin: "0 auto"
          }}>
            {allGames.length === 0 ? (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "64px 0", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase" }}>
                No games found — deploy one from the Launch page
              </div>
            ) : (
              allGames.map((g, i) => <GameCard key={i} address={g.address} version={g.version} />)
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="footer-logo">ed4ns</span>
            <span className="footer-tagline">On-chain NFT survival game on Base</span>
          </div>
          <div className="footer-links">
            <a href="https://x.com/MiracleOtugo" target="_blank" rel="noopener noreferrer" className="footer-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              Twitter
            </a>
            <a href="https://miracleotugo.art" target="_blank" rel="noopener noreferrer" className="footer-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
              Website
            </a>
            <a href="https://github.com/MirakoolDev/ed4ns" target="_blank" rel="noopener noreferrer" className="footer-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
              GitHub
            </a>
          </div>
          <div className="footer-copy">
            Built by <a href="https://miracleotugo.art" target="_blank" rel="noopener noreferrer">Miracle Otugo</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
