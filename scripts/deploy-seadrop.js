const hre = require("hardhat");

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀 Deploying ed4nsSeaDrop to ${network}...\n`);

  const [deployer] = await hre.ethers.getSigners();
  const artistAddress = deployer.address; // Change to your preferred wallet
  const protocolAddress = "0xa0a6e5C0F17DA5e5337C9CD5bf353C61BA375c0D"; // Default protocol fee recipient

  console.log("Deployer:         ", deployer.address);

  // Define GameConfig struct for constructor
  const config = {
    name: "ed4ns SeaDrop Edition",
    symbol: "ED4NS-SD",
    description: "An open-edition NFT survival game.",
    artworkURI: "ipfs://...", // Update with your base artwork
    artist: artistAddress,
    protocol: protocolAddress,
    minCutInterval: 240, // 4 minutes
    prizePoolSharePercent: 65,
  };

  const Ed4nsSeaDrop = await hre.ethers.getContractFactory("ed4nsSeaDrop");
  const allowedSeaDrop = ["0x00005EA00Ac477B1030CE78506496e8C2dE24bf5"]; // Official SeaDrop
  const contract = await Ed4nsSeaDrop.deploy(config, allowedSeaDrop);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log("\n✅ ed4nsSeaDrop deployed successfully!");
  console.log("Contract Address: ", contractAddress);
  
  console.log("\n─── Next Steps ───────────────────────────────────────────────");
  console.log("1. Add this contract address to your STANDALONE_GAMES array in frontend/src/config.ts");
  console.log("2. Open this address on OpenSea Studio to configure the drop schedule and allowlists.");
  console.log("3. Once the mint is over, use your frontend Creator Admin panel to Initialize Arena!");
  console.log("──────────────────────────────────────────────────────────────\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
