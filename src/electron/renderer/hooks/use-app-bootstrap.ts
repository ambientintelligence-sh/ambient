import { useRef } from "react";
import type { LanguageCode, SessionMeta } from "@core/types";

type UseAppBootstrapParams = {
  setSessions: (sessions: SessionMeta[]) => void;
  setSourceLang: (lang: LanguageCode) => void;
  setTargetLang: (lang: LanguageCode) => void;
};

export function useAppBootstrap({
  setSessions,
  setSourceLang,
  setTargetLang,
}: UseAppBootstrapParams) {
  const languageSeededRef = useRef(false);
  const sessionsRef = useRef<SessionMeta[]>([]);

  const refreshSessions = async (): Promise<SessionMeta[]> => {
    const loaded = await window.electronAPI.getSessions();
    sessionsRef.current = loaded;
    setSessions(loaded);

    if (!languageSeededRef.current) {
      const last = loaded[0];
      const hasStoredSourceLang = localStorage.getItem("ambient-source-lang") !== null;
      const hasStoredTargetLang =
        localStorage.getItem("ambient-translate-to-lang") !== null ||
        localStorage.getItem("ambient-target-lang") !== null;
      if (last?.sourceLang && !hasStoredSourceLang) setSourceLang(last.sourceLang);
      if (last?.targetLang && !hasStoredTargetLang) setTargetLang(last.targetLang);
      languageSeededRef.current = true;
    }

    return loaded;
  };

  return {
    refreshSessions,
    sessionsRef,
  };
}
