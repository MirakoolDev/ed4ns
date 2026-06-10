"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useChainId,
} from "wagmi";
import { formatEther } from "viem";
import { FACTORY_ADDRESS, AUTHORIZED_CREATOR, getAlchemyUrl, getAlchemyNftUrl, getExplorerUrl } from "@/config";
import { NFT_ABI } from "@/abi";
import { GameSummary } from "@/components/GameSummary";
import { computeAllStatuses, type TokenStatusMap } from "@/lib/gameEngine";

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

interface TokenData {
  id: number;
  status: string;
  owner: string;
  imageUrl: string;
  round: number;
}

interface Toast {
  id: number;
  msg: string;
  type: string;
}

const PAGE_SIZE = 60;

const STATUS_PILL: Record<string, string> = {
  alive:      "pill-alive",
  eliminated: "pill-eliminated",
  winner:     "pill-winner",
  claimed:    "pill-claimed",
  pending:    "pill-pending",
};

const CARD_BORDER: Record<string, string> = {
  alive:    "2px solid var(--green)",
  winner:   "2px solid var(--text-primary)",
  claimed:  "2px solid var(--blue)",
};

export default function Page({ params }: { params: Promise<{ address: string }> }) {
  const unwrappedParams = use(params);
  const NFT_ADDRESS = unwrappedParams.address as `0x${string}`;
  const { address: userAddress } = useAccount();
  const chainId = useChainId();
  const [filter, setFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [statusMap, setStatusMap] = useState<TokenStatusMap>({});
  const [myTokenIds, setMyTokenIds] = useState<Set<number>>(new Set());
  const [resolvedArtwork, setResolvedArtwork] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activePlayers, setActivePlayers] = useState<number | null>(null);
  const [gridExpanded, setGridExpanded] = useState(false);
  const [claimedSet, setClaimedSet] = useState<Set<number>>(new Set());
  const [openseaSlug, setOpenseaSlug] = useState("");
  const [editingSlug, setEditingSlug] = useState(false);

  useEffect(() => {
    const slug = localStorage.getItem(`opensea_slug_${NFT_ADDRESS}`);
    if (slug) setOpenseaSlug(slug);
  }, [NFT_ADDRESS]);

  const saveSlug = (val: string) => {
    setOpenseaSlug(val);
    localStorage.setItem(`opensea_slug_${NFT_ADDRESS}`, val);
    setEditingSlug(false);
  };

  const publicClient = usePublicClient();

  // Admin state
  const [artworkInput, setArtworkInput] = useState("");
  const [isSubmittingCut, setIsSubmittingCut] = useState(false);
  const [cutTxHash, setCutTxHash] = useState<`0x${string}` | undefined>();
  const [revealTxHash, setRevealTxHash] = useState<`0x${string}` | undefined>();
  const [isSubmittingReveal, setIsSubmittingReveal] = useState(false);

  const addToast = (msg: string, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4500);
  };

  // ── Contract reads ────────────────────────────────────────────────────────
  const { data: artistAddress } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "artist",
  });

  const { data: prizePool } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "prizePool",
    query: { refetchInterval: 4000 },
  });

  const { data: aliveCount } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "aliveCount",
    query: { refetchInterval: 4000 },
  });

  const { data: roundCount } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "roundCount",
    query: { refetchInterval: 15000, staleTime: 10000 },
  });

  const { data: gameFinished } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "gameFinished",
    query: { refetchInterval: 15000, staleTime: 10000 },
  });

  const { data: gameInitialized } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "gameInitialized",
    query: { refetchInterval: 15000, staleTime: 10000 },
  });

  const { data: mintingOpen } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "mintingOpen",
    query: { refetchInterval: 4000 },
  });

  const { data: mintOpenTime } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "mintOpenTime",
  });

  const { data: mintCloseTime } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "mintCloseTime",
  });

  const { data: cutPending } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "cutPending",
    query: { refetchInterval: 4000 },
  });

  const { data: lastCutTimestamp } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "lastCutTimestamp",
    query: { refetchInterval: 10000 },
  });

  const [secs, setSecs] = useState<number | null>(null);

  const { data: minCutInterval } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "minCutInterval",
  });

  useEffect(() => {
    if (minCutInterval === undefined || lastCutTimestamp === undefined) {
      setSecs(null);
      return;
    }
    
    // If the game hasn't started yet (lastCutTimestamp is 0), we don't have a countdown.
    if (lastCutTimestamp === 0n) {
      setSecs(null);
      return;
    }

    const intervalId = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const target = Number(lastCutTimestamp) + Number(minCutInterval);
      const diff = target - now;
      setSecs(diff > 0 ? diff : 0);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [minCutInterval, lastCutTimestamp]);

  const { data: contractPrizePerWinner } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "prizePerWinner",
    query: { refetchInterval: 4000 },
  });

  const { data: totalSupply } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "totalSupply",
    query: { refetchInterval: 20000, staleTime: 15000 },
  });

  const expectedWinners = Math.max(1, Math.min(Number(totalSupply || 0n), 4));
  const prizePerWinner = gameFinished
    ? (contractPrizePerWinner as bigint | undefined)
    : (prizePool as bigint | undefined)
    ? (prizePool as bigint) / BigInt(expectedWinners)
    : 0n;

  // Fetch unique active players
  useEffect(() => {
    const fetchPlayers = async () => {
      const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
      if (alchemyKey && userAddress) {
        try {
          const res = await fetch(
            `${getAlchemyNftUrl(alchemyKey, chainId)}/getOwnersForContract?contractAddress=${NFT_ADDRESS}`
          );
          const json = await res.json();
          if (json.owners) setActivePlayers(json.owners.length);
        } catch (e) {
          // ignore
        }
      }
    };
    fetchPlayers();
    const intervalId = setInterval(fetchPlayers, 60000);
    return () => clearInterval(intervalId);
  }, [NFT_ADDRESS, userAddress, chainId]);

  const { data: existingArtworkURI } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "artworkURI",
    query: { staleTime: 60000 },
  });

  const { data: startTokenId } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "startTokenId",
    query: { staleTime: Infinity },
  });

  const { data: endTokenId } = useReadContract({
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    functionName: "endTokenId",
    query: { refetchInterval: 20000, staleTime: 15000 },
  });

  // Fetch round seeds — just 1 call per round ever played (typically 0-15 total)
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
    // Seeds are immutable once set — cache forever
    query: { enabled: Number(roundCount || 0) > 0, staleTime: Infinity, gcTime: Infinity },
  });

  const roundSeeds: bigint[] = (roundSeedResults || []).map(
    (r) => (r?.result as bigint) ?? 0n
  );


  // Resolve artwork URI
  useEffect(() => {
    if (!existingArtworkURI) return;
    const url = resolveGatewayUrl(existingArtworkURI as string);
    const tryResolve = async () => {
      try {
        const r = await fetch(url);
        const j = await r.json();
        setResolvedArtwork(resolveGatewayUrl(j.image || url));
        setArtworkInput(j.image || existingArtworkURI as string);
      } catch {
        setResolvedArtwork(url);
        setArtworkInput(existingArtworkURI as string);
      }
    };
    tryResolve();
  }, [existingArtworkURI]);

  // Token grid reads
  const startId = Number(startTokenId || 1n);
  const endId = Number(endTokenId || 0n);
  const totalCount = endId > 0 ? endId - startId + 1 : Number(totalSupply || 0);

  // ── Local game engine: compute all statuses from seeds ────────────────────
  // This runs in the browser with zero extra RPC calls per token.
  // Seeds are cached forever since they're immutable on-chain.
  useEffect(() => {
    if (totalCount === 0) return;
    const count = Number(roundCount || 0);
    // Only compute if we have all seeds for completed rounds
    if (count > 0 && roundSeeds.length < count) return;

    const map = computeAllStatuses(totalCount, roundSeeds, count);
    setStatusMap(map);
  }, [totalCount, roundSeeds.length, roundCount, resolvedArtwork]);

  // ── Build display token list from statusMap ────────────────────────────────
  // We derive the full filtered list from statusMap (all tokens, no RPC)
  // and only fetch ownerOf for the slice currently visible on screen.

  const allTokenIds = Array.from({ length: totalCount }, (_, i) => startId + i);

  const allTokensWithStatus: TokenData[] = allTokenIds.map((id) => {
    const rawStatus = statusMap[id];
    let status = "pending";
    if (!gameInitialized) {
      status = "pending";
    } else if (rawStatus === "alive") {
      if (gameFinished) {
        status = claimedSet.has(id) ? "claimed" : "winner";
      } else {
        status = "alive";
      }
    } else if (rawStatus === "eliminated") {
      status = "eliminated";
    } else if (gameInitialized && rawStatus === undefined) {
      status = "alive"; // Fallback before local game engine hydrates
    }
    return { id, status, owner: "", imageUrl: resolvedArtwork, round: 0 };
  });

  // Filter first, then paginate
  let filtered =
    filter === "all"
      ? allTokensWithStatus
      : filter === "mine"
      ? allTokensWithStatus.filter((t) => myTokenIds.has(t.id))
      : allTokensWithStatus.filter((t) => t.status === filter);

  if (filter === "mine") {
    // Sort mine: alive/winners first, then by token ID
    filtered = [...filtered].sort((a, b) => {
      const aAlive = a.status === "alive" || a.status === "winner" || a.status === "claimed";
      const bAlive = b.status === "alive" || b.status === "winner" || b.status === "claimed";
      if (aAlive && !bAlive) return -1;
      if (!aAlive && bAlive) return 1;
      return a.id - b.id;
    });
  }

  // ── Mine filter: fetch owned token IDs efficiently ───────────────────────
  // Uses Alchemy's asset transfer API (no block range limits) when key is
  // available, otherwise falls back to ownerOf for winner tokens only.
  useEffect(() => {
    if (!userAddress) return;

    let cancelled = false;

    const fetchMyTokens = async () => {
      try {
        const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
        const contractAddr = NFT_ADDRESS.toLowerCase();

        if (alchemyKey) {
          // Alchemy: single paginated call, no block range issues
          const alchemyUrl = getAlchemyUrl(alchemyKey, chainId);
          const owned = new Set<number>();
          let pageKey: string | undefined = undefined;

          do {
            const body: any = {
              id: 1, jsonrpc: "2.0", method: "alchemy_getAssetTransfers",
              params: [{
                fromBlock: "0x0",
                toBlock: "latest",
                toAddress: userAddress,
                contractAddresses: [NFT_ADDRESS],
                category: ["erc721"],
                withMetadata: false,
                excludeZeroValue: true,
                maxCount: "0x3e8", // 1000 per page
                ...(pageKey ? { pageKey } : {}),
              }],
            };
            const res = await fetch(alchemyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const json = await res.json();
            const transfers = json?.result?.transfers ?? [];
            for (const t of transfers) {
              if (t.tokenId) owned.add(Number(BigInt(t.tokenId)));
            }
            pageKey = json?.result?.pageKey;
          } while (pageKey && !cancelled);

          // Remove tokens sent away
          let outPageKey: string | undefined = undefined;
          do {
            const body: any = {
              id: 2, jsonrpc: "2.0", method: "alchemy_getAssetTransfers",
              params: [{
                fromBlock: "0x0",
                toBlock: "latest",
                fromAddress: userAddress,
                contractAddresses: [NFT_ADDRESS],
                category: ["erc721"],
                withMetadata: false,
                excludeZeroValue: true,
                maxCount: "0x3e8",
                ...(outPageKey ? { pageKey: outPageKey } : {}),
              }],
            };
            const res = await fetch(alchemyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const json = await res.json();
            const transfers = json?.result?.transfers ?? [];
            for (const t of transfers) {
              if (t.tokenId) owned.delete(Number(BigInt(t.tokenId)));
            }
            outPageKey = json?.result?.pageKey;
          } while (outPageKey && !cancelled);

          if (!cancelled) setMyTokenIds(owned);
        } else {
          // Fallback: ownerOf check only on winner tokens (tiny set)
          const winnerIds = Object.entries(statusMap)
            .filter(([, v]) => v === "alive")
            .map(([k]) => Number(k));
          if (winnerIds.length === 0) return;
          const results = await Promise.all(
            winnerIds.map((id) =>
              publicClient!.readContract({
                address: NFT_ADDRESS as `0x${string}`,
                abi: NFT_ABI,
                functionName: "ownerOf",
                args: [BigInt(id)],
              }).then((owner) => ({ id, owner: (owner as string).toLowerCase() }))
            )
          );
          if (!cancelled) {
            const owned = new Set<number>(results.filter(r => r.owner === userAddress.toLowerCase()).map(r => r.id));
            setMyTokenIds(owned);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch owned tokens:", e);
      }
    };

    fetchMyTokens();
    return () => { cancelled = true; };
  }, [userAddress, NFT_ADDRESS, statusMap, chainId]);

  // ── Mine filter: fetch claimed status for my winner/alive tokens ─────────
  useEffect(() => {
    if (!gameFinished || myTokenIds.size === 0) return;
    
    let cancelled = false;
    const checkClaimed = async () => {
      try {
        const myWinnerIds = Array.from(myTokenIds).filter(id => 
          statusMap[id] === "alive"
        );
        if (myWinnerIds.length === 0) return;
        
        const results = await Promise.all(
          myWinnerIds.map(id => 
            publicClient!.readContract({
              address: NFT_ADDRESS,
              abi: NFT_ABI,
              functionName: "prizeClaimed",
              args: [BigInt(id)],
            }).then(claimed => ({ id, claimed }))
          )
        );
        
        if (!cancelled) {
          const claimedIds = results.filter(r => r.claimed).map(r => r.id);
          setClaimedSet(new Set(claimedIds));
        }
      } catch (e) {
        console.warn("Failed to fetch claimed status:", e);
      }
    };
    
    checkClaimed();
    const interval = setInterval(checkClaimed, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [gameFinished, myTokenIds, statusMap, publicClient, NFT_ADDRESS]);

  // Visible slice to render
  const visibleTokens = filtered.slice(0, visibleCount);

  // Build token array from visible slice — no ownerOf needed for status
  useEffect(() => {
    const built = visibleTokens.map((t) => ({
      ...t,
      owner: myTokenIds.has(t.id) ? userAddress || "" : "",
    }));
    setTokens(built);
  }, [visibleTokens.length, visibleCount, filter, myTokenIds, userAddress]);

  // Countdown
  const cutEligible = secs === 0;
  const countdownText =
    secs === null
      ? "--:--"
      : secs === 0
      ? "00:00"
      : `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  // Artist check
  const isArtist =
    userAddress &&
    artistAddress &&
    userAddress.toLowerCase() === (artistAddress as string).toLowerCase();

  // Write actions
  const { writeContractAsync } = useWriteContract();
  const { isLoading: isMiningCut, isSuccess: isCutMined, isError: isCutError } =
    useWaitForTransactionReceipt({ hash: cutTxHash });
  const { isLoading: isMiningReveal, isSuccess: isRevealMined, isError: isRevealError } =
    useWaitForTransactionReceipt({ hash: revealTxHash });

  useEffect(() => {
    if (cutPending) { setIsSubmittingCut(false); setCutTxHash(undefined); }
  }, [cutPending]);

  useEffect(() => {
    if (isCutMined) { addToast("Cut committed on-chain!", "success"); setIsSubmittingCut(false); setCutTxHash(undefined); }
    if (isCutError) { addToast("Cut transaction failed.", "error"); setIsSubmittingCut(false); setCutTxHash(undefined); }
  }, [isCutMined, isCutError]);

  useEffect(() => {
    if (isRevealMined) {
      addToast("Round results revealed!", "success");
      setIsSubmittingReveal(false);
      setRevealTxHash(undefined);
      
      const aliveTokens = allTokensWithStatus
        .filter(t => t.status === "alive")
        .map(t => t.id);

      fetch("/api/refresh-opensea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: NFT_ADDRESS, chainId, tokenIds: aliveTokens })
      }).catch(console.error);
    }
    if (isRevealError) { addToast("Reveal failed.", "error"); setIsSubmittingReveal(false); setRevealTxHash(undefined); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevealMined, isRevealError]);

  const handleTriggerCut = async () => {
    try {
      setIsSubmittingCut(true);
      addToast("Triggering elimination round…", "info");
      const hash = await writeContractAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "triggerCut",
      });
      setCutTxHash(hash);
    } catch (e: any) {
      addToast(e.shortMessage || "Trigger failed", "error");
      setIsSubmittingCut(false);
    }
  };

  const handleRevealCut = async () => {
    try {
      setIsSubmittingReveal(true);
      addToast("Revealing round results…", "info");
      const hash = await writeContractAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "revealCut",
      });
      setRevealTxHash(hash);
    } catch (e: any) {
      addToast(e.shortMessage || "Reveal failed", "error");
      setIsSubmittingReveal(false);
    }
  };

  const handleInitGame = async () => {
    try {
      addToast("Initializing game…", "info");
      await writeContractAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "initializeGame",
      });
      addToast("Game initialized!", "success");
    } catch (e: any) {
      addToast(e.shortMessage || "Init failed", "error");
    }
  };

  const handleClaim = async (tokenId: number) => {
    try {
      addToast(`Claiming prize for #${tokenId}…`, "info");
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

  const myWinners = tokens.filter(
    (t) =>
      (t.status === "winner") &&
      userAddress &&
      t.owner.toLowerCase() === userAddress.toLowerCase()
  );

  const formatEth = (wei: bigint | undefined) =>
    wei !== undefined ? Number(formatEther(wei)).toFixed(4) : "—";

  const phaseClass = gameFinished
    ? "phase-finished"
    : mintingOpen
    ? "phase-minting"
    : cutPending
    ? "phase-pending"
    : "phase-battle";

  const phaseLabel = gameFinished
    ? "Game Over — Final 4 determined"
    : mintingOpen
    ? "Mint Open — Tokens available on /mint"
    : cutPending
    ? "Cut Committed — Waiting for reveal block"
    : gameInitialized
    ? "Arena Active — Cuts in progress"
    : "Pending — Game not yet initialized";

  return (
    <div className="page-root">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span style={{ color: "var(--text-primary)" }}>Arena</span>
        <span className="breadcrumb-sep">/</span>
        <span>Round {roundCount?.toString() ?? "0"}</span>
      </div>

      {/* Phase banner */}
      <div className={`phase-banner ${phaseClass}`}>
        <span>●</span>
        <span>{phaseLabel}</span>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-cell">
          <span className="stat-label">Prize Pool</span>
          <span className="stat-value">{formatEth(prizePool as bigint | undefined)}</span>
          <span className="stat-unit">ETH</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Prize / Winner</span>
          <span className="stat-value">{formatEth(prizePerWinner as bigint | undefined)}</span>
          <span className="stat-unit">ETH each</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Tokens</span>
          <span className="stat-value">{totalSupply?.toString() ?? "—"}</span>
          <span className="stat-unit">Total minted</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Alive</span>
          <span className="stat-value stat-value--green">{aliveCount?.toString() ?? "—"}</span>
          <span className="stat-unit">In the game</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Active Players</span>
          <span className="stat-value">{activePlayers ?? "—"}</span>
          <span className="stat-unit">Wallets holding</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Round</span>
          <span className="stat-value">{roundCount?.toString() ?? "0"}</span>
          <span className="stat-unit">Completed</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Next Cut</span>
          <span
            className={`stat-value ${cutEligible ? "stat-value--green" : ""}`}
            style={{ fontSize: 20, letterSpacing: "0.05em" }}
          >
            {countdownText}
          </span>
          <span className="stat-unit">Cooldown</span>
        </div>
      </div>

      {/* Action Controls - Moved to top for visibility */}
      <div className="top-action-panels" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', padding: '0 24px 24px', maxWidth: '1400px', margin: '0 auto' }}>
        {/* Cut action */}
        <div style={{ flex: '1 1 300px', border: '1px solid var(--border)', background: 'var(--bg-card-2)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-between' }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Elimination Cut
          </div>

          <div className="countdown-display">
            <div className={`countdown ${cutEligible ? "ready" : ""}`}>
              {countdownText}
            </div>
            <span className="countdown-label">until eligible</span>
          </div>

          {cutPending ? (
            <button
              className="btn btn-primary btn-large"
              style={{ width: "100%" }}
              onClick={handleRevealCut}
              disabled={!userAddress || isSubmittingReveal || isMiningReveal}
            >
              {isMiningReveal ? "Confirming…" : isSubmittingReveal ? "Broadcasting…" : "Reveal Cut Results"}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-large"
              style={{ width: "100%" }}
              onClick={handleTriggerCut}
              disabled={
                !cutEligible ||
                !userAddress ||
                !!gameFinished ||
                isSubmittingCut ||
                isMiningCut
              }
            >
              {isMiningCut
                ? "Confirming…"
                : isSubmittingCut
                ? "Broadcasting…"
                : "Trigger Cut"}
            </button>
          )}

          {cutPending && (
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                color: "var(--gold)",
                textAlign: "center",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Cut committed. Reveal after 1 block.
            </p>
          )}
        </div>

        {/* Winner claim */}
        {myWinners.length > 0 && (
          <div style={{ flex: '1 1 300px', border: '1px solid var(--gold-border)', background: 'rgba(234, 179, 8, 0.05)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-between' }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--gold)",
              }}
            >
              Claim Prize — {formatEth(prizePerWinner as bigint | undefined)} ETH each
            </div>
            <div className="claim-tokens-list">
              {myWinners.map((t) => (
                <div key={t.id} className="claim-token-row">
                  <span className="claim-token-id">#{t.id}</span>
                  <button
                    className="btn btn-primary"
                    style={{ padding: "6px 14px", fontSize: 9 }}
                    onClick={() => handleClaim(t.id)}
                  >
                    Claim
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Artist init panel */}
        {isArtist && !gameInitialized && (
          <div className="admin-section" style={{ flex: '1 1 300px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-between' }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--red)",
              }}
            >
              Init Game (Artist)
            </div>
            {mintOpenTime && Math.floor(Date.now() / 1000) < Number(mintOpenTime) ? (
              <p style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Minting has not started yet. Game cannot be initialized.
              </p>
            ) : mintCloseTime && Math.floor(Date.now() / 1000) < Number(mintCloseTime) && Number(totalSupply || 0) < 10 ? (
              <p style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Minting is currently open. You can initialize the arena early once 10 tokens are minted.
              </p>
            ) : (
              <p style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Mint has closed or early initialization is unlocked. Initialize the arena to begin elimination rounds.
              </p>
            )}
            <button
              className="btn btn-primary btn-large"
              style={{ width: "100%" }}
              onClick={handleInitGame}
              disabled={Boolean(
                (mintOpenTime && Math.floor(Date.now() / 1000) < Number(mintOpenTime)) ||
                (mintCloseTime && Math.floor(Date.now() / 1000) < Number(mintCloseTime) && Number(totalSupply || 0) < 10)
              )}
            >
              Initialize Arena
            </button>
          </div>
        )}
      </div>

      {/* Split layout */}
      <div className="split-layout">
        {/* Token Grid */}
        <div className="split-main">
          {/* Grid header */}
          <div className="section-header">
            <span className="section-title">
              {filtered.length} token{filtered.length !== 1 ? "s" : ""}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div className="filter-tabs">
                {["all", "alive", "eliminated", "winner", "mine"].map((f) => (
                  <button
                    key={f}
                    className={`filter-btn ${filter === f ? "active" : ""}`}
                    onClick={() => { setFilter(f); setVisibleCount(PAGE_SIZE); }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-outline"
                style={{ fontSize: 10, padding: '4px 8px' }}
                onClick={() => setGridExpanded(!gridExpanded)}
              >
                {gridExpanded ? "Hide Grid" : "Expand Grid"}
              </button>
            </div>
          </div>

          {!gridExpanded ? (
            <div className="action-panel" style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-muted)", fontSize: 13, borderTop: "none", border: "1px solid var(--border)", background: "var(--bg-card)" }}>
              <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
                <a 
                  href={openseaSlug ? `https://opensea.io/collection/${openseaSlug}` : `https://opensea.io/assets?search[query]=${NFT_ADDRESS}`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn btn-outline"
                >
                  View Collection on OpenSea
                </a>
                <button className="btn btn-outline" onClick={() => setGridExpanded(true)}>Expand Token Grid</button>
              </div>
            </div>
          ) : (
            <>
              {/* Grid */}
              <div className="nft-grid">
                {tokens.map((t) => (
                  <div
                    key={t.id}
                    className={`nft-card ${t.status === "eliminated" ? "nft-card--eliminated" : ""}`}
                    style={{
                      borderTop: CARD_BORDER[t.status] || "none",
                    }}
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
                          }}
                        />
                      )}
                    </div>
                    <div className="nft-card-body">
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className="nft-card-id">#{t.id}</span>
                        {myTokenIds.has(t.id) && (
                          <span style={{ fontSize: 9, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Mine</span>
                        )}
                      </div>
                      <span className={`nft-status-pill ${STATUS_PILL[t.status] || "pill-pending"}`}>
                        {t.status}
                      </span>
                    </div>
                  </div>
                ))}

                {filtered.length === 0 && (
                  <div className="empty-state">
                    <p>No tokens</p>
                  </div>
                )}
              </div>

              {/* Load more */}
              {visibleCount < filtered.length && (
                <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
                  <button
                    className="btn btn-outline"
                    onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                  >
                    Load more ({filtered.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="split-sidebar">
          {/* Phase info */}
          <div className="sidebar-row">
            <span className="sidebar-label">Status</span>
            <span className="sidebar-value">
              {gameFinished
                ? "Game Over"
                : mintingOpen
                ? "Minting"
                : gameInitialized
                ? "Battle"
                : "Pending"}
            </span>
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
            <span className="sidebar-label">Min Cut Interval</span>
            <span className="sidebar-value">
              {minCutInterval ? `${Math.floor(Number(minCutInterval) / 60)}m` : "—"}
            </span>
          </div>

          {/* Artist emergency */}
          {isArtist && (
            <div className="action-panel" style={{ borderTop: "1px solid var(--border)" }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Admin
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ padding: "8px", background: "var(--bg-card)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 9, color: "var(--text-secondary)" }}>OPENSEA COLLECTION SLUG</span>
                  {editingSlug ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <input 
                        type="text" 
                        value={openseaSlug}
                        onChange={e => setOpenseaSlug(e.target.value)}
                        placeholder="e.g. my-collection"
                        style={{ flex: 1, fontSize: 11, padding: "4px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                      />
                      <button className="btn btn-outline" style={{ fontSize: 9 }} onClick={() => saveSlug(openseaSlug)}>Save</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: openseaSlug ? "var(--text-primary)" : "var(--text-muted)" }}>
                        {openseaSlug || "Not set"}
                      </span>
                      <button className="btn btn-outline" style={{ fontSize: 9, padding: "2px 6px" }} onClick={() => setEditingSlug(true)}>Edit</button>
                    </div>
                  )}
                </div>

                <button
                  className="btn btn-outline"
                  style={{ width: "100%", fontSize: 9 }}
                  disabled={!cutPending}
                  onClick={async () => {
                    try {
                      await writeContractAsync({
                        address: NFT_ADDRESS,
                        abi: NFT_ABI,
                        functionName: "resetCutPending",
                      });
                      addToast("Pending state reset", "success");
                    } catch (e: any) {
                      addToast(e.shortMessage || "Failed", "error");
                    }
                  }}
                >
                  Reset Pending State
                </button>
              </div>
            </div>
          )}

          {/* Bottom spacer for theme toggle */}
          <div style={{ height: 48 }} />
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
