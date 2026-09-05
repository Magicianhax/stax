import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun", // Base (OP Stack) and Mantle both support Cancun (mcopy/tstore); required by OZ 5.6
    },
  },
  networks: {
    // Base is the primary chain.
    base: {
      url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      chainId: 8453,
      accounts,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
    mantle: {
      url: process.env.MANTLE_RPC_URL ?? "https://rpc.mantle.xyz",
      chainId: 5000,
      accounts,
    },
    mantleSepolia: {
      url: process.env.MANTLE_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.mantle.xyz",
      chainId: 5003,
      accounts,
    },
  },
  // Etherscan V2: ONE API key verifies across chains. Register every chain explicitly against the
  // V2 unified endpoint (the plugin appends chainid automatically) so Basescan and Mantlescan both
  // go through the same key.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: { apiURL: "https://api.etherscan.io/v2/api", browserURL: "https://basescan.org" },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: { apiURL: "https://api.etherscan.io/v2/api", browserURL: "https://sepolia.basescan.org" },
      },
      {
        network: "mantle",
        chainId: 5000,
        urls: { apiURL: "https://api.etherscan.io/v2/api", browserURL: "https://mantlescan.xyz" },
      },
    ],
  },
};

export default config;
