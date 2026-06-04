const { ethers } = require("ethers");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
  const abi = ["function tokenURI(uint256) view returns (string)"];
  const contract = new ethers.Contract("0x58a8d0B312a1DcE5Bc2C2739d0E349f33f5F8710", abi, provider);
  const uri = await contract.tokenURI(200);
  console.log("Raw URI:");
  console.log(uri.substring(0, 100) + "...");
  
  if (uri.startsWith("data:application/json;base64,")) {
    const json = Buffer.from(uri.split(",")[1], "base64").toString("utf-8");
    console.log("\nDecoded JSON:");
    console.log(json);
  } else if (uri.startsWith("http")) {
    console.log("\nIt's an HTTP URL:", uri);
  }
}
main();
