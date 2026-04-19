import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
// secure-exec is externalized in vite.main.config.ts (native Rust V8
// subprocess + browser-target transitive deps). ESM-only, so we load it via
// dynamic `import()` at first use.
import type { NodeRuntime as NodeRuntimeType } from "secure-exec";
import { log } from "../logger";

/**
 * Lazy-initialized singleton V8-isolate runtime shared across all agent
 * invocations. Spinning up the Rust/V8 subprocess is ~100ms, not cheap —
 * keeping it alive across calls is significantly faster and the runtime is
 * safe to share (each `run()` call gets its own isolate with fresh globals).
 */
let runtimeSingleton: NodeRuntimeType | null = null;

async function getRuntime(): Promise<NodeRuntimeType> {
  if (runtimeSingleton) return runtimeSingleton;
  const {
    NodeRuntime,
    createNodeDriver,
    createNodeRuntimeDriverFactory,
    allowAll,
  } = await import("secure-exec");
  runtimeSingleton = new NodeRuntime({
    systemDriver: createNodeDriver({
      permissions: allowAll,
    }),
    runtimeDriverFactory: createNodeRuntimeDriverFactory(),
    memoryLimit: 128,
    cpuTimeLimitMs: 15_000,
  });
  return runtimeSingleton;
}

/**
 * Dispose the shared runtime. Call on app shutdown so the V8 subprocess
 * terminates cleanly. Safe to call repeatedly.
 */
export async function disposeRunJsRuntime(): Promise<void> {
  if (!runtimeSingleton) return;
  try {
    await runtimeSingleton.terminate();
  } catch (err) {
    log("WARN", `Failed to terminate secure-exec runtime: ${err}`);
  }
  runtimeSingleton = null;
}

const RunJsSchema = Type.Object({
  code: Type.String({
    description:
      "JavaScript (CommonJS, node-compatible) code to execute in a sandboxed V8 isolate. " +
      "Use `console.log(...)` to surface results — stdout is captured and returned. " +
      "Has access to node built-ins (fs, http, child_process, …) and npm resolution. " +
      "Runs with a 15s CPU budget and a 128 MB memory limit.",
  }),
});

export function buildRunJsTool(cwd: string): AgentTool<typeof RunJsSchema> {
  return {
    name: "runJs",
    label: "Run JavaScript",
    description: [
      "Execute JavaScript code in a secure, isolated V8 sandbox (secure-exec).",
      "",
      "Use for: pure computation and data transforms — parsing/reshaping JSON, numerical work, regex operations, date math, algorithmic checks. Print results with `console.log(...)` — stdout and stderr are captured and returned.",
      "",
      "CAPABILITIES:",
      "- Node stdlib is available (fs, path, crypto, url, etc.).",
      "- ONLY npm packages already installed in the host project are resolvable. You cannot install or download packages. If you need a library that isn't already a dep, don't use runJs.",
      "- CPU budget: 15s. Memory: 128 MB. Exit code 124 on CPU timeout.",
      "",
      "DO NOT use runJs when a different tool is a better fit:",
      "- Generating document artifacts (.docx, .pdf, .xlsx, images): use `bash` with CLI tools like pandoc, npx, imagemagick.",
      "- Editing a file on disk: use `edit` or `write`.",
      "- Running shell commands, package managers, git, build tools: use `bash`.",
      "- Simple arithmetic or string manipulation you can do yourself in your response.",
    ].join("\n"),
    parameters: RunJsSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, { code }: Static<typeof RunJsSchema>, signal) => {
      const runtime = await getRuntime();

      let stdout = "";
      let stderr = "";
      const result = await runtime.exec(code, {
        cwd,
        onStdio: (event) => {
          if (event.channel === "stdout") stdout += event.message;
          else stderr += event.message;
        },
      });

      // secure-exec has no AbortSignal surface; the 15s CPU budget bounds
      // worst case. If the caller aborted during execution, surface it.
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      const payload = {
        exitCode: result.code,
        ...(result.errorMessage ? { error: result.errorMessage } : {}),
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
        ...(stdout.length > 4000 ? { stdoutTruncated: true } : {}),
        ...(stderr.length > 4000 ? { stderrTruncated: true } : {}),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        details: payload,
      };
    },
  };
}
