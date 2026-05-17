import type { Hex, Intent, SecurityLayer, Verdict } from "@/lib/shared";

export type TxResult = {
  userOpHash: Hex;
  txHash?: Hex;
};

export interface WalletCore {
  proposeTransaction(intent: Intent): Promise<{
    verdict: Verdict;
    signAndSend: () => Promise<TxResult>;
  }>;
}

/**
 * Composition root for the wallet. Receives a SecurityLayer via DI; never
 * imports from lib/security/* (enforced by eslint-plugin-boundaries).
 *
 * Implementation lands in Phase 1, Slice 1A.
 */
export function createWalletCore(_deps: {
  security: SecurityLayer;
}): WalletCore {
  throw new Error(
    "WalletCore: not implemented yet (Phase 1, Slice 1A). See ARCHITECTURE.md §5.",
  );
}
