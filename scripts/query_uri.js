const { ethers } = require("ethers");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
  const abi = ["function tokenURI(uint256) view returns (string)"];
  const contract = new ethers.Contract("0x3fc82d9C90bb75C787C7605DA460dbc2E56Ad647", abi, provider);
  const uri = await contract.tokenURI(1230);
  console.log("Raw URI:");
  console.log(uri.substring(0, 100) + "...");
  
  if (uri.startsWith("data:application/json;base64,")) {
    const json = Buffer.from(uri.split(",")[1], "base64").toString("utf-8");
    console.log("\nDecoded JSON:");
    console.log(json);
  }
}
main();
