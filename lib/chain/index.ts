/**
 * Chain configuration and client construction.
 *
 * Single source of truth for chain id, RPC URL, bundler URL, paymaster URL,
 * and EntryPoint address. viem/Pimlico clients land in Slice 1A.
 *
 * Phase 1+2 is Base Sepolia only (ARCHITECTURE.md §4).
 */
export const CHAIN = {
  id: 84532,
  name: "Base Sepolia",
  explorerUrl: "https://sepolia.basescan.org",
} as const;
