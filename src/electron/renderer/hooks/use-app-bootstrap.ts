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
      if (last?.sourceLang) setSourceLang(last.sourceLang);
      if (last?.targetLang) setTargetLang(last.targetLang);
      languageSeededRef.current = true;
    }

    return loaded;
  };

  return {
    refreshSessions,
    sessionsRef,
  };
}
