"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { celo } from "wagmi/chains";
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
  const showLaunch = isCreator || (!!address && chainId === celo.id);

  return (
    <header className="navbar">
      {/* Brand */}
      <Link href="/" className="navbar-brand" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <img src="/logo.svg" alt="ed4ns logo" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
        <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "16px" }}>ed4ns</span>
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
      </nav>

      {/* Wallet connect */}
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
    </header>
  );
}
