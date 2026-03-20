import { create } from "zustand";
import { persist } from "zustand/middleware";
import { produce } from "immer";

import { createMigratingJSONStorage, legacyStorageKey } from "./persistStorage";

import { analyzeResume, ApiError } from "../lib/api";
import { useRuntimeSettingsStore } from "./runtimeSettingsStore";
import type {
  ResumeData,
  ResumeParseMeta,
  WorkExperienceItem,
  EducationItem,
  ProjectItem,
  BasicInfo,
  AcademicAchievementItem,
} from "../types/resume";

const STORAGE_KEY = "face-tamato-resume";
const LEGACY_STORAGE_KEYS = [legacyStorageKey("resume")];

export type ParseStatus = "idle" | "parsing" | "success" | "error";

interface ResumeStore {
  parsedResume: ResumeData | null;
  parseMeta: ResumeParseMeta | null;
  parseStatus: ParseStatus;
  parseError: string | null;

  setParsedResume: (data: ResumeData | null) => void;
  setParseMeta: (meta: ResumeParseMeta | null) => void;
  clearParsedResume: () => void;
  parseResumeFile: (file: File) => Promise<void>;
  clearParseError: () => void;

  updateWorkExperience: (
    index: number,
    updates: Partial<WorkExperienceItem>
  ) => void;
  updateEducation: (index: number, updates: Partial<EducationItem>) => void;
  updateProject: (index: number, updates: Partial<ProjectItem>) => void;
  updateBasicInfo: (updates: Partial<BasicInfo>) => void;
  updateAcademicAchievement: (
    index: number,
    updates: Partial<AcademicAchievementItem>
  ) => void;
}

export const useResumeStore = create<ResumeStore>()(
  persist(
    (set, get) => ({
      parsedResume: null,
      parseMeta: null,
      parseStatus: "idle",
      parseError: null,

      setParsedResume: (data) => set({ parsedResume: data }),
      setParseMeta: (meta) => set({ parseMeta: meta }),

      clearParsedResume: () =>
        set({
          parsedResume: null,
          parseMeta: null,
          parseStatus: "idle",
          parseError: null,
        }),

      parseResumeFile: async (file: File) => {
        if (get().parseStatus === "parsing") return;

        set({ parseStatus: "parsing", parseError: null, parseMeta: null });

        try {
          const runtimeConfig = useRuntimeSettingsStore.getState();
          const result = await analyzeResume(file, runtimeConfig);
          set({
            parsedResume: result.data,
            parseMeta: result.meta,
            parseStatus: "success",
          });
        } catch (error) {
          let errorMessage = "发生未知错误，请检查网络连接或联系管理员。";
          let parseMeta: ResumeParseMeta | null = null;
          if (error instanceof ApiError) {
            errorMessage = error.message;
            const errorParseMeta = error.details?.parseMeta;
            if (errorParseMeta && typeof errorParseMeta === "object") {
              parseMeta = errorParseMeta as ResumeParseMeta;
            }
          } else if (error instanceof Error) {
            errorMessage = error.message;
          }
          set({ parseStatus: "error", parseError: errorMessage, parseMeta });
        }
      },

      clearParseError: () => set({ parseError: null, parseStatus: "idle", parseMeta: null }),

      updateWorkExperience: (index, updates) =>
        set(
          produce((state: ResumeStore) => {
            if (
              state.parsedResume &&
              state.parsedResume.workExperience[index]
            ) {
              Object.assign(
                state.parsedResume.workExperience[index],
                updates
              );
            }
          })
        ),

      updateEducation: (index, updates) =>
        set(
          produce((state: ResumeStore) => {
            if (state.parsedResume && state.parsedResume.education[index]) {
              Object.assign(state.parsedResume.education[index], updates);
            }
          })
        ),

      updateProject: (index, updates) =>
        set(
          produce((state: ResumeStore) => {
            if (state.parsedResume && state.parsedResume.projects[index]) {
              Object.assign(state.parsedResume.projects[index], updates);
            }
          })
        ),

      updateBasicInfo: (updates) =>
        set(
          produce((state: ResumeStore) => {
            if (state.parsedResume) {
              Object.assign(state.parsedResume.basicInfo, updates);
            }
          })
        ),

      updateAcademicAchievement: (index, updates) =>
        set(
          produce((state: ResumeStore) => {
            if (
              state.parsedResume &&
              state.parsedResume.academicAchievements[index]
            ) {
              Object.assign(
                state.parsedResume.academicAchievements[index],
                updates
              );
            }
          })
        ),
    }),
    {
      name: STORAGE_KEY,
      storage: createMigratingJSONStorage("session", STORAGE_KEY, LEGACY_STORAGE_KEYS),
      partialize: (state) => ({
        parsedResume: state.parsedResume,
        parseMeta: state.parseMeta,
      }),
    }
  )
);
