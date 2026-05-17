/**
 * Shared types — the contract between lib/wallet and lib/security.
 * Per ARCHITECTURE.md §3.2, lib/wallet may only see lib/security through
 * the SecurityLayer interface declared here. Keep this file free of any
 * runtime dependencies on either wallet or security implementations.
 */

export type Hex = `0x${string}`;

/**
 * A single user intent. Phase 3 batching becomes Intent[].
 */
export type Intent = {
  to: Hex;
  value: bigint;
  data: Hex;
};

export type RiskLevel = "safe" | "caution" | "danger" | "unknown";

export type DecodedCall = {
  protocol: string;
  method: string;
  summary: string;
  args: Record<string, unknown>;
};

export type AssetDiffEntry = {
  asset: Hex | "native";
  symbol?: string;
  decimals?: number;
  delta: bigint;
};

export type Reason = {
  code: string;
  message: string;
};

export type Verdict = {
  summary: string;
  riskLevel: RiskLevel;
  reasons: Reason[];
  decoded: DecodedCall[];
  simulatedDiff?: AssetDiffEntry[];
  raw: unknown;
};

export type EvalCtx = {
  chainId: number;
  sender: Hex;
  blockNumber?: bigint;
};

/**
 * The one-way door between wallet and security.
 * wallet only ever receives a SecurityLayer; it never sees the concrete impl.
 */
export interface SecurityLayer {
  evaluate(intent: Intent, ctx: EvalCtx): Promise<Verdict>;
}
