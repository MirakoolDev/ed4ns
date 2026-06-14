"use client";

import { useState, useRef, useCallback } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther } from "viem";
import Link from "next/link";
import { FACTORY_ADDRESS, FACTORY_ADDRESS_V2, AUTHORIZED_CREATOR, getExplorerUrl } from "@/config";
import { FACTORY_ABI, NFT_ABI } from "@/abi";
import { GameCard } from "../page";

// Robust JSON string escape helper to prevent ANY on-chain metadata breakage
const escapeForJson = (str: string) => {
  if (!str) return "";
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
};

// ── helpers ──────────────────────────────────────────────────────────────────
const toUnix = (localDateTime: string) =>
  Math.floor(new Date(localDateTime).getTime() / 1000);

const fromUnix = (ts: number) => {
  const d = new Date(ts * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const now = () => Math.floor(Date.now() / 1000);

// GameCard imported from ../page

// ── Uploader ─────────────────────────────────────────────────────────────────
function ArtworkUploader({
  onUploaded,
}: {
  onUploaded: (ipfsUrl: string, gatewayUrl: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setPreview(URL.createObjectURL(file));
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Upload failed");

      setUploadedUrl(data.ipfsUrl);
      onUploaded(data.ipfsUrl, data.gatewayUrl);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }, [onUploaded]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        Artwork
      </label>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          minHeight: 120,
          padding: 16,
          position: "relative",
          overflow: "hidden",
          transition: "border-color 0.15s",
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt="preview"
            style={{ maxHeight: 120, maxWidth: "100%", objectFit: "contain" }}
          />
        ) : (
          <>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 20, color: "var(--text-muted)" }}>↑</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Drop image or click
            </span>
          </>
        )}

        {uploading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--bg-card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <div className="spinner" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" }}>
              Uploading to IPFS…
            </span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />



      {error && (
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--red)", letterSpacing: "0.1em" }}>
          {error}
        </p>
      )}

      {uploadedUrl && (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--green)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            wordBreak: "break-all",
          }}
        >
          Pinned: {uploadedUrl}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LaunchPage() {
  const { address: userAddress } = useAccount();
  const chainId = useChainId();
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const [factoryVersion, setFactoryVersion] = useState<"V1" | "V2">("V2");

  const addToast = (msg: string, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 5000);
  };

  const currentFactoryV2 = Array.isArray(FACTORY_ADDRESS_V2) ? FACTORY_ADDRESS_V2[FACTORY_ADDRESS_V2.length - 1] : FACTORY_ADDRESS_V2;

  // ── Factory reads ────────────────────────────────────────────────────────
  const { data: gameCount } = useReadContract({
    address: (factoryVersion === "V1" ? FACTORY_ADDRESS : currentFactoryV2) as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "gameCount",
    query: { refetchInterval: 15000 },
  });

  const { data: games } = useReadContract({
    address: (factoryVersion === "V1" ? FACTORY_ADDRESS : currentFactoryV2) as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getGames",
    query: { refetchInterval: 15000 },
  });

  const gameList = (games as `0x${string}`[] | undefined) ?? [];
  const canCreate = !!userAddress && userAddress.toLowerCase() === AUTHORIZED_CREATOR.toLowerCase();

  // ── Deploy form state ────────────────────────────────────────────────────
  const defaultOpen  = fromUnix(now() + 300);
  const defaultClose = fromUnix(now() + 86400);

  const [form, setForm] = useState({
    name:          "",
    symbol:        "",
    description:   "",
    mintPrice:     "0.01",
    mintOpenTime:  defaultOpen,
    mintCloseTime: defaultClose,
    minCutInterval: "240",
    artworkUri:    "",
  });

  const setField = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // ── Deploy write ─────────────────────────────────────────────────────────
  const { writeContractAsync } = useWriteContract();
  const [deployHash, setDeployHash] = useState<`0x${string}` | undefined>();
  const [isDeploying, setIsDeploying] = useState(false);

  const { isSuccess: deployConfirmed } = useWaitForTransactionReceipt({ hash: deployHash });

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;

    try {
      setIsDeploying(true);
      addToast("Deploying game…", "info");

      const hash = await writeContractAsync({
        address: (factoryVersion === "V1" ? FACTORY_ADDRESS : currentFactoryV2) as `0x${string}`,
        abi: FACTORY_ABI,
        functionName: "deployGame",
        args: [{
          name: escapeForJson(form.name),
          symbol: form.symbol,
          description: escapeForJson(form.description),
          artworkURI: form.artworkUri,
          mintPrice: parseEther(form.mintPrice),
          mintOpenTime: BigInt(toUnix(form.mintOpenTime)),
          mintCloseTime: BigInt(toUnix(form.mintCloseTime)),
          minCutInterval: BigInt(Number(form.minCutInterval)),
        }],
      });

      setDeployHash(hash);
      addToast(`Tx sent: ${hash.slice(0, 10)}… Waiting for confirmation`, "info");
    } catch (e: any) {
      addToast(e.shortMessage || "Deploy failed", "error");
      setIsDeploying(false);
    }
  };

  if (deployConfirmed && isDeploying) {
    setIsDeploying(false);
    addToast("Game deployed! Check the registry below.", "success");
  }

  return (
    <div className="page-root">
      {/* Hero */}
      <div
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "64px 16px 48px",
          maxWidth: 800,
          margin: "0 auto",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 56,
            fontWeight: 900,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            color: "var(--text-primary)",
          }}
        >
          ed4ns
        </h1>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            maxWidth: 440,
          }}
        >
          Open edition survival games on-chain. Mint. Compete. The final 4 split the prize pool.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
          <Link href="/" className="btn btn-primary btn-large">
            Open Arena
          </Link>
          <Link href="/how-to-play" className="btn btn-outline btn-large">
            How It Works
          </Link>
        </div>
      </div>

      {/* Protocol stats */}
      <div className="stats-row">
        <div className="stat-cell">
          <span className="stat-label">Total Games</span>
          <span className="stat-value">{gameCount?.toString() ?? "—"}</span>
          <span className="stat-unit">Deployed</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Prize Split</span>
          <span className="stat-value" style={{ fontSize: 16 }}>45 / 45 / 10</span>
          <span className="stat-unit">Pool / Artist / Protocol</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Randomness</span>
          <span className="stat-value" style={{ fontSize: 14 }}>Blockhash</span>
          <span className="stat-unit">Commit-reveal, free</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Winners</span>
          <span className="stat-value">4</span>
          <span className="stat-unit">Final survivors</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Storage</span>
          <span className="stat-value" style={{ fontSize: 14 }}>IPFS</span>
          <span className="stat-unit">4everland pinned</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Contract</span>
          <span className="stat-value" style={{ fontSize: 14 }}>Open</span>
          <span className="stat-unit">Fully on-chain</span>
        </div>
      </div>

      {/* Split layout: games registry + create */}
      <div className="split-layout">
        {/* Games registry */}
        <div className="split-main">
          <div className="section-header">
            <span className="section-title">
              {gameList.length} Game{gameList.length !== 1 ? "s" : ""}
            </span>
          </div>

          {gameList.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "48px 16px",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                No games deployed yet
              </p>
            </div>
          ) : (
            <div className="nft-grid">
              {[...gameList].reverse().map((addr) => (
                <GameCard key={addr} address={addr} version={factoryVersion} />
              ))}
            </div>
          )}
        </div>

        {/* Create sidebar */}
        <div className="split-sidebar">
          {canCreate ? (
            /* Creator form */
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
                Deploy a Game
              </div>

              {/* Version Selector */}
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button 
                  className={`btn ${factoryVersion === "V1" ? "btn-primary" : "btn-outline"}`} 
                  onClick={() => setFactoryVersion("V1")} 
                  style={{ flex: 1 }}
                >
                  V1 (Legacy)
                </button>
                <button 
                  className={`btn ${factoryVersion === "V2" ? "btn-primary" : "btn-outline"}`} 
                  onClick={() => setFactoryVersion("V2")} 
                  style={{ flex: 1 }}
                >
                  V2 (SeaDrop)
                </button>
              </div>

              <form onSubmit={handleDeploy} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Artwork uploader */}
                <ArtworkUploader
                  onUploaded={(_, gatewayUrl) => setField("artworkUri")(gatewayUrl)}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Name */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      Name
                    </label>
                    <input className="input" value={form.name} onChange={(e) => setField("name")(e.target.value)} required />
                  </div>

                  {/* Symbol */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      Ticker
                    </label>
                    <input className="input" value={form.symbol} onChange={(e) => setField("symbol")(e.target.value)} required />
                  </div>
                </div>

                {/* Description */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    Description
                  </label>
                  <textarea className="input" value={form.description} onChange={(e) => setField("description")(e.target.value)} style={{ minHeight: 60, resize: "vertical" }} required />
                </div>

                {/* Artwork URI manual override */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Artwork URI (auto-filled on upload)
                  </label>
                  <input
                    className="input"
                    placeholder="ipfs://… or https://…"
                    value={form.artworkUri}
                    onChange={(e) => setField("artworkUri")(e.target.value)}
                  />
                </div>

                {/* Mint price */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Mint Price (ETH)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    min="0"
                    value={form.mintPrice}
                    onChange={(e) => setField("mintPrice")(e.target.value)}
                    required
                  />
                </div>

                {/* Open time */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Mint Opens
                  </label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={form.mintOpenTime}
                    onChange={(e) => setField("mintOpenTime")(e.target.value)}
                    required
                  />
                </div>

                {/* Close time */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Mint Closes
                  </label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={form.mintCloseTime}
                    onChange={(e) => setField("mintCloseTime")(e.target.value)}
                    required
                  />
                </div>

                {/* Cut interval */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Min Cut Interval (seconds)
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="60"
                    value={form.minCutInterval}
                    onChange={(e) => setField("minCutInterval")(e.target.value)}
                    required
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 8,
                      color: "var(--text-muted)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {Math.floor(Number(form.minCutInterval) / 3600)}h{" "}
                    {Math.floor((Number(form.minCutInterval) % 3600) / 60)}m between cuts
                  </span>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-large"
                  style={{ width: "100%" }}
                  disabled={isDeploying || !form.artworkUri || !form.name || !form.symbol || !form.description}
                >
                  {isDeploying ? "Deploying…" : "Deploy NFT"}
                </button>

                {!form.artworkUri && (
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 8,
                      color: "var(--text-muted)",
                      textAlign: "center",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    Upload artwork first
                  </p>
                )}
              </form>
            </div>
          ) : (
            /* Coming soon panel */
            <div
              className="action-panel"
              style={{ position: "relative", overflow: "hidden", minHeight: 320 }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Create a Game
              </div>

              {/* Blurred preview */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  filter: "blur(4px)",
                  pointerEvents: "none",
                  userSelect: "none",
                  opacity: 0.5,
                }}
              >
                <div className="input" style={{ height: 100 }} />
                <div className="input" style={{ height: 36 }} />
                <div className="input" style={{ height: 36 }} />
                <div className="input" style={{ height: 36 }} />
                <div className="btn btn-primary btn-large" style={{ textAlign: "center" }}>Deploy</div>
              </div>

              {/* Overlay */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  background: "var(--bg-overlay)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "var(--text-secondary)",
                  }}
                >
                  Coming Soon
                </span>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--text-muted)",
                    textAlign: "center",
                    maxWidth: 220,
                    letterSpacing: "0.1em",
                    lineHeight: 1.7,
                    textTransform: "uppercase",
                  }}
                >
                  {!userAddress
                    ? "Connect wallet to check access"
                    : "Your wallet is not yet authorised to create games"}
                </p>
              </div>
            </div>
          )}

          {/* Info rows */}
          <div className="sidebar-row">
            <span className="sidebar-label">Factory</span>
            <span className="sidebar-value" style={{ fontSize: 9 }}>
              <a href={getExplorerUrl(factoryVersion === "V1" ? FACTORY_ADDRESS : currentFactoryV2, chainId)} target="_blank" rel="noopener noreferrer" className="address-link">
                {(factoryVersion === "V1" ? FACTORY_ADDRESS : currentFactoryV2).slice(0, 8)}…{(factoryVersion === "V1" ? FACTORY_ADDRESS : currentFactoryV2).slice(-6)}
              </a>
            </span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-label">Your status</span>
            <span
              className="sidebar-value"
              style={{ color: canCreate ? "var(--green)" : "var(--text-muted)" }}
            >
              {!userAddress ? "Not connected" : canCreate ? "Authorised creator" : "Not authorised"}
            </span>
          </div>

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
