import {
  generateObject,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";

type StructuredGenerationOptions<T> = {
  model: LanguageModel;
  schema: z.ZodType<T>;
  prompt?: string;
  messages?: unknown[];
  system?: unknown;
  temperature?: number;
  maxRetries?: number;
  providerOptions?: Record<string, unknown>;
  headers?: Record<string, string>;
  abortSignal?: AbortSignal;
};

export function extractJsonObjectText(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const direct = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    JSON.parse(direct);
    return direct;
  } catch {
    // fall through
  }

  const start = direct.indexOf("{");
  const end = direct.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = direct.slice(start, end + 1).trim();
    JSON.parse(candidate);
    return candidate;
  }

  throw new Error("Model did not return valid JSON.");
}

export async function generateStructuredObject<T>({
  model,
  schema,
  prompt,
  messages,
  system,
  temperature,
  maxRetries,
  providerOptions,
  headers,
  abortSignal,
}: StructuredGenerationOptions<T>): Promise<{ object: T; usage: LanguageModelUsage | undefined }> {
  const result = await generateObject({
    model,
    schema,
    ...(system !== undefined ? { system } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(messages !== undefined ? { messages } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(providerOptions !== undefined ? { providerOptions } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(abortSignal !== undefined ? { abortSignal } : {}),
  } as never);
  return {
    object: result.object as T,
    usage: result.usage,
  };
}
