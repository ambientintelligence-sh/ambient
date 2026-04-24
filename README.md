# Ambient

[![CI](https://github.com/ambientintelligence-sh/ambient/actions/workflows/ci.yml/badge.svg)](https://github.com/ambientintelligence-sh/ambient/actions/workflows/ci.yml)
[![Release](https://github.com/ambientintelligence-sh/ambient/actions/workflows/release.yml/badge.svg)](https://github.com/ambientintelligence-sh/ambient/actions/workflows/release.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Website](https://img.shields.io/badge/website-ambientintelligence.sh-orange)](https://www.ambientintelligence.sh/)

## From talk. To done.

An Ambient layer that listens, understands what needs to be done, and gets it done in parallel before you finish talking.

---

70% of your work isn't the work.

Notes. To-do lists. "Can you send that?" Reminders nobody reads. Follow-up meetings about the last meeting.

That's backwards. We **flipped** it.

## Core features

### From talk. To done.

- **Any language** — Works across 40+ languages without configuration.
- **Real-time processing** — Captures and structures while the conversation is still happening.
- **Context-aware** — Understands who said what, what was decided, and what's next.

### It Listens.

Every conversation, perfectly remembered — in any language, without you ever reaching for a notepad.

### It Structures.

Ambient catches what matters and surfaces thoughtful, well-researched suggestions, with multiple agents pulling context in parallel to surface the most critical ones.

### It Actions In Parallel.

Ambient turns well-researched suggestions into action, dispatching long-running agents to tackle tasks in parallel.

## Impact

### Less busywork. More momentum.

**9x** faster post-meeting follow-up time.

## Any conversation. One tool.

Because conversations are where plans are born — and too often, where they disappear. Ambient exists to ensure that what matters doesn't get lost.

### Trip Planning

> The trips will always make it out of the group chat.

Flights get mentioned. Hotels are debated. Someone says, "I'll look into it."

Ambient captures destinations, dates, and ideas as your group discusses. Then generates a structured plan with flight research, hotel options, and an itinerary pushed to Notion before the conversation even ends.

[ambient-trip-planning.webm](https://github.com/user-attachments/assets/880ece12-8076-4252-ad9a-77541bb6ced2)

### Research & Brainstorming

> Where ideas go to grow.

Ideas move fast. Insights get buried. Action items are implied but never written down.

You think out loud, Ambient turns it into momentum. Structuring thoughts into organized notes, research summaries, and next steps while you stay in creative flow.

[ambient-project.webm](https://github.com/user-attachments/assets/7ff7bd5f-62f5-40d1-8148-589d68778cfd)

### Study Sessions

> Your intelligence backed by Ambient Intelligence.

Concepts are explained. Deadlines are mentioned. Assignments are clarified.

Ambient captures the discussion and turns it into summaries, flashcards, and key takeaways like a study partner that remembers everything you covered.

<video src="https://github.com/ambientintelligence-sh/ambient/raw/main/docs/media/ambient-study.webm" controls muted loop playsinline width="100%"></video>

### Team Meetings

> So we don't have to circle back.

Ideas are discussed. Decisions get made. Someone says, "Let's circle back."

Ambient captures action items, owners, and decisions in real time. Then sends structured notes and tasks to your tools before the meeting even ends.

<video src="https://github.com/ambientintelligence-sh/ambient/raw/main/docs/media/ambient-meeting.webm" controls muted loop playsinline width="100%"></video>

### Native Codex

> Built for the terminal-native way of working.

A problem is described. Context is scattered. You want action, not another doc to maintain.

Ambient captures coding conversations, implementation decisions, and follow-up work as you build. It keeps the thread of what changed, why it changed, and what still needs attention without pulling you out of flow.

<video src="https://github.com/ambientintelligence-sh/ambient/raw/main/docs/media/ambient-codex.webm" controls muted loop playsinline width="100%"></video>

## Customize

### Built extensible. Made to adapt.

With the most powerful agents fleet. Deploy, customize, and orchestrate Ambient around your workflow.

- **Skills, MCP & Coding Agents** — Add skills, MCP connectors, and dispatch Codex or Claude Code natively as background coding agents.
- **Continual Learning** — Agent remembers all past actions and corrections. Never make the same mistake twice.
- **Long-running Agents** — Every long task starts with a plan you approve or reject. Agents then execute autonomously — fully in your control.
- **Always the latest models** — Frontier models from Anthropic, OpenAI, Google, xAI, and more — swap providers without swapping tools.
- **Add context** — Highlight any line from a session and drop it in as context. The agent picks up exactly what matters.
- **Agent Fleet** — Spin up a fleet to take on any task together. Every agent contributes to a shared summary — a hive mind you can steer.

## FAQ

### Is Ambient always listening?

Ambient only listens when you activate it. When active, it processes audio locally on your device. It does not continuously stream your microphone to the cloud. You are always in control.

### Where is my data stored?

Audio processing happens locally on your device. Transcripts and tasks are only saved if you choose to keep them. You can delete sessions at any time.

### Does Ambient record conversations?

Ambient transcribes device audio and/or microphone input, whatever you pick. Audio is processed locally on your device, no recording files are stored, and any session transcript can be deleted at any time.

### Does Ambient take actions automatically?

Ambient suggests structured tasks and actions. You approve before anything is pushed to tools like Notion, task managers, or booking flows. You're always in control.

### Is Ambient open source?

Yes. Ambient is open source, so you can inspect how it works, verify how audio and data are handled, and contribute improvements yourself.

We think software that listens in on important conversations should earn trust through transparency, not just promises.

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

That's it. The default configuration uses Gemini Flash via OpenRouter for both transcription and analysis — a single `OPENROUTER_API_KEY` is all you need. See [`.env.example`](./.env.example) for optional provider keys (Gemini direct, Exa web search).

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

- `src/electron/main.ts` — app window, database init, IPC registration
- `src/electron/preload.ts` — secure renderer bridge (`window.electronAPI`)
- `src/electron/renderer/main.tsx` — renderer bootstrapping and app mount

### Core runtime

- `src/core/session.ts` — live audio/transcription/analysis orchestration
- `src/core/db.ts` — session/task/insight/agent persistence
- `src/core/providers.ts` — model provider wiring
- `src/core/analysis.ts` — insight/task extraction prompts and schemas
- `src/core/language.ts` — language helpers and prompt building

### IPC organization

- `src/electron/ipc-handlers.ts` — IPC composition root
- `src/electron/ipc/register-session-handlers.ts` — session lifecycle and recording handlers
- `src/electron/ipc/register-task-insight-handlers.ts` — tasks, insights, and session persistence handlers
- `src/electron/ipc/register-agent-handlers.ts` — agent lifecycle handlers
- `src/electron/ipc/ipc-utils.ts` — shared IPC utilities

### Renderer

- `src/electron/renderer/app.tsx` — top-level app orchestration
- `src/electron/renderer/hooks/*` — session, keyboard, mic, bootstrap, and UI hooks
- `src/electron/renderer/components/*` — shell and feature UI components

## Environment Variables

Only `OPENROUTER_API_KEY` is required to get started. API keys can also be configured in the app's settings UI. See [`.env.example`](./.env.example) for the full list of optional providers and feature flags.

## Notes

- `pnpm` is the source-of-truth package manager.
- `bun.lock` is synchronized after `pnpm-lock.yaml` updates.

## License

[AGPL-3.0-only](./LICENSE) © Jiayi Li, Shuting Hu
