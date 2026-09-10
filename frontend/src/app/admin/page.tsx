"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { base } from "wagmi/chains";
import { 
  FACTORY_ADDRESS_BASE, 
  FACTORY_ADDRESS_V2_BASE, 
  FACTORY_ADDRESS_ROBINHOOD, 
  STANDALONE_GAMES, 
  AUTHORIZED_CREATOR 
} from "@/config";
import { FACTORY_ABI, NFT_ABI } from "@/abi";

export default function AdminPage() {
  const { address } = useAccount();
  const [hiddenGames, setHiddenGames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch games from contracts
  const { data: v1BaseGames } = useReadContract({ 
    address: FACTORY_ADDRESS_BASE ? (FACTORY_ADDRESS_BASE as `0x${string}`) : undefined, 
    abi: FACTORY_ABI, 
    functionName: "getGames",
    chainId: base.id 
  });
  
  const { data: v2BaseGames } = useReadContracts({
    contracts: FACTORY_ADDRESS_V2_BASE.map(address => ({ address, abi: FACTORY_ABI, functionName: "getGames", chainId: base.id })),
  });

  const { data: robinhoodGames } = useReadContract({
    address: FACTORY_ADDRESS_ROBINHOOD ? (FACTORY_ADDRESS_ROBINHOOD as `0x${string}`) : undefined,
    abi: FACTORY_ABI,
    functionName: "getGames",
    chainId: 46630
  });

  const allGames = [
    ...(robinhoodGames as string[] || []).map(addr => ({ address: addr, version: "V1", targetChainId: 46630 })),
    ...(v1BaseGames as string[] || []).map(addr => ({ address: addr, version: "V1", targetChainId: base.id })),
    ...(v2BaseGames?.flatMap(res => res.status === 'success' ? (res.result as string[]) : []) || []).map(addr => ({ address: addr, version: "V2", targetChainId: base.id })),
    ...(STANDALONE_GAMES || []).map(addr => ({ address: addr, version: "V2-SeaDrop", targetChainId: base.id }))
  ];

  useEffect(() => {
    fetch("/api/admin/hidden-games")
      .then(res => res.json())
      .then(data => {
        setHiddenGames(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  const toggleVisibility = async (gameAddress: string) => {
    setIsSaving(true);
    let updated;
    if (hiddenGames.includes(gameAddress)) {
      updated = hiddenGames.filter(a => a !== gameAddress);
    } else {
      updated = [...hiddenGames, gameAddress];
    }
    
    setHiddenGames(updated);
    
    try {
      await fetch("/api/admin/hidden-games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch (e) {
      console.error(e);
      // Revert if failed
      setHiddenGames(hiddenGames);
    }
    setIsSaving(false);
  };

  if (!address || address.toLowerCase() !== AUTHORIZED_CREATOR.toLowerCase()) {
    return (
      <div className="page-root" style={{ padding: "64px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-mono)", fontSize: 24 }}>Access Denied</h1>
        <p style={{ marginTop: 16, color: "var(--text-muted)" }}>Connect the platform admin wallet to view this page.</p>
      </div>
    );
  }

  return (
    <div className="page-root" style={{ padding: "64px 40px", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-mono)", fontSize: 24, marginBottom: 8 }}>Platform Admin Dashboard</h1>
      <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>Manage visibility of deployed games on the public gallery.</p>

      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {allGames.map((game, i) => (
            <AdminGameRow 
              key={i} 
              game={game} 
              isHidden={hiddenGames.includes(game.address)}
              onToggle={() => toggleVisibility(game.address)}
              isSaving={isSaving}
            />
          ))}
          {allGames.length === 0 && <p>No games found.</p>}
        </div>
      )}
    </div>
  );
}

function AdminGameRow({ game, isHidden, onToggle, isSaving }: { game: any, isHidden: boolean, onToggle: () => void, isSaving: boolean }) {
  const { data: name } = useReadContract({
    address: game.address,
    abi: NFT_ABI,
    functionName: "name",
    chainId: game.targetChainId
  });

  return (
    <div style={{ 
      display: "flex", 
      alignItems: "center", 
      justifyContent: "space-between", 
      padding: "16px 24px", 
      background: "var(--bg-card)", 
      border: "1px solid var(--border)",
      borderRadius: 8
    }}>
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>
          {name as string || "Untitled Game"}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          {game.address} • {game.targetChainId === 46630 ? "Robinhood" : "Base"} • {game.version}
        </div>
      </div>
      
      <button 
        className={isHidden ? "btn btn-outline" : "btn btn-primary"}
        onClick={onToggle}
        disabled={isSaving}
        style={{ opacity: isSaving ? 0.5 : 1, width: 120, fontSize: 11 }}
      >
        {isHidden ? "Hidden" : "Public"}
      </button>
    </div>
  );
}
