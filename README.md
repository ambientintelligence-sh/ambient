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

The voice agent has two tools: `spawn_worker` and `list_workers`.

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
Reports that arrive mid-response are queued and drained on `response-done`, so a
worker finishing never cuts the agent off.

Each worker is one `pi` session in its own container, started from `docker/worker`.
It gets `read`, `write`, `edit`, `bash`, `ls`, `grep` and `find` in an empty
`/work`, and its tool calls become the stops on the board. The selected provider
and model are passed per dispatch. Ambient's app-specific Pi credential directory
is mounted at `/home/node/.pi/agent`, allowing OAuth refreshes to persist.

### Security posture

pi ships no permission system — inside the container its bash tool is
unrestricted. The container is the boundary:

- Nothing from the host is mounted. `/work` starts empty.
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
