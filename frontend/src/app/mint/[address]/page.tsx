"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { NFT_ABI } from "@/abi";
import { GameSummary } from "@/components/GameSummary";
import { formatEther } from "viem";
import { getExplorerUrl, STANDALONE_GAMES, nativeToken } from "@/config";

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

interface MintEvent {
  address: string;
  qty: number;
  tokenId: number;
  blockAgo: number;
}

export default function Page({ params, searchParams }: { params: Promise<{ address: string }>, searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { address: NFT_ADDRESS } = use(params);
  const unwrappedSearchParams = use(searchParams);
  const { address: userAddress } = useAccount();
  const walletChainId = useChainId();
  const chainId = unwrappedSearchParams.chainId ? Number(unwrappedSearchParams.chainId) : walletChainId;
  const { switchChainAsync } = useSwitchChain();

  // Dynamic OpenSea Redirect for standalone drops
  useEffect(() => {
    if (STANDALONE_GAMES.includes(NFT_ADDRESS)) {
      const slug = localStorage.getItem(`opensea_slug_${NFT_ADDRESS}`);
      if (slug) {
        window.location.href = `https://opensea.io/collection/${slug}/overview`;
        return;
      }
      fetch(`/api/opensea-slug?address=${NFT_ADDRESS}&chainId=${chainId || 8453}`)
        .then(res => res.json())
        .then(data => {
          if (data.slug) {
            window.location.href = `https://opensea.io/collection/${data.slug}/overview`;
          } else {
            window.location.href = `https://opensea.io/assets?search[query]=${NFT_ADDRESS}`;
          }
        }).catch(() => {
          window.location.href = `https://opensea.io/assets?search[query]=${NFT_ADDRESS}`;
        });
    }
  }, [NFT_ADDRESS, chainId]);

  if (STANDALONE_GAMES.includes(NFT_ADDRESS)) {
    return (
      <div className="page-root" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <div className="spinner" />
        <span style={{ marginLeft: 16, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>Redirecting to OpenSea...</span>
      </div>
    );
  }

  const [qty, setQty] = useState(1);
  const [isMinting, setIsMinting] = useState(false);
  const [mintTxHash, setMintTxHash] = useState<`0x${string}` | undefined>();
  const [artworkUrl, setArtworkUrl] = useState("");
  const [toasts, setToasts] = useState<
    { id: number; msg: string; type: string }[]
  >([]);

  const addToast = (msg: string, type = "info") => {
    const id = Date.now();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4500);
  };

  // Contract reads
  const { data: results, refetch: refetchSupply } = useReadContracts({
    contracts: [
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "name", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "collectionDescription", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "artworkURI", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "mintPrice", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "mintOpenTime", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "mintCloseTime", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "totalSupply", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "artistSharePercent", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "prizePoolSharePercent", chainId },
      { address: NFT_ADDRESS as `0x${string}`, abi: NFT_ABI, functionName: "prizePool", chainId },
    ],
    query: { refetchInterval: 5000 },
  });

  const name = results?.[0]?.result as string | undefined;
  const desc = results?.[1]?.result as string | undefined;
  const artworkURI = results?.[2]?.result as string | undefined;
  const mintPrice = results?.[3]?.result as bigint | undefined;
  const mintOpenTime = results?.[4]?.result as bigint | undefined;
  const mintCloseTime = results?.[5]?.result as bigint | undefined;
  const totalSupply = results?.[6]?.result as bigint | undefined;
  const artistShare = results?.[7]?.result as bigint | undefined;
  const poolShare = results?.[8]?.result as bigint | undefined;
  const prizePool = results?.[9]?.result as bigint | undefined;

  // Resolve artwork
  useEffect(() => {
    if (!artworkURI) return;
    setArtworkUrl(resolveGatewayUrl(artworkURI as string));
  }, [artworkURI]);

  // Live countdown hook
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((p) => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Math.floor(Date.now() / 1000);
  const isOpen =
    mintOpenTime && mintCloseTime
      ? now >= Number(mintOpenTime) && now <= Number(mintCloseTime)
      : false;
  
  const hasEnded = mintCloseTime ? now > Number(mintCloseTime) : false;

  const formatTime = (ts: bigint | undefined) => {
    if (!ts) return "—";
    return new Date(Number(ts) * 1000).toLocaleString();
  };

  const relativeTime = (ts: bigint | undefined) => {
    if (!ts) return "";
    const secs = Number(ts) - now;
    if (secs < 0) return "Ended";
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
    return `${Math.floor(secs / 86400)}d`;
  };

  // Mint tx
  const { writeContractAsync } = useWriteContract();
  const { isLoading: isMiningMint, isSuccess: isMintDone } =
    useWaitForTransactionReceipt({ hash: mintTxHash });

  useEffect(() => {
    if (isMintDone) {
      addToast("Minted successfully!", "success");
      setIsMinting(false);
      setMintTxHash(undefined);
      refetchSupply();
    }
  }, [isMintDone]);

  const handleMint = async () => {
    if (!mintPrice || !userAddress) return;
    if (walletChainId !== chainId) {
      if (switchChainAsync) {
        try {
          addToast("Switching network...", "info");
          await switchChainAsync({ chainId });
        } catch (e: any) {
          addToast("Failed to switch network", "error");
          return;
        }
      } else {
        addToast("Please switch network in your wallet", "error");
        return;
      }
    }
    try {
      setIsMinting(true);
      addToast(`Minting ${qty} token${qty > 1 ? "s" : ""}…`, "info");
      const hash = await writeContractAsync({
        address: NFT_ADDRESS as `0x${string}`,
        abi: NFT_ABI,
        functionName: "mint",
        args: [BigInt(qty)],
        value: (mintPrice as bigint) * BigInt(qty),
      });
      setMintTxHash(hash);
      addToast(`Tx broadcast: ${hash.slice(0, 10)}…`, "info");
    } catch (e: any) {
      addToast(e.shortMessage || e.message || "Mint failed", "error");
      setIsMinting(false);
    }
  };

  const priceEth = mintPrice !== undefined
    ? Number(formatEther(mintPrice as bigint)).toString()
    : "0.01";
  const totalEth = mintPrice !== undefined
    ? Number(formatEther((mintPrice as bigint) * BigInt(qty))).toString()
    : (0.01 * qty).toString();

  // Simulated recent mints for demo
  const recentMints: MintEvent[] = [];

  return (
    <div className="page-root">
      {/* Breadcrumb */}
      <div className="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Link href={`/arena/${NFT_ADDRESS}?chainId=${chainId}`}>Arena</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Mint</span>
        {totalSupply !== undefined && (
          <>
            <span className="breadcrumb-sep">/</span>
            <span style={{ color: "var(--text-primary)" }}>
              #{totalSupply.toString()} minted
            </span>
          </>
        )}
        <div style={{
          background: chainId === 42220 ? "rgba(252,255,82,0.9)" : "rgba(0,82,255,0.9)",
          color: chainId === 42220 ? "black" : "white",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 8,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          marginLeft: "auto"
        }}>
          {chainId === 42220 ? "CELO" : "BASE"}
        </div>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-cell">
          <span className="stat-label">Mint Price</span>
          <span className="stat-value">{priceEth}</span>
          <span className="stat-unit">{nativeToken(chainId)} on {chainId === 42220 ? "Celo" : "Base"}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Total Minted</span>
          <span className="stat-value">
            {totalSupply?.toString() ?? "—"}
          </span>
          <span className="stat-unit">Tokens</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Prize Pool</span>
          <span className="stat-value">
            {prizePool ? Number(formatEther(prizePool as bigint)).toFixed(3) : "0.000"}
          </span>
          <span className="stat-unit">{nativeToken(chainId)} on {chainId === 42220 ? "Celo" : "Base"}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Payout Split</span>
          <span className="stat-value">{artistShare?.toString() || "50"} / {poolShare?.toString() || "50"}</span>
          <span className="stat-unit">Artist / Pool</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">
            {hasEnded ? "Ended At" : isOpen ? "Closes At" : "Opens At"}
          </span>
          <span className="stat-value" style={{ fontSize: 12 }}>
            {hasEnded || isOpen ? formatTime(mintCloseTime) : formatTime(mintOpenTime)}
          </span>
          <span className="stat-unit">Your time zone</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Status</span>
          <span
            className="stat-value"
            style={{
              color: hasEnded ? "var(--red)" : isOpen ? "var(--green)" : "var(--text-primary)",
              fontSize: 14,
            }}
          >
            {hasEnded ? "Ended" : isOpen ? relativeTime(mintCloseTime) : `Starts in ${relativeTime(mintOpenTime)}`}
          </span>
          <span className="stat-unit">Mint window</span>
        </div>
      </div>

      {/* Main split layout */}
      <div className="mint-layout">
        {/* Artwork Preview */}
        <div className="mint-preview">
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt="ed4ns artwork"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                maxHeight: "100vh",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                color: "var(--text-muted)",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div className="spinner" />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                Loading artwork…
              </span>
            </div>
          )}
        </div>

        {/* Mint panel */}
        <div className="mint-panel">
          {/* Title block */}
          <div className="mint-panel-section">
            <div className="mint-title">{name || "Loading..."}</div>
            <div className="mint-subtitle">{desc || "—"}</div>
          </div>

          {/* Mint controls */}
          <div className="mint-panel-section">
            <div className="mint-row">
              <span className="mint-row-label">Mint Price</span>
              <span className="mint-row-value">{priceEth} {nativeToken(chainId)}</span>
            </div>
            <div className="mint-row">
              <span className="mint-row-label">Quantity</span>
              <div className="qty-control">
                <button
                  className="qty-btn"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1 || isMinting || isMiningMint || hasEnded}
                >
                  −
                </button>
                <input
                  type="number"
                  className="qty-value"
                  value={qty}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1) setQty(val);
                  }}
                  style={{ 
                    width: "40px", 
                    textAlign: "center", 
                    background: "none", 
                    border: "none", 
                    color: "var(--text-primary)", 
                    fontFamily: "var(--font-mono)", 
                    fontSize: "14px",
                    fontWeight: 700,
                    outline: "none"
                  }}
                  disabled={isMinting || isMiningMint || hasEnded}
                />
                <button
                  className="qty-btn"
                  onClick={() => setQty((q) => q + 1)}
                  disabled={isMinting || isMiningMint || hasEnded}
                >
                  +
                </button>
              </div>
            </div>
            <div className="mint-row" style={{ borderTop: "1px solid var(--border)" }}>
              <span
                className="mint-row-label"
                style={{ color: "var(--text-primary)", fontWeight: 700 }}
              >
                Total
              </span>
              <span
                className="mint-row-value"
                style={{ fontSize: 18 }}
              >
                {totalEth} {nativeToken(chainId)}
              </span>
            </div>

            <button
              className="btn btn-primary btn-large"
              style={{ width: "100%", marginTop: 16 }}
              onClick={handleMint}
              disabled={!userAddress || !isOpen || isMinting || isMiningMint}
            >
              {!userAddress
                ? "Connect Wallet"
                : walletChainId !== chainId
                ? `Switch to ${chainId === 42220 ? "Celo" : "Base"}`
                : hasEnded
                ? "Mint Closed"
                : !isOpen
                ? "Starting Soon…"
                : isMiningMint
                ? "Confirming…"
                : isMinting
                ? "Broadcasting…"
                : `Mint ${qty > 1 ? `${qty} Tokens` : "Token"}`}
            </button>

            {!userAddress && (
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--text-muted)",
                  textAlign: "center",
                  marginTop: 8,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Connect wallet to mint
              </p>
            )}
          </div>

          {/* Info rows */}
          <div className="mint-panel-section">
            <div className="mint-row">
              <span className="mint-row-label">Pool split</span>
              <span className="mint-row-value" style={{ fontSize: 11 }}>
                {artistShare?.toString() || "50"}% artist · {poolShare?.toString() || "50"}% prize pool
              </span>
            </div>
            <div className="mint-row">
              <span className="mint-row-label">Contract</span>
              <span
                className="mint-row-value"
                style={{ fontSize: 10, color: "var(--text-muted)" }}
              >
                <a href={getExplorerUrl(NFT_ADDRESS, chainId)} target="_blank" rel="noopener noreferrer" className="address-link">
                  {NFT_ADDRESS.slice(0, 6)}…{NFT_ADDRESS.slice(-4)}
                </a>
              </span>
            </div>
            <div className="mint-row">
              <span className="mint-row-label">Winners</span>
              <span className="mint-row-value" style={{ fontSize: 11 }}>
                Final 4 share the pool
              </span>
            </div>
          </div>

          {/* Recent mints table */}
          <div className="mint-panel-section" style={{ flex: 1, overflow: "auto" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: 12,
              }}
            >
              Recent Mints
            </div>
            {recentMints.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, textAlign: "center", padding: "24px 0" }}>
                No mints yet
              </div>
            ) : (
              <table className="recent-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Qty</th>
                    <th>Block</th>
                  </tr>
                </thead>
                <tbody>
                  {recentMints.map((m, i) => (
                    <tr key={i}>
                      <td>
                        <span className="recent-addr">
                          <a href={getExplorerUrl(m.address, chainId)} target="_blank" rel="noopener noreferrer" className="address-link">
                            {m.address.slice(0, 6)}…{m.address.slice(-4)}
                          </a>
                        </span>
                      </td>
                      <td>{m.qty}×</td>
                      <td>{m.blockAgo} blocks ago</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "48px 16px" }}>
        <GameSummary />
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
