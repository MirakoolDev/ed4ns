const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀 Deploying standalone ed4ns contract to ${network}...\n`);

  const [deployer] = await hre.ethers.getSigners();
  const artistAddress = process.env.ARTIST_ADDRESS || deployer.address;
  const mintPrice = hre.ethers.parseEther("0.01"); // 0.01 ETH mint price

  const now = Math.floor(Date.now() / 1000);
  const mintOpenTime = now;
  const mintCloseTime = now + 24 * 60 * 60; // 24 hour mint phase by default
  const minCutInterval = 4 * 60; // 4 minutes interval for cuts cooldown

  console.log("Deployer:        ", deployer.address);
  console.log("Artist/Recipient:", artistAddress);
  console.log("Mint Price:      ", hre.ethers.formatEther(mintPrice), "ETH");
  console.log("Min Cut Interval:", minCutInterval, "seconds");

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

  console.log("\n✅ Standalone ed4ns contract deployed successfully!");
  console.log("Contract Address:", contractAddress);
  console.log("\n─── Next Steps ───────────────────────────────────────────────");
  console.log("1. Verify the contract on Etherscan (optional):");
  console.log(`   npx hardhat verify --network ${network} ${contractAddress} \\`);
  console.log(`     "${artistAddress}" "${mintPrice.toString()}" "${mintOpenTime}" \\`);
  console.log(`     "${mintCloseTime}" "${minCutInterval}"`);
  console.log("2. Update your frontend/src/config.ts with the Contract Address:");
  console.log(`   export const EXTENSION_ADDRESS = "${contractAddress}";`);
  console.log("──────────────────────────────────────────────────────────────\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
