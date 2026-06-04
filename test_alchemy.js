const { ethers } = require("ethers");

async function testAlchemy() {
  const url = `https://eth-sepolia.g.alchemy.com/v2/emnEGnbxj6YbYE84abeL3`;
  try {
    const provider = new ethers.JsonRpcProvider(url);
    const network = await provider.getNetwork();
    console.log("Success! Connected to:", network.name);
  } catch (error) {
    console.error("Failed to connect:");
    console.error(error.message);
  }
}

testAlchemy();
