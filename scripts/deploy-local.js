const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🚀 Starting local standalone deployment of ed4ns for testing...\n");

  const [deployer] = await hre.ethers.getSigners();
  const artistAddress = deployer.address;
  const mintPrice = hre.ethers.parseEther("0.01"); // 0.01 ETH

  const now = Math.floor(Date.now() / 1000);
  const mintOpenTime = now - 60; // Open 1 minute ago
  const mintCloseTime = now + 24 * 60 * 60; // Closes in 24 hours
  const minCutInterval = 60; // 60 seconds interval for rapid local testing!

  console.log("Deployer / Artist: ", artistAddress);
  console.log("Mint Price:        ", hre.ethers.formatEther(mintPrice), "ETH");
  console.log("Min Cut Interval:  ", minCutInterval, "seconds");

  // Deploy standalone ed4ns contract
  console.log("\nDeploying standalone ed4ns contract...");
  const Ed4ns = await hre.ethers.getContractFactory("ed4ns");
  const contract = await Ed4ns.deploy(
    artistAddress,
    mintPrice,
    mintOpenTime,
    mintCloseTime,
    minCutInterval
  );

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log("ed4ns deployed to:", contractAddress);

  // Write contract address directly to frontend config.ts
  const configPath = path.join(__dirname, "..", "frontend", "src", "config.ts");
  const configContent = `export const NFT_ADDRESS = "${contractAddress}"; // Deployed standalone ed4ns contract address
export const EXTENSION_ADDRESS = NFT_ADDRESS;
export const CORE_ADDRESS = NFT_ADDRESS;
`;
  
  fs.writeFileSync(configPath, configContent, "utf8");
  console.log(`\nUpdated frontend/src/config.ts with local ed4ns address: ${contractAddress}`);

  console.log("\n─── Local Standalone Environment Ready ───────────────────────");
  console.log(`1. ed4ns Contract:   ${contractAddress}`);
  console.log(`2. Cut cooldown:     ${minCutInterval} seconds`);
  console.log("──────────────────────────────────────────────────────────────\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
