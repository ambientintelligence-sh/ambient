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

macOS will ask for microphone access on first launch. Docker must be running —
workers execute in containers, and the image is built on first launch.

Ambient opens the Pi delegation setup on launch. Sign in to any provider exposed
by Pi using OAuth/account login or an API key, then choose a model. Reopen the
picker with **MODEL**. The choice is saved in Ambient's user-data directory.
The realtime voice connection still requires `OPENAI_API_KEY`; Pi account login
only authenticates delegated workers.

## How it fits together

```
Electron main ──┐
                ├─ loopback HTTP server  ──► openai.experimental_realtime.getToken()
                │  (127.0.0.1, random port, /api/realtime/setup)
                │
renderer ───────┘
  experimental_useRealtime({ api: { token: <that url> } })
      │
      ├─ POST setup  → { token, url, tools }
      ├─ WebSocket   → wss://api.openai.com/v1/realtime
      └─ mic         → getUserMedia → realtime.startAudioCapture(stream)
```

`OPENAI_API_KEY` stays in the main process. The renderer only ever sees a
short-lived token, minted per connect.

### Audio

Nothing in this app touches audio samples. `startAudioCapture(stream)` opens an
`AudioContext` at the configured rate, takes channel 0, resamples if the context
did not honour the rate, converts float32 to little-endian PCM16, base64-encodes
it and appends it to the input buffer. Playback runs the same chain in reverse.
All we do is hand it a mono `MediaStream`.

The one thing worth pinning: the SDK hard-codes its capture rate (24 kHz by
default) but only sends a `format` to OpenAI if you set `inputAudioFormat`. Leave
it unset and you are relying on the server default happening to match the
client's. `REALTIME_SESSION_CONFIG` sets both formats explicitly from
`REALTIME_SAMPLE_RATE`, and the same object is used to mint the token and to send
the session update, so the two cannot drift.

| Path | Role |
| --- | --- |
| `src/main/main.ts` | Window, mic permission, env loading |
| `src/main/token-server.ts` | Loopback endpoint that mints ephemeral tokens |
| `src/shared/config.ts` | Model id, voice, instructions, audio format |
| `src/renderer/use-session.ts` | Realtime session, mic analysis, tool calls, worker reports |
| `src/main/workers.ts` | Worker registry and container lifecycle |
| `src/main/docker.ts` | Image build and Docker availability |
| `src/shared/tools.ts` | Tools exposed to the realtime session |
| `docker/worker/` | Worker image: pi + the JSONL entry script |
| `src/renderer/App.tsx` | The cluster |

## Workers

The voice agent has seven tools: `phone_a_friend`, `spawn_worker`, `steer_worker`,
`stop_worker`, `list_workers`, `select_workspace`, and `open_workspace`.

`phone_a_friend` sends one focused question and concise factual context directly
to the separately selectable **ADVISOR** model through Pi's `completeSimple()`.
It is tool-free and does not spawn a coding session. The advisor returns a direct
recommendation to the realtime orchestrator, which incorporates it into its reply.

`spawn_worker` is deliberately **asynchronous**. It returns as soon as the worker
has a callsign — it never waits for the work. The model is told to announce the
callsign and stop, because a realtime session cannot sit silent for a minute
while a container thinks.

```
model calls spawn_worker(task)
  → renderer onToolCall → IPC → main dispatches, returns { worker: "KESTREL", status: "dispatched" }
  → container starts behind it, streaming JSONL progress to the board
  → on finish, the report is pushed into the conversation as a new item
    plus a response-create, and the agent says it out loud
```

That last step is the only way to speak after a tool call has already returned:
the result is long gone, so the report enters as a fresh conversation item.
While a worker is running, the host samples its latest tool state every five
seconds. It requests orientation updates at 5, 10, 15, and 20 seconds; after that,
it requests speech only when activity meaningfully changes. A separately
selectable summary model receives the task, recent tools, current activity, and
previous spoken update. It returns
`SKIP` for startup, waiting, repetition, or administrative noise; otherwise it
produces one concrete first-person sentence. Tool completion results are included,
so updates describe verified accomplishments rather than raw commands. The
realtime orchestrator speaks that prepared sentence verbatim. Expanded worker
rows retain the latest natural-language updates plus raw tool details. Updates that arrive
mid-response are deduplicated, and a final report replaces stale progress, so
speech never interrupts itself or builds an unbounded backlog.

`steer_worker` sends a JSONL command over the selected container's stdin and calls
Pi's `session.steer()` inside the active session. Steering is cooperative: Pi
applies it at the next safe point, so a shell command already in flight may finish
first. Instructions sent while a container is still starting are queued by the
host and flushed as soon as stdin is available. `stop_worker` marks work stopped,
asks Pi to abort cleanly over the same channel, and force-kills the container after
a short grace period if it has not exited.

Each worker is one `pi` session in its own container, started from `docker/worker`.
The user selects a host folder with **FILES**; Ambient persists that choice and
mounts it read/write at `/work` for every worker. All workers therefore see the
same files, and their output appears on the host immediately. Nothing else from
the host filesystem is visible. Workers get `read`, `write`, `edit`, `bash`, `ls`,
`grep`, and `find`, and tool calls become stops on the board. The selected provider
and model are passed per dispatch. Ambient's app-specific Pi credential directory
is mounted at `/home/node/.pi/agent`, allowing OAuth refreshes to persist.

### Security posture

pi ships no permission system — inside the container its bash tool is
unrestricted. The container is the boundary:

- Only the explicitly selected workspace is mounted at `/work`, read/write.
  Workers have full control inside it, including deletion. Other host paths are
  invisible; Ambient deliberately does not mount the home directory read-only.
- `--cap-drop=ALL`, `--security-opt=no-new-privileges`, non-root user.
- Capped at 2 CPUs, 2 GB, 512 pids.
- The task and provider selection are passed as environment variables rather
  than command-line arguments. Docker container metadata can still expose
  environment values to users who can access the Docker daemon.
- Ambient's Pi credential directory is mounted read/write. Every worker can use
  every provider credential saved through Ambient, and can persist token refreshes.

**Network is not restricted**, because workers have to reach model-provider APIs.
A worker can therefore fetch and send data. Treat worker output as untrusted, and
do not hand a worker a task containing secrets.
