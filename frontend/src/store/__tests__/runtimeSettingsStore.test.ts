import { beforeEach, describe, expect, it } from "vitest";

import { useRuntimeSettingsStore } from "../runtimeSettingsStore";
import { legacyStorageKey } from "../persistStorage";

const NEW_STORAGE_KEY = "face-tamato-runtime-settings";
const LEGACY_STORAGE_KEY = legacyStorageKey("runtime", "settings");

beforeEach(() => {
  localStorage.clear();
  useRuntimeSettingsStore.persist.clearStorage();
  useRuntimeSettingsStore.getState().clearRuntimeConfig();
});

describe("runtimeSettingsStore", () => {
  it("persists runtime settings to localStorage", () => {
    useRuntimeSettingsStore.getState().setRuntimeConfig({
      modelProvider: "anthropic",
      apiKey: "sk-test",
      baseURL: "https://custom.example/v1",
      model: "gpt-4o",
      ocrApiKey: "zhipu-key",
      speechAppKey: "speech-app",
      speechAccessKey: "speech-access",
    });

    const stored = JSON.parse(localStorage.getItem(NEW_STORAGE_KEY) ?? "null");
    expect(stored.state).toEqual({
      modelProvider: "anthropic",
      apiKey: "sk-test",
      baseURL: "https://custom.example/v1",
      model: "gpt-4o",
      ocrApiKey: "zhipu-key",
      speechAppKey: "speech-app",
      speechAccessKey: "speech-access",
    });
  });

  it("migrates legacy runtime settings into the new storage key", async () => {
    localStorage.removeItem(NEW_STORAGE_KEY);
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        state: {
          modelProvider: "google_genai",
          apiKey: "legacy-key",
          baseURL: "https://legacy.example/v1",
          model: "gemini-2.0-flash",
          ocrApiKey: "legacy-ocr",
          speechAppKey: "legacy-app",
          speechAccessKey: "legacy-access",
        },
        version: 0,
      })
    );

    await useRuntimeSettingsStore.persist.rehydrate();

    expect(useRuntimeSettingsStore.getState()).toMatchObject({
      modelProvider: "google_genai",
      apiKey: "legacy-key",
      baseURL: "https://legacy.example/v1",
      model: "gemini-2.0-flash",
      ocrApiKey: "legacy-ocr",
      speechAppKey: "legacy-app",
      speechAccessKey: "legacy-access",
    });

    expect(JSON.parse(localStorage.getItem(NEW_STORAGE_KEY) ?? "null")?.state).toEqual({
      modelProvider: "google_genai",
      apiKey: "legacy-key",
      baseURL: "https://legacy.example/v1",
      model: "gemini-2.0-flash",
      ocrApiKey: "legacy-ocr",
      speechAppKey: "legacy-app",
      speechAccessKey: "legacy-access",
    });
    expect(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null")?.state).toEqual({
      modelProvider: "google_genai",
      apiKey: "legacy-key",
      baseURL: "https://legacy.example/v1",
      model: "gemini-2.0-flash",
      ocrApiKey: "legacy-ocr",
      speechAppKey: "legacy-app",
      speechAccessKey: "legacy-access",
    });
  });

  it("clears runtime settings back to defaults", () => {
    useRuntimeSettingsStore.getState().setRuntimeConfig({
      modelProvider: "google_genai",
      apiKey: "sk-test",
      baseURL: "https://custom.example/v1",
      model: "gpt-4o",
      ocrApiKey: "zhipu-key",
      speechAppKey: "speech-app",
      speechAccessKey: "speech-access",
    });

    useRuntimeSettingsStore.getState().clearRuntimeConfig();

    expect(useRuntimeSettingsStore.getState()).toMatchObject({
      modelProvider: "",
      apiKey: "",
      baseURL: "",
      model: "",
      ocrApiKey: "",
      speechAppKey: "",
      speechAccessKey: "",
    });
  });
});
