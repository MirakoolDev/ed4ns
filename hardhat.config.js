require("@nomicfoundation/hardhat-toolbox");
require("hardhat-contract-sizer");
require("dotenv").config({ path: [".env.local", ".env"] });

const SEPOLIA_RPC_URL   = process.env.SEPOLIA_RPC_URL   || "https://ethereum-sepolia-rpc.publicnode.com";
const BASE_RPC_URL      = process.env.BASE_RPC_URL      || "https://mainnet.base.org";
const MAINNET_RPC_URL   = process.env.MAINNET_RPC_URL   || "https://eth.llamarpc.com";
const PRIVATE_KEY       = process.env.PRIVATE_KEY       || "0x" + "0".repeat(64);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const BASESCAN_API_KEY  = process.env.BASESCAN_API_KEY  || "";

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
