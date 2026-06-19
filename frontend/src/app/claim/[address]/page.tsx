"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { formatEther } from "viem";
import Link from "next/link";
import { NFT_ABI } from "@/abi";
import { computeAllStatuses } from "@/lib/gameEngine";
import { getExplorerUrl, nativeToken } from "@/config";

interface WinningToken {
  id: number;
  claimed: boolean;
}

import { use } from "react";

export default function Page({ params, searchParams }: { params: Promise<{ address: string }>, searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { address: _nftAddr } = use(params);
  const NFT_ADDRESS = _nftAddr as `0x${string}`;
  const unwrappedSearchParams = use(searchParams);
  const { address: userAddress } = useAccount();
  const walletChainId = useChainId();
  const chainId = unwrappedSearchParams.chainId ? Number(unwrappedSearchParams.chainId) : walletChainId;
  const { switchChainAsync } = useSwitchChain();
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const [manualTokenId, setManualTokenId] = useState("");
  const [isManualLoading, setIsManualLoading] = useState(false);
  const publicClient = usePublicClient();

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
    chainId,
    query: { refetchInterval: 5000 },
  });

  const { data: prizePerWinner } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "prizePerWinner",
    chainId,
    query: { refetchInterval: 5000 },
  });

  const { data: gameFinished } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "gameFinished",
    chainId,
    query: { refetchInterval: 5000 },
  });

  const { data: startTokenId } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "startTokenId",
    chainId,
  });

  const { data: endTokenId } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "endTokenId",
    chainId,
  });

  const { data: mintingOpen } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "mintingOpen",
    chainId,
  });

  const { data: totalSupply } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "totalSupply",
    chainId,
    query: { refetchInterval: 5000 },
  });

  const { data: aliveCount } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "aliveCount",
    chainId,
    query: { refetchInterval: 5000 },
  });

  const { data: roundCount } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "roundCount",
    chainId,
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
      chainId,
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
    chainId,
  }));

  const { data: ownerResults, isLoading: isOwnersLoading, refetch: refetchOwners } = useReadContracts({
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
      chainId,
    });
    stateContracts.push({
      address: NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: "prizeClaimed",
      args: [BigInt(id)],
      chainId,
    });
  });

  const { data: stateResults, isLoading: isStateLoading, refetch: refetchState } = useReadContracts({
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

  const checkNetwork = async () => {
    if (walletChainId !== chainId) {
      if (switchChainAsync) {
        try {
          addToast("Switching network...", "info");
          await switchChainAsync({ chainId });
          return true;
        } catch (e: any) {
          addToast("Failed to switch network", "error");
          return false;
        }
      } else {
        addToast("Please switch network in your wallet", "error");
        return false;
      }
    }
    return true;
  };

  const handleClaim = async (tokenId: number) => {
    if (!(await checkNetwork())) return;
    try {
      addToast(`Claiming #${tokenId}…`, "info");
      const hash = await writeContractAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "claimPrize",
        args: [BigInt(tokenId)],
      });
      addToast(`Tx broadcasted: ${hash.slice(0, 10)}…`, "info");
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
        refetchState();
        refetchOwners();
      }
      addToast(`Claimed! tx: ${hash.slice(0, 10)}…`, "success");
    } catch (e: any) {
      addToast(e.shortMessage || "Claim failed", "error");
    }
  };

  const handleManualClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTokenId) return;
    if (!(await checkNetwork())) return;
    try {
      setIsManualLoading(true);
      addToast(`Claiming #${manualTokenId}…`, "info");
      const hash = await writeContractAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "claimPrize",
        args: [BigInt(Number(manualTokenId))],
      });
      addToast(`Tx broadcasted: ${hash.slice(0, 10)}…`, "info");
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
        refetchState();
        refetchOwners();
      }
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
      <div className="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Link href={`/arena/${NFT_ADDRESS}?chainId=${chainId}`}>Arena</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Claim</span>
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
          <span className="stat-label">Prize Pool</span>
          <span className="stat-value">{formatEth(prizePool as bigint | undefined)}</span>
          <span className="stat-unit">{nativeToken(chainId)} total</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Prize / Winner</span>
          <span className="stat-value">{formatEth(prizePerWinner as bigint | undefined)}</span>
          <span className="stat-unit">{nativeToken(chainId)} each</span>
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
                          {formatEth(prizePerWinner as bigint | undefined)} {nativeToken(chainId)}
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
                            disabled={!gameFinished && walletChainId === chainId}
                          >
                            {walletChainId !== chainId ? `Switch to ${chainId === 42220 ? "Celo" : "Base"}` : "Claim"}
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
                disabled={(!manualTokenId && walletChainId === chainId) || isManualLoading || !userAddress || (!gameFinished && walletChainId === chainId)}
              >
                {!userAddress ? "Connect Wallet" : walletChainId !== chainId ? `Switch to ${chainId === 42220 ? "Celo" : "Base"}` : isManualLoading ? "Submitting…" : "Claim Prize"}
              </button>
            </form>
          </div>

          {/* Info rows */}
          <div className="sidebar-row">
            <span className="sidebar-label">Total Pool</span>
            <span className="sidebar-value">{formatEth(prizePool as bigint | undefined)} {nativeToken(chainId)}</span>
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
