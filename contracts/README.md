# ed4ns Contracts

This repository contains the smart contracts for **ed4ns** — an on-chain Open Edition NFT & Commit-Reveal Survival Game.

## Architecture

There are two distinct architectural pathways provided in this repository for launching the survival game, depending on your deployment needs.

### 1. Standalone SeaDrop Integration (Path A)
**Primary Contract:** `ed4nsSeaDrop.sol`

This is the recommended approach for direct integration with **OpenSea Studio**.
- Natively inherits from OpenSea's official `ERC721SeaDrop.sol`.
- Drops are fully manageable via the OpenSea Studio UI.
- Deployed as a true standalone contract using a standard constructor.

### 2. Factory-Cloneable Integration (Path B)
**Primary Contracts:** `Ed4nsFactoryV2.sol` and `ed4nsV2.sol`

This approach is designed for deploying multiple instances of the game at scale with minimal gas costs.
- Uses **EIP-1167** Minimal Proxy Clones.
- The base implementation (`ed4nsV2.sol`) uses an `initialize()` function rather than a constructor.
- The `Ed4nsFactoryV2` deploys and configures new clones deterministically.

## Game Mechanics

Regardless of the deployment path chosen, both implementations share the same underlying game engine:

- **Open Edition Minting:** The game begins with an open mint phase. Incoming ETH is programmatically split across the prize pool, the artist, and the protocol.
- **Commit-Reveal Randomizer:** A completely gas-free, 100% on-chain randomizer using future EVM blockhashes (`triggerCut` -> `revealCut`).
- **O(1) Lazy Evaluation:** Token survivor logic is evaluated entirely on-demand via `isTokenAlive` and `eliminatedInRound`. No expensive `for` loops are executed on state during cuts.
- **Dynamic On-chain SVGs:** The `tokenURI` dynamically wraps the base artwork in a colored SVG border (`#39d353` for Alive, `#f43f5e` for Eliminated, `#ffffff` for Claimed/Winner).
- **Prize Claim:** The final surviving tokens split the accrued prize pool equally, claimable directly from the contract. If ≤4 tokens are minted in total, the elimination phase is bypassed and all tokens automatically become winners.

## Compilation & Testing

The project uses Hardhat. To compile the contracts and run the test suite:

```bash
npm install
npx hardhat compile
npx hardhat test
```
