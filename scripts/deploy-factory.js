/**
 * deploy-factory.js
 * Deploys Ed4nsFactory to the target network.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-factory.js --network sepolia
 *   npx hardhat run scripts/deploy-factory.js --network base
 *   npx hardhat run scripts/deploy-factory.js --network mainnet
 *
 * Required env vars (in .env):
 *   PRIVATE_KEY          - deployer private key (0x...)
 *   SEPOLIA_RPC_URL      - or BASE_RPC_URL / MAINNET_RPC_URL
 *   PROTOCOL_ADDRESS     - wallet that receives the 10% protocol fee
 *   ETHERSCAN_API_KEY    - for auto-verification (optional)
 */

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const protocolAddress = process.env.PROTOCOL_ADDRESS;
  if (!protocolAddress || protocolAddress === "0x" + "0".repeat(40)) {
    throw new Error("Set PROTOCOL_ADDRESS in your .env file first!");
  }

  console.log("\nDeploying Ed4nsFactory...");
  console.log("Protocol wallet:", protocolAddress);

  const Factory = await ethers.getContractFactory("Ed4nsFactory");
  const factory = await Factory.deploy(protocolAddress);
  await factory.waitForDeployment();

  const addr = await factory.getAddress();
  console.log("\n✅ Ed4nsFactory deployed to:", addr);
  console.log("\nAdd this to frontend/src/config.ts:");
  console.log(`  FACTORY_ADDRESS    = "${addr}"`);
  console.log(`  PROTOCOL_ADDRESS   = "${protocolAddress}"`);
  console.log(`  AUTHORIZED_CREATOR = "${deployer.address}"`);

  // Auto-verify on Etherscan if API key is set
  if (process.env.ETHERSCAN_API_KEY && process.env.ETHERSCAN_API_KEY.length > 0) {
    console.log("\nWaiting 10s for Etherscan to index the deployment...");
    await new Promise((r) => setTimeout(r, 10000));
    try {
      await hre.run("verify:verify", {
        address: addr,
        constructorArguments: [protocolAddress],
      });
      console.log("✅ Verified on Etherscan!");
    } catch (e) {
      console.log("⚠️  Verification failed (can retry manually):", e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
