/**
 * Verify gameEngine.ts against the live contract.
 * Run: node scripts/verify_engine.mjs
 */
import { createPublicClient, http, keccak256 } from "viem";
import { sepolia } from "viem/chains";

// ── Config ───────────────────────────────────────────────────────────────────
// Paste your game contract address here:
const NFT_ADDRESS = process.argv[2];
if (!NFT_ADDRESS) {
  console.error("Usage: node scripts/verify_engine.mjs <NFT_ADDRESS>");
  process.exit(1);
}

const NFT_ABI = [
  { name: "totalSupply",   type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "roundCount",    type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "getRoundSeed",  type: "function", inputs: [{ name: "roundIndex", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "isTokenAlive",  type: "function", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "gameFinished",  type: "function", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
];

// ── Mirror of gameEngine.ts ───────────────────────────────────────────────────
const FINAL_SURVIVORS = 4;

function hashSeedIndex(seed, i) {
  const seedHex = seed.toString(16).padStart(64, "0");
  const iHex = BigInt(i).toString(16).padStart(64, "0");
  const encoded = `0x${seedHex}${iHex}`;
  return BigInt(keccak256(encoded));
}

function computeAllStatuses(totalSupply, roundSeeds, roundCount) {
  if (totalSupply === 0) return {};
  if (roundCount === 0) {
    const r = {};
    for (let id = 1; id <= totalSupply; id++) r[id] = "alive";
    return r;
  }

  const slots = Array.from({ length: totalSupply }, (_, i) => i);
  const eliminated = new Uint8Array(totalSupply);
  let poolSize = totalSupply;

  for (let r = 0; r < roundCount; r++) {
    let survivors = Math.floor((poolSize + 1) / 2);
    if (survivors < FINAL_SURVIVORS) survivors = FINAL_SURVIVORS;
    const seed = roundSeeds[r];
    for (let i = 0; i < survivors; i++) {
      const h = hashSeedIndex(seed, i);
      const j = i + Number(h % BigInt(poolSize - i));
      const tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp;
    }
    for (let s = survivors; s < poolSize; s++) eliminated[slots[s]] = 1;
    slots.length = survivors;
    poolSize = survivors;
  }

  const result = {};
  for (let id = 1; id <= totalSupply; id++) {
    result[id] = eliminated[id - 1] ? "eliminated" : "alive";
  }
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const client = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
});

const addr = NFT_ADDRESS;

const totalSupply = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "totalSupply" });
const roundCount  = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "roundCount" });
const gameFinished = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "gameFinished" });

console.log(`totalSupply: ${totalSupply}, roundCount: ${roundCount}, gameFinished: ${gameFinished}`);

if (roundCount === 0n) {
  console.log("No rounds played yet — nothing to verify.");
  process.exit(0);
}

// Fetch seeds
const roundSeeds = [];
for (let i = 0n; i < roundCount; i++) {
  const seed = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "getRoundSeed", args: [i] });
  roundSeeds.push(seed);
}
console.log("Seeds:", roundSeeds.map(s => s.toString()));

// Compute locally
const statusMap = computeAllStatuses(Number(totalSupply), roundSeeds, Number(roundCount));

const localAlive = Object.entries(statusMap).filter(([,v]) => v === "alive").map(([k]) => Number(k));
console.log(`\nLocal engine says ${localAlive.length} alive tokens:`, localAlive.join(", "));

// Spot check: verify every alive token against the contract
console.log("\nVerifying against contract (checking all alive tokens)...");
let mismatches = 0;
for (const tokenId of localAlive) {
  const onChain = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "isTokenAlive", args: [BigInt(tokenId)] });
  if (!onChain) {
    console.error(`  ❌ Token #${tokenId}: local=alive, contract=ELIMINATED`);
    mismatches++;
  }
}

// Also spot check 20 eliminated tokens
const localElim = Object.entries(statusMap).filter(([,v]) => v === "eliminated").map(([k]) => Number(k)).slice(0, 20);
for (const tokenId of localElim) {
  const onChain = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "isTokenAlive", args: [BigInt(tokenId)] });
  if (onChain) {
    console.error(`  ❌ Token #${tokenId}: local=eliminated, contract=ALIVE`);
    mismatches++;
  }
}

if (mismatches === 0) {
  console.log(`\n✅ All ${localAlive.length} alive + ${localElim.length} spot-checked eliminated tokens match the contract!`);
} else {
  console.log(`\n❌ ${mismatches} mismatches found. Engine has a bug!`);
}
