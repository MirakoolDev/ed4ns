const { ethers } = require("ethers");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
  const factoryAbi = ["function getGames() view returns (address[])"];
  const factory = new ethers.Contract("0x26F8fF5cC843528bA4b0a922Ac8084b0BA3F53cB", factoryAbi, provider);
  const games = await factory.getGames();
  const latestGame = games[games.length - 1];
  console.log("Latest game:", latestGame);
  
  const tokenAbi = ["function tokenURI(uint256) view returns (string)"];
  const token = new ethers.Contract(latestGame, tokenAbi, provider);
  const uri = await token.tokenURI(4155);
  
  if (uri.startsWith("data:application/json;base64,")) {
    const json = Buffer.from(uri.split(",")[1], "base64").toString("utf-8");
    console.log("\nDecoded JSON:");
    console.log(json);
  } else {
    console.log("URI:", uri);
  }
}
main();
