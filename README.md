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
short-lived token, minted per connect.

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
| `src/main/main.ts` | Window, mic permission, env loading |
| `src/main/token-server.ts` | Loopback endpoint that mints ephemeral tokens |
| `src/shared/config.ts` | Model id, voice, instructions, audio format |
| `src/renderer/use-session.ts` | Realtime session, mic analysis, work dispatch, router reports |
| `src/main/router.ts` | Durable router session, job mailbox, subagent and presentation tools |
| `src/main/workers.ts` | Worker registry and container lifecycle |
| `src/main/docker.ts` | Image build and Docker availability |
| `docker/worker/` | Worker image: pi + the JSONL entry script |
| `src/renderer/App.tsx` | The cluster |

## Router and workers

The voice agent has five tools: `dispatch_work`, `cancel_work`, `list_work`,
`select_workspace`, and `open_workspace`. It submits top-level intent
instead of planning or addressing individual workers.

`dispatch_work` is deliberately **asynchronous**. The main process records a job,
queues it in the router mailbox, and immediately returns `{ jobId, status:
"accepted" }`. The voice model then gives one present-progressive acknowledgement
such as “I’m checking the current pricing.” It never exposes job IDs or routing.

```
voice calls dispatch_work(task)
  → IPC → router mailbox, returns { jobId, status: "accepted" }
  → router answers quick reasoning itself or calls dispatch_subagent
  → child containers stream JSONL telemetry to the board
  → child results return only to the router
  → router synthesizes, optionally calls show_widget, then publish_voice_message
  → renderer's response sequencer delivers the result when voice is free
```

The router is a host-side Pi session with the same working tools as a child:
`read`, `write`, `edit`, `bash`, `ls`, `grep`, `find`, Exa search, and the compact
Chrome DevTools MCP proxy. It additionally owns `dispatch_subagent`, `show_widget`,
and `publish_voice_message`. It can therefore do quick or sequential work itself
and dispatch independent children when parallelism or a separate context helps.
A serialized mailbox prevents concurrent prompts from corrupting router context.

Internal steering sends a JSONL command over the selected container's stdin. During
an active run it calls Pi's `session.steer()`; while ONLINE and idle it calls
`session.prompt()` on the same retained session. Steering is cooperative, so a
shell command already in flight may finish first. Instructions sent while a
container is still starting are queued by the host and flushed as soon as stdin
is available. Workers have no normal finished state: they remain ONLINE until
explicitly stopped or Ambient exits. Cancelling a top-level job marks its children stopped,
asks Pi to abort cleanly over the same channel, and force-kills the container after
a short grace period if it has not exited.

Each worker is one `pi` session in its own container, started from `docker/worker`.
The user selects a host folder with **FILES**; Ambient persists that choice and
mounts it read/write at `/work` for every worker. All workers therefore see the
same files, and their output appears on the host immediately. Nothing else from
the host filesystem is visible. Workers get `read`, `write`, `edit`, `bash`, `ls`,
`grep`, and `find`, and tool calls become stops on the board. Workers also receive
`exa_search` when `EXA_API_KEY` is configured. Chrome DevTools is integrated through
`pi-mcp-adapter`: Pi sees one compact `mcp` proxy tool, discovers Chrome tools on
demand, and starts the MCP server lazily instead of placing 29 schemas in every
prompt. **BROWSER HEADLESS/VISIBLE** in the cockpit controls newly dispatched
workers. Headless mode runs isolated Chromium in the container. Visible mode
launches a dedicated host Chrome profile and connects to it through a temporary
DevTools proxy, so browser actions are visible without exposing the user's normal
Chrome profile. In visible mode, a worker records pre-existing tabs before browsing;
at each checkpoint it selects the relevant result page and closes only intermediate
tabs it opened. Other users' or workers' pre-existing tabs are preserved. MCP usage
statistics, update checks, and CrUX lookups are disabled.

Workers route web work by intent: factual lookups (pricing, docs, comparisons,
current facts) use Exa first and avoid launching Chrome when primary-source search
results are sufficient. Interaction requests (configure, enable, change, click,
fill, navigate) use Chrome and perform the requested action. Dynamic pages and
live verification can also escalate from Exa to Chrome.
The selected provider and model are passed per dispatch. Ambient's app-specific Pi credential directory
is mounted at `/home/node/.pi/agent`, allowing OAuth refreshes to persist.
Each dispatch also receives freshly formatted local date/time and the saved
location, and retained workers receive refreshed context when they are steered.

### Timeline results

Only the router has `show_widget`. Subagents return findings, links, and useful
artifact paths; the router decides whether a visual helps and combines parallel
findings into one coherent timeline result. The tool supports three formats:

- `markdown` is the default for compact reports, lists, comparisons, and tables.
- `html` is reserved for simple responsive visuals that Markdown cannot express.
- `image` accepts HTTPS/data URLs or PNG, JPEG, WebP, and GIF files saved inside
  the mounted `/work` workspace, including useful Chrome DevTools screenshots.

Every format can include up to four tappable HTTP(S) links. Image widgets can
also include a short Markdown caption, making route results work as a map
screenshot, a few essential directions, and an **Open in Google Maps** action
without embedding another browser in Ambient.

The router may pass a stable `widgetId`. Reusing it within the same job updates
that timeline item in place; omitting it appends a new item. Timeline items are
ordered by arrival, external links open in the system browser, and the renderer
sizes HTML previews to their content with a height cap suitable for narrow windows.

The image includes a writable Python virtual environment at `/opt/pyenv` (already
on `PATH`). It covers common HTTP, scraping, data-science, spreadsheet, document,
image, plotting, web-service, database, cloud, typing, linting, and testing work:
NumPy, pandas, Polars, SciPy, scikit-learn, OpenPyXL, XlsxWriter, python-docx,
python-pptx, PyPDF2, Pillow, Matplotlib, Seaborn, Requests, HTTPX, aiohttp,
Beautiful Soup, lxml, FastAPI, Flask, Uvicorn, SQLAlchemy, Pydantic, boto3,
pytest, Ruff, mypy, Rich, and related utilities. Workers can install additional
packages into the same venv with normal `pip install`. System utilities include
zip/unzip, SQLite, a compiler toolchain, Git, ripgrep, curl, jq, and Chromium.

### Security posture

pi ships no permission system. Child workers remain containerized, but the router
currently runs in Electron's main process with unrestricted host tools. Its `cwd`
is the selected workspace (or a private scratch folder before one is selected),
but `bash` can access paths outside that directory. This is intentionally an
experimental, unsandboxed router configuration; only use it with trusted requests
and content.

For child workers, the container remains the boundary:

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

**Network is not restricted**, because workers have to reach model-provider,
Exa, and browser targets. Browser pages and search results are untrusted content.
A worker can therefore fetch and send data. Treat worker output as untrusted, and
do not hand a worker a task containing secrets.
