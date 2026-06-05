# ed4ns — Survivor NFT Game

An open-edition NFT survival game. Collectors mint during the Open Edition window.
Once minting closes, the game begins — every round a commit-reveal blockhash mechanism eliminates ~half the alive tokens.
The **final 4 survivors** split the ETH prize pool.

**Key properties:**
- **Zero-Cost Randomness:** Uses a commit-reveal future blockhash mechanism, would replace with chainlink vrf in the future.
- **Gas Efficiency:** Gas cost per cut is flat regardless of player count (10 or 10,000).
- **Cloneable:** Factory architecture (EIP-1167) allows anyone to deploy their own game instance cheaply.

---

## Architecture

```
[Frontend]
        |
        | mint() / triggerCut() / revealCut() / claimPrize()
        v
[Ed4nsFactory] → deploys clones of → [ed4ns.sol]
                                        |— tokenURI()     → "image": raw artwork URL, "animation_url": on-chain SVG border
                                        |— triggerCut()   → Commits to future blockhash
                                        |— revealCut()    → Stores blockhash seed on-chain (O(1))
                                        |— isTokenAlive() → Traces token through Fisher-Yates math (view, no gas)
                                        |— claimPrize()   → Pays actual survivors
```

**Lazy Evaluation Model:** The contract stores only one seed per round. Token alive/eliminated status
is computed mathematically on read — no per-token writes during cuts, no array scans.

---

## Project Structure

```
ed4ns/
├── contracts/
│   ├── ed4ns.sol                # Main standalone game contract (lazy eval)
│   ├── Ed4nsFactory.sol         # Factory for creating EIP-1167 clones
│   └── SurvivorExtension.sol    # (Legacy/Old) Manifold extension implementation(old idea)
├── frontend/
│   └── src/                     # Next.js React frontend
├── scripts/
│   ├── deploy-factory.js        # Deploy the factory contract
│   ├── deploy-standalone.js     # Deploy a standalone instance
│   └── ...
├── test/
│   ├── ed4ns.test.js            # Main test suite for ed4ns.sol
│   └── SurvivorExtension.test.js# (Legacy) test suite
├── hardhat.config.js
├── .env.example
└── README.md
```

---

## Setup

### 1. Install root dependencies
```bash
npm install
```

### 2. Install frontend dependencies
```bash
cd frontend && npm install
```

### 3. Configure environment
```bash
cp .env.example .env
```

Edit `.env`:
```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0x...
```

### 4. Run tests
```bash
npx hardhat test test/ed4ns.test.js
```

---

## Deploying

Deploy the factory:
```bash
npx hardhat run scripts/deploy-factory.js --network sepolia
```

Or deploy a standalone instance:
```bash
npx hardhat run scripts/deploy-standalone.js --network sepolia
```

---

## Game Flow

| Phase | Trigger | What happens |
|-------|---------|--------------|
| **Minting** | Public `mint(quantity)` | Users mint tokens. Proceeds auto-split (e.g. 45% pool, 45% artist, 10% protocol). |
| **Initialization** | Artist calls `initializeGame()` | Minting is over, game clock starts. |
| **Commit** | Anyone calls `triggerCut()` | Commits to the next block's hash. |
| **Reveal (Elimination)** | Anyone calls `revealCut()` | Resolves the random seed. ~half of the tokens are eliminated. Token status computed mathematically on read. |
| **Endgame** | Pool reaches ≤4 tokens | `gameFinished = true`. Winners can claim. |
| **Claim** | Each winner calls `claimPrize(tokenId)` | Prize = `prizePool / actualSurvivors`. |

---

## Token Metadata

Each token's `tokenURI()` returns dynamic JSON containing:
```json
{
  "name": "ed4ns #42",
  "image": "https://arweave.net/YOUR_ARTWORK",
  "animation_url": "data:text/html;base64,...",
  "attributes": [
    { "trait_type": "Status", "value": "Alive" },
    { "trait_type": "Survived Rounds", "value": 3 }
  ]
}
```

- **`image`** — raw artwork URL (renders natively everywhere: OpenSea, wallets, browsers)
- **`animation_url`** — on-chain SVG border frame:
  - 🟢 Green — Alive
  - 🔴 Red — Eliminated
  - ⬜ White — Winner
  - 🟣 Purple — Claimed

Status is computed mathematically — no per-token storage writes during cuts.
