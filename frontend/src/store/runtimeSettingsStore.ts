import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { RuntimeConfig } from "@/lib/api";
import { createMigratingJSONStorage, legacyStorageKey } from "./persistStorage";

interface RuntimeSettingsState extends RuntimeConfig {
  setModelProvider: (modelProvider: RuntimeConfig['modelProvider']) => void;
  setApiKey: (apiKey: string) => void;
  setBaseURL: (baseURL: string) => void;
  setModel: (model: string) => void;
  setOcrApiKey: (ocrApiKey: string) => void;
  setSpeechAppKey: (speechAppKey: string) => void;
  setSpeechAccessKey: (speechAccessKey: string) => void;
  setRuntimeConfig: (config: RuntimeConfig) => void;
  clearRuntimeConfig: () => void;
}

const STORAGE_KEY = "face-tamato-runtime-settings";
const LEGACY_STORAGE_KEYS = [legacyStorageKey("runtime", "settings")];

const initialState: RuntimeConfig = {
  modelProvider: "",
  apiKey: "",
  baseURL: "",
  model: "",
  ocrApiKey: "",
  speechAppKey: "",
  speechAccessKey: "",
};

export const useRuntimeSettingsStore = create<RuntimeSettingsState>()(
  persist(
    (set) => ({
      ...initialState,
      setModelProvider: (modelProvider) => set({ modelProvider: modelProvider ?? "" }),
      setApiKey: (apiKey) => set({ apiKey }),
      setBaseURL: (baseURL) => set({ baseURL }),
      setModel: (model) => set({ model }),
      setOcrApiKey: (ocrApiKey) => set({ ocrApiKey }),
      setSpeechAppKey: (speechAppKey) => set({ speechAppKey }),
      setSpeechAccessKey: (speechAccessKey) => set({ speechAccessKey }),
      setRuntimeConfig: (config) =>
        set({
          modelProvider: config.modelProvider ?? "",
          apiKey: config.apiKey ?? "",
          baseURL: config.baseURL ?? "",
          model: config.model ?? "",
          ocrApiKey: config.ocrApiKey ?? "",
          speechAppKey: config.speechAppKey ?? "",
          speechAccessKey: config.speechAccessKey ?? "",
        }),
      clearRuntimeConfig: () => set(initialState),
    }),
    {
      name: STORAGE_KEY,
      storage: createMigratingJSONStorage("local", STORAGE_KEY, LEGACY_STORAGE_KEYS),
    }
  )
);
