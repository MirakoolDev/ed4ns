require("@nomicfoundation/hardhat-toolbox");
require("hardhat-contract-sizer");
require("hardhat-preprocessor");
require("dotenv").config({ path: [".env.local", ".env"] });
const fs = require("fs");
const path = require("path");

const SEPOLIA_RPC_URL   = process.env.SEPOLIA_RPC_URL   || "https://ethereum-sepolia-rpc.publicnode.com";
const BASE_RPC_URL      = process.env.BASE_RPC_URL      || "https://mainnet.base.org";
const MAINNET_RPC_URL   = process.env.MAINNET_RPC_URL   || "https://eth.llamarpc.com";
const PRIVATE_KEY       = process.env.PRIVATE_KEY       || "0x" + "0".repeat(64);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const BASESCAN_API_KEY  = process.env.BASESCAN_API_KEY  || "";

// Read remappings for the preprocessor
const rootDir = __dirname;
const remappings = fs.existsSync("remappings.txt")
  ? fs
      .readFileSync("remappings.txt", "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.trim().split("="))
  : [];

let lastFile = "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  preprocess: {
    eachLine: (hre) => ({
      transform: (line, fileInfo) => {
        const filePath = typeof fileInfo === "string" ? fileInfo : (fileInfo && fileInfo.absolutePath ? fileInfo.absolutePath : "");
        if (filePath && filePath !== lastFile) {
          console.log("PREPROCESS FILE:", filePath);
          lastFile = filePath;
        }
        if (line.match(/^\s*pragma\s+solidity/)) {
          return "pragma solidity ^0.8.24;";
        }
        if (line.match(/import|from/)) {
          if (!filePath) return line;
          const fileDir = path.dirname(filePath);
          const relPathToRoot = path.relative(fileDir, rootDir);
          for (const [from, to] of remappings) {
            if (from && to && line.includes(from)) {
              let resolvedTo = path.join(relPathToRoot, to).replace(/\\/g, "/");
              if (!resolvedTo.startsWith(".")) {
                resolvedTo = "./" + resolvedTo;
              }
              const newLine = line.replace(from, resolvedTo);
              console.log(`REPLACE: ${line.trim()} => ${newLine.trim()}`);
              return newLine;
            }
          }
        }
        return line;
      },
    }),
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY !== "0x" + "0".repeat(64) ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
    base: {
      url: BASE_RPC_URL,
      accounts: PRIVATE_KEY !== "0x" + "0".repeat(64) ? [PRIVATE_KEY] : [],
      chainId: 8453,
    },
    mainnet: {
      url: MAINNET_RPC_URL,
      accounts: PRIVATE_KEY !== "0x" + "0".repeat(64) ? [PRIVATE_KEY] : [],
      chainId: 1,
    },
  },
  etherscan: {
    apiKey: {
      sepolia:  ETHERSCAN_API_KEY,
      mainnet:  ETHERSCAN_API_KEY,
      base:     BASESCAN_API_KEY,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
};
