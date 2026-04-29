import { EventEmitter } from "node:events";
import { type ChildProcess } from "node:child_process";
import { APICallError, type LanguageModel } from "ai";
import { z } from "zod";

import type {
  Agent,
  AgentKind,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AgentPlanApprovalResponse,
  AudioSource,
  Direction,
  TranscriptBlock,
  SessionConfig,
  SessionEvents,
  Summary,
  UIState,
  LanguageCode,
  TaskSuggestion,
  Insight,
  TranscriptionProvider,
  AnalysisProvider,
} from "./types";
import { createTranscriptionModel, createAnalysisModel, createTaskModel, createUtilitiesModel, createSynthesisModel, createAgentPiModel } from "./providers";
import { log } from "./logger";
import { pcmToWavBuffer } from "./audio/audio-utils";
import { toReadableError } from "./text/text-utils";
import { countScanWords } from "./text/text-utils";
import {
  analysisSchema,
  type AgentSuggestionItem,
  taskFromSelectionSchema,
  sessionTitleSchema,
  buildAnalysisPrompt,
  buildTaskFromSelectionPrompt,
  buildSessionTitlePrompt,
} from "./analysis/analysis";
import { runSuggestionAgent } from "./analysis/suggestion-agent";
import { captureScreenshot } from "./screenshot";
import { classifyTaskSize as classifyTaskSizeWithModel, type TaskSizeClassification } from "./analysis/task-size";
import type { AppDatabase } from "./db/db";
import {
  LANG_NAMES,
  getLanguageLabel,
  hasTranslatableContent,
  buildAudioPromptForStructured,
  buildAudioTranscriptionOnlyPrompt,
  detectSourceLanguage,
} from "./language";
import {
  createCostAccumulator,
  addCost as addCostToAcc,
  resetCost,
  type CostAccumulator,
} from "./cost";
import {
  createVadState,
  resetVadState,
  processAudioData,
  flushVad,
  type VadState,
} from "./audio/vad";
import {
  createContextState,
  resetContextState,
  recordContext,
  createBlock,
  loadAgentsMd,
  type ContextState,
} from "./context";
import {
  checkMacOSVersion,
  createAudioRecorder,
  listAvfoundationDevices,
  selectAudioDevice,
  spawnFfmpeg,
  spawnMicFfmpeg,
  type AudioRecorder,
} from "./audio/audio";
import { createAgentManager, type AgentManager } from "./agents/agent-manager";
import { discoverSkills } from "./agents/skills";
import type { AgentExternalToolSet } from "./agents/external-tools";
import {
  getTranscriptPostProcessPromptTemplate,
  renderPromptTemplate,
} from "./prompt-loader";
import { ParagraphBuffer } from "./paragraph-buffer";
import {
  generateFinalSummary as generateFinalSummaryFn,
  generateAgentsSummary as generateAgentsSummaryFn,
  formatSummaryError,
} from "./summary-generator";
import { generateStructuredObject } from "./ai/structured-output";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
  on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): TypedEmitter;
};

type AudioPipeline = {
  source: AudioSource;
  vadState: VadState;
  overlap: Buffer;
};

type TaskSuggestionDraft = {
  text: string;
  flag?: string;
  details?: string;
  transcriptExcerpt?: string;
  kind?: import("./types").SuggestionKind;
};

type SuggestionScanProgress = {
  scanId: string;
  label?: string;
  busy: boolean;
  wordsUntilNextScan: number;
  liveWordsUntilNextScan?: number;
  scanWordBudget?: number;
  step?: string;
  lastScanEmpty?: boolean;
  error?: string;
};

type SuggestionScanRequest = {
  force: boolean;
  reason: "auto" | "manual";
};

type QueuedSuggestionScanRequest = SuggestionScanRequest & {
  resolve: (result: SuggestionScanResult | null) => void;
};

type SuggestionScanResult = {
  scanId: string;
  suggestions: TaskSuggestion[];
  taskSuggestionsEmitted: number;
  lastScanEmpty: boolean;
};

function buildSuggestionArchiveDetails(candidate: TaskSuggestionDraft): string | undefined {
  const sections = [
    candidate.flag?.trim() ? `Flag:\n${candidate.flag.trim()}` : "",
    candidate.details?.trim() ? `Context summary:\n${candidate.details.trim()}` : "",
    candidate.transcriptExcerpt?.trim() ? `Original transcript excerpt:\n${candidate.transcriptExcerpt.trim()}` : "",
  ].filter(Boolean);
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function stringifyErrorPart(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 0 ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function truncateForLog(value: string, maxChars = 800): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function formatModelErrorForLog(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const parts = [
      `${error.name}: ${error.message}`,
      error.statusCode ? `status=${error.statusCode}` : null,
      error.url ? `url=${error.url}` : null,
      error.responseBody ? `responseBody=${truncateForLog(error.responseBody)}` : null,
      error.data ? `data=${truncateForLog(stringifyErrorPart(error.data) ?? "")}` : null,
      error.cause ? `cause=${truncateForLog(stringifyErrorPart(error.cause) ?? "")}` : null,
    ].filter(Boolean);
    return parts.join(" | ");
  }

  if (error instanceof Error) {
    const cause = "cause" in error ? stringifyErrorPart((error as { cause?: unknown }).cause) : null;
    return cause
      ? `${error.name}: ${error.message} | cause=${truncateForLog(cause)}`
      : `${error.name}: ${error.message}`;
  }

  return toReadableError(error);
}

function normalizeInsightText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .toLowerCase();
}

function dedupeInsightHistory(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of texts) {
    const text = raw.trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = normalizeInsightText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique;
}

export type SessionExternalDeps = {
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  getCodexClient?: import("./agents/codex-client").GetCodexClient;
  getClaudeClient?: import("./agents/claude-client").GetClaudeClient;
  getOpenAiCodexAccessToken?: () => Promise<string>;
  dataDir?: string;
};

export class Session {
  readonly events: TypedEmitter = new EventEmitter() as TypedEmitter;
  readonly config: SessionConfig;
  readonly sessionId: string;

  private transcriptionModel: LanguageModel;
  private analysisModel: LanguageModel;
  private taskModel: LanguageModel;
  private utilitiesModel: LanguageModel;
  private synthesisModel: LanguageModel;
  private audioTranscriptionSchema: z.ZodObject<z.ZodRawShape>;
  private transcriptionOnlySchema: z.ZodObject<z.ZodRawShape>;
  private textPostProcessSchema: z.ZodObject<z.ZodRawShape>;

  private isRecording = false;
  private audioRecorder: AudioRecorder | null = null;
  private ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null;
  private legacyDevice: { index: number; name: string } | null = null;

  // Mic pipeline
  private micProcess: ChildProcess | null = null;
  private _micEnabled = false;

  // Per-source transcription queues. Each source runs its own sequential worker.
  private chunkQueues = new Map<AudioSource, Array<{ chunk: Buffer; capturedAt: number }>>([
    ["system", []],
    ["microphone", []],
  ]);
  private inFlight = new Map<AudioSource, number>([["system", 0], ["microphone", 0]]);
  private readonly maxConcurrency = 10;
  private readonly maxQueueSize = 20;

  // Per-pipeline state
  private systemPipeline: AudioPipeline = {
    source: "system",
    vadState: createVadState(),
    overlap: Buffer.alloc(0),
  };
  private micPipeline: AudioPipeline = {
    source: "microphone",
    vadState: createVadState(200),
    overlap: Buffer.alloc(0),
  };

  private paragraphBuffer: ParagraphBuffer;

  private contextState: ContextState = createContextState();
  private costAccumulator: CostAccumulator = createCostAccumulator();
  private userContext: string;
  private _translationEnabled: boolean;

  private analysisTimer: NodeJS.Timeout | null = null;
  private analysisHeartbeatTimer: NodeJS.Timeout | null = null;
  private analysisInFlight = false;
  private analysisIdleWaiters: Array<() => void> = [];
  private analysisRequested = false;
  private readonly analysisDebounceMs = 300;
  private readonly analysisHeartbeatMs = 5000;
  private readonly analysisRetryDelayMs = 2000;
  private readonly taskAnalysisMaxBlocks = 20;
  private get taskAnalysisMinNewWords() {
    return this.config.suggestionScanWordBudget;
  }
  private recentSuggestedTaskTexts: string[] = [];
  private suggestionScanSequence = 0;
  private suggestionScanQueue: QueuedSuggestionScanRequest[] = [];
  private suggestionScanInFlight = new Map<string, SuggestionScanProgress>();
  private readonly maxSuggestionScanConcurrency = 3;
  private lastTaskAnalysisAt = 0;
  private lastTaskAnalysisBlockCount = 0;
  private lastTaskAnalysisWordCount = 0;
  private queuedTaskAnalysisWordCount = 0;
  /** Timestamp of last mic speech detection, for system-audio ducking */
  private lastSummary: Summary | null = null;
  private lastAnalysisBlockCount = 0;
  private titleGenerated = false;
  private db: AppDatabase | null;
  private agentManager: AgentManager | null = null;
  private getExternalTools?: () => Promise<AgentExternalToolSet>;
  private getCodexClient?: SessionExternalDeps["getCodexClient"];
  private getClaudeClient?: SessionExternalDeps["getClaudeClient"];
  private getOpenAiCodexAccessToken?: SessionExternalDeps["getOpenAiCodexAccessToken"];
  private dataDir?: string;

  private get sourceLangLabel(): string { return getLanguageLabel(this.config.sourceLang); }
  private get targetLangLabel(): string { return getLanguageLabel(this.config.targetLang); }
  private get sourceLangName(): string { return LANG_NAMES[this.config.sourceLang]; }
  private get targetLangName(): string { return LANG_NAMES[this.config.targetLang]; }
  private get summaryDeps() {
    return {
      synthesisModel: this.synthesisModel,
      synthesisModelId: this.config.synthesisModelId,
      sessionId: this.sessionId,
      db: this.db,
      trackCost: this.trackCost.bind(this),
    };
  }

  private trackCost(inputTokens: number, outputTokens: number, inputType: "audio" | "text", provider: TranscriptionProvider | AnalysisProvider): void {
    const total = addCostToAcc(this.costAccumulator, inputTokens, outputTokens, inputType, provider);
    this.events.emit("cost-updated", total);
  }

  private ensureTranscriptContext(): void {
    this.hydrateTranscriptContextFromDb();
  }

  private emitIdleSuggestionProgress(lastScanEmpty = false): void {
    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    const committedWordCount = allBlocks.reduce(
      (sum, b) => sum + countScanWords(b.sourceText),
      0,
    );
    const pendingWordCount = this.paragraphBuffer.pendingWordCount;
    const liveWordCount = committedWordCount + pendingWordCount;
    const committedNewWords = Math.max(0, committedWordCount - this.queuedTaskAnalysisWordCount);
    const liveNewWords = Math.max(0, liveWordCount - this.queuedTaskAnalysisWordCount);
    const wordsUntilNextScan = Math.max(0, this.taskAnalysisMinNewWords - committedNewWords);
    const liveWordsUntilNextScan = Math.max(0, this.taskAnalysisMinNewWords - liveNewWords);
    const committedWordsUntilNextScan = Math.max(0, this.taskAnalysisMinNewWords - committedNewWords);
    if (committedWordsUntilNextScan === 0 && this.isCapturing) {
      const scansToQueue = Math.floor(committedNewWords / this.taskAnalysisMinNewWords);
      this.queuedTaskAnalysisWordCount += scansToQueue * this.taskAnalysisMinNewWords;
      for (let index = 0; index < scansToQueue; index += 1) {
        void this.enqueueSuggestionScan({ force: false, reason: "auto" });
      }
      return;
    }
    this.events.emit("suggestion-progress", {
      busy: false,
      wordsUntilNextScan,
      liveWordsUntilNextScan,
      scanWordBudget: this.taskAnalysisMinNewWords,
      lastScanEmpty,
    });
  }

  constructor(config: SessionConfig, db?: AppDatabase, sessionId?: string, externalDeps?: SessionExternalDeps) {
    this.config = config;
    this.db = db ?? null;
    this.sessionId = sessionId ?? crypto.randomUUID();
    this.getExternalTools = externalDeps?.getExternalTools;
    this.getCodexClient = externalDeps?.getCodexClient;
    this.getClaudeClient = externalDeps?.getClaudeClient;
    this.getOpenAiCodexAccessToken = externalDeps?.getOpenAiCodexAccessToken;
    this.dataDir = externalDeps?.dataDir;
    this._translationEnabled = config.translationEnabled;
    this.userContext = this.loadProjectContext();

    this.transcriptionModel = createTranscriptionModel(config);
    this.analysisModel = createAnalysisModel(config);
    this.taskModel = createTaskModel(config);
    this.utilitiesModel = createUtilitiesModel(config);
    this.synthesisModel = createSynthesisModel(config);
    this.paragraphBuffer = new ParagraphBuffer({
      polishModel: this.taskModel,
      trackCost: this.trackCost.bind(this),
      emitPartial: (source, text) => {
        this.events.emit("partial", { source, text });
        this.emitIdleSuggestionProgress();
      },
      commitTranscript: this.commitTranscript.bind(this),
      debug: config.debug,
    });

    this.agentManager = createAgentManager({
      model: createAgentPiModel(config, {
        getOpenAiCodexAccessToken: this.getOpenAiCodexAccessToken,
      }),
      utilitiesModel: this.utilitiesModel,
      synthesisModel: this.synthesisModel,
      exaApiKey: process.env.EXA_API_KEY,
      events: this.events,
      getTranscriptSummary: () => this.getTranscriptSummaryForAgent(),
      getTranscriptContext: (last?: number, offset?: number) => this.getTranscriptBlocks(last, offset),
      getRecentBlocks: () => this.db ? this.db.getBlocksForSession(this.sessionId).slice(-20) : [],
      getProjectInstructions: () => {
        const projectId = this.getCurrentProjectId();
        if (!projectId) return undefined;
        return this.db?.getProject(projectId)?.instructions ?? undefined;
      },
      getAgentsMd: () => loadAgentsMd(),
      learningEnabled: config.learningEnabled,
      searchTranscriptHistory: this.db ? (q: string, l?: number) => this.db!.searchBlocks(q, l) : undefined,
      searchAgentHistory: this.db ? (q: string, l?: number) => this.db!.searchAgents(q, l) : undefined,
      captureScreenshot,
      getExternalTools: this.getExternalTools,
      getCodexClient: this.getCodexClient,
      getClaudeClient: this.getClaudeClient,
      getEnabledSkills: () => {
        const all = discoverSkills(process.cwd());
        const disabled = new Set(config.disabledSkillIds ?? []);
        return all.filter((s) => !disabled.has(s.id));
      },
      responseLength: config.responseLength,
      allowAutoApprove: config.agentAutoApprove,
      localTools: {
        files: config.localToolsFiles,
        bash: config.localToolsBash,
        runJs: config.localToolsRunJs,
      },
      db: this.db ?? undefined,
    });
    if (this.db) {
      const persistedAgents = this.db.getAgentsForSession(this.sessionId);
      if (persistedAgents.length > 0) {
        this.agentManager.hydrateAgents(persistedAgents);
      }
    }

    this.events.on("block-added", () => {
      this.emitIdleSuggestionProgress();
    });

    this.rebuildTranscriptionSchemas();
  }

  private rebuildTranscriptionSchemas(): void {
    const englishIsConfigured = this.config.sourceLang === "en" || this.config.targetLang === "en";
    const langEnumValues: [string, ...string[]] = englishIsConfigured
      ? [this.config.sourceLang, this.config.targetLang]
      : [this.config.sourceLang, this.config.targetLang, "en"];

    const sourceLanguageDescription = `The detected language: ${langEnumValues.map((c) => `"${c}" for ${LANG_NAMES[c as LanguageCode] ?? c}`).join(", ")}`;

    this.audioTranscriptionSchema = z.object({
      sourceLanguage: z
        .enum(langEnumValues)
        .describe(sourceLanguageDescription),
      transcript: z
        .string()
        .describe("The transcription of the audio in the original language. Empty string if no speech detected."),
      translation: z
        .string()
        .optional()
        .describe("The translation. Empty if audio is in English or matches target language."),
    });

    this.transcriptionOnlySchema = z.object({
      sourceLanguage: z
        .enum(langEnumValues)
        .describe(sourceLanguageDescription),
      transcript: z
        .string()
        .describe("The transcription of the audio in the original language. Empty string if no speech detected."),
    });

    this.textPostProcessSchema = z.object({
      sourceLanguage: z
        .enum(langEnumValues)
        .describe(sourceLanguageDescription),
      translation: z
        .string()
        .optional()
        .describe("Translated text based on configured language direction. Empty when translation is disabled or not needed."),
      isPartial: z
        .boolean()
        .describe("True if the transcript appears cut off mid-sentence. False if it appears complete."),
      isNewTopic: z
        .boolean()
        .describe("True if the transcript shifts to a new topic compared with provided context."),
    });
  }

  getUIState(status: UIState["status"]): UIState {
    const langPair = `${this.sourceLangName} → ${this.targetLangName}`;
    const deviceName = this.config.legacyAudio && this.legacyDevice
      ? this.legacyDevice.name
      : "System Audio (ScreenCaptureKit)";
    return {
      deviceName,
      modelId: `${langPair} | ${this.config.transcriptionModelId}`,
      intervalMs: this.config.intervalMs,
      status,
      contextLoaded: !!this.userContext,
      cost: this.costAccumulator.totalCost,
      translationEnabled: this._translationEnabled,
      canTranslate: this.canTranslate,
      direction: this.config.direction,
      micEnabled: this._micEnabled,
    };
  }

  get recording(): boolean {
    return this.isRecording;
  }

  private get isCapturing(): boolean {
    return this.isRecording || this._micEnabled;
  }

  get allKeyPoints(): readonly string[] {
    return this.contextState.allKeyPoints;
  }

  get canTranslate(): boolean {
    return this.config.transcriptionProvider === "google" || this.config.transcriptionProvider === "openrouter";
  }

  get translationEnabled(): boolean {
    return this._translationEnabled;
  }

  get micEnabled(): boolean {
    return this._micEnabled;
  }

  private get usesParagraphBuffering(): boolean {
    return (
      (this.config.transcriptionProvider === "google"
        || this.config.transcriptionProvider === "openrouter")
      && !this._translationEnabled
    );
  }

  async initialize(): Promise<void> {
    // Seed context with existing key points for this session only.
    // This keeps analysis anchored to the active conversation.
    if (this.db) {
      const existingSessionInsights = this.db
        .getInsightsForSession(this.sessionId)
        .sort((a, b) => a.createdAt - b.createdAt);
      const existingSessionKeyPoints = existingSessionInsights
        .filter((insight) => insight.kind === "key-point")
        .map((insight) => insight.text);
      const existingEducationalInsights = dedupeInsightHistory(
        existingSessionInsights
          .filter((insight) => insight.kind !== "key-point")
          .map((insight) => insight.text),
      );

      if (existingSessionKeyPoints.length > 0) {
        this.contextState.allKeyPoints.push(...existingSessionKeyPoints);
      }
      if (existingEducationalInsights.length > 0) {
        this.contextState.allEducationalInsights.push(...existingEducationalInsights);
      }

      const archivedTasks = this.db.getArchivedTasksForSession(this.sessionId);
      if (archivedTasks.length > 0) {
        const archivedTexts = archivedTasks.map((t) => t.text);
        this.recentSuggestedTaskTexts.push(...archivedTexts);
      }
    }

    if (this.config.legacyAudio) {
      const devices = await listAvfoundationDevices();
      if (devices.length === 0) {
        throw new Error("No avfoundation audio devices found.");
      }
      this.legacyDevice = selectAudioDevice(devices, this.config.device);
      if (!this.legacyDevice) {
        throw new Error("No loopback device found. Use --device to override.");
      }
    } else {
      const { supported, version } = checkMacOSVersion();
      if (!supported) {
        throw new Error(`ScreenCaptureKit requires macOS 14.2 or later (detected macOS ${version}).`);
      }
    }

    this.events.emit("state-change", this.getUIState("idle"));
  }

  async startRecording(resume = false): Promise<void> {
    if (this.isRecording) return;
    this.isRecording = true;

    resetVadState(this.systemPipeline.vadState);
    this.chunkQueues.set("system", []);
    this.chunkQueues.set("microphone", []);
    this.systemPipeline.overlap = Buffer.alloc(0);
    this.inFlight.set("system", 0);
    this.inFlight.set("microphone", 0);
    this.paragraphBuffer.clear();
    this.events.emit("partial", { source: null, text: "" });

    if (!resume) {
      resetContextState(this.contextState);
      resetCost(this.costAccumulator);
      this.lastSummary = null;
      this.lastAnalysisBlockCount = 0;
      this.lastTaskAnalysisBlockCount = 0;
      this.lastTaskAnalysisAt = 0;
      this.lastTaskAnalysisWordCount = 0;
      this.queuedTaskAnalysisWordCount = 0;
      this.recentSuggestedTaskTexts = [];
      this.titleGenerated = false;
      this.events.emit("blocks-cleared");
      this.events.emit("summary-updated", null);
    }

    this.events.emit("state-change", this.getUIState("connecting"));
    this.events.emit("status", "Connecting...");

    this.events.emit("state-change", this.getUIState("recording"));
    this.events.emit("status", "Streaming. Speak now.");

    if (this.config.legacyAudio && this.legacyDevice) {
      try {
        this.ffmpegProcess = spawnFfmpeg(this.legacyDevice.index);
      } catch (error) {
        this.isRecording = false;
        this.events.emit("status", `ffmpeg error: ${toReadableError(error)}`);
        return;
      }

      if (!this.ffmpegProcess.stdout) {
        this.isRecording = false;
        this.events.emit("status", "ffmpeg failed");
        return;
      }

      this.ffmpegProcess.stdout.on("data", (data: Buffer) => {
        this.handleAudioData(this.systemPipeline, data);
      });

      this.ffmpegProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          log("WARN", `ffmpeg stderr: ${msg}`);
          this.events.emit("status", `ffmpeg: ${msg.slice(0, 80)}`);
        }
      });

      this.ffmpegProcess.on("error", (err) => {
        log("ERROR", `ffmpeg error: ${err.message}`);
        this.events.emit("status", `ffmpeg error: ${err.message}`);
      });

      this.ffmpegProcess.on("close", (code, signal) => {
        log("WARN", `ffmpeg closed: code=${code} signal=${signal}`);
        if (code !== 0 && code !== null && this.isRecording) {
          const msg = `ffmpeg exited with code ${code}`;
          log("ERROR", msg);
          this.events.emit("error", msg);
        }
      });
    } else {
      try {
        this.audioRecorder = createAudioRecorder(16000);
        this.audioRecorder.on("data", (data) => {
          this.handleAudioData(this.systemPipeline, data as Buffer);
        });
        this.audioRecorder.on("error", (err) => {
          const error = err as Error;
          log("ERROR", `Audio capture error: ${error.message}`);
          this.events.emit("status", `Audio error: ${error.message}`);
        });
        await this.audioRecorder.start();
      } catch (error) {
        this.isRecording = false;
        const msg = toReadableError(error);
        log("ERROR", `ScreenCaptureKit error: ${msg}`);
        this.events.emit("status", `Audio capture error: ${msg}`);
        return;
      }
    }

    this.startAnalysisTimer();

  }

  stopRecording(flushRemaining = true): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    // Only stop analysis timer if mic is also off
    if (!this._micEnabled) {
      this.stopAnalysisTimer();
    }

    if (this.audioRecorder) { this.audioRecorder.stop(); this.audioRecorder = null; }
    if (this.ffmpegProcess) { this.ffmpegProcess.kill("SIGTERM"); this.ffmpegProcess = null; }

    if (flushRemaining) {
      const remaining = flushVad(this.systemPipeline.vadState);
      if (remaining) {
        this.enqueueChunk(this.systemPipeline, remaining);
        void this.processQueue("system");
      }
    }
    if (this.usesParagraphBuffering) {
      void this.paragraphBuffer.commitPending(["system"]);
    }
    if (this.chunkQueues.get("system")!.length && this.inFlight.get("system")! < this.maxConcurrency) {
      void this.processQueue("system");
    }
    this.systemPipeline.overlap = Buffer.alloc(0);
    resetVadState(this.systemPipeline.vadState);

    const nextStatus = this._micEnabled ? "recording" : "paused";
    this.events.emit("state-change", this.getUIState(nextStatus));
    this.events.emit("status", this._micEnabled
      ? "Computer audio paused. Mic still active."
      : "Paused. SPACE to resume, Q to quit.");
  }

  startMic(deviceIdentifier?: string): void {
    if (this._micEnabled) return;

    const device = deviceIdentifier ?? this.config.micDevice ?? "0";
    let micStderrBuffer = "";

    try {
      this.micProcess = spawnMicFfmpeg(device);
      this._micEnabled = true;
      resetVadState(this.micPipeline.vadState);
      this.micPipeline.overlap = Buffer.alloc(0);

      let micDataReceived = false;
      let micTotalBytes = 0;
      let micNonZeroSeen = false;

      this.micProcess.stdout?.on("data", (data: Buffer) => {
        if (!micDataReceived) {
          micDataReceived = true;
          this.events.emit("status", "Mic active — listening...");
        }

        // Detect all-zero audio (TCC permission issue)
        if (!micNonZeroSeen) {
          micTotalBytes += data.length;
          const hasNonZero = data.some((b) => b !== 0);
          if (hasNonZero) {
            micNonZeroSeen = true;
          } else if (micTotalBytes > 16000 * 2 * 3) {
            // 3 seconds of pure zeros — almost certainly a permissions issue
            log("WARN", `Mic: ${micTotalBytes} bytes received, all zeros — likely macOS mic permission issue`);
            this.events.emit("error", "Mic producing silent audio. macOS may be blocking mic access for ffmpeg. Check System Settings > Privacy & Security > Microphone.");
            this.events.emit("status", "Mic: all zeros — permission issue?");
            micNonZeroSeen = true; // stop re-warning
          }
        }

        this.handleAudioData(this.micPipeline, data);
      });

      this.micProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          micStderrBuffer += msg + "\n";
        }
      });

      this.micProcess.on("error", (err) => {
        log("ERROR", `Mic ffmpeg error: ${err.message}`);
        this._micEnabled = false;
        this.events.emit("error", `Mic failed: ${err.message}`);
        this.events.emit("state-change", this.getUIState(this.isRecording || this._micEnabled ? "recording" : "paused"));
      });

      this.micProcess.on("close", (code) => {
        if (this._micEnabled) {
          this._micEnabled = false;
          if (code !== 0 && code !== null) {
            const detail = micStderrBuffer.trim().slice(-200) || `exit code ${code}`;
            log("ERROR", `Mic ffmpeg exited: code=${code}, stderr: ${micStderrBuffer.trim()}`);
            this.events.emit("error", `Mic stopped unexpectedly: ${detail}`);
          }
          this.events.emit("state-change", this.getUIState(this.isRecording || this._micEnabled ? "recording" : "paused"));
        }
      });

      this.events.emit("status", "Starting microphone...");
      this.events.emit("state-change", this.getUIState(this.isRecording || this._micEnabled ? "recording" : "paused"));
    } catch (error) {
      this._micEnabled = false;
      log("ERROR", `Failed to start mic: ${toReadableError(error)}`);
      this.events.emit("error", `Mic error: ${toReadableError(error)}`);
    }
  }

  /** Start mic pipeline without ffmpeg — audio will be fed via feedMicAudio from renderer */
  startMicFromIPC(): void {
    if (this._micEnabled) return;

    this._micEnabled = true;
    resetVadState(this.micPipeline.vadState);
    this.micPipeline.overlap = Buffer.alloc(0);
    this.micDebugWindowCount = 0;

    // Start analysis timer if system audio isn't already driving it
    if (!this.isRecording) {
      this.startAnalysisTimer();
    }

    this.events.emit("status", "Mic active — listening...");
    this.events.emit("state-change", this.getUIState(this.isRecording || this._micEnabled ? "recording" : "paused"));
  }

  /** Receive PCM audio from renderer IPC */
  feedMicAudio(data: Buffer): void {
    if (!this._micEnabled) return;
    this.handleAudioData(this.micPipeline, data);
  }

  stopMic(): void {
    if (!this._micEnabled) return;

    const remaining = flushVad(this.micPipeline.vadState);
    if (remaining) {
      this.enqueueChunk(this.micPipeline, remaining);
      void this.processQueue("microphone");
    }
    if (this.usesParagraphBuffering) {
      void this.paragraphBuffer.commitPending(["microphone"]);
    }

    if (this.micProcess) {
      this.micProcess.kill("SIGTERM");
      this.micProcess = null;
    }

    this._micEnabled = false;
    resetVadState(this.micPipeline.vadState);
    this.micPipeline.overlap = Buffer.alloc(0);

    // Stop analysis timer if system audio is also off
    if (!this.isRecording) {
      this.stopAnalysisTimer();
    }

    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
  }

  toggleTranslation(): boolean {
    if (!this.canTranslate) return false;
    const wasBuffering = this.usesParagraphBuffering;
    this._translationEnabled = !this._translationEnabled;
    if (wasBuffering && this._translationEnabled) {
      void this.paragraphBuffer.commitPending();
    }
    this.db?.updateSessionLanguages(
      this.sessionId,
      this.config.sourceLang,
      this.config.targetLang,
      this._translationEnabled,
      this.config.direction,
    );
    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
    return this._translationEnabled;
  }

  setTranslationMode(direction: Direction | "off", targetLang?: LanguageCode): void {
    if (direction === "off") {
      const wasBuffering = this.usesParagraphBuffering;
      this._translationEnabled = false;
      if (!wasBuffering && this.usesParagraphBuffering) {
        // Switched from translation to buffering — nothing to flush
      }
      this.db?.updateSessionLanguages(
        this.sessionId,
        this.config.sourceLang,
        this.config.targetLang,
        this._translationEnabled,
        this.config.direction,
      );
      this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
      return;
    }

    const wasBuffering = this.usesParagraphBuffering;
    this._translationEnabled = true;
    this.config.direction = direction;
    if (targetLang) {
      this.config.targetLang = targetLang;
    }
    this.rebuildTranscriptionSchemas();
    this.db?.updateSessionLanguages(
      this.sessionId,
      this.config.sourceLang,
      this.config.targetLang,
      this._translationEnabled,
      this.config.direction,
    );
    if (wasBuffering) {
      void this.paragraphBuffer.commitPending();
    }
    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
  }

  setSourceLanguage(sourceLang: LanguageCode): void {
    this.config.sourceLang = sourceLang;
    this.rebuildTranscriptionSchemas();
    this.db?.updateSessionLanguages(
      this.sessionId,
      this.config.sourceLang,
      this.config.targetLang,
      this._translationEnabled,
      this.config.direction,
    );
    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
  }

  setSuggestionScanWordBudget(suggestionScanWordBudget: SessionConfig["suggestionScanWordBudget"]): void {
    if (this.config.suggestionScanWordBudget === suggestionScanWordBudget) return;
    this.config.suggestionScanWordBudget = suggestionScanWordBudget;
    this.emitIdleSuggestionProgress();
  }

  addNote(text: string): TranscriptBlock {
    const block = createBlock(
      this.contextState,
      "NOTE",
      text,
      "",
      undefined,
      "note",
    );
    block.sessionId = this.sessionId;
    block.newTopic = true;
    this.events.emit("block-added", block);
    return block;
  }

  async requestTaskScan(): Promise<{
    ok: boolean;
    queued: boolean;
    taskAnalysisRan: boolean;
    taskSuggestionsEmitted: number;
    suggestions: TaskSuggestion[];
    error?: string;
  }> {
    this.ensureTranscriptContext();
    if (this.contextState.transcriptBlocks.size === 0) {
      this.events.emit("status", "Task scan: no transcript available yet.");
      setTimeout(() => this.events.emit("status", ""), 3000);
      return {
        ok: false,
        queued: false,
        taskAnalysisRan: false,
        taskSuggestionsEmitted: 0,
        suggestions: [],
        error: "No transcript available to scan yet",
      };
    }

    this.events.emit("status", "Task scan running...");
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
    this.analysisRequested = false;

    const analysisResult = await this.generateAnalysis();
    const scanResult = await this.enqueueSuggestionScan({ force: true, reason: "manual" });

    return {
      ok: true,
      queued: false,
      taskAnalysisRan: analysisResult.summaryAnalysisRan || scanResult !== null,
      taskSuggestionsEmitted: scanResult?.taskSuggestionsEmitted ?? 0,
      suggestions: scanResult?.suggestions ?? [],
    };
  }

  private maybeGenerateTitle(): void {
    if (this.titleGenerated || !this.db) return;
    const blocks = [...this.contextState.transcriptBlocks.values()].filter((b) => !b.partial);
    const wordCount = blocks.reduce((n, b) => n + countScanWords(b.sourceText), 0);
    if (wordCount < 50) return;
    this.titleGenerated = true;
    void this.generateSessionTitle(blocks);
  }

  private async generateSessionTitle(blocks: TranscriptBlock[]): Promise<void> {
    const excerpt = blocks.map((b) => b.sourceText).join(" ").slice(0, 600);
    try {
      const { object } = await generateStructuredObject({
        model: this.taskModel,
        schema: sessionTitleSchema,
        prompt: buildSessionTitlePrompt(excerpt),

      });
      this.events.emit("session-title-generated", this.sessionId, object.title);
    } catch (err) {
      log("WARN", `Failed to generate session title: ${err}`);
      this.titleGenerated = false; // allow retry next block
    }
  }

  generateFinalSummary(): void {
    this.ensureTranscriptContext();
    if (this.contextState.transcriptBlocks.size === 0) {
      this.events.emit("final-summary-error", "No transcript available to summarise");
      return;
    }

    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    this.events.emit("status", `Generating session summary with ${this.config.synthesisModelId}...`);

    void generateFinalSummaryFn(allBlocks, this.contextState.allKeyPoints, this.summaryDeps)
      .then((summary) => this.events.emit("final-summary-ready", summary))
      .catch((error) => {
        log("ERROR", `Final summary generation failed: ${formatSummaryError(error)}`);
        this.events.emit("final-summary-error", toReadableError(error));
      })
      .finally(() => this.events.emit("status", ""));
  }

  generateAgentsSummary(): void {
    const allAgents = this.agentManager?.getAllAgents() ?? [];
    const terminalAgents = allAgents.filter(
      (a) => a.status === "completed" || a.status === "failed"
    );

    if (terminalAgents.length === 0) {
      this.events.emit("agents-summary-error", "No completed agents to summarise");
      return;
    }

    this.ensureTranscriptContext();
    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    this.events.emit("status", `Generating agents summary with ${this.config.synthesisModelId}...`);

    void generateAgentsSummaryFn(terminalAgents, allBlocks, this.contextState.allKeyPoints, this.summaryDeps)
      .then((summary) => this.events.emit("agents-summary-ready", summary))
      .catch((error) => {
        log("ERROR", `Agents summary generation failed: ${formatSummaryError(error)}`);
        this.events.emit("agents-summary-error", toReadableError(error));
      })
      .finally(() => this.events.emit("status", ""));
  }

  private hydrateTranscriptContextFromDb() {
    if (!this.db) return;
    if (this.contextState.transcriptBlocks.size > 0) return;

    const persistedBlocks = this.db
      .getBlocksForSession(this.sessionId)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id - b.id;
      });

    if (persistedBlocks.length === 0) return;

    this.contextState.contextBuffer.length = 0;
    this.contextState.transcriptBlocks.clear();

    let maxBlockId = 0;
    for (const block of persistedBlocks) {
      this.contextState.transcriptBlocks.set(block.id, block);
      if (block.id > maxBlockId) maxBlockId = block.id;

      if (block.sourceText && hasTranslatableContent(block.sourceText)) {
        recordContext(this.contextState, block.sourceText);
      } else if (block.translation && hasTranslatableContent(block.translation)) {
        recordContext(this.contextState, block.translation);
      }
    }

    this.contextState.nextBlockId = Math.max(this.contextState.nextBlockId, maxBlockId + 1);
    // Prevent backfilling summary/insights when the user only requests a task scan.
    this.lastAnalysisBlockCount = this.contextState.transcriptBlocks.size;
  }

  async shutdown(): Promise<void> {
    if (this._micEnabled) this.stopMic();
    if (this.isRecording) this.stopRecording(true);
    await this.waitForTranscriptionDrain();
    if (this.paragraphBuffer.hasPending) {
      await this.paragraphBuffer.commitPending();
      this.paragraphBuffer.clear();
    }
    this.events.emit("partial", { source: null, text: "" });
  }

  launchAgent(kind: AgentKind, taskId: string | undefined, task: string, taskContext?: string): Agent | null {
    if (!this.agentManager) return null;
    return this.agentManager.launchAgent(kind, taskId, task, this.sessionId, taskContext);
  }

  relaunchAgent(agentId: string): Agent | null {
    if (!this.agentManager) return null;
    return this.agentManager.relaunchAgent(agentId);
  }

  archiveAgent(agentId: string): boolean {
    if (!this.agentManager) return false;
    return this.agentManager.archiveAgent(agentId);
  }

  async classifyTaskSize(text: string): Promise<TaskSizeClassification> {
    const result = await classifyTaskSizeWithModel(this.taskModel, text);
    return result;
  }

  async extractTaskFromSelection(
    selectedText: string,
    userIntentText?: string,
  ): Promise<{ ok: boolean; taskTitle?: string; taskDetails?: string; reason?: string; error?: string }> {
    const trimmedSelection = selectedText.trim();
    if (!trimmedSelection) {
      return { ok: false, error: "Selected text is required" };
    }

    const existingTasks = this.db
      ? this.db.getTasksForSession(this.sessionId)
      : [];
    const prompt = buildTaskFromSelectionPrompt(trimmedSelection, existingTasks, userIntentText);

    try {
      const { object, usage } = await generateStructuredObject({
        model: this.taskModel,
        schema: taskFromSelectionSchema,
        prompt,
        temperature: 0,
      });

      this.trackCost(usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, "text", "openrouter");

      const taskTitle = object.taskTitle.trim();
      const taskDetails = object.taskDetails.trim();
      if (!object.shouldCreateTask || !taskTitle) {
        return {
          ok: true,
          reason: object.reason || "No actionable task found in selection.",
        };
      }

      return {
        ok: true,
        taskTitle,
        taskDetails,
        reason: object.reason,
      };
    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Task extraction from selection failed: ${toReadableError(error)}`);
      }
      return { ok: false, error: toReadableError(error) };
    }
  }

  getAgents(): Agent[] {
    return [...(this.agentManager?.getAllAgents() ?? [])];
  }

  followUpAgent(agentId: string, question: string): { ok: boolean; error?: string } {
    return this.agentManager?.followUpAgent(agentId, question) ?? { ok: false, error: "Agent system unavailable" };
  }

  answerAgentQuestion(agentId: string, answers: AgentQuestionSelection[]): { ok: boolean; error?: string } {
    return this.agentManager?.answerAgentQuestion(agentId, answers) ?? { ok: false, error: "Agent system unavailable" };
  }

  skipAgentQuestion(agentId: string): { ok: boolean; error?: string } {
    return this.agentManager?.skipAgentQuestion(agentId) ?? { ok: false, error: "Agent system unavailable" };
  }

  answerAgentToolApproval(agentId: string, response: AgentToolApprovalResponse): { ok: boolean; error?: string } {
    return this.agentManager?.answerAgentToolApproval(agentId, response) ?? { ok: false, error: "Agent system unavailable" };
  }

  answerPlanApproval(agentId: string, response: AgentPlanApprovalResponse): { ok: boolean; error?: string } {
    return this.agentManager?.answerPlanApproval(agentId, response) ?? { ok: false, error: "Agent system unavailable" };
  }

  cancelAgent(agentId: string): boolean {
    return this.agentManager?.cancelAgent(agentId) ?? false;
  }

  private getTranscriptSummaryForAgent(): string {
    this.ensureTranscriptContext();
    const totalBlocks = this.contextState.transcriptBlocks.size;
    if (totalBlocks === 0) return "(No transcript yet)";

    const keyPoints = this.contextState.allKeyPoints;
    if (keyPoints.length > 0) {
      return `Key points from the conversation so far (${totalBlocks} transcript blocks available — use getTranscriptContext to read them):\n${keyPoints.map((kp) => `- ${kp}`).join("\n")}`;
    }

    return `${totalBlocks} transcript blocks available — use getTranscriptContext to read them.`;
  }

  private getTranscriptBlocks(last = 10, offset = 0): { blocks: string; returned: number; total: number; remaining: number } {
    this.ensureTranscriptContext();
    const all = [...this.contextState.transcriptBlocks.values()];
    const total = all.length;
    const end = total - offset;
    const start = Math.max(0, end - last);
    const slice = all.slice(start, Math.max(0, end));
    const formatted = slice.length === 0
      ? "(No blocks in this range)"
      : slice.map((b) => {
          const src = `[${b.audioSource}] ${b.sourceText}`;
          const translation = b.translation ? ` → ${b.translation}` : "";
          return src + translation;
        }).join("\n");
    return { blocks: formatted, returned: slice.length, total, remaining: Math.max(0, start) };
  }

  private getCurrentProjectId(): string | undefined {
    if (!this.db) return undefined;
    const meta = this.db.getSession(this.sessionId);
    return meta?.projectId;
  }

  private loadProjectContext(): string {
    const projectId = this.getCurrentProjectId();
    if (!projectId || !this.db) return "";
    return this.db.getProject(projectId)?.context ?? "";
  }

  private micDebugWindowCount = 0;

  private handleAudioData(pipeline: AudioPipeline, data: Buffer) {
    const chunks = processAudioData(pipeline.vadState, data, {
      maxChunkMs: this.config.intervalMs,
    });

    // Periodic mic level reporting (~every 2s of audio = 20 × 100ms windows)
    if (pipeline.source === "microphone") {
      const prev = this.micDebugWindowCount;
      this.micDebugWindowCount = pipeline.vadState.windowCount;
      if (Math.floor(this.micDebugWindowCount / 20) > Math.floor(prev / 20)) {
        const { peakRms, silenceThreshold, speechStarted } = pipeline.vadState;
        const speechBufMs = (pipeline.vadState.speechBuffer.length / (16000 * 2)) * 1000;
        this.events.emit("status", `Mic: peak=${peakRms.toFixed(0)} thr=${silenceThreshold}${speechStarted ? ` speaking ${speechBufMs.toFixed(0)}ms` : ""}`);
        pipeline.vadState.peakRms = 0;
      }
      if (pipeline.vadState.speechStarted) {

      }
    }

    for (const chunk of chunks) {
      this.enqueueChunk(pipeline, chunk);
      void this.processQueue(pipeline.source);
    }
  }

  private async commitTranscript(
    transcript: string,
    detectedLangHint: LanguageCode,
    audioSource: AudioSource,
    capturedAt: number
  ): Promise<void> {
    this.events.emit("partial", { source: audioSource, text: "" });
    const useTranslation = this._translationEnabled && this.canTranslate;
    let detectedLang = detectedLangHint;
    let translation = "";
    let isPartial = this.isTranscriptLikelyPartial(transcript);
    let isNewTopic = false;

    if (useTranslation && transcript) {
      const post = await this.postProcessTranscriptText(transcript, detectedLangHint, true);
      translation = post.translation;
      detectedLang = post.sourceLanguage;
      isPartial = post.isPartial;
      isNewTopic = post.isNewTopic;
    }

    const isTargetLang = detectedLang === this.config.targetLang;
    const detectedLabel = getLanguageLabel(detectedLang);
    const translatedToLabel = isTargetLang
      ? getLanguageLabel(this.config.sourceLang)
      : getLanguageLabel(this.config.targetLang);

    const block = createBlock(
      this.contextState,
      detectedLabel,
      transcript,
      translatedToLabel,
      translation || undefined,
      audioSource,
    );
    block.createdAt = capturedAt;
    block.sessionId = this.sessionId;
    this.events.emit("block-added", block);

    block.partial = isPartial;
    block.newTopic = isNewTopic;
    this.events.emit("block-updated", block);
    this.maybeGenerateTitle();

    if (hasTranslatableContent(transcript)) {
      recordContext(this.contextState, transcript);
    } else if (translation && hasTranslatableContent(translation)) {
      recordContext(this.contextState, translation);
    }

    // Paragraph was committed (not preview text), so run analysis immediately.
    this.scheduleAnalysis(0);
  }

  private enqueueChunk(pipeline: AudioPipeline, chunk: Buffer) {
    if (!chunk.length) return;
    const overlapBytes = Math.floor(16000 * 2 * 1.0);
    const overlap = pipeline.overlap.subarray(0, overlapBytes);
    const combined = overlap.length ? Buffer.concat([overlap, chunk]) : chunk;

    const queue = this.chunkQueues.get(pipeline.source)!;
    while (queue.length >= this.maxQueueSize) {
      queue.shift();
      log("WARN", `Dropped oldest chunk, queue was at ${this.maxQueueSize}`);
    }

    queue.push({
      chunk: combined,
      capturedAt: Date.now(),
    });
    pipeline.overlap = Buffer.from(
      chunk.subarray(Math.max(0, chunk.length - overlapBytes))
    );
  }

  private updateInFlightDisplay() {
    const total = this.inFlight.get("system")! + this.inFlight.get("microphone")!;
    if (total > 0) {
      this.events.emit("status", `Processing ${total} chunk${total > 1 ? "s" : ""}...`);
    } else if (this.isRecording) {
      this.events.emit("status", "Listening...");
    }
  }

  private async waitForTranscriptionDrain(timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const sources: AudioSource[] = ["system", "microphone"];
    while (sources.some((s) => this.inFlight.get(s)! > 0 || this.chunkQueues.get(s)!.length > 0)) {
      for (const src of sources) {
        if (this.inFlight.get(src)! < this.maxConcurrency && this.chunkQueues.get(src)!.length > 0) {
          void this.processQueue(src);
        }
      }
      if (Date.now() >= deadline) {
        const totalQueue = this.chunkQueues.get("system")!.length + this.chunkQueues.get("microphone")!.length;
        const totalInFlight = this.inFlight.get("system")! + this.inFlight.get("microphone")!;
        log("WARN", `Timed out waiting for transcription drain: queue=${totalQueue} inflight=${totalInFlight}`);
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }


  private async processQueue(source: AudioSource): Promise<void> {
    const queue = this.chunkQueues.get(source)!;
    if (this.inFlight.get(source)! >= this.maxConcurrency || queue.length === 0) return;
    const item = queue.shift();
    if (!item) return;
    const { chunk, capturedAt } = item;
    const audioSource = source;
    this.inFlight.set(source, this.inFlight.get(source)! + 1);

    const startTime = Date.now();
    const chunkDurationMs = (chunk.length / (16000 * 2)) * 1000;
    this.updateInFlightDisplay();

    try {
      let transcript = "";
      let translation = "";
      let detectedLang: LanguageCode = this.config.sourceLang;
      let isPartial = false;
      let isNewTopic = false;

      const useTranslation = this._translationEnabled && this.canTranslate;

      const schema = useTranslation ? this.audioTranscriptionSchema : this.transcriptionOnlySchema;
      const wavBuffer = pcmToWavBuffer(chunk, 16000);

      const prompt = useTranslation
        ? buildAudioPromptForStructured(
            this.config.direction,
            this.config.sourceLang,
            this.config.targetLang,
          )
        : buildAudioTranscriptionOnlyPrompt(
            this.config.sourceLang,
            this.config.targetLang,
          );

      const transcriptionProviderOptions =
        this.config.transcriptionProvider === "google"
          ? { google: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } } }
          : undefined;

      const { object: result, usage: finalUsage } = await generateStructuredObject({
        model: this.transcriptionModel,
        schema,
        system: this.userContext || undefined,
        temperature: 0,
        maxRetries: 2,
        providerOptions: transcriptionProviderOptions,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "file",
                mediaType: "audio/wav",
                data: wavBuffer,
              },
            ],
          },
        ],
      });

      const inTok = finalUsage?.inputTokens ?? 0;
      const outTok = finalUsage?.outputTokens ?? 0;
      this.trackCost(inTok, outTok, "audio", this.config.transcriptionProvider);

      if (this.config.debug) {
        this.events.emit("status", `Response: ${Date.now() - startTime}ms | T: ${inTok}→${outTok}`);
      }

      transcript = (result as { transcript?: string }).transcript?.trim() ?? "";
      translation = useTranslation
        ? ((result as { translation?: string }).translation?.trim() ?? "")
        : "";
      detectedLang = (result as { sourceLanguage: string }).sourceLanguage as LanguageCode;

      if (!translation && !transcript) {
        return;
      }

      // Non-translation Gemini: buffer into paragraph preview, feed analysis immediately
      if (!this._translationEnabled && this.usesParagraphBuffering) {
        if (transcript && hasTranslatableContent(transcript)) {
          recordContext(this.contextState, transcript);
        }
        this.paragraphBuffer.queue(transcript, detectedLang, audioSource, capturedAt);
        this.scheduleAnalysis();
        return;
      }

      const sourceText = transcript || "(unavailable)";
      const isTargetLang = detectedLang === this.config.targetLang;
      const detectedLabel = getLanguageLabel(detectedLang);
      const translatedToLabel = isTargetLang ? this.sourceLangLabel : this.targetLangLabel;

      const block = createBlock(
        this.contextState,
        detectedLabel,
        sourceText,
        translatedToLabel,
        translation || undefined,
        audioSource
      );
      block.createdAt = capturedAt;
      block.sessionId = this.sessionId;
      this.events.emit("block-added", block);

      block.partial = isPartial;
      block.newTopic = isNewTopic;
      this.events.emit("block-updated", block);
      this.maybeGenerateTitle();

      if (sourceText && hasTranslatableContent(sourceText)) {
        recordContext(this.contextState, sourceText);
      } else if (translation && hasTranslatableContent(translation)) {
        recordContext(this.contextState, translation);
      }

      this.scheduleAnalysis();
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorName = error instanceof Error ? error.name : (error && typeof error === "object" && "name" in error ? (error as { name: string }).name : "");
      const isTimeout = errorName === "AbortError" || errorName === "TimeoutError";
      const errorMsg = isTimeout ? `Timed out (${(elapsed / 1000).toFixed(1)}s)` : toReadableError(error);
      const fullError = error instanceof Error
        ? `${error.name}: ${error.message}${error.cause ? ` cause=${JSON.stringify(error.cause)}` : ""}`
        : toReadableError(error);
      log("ERROR", `Transcription chunk failed after ${elapsed}ms (audio=${chunkDurationMs.toFixed(0)}ms): ${fullError}`);
      this.events.emit("status", `⚠ ${errorMsg}`);
    } finally {
      this.inFlight.set(source, this.inFlight.get(source)! - 1);
      this.updateInFlightDisplay();
      while (queue.length > 0 && this.inFlight.get(source)! < this.maxConcurrency) {
        void this.processQueue(source);
      }
    }
  }

  private isTranscriptLikelyPartial(transcript: string): boolean {
    const trimmed = transcript.trim();
    if (!trimmed) return false;
    return !/[.!?\u3002\uFF01\uFF1F…]["')\]]?$/.test(trimmed);
  }

  private async postProcessTranscriptText(
    transcript: string,
    detectedLangHint: LanguageCode,
    useTranslation: boolean
  ): Promise<{
    sourceLanguage: LanguageCode;
    translation: string;
    isPartial: boolean;
    isNewTopic: boolean;
  }> {
    const fallback = {
      sourceLanguage: detectedLangHint,
      translation: "",
      isPartial: this.isTranscriptLikelyPartial(transcript),
      isNewTopic: false,
    };
    if (!transcript.trim()) return fallback;

    const translationRule = !useTranslation
      ? "Translation must be an empty string."
      : this.config.direction === "source-target"
        ? `Translation rule:
- Treat sourceLanguage as "${this.config.sourceLang}" unless the transcript clearly contradicts it.
- Translate into "${this.config.targetLang}" (${this.targetLangName}).
- Translation must never be in the same language as transcript.`
        : `Translation rule:
- If sourceLanguage is "${this.config.sourceLang}", translate to "${this.config.targetLang}" (${this.targetLangName}).
- If sourceLanguage is "${this.config.targetLang}", translate to "${this.config.sourceLang}" (${this.sourceLangName}).
- If sourceLanguage is "en" and neither configured language is English, translation may be empty.
- Translation must never be in the same language as transcript.`;

    const prompt = renderPromptTemplate(getTranscriptPostProcessPromptTemplate(), {
      transcript,
      detected_lang_hint: detectedLangHint,
      translation_rule: translationRule,
    });

    try {
      const { object, usage } = await generateStructuredObject({
        // Use the low-latency model path for per-chunk post-processing.
        model: this.taskModel,
        schema: this.textPostProcessSchema,
        prompt,

        temperature: 0,
      });

      this.trackCost(usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, "text", "openrouter");

      return {
        sourceLanguage: (object as { sourceLanguage: LanguageCode }).sourceLanguage,
        translation: ((object as { translation?: string }).translation ?? "").trim(),
        isPartial: (object as { isPartial: boolean }).isPartial,
        isNewTopic: (object as { isNewTopic: boolean }).isNewTopic,
      };
    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Transcript post-processing failed: ${toReadableError(error)}`);
      }
      return fallback;
    }
  }

  private startAnalysisTimer() {
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
    if (this.analysisHeartbeatTimer) {
      clearInterval(this.analysisHeartbeatTimer);
      this.analysisHeartbeatTimer = null;
    }
    this.analysisHeartbeatTimer = setInterval(() => {
      if (!this.isCapturing) return;
      this.scheduleAnalysis(0);
    }, this.analysisHeartbeatMs);
    this.analysisRequested = false;
  }

  private scheduleAnalysis(delayMs = this.analysisDebounceMs) {
    if (!this.isCapturing) return;
    if (this.analysisInFlight) {
      this.analysisRequested = true;
      return;
    }
    if (this.analysisTimer) return;

    this.analysisTimer = setTimeout(() => {
      this.analysisTimer = null;
      void this.generateAnalysis();
    }, Math.max(0, delayMs));
  }

  private stopAnalysisTimer() {
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
    if (this.analysisHeartbeatTimer) {
      clearInterval(this.analysisHeartbeatTimer);
      this.analysisHeartbeatTimer = null;
    }
    this.analysisRequested = false;
  }

  private waitForAnalysisIdle(): Promise<void> {
    if (!this.analysisInFlight) return Promise.resolve();
    return new Promise((resolve) => {
      this.analysisIdleWaiters.push(resolve);
    });
  }

  private async generateAnalysis(): Promise<{
    summaryAnalysisRan: boolean;
  }> {
    if (this.analysisInFlight) {
      this.analysisRequested = true;
      return {
        summaryAnalysisRan: false,
      };
    }

    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    const hasNewAnalysisBlocks = allBlocks.length > this.lastAnalysisBlockCount;
    const shouldRunSummaryAnalysis = hasNewAnalysisBlocks;

    if (!shouldRunSummaryAnalysis) {
      return {
        summaryAnalysisRan: false,
      };
    }

    // Send only new blocks since last analysis — key points provide continuity for older content
    const analysisTargetBlockCount = allBlocks.length;
    const recentBlocks = shouldRunSummaryAnalysis ? allBlocks.slice(this.lastAnalysisBlockCount) : [];

    this.analysisInFlight = true;
    this.analysisRequested = false;
    let analysisSucceeded = false;

    try {
      const previousKeyPoints = this.contextState.allKeyPoints.slice(-20);

      const analysisPrompt = buildAnalysisPrompt(
        recentBlocks,
        previousKeyPoints,
      );

      const analysisProvider = this.config.analysisProvider;
      const providerOptions = analysisProvider === "google"
        ? { google: { thinkingConfig: { includeThoughts: false, thinkingBudget: 2048 } } }
        : undefined;

      const { object: analysisResult, usage } = await generateStructuredObject({
        model: this.analysisModel,
        schema: analysisSchema,
        prompt: analysisPrompt,
        temperature: 0,
        providerOptions,
      });

      this.trackCost(usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, "text", this.config.analysisProvider);
      this.lastAnalysisBlockCount = Math.max(this.lastAnalysisBlockCount, analysisTargetBlockCount);
      analysisSucceeded = true;

      // Update key points / summary — persist each as an insight so history survives
      this.contextState.allKeyPoints.push(...analysisResult.keyPoints);
      for (const text of analysisResult.keyPoints) {
        const kpInsight: Insight = {
          id: crypto.randomUUID(),
          kind: "key-point",
          text,
          sessionId: this.sessionId,
          createdAt: Date.now(),
        };
        this.db?.insertInsight(kpInsight);
      }
      this.lastSummary = { keyPoints: analysisResult.keyPoints, updatedAt: Date.now() };
      this.events.emit("summary-updated", this.lastSummary);

    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Analysis failed: ${toReadableError(error)}`);
      }
    } finally {
      this.analysisInFlight = false;
      const waiters = this.analysisIdleWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
      const hasUnanalyzedBlocks = this.contextState.transcriptBlocks.size > this.lastAnalysisBlockCount;
      if (this.isRecording && (this.analysisRequested || hasUnanalyzedBlocks)) {
        this.analysisRequested = false;
        this.scheduleAnalysis(analysisSucceeded ? 0 : this.analysisRetryDelayMs);
      } else if (!this.isRecording && this.analysisRequested) {
        this.analysisRequested = false;
        void this.generateAnalysis();
      }
    }
    return {
      summaryAnalysisRan: analysisSucceeded,
    };
  }

  private nextSuggestionScanId(): string {
    this.suggestionScanSequence += 1;
    return `scan-${this.suggestionScanSequence}`;
  }

  private emitSuggestionProgress(progress: SuggestionScanProgress): void {
    this.events.emit("suggestion-progress", progress);
  }

  private async enqueueSuggestionScan(request: SuggestionScanRequest): Promise<SuggestionScanResult | null> {
    if (!request.force && request.reason !== "auto") {
      const hasEquivalentPending = this.suggestionScanQueue.some((queued) => queued.force === request.force && queued.reason === request.reason);
      if (hasEquivalentPending) {
        return null;
      }
    }

    return await new Promise<SuggestionScanResult | null>((resolve) => {
      const job = { ...request, resolve };
      this.suggestionScanQueue.push(job);
      this.drainSuggestionScanQueue();
    });
  }

  private drainSuggestionScanQueue(): void {
    while (
      this.suggestionScanInFlight.size < this.maxSuggestionScanConcurrency
      && this.suggestionScanQueue.length > 0
    ) {
      const next = this.suggestionScanQueue.shift();
      if (!next) {
        return;
      }
      void this.runSuggestionScan(next).then(next.resolve);
    }
  }

  private async runSuggestionScan(
    request: SuggestionScanRequest,
  ): Promise<SuggestionScanResult | null> {
    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    if (allBlocks.length === 0) {
      return null;
    }

    const committedWordCount = allBlocks.reduce(
      (sum, b) => sum + countScanWords(b.sourceText),
      0,
    );
    const hasNewTaskBlocks = allBlocks.length > this.lastTaskAnalysisBlockCount;
    if (!request.force && !hasNewTaskBlocks) {
      return null;
    }

    const scanId = this.nextSuggestionScanId();

    const existingTasks = this.db
      ? [
          ...this.db.getTasksForSession(this.sessionId),
          ...this.db.getArchivedTasksForSession(this.sessionId),
        ]
      : [];
    const previousKeyPoints = this.contextState.allKeyPoints.slice(-20);
    const previousEducationalInsights = dedupeInsightHistory(
      this.contextState.allEducationalInsights.slice(-40),
    );
    const taskContextStart = request.force
      ? Math.max(0, allBlocks.length - this.taskAnalysisMaxBlocks)
      : Math.max(0, this.lastTaskAnalysisBlockCount - 5);
    const taskBlocks = allBlocks.slice(taskContextStart);
    const analysisTargetBlockCount = allBlocks.length;
    const now = Date.now();
    let taskSuggestions: TaskSuggestionDraft[] = [];
    let lastScanEmpty = true;

    try {
      this.lastTaskAnalysisAt = now;
      this.lastTaskAnalysisWordCount = Math.max(this.lastTaskAnalysisWordCount, committedWordCount);
      taskSuggestions = await this.generateTaskSuggestionsAgentic({
        scanId,
        label: "Suggestion agent",
        recentBlocks: taskBlocks,
        existingTasks,
        historicalSuggestions: this.recentSuggestedTaskTexts,
        keyPoints: previousKeyPoints,
        educationalContext: previousEducationalInsights.slice(-20),
        aggressiveness: this.config.taskSuggestionAggressiveness,
      });
      lastScanEmpty = taskSuggestions.length === 0;
      this.lastTaskAnalysisBlockCount = Math.max(this.lastTaskAnalysisBlockCount, analysisTargetBlockCount);
    } catch (taskError) {
      const readableTaskError = toReadableError(taskError);
      log("WARN", `Suggestion scan failed: ${formatModelErrorForLog(taskError)}`);
      this.events.emit("error", `Suggestion scan failed: ${readableTaskError}`);
      if (request.force) {
        this.events.emit("status", `Suggestion scan failed: ${readableTaskError}`);
        setTimeout(() => this.events.emit("status", ""), 5000);
      }
    } finally {
      this.suggestionScanInFlight.delete(scanId);
    }

    const emittedTaskSuggestions: TaskSuggestion[] = [];
    let taskSuggestionsEmitted = 0;
    for (const candidate of taskSuggestions) {
      const emittedSuggestion = this.tryEmitTaskSuggestion(candidate);
      if (!emittedSuggestion) {
        continue;
      }
      emittedTaskSuggestions.push(emittedSuggestion);
      taskSuggestionsEmitted += 1;
    }

    this.emitIdleSuggestionProgress(lastScanEmpty);
    this.events.emit("error", "");

    if (request.force) {
      const suffix = taskSuggestionsEmitted === 1 ? "" : "s";
      this.events.emit(
        "status",
        `Suggestion scan complete: ${taskSuggestionsEmitted} suggestion${suffix}.`
      );
      setTimeout(() => this.events.emit("status", ""), 3000);
    }

    this.drainSuggestionScanQueue();
    return {
      scanId,
      suggestions: emittedTaskSuggestions,
      taskSuggestionsEmitted,
      lastScanEmpty,
    };
  }

  private async generateTaskSuggestionsAgentic(
    input: Parameters<typeof runSuggestionAgent>[0] & { scanId: string; label: string },
  ): Promise<TaskSuggestionDraft[]> {
    const { scanId, label, ...agentInput } = input;
    const costProvider: AnalysisProvider | TranscriptionProvider = "openrouter";

    const progressBase = {
      scanId,
      label,
      wordsUntilNextScan: 0,
      liveWordsUntilNextScan: 0,
      scanWordBudget: this.taskAnalysisMinNewWords,
    } satisfies Omit<SuggestionScanProgress, "busy">;

    this.suggestionScanInFlight.set(scanId, {
      ...progressBase,
      busy: true,
      step: "Gathering context…",
    });
    this.emitSuggestionProgress({
      ...progressBase,
      busy: true,
      step: "Gathering context…",
    });

    const db = this.db;
    let result: Awaited<ReturnType<typeof runSuggestionAgent>> | undefined;
    let normalized: TaskSuggestionDraft[] = [];
    let errorMessage: string | undefined;
    try {
      result = await runSuggestionAgent(agentInput, {
        agentModel: createAgentPiModel(this.config, {
          getOpenAiCodexAccessToken: this.getOpenAiCodexAccessToken,
        }),
        extractionModel: this.analysisModel,
        getTranscriptContext: (last?: number, offset?: number) =>
          this.getTranscriptBlocks(last, offset),
        searchTranscriptHistory: db
          ? (q: string, l?: number) => db.searchBlocks(q, l)
          : undefined,
        exa: this.agentManager?.getExaClient() ?? null,
        captureScreenshot,
        onStep: (label) => {
          this.emitSuggestionProgress({
            ...progressBase,
            busy: true,
            step: label,
          });
        },
        debug: this.config.debug,
      });
    } catch (error) {
      errorMessage = toReadableError(error);
      throw error;
    } finally {
      if (result) {
        this.trackCost(
          result.usage.inputTokens,
          result.usage.outputTokens,
          "text",
          costProvider,
        );

        normalized = result.suggestions
          .map((raw) => this.normalizeAgentSuggestion(raw))
          .filter((candidate): candidate is TaskSuggestionDraft => candidate !== null);
      }

      this.suggestionScanInFlight.delete(scanId);
      this.emitSuggestionProgress({
        ...progressBase,
        busy: false,
        step: normalized.length > 0 ? "Suggestions ready" : undefined,
        lastScanEmpty: normalized.length === 0,
        error: errorMessage,
      });
    }

    return normalized;
  }

  private tryEmitTaskSuggestion(
    candidate: TaskSuggestionDraft,
  ): TaskSuggestion | null {
    const normalized = candidate.text.trim();
    if (!normalized) return null;
    const normalizedKey = normalizeInsightText(normalized);
    const existingText = this.recentSuggestedTaskTexts.some((text) => normalizeInsightText(text) === normalizedKey);
    if (existingText) return null;

    const suggestion: TaskSuggestion = {
      id: crypto.randomUUID(),
      text: normalized,
      flag: candidate.flag?.trim() || undefined,
      details: candidate.details?.trim() || undefined,
      transcriptExcerpt: candidate.transcriptExcerpt?.trim() || undefined,
      kind: candidate.kind,
      sessionId: this.sessionId,
      createdAt: Date.now(),
    };
    this.recentSuggestedTaskTexts.push(normalized);
    if (this.recentSuggestedTaskTexts.length > 500) {
      this.recentSuggestedTaskTexts = this.recentSuggestedTaskTexts.slice(-500);
    }
    if (this.db && !this.db.getTask(suggestion.id)) {
      this.db.insertTask({
        id: suggestion.id,
        text: suggestion.text,
        details: buildSuggestionArchiveDetails(candidate),
        size: "large",
        completed: false,
        archived: true,
        suggestionKind: suggestion.kind,
        source: "ai",
        createdAt: suggestion.createdAt,
        sessionId: suggestion.sessionId,
      });
    }
    this.events.emit("task-suggested", suggestion);
    return suggestion;
  }

  private normalizeAgentSuggestion(
    rawSuggestion: AgentSuggestionItem,
  ): TaskSuggestionDraft | null {
    const text = rawSuggestion.text.trim();
    if (!text) return null;
    return {
      text,
      kind: rawSuggestion.kind,
      flag: rawSuggestion.flag?.trim() || undefined,
      details: rawSuggestion.details?.trim() || undefined,
      transcriptExcerpt: rawSuggestion.transcriptExcerpt?.trim() || undefined,
    };
  }

}
