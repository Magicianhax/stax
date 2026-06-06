# Stax — web app

The Next.js PWA for Stax. **See the full project README at [`../README.md`](../README.md)**
for what Stax is, the verifiable AI × on-chain loop, deployed contract addresses, and architecture.

## Run

```bash
npm install
cp .env.example .env.local   # fill in the keys (Privy, Pimlico, Anthropic, agent signer, Etherscan, contract addresses)
npm run dev                  # http://localhost:3000  ·  /app is the product
```

Scripts: `dev` · `build` · `start` · `lint`. Stack: Next.js 16 (App Router) · Tailwind v4 ·
Privy · Pimlico/permissionless (gasless ERC-4337) · viem/wagmi · Anthropic AI SDK.
