# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project status

**Scaffold complete, no Web3 wiring yet.** The repo has a working Next.js 15 + React 19 + TypeScript + Tailwind 3 skeleton with the `lib/` module structure from Architecture §3.2 in place and the wallet/security ESLint boundary rule enforced. `pnpm dev` boots cleanly. No `viem`, `permissionless`, or Privy yet — those land with Slice 1A once API keys exist.

Authoritative reading order for a fresh session:
1. `ARCHITECTURE.md` — **single source of truth** for what's being built, why, and how. Read this first.
2. This file — operational guidance and current focus.
3. `lib/shared/types.ts` — the `SecurityLayer` interface that the wallet/security seam is built around.

Do not propose designs that conflict with `ARCHITECTURE.md`. If a conflict is unavoidable (e.g., a free tier disappeared, an SDK is broken), surface it explicitly and update `ARCHITECTURE.md` in the same change — don't paper over it.

## Non-negotiable design rules

These are load-bearing and apply to every change once code exists:

1. **`lib/wallet/*` and `lib/security/*` are separately failing modules.** `wallet` may only depend on `security` through the `SecurityLayer` interface defined in `lib/shared/types.ts`. No reaching into `security/*` internals from `wallet/*`. Plan to enforce with an ESLint boundaries rule.
2. **The security layer fails closed.** If `security.evaluate()` throws or exceeds 5s, `wallet` synthesizes `{ riskLevel: 'unknown' }` and the UI **disables** the sign button. Never silently "let it through" because the simulator hiccupped.
3. **Risk decisions are reproducible client-side.** Server proxies (`/api/simulate`, `/api/risk`) exist only to hide API keys and cache — never to make trust-critical decisions. The client must always see the raw inputs and be able to re-derive the verdict.
4. **Every external service has a documented fallback** (see Architecture §4 and §7.2). Do not add a new third-party dependency without naming its fallback and confirming its free tier in the same change.
5. **Free tier only, testnet only, Base Sepolia only** through at least Phase 2. Do not propose paid tiers, mainnet, or multi-chain even tentatively.
6. **The risk engine is a declarative rule table**, not procedural code. Add rules as data; do not bake heuristics into control flow.

## Working norms

- Be honest about uncertainty. **Do not call designs "perfect" or "future-proof"** — flag assumptions, name what to verify independently, especially anything depending on fast-moving 2025–2026 7702/AA tooling or current free-tier terms.
- Prefer editing existing docs (especially `ARCHITECTURE.md`) over creating parallel documents. If the architecture needs to change, change it in place — don't write an addendum file.
- Recruiter signal is a real selection criterion for this project. When two tools are functionally equivalent, prefer the one with stronger crypto/AA hiring-manager name recognition (see Architecture §4 and the rationale lines therein).
- The user prefers terse responses. Avoid recapping the architecture back at them — they wrote the brief, they have it.

## Build / run / test commands

Package manager: **pnpm 10.16.1** (pinned via `packageManager` in package.json; corepack will fetch on first use). Node 20.20.1 is the current dev environment — pnpm 11 requires Node 22, so do not bump pnpm until Node is upgraded.

```
pnpm install        # install deps (run once + after any package.json change)
pnpm dev            # Next.js dev server on http://localhost:3000 (~2.5s ready)
pnpm build          # production build
pnpm start          # serve the production build
pnpm typecheck      # tsc --noEmit (strict mode is on)
pnpm lint           # next lint — enforces the boundaries rule from eslint.config.mjs
```

Tests don't exist yet. The minimum bar before merging Phase 2 work is unit tests for the decoder registry and risk engine, plus an integration test for `/api/simulate`.

**Note:** `next lint` emits a deprecation warning ("will be removed in Next.js 16"). Migration to the direct ESLint CLI via `npx @next/codemod@canary next-lint-to-eslint-cli .` is deferred until we're closer to Next 16 — non-blocking.

## Environment specifics

- **OS:** Windows 11. **Shell:** PowerShell 5.1 (use PowerShell syntax — `$env:VAR`, not `$VAR`; `Get-ChildItem`, not `ls -la`; `;` for sequencing, not `&&`). Bash is available via the Bash tool for POSIX scripts when needed.
- **Repo path:** `D:\argus-7702`.
- **Git:** main branch is `main`. Repo is freshly initialized with a single commit.
- **Secrets:** API keys for Alchemy, Pimlico, GoPlus, Etherscan, Privy, and Sentry will live in Vercel environment variables — never in committed files, never in `NEXT_PUBLIC_*` vars except the Sentry DSN.

## Current focus

> **Keep this section current.** Update it as phases progress so a fresh Claude session immediately knows what to work on next.

**Phase:** Pre-Slice 1A (scaffold complete; awaiting API keys + verification).
**Blocked on (user):** create Privy app, Alchemy app (Base Sepolia), Pimlico app; populate `.env.local` from `.env.example`.
**Blocked on (Claude):** verify Architecture Appendix A — EntryPoint v0.8 on Base Sepolia, current Permissionless 7702 helper API, Privy's 7702 signing path. Can start once keys exist (or in parallel via doc lookup).
**Next action once unblocked:** wire **Slice 1A** — sign in → 7702 upgrade-on-first-use → 1 wei self-send via sponsored UserOp → BaseScan link. Defined in Architecture §5.
**Do not** jump to Phase 2 work, the security layer UI, or Phase 3 features until Slice 1A is on Base Sepolia and a tx hash is in the README.

## When to update this file

Update CLAUDE.md (not just `ARCHITECTURE.md`) when any of the following happens:

- A new build/run/test command becomes real → fill in the Commands section.
- A phase ships → update **Current focus**.
- A non-negotiable design rule changes (rare — these should be sticky) → update Non-negotiable design rules and reflect the rationale in `ARCHITECTURE.md` too.
- A working norm corrects something Claude did wrong twice → add it here so the third occurrence doesn't happen.
- A free-tier provider gets swapped to its fallback → note the swap and update the affected row in `ARCHITECTURE.md` §7.2.

Do **not** update this file with:
- Per-task notes or TODOs (use the Architecture phase sections or commits).
- Things obvious from the code (file structure, dependency lists, framework conventions).
- Status reports of in-progress work.
