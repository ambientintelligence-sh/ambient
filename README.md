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

macOS will ask for microphone access on first launch.

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

| Path | Role |
| --- | --- |
| `src/main/main.ts` | Window, mic permission, env loading |
| `src/main/token-server.ts` | Loopback endpoint that mints ephemeral tokens |
| `src/shared/config.ts` | Model id, voice, system instructions |
| `src/renderer/use-session.ts` | Realtime session, mic analysis, event → fleet wiring |
| `src/renderer/fleet.ts` | Pure delegation reducer |
| `src/renderer/App.tsx` | The cluster |

## What is real and what is not

Real: the realtime session, turn detection, mic capture and level metering,
speech playback, connection state, turn counts.

**Simulated** (labelled as such on the panel): the agent roster, tool calls, and
delegation. No tools are registered with the session yet — the setup endpoint
sends `tools: []`. Every simulated transition is driven by a real session event
(`response-created` delegates, `audio-transcript-delta` advances, `response-done`
settles), so wiring in real tools means replacing `fleet.ts`'s event source with
`onToolCall` rather than rebuilding the panel.
