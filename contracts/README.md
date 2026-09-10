# ed4ns Contracts

This repository contains the smart contracts for **ed4ns** — an on-chain Open Edition NFT & Commit-Reveal Survival Game.

## Architecture

This repository contains several iterations and distinct pathways for launching the survival game:

### 1. Standalone SeaDrop Integration (Current/Recommended)
**Primary Contract:** `ed4nsSeaDrop.sol`

This is the recommended approach for direct integration with **OpenSea Studio** and is currently used for standalone drops.
- Natively inherits from OpenSea's official `ERC721SeaDrop.sol`.
- Drops are fully manageable via the OpenSea Studio UI.
- Deployed as a true standalone contract using a standard constructor.
- Contains the upgraded game engine with Dynamic On-chain SVG borders.

### 2. Factory-Cloneable Integration (V2 - Failed/Spoof)
**Primary Contracts:** `failed/Ed4nsFactoryV2.sol` and `failed/ed4nsV2.sol`

This approach was designed for deploying multiple instances of the game at scale using EIP-1167 clones.
- Attempted to simulate OpenSea Studio compatibility by inheriting `INonFungibleSeaDropToken`, but does not fully integrate with the core SeaDrop pipeline.
- Introduced the **Dynamic On-chain SVGs** (colored borders) based on token status.
- Maintained for frontend compatibility on the `/launch` page.

### 3. Original Factory (V1 - Legacy)
**Primary Contracts:** `Ed4nsFactory.sol` and `ed4ns.sol`

The original game engine implementation.
- The core mathematical engine works perfectly.
- Lacks dynamic SVG borders.
- Susceptible to a JSON formatting bug if the description contains quotes or newlines (due to raw `abi.encodePacked` construction).

## Game Mechanics

Regardless of the deployment path chosen, both implementations share the same underlying game engine:

- **Open Edition Minting:** The game begins with an open mint phase. Incoming ETH is programmatically split across the prize pool, the artist, and the protocol.
- **Dynamic Prize Pool (Secondary Sales):** All secondary market royalties routed to the smart contract are split through the `receive()` function, actively growing the prize pool every time players trade tokens!
- **Commit-Reveal Randomizer:** A completely gas-free, 100% on-chain randomizer using future EVM blockhashes (`triggerCut` -> `revealCut`).
- **O(1) Lazy Evaluation:** Token active/eliminated status is evaluated entirely on-demand via `isTokenAlive` and `eliminatedInRound`. No expensive `for` loops are executed on state during cuts.
- **Dynamic On-chain SVGs:** The `tokenURI` dynamically wraps the base artwork in a colored SVG border (`#39d353` for Active, `#f43f5e` for Eliminated, `#ffffff` for Claimed/Winner).
- **Prize Claim:** The final surviving tokens split the accrued prize pool equally, claimable directly from the contract. If ≤4 tokens are minted in total, the elimination phase is bypassed and all tokens automatically become winners.

## Compilation & Testing

The project uses Hardhat. To compile the contracts and run the test suite:

```bash
npm install
npx hardhat compile
npx hardhat test
```
