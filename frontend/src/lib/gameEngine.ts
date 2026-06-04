import { keccak256 } from "viem";

/**
 * Pure client-side replication of the on-chain isTokenAlive shuffle.
 *
 * Mirrors ed4ns.sol::isTokenAlive() exactly, but computed for ALL tokens
 * at once instead of one at a time.
 *
 * The contract tracks each token's "pool position index" through successive
 * rounds. We do the same here by maintaining a `slots` array:
 *   slots[poolPosition] = globalTokenIndex (0-based)
 *
 * Each round we apply the same partial Fisher-Yates swap to `slots`,
 * then eliminate all positions >= survivors, and truncate.
 *
 * Required inputs (tiny — just a handful of RPC calls):
 *   - totalSupply    (1 RPC call)
 *   - roundCount     (1 RPC call)
 *   - roundSeeds[r]  (1 RPC call per round played; usually 0-20 total)
 */

const FINAL_SURVIVORS = 4;

/**
 * Compute keccak256(abi.encode(seed, i)).
 * Solidity abi.encode pads both uint256 to 32 bytes each = 64 bytes total.
 */
function hashSeedIndex(seed: bigint, i: number): bigint {
  const seedHex = seed.toString(16).padStart(64, "0");
  const iHex = BigInt(i).toString(16).padStart(64, "0");
  const encoded = `0x${seedHex}${iHex}` as `0x${string}`;
  return BigInt(keccak256(encoded));
}

export type TokenStatus = "alive" | "eliminated";

export interface TokenStatusMap {
  [tokenId: number]: TokenStatus;
}

/**
 * Compute alive/eliminated for every token.
 * Returns a map: tokenId (1-indexed) → "alive" | "eliminated"
 */
export function computeAllStatuses(
  totalSupply: number,
  roundSeeds: bigint[],
  roundCount: number
): TokenStatusMap {
  // Before any rounds, every minted token is alive.
  if (totalSupply === 0) return {};

  if (roundCount === 0) {
    const result: TokenStatusMap = {};
    for (let id = 1; id <= totalSupply; id++) result[id] = "alive";
    return result;
  }

  /**
   * slots[poolPosition] = globalTokenIndex (0-based, i.e. tokenId - 1)
   *
   * This is the exact same "index" that Solidity tracks per token, but
   * we maintain it for all tokens simultaneously via the inverse mapping.
   *
   * Invariant: after each round, `slots` contains only the surviving tokens
   * in their shuffled pool order, ready for the next round.
   */
  const slots: number[] = Array.from({ length: totalSupply }, (_, i) => i);

  // eliminated[globalTokenIndex] = true when that token is out
  const eliminated = new Uint8Array(totalSupply);

  let poolSize = totalSupply;

  for (let r = 0; r < roundCount; r++) {
    // Mirror exactly: survivors = (poolSize + 1) / 2, min FINAL_SURVIVORS
    let survivors = Math.floor((poolSize + 1) / 2);
    if (survivors < FINAL_SURVIVORS) survivors = FINAL_SURVIVORS;

    const seed = roundSeeds[r];

    /**
     * Partial Fisher-Yates shuffle — mirror of the Solidity loop:
     *   for (uint256 i = 0; i < survivors; i++) {
     *     uint256 j = i + keccak256(abi.encode(seed, i)) % (poolSize - i);
     *     swap(index, i, j);   // only swaps if index == i or index == j
     *   }
     *
     * In slot terms: we swap slots[i] with slots[j].
     * This is equivalent to running isTokenAlive for every token at once.
     */
    for (let i = 0; i < survivors; i++) {
      const h = hashSeedIndex(seed, i);
      const j = i + Number(h % BigInt(poolSize - i));
      // swap
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }

    // Positions [survivors, poolSize) are eliminated this round
    for (let s = survivors; s < poolSize; s++) {
      eliminated[slots[s]] = 1;
    }

    // Truncate pool for next round — surviving tokens keep their shuffled order
    slots.length = survivors;
    poolSize = survivors;
  }

  // Build result map
  const result: TokenStatusMap = {};
  for (let id = 1; id <= totalSupply; id++) {
    result[id] = eliminated[id - 1] ? "eliminated" : "alive";
  }
  return result;
}
