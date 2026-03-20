import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { JDData } from "../lib/api";

import { createMigratingJSONStorage, legacyStorageKey } from "./persistStorage";

const STORAGE_KEY = "face-tamato-optimization";
const LEGACY_STORAGE_KEYS = [legacyStorageKey("optimization")];

// ==================== Types ====================

export type OptimizationStatus = "input" | "loading" | "analysis" | "error";

export interface ResumeSummary {
  headline: string;
  highlights: string[];
  risks: string[];
}

export interface RolePersona {
  role: string;
  fit_reason: string;
  best_scene: string;
  gap_tip: string;
}

export interface ResumeOverview {
  resume_summary: ResumeSummary;
  role_personas: RolePersona[];
}

export interface SuggestionLocation {
  section: string;
  item_index: number | null;
}

export interface SuggestionItem {
  id: string;
  priority: number;
  issue_type: string;
  location: SuggestionLocation;
  problem: string;
  original: string;
  suggestion: string;
}

export interface SectionSuggestions {
  section: string;
  suggestions: SuggestionItem[];
}

export interface ResumeSuggestions {
  sections: SectionSuggestions[];
}

// ==================== JD Match Types ====================

export type MatchStatus = "matched" | "partial" | "missing";

// 权重配置
export const CATEGORY_WEIGHTS: Record<string, number> = {
  mustHave: 0.5,      // 必备条件
  degree: 0.5,        // 学历要求
  experience: 0.5,    // 经验要求
  niceToHave: 0.2,    // 加分项
  techStack: 0.2,     // 技术栈
  jobDuties: 0.1,     // 岗位职责
};

export interface ScoreBreakdown {
  category: string;
  label: string;
  score: number;      // 类别得分 (0-1)
  weight: number;     // 权重
}

export interface CorrectionDetails {
  original_score: number;
  original_evidence: string[];
  reason: string;
}

export interface JdRequirement {
  id: string;
  text: string;
  category: string;
  status: MatchStatus;
  score: number;
  rationale: string;
  evidence?: string[];  // 匹配证据，格式: "section[index].field" 或 "section[index].field: snippet"
  correction?: CorrectionDetails | null;  // 修正详情（若经过二次校验修正）
}

export interface MatchReport {
  overallScore: number;
  maxScore: number;
  percent: number;
  headline: string;
  scoreBreakdown: ScoreBreakdown[];
  requirements: JdRequirement[];
  gaps: JdRequirement[];
}

// ==================== Labels ====================

export const sectionLabels: Record<string, string> = {
  basicInfo: "基本信息",
  workExperience: "工作经历",
  education: "教育背景",
  projects: "项目经历",
  academicAchievements: "学术成果",
};

// Issue type labels for display
export const issueTypeLabels: Record<string, string> = {
  missing_info: "信息缺失",
  structure_issue: "结构问题",
  wording_issue: "表达问题",
  redundancy: "冗余内容",
  inconsistent_format: "格式不一致",
  timeline_issue: "时间线问题",
  low_signal_content: "低信号内容",
  privacy_risk: "隐私风险",
  cross_section_issue: "跨模块问题",
  other: "其他",
};

// ==================== Store Interface ====================

export type AnalysisTab = "overview" | "jdAnalysis" | "suggestions" | "matchReport";

interface OptimizationStore {
  // State
  status: OptimizationStatus;
  jdText: string;
  overview: ResumeOverview | null;
  suggestions: ResumeSuggestions | null;
  suggestionsStatus: "idle" | "loading" | "ready" | "error";
  suggestionsError: string | null;
  activeSuggestionId: string | null;
  activeTab: AnalysisTab;
  error: string | null;
  // JD Match state
  jdData: JDData | null;
  matchReport: MatchReport | null;

  // Actions
  setJdText: (text: string) => void;
  setActiveTab: (tab: AnalysisTab) => void;
  setActiveSuggestionId: (id: string | null) => void;
  startAnalysis: () => void;
  setJdData: (data: JDData) => void;
  setOverview: (overview: ResumeOverview) => void;
  setSuggestions: (suggestions: ResumeSuggestions) => void;
  setSuggestionsError: (error: string) => void;
  setMatchReport: (report: MatchReport) => void;
  setError: (error: string) => void;
  setAnalysisComplete: () => void;
  reset: () => void;
}

// ==================== Store Implementation ====================

export function clearOptimizationStore() {
  useOptimizationStore.persist.clearStorage();
  useOptimizationStore.getState().reset();
}

export const useOptimizationStore = create<OptimizationStore>()(
  persist(
    (set) => ({
      status: "input",
      jdText: "",
      jdData: null,
      overview: null,
      suggestions: null,
      suggestionsStatus: "idle",
      suggestionsError: null,
      activeSuggestionId: null,
      activeTab: "overview",
      error: null,
      matchReport: null,

      setJdText: (text) => set({ jdText: text }),

      setActiveTab: (tab) => set({ activeTab: tab }),

      setActiveSuggestionId: (id) => set({ activeSuggestionId: id }),

      startAnalysis: () =>
        set({
          status: "loading",
          jdData: null,
          overview: null,
          suggestions: null,
          suggestionsStatus: "loading",
          suggestionsError: null,
          matchReport: null,
          error: null,
        }),

      setJdData: (data) => set({ jdData: data }),

      setOverview: (overview) => set({ overview }),

      setSuggestions: (suggestions) =>
        set({ suggestions, suggestionsStatus: "ready", suggestionsError: null }),

      setSuggestionsError: (error) =>
        set({ suggestionsStatus: "error", suggestionsError: error }),

      setMatchReport: (report) => set({ matchReport: report }),

      setError: (error) => set({ status: "error", error }),

      setAnalysisComplete: () => set({ status: "analysis" }),

      reset: () =>
        set({
          status: "input",
          jdText: "",
          jdData: null,
          overview: null,
          suggestions: null,
          suggestionsStatus: "idle",
          suggestionsError: null,
          activeSuggestionId: null,
          activeTab: "overview",
          error: null,
          matchReport: null,
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createMigratingJSONStorage("session", STORAGE_KEY, LEGACY_STORAGE_KEYS),
      partialize: (state) => ({
        status: state.status,
        jdText: state.jdText,
        jdData: state.jdData,
        overview: state.overview,
        suggestions: state.suggestions,
        suggestionsStatus: state.suggestionsStatus,
        suggestionsError: state.suggestionsError,
        activeTab: state.activeTab,
        error: state.error,
        matchReport: state.matchReport,
      }),
    }
  )
);

// ==================== Utility Functions ====================

/**
 * Get the section name from a suggestion ID.
 * e.g., "SUG-WORK-001" -> "workExperience"
 */
export function getSectionFromSuggestionId(id: string): string | null {
  const prefixMap: Record<string, string> = {
    BASI: "basicInfo",
    WORK: "workExperience",
    EDUC: "education",
    PROJ: "projects",
    ACAD: "academicAchievements",
  };

  const match = id.match(/^SUG-([A-Z]{4})-\d{3}$/);
  if (!match) return null;

  return prefixMap[match[1]] || null;
}

/**
 * Get the active suggestion's location info for precise highlighting.
 */
export function getActiveSuggestionLocation(
  state: OptimizationStore
): { section: string; itemIndex: number | null } | null {
  const { activeSuggestionId, suggestions } = state;
  if (!activeSuggestionId || !suggestions) return null;

  for (const section of suggestions.sections) {
    const found = section.suggestions.find((s) => s.id === activeSuggestionId);
    if (found) {
      return {
        section: found.location.section,
        itemIndex: found.location.item_index,
      };
    }
  }
  return null;
}

