# Ambient

The end of work about work. You stay in the zone. Ambient picks up everything around it — the research, the action items, the loose threads — and handles them while you keep going.

## Features

### It Listens
Every conversation, perfectly remembered — in any language, without you ever reaching for a notepad. Real-time system audio capture via ScreenCaptureKit with optional microphone input.

### It Finds the Signal
While you're still in the conversation, Ambient is already pulling out what matters. Tasks, key decisions, agreements, and the things everyone will forget by tomorrow — extracted live and classified as agent-doable or human-only.

### It Actions In Parallel
Ambient automatically delegates and launches multiple agents in parallel to get your tasks done quickly. Each agent plans, executes with tool access, and reports back — while you keep talking.

### Context-Aware Transcription
Powered by Gemini Flash with custom context injection. Add speaker names, glossary terms, and project-specific vocabulary in your project settings so Ambient transcribes names and terminology correctly.

### Natively Multilingual
Understands and translates across 13 languages on the spot. Auto-detects language from character sets (CJK, Arabic, Cyrillic, etc.) and handles code-switching within a single conversation.

### Agent Fleet With Planning
Agents create structured plans with approval gates before executing. Track progress via todos, ask clarifying questions, and learn from corrections — fully interactive, fully in control.

### Continual Learning
Agents extract durable learnings from every completed task — your preferences, workspace facts, past corrections — and persist them so they never make the same mistake twice.

### MCP Servers
Connect any MCP-compatible server by URL. Built-in OAuth connectors for Notion and Linear, plus custom servers with bearer token auth. Agents discover and use tools automatically.

### Smart Task Delegation
Tasks extracted from conversations are classified as "agent" (automatable) or "human" (needs you). Agents handle the research, lookups, and drafts. You handle the decisions that matter.

## Tech Stack

- Electron + React + TypeScript
- Vite (main, preload, renderer)
- Vitest for tests
- better-sqlite3 + Drizzle ORM for persistence

## Quick Start

1. **Prerequisites:** Node.js 22+, pnpm, macOS 14.2+
2. **Install & run:**
   ```bash
   pnpm install
   pnpm dev
   ```
3. **Add your OpenRouter API key** in the app settings when prompted.

That's it. The default configuration uses Gemini Flash via OpenRouter for both transcription and analysis — a single `OPENROUTER_API_KEY` is all you need.

## Development

```bash
pnpm dev
```

## Build

```bash
pnpm electron:package
pnpm electron:make
```

## Quality Checks

```bash
pnpm test
pnpm run check:type
pnpm run check:unused
pnpm run check:reachability
pnpm run check:deadcode
```

## Runtime Architecture

### Electron entrypoints

- `src/electron/main.ts`: app window, database init, IPC registration
- `src/electron/preload.ts`: secure renderer bridge (`window.electronAPI`)
- `src/electron/renderer/main.tsx`: renderer bootstrapping and app mount

### Core runtime

- `src/core/session.ts`: live audio/transcription/analysis orchestration
- `src/core/db.ts`: session/task/insight/agent persistence
- `src/core/providers.ts`: model provider wiring
- `src/core/analysis.ts`: insight/task extraction prompts and schemas
- `src/core/language.ts`: language helpers and prompt building

### IPC organization

- `src/electron/ipc-handlers.ts`: IPC composition root
- `src/electron/ipc/register-session-handlers.ts`: session lifecycle and recording handlers
- `src/electron/ipc/register-task-insight-handlers.ts`: tasks, insights, and session persistence handlers
- `src/electron/ipc/register-agent-handlers.ts`: agent lifecycle handlers
- `src/electron/ipc/ipc-utils.ts`: shared IPC utilities

### Renderer

- `src/electron/renderer/app.tsx`: top-level app orchestration
- `src/electron/renderer/hooks/*`: session, keyboard, mic, bootstrap, and UI hooks
- `src/electron/renderer/components/*`: shell and feature UI components

## Environment Variables

Only `OPENROUTER_API_KEY` is required to get started. API keys can be configured in the app's settings UI.

Optional keys for alternative providers or extra features:

- `GEMINI_API_KEY` — Use Google AI (Gemini) directly instead of via OpenRouter
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — Amazon Bedrock
- `EXA_API_KEY` — Web search for AI agents
- `MCP_INTEGRATIONS_ENABLED=false` — Disable Notion/Linear MCP connectors (enabled by default)

## Notes

- `pnpm` is the source-of-truth package manager.
- `bun.lock` is synchronized after `pnpm-lock.yaml` updates.
