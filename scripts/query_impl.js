const { ethers } = require("hardhat");

async function main() {
  const factory = await ethers.getContractAt("Ed4nsFactory", "0x26F8fF5cC843528bA4b0a922Ac8084b0BA3F53cB");
  const impl = await factory.implementation();
  console.log("Implementation address:", impl);
}

main().catch(console.error);
