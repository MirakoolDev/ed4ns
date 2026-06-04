"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useChainId,
} from "wagmi";
import { formatEther } from "viem";
import Link from "next/link";
import { NFT_ABI } from "@/abi";
import { computeAllStatuses } from "@/lib/gameEngine";
import { getExplorerUrl } from "@/config";

interface WinningToken {
  id: number;
  claimed: boolean;
}

import { use } from "react";

export default function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address: _nftAddr } = use(params);
  const NFT_ADDRESS = _nftAddr as `0x${string}`;
  const { address: userAddress } = useAccount();
  const chainId = useChainId();
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const [manualTokenId, setManualTokenId] = useState("");
  const [isManualLoading, setIsManualLoading] = useState(false);

  const addToast = (msg: string, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4500);
  };

  // ── Global contract reads ────────────────────────────────────────────────
  const { data: prizePool } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "prizePool",
    query: { refetchInterval: 5000 },
  });

  const { data: prizePerWinner } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "prizePerWinner",
    query: { refetchInterval: 5000 },
  });

  const { data: gameFinished } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "gameFinished",
    query: { refetchInterval: 5000 },
  });

  const { data: startTokenId } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "startTokenId",
  });

  const { data: endTokenId } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "endTokenId",
  });

  const { data: mintingOpen } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "mintingOpen",
  });

  const { data: totalSupply } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "totalSupply",
    query: { refetchInterval: 5000 },
  });

  const { data: aliveCount } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "aliveCount",
    query: { refetchInterval: 5000 },
  });

  const { data: roundCount } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "roundCount",
    query: { refetchInterval: 15000, staleTime: 10000 },
  });

  // ── Use local game engine instead of scanning every token ────────────────
  const startId = Number(startTokenId || 1n);
  const endId = Number(endTokenId || 0n);
  const totalCount = mintingOpen
    ? Number(totalSupply || 0n)
    : endId >= startId
    ? endId - startId + 1
    : 0;

  // Fetch round seeds (tiny: 1 call per round played, cached forever)
  const roundSeedContracts = Array.from(
    { length: Number(roundCount || 0) },
    (_, i) => ({
      address: NFT_ADDRESS as `0x${string}`,
      abi: NFT_ABI,
      functionName: "getRoundSeed" as const,
      args: [BigInt(i)],
    })
  );

  const { data: roundSeedResults } = useReadContracts({
    contracts: roundSeedContracts,
    query: { enabled: Number(roundCount || 0) > 0, staleTime: Infinity, gcTime: Infinity },
  });

  const roundSeeds: bigint[] = (roundSeedResults || []).map(
    (r) => (r?.result as bigint) ?? 0n
  );

  // Compute alive status locally — zero RPC calls per token
  const count = Number(roundCount || 0);
  const canCompute = totalCount > 0 && (count === 0 || roundSeeds.length >= count);
  const statusMap = canCompute
    ? computeAllStatuses(totalCount, roundSeeds, count)
    : {};

  // Winner token IDs (only alive tokens at game end)
  const winnerTokenIds = gameFinished
    ? Array.from({ length: totalCount }, (_, i) => startId + i).filter(
        (id) => statusMap[id] === "alive"
      )
    : [];

  // Only fetch ownerOf for winner tokens (typically just 4, not 100k)
  const ownerContracts = winnerTokenIds.map((id) => ({
    address: NFT_ADDRESS as `0x${string}`,
    abi: NFT_ABI,
    functionName: "ownerOf" as const,
    args: [BigInt(id)],
  }));

  const { data: ownerResults, isLoading: isOwnersLoading } = useReadContracts({
    contracts: ownerContracts,
    query: { enabled: winnerTokenIds.length > 0 && !!userAddress, staleTime: 30000 },
  });

  const ownedTokenIds: number[] = [];
  if (ownerResults && userAddress) {
    const low = userAddress.toLowerCase();
    ownerResults.forEach((r, i) => {
      if ((r?.result as string)?.toLowerCase() === low)
        ownedTokenIds.push(winnerTokenIds[i]);
    });
  }

  // ── Fetch alive + claimed state for owned tokens ─────────────────────────
  const stateContracts: any[] = [];
  ownedTokenIds.forEach((id) => {
    stateContracts.push({
      address: NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: "isTokenAlive",
      args: [BigInt(id)],
    });
    stateContracts.push({
      address: NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: "prizeClaimed",
      args: [BigInt(id)],
    });
  });

  const { data: stateResults, isLoading: isStateLoading } = useReadContracts({
    contracts: stateContracts,
    query: { enabled: ownedTokenIds.length > 0 },
  });

  const myWinners: WinningToken[] = [];
  if (stateResults) {
    ownedTokenIds.forEach((id, i) => {
      const isAlive = stateResults[i * 2]?.result as boolean;
      const claimed = stateResults[i * 2 + 1]?.result as boolean;
      if (isAlive) myWinners.push({ id, claimed });
    });
  }

  // ── Write ────────────────────────────────────────────────────────────────
  const { writeContractAsync } = useWriteContract();

  const handleClaim = async (tokenId: number) => {
    try {
      addToast(`Claiming #${tokenId}…`, "info");
      const hash = await writeContractAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "claimPrize",
        args: [BigInt(tokenId)],
      });
      addToast(`Claimed! tx: ${hash.slice(0, 10)}…`, "success");
    } catch (e: any) {
      addToast(e.shortMessage || "Claim failed", "error");
    }
  };

  const handleManualClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTokenId) return;
    try {
      setIsManualLoading(true);
      addToast(`Claiming #${manualTokenId}…`, "info");
      const hash = await writeContractAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "claimPrize",
        args: [BigInt(Number(manualTokenId))],
      });
      addToast(`Claimed! tx: ${hash.slice(0, 10)}…`, "success");
      setManualTokenId("");
    } catch (e: any) {
      addToast(e.shortMessage || "Claim failed", "error");
    } finally {
      setIsManualLoading(false);
    }
  };

  const formatEth = (wei: bigint | undefined) =>
    wei !== undefined ? Number(formatEther(wei)).toFixed(4) : "—";

  const hasUnclaimed = myWinners.some((t) => !t.claimed);
  const isLoading = isOwnersLoading || isStateLoading;

  return (
    <div className="page-root">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href={`/arena/${NFT_ADDRESS}`}>Arena</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Claim</span>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-cell">
          <span className="stat-label">Prize Pool</span>
          <span className="stat-value">{formatEth(prizePool as bigint | undefined)}</span>
          <span className="stat-unit">ETH total</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Prize / Winner</span>
          <span className="stat-value">{formatEth(prizePerWinner as bigint | undefined)}</span>
          <span className="stat-unit">ETH each</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Survivors</span>
          <span className="stat-value stat-value--green">{aliveCount?.toString() ?? "—"}</span>
          <span className="stat-unit">Final count</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Your Winners</span>
          <span className="stat-value">{userAddress ? myWinners.length : "—"}</span>
          <span className="stat-unit">Claimable</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Game</span>
          <span
            className="stat-value"
            style={{
              fontSize: 14,
              color: gameFinished ? "var(--gold)" : "var(--text-muted)",
            }}
          >
            {gameFinished ? "Finished" : "Active"}
          </span>
          <span className="stat-unit">Status</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Claims</span>
          <span
            className="stat-value"
            style={{
              fontSize: 14,
              color: gameFinished ? "var(--green)" : "var(--red)",
            }}
          >
            {gameFinished ? "Open" : "Locked"}
          </span>
          <span className="stat-unit">Availability</span>
        </div>
      </div>

      {/* Not finished notice */}
      {!gameFinished && (
        <div
          style={{
            padding: "10px 16px",
            background: "var(--gold-bg)",
            borderBottom: "1px solid var(--gold-border)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--gold)",
            textAlign: "center",
          }}
        >
          Claims locked — game still in progress
        </div>
      )}

      {/* Split layout */}
      <div className="split-layout">
        {/* Main: wallet claims */}
        <div className="split-main">
          <div className="section-header">
            <span className="section-title">Wallet Claims</span>
            {hasUnclaimed && (
              <span className="action-badge badge-gold animate-pulse">Unclaimed</span>
            )}
          </div>

          {!userAddress ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                padding: "64px 16px",
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
              <p style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center" }}>
                Connect your wallet to scan for winning tokens.
              </p>
            </div>
          ) : isLoading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: "64px 16px",
              }}
            >
              <div className="spinner" />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Scanning…
              </span>
            </div>
          ) : myWinners.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                padding: "64px 16px",
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
                No winning tokens
              </p>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center", maxWidth: 360 }}>
                Your wallet doesn't hold any surviving tokens.
              </p>
              <Link href="/holdings" className="btn btn-outline">
                View Holdings
              </Link>
            </div>
          ) : (
            /* Winner token table */
            <>
              <table className="recent-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Prize</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {myWinners.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className="recent-addr">#{t.id}</span>
                      </td>
                      <td>
                        <span style={{ color: "var(--gold)", fontWeight: 700 }}>
                          {formatEth(prizePerWinner as bigint | undefined)} ETH
                        </span>
                      </td>
                      <td>
                        {t.claimed ? (
                          <span className="nft-status-pill pill-claimed">Claimed</span>
                        ) : (
                          <span className="nft-status-pill pill-winner">Winner</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {t.claimed ? (
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 9,
                              color: "var(--text-muted)",
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                            }}
                          >
                            Done
                          </span>
                        ) : (
                          <button
                            className="btn btn-primary"
                            style={{ padding: "6px 14px", fontSize: 9 }}
                            onClick={() => handleClaim(t.id)}
                            disabled={!gameFinished}
                          >
                            Claim
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

            </>
          )}
        </div>

        {/* Sidebar: manual claim + info */}
        <div className="split-sidebar">
          {/* Manual claim */}
          <div className="action-panel">
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Manual Claim
            </div>
            <p style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Enter a specific token ID to claim directly — useful for cold wallets or vaults.
            </p>
            <form
              onSubmit={handleManualClaim}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <input
                type="number"
                className="input"
                placeholder="Token ID (e.g. 42)"
                value={manualTokenId}
                onChange={(e) => setManualTokenId(e.target.value)}
                min="1"
              />
              <button
                type="submit"
                className="btn btn-primary btn-large"
                style={{ width: "100%" }}
                disabled={!manualTokenId || isManualLoading || !userAddress || !gameFinished}
              >
                {isManualLoading ? "Submitting…" : "Claim Prize"}
              </button>
            </form>
          </div>

          {/* Info rows */}
          <div className="sidebar-row">
            <span className="sidebar-label">Total Pool</span>
            <span className="sidebar-value">{formatEth(prizePool as bigint | undefined)} ETH</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-label">Winners share</span>
            <span className="sidebar-value">Equal split</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-label">Contract</span>
            <span className="sidebar-value" style={{ fontSize: 9 }}>
              <a href={getExplorerUrl(NFT_ADDRESS, chainId)} target="_blank" rel="noopener noreferrer" className="address-link">
                {NFT_ADDRESS.slice(0, 6)}…{NFT_ADDRESS.slice(-4)}
              </a>
            </span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-label">Total minted</span>
            <span className="sidebar-value">{totalSupply?.toString() ?? "—"}</span>
          </div>

          {/* Bottom spacer for theme toggle */}
          <div style={{ height: 48 }} />
        </div>
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
