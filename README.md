# Ambient

A voice-first cockpit for a delegating agent fleet. One realtime speech-to-speech
session with OpenAI `gpt-realtime-2.1`, rendered as an instrument cluster: who is
holding the floor, what tool is in flight, and which specialists have been handed work.

## Run

```bash
pnpm install
echo "OPENAI_API_KEY=sk-..." >> .env
pnpm dev
```

macOS will ask for microphone access on first launch. No other setup is needed:
the primary worker and its helpers run as native processes, sandboxed by the OS.

Ambient opens the Pi delegation setup on launch. Sign in to any provider exposed
by Pi using OAuth/account login or an API key, then choose a model. Reopen the
picker with **MODEL**. The choice is saved in Ambient's user-data directory.
The same Settings panel has an optional **YOUR LOCATION** field. A value such as
`Vancouver, BC, Canada` is saved locally and supplied as the default place for
location-sensitive voice requests and delegated searches.
The realtime voice connection still requires `OPENAI_API_KEY`; Pi account login
only authenticates delegated workers.

## How it fits together

```
Electron main ──┐
                ├─ loopback HTTP server  ──► openai.realtime.clientSecrets.create()
                │  (127.0.0.1, random port, /api/realtime/setup)
                │
renderer ───────┘
  RealtimeAgent + RealtimeSession + OpenAIRealtimeWebRTC
      │
      ├─ POST setup  → short-lived `ek_...` client secret
      ├─ WebRTC      → OpenAI Realtime API
      ├─ media track → native full-duplex microphone and playback
      └─ data channel → tools, events, transcripts, and conversation state
```

`OPENAI_API_KEY` stays in the main process. The renderer only ever sees a
short-lived token, minted per connect. Ambient stores conversation history in a
local SQLite database under Electron's user-data directory. The database is
accessed only by the main process through Drizzle; Zustand hydrates the renderer
from a typed IPC snapshot and keeps live events in sync.

### Audio

The official OpenAI Agents SDK owns audio transport. The renderer passes its mono
`MediaStream` to `OpenAIRealtimeWebRTC`; WebRTC carries microphone and remote
audio as native media tracks. Ambient creates a separate analyser only for the
20 Hz meter—it does not encode, queue, resample, or schedule model audio.

Semantic VAD is configured with `createResponse: true` and
`interruptResponse: true`. The server owns the output buffer and automatically
handles barge-in and truncation. Output-audio transcript events populate the
center display. Input transcription remains disabled, avoiding a separate
Whisper quota requirement.

| Path | Role |
| --- | --- |
| `src/main/main.ts` | Window, mic permission, env loading, network toggle IPC |
| `src/main/token-server.ts` | Loopback endpoint that mints ephemeral tokens |
| `src/shared/config.ts` | Model id, voice, instructions, audio format |
| `src/renderer/use-session.ts` | Realtime session, mic analysis, and voice announcements |
| `src/renderer/store.ts` | Zustand renderer state, IPC hydration, and live event reducers |
| `src/main/db/` | Drizzle schema, migrations, and local session repository |
| `src/main/router.ts` | Durable primary-worker session, message mailbox, helper and presentation tools |
| `src/main/workers.ts` | Subagent registry and utility-process lifecycle |
| `src/main/subagent.ts` | One-shot subagent entry: run task, report once, exit |
| `src/main/sandbox-policy.ts` | Filesystem/network policy shared by the primary worker and helpers |
| `src/main/sandbox-tools.ts` | Sandbox Runtime wiring and pi tool gating |
| `src/renderer/App.tsx` | The cluster |

## Voice and primary worker

The voice agent has one work-facing tool: `send_message`. It forwards every
actionable user message, with relevant conversational context, to the primary
worker. `select_workspace` and `open_workspace` remain direct interface controls.
The voice agent does not decide whether a request is large enough to delegate and
does not plan helper topology itself.

Both agents communicate through a `send_message({ message })` tool. For the voice
agent it sends to the primary worker; for the primary worker it sends back to the
voice agent. Primary-worker prose is never forwarded implicitly.

`send_message` is deliberately **asynchronous**. The main process records an
internal work item, queues the message in the primary worker's mailbox, and
immediately returns `{ messageId, status: "sent" }`. The voice model may give one
short acknowledgement such as “Checking current pricing.” Internal IDs and work
topology are never exposed to the user.

When work is already active, `send_message` is steering rather than another
mailbox item: the new instruction is inserted at Pi's next agent boundary and
amends the active request. It is processed before another model turn instead of
waiting for the current job to finish.

The primary system prompt keeps spoken outcomes to one short sentence and asks
for useful nontrivial detail to be presented on the timeline first.

```
voice calls send_message(message)
  → IPC → primary-worker mailbox, returns { messageId, status: "sent" }
  → primary worker answers quick messages or dispatches helpers for substantive work
  → helper processes stream tool telemetry and progress notes to the board
  → primary agent yields while helpers work; meaningful milestones and final
    reports wake it automatically for a concise update or synthesis
  → helper results return only to the primary worker
  → primary worker synthesizes, optionally calls show_widget, then uses send_message
    whenever it needs to communicate with the voice agent
  → renderer's response sequencer picks up the worker reply when voice is free
```

The primary agent is a host-side Pi orchestration session. It owns
`dispatch_subagent`, `show_widget`, and `send_message`; computer work belongs to
persistent subagents. Anything likely to exceed one second is dispatched
immediately so the primary turn ends fast and remains available for new questions
and live steering. Meaningful milestones wake the primary after a short delay and
are throttled; final reports wake it immediately for synthesis. Widgets are optional glance
cards: one takeaway, no more than three short bullets, and only meaningful
milestones. Reusing a stable `widgetId` updates the card without adding clutter.
A serialized mailbox prevents concurrent messages from corrupting worker context.
Runtime turns carry factual event envelopes only; delegation, progress, synthesis,
presentation, and voice behavior are defined in the primary system prompt.
Pressing the voice button starts a new session; the Settings panel can also start
a session or reopen an earlier one. Each Ambient
session keeps its application history in SQLite and points to Pi's own persistent
JSONL context, so model context and cockpit history both survive restarts. Active
jobs are marked interrupted after an application restart rather than being
incorrectly resumed without their utility processes.

The Agents view includes the persistent primary agent above its delegated
subagents. Primary and subagent tool traces, updates, Pi session identities, and
files written or edited inside the workspace are retained with the session.

Each subagent is a one-shot Electron utility process: it receives one launch
payload, runs one Pi session, reports once, and exits. There is no steering or
idle session to manage; cancellation asks Pi to abort and then terminates the
process tree. Along the way each subagent streams its latest working note as a
progress update, which feeds both the board and throttled primary-agent updates.
Subagents get `read`, `write`, `edit`, `bash`, and `ls`, and tool
calls become stops on the board. When the job's captured network policy allows
it, they also receive `exa_search` (with `EXA_API_KEY` configured) and the
Chrome DevTools MCP proxy through `pi-mcp-adapter`. **BROWSER HEADLESS/VISIBLE**
in the cockpit controls newly dispatched subagents. Headless mode runs isolated
Chromium; visible mode launches a dedicated host Chrome profile and connects to
its DevTools endpoint over loopback, so browser actions are visible without
exposing the user's normal Chrome profile. MCP usage statistics, update checks,
and CrUX lookups are disabled. The selected provider and model are passed per
dispatch, and each dispatch receives freshly formatted local date/time and the
saved location.

### Timeline results

Only the primary worker has `show_widget`. Helpers return findings, links, and useful
artifact paths; the primary worker decides whether a visual helps and combines parallel
findings into one coherent timeline result. The tool supports three formats:

- `markdown` is the default for compact reports, lists, comparisons, and tables.
- `html` is reserved for simple responsive visuals that Markdown cannot express.
- `image` accepts HTTPS/data URLs or PNG, JPEG, WebP, and GIF files saved inside
  the selected workspace, including useful Chrome DevTools screenshots.

Every format can include up to four tappable HTTP(S) links. Image widgets can
also include a short Markdown caption, making route results work as a map
screenshot, a few essential directions, and an **Open in Google Maps** action
without embedding another browser in Ambient.

The primary worker may pass a stable `widgetId`. Reusing it within the same job updates
that timeline item in place; omitting it appends a new item. Timeline items are
ordered by arrival, external links open in the system browser, and the renderer
sizes HTML previews to their content with a height cap suitable for narrow windows.

Subagents run with the host's normal user toolchain (Git, Python, Node, and any
other installed CLIs), constrained by the sandbox below rather than by a curated
container image.

### Security posture

Primary-worker and helper tool calls run inside Anthropic's Sandbox Runtime (macOS
Seatbelt). `bash` commands are wrapped by the OS sandbox; the native `read`,
`write`, `edit`, and `ls` tools are gated by an equivalent path policy before
they execute. Agents see pi's normal tool names and errors — never sandbox
configuration.

- **Reads** are broad, except credential stores: Ambient's pi agent directory,
  `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.kube`, `~/.config/gcloud`,
  macOS Keychains, browser profiles, and any `.env`, `.env.*`, `*.pem`, or
  `*.key` file. Secret-named environment variables (API keys, tokens, passwords)
  are stripped from command environments.
- **Writes** are allowed only inside the selected workspace and a private
  per-task temp directory. `.git` is read-only. Paths are canonicalized with
  symlinks resolved before authorization, so traversal and symlink escapes fail.
- **Network** is governed by the **NETWORK** toggle in the cockpit. It defaults
  OFF on every launch and is captured by each top-level job at dispatch time —
  running jobs and their subagents keep their original value. OFF blocks shell
  egress (all outbound traffic is forced through a deny-all local proxy), Exa,
  and browser MCP tools; ON permits them for that job. The model-provider
  connection itself is made by the host runtime, outside the tool sandbox.
  Loopback dev servers keep working in both states.
- **Untracked workspace files remain writable — and therefore deletable — by
  the agent.** Git plus the sandbox is the chosen protection model; the secret
  deny list is defense-in-depth, not a guarantee that every personal file is
  classified.
- macOS Apple Events, `open`, and application launching stay disabled.

Subagent reports, web pages, and search results are untrusted content. Treat
their output as data, and do not hand a task text containing secrets.
