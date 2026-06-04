export const GameSummary = ({ hideHowItWorks }: { hideHowItWorks?: boolean }) => {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", width: "100%" }}>
      {!hideHowItWorks && (
        <>
          {/* How it works */}
          <div className="section-header" style={{ marginBottom: 24 }}>
            <span className="section-title">How it works</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1, border: "1px solid var(--border)", marginBottom: 48 }}>
            {[
              { n: "01", title: "Mint", body: "Collectors mint open edition tokens during the mint window. 45% of each mint goes to the prize pool." },
              { n: "02", title: "Cuts", body: "After mint closes, the artist initialises the game. Anyone triggers periodic elimination rounds via commit-reveal." },
              { n: "03", title: "Survive", body: "Each cut eliminates roughly half the remaining tokens. If your token is eliminated, you can buy an alive token on the secondary market to stay in the game." },
              { n: "04", title: "Claim", body: "The final 4 surviving token holders share the entire prize pool equally. Claim at any time after the game ends." },
            ].map(({ n, title, body }) => (
              <div
                key={n}
                style={{
                  padding: 20,
                  background: "var(--bg-card)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>{n}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8, textTransform: "uppercase" }}>{title}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{body}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Token States */}
      <div className="section-header" style={{ marginBottom: 24 }}>
        <span className="section-title">Token States</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 1,
          border: "1px solid var(--border)",
        }}
      >
        {[
          { label: "Alive", desc: "Still in the game", color: "var(--green)", bg: "var(--green-bg)" },
          { label: "Eliminated", desc: "Removed in a past round", color: "var(--red)", bg: "var(--red-bg)" },
          { label: "Winner", desc: "One of the final 4", color: "#ffffff", bg: "rgba(255, 255, 255, 0.08)" },
          { label: "Claimed", desc: "Prize already collected", color: "var(--blue)", bg: "var(--blue-bg)" },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: s.bg,
              padding: "16px",
              borderRight: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: s.color,
                marginBottom: 4,
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              {s.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
