"use client";

import Link from "next/link";
import { GameSummary } from "@/components/GameSummary";

const STEPS = [
  {
    num: "01",
    title: "Mint a Token",
    desc: `During the open edition mint window, anyone can mint one or more tokens on the /mint page. Each token costs the same fixed price. 50% of every mint goes directly into the prize pool — 50% to the artist.`,
    callout: null,
  },
  {
    num: "02",
    title: "Mint Closes",
    desc: `Once the mint window ends, the artist initializes the arena. A snapshot of all token IDs is locked on-chain. No more tokens can enter the game.`,
    callout:
      "You do not need to do anything. Holding your token automatically makes you a participant.",
  },
  {
    num: "03",
    title: "Elimination Rounds Begin",
    desc: `Each round, exactly half of the remaining players are eliminated. The elimination is determined using on-chain pseudorandom logic derived from recent block hashes — no external oracle required. Once the cooldown period expires, anyone can trigger the next cut.`,
    callout:
      "Trigger cut → commit phase. After 1 block, call Reveal Cut to finalize results. Both steps are available on the Arena page.",
  },
  {
    num: "04",
    title: "Rounds Continue Until 4 Remain",
    desc: `Cuts continue every cooldown interval until 4 or fewer tokens remain alive. The game automatically detects the winning condition and locks the final state.`,
    callout: null,
  },
  {
    num: "05",
    title: "Winners Claim the Prize Pool",
    desc: `Each surviving token holder is entitled to an equal share of the total prize pool. Connect your wallet on the Arena page — if you hold a winner token, a Claim Prize button appears automatically. Prize is paid in the chain's native token (ETH on Base, CELO on Celo).`,
    callout:
      "prizePerWinner = totalPrizePool ÷ numberOfSurvivors. This is computed on-chain; there are no manual distributions.",
  },
];

const FAQ = [
  {
    q: "Can I mint more than one token?",
    a: "Yes. You can mint as many as you want in a single or multiple transactions. Each token is independent — you could hold multiple winning tokens.",
  },
  {
    q: "How is the elimination random?",
    a: "Elimination uses a two-step commit-reveal pattern over block hashes. The cutter commits in block N. The reveal is computed from blockhash(N), which is unpredictable at the time of commit. This removes the need for any external randomness oracle.",
  },
  {
    q: "What if no one triggers a cut?",
    a: "The game pauses until someone calls triggerCut on the Arena page. Anyone can do it once the cooldown expires — not just the artist. The game never auto-progresses.",
  },
  {
    q: "What happens if I sell or transfer my token?",
    a: "Token status follows the token, not the address. The new holder of a surviving token can claim the prize. The new holder of an eliminated token holds a collectible with no prize claim.",
  },
  {
    q: "How is the prize pool protected?",
    a: "Funds are held in the contract. Only the artist can call emergencyWithdraw after the game finishes, and only for any residual dust. Actual prizes are claimable by token holders directly.",
  },
  {
    q: "Is there a deadline to claim?",
    a: "Not currently. Prize claims remain open as long as the contract is deployed. However, claim promptly as contract upgrades or migrations are always possible in future seasons.",
  },
];

export default function HowToPlayPage() {
  return (
    <div className="page-root">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/">Arena</Link>
        <span className="breadcrumb-sep">/</span>
        <span>How to Play</span>
      </div>

      <div className="htp-layout">
        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <h1
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              color: "var(--text-primary)",
              lineHeight: 1.1,
              marginBottom: 12,
            }}
          >
            How to Play
          </h1>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
            }}
          >
            ed4ns — Open Edition Survival Game
          </p>
        </div>

        {/* Quick callout */}
        <div className="htp-callout" style={{ marginBottom: 32 }}>
          <strong
            style={{
              display: "block",
              marginBottom: 4,
              color: "var(--text-primary)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontSize: 10,
            }}
          >
            tl;dr
          </strong>
          Mint a token during the open edition. Each round, half the players are
          eliminated based on their token ID and a random seed. Survive to the
          final 4, split the prize pool.
        </div>

        {/* Steps */}
        {STEPS.map((step) => (
          <div key={step.num} className="htp-step">
            <div className="htp-step-num">{step.num}</div>
            <div className="htp-step-content">
              <div className="htp-step-title">{step.title}</div>
              <div className="htp-step-desc">{step.desc}</div>
              {step.callout && (
                <div className="htp-callout" style={{ marginTop: 12 }}>
                  {step.callout}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Token States */}
        <div style={{ margin: "48px 0 24px" }}>
          <GameSummary hideHowItWorks={true} />
        </div>

        {/* FAQ */}
        <div style={{ marginTop: 48 }}>
          <h2
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-primary)",
              marginBottom: 24,
            }}
          >
            FAQ
          </h2>
          {FAQ.map((item) => (
            <div
              key={item.q}
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 20,
                paddingBottom: 20,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  marginBottom: 8,
                  letterSpacing: "0.02em",
                }}
              >
                {item.q}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.7,
                }}
              >
                {item.a}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div
          style={{
            marginTop: 64,
            padding: "32px 24px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--text-primary)",
                marginBottom: 4,
              }}
            >
              Ready?
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Mint a token and enter the arena.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Link href="/mint" className="btn btn-primary btn-large">
              Mint Token
            </Link>
            <Link href="/" className="btn btn-outline btn-large">
              View Arena
            </Link>
          </div>
        </div>

        {/* Bottom spacer for theme toggle */}
        <div style={{ height: 64 }} />
      </div>
    </div>
  );
}
