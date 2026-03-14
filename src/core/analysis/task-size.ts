import type { LanguageModel } from "ai";
import { z } from "zod";
import type { TaskSize } from "../types";
import { toReadableError } from "../text/text-utils";
import { getTaskSizeClassifierPromptTemplate, renderPromptTemplate } from "../prompt-loader";
import { generateStructuredObject } from "../ai/structured-output";


export const taskSizeClassificationSchema = z.object({
  size: z.enum(["small", "large"]),
  reason: z.string().min(1).max(160),
});

export type TaskSizeClassification = z.infer<typeof taskSizeClassificationSchema>;

function defaultClassification(reason: string): TaskSizeClassification {
  return {
    size: "large",
    reason,
  };
}

function normalizeReason(reason: string): string {
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : "No reason provided";
}

function buildTaskSizePrompt(text: string): string {
  return renderPromptTemplate(getTaskSizeClassifierPromptTemplate(), {
    task_text: text,
  });
}


function isValidSize(value: string): value is TaskSize {
  return value === "small" || value === "large";
}

export async function classifyTaskSize(
  model: LanguageModel,
  text: string,
): Promise<TaskSizeClassification> {
  const trimmed = text.trim();
  if (!trimmed) {
    return defaultClassification("Empty task text");
  }

  try {
    const { object } = await generateStructuredObject({
      model,
      schema: taskSizeClassificationSchema,
      prompt: buildTaskSizePrompt(trimmed),
    });

    if (!isValidSize(object.size)) {
      return defaultClassification("Invalid size from classifier");
    }

    return {
      size: object.size,
      reason: normalizeReason(object.reason),
    };
  } catch (error) {
    return defaultClassification(`Classifier error: ${toReadableError(error)}`);
  }
}
