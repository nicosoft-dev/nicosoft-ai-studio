<div align="center">

# NicoSoft AI Studio

**An open-source desktop AI workshop — a team of specialized AI experts that collaborate to get your work done.**

Each expert runs on the best-fit model across OpenAI / Anthropic / Gemini. Bring your own API key. Everything stays on your machine.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![Status](https://img.shields.io/badge/status-pre--alpha-orange)

</div>

> **Status: pre-alpha.** Design is settled (see [`docs/`](#-architecture)); implementation is just beginning. Not yet usable — star/watch to follow along.

---

## ✨ Features

A desktop app where **8 named AI experts** work for you — each with a personality, a specialty, and the model best suited to its job:

| Expert | Role | Default model |
|---|---|---|
| **Atlas** | Coordinator — routes your request to the right expert(s), synthesizes their answers | Claude Haiku |
| **Iris** | Generalist — chat, brainstorming, anything not specialized | GPT-5 mini |
| **Hex** | Software engineer — write, debug, review, explain code | Claude Sonnet |
| **Lyra** | Designer — posters, illustrations, avatars, images | Gemini Imagen |
| **Echo** | Translator — between any language pair | Gemini Flash |
| **Sage** | Editor — summarize, condense, take notes | Gemini Flash |
| **Quant** | Data analyst — statistics, math, chart recommendations | GPT-5 |
| **Mercury** | Email & scheduling — drafts, replies, agendas | GPT-5 mini |

Plus everything that makes them feel like *your* team:

- **Multi-model, three protocols** — connect OpenAI, Anthropic, and Google Gemini natively (each expert on its best-fit model), or use any OpenAI-compatible gateway. Bring your own key.
- **Per-expert memory that grows** — each expert remembers your preferences, learns from how you correct it, and gets better the more you use it. A shared layer keeps facts about you (your stack, your language) across all experts.
- **They collaborate** — Atlas can convene the relevant experts to discuss a complex task, agree on a plan, and divide the work *(Council mode — planned for v0.3)*.
- **Everything local** — conversations in local SQLite, API keys in your OS keychain. No account, no server, no telemetry.
- **Bilingual** — English & 中文.

---

## 📥 Download

> Builds are not published yet. Watch [Releases](https://github.com/nicosoft-dev/nicosoft-ai-studio/releases) for the first v0.1.

When available: macOS (Apple Silicon `.dmg`) and Windows (`.exe`). Linux comes later.

---

## 🚀 Quick start (once released)

1. Install the app.
2. On first launch, add an API key for one or more providers (OpenAI / Anthropic / Google). Get keys from each provider's console — the app links you there.
3. Pick an expert (or just type — Atlas routes for you) and start working.

You can run all experts on a single provider (e.g. one OpenAI-compatible gateway key), or wire each expert to the provider that suits it best.

---

## 🛠 Development

```bash
pnpm install
pnpm dev          # electron-vite dev — launches the app with HMR
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint --max-warnings=0
pnpm test         # vitest
```

Requires **Node 22 LTS** and **pnpm 10+**.

Stack: Electron + electron-vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Zustand + TanStack Query + better-sqlite3. Full rationale in [`docs/`](#-architecture).

---

## 🤝 Contributing

Contributions welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it covers the dev workflow, the (strict) code standards, and the commit format. We use [DCO](https://developercertificate.org/) (sign-off), not a CLA.

The codebase has hard rules (no `any`, strict TypeScript, file/function size limits, no silent error swallowing). They keep the project readable for everyone — see [`docs/01-code-standards.md`](docs/01-code-standards.md).

---

## 📐 Architecture

The design is documented in depth under `docs/`:

| # | Doc | Topic |
|---|---|---|
| 00 | overview | Vision, decisions, competitive positioning |
| 01 | code-standards | TypeScript / React / Electron rules (strict) |
| 02 | tech-stack | Every dependency + why |
| 03 | roles | The 8 experts: system prompts, routing, tools |
| 04 | agent-framework | The agent loop (TS, inspired by Codex), tools, sandbox |
| 05 | endpoint-integration | Three-protocol LLM client, API-key storage, streaming |
| 06 | ui-architecture | Routes, state layers, component tree |
| 07 | mvp-roadmap | v0.1 → v1.0 milestones |
| 08 | opensource-strategy | License, workflow, community |
| 09 | build-and-release | electron-builder, signing, release flow |
| 10 | memory-system | Three-layer memory, self-learning, context compression |

---

## 📄 License

[Apache License 2.0](LICENSE). Use it, fork it, build on it — keep the NOTICE and patent grant.

---

<div align="center">
<sub>NicoSoft AI Studio is an independent open-source project. It is endpoint-agnostic and not tied to any single LLM provider.</sub>
</div>
