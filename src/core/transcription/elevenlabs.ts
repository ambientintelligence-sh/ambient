import {
  ElevenLabsClient,
  RealtimeEvents,
  AudioFormat,
  CommitStrategy,
  type RealtimeConnection,
} from "@elevenlabs/elevenlabs-js";
import type { LanguageCode } from "../types";
import { isValidLangCode } from "../language";

const ELEVENLABS_LANGUAGE_MAP: Record<string, LanguageCode> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  deu: "de",
  ita: "it",
  por: "pt",
  zho: "zh",
  jpn: "ja",
  kor: "ko",
  ara: "ar",
  hin: "hi",
  rus: "ru",
  fil: "tl",
  tgl: "tl",
};

export function normalizeElevenLabsLanguageCode(code?: string): LanguageCode | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toLowerCase();
  if (isValidLangCode(normalized)) return normalized;
  return ELEVENLABS_LANGUAGE_MAP[normalized];
}

export type { RealtimeConnection };
export { RealtimeEvents };

export type ElevenLabsRealtimeOptions = {
  apiKey: string;
  modelId: string;
  languageCode?: LanguageCode;
};

// Pure factory — creates client, opens WS, returns connection.
// Caller owns lifecycle (close on stop, recreate on reconnect).
export async function connectElevenLabsRealtime(
  options: ElevenLabsRealtimeOptions
): Promise<RealtimeConnection> {
  const client = new ElevenLabsClient({ apiKey: options.apiKey });
  return client.speechToText.realtime.connect({
    modelId: options.modelId,
    audioFormat: AudioFormat.PCM_16000,
    sampleRate: 16000,
    commitStrategy: CommitStrategy.VAD,
    vadSilenceThresholdSecs: 0.5,
    vadThreshold: 0.4,
    minSpeechDurationMs: 300,
    languageCode: options.languageCode,
    includeTimestamps: true,
  });
}
