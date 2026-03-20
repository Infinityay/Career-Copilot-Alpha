import { create } from "zustand";
import { persist } from "zustand/middleware";
import { produce } from "immer";
import { createMigratingJSONStorage, legacyStorageKey } from "./persistStorage";
import type {
  MockInterviewCreatingStep,
  MockInterviewDeveloperContext,
  MockInterviewDeveloperTraceEvent,
  PendingAssistantPhase,
  MockInterviewLimits,
  MockInterviewMessage,
  MockInterviewPlan,
  MockInterviewRetrievalResult,
  MockInterviewSessionSnapshot,
  MockInterviewState,
  MockInterviewStatus,
  ReflectionResult,
} from "@/types/mockInterview";
import type { Category, InterviewType } from "@/types/interview";

const STORAGE_KEY = "face-tamato-mock-interview";
const LEGACY_STORAGE_KEYS = [legacyStorageKey("mock", "interview")];

interface MockInterviewStore {
  sessionId: string | null;
  resumeFingerprint: string | null;
  expiresAt: string | null;
  lastActiveAt: string | null;
  status: MockInterviewStatus;
  messages: MockInterviewMessage[];
  streamingMessageId: string | null;
  pendingAssistantPhase: PendingAssistantPhase;
  selectedInterviewType: InterviewType | "";
  selectedCategory: Category | "";
  limits: MockInterviewLimits | null;
  interviewPlan: MockInterviewPlan | null;
  interviewState: MockInterviewState | null;
  retrieval: MockInterviewRetrievalResult | null;
  draftMessage: string;
  startedAtMs: number | null;
  error: string | null;
  creatingStep: MockInterviewCreatingStep;
  developerContext: MockInterviewDeveloperContext | null;
  developerTrace: MockInterviewDeveloperTraceEvent[];

  setSelectedInterviewType: (value: InterviewType | "") => void;
  setSelectedCategory: (value: Category | "") => void;
  setDraftMessage: (value: string) => void;
  setStartedAt: (value: number | null) => void;
  setCreatingStep: (step: MockInterviewCreatingStep) => void;
  initializeSession: (payload: {
    sessionId: string;
    interviewType: InterviewType;
    category: Category;
    resumeFingerprint: string;
    expiresAt: string;
    limits: MockInterviewLimits;
    interviewPlan: MockInterviewPlan;
    interviewState: MockInterviewState;
    retrieval: MockInterviewRetrievalResult;
    developerContext?: MockInterviewDeveloperContext | null;
  }) => void;
  restoreSessionFromSnapshot: (payload: { snapshot: MockInterviewSessionSnapshot }) => void;
  appendUserMessage: (message: MockInterviewMessage) => void;
  startAnswerAnalysis: () => void;
  clearPendingAssistantPhase: () => void;
  startAssistantMessage: (messageId: string) => void;
  applyAssistantDelta: (messageId: string, delta: string) => void;
  finishAssistantMessage: (payload: {
    messageId: string;
    content: string;
    interviewState: MockInterviewState;
  }) => void;
  completeStream: (payload: { status: "ready" | "completed"; interviewState?: MockInterviewState }) => void;
  setInterviewState: (interviewState: MockInterviewState) => void;
  setError: (message: string) => void;
  resetSession: () => void;
  appendReflection: (reflection: ReflectionResult) => void;
  setDeveloperContext: (context: MockInterviewDeveloperContext | null) => void;
  appendDeveloperTrace: (trace: MockInterviewDeveloperTraceEvent) => void;
  resetDeveloperTrace: () => void;
}

const initialState = {
  sessionId: null,
  resumeFingerprint: null as string | null,
  expiresAt: null as string | null,
  lastActiveAt: null as string | null,
  status: "idle" as MockInterviewStatus,
  messages: [] as MockInterviewMessage[],
  streamingMessageId: null as string | null,
  pendingAssistantPhase: "idle" as PendingAssistantPhase,
  selectedInterviewType: "" as InterviewType | "",
  selectedCategory: "" as Category | "",
  limits: null as MockInterviewLimits | null,
  interviewPlan: null as MockInterviewPlan | null,
  interviewState: null as MockInterviewState | null,
  retrieval: null as MockInterviewRetrievalResult | null,
  draftMessage: "",
  startedAtMs: null as number | null,
  error: null as string | null,
  creatingStep: "idle" as MockInterviewCreatingStep,
  developerContext: null as MockInterviewDeveloperContext | null,
  developerTrace: [] as MockInterviewDeveloperTraceEvent[],
};

export const useMockInterviewStore = create<MockInterviewStore>()(
  persist(
    (set) => ({
      ...initialState,

      setSelectedInterviewType: (value) => set({ selectedInterviewType: value }),
      setSelectedCategory: (value) => set({ selectedCategory: value }),
      setDraftMessage: (value) => set({ draftMessage: value }),
      setStartedAt: (value) => set({ startedAtMs: value }),
      setCreatingStep: (step) =>
        set((state) => ({
          status: step === "idle" ? state.status : "creating",
          creatingStep: step,
          error: null,
        })),

      initializeSession: (payload) =>
        set((state) => ({
          sessionId: payload.sessionId,
          selectedInterviewType: payload.interviewType,
          selectedCategory: payload.category,
          resumeFingerprint: payload.resumeFingerprint,
          expiresAt: payload.expiresAt,
          lastActiveAt: new Date().toISOString(),
          limits: payload.limits,
          interviewPlan: payload.interviewPlan,
          interviewState: payload.interviewState,
          retrieval: payload.retrieval,
          developerContext: payload.developerContext ?? null,
          developerTrace: [],
          status: "creating",
          messages: [],
          streamingMessageId: null,
          pendingAssistantPhase: "idle",
          draftMessage: "",
          error: null,
          creatingStep: state.creatingStep === "idle" ? "generating_plan" : state.creatingStep,
        })),

      restoreSessionFromSnapshot: ({ snapshot }) =>
        set({
          sessionId: snapshot.sessionId,
          resumeFingerprint: snapshot.resumeFingerprint,
          expiresAt: snapshot.expiresAt,
          lastActiveAt: snapshot.lastActiveAt,
          status: snapshot.status === "expired" ? "error" : (snapshot.status as MockInterviewStatus),
          messages: snapshot.messages,
          streamingMessageId: null,
          pendingAssistantPhase: "idle",
          selectedInterviewType: snapshot.interviewType,
          selectedCategory: snapshot.category,
          limits: snapshot.limits,
          interviewPlan: snapshot.interviewPlan,
          interviewState: snapshot.interviewState,
          retrieval: snapshot.retrieval,
          developerContext: snapshot.developerContext,
          developerTrace: snapshot.developerTrace,
          draftMessage: "",
          error: null,
        }),

      appendUserMessage: (message) =>
        set(
          produce((state: MockInterviewStore) => {
            state.messages.push(message);
            state.lastActiveAt = new Date().toISOString();
          })
        ),

      startAnswerAnalysis: () =>
        set({
          status: "streaming",
          pendingAssistantPhase: "analyzing_answer",
          streamingMessageId: null,
          error: null,
        }),

      clearPendingAssistantPhase: () => set({ pendingAssistantPhase: "idle" }),

      startAssistantMessage: (messageId) =>
        set(
          produce((state: MockInterviewStore) => {
            state.status = "streaming";
            state.streamingMessageId = messageId;
            state.pendingAssistantPhase = "idle";
            const existingMessage = state.messages.find((item) => item.id === messageId);
            if (!existingMessage) {
              state.messages.push({ id: messageId, role: "assistant", content: "" });
            }
          })
        ),

      applyAssistantDelta: (messageId, delta) =>
        set(
          produce((state: MockInterviewStore) => {
            const message = state.messages.find((item) => item.id === messageId);
            if (message) {
              message.content += delta;
            }
          })
        ),

      finishAssistantMessage: (payload) =>
        set(
          produce((state: MockInterviewStore) => {
            const message = state.messages.find((item) => item.id === payload.messageId);
            if (message) {
              message.content = payload.content;
            }
            state.streamingMessageId = null;
            state.pendingAssistantPhase = "idle";
            state.interviewState = payload.interviewState;
            state.status = payload.interviewState.closed ? "completed" : "ready";
            state.lastActiveAt = new Date().toISOString();
          })
        ),

      completeStream: ({ status, interviewState }) =>
        set((state) => ({
          status,
          interviewState: interviewState ?? state.interviewState,
          streamingMessageId: null,
          pendingAssistantPhase: "idle",
          lastActiveAt: new Date().toISOString(),
          creatingStep: "idle",
          error: null,
        })),

      setInterviewState: (interviewState) =>
        set((state) => ({
          interviewState,
          lastActiveAt: new Date().toISOString(),
          status: interviewState.closed ? "completed" : state.status,
        })),

      setError: (message) =>
        set({ status: "error", error: message, streamingMessageId: null, pendingAssistantPhase: "idle", creatingStep: "idle" }),

      appendReflection: (reflection) =>
        set(
          produce((state: MockInterviewStore) => {
            if (!state.interviewState) {
              return;
            }
            state.interviewState.reflectionHistory.push(reflection);
            state.lastActiveAt = new Date().toISOString();
          })
        ),

      setDeveloperContext: (context) => set({ developerContext: context }),

      appendDeveloperTrace: (trace) =>
        set(
          produce((state: MockInterviewStore) => {
            state.developerTrace.push(trace);
            state.lastActiveAt = new Date().toISOString();
          })
        ),

      resetDeveloperTrace: () => set({ developerTrace: [] }),

      resetSession: () => set({ ...initialState }),
    }),
    {
      name: STORAGE_KEY,
      storage: createMigratingJSONStorage("local", STORAGE_KEY, LEGACY_STORAGE_KEYS),
      partialize: (state) => ({
        sessionId: state.sessionId,
        resumeFingerprint: state.resumeFingerprint,
        expiresAt: state.expiresAt,
        lastActiveAt: state.lastActiveAt,
        selectedInterviewType: state.selectedInterviewType,
        selectedCategory: state.selectedCategory,
        limits: state.limits,
        interviewPlan: state.interviewPlan,
        interviewState: state.interviewState,
        retrieval: state.retrieval,
        draftMessage: state.draftMessage,
        startedAtMs: state.startedAtMs,
        status: state.status,
        creatingStep: state.creatingStep,
        pendingAssistantPhase: state.pendingAssistantPhase,
        developerContext: state.developerContext,
        developerTrace: state.developerTrace,
      }),
    }
  )
);
