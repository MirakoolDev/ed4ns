const hre = require("hardhat");

async function main() {
  const extensionAddress = "0xeb34Eb5Fd9fB03A4889Ca3fa980A1a0Fd89E4c5A";
  console.log("Querying contract at:", extensionAddress);

  const SurvivorExtension = await hre.ethers.getContractAt("SurvivorExtension", extensionAddress);

  try {
    const artworkURI = await SurvivorExtension.artworkURI();
    console.log("Artwork URI (raw):", artworkURI);
  } catch (e) {
    console.log("Failed to query artworkURI:", e.message);
  }

  try {
    const startTokenId = await SurvivorExtension.startTokenId();
    const endTokenId = await SurvivorExtension.endTokenId();
    console.log(`Token range: ${startTokenId.toString()} - ${endTokenId.toString()}`);
  } catch (e) {
    console.log("Failed to query token range:", e.message);
  }

  try {
    const vrfPending = await SurvivorExtension.vrfPending();
    console.log("VRF Pending state:", vrfPending);
  } catch (e) {
    console.log("Failed to query vrfPending:", e.message);
  }

  try {
    const roundCount = await SurvivorExtension.roundCount();
    console.log("Round Count:", roundCount.toString());
  } catch (e) {
    console.log("Failed to query roundCount:", e.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
