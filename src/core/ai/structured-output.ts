import {
  generateObject,
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";

const FIREWORKS_MODEL_PREFIX = "accounts/fireworks/models/";
const JSON_ONLY_INSTRUCTION =
  "Return only a valid JSON object. Do not include markdown, commentary, or code fences.";

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

export function isFireworksLanguageModel(model: LanguageModel): boolean {
  if (typeof model === "string") {
    return model.startsWith(FIREWORKS_MODEL_PREFIX);
  }

  const candidate = model as { provider?: unknown; modelId?: unknown };
  if (typeof candidate.provider === "string" && candidate.provider.startsWith("fireworks")) {
    return true;
  }
  return typeof candidate.modelId === "string" && candidate.modelId.startsWith(FIREWORKS_MODEL_PREFIX);
}

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

function buildFireworksSchemaInstruction<T>(schema: z.ZodType<T>): string {
  try {
    const jsonSchema = z.toJSONSchema(schema);
    return [
      JSON_ONLY_INSTRUCTION,
      "Use this JSON schema exactly:",
      JSON.stringify(jsonSchema, null, 2),
    ].join("\n\n");
  } catch {
    return JSON_ONLY_INSTRUCTION;
  }
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
  const fireworksInstruction = buildFireworksSchemaInstruction(schema);
  const baseRequest = {
    model,
    ...(system !== undefined ? { system } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(messages !== undefined ? { messages } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(providerOptions !== undefined ? { providerOptions } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(abortSignal !== undefined ? { abortSignal } : {}),
  };

  if (!isFireworksLanguageModel(model)) {
    const result = await generateObject({
      ...baseRequest,
      schema,
    } as never);
    return {
      object: result.object as T,
      usage: result.usage,
    };
  }

  const result = await generateText({
    ...baseRequest,
    prompt:
      prompt !== undefined
        ? `${prompt}\n\n${fireworksInstruction}`
        : undefined,
    messages:
      prompt === undefined && messages !== undefined
        ? [
            ...messages,
            { role: "user", content: fireworksInstruction },
          ]
        : messages,
  } as never);

  const jsonText = extractJsonObjectText(result.text);
  return {
    object: schema.parse(JSON.parse(jsonText)),
    usage: result.usage,
  };
}
