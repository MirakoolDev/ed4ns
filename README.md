# ed4ns — Survivor NFT Game

An open-edition NFT survival game. Collectors mint during the OE phase on Manifold.
Once minting closes, the game begins — every round Chainlink VRF eliminates ~half the alive tokens.
The **final 4 survivors** split the ETH prize pool.

**Key property:** Gas cost per cut is flat ~30k gas regardless of player count (10 or 10,000).

---

## Architecture

```
[Frontend: Next.js]
        |
        | initializeGame() / triggerCut() / claimPrize()
        v
[SurvivorExtension.sol]  ←  registered with Manifold Creator Core
        |— tokenURI()     → "image": raw artwork URL, "animation_url": on-chain SVG border
        |— triggerCut()   → Chainlink VRF request (~30k gas, flat)
        |— fulfillRandomWords() → stores 1 seed on-chain (O(1))
        |— isTokenAlive() → traces token through Fisher-Yates math (view, no gas)
        |— claimPrize()   → pays actual survivors (not hardcoded 4)
        ↓
[Manifold ERC721Creator]  ←  deployed via Manifold Studio
```

**Lazy Evaluation Model:** The contract stores only one seed per round. Token alive/eliminated status
is computed mathematically on read — no per-token writes during cuts, no array scans.

---

## Project Structure

```
ed4ns/
├── contracts/
│   ├── SurvivorExtension.sol          # Main game contract (lazy eval)
│   └── mocks/
│       ├── MockERC721CreatorCore.sol  # Testing mock
│       └── VRFMockImport.sol          # Chainlink VRF mock import
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # Main game UI
│       │   └── globals.css            # Styles
│       ├── components/
│       │   ├── Navbar.tsx
│       │   └── Providers.tsx          # Wagmi + RainbowKit
│       ├── abi.ts                     # Contract ABIs
│       └── config.ts                  # Contract addresses ← update after deploy
├── scripts/
│   ├── deploy.js                      # Sepolia deploy script
│   └── deploy-local.js               # Local Hardhat test environment
├── test/
│   └── SurvivorExtension.test.js     # 43-test suite
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
MANIFOLD_CORE_ADDRESS=0x...        # Your ERC721Creator from Manifold Studio
VRF_SUBSCRIPTION_ID=123            # From vrf.chain.link
ARTIST_ADDRESS=0x...               # Receives 50% of mint proceeds live
ETHERSCAN_API_KEY=...              # Optional, for contract verification
```

### 4. Run tests
```bash
npx hardhat test
# Expected: 43 passing
```

---

## Testing Locally (Full E2E)

Run a local Hardhat node and deploy everything against mocks:

```bash
# Terminal 1 — start local node
npx hardhat node

# Terminal 2 — deploy all contracts + auto-update config.ts
npx hardhat run scripts/deploy-local.js --network localhost
```

Then start the frontend:
```bash
cd frontend && npm run dev
```

The local deploy script:
- Deploys mock VRF coordinator, mock Manifold core, and SurvivorExtension
- Creates and funds a VRF subscription (1000 test LINK)
- Registers extension as VRF consumer
- **Auto-writes** addresses to `frontend/src/config.ts`
- Sets a 60-second cut cooldown (vs 4 minutes on Sepolia)

To simulate a VRF fulfillment in tests, call `fulfillRandomWordsWithOverride` on the mock coordinator.

---

## Deploying to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The script prints exact next steps. After deploying, complete the checklist below.

---

## Post-Deployment Checklist

After `SurvivorExtension` is deployed:

### 1. Register with Manifold Creator Core
In [Manifold Studio](https://studio.manifold.xyz/), go to your contract → **Extensions** → **Add Extension**, enter your `SurvivorExtension` address.

Or directly on-chain (call as core owner):
```
core.registerExtension("0xYourExtension", "https://yoursite.com")
```

### 2. Set token URI override
```
core.setTokenURIExtension("0xYourExtension", "")
```
This tells the core to call your extension for all `tokenURI()` requests.

### 3. Add as VRF consumer
Go to [vrf.chain.link](https://vrf.chain.link/) → Your Subscription → **Add Consumer** → paste your extension address.

> **Subscription balance recommendation:**
> Keep **6+ LINK** in your subscription. The 200 Gwei gas lane sets the worst-case
> "Max Cost" display at ~5-6 LINK, but each actual cut charges ~0.1-0.3 LINK at
> normal gas prices (~$1-3 per cut).

### 4. Update frontend config
Edit `frontend/src/config.ts`:
```ts
export const EXTENSION_ADDRESS = "0xYourSurvivorExtension";
export const CORE_ADDRESS = "0xYourManifoldCore";
export const MANIFOLD_CLAIM_URL = "https://manifold.xyz/@you/id/...";
```

### 5. Run the Manifold Open Edition mint
Set up your Open Edition on Manifold Studio pointing funds to `SurvivorExtension` (or fund
the prize pool via direct ETH sends to the contract — it auto-splits 50% prize pool / 50% artist).

### 6. Initialize the game (after OE closes)
Once minting is done and you know the token range, call `initializeGame()` on-chain
(via Etherscan Write tab or your frontend admin panel):

```solidity
initializeGame(
    startTokenId,   // first minted token ID (e.g. 1)
    endTokenId,     // last minted token ID (e.g. 247)
    "https://arweave.net/YOUR_ARTWORK_CID"  // raw artwork URL
)
```

This is **O(1)** — costs the same gas whether you have 10 or 10,000 players.

> **Artwork dimensions:** Default is 600×600. If your artwork is a different ratio,
> call `setArtworkDimensions(width, height)` so the SVG border frame is proportional.

### 7. Verify on Etherscan (optional but recommended)
```bash
npx hardhat verify --network sepolia 0xYourExtension \
  "0xManifoldCore" "0xArtist" "240" \
  "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1b" "YOUR_SUB_ID" \
  "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae" \
  "50000"
```

---

## Game Flow

| Phase | Trigger | What happens |
|-------|---------|--------------|
| **OE Minting** | Manifold OE live | Users mint on Manifold. 50% of proceeds go to extension prize pool, 50% to artist wallet. |
| **Initialization** | Artist calls `initializeGame()` | Token range locked. Game clock starts. O(1) gas. |
| **Battle** | Anyone calls `triggerCut()` every ≥4 min | VRF request sent. Chainlink fulfills with a random seed. Seed stored on-chain. |
| **Elimination** | VRF callback (`fulfillRandomWords`) | One uint256 seed stored. ~30k gas flat. Token status computed from seeds on read. |
| **Endgame** | Pool reaches ≤4 tokens | `gameFinished = true`. Winners can claim. |
| **Claim** | Each winner calls `claimPrize(tokenId)` | Prize = `prizePool / actualSurvivors`. |

---

## Token Metadata

Each token's `tokenURI()` returns:
```json
{
  "name": "ed4ns #42",
  "image": "https://arweave.net/YOUR_ARTWORK",
  "animation_url": "data:image/svg+xml;base64,...",
  "attributes": [
    { "trait_type": "Status", "value": "Alive" },
    { "trait_type": "Round", "value": 3 },
    { "trait_type": "Alive Count", "value": 12 }
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

---

## Sepolia VRF Config (pre-filled in deploy.js)

| Parameter | Value |
|-----------|-------|
| VRF Coordinator | `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1b` |
| Key Hash (200 Gwei lane) | `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae` |
| `callbackGasLimit` | `50,000` |
| Actual callback gas used | ~25,000–30,000 |

For **mainnet**, use the [Chainlink VRF Supported Networks](https://docs.chain.link/vrf/v2-5/supported-networks#ethereum-mainnet) page to get coordinator address and key hashes. Use the **200 Gwei lane** to minimise the subscription balance requirement.

---

## Security Notes

- `claimPrize` protected by `ReentrancyGuard`
- Double-claim prevented by `prizeClaimed[tokenId]` mapping
- `fulfillRandomWords` verifies `requestId == s_lastRequestId`
- `vrfPending` flag prevents overlapping VRF requests
- `emergencyManualCut` only callable by artist after 24h VRF timeout
- `resetVrfPending` callable by artist after 2h to unlock stuck state
- `emergencyWithdraw` only available after `gameFinished`

---

## Key Admin Functions (post-deploy)

| Function | Description |
|----------|-------------|
| `initializeGame(start, end, uri)` | Lock supply, start game. Call once after OE closes. |
| `setArtworkURI(uri)` | Update the artwork URL (Arweave/IPFS). |
| `setArtworkDimensions(w, h)` | Set artwork pixel dimensions for SVG border scaling. |
| `setCallbackGasLimit(gas)` | Adjust VRF callback gas limit. |
| `setSubscriptionId(id)` | Update Chainlink subscription ID. |
| `setMinCutInterval(secs)` | Adjust cooldown between cuts. |
| `resetVrfPending()` | Unstick VRF after 2h timeout. |
| `emergencyManualCut(seed)` | Manual cut if VRF broken, after 24h. |
| `emergencyWithdraw()` | Recover dust ETH after game ends. |
