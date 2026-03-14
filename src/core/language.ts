import type { Direction, LanguageCode } from "./types";
import { SUPPORTED_LANGUAGES } from "./types";
import {
  getAudioAutoPromptTemplate,
  getAudioSourceTargetPromptTemplate,
  getAudioTranscriptionOnlyPromptTemplate,
  renderPromptTemplate,
} from "./prompt-loader";

export const LANG_NAMES: Record<LanguageCode, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  ru: "Russian",
  tl: "Tagalog",
};

const LANG_CHAR_PATTERNS: Partial<Record<LanguageCode, RegExp>> = {
  ko: /[\uAC00-\uD7AF]/,
  ja: /[\u3040-\u309F\u30A0-\u30FF]/,
  zh: /[\u4E00-\u9FFF]/,
  ar: /[\u0600-\u06FF]/,
  hi: /[\u0900-\u097F]/,
  ru: /[\u0400-\u04FF]/,
};

export function getLanguageLabel(code: LanguageCode): string {
  return code.toUpperCase();
}

export function isValidLangCode(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function hasTranslatableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function detectSourceLanguage(
  text: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): LanguageCode {
  const sourcePattern = LANG_CHAR_PATTERNS[sourceLang];
  if (sourcePattern && sourcePattern.test(text)) {
    return sourceLang;
  }

  const targetPattern = LANG_CHAR_PATTERNS[targetLang];
  if (targetPattern && targetPattern.test(text)) {
    return targetLang;
  }

  return sourceLang;
}

export function extractSentences(text: string): {
  sentences: string[];
  remainder: string;
} {
  const sentences: string[] = [];
  let buffer = "";

  for (const ch of text) {
    if (ch === "\n") {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
      continue;
    }

    buffer += ch;

    if (/[.!?\u3002\uFF01\uFF1F]/.test(ch)) {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
    }
  }

  return { sentences, remainder: buffer };
}

export function buildAudioPromptForStructured(
  direction: Direction,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
): string {
  const sourceLangName = LANG_NAMES[sourceLang];
  const targetLangName = LANG_NAMES[targetLang];

  const englishIsConfigured = sourceLang === "en" || targetLang === "en";
  const langList = englishIsConfigured
    ? `${sourceLangName} or ${targetLangName}`
    : `${sourceLangName}, ${targetLangName}, or English`;
  const codeList = englishIsConfigured
    ? `"${sourceLang}" or "${targetLang}"`
    : `"${sourceLang}", "${targetLang}", or "en"`;

  if (direction === "auto") {
    let translateRule: string;
    if (sourceLang === "en") {
      translateRule = `If the speech is ${sourceLangName}, translate to ${targetLangName}. If the speech is ${targetLangName}, translate to ${sourceLangName}. The translation MUST always be in a different language than the transcript.`;
    } else if (targetLang === "en") {
      translateRule = `If the speech is ${sourceLangName}, the translation MUST be in ${targetLangName} (English). If the speech is already ${targetLangName} (English), leave translation empty. The translation must NEVER be in the same language as the transcript.`;
    } else {
      translateRule = `If the speech is ${sourceLangName}, the translation MUST be in ${targetLangName}. If the speech is ${targetLangName}, the translation MUST be in ${sourceLangName}. If English, leave translation empty. The translation must NEVER be in the same language as the transcript.`;
    }

    return renderPromptTemplate(getAudioAutoPromptTemplate(), {
      lang_list: langList,
      code_list: codeList,
      translate_rule: translateRule,
      source_lang_name: sourceLangName,
      target_lang_name: targetLangName,
    });
  }

  const englishNote = sourceLang !== "en"
    ? ` The speaker may occasionally use English words/phrases \u2014 treat this as code-switching within ${sourceLangName}, not a language change.`
    : "";

  return renderPromptTemplate(getAudioSourceTargetPromptTemplate(), {
    source_lang_name: sourceLangName,
    target_lang_name: targetLangName,
    english_note: englishNote,
  });
}

export function buildAudioTranscriptionOnlyPrompt(
  sourceLang: LanguageCode,
  _targetLang: LanguageCode,
): string {
  const sourceLangName = LANG_NAMES[sourceLang];

  return renderPromptTemplate(getAudioTranscriptionOnlyPromptTemplate(), {
    source_lang_name: sourceLangName,
    source_lang_code: sourceLang,
  });
}
