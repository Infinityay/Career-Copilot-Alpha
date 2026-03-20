import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createMigratingJSONStorage, legacyStorageKey } from "./persistStorage";

export type ResumeFile = {
  name: string;
  type: string;
  size: number;
  content: string;
  previewUrl?: string;
};

export type Theme = "light" | "dark" | "system";

const SESSION_STORAGE_KEY = "face-tamato-session";
const LEGACY_SESSION_STORAGE_KEYS = [legacyStorageKey("session")];
const THEME_STORAGE_KEY = "face-tamato-theme";
const LEGACY_THEME_STORAGE_KEYS = [legacyStorageKey("theme")];

type SessionState = {
  resumeFile: ResumeFile | null;
  resumeText: string;
  jdText: string;
  theme: Theme;
  setResumeFile: (file: ResumeFile | null) => void;
  setResumeText: (text: string) => void;
  setJdText: (text: string) => void;
  setTheme: (theme: Theme) => void;
  clearResume: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      resumeFile: null,
      resumeText: "",
      jdText: "",
      theme: "system",
      setResumeFile: (file) => set({ resumeFile: file }),
      setResumeText: (resumeText) => set({ resumeText }),
      setJdText: (jdText) => set({ jdText }),
      setTheme: (theme) => set({ theme }),
      clearResume: () => set({ resumeFile: null, resumeText: "" }),
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createMigratingJSONStorage("session", SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEYS),
      partialize: (state) => ({
        resumeFile: state.resumeFile
          ? {
              ...state.resumeFile,
              previewUrl: undefined,
            }
          : null,
        resumeText: state.resumeText,
        jdText: state.jdText,
      }),
    }
  )
);

// 主题持久化单独存储到 localStorage
export const useThemeStore = create<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createMigratingJSONStorage("local", THEME_STORAGE_KEY, LEGACY_THEME_STORAGE_KEYS),
    }
  )
);
