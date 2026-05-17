# Argus — Architecture Document

> A security-first EVM smart wallet. Account model: EIP-7702. Gasless via ERC-4337. Differentiator: every transaction is simulated, decoded into plain English, and risk-flagged before the user signs.

**Status:** Pre-implementation design. This document is the source of truth for the build; no code yet. It will need a revision pass after Phase 1+2 ships, because the EIP-7702 tooling ecosystem in 2026 is still moving fast and some choices here will look obvious or wrong in hindsight.

**Design priority:** modularity and failure containment over completeness or "future-proofness." The security layer must fail closed without taking the wallet down with it. Every external dependency must have a named fallback.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Module Boundaries & Failure Containment](#3-module-boundaries--failure-containment)
4. [Tech Stack & Rationale](#4-tech-stack--rationale)
5. [Phase Breakdown](#5-phase-breakdown)
6. [Data & State Model](#6-data--state-model)
7. [Assumptions, Risks, and What to Verify Independently](#7-assumptions-risks-and-what-to-verify-independently)
8. [Out-of-Scope Per Phase](#8-out-of-scope-per-phase)

---

## 1. Executive Summary

**Target chain:** Base Sepolia (testnet). Justification in §4.

**Account model:** Each user has an embedded EOA (held by Privy with passkey auth). On first use, the EOA self-issues an EIP-7702 `SET_CODE` authorization delegating its code to a 7702-compatible smart account implementation (Kernel v3.3+ from ZeroDev, or Pimlico's reference 7702 account). The EOA address never changes; smart-account behavior is layered on top via 7702.

**Gasless path:** All user actions are wrapped as ERC-4337 UserOperations against EntryPoint v0.8 (which natively supports 7702 accounts), submitted via the Pimlico bundler, sponsored by the Pimlico verifying paymaster.

**Security layer:** A separate module that intercepts every outbound transaction *before* signing. It calls a server-side proxy (Vercel function) that runs simulation (Alchemy) and reputation lookups (GoPlus), runs a local decoder against the calldata + simulated state diff, scores risk, and renders a human-readable confirmation modal. The user signs only after acknowledging this view.

**Hosting:** Next.js on Vercel free tier. Public demo URL is part of the deliverable.

**Phasing:** Phase 1+2 = minimum portfolio-quality MVP. Phase 3 (batching, session keys, social recovery) and Phase 4 (polish/demo) are sketched but explicitly deferred — they depend on Phase 1+2 outcomes and on 7702 tooling that's still settling.

---

## 2. High-Level Architecture

### 2.1 Component Diagram (ASCII)

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                         BROWSER (Next.js App)                             ║
║                                                                           ║
║   ┌────────────────────────────────────────────────────────────────────┐  ║
║   │                       UI Layer (React)                             │  ║
║   │  Dashboard │ Send │ Receive │ ApprovalsList │ <SignConfirmModal>   │  ║
║   └────────────────────────────────────────────────────────────────────┘  ║
║              │                                  ▲                         ║
║              │ user intent                      │ verdict + render data   ║
║              ▼                                  │                         ║
║   ┌─────────────────────────┐         ┌─────────────────────────────────┐ ║
║   │   Core Wallet Module    │  pre-   │   Security Layer (decoupled)    │ ║
║   │   (`/wallet`)           │ ──sign─▶│   (`/security`)                 │ ║
║   │                         │  hook   │                                 │ ║
║   │  • Account state        │         │  • Pre-sign interceptor         │ ║
║   │  • Tx → UserOp builder  │◀── tx ──│  • Simulator client (calls API) │ ║
║   │  • 7702 upgrade logic   │ verdict │  • Calldata decoder (pluggable) │ ║
║   │  • 4337 send loop       │         │  • Risk engine (rules + scoring)│ ║
║   │  • Balance / nonce      │         │  • Reputation cache             │ ║
║   └────────────┬────────────┘         └────────────┬────────────────────┘ ║
║                │ signing requests                  │ HTTPS to /api/*      ║
║                ▼                                   │                      ║
║   ┌─────────────────────────┐                      │                      ║
║   │   Privy SDK             │                      │                      ║
║   │   (embedded EOA,        │                      │                      ║
║   │    passkey/email auth)  │                      │                      ║
║   └────────────┬────────────┘                      │                      ║
║                │                                   │                      ║
╚════════════════╪═══════════════════════════════════╪══════════════════════╝
                 │ raw signatures                    │
                 │                                   │
                 │                  ┌────────────────┴───────────────┐
                 │                  │                                │
                 │           ┌──────▼───────┐                ┌───────▼──────┐
                 │           │ VERCEL EDGE  │                │ VERCEL EDGE  │
                 │           │ /api/simulate│                │ /api/risk    │
                 │           │ (key-bearing │                │ (reputation +│
                 │           │  proxy +     │                │  blocklists) │
                 │           │  KV cache)   │                │              │
                 │           └──────┬───────┘                └───────┬──────┘
                 │                  │                                │
                 │                  ▼                                ▼
                 │        ┌──────────────────┐            ┌────────────────────┐
                 │        │ Alchemy          │            │ GoPlus Security    │
                 │        │ simulateAsset-   │            │ (token/addr risk)  │
                 │        │ Changes /Bundle  │            │ + local allowlist  │
                 │        └──────────────────┘            └────────────────────┘
                 │
                 ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                EXTERNAL BLOCKCHAIN INFRASTRUCTURE                      │
   │                                                                        │
   │   ┌──────────────────┐    ┌──────────────────┐   ┌──────────────────┐  │
   │   │ Pimlico Bundler  │───▶│ EntryPoint v0.8  │──▶│ Base Sepolia RPC │  │
   │   │ + VerifyingPay-  │    │ (4337 + 7702     │   │ (Alchemy primary,│  │
   │   │ master           │    │  native)         │   │  public fallback)│  │
   │   └──────────────────┘    └──────────────────┘   └──────────────────┘  │
   │                                                                        │
   │   On-chain: Kernel v3.3 (or equivalent) 7702 implementation contract   │
   └────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data-flow narrative for the critical path (Phase 1+2)

A "send 10 USDC to alice.eth" tap, step by step:

1. **UI** dispatches `wallet.proposeTransaction({ to, calldata, value })` to the Core Wallet Module.
2. **Core Wallet** builds an unsigned UserOperation (gas estimation against Pimlico bundler, nonce from EntryPoint, paymaster data from Pimlico paymaster).
3. **Core Wallet** emits a `pre-sign` event with the UserOp + decoded intent metadata. The Security Layer is subscribed.
4. **Security Layer** runs two things in parallel:
   - `POST /api/simulate` with the UserOp → returns asset diff (balances before/after for the sender), revert status, and gas estimate from a true simulated execution.
   - `POST /api/risk` with `{ to, calldata, tokenAddresses }` → returns reputation (verified/unverified/known-malicious) and any flagged signatures (e.g., `approve(spender, MAX_UINT256)`).
5. **Security Layer's decoder** parses calldata locally (ERC-20/721/1155 ABI baseline + protocol-specific decoders for Uniswap V3, Permit2, the chosen bridge) and produces a plain-English summary.
6. **Risk engine** combines (decoder output) + (sim diff) + (reputation) → verdict object: `{ summary, riskLevel: 'safe'|'caution'|'danger', reasons: string[], rawDiff }`.
7. **UI** receives the verdict and renders the `<SignConfirmModal>`. The modal blocks signing until the user confirms. `danger` requires a typed confirmation phrase.
8. On user confirm, Core Wallet asks Privy to sign the UserOp hash, submits to the bundler, polls for inclusion, updates state.
9. On revert/timeout, the failure is surfaced in the UI and the original intent stays in a "retry" state. No state corruption.

**Failure-mode contract:** if `/api/simulate` times out or errors, the Security Layer returns a verdict with `riskLevel: 'unknown'` and a clear "simulation unavailable" message. The UI **defaults to disabling the sign button** in this state for Phase 1+2 (fail-closed). A power-user override is Phase 4 polish.

---

## 3. Module Boundaries & Failure Containment

The non-negotiable seam is between **Core Wallet** and **Security Layer**. They communicate only through a defined interface, no shared mutable state, and they can be developed/tested in isolation.

### 3.1 Module map

| Module | Path (proposed) | Owns | Depends on |
|---|---|---|---|
| `ui` | `app/`, `components/` | React tree, modals, forms | `wallet` (read-only hooks), `security` (read-only verdicts) |
| `wallet` | `lib/wallet/` | Account state, 7702 upgrade, UserOp build/send, signing requests to Privy | `viem`, `permissionless`, Privy SDK |
| `security` | `lib/security/` | Pre-sign interception, simulation client, decoder, risk engine | `viem` (decode only), `/api/*` clients |
| `api` | `app/api/` | Server-side proxies, key custody, caching | Alchemy SDK, GoPlus REST, Vercel KV |
| `chain` | `lib/chain/` | RPC client, chain config, bundler/paymaster clients | `viem`, `permissionless` |
| `shared` | `lib/shared/` | Types, errors, event bus | none |

### 3.2 The pre-sign hook contract (the most important interface)

```ts
// lib/shared/types.ts
type Intent = {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  // 7702-batched calls become Intent[] in Phase 3
};

type Verdict = {
  summary: string;                       // "Send 10 USDC to 0xalice…"
  riskLevel: 'safe' | 'caution' | 'danger' | 'unknown';
  reasons: { code: string; message: string }[];
  decoded: DecodedCall[];                // structured for UI rendering
  simulatedDiff?: AssetDiff;             // optional — may be absent on 'unknown'
  raw: unknown;                          // for debugging; never UI-rendered directly
};

// lib/security/index.ts
interface SecurityLayer {
  evaluate(intent: Intent, ctx: EvalCtx): Promise<Verdict>;
}

// lib/wallet/index.ts
interface WalletCore {
  // wallet calls security.evaluate() internally; if it throws or times out,
  // wallet substitutes a Verdict with riskLevel='unknown' and proceeds.
  proposeTransaction(intent: Intent): Promise<{ verdict: Verdict; signAndSend: () => Promise<TxResult> }>;
}
```

**Containment rules:**
- `wallet` **must not** import from `security/*` except via the `SecurityLayer` interface. Enforced with an ESLint boundary rule (`eslint-plugin-boundaries`).
- `security` **must not** mutate any wallet state. It is a pure function of `(intent, ctx) → verdict`. (`ctx` is read-only: chain id, sender, current block.)
- If `security.evaluate()` throws or exceeds a 5s timeout, `wallet` synthesizes `{ riskLevel: 'unknown', reasons: [{code: 'SECURITY_LAYER_DOWN', ...}] }` and the UI fails-closed.
- The decoder and risk engine inside `security` are themselves separately testable; each protocol decoder is a small module conforming to a `ProtocolDecoder` interface and registered into a `DecoderRegistry`. Adding a new protocol does not touch existing decoders.

**Why this seam matters in practice:** the security layer is the riskiest code in the app (it talks to external services, parses untrusted calldata, runs heuristics). Keeping it pure and replaceable means a bug there can degrade the experience to "I can still send tx without the safety net" rather than "the wallet is bricked."

---

## 4. Tech Stack & Rationale

Every external dependency lists a fallback. Free-tier terms in this section are **stated as of late 2025 / early 2026 to the best of available knowledge** — see §7 for the explicit verify-before-build list.

### 4.1 Smart-account SDK — **Permissionless.js (Pimlico)**

**Why this and not the alternatives:**
- **Open-source, viem-native, multi-bundler.** Permissionless is the de facto standard AA library in the viem ecosystem; using it signals familiarity with the canonical tooling rather than a vendor-specific SDK.
- **First-class 7702 support.** Pimlico shipped `toSimple7702SmartAccount` and 7702 authorization helpers ahead of most competitors and tracks EntryPoint v0.8 closely.
- **Not locked to one bundler.** You can swap Pimlico's bundler for Alchemy's or Stackup's by changing one client URL. Critical for the "fallback if free tier changes" requirement.
- **Recruiter signal.** Anyone hiring for AA roles in 2026 knows Permissionless; it's name-recognizable in a way that proprietary SDKs aren't.

**Fallback:** **ZeroDev SDK** (`@zerodev/sdk`). Equally strong 7702 support (their Kernel account is one of the most-deployed 7702 implementations), heavier on convenience features (built-in session keys, recovery modules), but more vendor-coupled. Switch to ZeroDev if Pimlico's free tier degrades or if Phase 3 session-key work hits friction.

### 4.2 Bundler + Paymaster — **Pimlico (Base Sepolia)**

**Why:** Pimlico's bundler is reliable on Base Sepolia, their verifying paymaster is the simplest path to sponsored gas, and the free tier is the most generous in the AA market for testnet usage. Same vendor as the SDK = simpler integration in Phase 1.

**Fallback:** **Alchemy Account Kit's bundler + Gas Manager** (free tier on Base Sepolia). Requires a code change but architecture supports it since `chain/` isolates bundler client construction. **Second fallback:** Stackup's public bundler endpoint (no paymaster, so gasless breaks — fall back to user-paid gas in this scenario).

### 4.3 Chain RPC — **Alchemy (Base Sepolia)**

**Why:** Free tier is generous (300M compute units/month as of late 2025, ample for a portfolio app), `alchemy_simulateAssetChanges` doubles as our primary simulation endpoint (single vendor = one fewer key to manage), and reliability is well above public RPCs.

**Fallback:** Base's public RPC endpoint (`https://sepolia.base.org`) for reads. Aggressive client-side caching via TanStack Query reduces RPC pressure regardless of provider.

### 4.4 Frontend — **Next.js (App Router) + React + TypeScript**

**Why:** You're comfortable with it; it's the canonical SSR React stack; the App Router gives us co-located server functions in `app/api/*` (no separate backend project); deploys to Vercel free tier with zero config; Server Components keep the bundle smaller, which matters because viem+Privy+permissionless is already heavy.

**Supporting libraries:**
- **viem** — modern, typed, tree-shakeable. (ethers.js is on the way out for new builds in 2026.)
- **wagmi** — React hooks layered on viem. Use minimally; Privy provides its own hooks and over-stacking the two creates dual-source-of-truth bugs.
- **TanStack Query** — caching layer for read calls and simulation results.
- **Tailwind + shadcn/ui** — fastest path to a clean, recruiter-presentable UI without designing primitives from scratch.
- **Zod** — runtime validation of API responses (esp. for GoPlus and Alchemy sim, which are untrusted shapes from our perspective).

**Fallback:** None needed; this stack is self-hostable on any Node host (Cloudflare Pages, Fly.io free tier, Netlify) if Vercel pricing changes.

### 4.5 Transaction simulation — **Alchemy `simulateAssetChanges` + `simulateExecutionBundle`**

**Why:**
- **True execution simulation against current state**, including post-state asset diffs (balance/allowance changes for the sender). This is what makes the decoded UI honest — we're not guessing what the tx *will* do, we're observing what it *does* do in a forked simulation.
- **Free with the Alchemy account we already need for RPC.** One vendor relationship, one key to rotate.
- **Quality is on par with Tenderly** for the wallet-confirmation use case (where we don't need Tenderly's trace explorer UI, just the diff).

**Fallback:** **Tenderly Simulation API** (free tier, smaller monthly cap — verify current limits per §7). Architecture isolates this behind `lib/security/simulator.ts` so swapping is a one-file change. **Second fallback for total outage:** run a local `eth_call` against the same state with the calldata, which won't give asset diffs but will at least catch reverts; combined with static ABI decoding, the user still gets *some* preview rather than a black box.

### 4.6 Address & token reputation — **GoPlus Security API**

**Why:** Free tier, security-focused, designed exactly for this use case (token security flags, malicious address lists, approval risk signals). Used by major wallets (Trust Wallet, OKX) as a reputation source. Pairs naturally with our risk engine — we feed their signals into our scoring rather than replicating their dataset.

**Fallback:** **Blockaid's public threat feed** (if/when available without partnership) or **maintain a local JSON allowlist + blocklist** committed to the repo, seeded from the Uniswap default token list and Etherscan's known phishing addresses. The local fallback is intentionally weaker but demonstrates the design accommodates degraded reputation data.

### 4.7 Authentication & key custody — **Privy (embedded EOA + passkey)**

This is the most-justified choice in the doc because you asked for "current industry standard most secure" with explicit tradeoff discussion.

**The choice:** Privy's embedded wallet, where:
- The user authenticates with **WebAuthn passkey** (preferred), email-OTP, or Google.
- An **EOA** is generated for them inside Privy's TEE-backed infrastructure (Privy currently uses Shamir-shared key fragments distributed across security domains; user holds one share authenticated via passkey).
- **Privy cannot sign on the user's behalf** without the user's authenticator. Verifiable via their public audits.
- The EOA address is what gets the 7702 delegation. Critically, **the user controls a real EOA**, which is what EIP-7702 requires (7702 delegates an existing EOA to smart-account code; it doesn't replace the EOA).

**Why this is the 2026 industry standard:**
- Consumer wallets (Coinbase Smart Wallet, Phantom, Rainbow, Magic) have converged on "passkey-authenticated, provider-custodied-but-non-spendable, embedded" as the user-friendliest pattern that doesn't compromise non-custodial properties. Pure seed-phrase UX is now a niche / power-user choice.
- Passkeys (WebAuthn / FIDO2) are the strongest broadly-available consumer auth: phishing-resistant, hardware-backed on most devices, no shared secrets.
- Privy specifically is used in production by Friend.tech, Hyperliquid, Pump.fun, etc. — name-recognizable to anyone hiring for crypto frontend roles.

**Tradeoff vs. simpler approaches:**
- **vs. local browser key encrypted with a password:** Simpler, no third party — but single device, no recovery if the device is lost, password is the weakest link, and most reviewers will read it as "toy wallet."
- **vs. pure self-custody with seed phrase:** Most "decentralized" — but UX is brutal, recovery is the user's burden, and 90% of users will lose funds. Not a credible 2026 consumer product choice.
- **vs. Turnkey:** Turnkey's TEE model is arguably *more* cryptographically defensible (signing literally cannot happen outside the enclave without the policy match), but DX is rougher and the free tier is more restrictive. Turnkey is the **fallback**.
- **The honest downside:** Privy is a SaaS dependency. If they pull the free tier or pivot, you have a migration to do. The architecture isolates Privy behind `lib/wallet/signer.ts` so swapping to Turnkey (or eventually to a self-hosted passkey-derived signer) is a contained change, not a rewrite.

**Fallback:** **Turnkey** (free tier, TEE-based, raw signing API supports 7702 authorizations). Second fallback: **passkey-derived AES-encrypted key in IndexedDB** — purely local, no third party, but no cross-device sync and no recovery. Acceptable for demo, not for "real product."

### 4.8 Hosting — **Vercel free tier**

**Why:** Native Next.js, generous free tier (100GB bandwidth, sufficient serverless invocations for a portfolio app), automatic preview deploys on every PR (great for the demo), zero ops. Vercel KV (free tier) is the right place to cache simulation results and contract metadata.

**Fallback:** **Cloudflare Pages + Workers** (free tier is even more generous on invocations, slightly more setup for Next.js compatibility) → second fallback **Fly.io free tier** running a Node container.

### 4.9 Decoder + ABI tooling

- **`viem`'s `decodeFunctionData`** for any contract with a known ABI.
- **Whatsabi** (`@shazow/whatsabi`) for unknown contracts — fetches ABI from Etherscan/Sourcify on the server, caches in Vercel KV. Free tier of Etherscan API suffices.
- **Permit2 SDK** (`@uniswap/permit2-sdk`) for decoding Permit2 calls, which are the most subtle approval risk in modern DeFi and deserve explicit support.
- **Custom protocol decoders** as plug-ins implementing the `ProtocolDecoder` interface (one each for Uniswap V3 SwapRouter02 and the chosen bridge — leaning **Across Protocol** for the bridge example since their contracts are simple and well-documented).

**Fallback:** If Etherscan API is rate-limited, fall back to **Sourcify** (free, decentralized, no key required); if both fail, decoder degrades to "raw calldata + function selector" and the risk engine marks `riskLevel: 'caution'` automatically.

### 4.10 Observability (minimal but present)

- **Vercel Analytics** (free tier) for pageviews.
- **Sentry free tier** (5k errors/month) for client + serverless error tracking. Critical because the security layer's failure mode is silent-degradation, which we need to detect.
- **No PostHog / product analytics in Phase 1+2.** Adds dependencies and privacy surface for no MVP value.

---

## 5. Phase Breakdown

### Phase 1 — Working gasless EIP-7702 wallet (DEEP)

**Goal:** A user can sign in, get an EOA, upgrade it to a 7702 smart account, and send a gas-sponsored transaction on Base Sepolia. No security layer yet.

**Components delivered in Phase 1:**

| Component | Responsibility | Interface to other modules |
|---|---|---|
| `lib/wallet/signer.ts` | Wraps Privy SDK. Exposes `getAddress()`, `signMessage()`, `sign7702Authorization()`, `signUserOpHash()`. | Consumed by `wallet/account.ts` only. |
| `lib/wallet/account.ts` | Builds the 7702 smart account object via Permissionless's `toSimple7702SmartAccount` (or Kernel equivalent). Tracks delegation state (is the EOA delegated yet?). | Consumed by `wallet/transact.ts`. |
| `lib/wallet/transact.ts` | Takes an `Intent`, builds a UserOp, gets paymaster data, sends via bundler, polls EntryPoint for receipt. | Consumed by UI. |
| `lib/chain/clients.ts` | Constructs viem public client, Pimlico bundler client, Pimlico paymaster client. Single source of truth for chain config. | Consumed by `wallet/*`. |
| `app/api/proxy-rpc/route.ts` | Optional thin proxy that hides the Alchemy API key from the client. | UI/wallet talks to `/api/proxy-rpc` rather than Alchemy directly. |
| `app/(wallet)/page.tsx` | Dashboard: shows address, ETH balance, "Send" button, "Receive" QR. | Uses `wallet/*` hooks. |
| `app/(wallet)/send/page.tsx` | Send form: recipient, amount, currency. Submits an `Intent`. | Uses `wallet/transact.ts`. |
| `app/(auth)/sign-in/page.tsx` | Privy login flow. | Uses Privy React SDK. |

**Phase 1 data flow (sending native ETH):**

1. UI submits form → `wallet.transact.proposeTransaction({ to: alice, value: 10n**16n, data: '0x' })`.
2. `transact` checks `account.isDelegated()`. If false, it builds a 7702 authorization tuple via Privy and includes it in the first UserOp (this is the "lazy upgrade" pattern — the user's first action upgrades them, no separate "deploy" step).
3. `transact` calls `bundlerClient.estimateUserOperationGas()`, then `paymasterClient.sponsorUserOperation()` to attach paymaster data.
4. UserOp hash is signed via Privy, UserOp is submitted, receipt is polled. Result is displayed.

**The smallest end-to-end shippable slice of Phase 1** (call this "**Slice 1A**" — ship this first, before anything else):

> A page with a "Sign in" button (Privy). After sign-in, the page shows the user's EOA address and a "Send 1 wei to myself (gasless)" button. Clicking it: (1) signs a 7702 authorization if the EOA isn't delegated yet, (2) submits a sponsored UserOp that sends 1 wei from the EOA to itself, (3) links to the BaseScan tx page when confirmed.

No styling. No balance display. No send form. No recipient input. Just: auth → upgrade → one sponsored UserOp. **If this slice works, every harder Phase 1 task is plumbing.** If it doesn't work, no amount of UI work will save the project. Build this first, in a single afternoon if possible. Everything else in Phase 1 is widening this slice.

**Phase 1 explicit OUT of scope** (see also §8):
- Any simulation, decoding, or risk scoring.
- ERC-20 transfers (Phase 1 ships with native ETH only; ERC-20 lands at the start of Phase 2 alongside the decoder).
- Address book, transaction history beyond "last 5 from local storage."
- Mobile-specific UI; responsive is fine but no PWA install flow.
- Multiple chains; Base Sepolia only.

### Phase 2 — Security/simulation layer (DEEP)

**Goal:** Every outgoing transaction is simulated and decoded into plain English before signing, and risky approvals are flagged. ERC-20 transfers and the headline DeFi protocols (Uniswap V3 swap, Permit2, Across bridge) are decoded.

**Components added in Phase 2:**

| Component | Responsibility | Interface |
|---|---|---|
| `lib/security/index.ts` | Public `SecurityLayer` interface. | Consumed by `wallet/transact.ts`. |
| `lib/security/decoder/index.ts` | Coordinates decoding. Tries protocol-specific decoders first (registry), falls back to generic ABI decoding, falls back to raw selector. | Used by `security/index.ts`. |
| `lib/security/decoder/registry.ts` | `DecoderRegistry` maps `{ contractAddress \| selector } → ProtocolDecoder`. | Plugins register themselves at module load. |
| `lib/security/decoder/protocols/erc20.ts` | Decodes `transfer`, `approve`, `permit`. Flags `approve(_, MAX_UINT256)` as `UNLIMITED_APPROVAL`. | Implements `ProtocolDecoder`. |
| `lib/security/decoder/protocols/erc721.ts` | Decodes `setApprovalForAll`, `approve`. Flags `setApprovalForAll(_, true)` as `BLANKET_NFT_APPROVAL`. | Implements `ProtocolDecoder`. |
| `lib/security/decoder/protocols/permit2.ts` | Decodes Permit2 `permit`, `permitTransferFrom`. Flags long-lived permits. | Implements `ProtocolDecoder`. |
| `lib/security/decoder/protocols/uniswapV3.ts` | Decodes SwapRouter02 swaps into "Swap X TOKEN_A → Y TOKEN_B." | Implements `ProtocolDecoder`. |
| `lib/security/decoder/protocols/across.ts` | Decodes Across bridge deposits. | Implements `ProtocolDecoder`. |
| `lib/security/simulator.ts` | Calls `/api/simulate`, parses asset-diff response, normalizes for the risk engine. | Used by `security/index.ts`. |
| `lib/security/reputation.ts` | Calls `/api/risk`, parses, normalizes. | Used by `security/index.ts`. |
| `lib/security/risk-engine.ts` | Combines decoder + simulator + reputation into a `Verdict`. Rules are declarative (table of `(condition → flag → level)`). | Used by `security/index.ts`. |
| `app/api/simulate/route.ts` | Vercel function. Wraps Alchemy `simulateAssetChanges` + `simulateExecutionBundle`. Caches by `hash(userOp + blockNumber)` in Vercel KV (60s TTL). | Called by `lib/security/simulator.ts`. |
| `app/api/risk/route.ts` | Vercel function. Aggregates GoPlus token-security + address-security responses + local allowlist/blocklist. Cached by address (1h TTL). | Called by `lib/security/reputation.ts`. |
| `components/SignConfirmModal.tsx` | The single most-important piece of UI in the project. Three visual states (safe/caution/danger), shows summary, decoded calls, asset diff, reasons. `danger` requires typing the word `CONFIRM`. | Receives `Verdict` from `wallet.proposeTransaction()`. |
| `components/RiskBadge.tsx`, `components/AssetDiffTable.tsx`, etc. | Sub-components of the modal. | Pure presentational. |

**Phase 2 data flow:** see §2.2.

**Risk engine rules (Phase 2 starter set — declarative, not hardcoded):**

| Rule | Source | Output level |
|---|---|---|
| `approve(spender, value)` where `value > 10^30` | decoder | `danger` if spender unverified, else `caution` |
| `setApprovalForAll(operator, true)` | decoder | `danger` if operator unverified, else `caution` |
| Recipient address present in local blocklist | reputation | `danger` |
| GoPlus flags recipient as malicious | reputation | `danger` |
| Recipient contract is unverified on Etherscan | reputation | `caution` |
| Simulation predicts revert | simulator | `danger` (with revert reason if available) |
| Simulated outgoing ETH/token diff > 50% of balance | simulator | `caution` |
| Simulation unavailable (timeout/error) | simulator | `unknown` (UI fails-closed) |
| No flags triggered | — | `safe` |

The rule table lives in `lib/security/risk-engine.ts` as data, not code. Adding a rule is one entry; tuning thresholds is one number. This is deliberate — risk heuristics will change with experience.

**Phase 2 explicit OUT of scope:**
- Phishing detection beyond the GoPlus signal (no URL scanning, no domain reputation).
- Signature-message decoding (EIP-712 typed-data introspection) — deferred to Phase 3 because it overlaps with Permit / session-key signing.
- ML-based risk scoring. Heuristics only.
- Protocol decoders beyond ERC-20/721/1155, Permit2, Uniswap V3 SwapRouter02, Across deposit. Anything else falls through to generic ABI decoding.

### Phase 3 — Batching, session keys, social recovery (OUTLINE)

> **Will be re-specified after Phase 1+2 ships.** This outline shows the design accommodates these features without rework, but the detail is intentionally light because: (a) the 7702 session-key landscape (ERC-7715, ERC-7710) is still settling in 2026; (b) social recovery patterns depend on the smart-account implementation we end up using in Phase 1; (c) actual UX needs will be clearer after Phase 2.

- **Batched transactions:** Already accommodated. The `Intent` type becomes `Intent[]`; `wallet/transact.ts` builds a single UserOp with an `executeBatch` call; the decoder iterates and the risk engine surfaces a per-call breakdown. UI gains a "Cart" model — collect multiple intents, review together, sign once. **Risk note:** the security modal grows visually; design upfront for a list-of-calls layout.
- **Session keys with spending limits:** Use the smart account's session-key module (Kernel supports this natively; Permissionless's reference 7702 account would need an extension). Spending limits enforced on-chain by the account. UI: a "Sessions" page listing active session keys with revoke. **Design risk:** ERC-7715 (Permission Requests) may become the standard for dApp-requested session keys; design the session-key UX so it can later receive permission requests from external dApps via a postMessage / WalletConnect bridge without internal refactor.
- **Social recovery via guardians:** Implemented as an on-chain guardian module on the smart account (or via the 7702 delegate's recovery logic). User designates N guardians (other EOAs / smart accounts / emails-via-Privy). Recovery flow: guardian threshold signs a "rotate signer" intent that re-delegates the 7702 EOA to a new signer key. **Design risk:** if the EOA's private key itself is compromised, 7702 recovery is harder than recovery for a pure smart account (because the attacker can issue new 7702 authorizations). Mitigation likely involves guardian-signed revocation of the delegation, but the exact pattern depends on how 7702 revocation semantics shake out in 2026 tooling.

### Phase 4 — Polish & demo (OUTLINE)

- **Visual polish:** Clean shadcn design pass, dark mode, smooth transitions on the SignConfirmModal (this is the screenshot recruiters will look at).
- **Demo script:** A scripted on-screen demo flow: sign in → send → trigger a risky `approve(MAX_UINT256)` to a known-malicious test address → show the modal blocking it. This is the GIF that goes on the README and resume.
- **README:** Architecture diagram, "how it works" with screenshots, "what I learned," explicit list of known limitations and what would be different in v2 (recruiters love this — it signals self-awareness).
- **Observability dashboard:** A simple page showing Sentry error rate and simulation success rate, demonstrating production-thinking.
- **Recorded demo video** (Loom or similar): 2 minutes max. Attach to README and resume.

---

## 6. Data & State Model

### 6.1 What is stored, and where

| Data | Storage | Lifetime | Why this location |
|---|---|---|---|
| User authentication state, EOA key shares | Privy (their infra) | Account lifetime | Privy's whole purpose. Never touches our infra. |
| 7702 delegation state | On-chain (the EOA's code slot) | Until revoked | This is what 7702 *is*. Don't cache locally beyond a short-TTL hint. |
| Active session keys, guardians (Phase 3) | On-chain (smart account state) | Until revoked | Trust-critical, must be on-chain. |
| Recent transactions (last 20) | Browser `localStorage` | Until user clears | Convenience cache for the dashboard; authoritative source is always chain. |
| Address book entries | Browser `localStorage` | Until user clears | Personal data, deliberately not synced. |
| User preferences (theme, etc.) | Browser `localStorage` | Until user clears | Trivial; no server roundtrip needed. |
| Simulation results | Vercel KV | 60s TTL, keyed by `hash(userOp + blockNumber)` | Server-side caching reduces Alchemy quota burn; short TTL because chain state changes. |
| Contract reputation | Vercel KV | 1h TTL, keyed by `chainId + address` | GoPlus quota is limited; 1h is safe for reputation drift on testnet. |
| Decoded ABI cache (Whatsabi results) | Vercel KV | 7d TTL, keyed by `chainId + address` | ABIs don't change; long TTL is safe. |
| API keys (Alchemy, Pimlico, GoPlus, Etherscan) | Vercel environment variables | App lifetime | **Never** in client code, **never** in committed files. |
| Sentry DSN (client) | Public env var (`NEXT_PUBLIC_*`) | App lifetime | Sentry DSN is safe to ship to client. |

### 6.2 Deliberately client-side only

- **Address book and transaction history** are stored only in the user's browser. No server-side per-user storage. This is a deliberate scope choice — the moment we add cross-device sync we need accounts/database/privacy policy, all of which destroy the "free tier" budget.
- **Risk decisions are reproducible in the client** given the same inputs (decoder + sim diff + reputation). The server's job is only to proxy keys and cache, not to make trust-critical decisions. This matters because a server compromise should not be able to silently rewrite a `danger` verdict to `safe`. (The client always sees the raw data and can re-derive.)

### 6.3 No database in Phase 1+2

Phase 1+2 has zero persistent server-side per-user state. Vercel KV is used only as a cache (cold cache = slower, never wrong). This is intentional and important: it keeps the free-tier story honest (Vercel KV free tier is 256MB / 30k commands per day, ample for cache-only), and it sidesteps a pile of accidental complexity (user accounts, GDPR, backups). Phase 3's session-key / guardian metadata is on-chain, not in a database.

---

## 7. Assumptions, Risks, and What to Verify Independently

**This is the most important section.** The doc is built on assumptions that are time-sensitive (especially around 7702 tooling and free-tier terms). Verify each of the following *before* committing to the architecture. I have stated these as my best understanding as of late 2025 / early 2026; treat them as claims that need a 10-minute fact-check each, not as ground truth.

### 7.1 EIP-7702 tooling maturity

| Assumption | Mitigation if wrong |
|---|---|
| EntryPoint v0.8 is deployed on Base Sepolia and supports 7702 accounts natively. | Verify on the official EntryPoint registry / Base docs before starting. If only v0.7 is canonical, fall back to a 7702-compatible account that wraps v0.7 (Kernel v3.x has this option). |
| Permissionless's `toSimple7702SmartAccount` (or equivalent helper) is production-ready on Base Sepolia. | If buggy/unmaintained, switch to ZeroDev Kernel v3.3 — it has the most deployment experience for 7702 in 2026. |
| Pimlico's bundler accepts 7702 UserOps including the authorization-tuple field on Base Sepolia. | If not, Alchemy's Account Kit bundler has documented 7702 support. Architecturally one URL swap. |
| The 7702 "lazy upgrade" pattern (bundling the authorization into the first UserOp) works as expected. | If it doesn't, fall back to a two-tx upgrade: a separate type-4 authorization tx, then UserOps. Worse UX, identical end state. |

### 7.2 Free-tier terms (verify URLs and current limits before relying on them)

| Service | Assumed free tier | What to do if it changes |
|---|---|---|
| Alchemy | 300M compute units/month, includes simulation APIs | Migrate sim to Tenderly free tier; RPC to public Base endpoint with TanStack caching. |
| Pimlico | Bundler + paymaster usable on testnet without payment | Migrate to Alchemy Gas Manager; if both die, drop paymaster and let users pay gas (architecturally trivial since paymaster data is optional). |
| Privy | Free tier covers small user counts | Migrate signer to Turnkey; second fallback is local passkey-encrypted key. |
| GoPlus | Free tier for security API | Switch to local allowlist/blocklist + Etherscan verification check (degraded but functional). |
| Vercel | Hobby tier: 100GB bandwidth, sufficient function invocations | Move to Cloudflare Pages + Workers; Next.js works there with `@cloudflare/next-on-pages`. |
| Vercel KV | Free tier (256MB / 30k commands/day) | Replace with in-memory LRU cache in serverless functions; lower hit rate but functional. |
| Etherscan API | Free tier with rate limit | Sourcify as primary fallback; both as primary+secondary chain. |
| Sentry | 5k errors/month free | Self-host GlitchTip (Sentry-compatible) on Fly.io free tier. |

**Action:** before writing any code, spend ~30 minutes confirming each row's "Assumed free tier" cell against the provider's current pricing page. Update this table in-place if reality differs.

### 7.3 Likely sources of pain

| Risk | Why it'll hurt | Mitigation |
|---|---|---|
| **7702 docs lag the actual SDKs.** Examples online may target older EntryPoint versions or pre-Pectra patterns. | You'll lose hours to "this code looks right but reverts." | Build Slice 1A against the SDK's own example repo first, verbatim. Only after it works on your machine, generalize. Don't trust blog posts older than mid-2025. |
| **Simulation cost / latency.** Every transaction proposal triggers a sim call. If quota or latency is bad, the UX degrades. | Users will perceive the wallet as "slow" because of the sim, even though signing is fast. | Aggressive 60s KV cache. Cap simulation timeout at 3s; on timeout, render the `unknown` verdict and let the user decide. Show a loading state explicitly so latency is communicated. |
| **Calldata decoder for unknown contracts.** Whatsabi-derived ABIs are best-effort. | The decoder will mis-decode some calls, eroding trust in the security layer. | Always show "raw selector + decoded interpretation" side-by-side. Never hide the raw data. Mark "best-effort decode" with a visible indicator when the source is Whatsabi vs. a hand-written protocol decoder. |
| **Risk engine false positives.** Aggressive heuristics will flag legitimate Uniswap swaps as "caution." | Users get habituated to dismissing the modal, defeating its purpose. | Keep the rule table conservative in Phase 2 — better to under-flag than over-flag. Tune in Phase 4 with real demo usage. |
| **Privy's 7702 support.** As of late 2025 Privy supports raw EOA signing including 7702 authorization tuples, but this is a relatively new code path and edge cases may exist. | A Privy-side bug could block Phase 1 entirely. | Verify Slice 1A against Privy's current SDK before any other Phase 1 work. If signing-7702-authorizations is broken, switch to Turnkey before doing anything else. |
| **Vercel cold starts on serverless functions.** First sim call after idle period can be slow (1-2s). | Compounds the simulation-latency problem. | Set the function region to match the user's geography (default `iad1` is fine for a US-focused demo). Consider Vercel Edge functions for `/api/risk` since it's lighter. |
| **Etherscan API key rotation friction.** Free tier requires an account; key rotation is manual. | Low-frequency annoyance, not a blocker. | Document the env-var setup in the README; Sourcify fallback means the app keeps working during rotations. |
| **EIP-7702 revocation UX.** If a user wants to "un-7702" their EOA (remove the delegation), the path isn't always obvious in current SDKs. | Affects Phase 3 recovery design, not Phase 1+2. | Note in Phase 3 design; verify SDK support before designing recovery. |
| **Mobile wallet conflict.** If the user already has MetaMask Mobile / Rainbow installed and visits the dApp, wallet-discovery may intercept Privy's auth. | Confusing UX. | Phase 1+2 ships desktop-first. Add explicit "this is a self-contained wallet, you don't need MetaMask" messaging on the auth page. |

### 7.4 What I'm explicitly *not* confident about and you should pressure-test

- **The "lazy upgrade" pattern** (bundling the 7702 authorization into the first UserOp) is what most SDKs document, but I haven't watched it work end-to-end on Base Sepolia from this terminal. It is the most likely Phase 1 failure point. **Spike this first.**
- **The exact GoPlus API response shape and free-tier rate limit.** Their docs evolve; the `/api/risk` proxy will need a real integration test, not a mocked one, before being relied on.
- **Whether Pimlico still maintains a non-zero free tier for testnet bundler/paymaster.** This was generous historically but the AA-infra business model is in flux. Verify before committing.
- **Whether Privy's free tier comfortably covers a portfolio demo's traffic** (typically yes, but the cliff between free and paid has moved before).

### 7.5 What this architecture is *not* good at (be honest about it)

- **Multi-chain.** Phase 1+2 is single-chain. Adding chains is real work, not config. Don't promise multi-chain on the demo page.
- **High-frequency / high-volume usage.** Free-tier caching strategy assumes demo-grade traffic. If this somehow goes viral, things break before they scale.
- **Truly adversarial security review.** This is a *security-focused* wallet, not a *security-audited* wallet. The decoder, risk engine, and Vercel proxies are not designed to withstand a determined attacker probing for bypasses. Be precise about this in the README: "demonstrates security UX patterns" ≠ "would survive a real audit."
- **Mainnet readiness.** Testnet-only is a deliberate scope choice, but the gap to mainnet is more than "change the chain ID" — paymaster economics, real money exposure, formal audit, error monitoring at scale, ToS, etc. The README should say "testnet-only by design."

---

## 8. Out-of-Scope Per Phase

Each phase has an explicit out-of-scope list to prevent scope creep. Items below are *not* being deferred to a later phase by default — they're outside the project scope unless explicitly added later.

### Phase 1 out of scope
- Any UI for non-native-ETH assets (no ERC-20 send screen yet).
- Any simulation, decoding, or risk UI.
- Transaction history beyond a localStorage list of the last 5 hashes.
- Address book.
- Mobile-optimized UI (responsive layout is fine; PWA install / touch gestures are not).
- Anything cross-chain.
- Any custom branding beyond a placeholder logo.

### Phase 2 out of scope
- Signature-message decoding (EIP-712 / personal_sign analysis). Deferred to Phase 3 because it overlaps with session-key signing flows.
- ML-based risk scoring; heuristics only.
- Protocol decoders beyond ERC-20/721/1155, Permit2, Uniswap V3 SwapRouter02, and Across. Other protocols decode via generic ABI fallback.
- Phishing/URL/domain detection.
- A "safe contracts" submission flow (no user-contributed allowlist).
- Server-side per-user storage (no database).
- Telemetry beyond Sentry error tracking.

### Phase 3 out of scope (when we get there)
- WalletConnect / dApp browser integration. Major undertaking, separate project-grade decision.
- Hardware-wallet support.
- Account abstraction features beyond batching / session keys / guardian recovery (no auto-paying subscriptions, no time-locked transactions, no advanced policy languages).
- Mainnet deployment.

### Phase 4 out of scope
- Real users / waitlist / marketing site.
- Any monetization.
- Custom illustrations or motion design beyond what shadcn + minimal CSS gives.
- Internationalization.

---

## Appendix A — Verification checklist (do before writing code)

Tick each before Phase 1 starts. If any fail, the architecture choice for that row changes — update this doc, don't paper over it.

- [ ] EntryPoint v0.8 (or v0.7 + 7702-wrapping account) is live on Base Sepolia.
- [ ] Pimlico bundler accepts a 7702 UserOp on Base Sepolia.
- [ ] Pimlico verifying paymaster sponsors a UserOp on Base Sepolia free tier.
- [ ] Alchemy free tier currently includes `alchemy_simulateAssetChanges` and `alchemy_simulateExecutionBundle` on Base Sepolia.
- [ ] Privy free tier currently supports embedded EOAs with passkey auth and exposes a 7702-compatible signing method.
- [ ] GoPlus Security API free tier is currently active and the response shape matches your decoder's expectations.
- [ ] Vercel hobby tier function invocation + KV free-tier limits are current.
- [ ] Permissionless.js current version exposes `toSimple7702SmartAccount` (or you have ZeroDev Kernel v3.3 as a working substitute).

## Appendix B — Files this document does not contain

- No package.json or dependency versions. Pin versions at the moment of install; they change weekly in this ecosystem.
- No env-var template (`.env.example`). Goes in the repo at implementation time.
- No CI / deployment config. Vercel handles deploys from `main`; CI for tests can be GitHub Actions free tier in Phase 4.
- No test plan. Phase 1 needs at minimum: a unit test for the decoder registry, an integration test for `/api/simulate`, and a manual smoke test for Slice 1A. Detail when implementing.

---

*End of architecture document. Revise after Phase 1+2 ships.*
