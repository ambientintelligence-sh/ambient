# Ambient

Ambient is an Electron desktop app for live conversation capture, transcription, and agent-driven workflows. It captures system audio, transcribes in real-time, extracts tasks and insights, and spawns autonomous AI agents to act on them.

## Features

- Real-time system audio capture (ScreenCaptureKit on modern macOS)
- Optional microphone capture in parallel with system audio
- Transcription via ElevenLabs (`scribe_v2`) by default
- Translation and analysis via configurable LLM providers
- Session history with transcripts, tasks, insights, and agents
- Hash-route session navigation (`#/chat` and `#/chat/:sessionId`)

## Tech Stack

- Electron + React + TypeScript
- Vite (main, preload, renderer)
- Vitest for tests
- better-sqlite3 + Drizzle ORM for persistence

## Prerequisites

- Node.js 22+
- pnpm
- macOS 14.2+ for ScreenCaptureKit system-audio capture

Optional legacy audio mode requires `ffmpeg` and a loopback device.

## Setup

```bash
pnpm install
cp .env.example .env   # if needed in your environment
```

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

Required in common setups:

- `ELEVENLABS_API_KEY`
- `OPENROUTER_API_KEY`

Optional provider configuration:

- `GOOGLE_GENERATIVE_AI_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_VERTEX_PROJECT_ID`
- `GOOGLE_VERTEX_PROJECT_LOCATION`

Optional MCP integrations:

- `MCP_INTEGRATIONS_ENABLED=false` to disable Notion/Linear MCP connectors (enabled by default).

## Notes

- `pnpm` is the source-of-truth package manager.
- `bun.lock` is synchronized after `pnpm-lock.yaml` updates.
