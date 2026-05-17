import type {
  EvalCtx,
  Intent,
  SecurityLayer,
  Verdict,
} from "@/lib/shared";

/**
 * Composition root for the security layer. Pure: (intent, ctx) -> verdict.
 * Implementation lands in Phase 2 (simulator + decoder + reputation + risk engine).
 *
 * The Phase 1 stub returns riskLevel='unknown' so that the wallet's
 * fail-closed path is exercised end-to-end before Phase 2 work begins.
 */
export function createSecurityLayer(): SecurityLayer {
  return {
    async evaluate(intent: Intent, _ctx: EvalCtx): Promise<Verdict> {
      return {
        summary: `Intent: send ${intent.value} wei to ${intent.to}`,
        riskLevel: "unknown",
        reasons: [
          {
            code: "SECURITY_LAYER_NOT_IMPLEMENTED",
            message: "Security layer ships in Phase 2.",
          },
        ],
        decoded: [],
        raw: { intent },
      };
    },
  };
}
