"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { AUTHORIZED_CREATOR } from "@/config";

const NAV_LINKS = [
  { href: "/", label: "Arena" },
  { href: "/holdings", label: "Holdings" },
  { href: "/how-to-play", label: "How to Play" },
];

export function Navbar() {
  const pathname = usePathname();
  const { address } = useAccount();
  const chainId = useChainId();

  const isCreator = !!address && address.toLowerCase() === AUTHORIZED_CREATOR.toLowerCase();
  const showLaunch = isCreator || (!!address && chainId === 4663);

  return (
    <header className="navbar">
      {/* Brand */}
      <Link href="/" className="navbar-brand" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <img src="/logo.svg" alt="ed4ns logo" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
        <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "16px" }}>ed4ns</span>
        <span style={{
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.5)",
          fontSize: "10px",
          padding: "2px 6px",
          borderRadius: "4px",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.05em",
          marginLeft: "4px",
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap"
        }}>
          by $pfwa
        </span>
      </Link>

      {/* Nav links */}
      <nav className="navbar-nav">
        {showLaunch && (
          <Link
            href="/launch"
            className={`nav-link ${pathname === "/launch" ? "active" : ""}`}
          >
            Launch
          </Link>
        )}
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-link ${pathname === link.href ? "active" : ""}`}
          >
            {link.label}
          </Link>
        ))}
        {isCreator && (
          <Link
            href="/admin"
            className={`nav-link ${pathname === "/admin" ? "active" : ""}`}
          >
            Admin
          </Link>
        )}
      </nav>

      {/* Right Actions */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <a
          href="https://www.ponsfamily.com/launchpad/0xa934bA4F59070149d37A93F8A002Af79BAe35563"
          target="_blank"
          rel="noopener noreferrer"
          className="btn hide-on-mobile"
          style={{
            background: "rgba(0, 255, 136, 0.05)",
            border: "1px solid rgba(0, 255, 136, 0.2)",
            color: "var(--green)",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "8px 16px",
            textDecoration: "none"
          }}
        >
          $PFWA
        </a>
        <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          authenticationStatus,
          mounted,
        }) => {
          const ready = mounted && authenticationStatus !== "loading";
          const connected =
            ready &&
            account &&
            chain &&
            (!authenticationStatus ||
              authenticationStatus === "authenticated");

          return (
            <div
              {...(!ready && {
                "aria-hidden": true,
                style: {
                  opacity: 0,
                  pointerEvents: "none",
                  userSelect: "none",
                },
              })}
            >
              {(() => {
                if (!connected) {
                  return (
                    <button
                      onClick={openConnectModal}
                      type="button"
                      className="btn btn-primary"
                    >
                      Connect
                    </button>
                  );
                }
                if (chain.unsupported) {
                  return (
                    <button
                      onClick={openChainModal}
                      type="button"
                      className="btn"
                      style={{
                        background: "var(--red)",
                        color: "#fff",
                        border: "1px solid var(--red)",
                        padding: "8px 20px",
                      }}
                    >
                      Wrong Network
                    </button>
                  );
                }
                return (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      onClick={openChainModal}
                      style={{ display: 'flex', alignItems: 'center' }}
                      type="button"
                      className="btn btn-outline"
                    >
                      {chain.hasIcon && (
                        <div
                          style={{
                            background: chain.iconBackground,
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            overflow: 'hidden',
                            marginRight: 4,
                          }}
                        >
                          {chain.iconUrl && (
                            <img
                              alt={chain.name ?? 'Chain icon'}
                              src={chain.iconUrl}
                              style={{ width: 12, height: 12 }}
                            />
                          )}
                        </div>
                      )}
                      {chain.name}
                    </button>
                    <button
                      onClick={openAccountModal}
                      type="button"
                      className="btn btn-outline"
                    >
                      {account.displayName}
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        }}
      </ConnectButton.Custom>
      </div>
    </header>
  );
}
