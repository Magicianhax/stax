// Minimal viem ABIs (as const) for the Stax invest pipeline on Mantle (chainId 5000).
// Kept intentionally small — only the functions/events the app actually calls.

/**
 * StaxExecutor.investWithAI — the single entrypoint that pulls USDC, swaps each leg
 * through the leg.router, enforces minOut, and forwards the bought tokens to the caller.
 * Structs mirror the deployed contract exactly (see SPEC / task brief).
 */
export const STAX_EXECUTOR_ABI = [
  {
    type: "function",
    name: "investWithAI",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "plan",
        type: "tuple",
        components: [
          { name: "planId", type: "bytes32" },
          { name: "recHash", type: "bytes32" },
          { name: "riskScore", type: "uint16" },
          { name: "agentId", type: "uint256" },
        ],
      },
      {
        name: "inf",
        type: "tuple",
        components: [
          { name: "assessedRisk", type: "uint16" },
          { name: "maxRisk", type: "uint16" },
          { name: "expiry", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
      {
        name: "legs",
        type: "tuple[]",
        components: [
          { name: "router", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "usdcIn", type: "uint256" },
          { name: "minOut", type: "uint256" },
          { name: "swapData", type: "bytes" },
        ],
      },
      { name: "usdcTotal", type: "uint256" },
    ],
    outputs: [],
  },
  // ---- admin (owner = deployer) ----
  {
    type: "function",
    name: "setRouter",
    stateMutability: "nonpayable",
    inputs: [
      { name: "r", type: "address" },
      { name: "ok", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAssets",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokens", type: "address[]" },
      { name: "ok", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "routerAllowed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "assetAllowed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  // ---- events (mirror the deployed StaxExecutor exactly) ----
  {
    type: "event",
    name: "RecommendationCommitted",
    inputs: [
      { name: "planId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "recHash", type: "bytes32", indexed: false },
      { name: "riskScore", type: "uint16", indexed: false },
      { name: "agentId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LegFilled",
    inputs: [
      { name: "planId", type: "bytes32", indexed: true },
      { name: "tokenOut", type: "address", indexed: true },
      { name: "usdcIn", type: "uint256", indexed: false },
      { name: "received", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AllocationExecuted",
    inputs: [
      { name: "planId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "usdcSpent", type: "uint256", indexed: false },
      { name: "legCount", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * InferenceVerifier.verify — reverts unless ECDSA signer == agentSigner,
 * assessedRisk <= maxRisk, and block.timestamp <= expiry.
 */
export const INFERENCE_VERIFIER_ABI = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "planId", type: "bytes32" },
      { name: "assessedRisk", type: "uint16" },
      { name: "maxRisk", type: "uint16" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "agentSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** IdentityRegistry — reputation + metadata for the Stax agent (agentId 1). */
export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "reputationScore",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** Standard ERC20 surface the app reads/writes. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/**
 * Fluxion router — VERIFIED on Mantlescan (Etherscan V2, chainid 5000) on 2026-06-01.
 * It is a standard Uniswap-V3 `ISwapRouter`. The function we use:
 *
 *   exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient,
 *                      uint256 deadline, uint256 amountIn, uint256 amountOutMinimum,
 *                      uint160 sqrtPriceLimitX96)) returns (uint256 amountOut)
 *
 * The router also exposes exactInput/exactOutput/exactOutputSingle and the V3 callback,
 * but exactInputSingle is all the MVP needs (single-hop USDC -> xStock, fee tier 3000).
 */
export const FLUXION_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/**
 * Agni Finance router — VERIFIED on Mantlescan (Etherscan V2, chainid 5000) on 2026-06-01.
 * Standard Uniswap-V3 `ISwapRouter`. Used for the SAFE/CRYPTO multi-hop legs
 * (USDC -> intermediate -> sUSDe / mETH) in a SINGLE call, so the executor's
 * balance-delta forwarding stays correct.
 *
 *   exactInput((bytes path, address recipient, uint256 deadline,
 *               uint256 amountIn, uint256 amountOutMinimum)) returns (uint256)
 *
 * `path` is abi.encodePacked(tokenIn, uint24 fee, token, uint24 fee, ..., tokenOut).
 */
export const AGNI_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/** Uniswap-V3 pool reads used for off-chain quoting (no standalone Quoter deployed). */
export const V3_POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
