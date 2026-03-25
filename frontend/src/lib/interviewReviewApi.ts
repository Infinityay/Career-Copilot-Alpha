import {
  getRecoverableSessionById,
  getRecoverableSessions,
  type RecoverableSessionRecord,
} from "./mockInterviewRecovery";
import { sanitizeRuntimeConfig, type RuntimeConfig } from "./api";
import type { MockInterviewSessionSnapshot } from "../types/mockInterview";
import type {
  ReviewConversationMessage,
  ReviewExportReportResponse,
  ReviewGenerateReportResponse,
  ReviewGenerateTopicDetailResponse,
  ReviewOptimizationRequest,
  ReviewOptimizationResponse,
  ReviewSessionDetail,
  ReviewSessionListItem,
  ReviewTopic,
  ReviewTopicDetail,
} from "../types/interviewReview";

const REPORT_STORAGE_KEY = "face-tomato-interview-review-reports-v3";
const CONVERSATION_STORAGE_KEY = "face-tomato-interview-review-conversations-v3";
const GENERATING_STORAGE_KEY = "face-tomato-interview-review-generating-v2";
const GENERATING_PROGRESS_STORAGE_KEY = "face-tomato-interview-review-generating-progress-v2";

type StoredReports = Record<string, ReviewSessionDetail>;
type StoredConversations = Record<string, ReviewConversationMessage[]>;
type StoredGeneratingSessions = string[];
export type InterviewReviewGenerationProgress = {
  sessionId: string;
  totalTopics: number;
  currentTopic: number;
  topicName: string;
  status: "starting" | "running";
  completedTopics: ReviewTopic[];
};
type StoredGeneratingProgress = Record<string, InterviewReviewGenerationProgress>;

const inFlightReviewGenerations = new Map<string, Promise<ReviewGenerateReportResponse>>();
const inFlightTopicDetailGenerations = new Map<string, Promise<ReviewGenerateTopicDetailResponse>>();

function normalizeReviewDetail(detail: ReviewSessionDetail): ReviewSessionDetail {
  return {
    ...detail,
    topics: detail.topics.map((topic) => ({
      ...topic,
      problems: Array.isArray(topic.problems) ? topic.problems.filter(Boolean) : [],
    })),
    topicDetails: Object.fromEntries(
      Object.entries(detail.topicDetails ?? {}).map(([topicId, topic]) => [
        topicId,
        {
          ...topic,
          problems: Array.isArray(topic.problems) ? topic.problems.filter(Boolean) : [],
          assessmentFocus: Array.isArray(topic.assessmentFocus) ? topic.assessmentFocus.filter(Boolean) : [],
          answerHighlights: Array.isArray(topic.answerHighlights) ? topic.answerHighlights.filter(Boolean) : [],
          highlightedPoints: Array.isArray(topic.highlightedPoints) ? topic.highlightedPoints.filter(Boolean) : [],
          matchedAnswers: Array.isArray(topic.matchedAnswers) ? topic.matchedAnswers : [],
          strengths: Array.isArray(topic.strengths) ? topic.strengths.filter(Boolean) : [],
          weaknesses: Array.isArray(topic.weaknesses) ? topic.weaknesses.filter(Boolean) : [],
          suggestions: Array.isArray(topic.suggestions) ? topic.suggestions.filter(Boolean) : [],
          followUps: Array.isArray(topic.followUps) ? topic.followUps.filter(Boolean) : [],
        } satisfies ReviewTopicDetail,
      ])
    ),
  };
}

function safeParse<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readStoredReports(): StoredReports {
  return safeParse<StoredReports>(REPORT_STORAGE_KEY, {});
}

function writeStoredReports(reports: StoredReports) {
  localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(reports));
}

function readStoredConversations(): StoredConversations {
  return safeParse<StoredConversations>(CONVERSATION_STORAGE_KEY, {});
}

function writeStoredConversations(conversations: StoredConversations) {
  localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(conversations));
}

function readGeneratingProgress(): StoredGeneratingProgress {
  return safeParse<StoredGeneratingProgress>(GENERATING_PROGRESS_STORAGE_KEY, {});
}

function writeGeneratingProgress(progress: StoredGeneratingProgress) {
  localStorage.setItem(GENERATING_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

function readGeneratingSessions(): StoredGeneratingSessions {
  return safeParse<StoredGeneratingSessions>(GENERATING_STORAGE_KEY, []);
}

function writeGeneratingSessions(sessionIds: StoredGeneratingSessions) {
  localStorage.setItem(GENERATING_STORAGE_KEY, JSON.stringify([...new Set(sessionIds)]));
}

function markGeneratingSession(sessionId: string) {
  writeGeneratingSessions([...readGeneratingSessions(), sessionId]);
}

function unmarkGeneratingSession(sessionId: string) {
  writeGeneratingSessions(readGeneratingSessions().filter((id) => id !== sessionId));
  const progress = readGeneratingProgress();
  if (progress[sessionId]) {
    delete progress[sessionId];
    writeGeneratingProgress(progress);
  }
}

export function resetInterviewReviewSession(sessionId: string) {
  const reports = readStoredReports();
  if (reports[sessionId]) {
    delete reports[sessionId];
    writeStoredReports(reports);
  }

  const conversations = readStoredConversations();
  const nextConversations = Object.fromEntries(
    Object.entries(conversations).filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  writeStoredConversations(nextConversations);

  inFlightReviewGenerations.delete(sessionId);
  for (const key of [...inFlightTopicDetailGenerations.keys()]) {
    if (key.startsWith(`${sessionId}:`)) {
      inFlightTopicDetailGenerations.delete(key);
    }
  }
  unmarkGeneratingSession(sessionId);
}

export function isInterviewReviewReportGenerating(sessionId: string): boolean {
  return inFlightReviewGenerations.has(sessionId) || readGeneratingSessions().includes(sessionId);
}

export function getInterviewReviewGenerationPromise(
  sessionId: string
): Promise<ReviewGenerateReportResponse> | null {
  return inFlightReviewGenerations.get(sessionId) ?? null;
}

export function getInterviewReviewGenerationProgress(
  sessionId: string
): InterviewReviewGenerationProgress | null {
  return readGeneratingProgress()[sessionId] ?? null;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string | { error?: { message?: string } };
      error?: { message?: string };
    };
    if (payload.error?.message) {
      return payload.error.message;
    }
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
    if (payload.detail && typeof payload.detail === "object" && payload.detail.error?.message) {
      return payload.detail.error.message;
    }
  } catch {
    // ignore invalid json
  }
  return `请求失败，状态码 ${response.status}`;
}

function formatSnapshotInterviewAt(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSnapshotRole(snapshot: MockInterviewSessionSnapshot): string {
  return (
    snapshot.jdData?.basicInfo.jobTitle ||
    snapshot.resumeSnapshot.basicInfo.desiredPosition ||
    snapshot.category ||
    "模拟面试"
  );
}

function buildPendingListItem(record: RecoverableSessionRecord, stored?: ReviewSessionDetail): ReviewSessionListItem {
  if (stored) {
    const topicCount =
      stored.reportStatus === "ready"
        ? stored.topics.length
        : record.snapshot.interviewPlan.plan.length;
    return {
      id: stored.id,
      title: stored.title,
      role: stored.role,
      round: stored.round,
      interviewAt: stored.interviewAt,
      reportStatus: stored.reportStatus,
      overallScore: stored.reportStatus === "ready" ? stored.overallScore : null,
      topicCount,
    };
  }

  const snapshot = record.snapshot;
  const role = getSnapshotRole(snapshot);

  return {
    id: snapshot.sessionId,
    title: `${role}模拟面试复盘`,
    role,
    round: "模拟面试",
    interviewAt: formatSnapshotInterviewAt(snapshot.createdAt),
    reportStatus: "pending",
    overallScore: null,
    topicCount: snapshot.interviewPlan.plan.length,
  };
}

function buildPendingDetail(snapshot: MockInterviewSessionSnapshot): ReviewSessionDetail {
  const role = getSnapshotRole(snapshot);
  return {
    id: snapshot.sessionId,
    title: `${role}模拟面试复盘`,
    role,
    round: "模拟面试",
    interviewAt: formatSnapshotInterviewAt(snapshot.createdAt),
    reportStatus: "pending",
    defaultSelectedTopicId: null,
    overallScore: 0,
    summary: "尚未生成 LLM 复盘评价，请点击“生成报告”后查看结构化分析结果。",
    strengths: [],
    risks: [],
    priority: "先生成复盘报告，再查看按 Topic 拆解的评价与建议。",
    topics: [],
    topicDetails: {},
  };
}

function isReviewEligibleSnapshot(snapshot: MockInterviewSessionSnapshot): boolean {
  return snapshot.status === "completed" || snapshot.interviewState.closed === true;
}

function getReviewEligibleSessionRecords(): RecoverableSessionRecord[] {
  return getRecoverableSessions().filter((record) => isReviewEligibleSnapshot(record.snapshot));
}

function getSnapshotBySessionId(sessionId: string): MockInterviewSessionSnapshot | null {
  const snapshot = getRecoverableSessionById(sessionId)?.snapshot ?? null;
  return snapshot && isReviewEligibleSnapshot(snapshot) ? snapshot : null;
}

export function clearStaleInterviewReviewGeneration(sessionId: string): boolean {
  if (inFlightReviewGenerations.has(sessionId)) {
    return false;
  }
  const generatingSessions = readGeneratingSessions();
  if (!generatingSessions.includes(sessionId)) {
    return false;
  }
  unmarkGeneratingSession(sessionId);
  return true;
}

function updateInterviewReviewGenerationProgress(progress: InterviewReviewGenerationProgress) {
  const current = readGeneratingProgress();
  current[progress.sessionId] = progress;
  writeGeneratingProgress(current);
}

function mergeGeneratedTopic(topics: ReviewTopic[], incomingTopic: ReviewTopic): ReviewTopic[] {
  const next = topics.filter((topic) => topic.id !== incomingTopic.id);
  next.push(incomingTopic);
  next.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  return next;
}

export function mergeInterviewReviewProgressIntoDetail(
  detail: ReviewSessionDetail | null,
  progress: InterviewReviewGenerationProgress | null
): ReviewSessionDetail | null {
  if (!detail || !progress || progress.completedTopics.length === 0) {
    return detail;
  }
  const topics = progress.completedTopics.reduce<ReviewTopic[]>(
    (current, topic) => mergeGeneratedTopic(current, topic),
    detail.topics
  );
  return normalizeReviewDetail({
    ...detail,
    topics,
    defaultSelectedTopicId: detail.defaultSelectedTopicId ?? topics[0]?.id ?? null,
    topicDetails: detail.topicDetails ?? {},
  });
}

type SseEvent = {
  event: string;
  data: string;
};

function parseSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events = frames
    .map((frame) => {
      const lines = frame.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      return { event, data };
    })
    .filter((item) => item.data.length > 0);

  return { events, rest };
}

export function getInterviewReviewTopicCount(
  sessionId: string,
  detail?: ReviewSessionDetail | null
): number {
  if (detail?.reportStatus === "ready") {
    return detail.topics.length;
  }
  const snapshot = getSnapshotBySessionId(sessionId);
  return snapshot?.interviewPlan.plan.length ?? detail?.topics.length ?? 0;
}

export function getInterviewReviewSessionsSnapshot(): ReviewSessionListItem[] {
  const reports = readStoredReports();
  return getReviewEligibleSessionRecords().map((record) =>
    buildPendingListItem(record, reports[record.snapshot.sessionId])
  );
}

export function getInterviewReviewSessionDetailSnapshot(sessionId: string): ReviewSessionDetail | null {
  const reports = readStoredReports();
  if (reports[sessionId]) {
    return normalizeReviewDetail(reports[sessionId]);
  }

  const snapshot = getSnapshotBySessionId(sessionId);
  const pendingDetail = snapshot ? buildPendingDetail(snapshot) : null;
  return mergeInterviewReviewProgressIntoDetail(
    pendingDetail,
    getInterviewReviewGenerationProgress(sessionId)
  );
}

export async function fetchInterviewReviewSessions(): Promise<ReviewSessionListItem[]> {
  return getInterviewReviewSessionsSnapshot();
}

export async function fetchInterviewReviewSessionById(sessionId: string): Promise<ReviewSessionDetail | null> {
  return getInterviewReviewSessionDetailSnapshot(sessionId);
}

export async function generateInterviewReviewReport(
  sessionId: string,
  runtimeConfig?: RuntimeConfig | null,
  options?: {
    onProgress?: (progress: InterviewReviewGenerationProgress) => void;
  }
): Promise<ReviewGenerateReportResponse> {
  const existing = inFlightReviewGenerations.get(sessionId);
  if (existing) {
    return existing;
  }

  const snapshot = getSnapshotBySessionId(sessionId);
  const sanitizedRuntimeConfig = sanitizeRuntimeConfig(runtimeConfig);
  console.info("[interview-review] snapshot lookup", {
    sessionId,
    snapshotFound: Boolean(snapshot),
  });

  const effectiveRuntimeConfig = snapshot
    ? sanitizedRuntimeConfig ?? sanitizeRuntimeConfig(snapshot.runtimeConfig)
    : null;
  const requestSnapshot = snapshot
    ? effectiveRuntimeConfig
      ? {
          ...snapshot,
          runtimeConfig: effectiveRuntimeConfig,
        }
      : snapshot
    : null;

  console.info("[interview-review] POST /generate", {
    sessionId,
    hasSnapshot: Boolean(requestSnapshot),
    hasRuntimeConfig: Boolean(effectiveRuntimeConfig),
    messageCount: requestSnapshot?.messages.length ?? 0,
    topicCount: requestSnapshot?.interviewPlan.plan.length ?? 0,
  });

  const task = (async () => {
    markGeneratingSession(sessionId);
    try {
      const response = await fetch(`/api/interview-reviews/${encodeURIComponent(sessionId)}/generate/stream`, {
        method: "POST",
        ...(requestSnapshot
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestSnapshot),
            }
          : {}),
      });

      if (!response.ok) {
        const message = await parseErrorMessage(response);
        console.error("[interview-review] POST /generate failed", {
          sessionId,
          status: response.status,
          message,
        });
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error("生成复盘时未收到流式响应。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.rest;

        for (const item of parsed.events) {
          const event = JSON.parse(item.data) as
            | { type: "start"; sessionId: string; totalTopics: number }
            | {
                type: "topic_complete";
                sessionId: string;
                currentTopic: number;
                totalTopics: number;
                topicName: string;
                preview: ReviewTopic;
              }
            | { type: "done"; sessionId: string; reportStatus: "ready"; detail: ReviewSessionDetail }
            | { type: "error"; sessionId: string; message: string }
            | { type: "not_found"; sessionId: string };

          if (event.type === "start") {
            const progress: InterviewReviewGenerationProgress = {
              sessionId,
              totalTopics: event.totalTopics,
              currentTopic: 0,
              topicName: "",
              status: "starting",
              completedTopics: [],
            };
            updateInterviewReviewGenerationProgress(progress);
            options?.onProgress?.(progress);
            continue;
          }

          if (event.type === "topic_complete") {
            const currentProgress = getInterviewReviewGenerationProgress(sessionId);
            const progress: InterviewReviewGenerationProgress = {
              sessionId,
              totalTopics: event.totalTopics,
              currentTopic: event.currentTopic,
              topicName: event.topicName,
              status: "running",
              completedTopics: mergeGeneratedTopic(
                currentProgress?.completedTopics ?? [],
                event.preview
              ),
            };
            updateInterviewReviewGenerationProgress(progress);
            options?.onProgress?.(progress);
            continue;
          }

          if (event.type === "done") {
            console.info("[interview-review] POST /generate succeeded", {
              sessionId,
              reportStatus: event.reportStatus,
            });
            const detail = normalizeReviewDetail(event.detail);
            const reports = readStoredReports();
            reports[sessionId] = detail;
            writeStoredReports(reports);
            return {
              sessionId: event.sessionId,
              reportStatus: event.reportStatus,
              detail,
            };
          }

          if (event.type === "error") {
            throw new Error(event.message || "生成复盘失败");
          }

          if (event.type === "not_found") {
            throw new Error("Mock interview session not found");
          }
        }
      }

      const tail = buffer.trim();
      if (tail) {
        const parsedTail = parseSseEvents(`${tail}\n\n`);
        for (const item of parsedTail.events) {
          const event = JSON.parse(item.data) as
            | { type: "done"; sessionId: string; reportStatus: "ready"; detail: ReviewSessionDetail }
            | { type: "error"; sessionId: string; message: string }
            | { type: "not_found"; sessionId: string };

          if (event.type === "done") {
            console.info("[interview-review] POST /generate succeeded", {
              sessionId,
              reportStatus: event.reportStatus,
            });
            const detail = normalizeReviewDetail(event.detail);
            const reports = readStoredReports();
            reports[sessionId] = detail;
            writeStoredReports(reports);
            return {
              sessionId: event.sessionId,
              reportStatus: event.reportStatus,
              detail,
            };
          }

          if (event.type === "error") {
            throw new Error(event.message || "生成复盘失败");
          }

          if (event.type === "not_found") {
            throw new Error("Mock interview session not found");
          }
        }
      }

      throw new Error("生成复盘时流式响应提前结束。");
    } finally {
      inFlightReviewGenerations.delete(sessionId);
      unmarkGeneratingSession(sessionId);
    }
  })();

  inFlightReviewGenerations.set(sessionId, task);
  return task;
}

export async function exportInterviewReviewReport(sessionId: string): Promise<ReviewExportReportResponse> {
  const response = await fetch(`/api/interview-reviews/${encodeURIComponent(sessionId)}/export`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as ReviewExportReportResponse;
}

export function getInterviewReviewTopicDetailSnapshot(
  sessionId: string,
  topicId: string
): ReviewTopicDetail | null {
  return readStoredReports()[sessionId]?.topicDetails?.[topicId] ?? null;
}

function writeInterviewReviewTopicDetail(sessionId: string, topic: ReviewTopicDetail) {
  const reports = readStoredReports();
  const session = reports[sessionId];
  if (!session) {
    return;
  }
  reports[sessionId] = normalizeReviewDetail({
    ...session,
    topicDetails: {
      ...(session.topicDetails ?? {}),
      [topic.id]: topic,
    },
  });
  writeStoredReports(reports);
}

export async function generateInterviewReviewTopicDetail(
  sessionId: string,
  topicId: string,
  runtimeConfig?: RuntimeConfig | null
): Promise<ReviewGenerateTopicDetailResponse> {
  const existing = inFlightTopicDetailGenerations.get(`${sessionId}:${topicId}`);
  if (existing) {
    return existing;
  }

  const sanitizedRuntimeConfig = sanitizeRuntimeConfig(runtimeConfig);
  const snapshot = getSnapshotBySessionId(sessionId);
  const task = (async () => {
    const response = await fetch(
      `/api/interview-reviews/${encodeURIComponent(sessionId)}/topics/${encodeURIComponent(topicId)}/generate-detail`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          ...(snapshot ? { snapshot } : {}),
          ...(sanitizedRuntimeConfig ? { runtimeConfig: sanitizedRuntimeConfig } : {}),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    const result = (await response.json()) as ReviewGenerateTopicDetailResponse;
    writeInterviewReviewTopicDetail(sessionId, result.topic);
    return result;
  })().finally(() => {
    inFlightTopicDetailGenerations.delete(`${sessionId}:${topicId}`);
  });

  inFlightTopicDetailGenerations.set(`${sessionId}:${topicId}`, task);
  return task;
}

export async function optimizeInterviewReviewTopic(
  input: ReviewOptimizationRequest
): Promise<ReviewOptimizationResponse> {
  const sanitizedRuntimeConfig = sanitizeRuntimeConfig(input.runtimeConfig);
  const response = await fetch(
    `/api/interview-reviews/${encodeURIComponent(input.sessionId)}/topics/${encodeURIComponent(input.topicId)}/optimize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        conversation: input.conversation ?? [],
        ...(sanitizedRuntimeConfig ? { runtimeConfig: sanitizedRuntimeConfig } : {}),
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const result = (await response.json()) as ReviewOptimizationResponse;
  const storedConversations = readStoredConversations();
  storedConversations[`${input.sessionId}:${input.topicId}`] = result.conversation;
  writeStoredConversations(storedConversations);
  return result;
}
