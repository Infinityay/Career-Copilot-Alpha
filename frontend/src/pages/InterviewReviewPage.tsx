
import type { KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  ArrowLeft,
  ChevronRight,
  Sparkles,
  Send,
  Mic,
  CheckCircle2,
  TriangleAlert,
  Wand2,
  Eye,
} from "lucide-react";
import {
  clearStaleInterviewReviewGeneration,
  fetchInterviewReviewSessions,
  generateInterviewReviewReport,
  generateInterviewReviewTopicDetail,
  getInterviewReviewGenerationProgress,
  getInterviewReviewGenerationPromise,
  getInterviewReviewTopicCount,
  getInterviewReviewSessionDetailSnapshot,
  getInterviewReviewSessionsSnapshot,
  isInterviewReviewReportGenerating,
  mergeInterviewReviewProgressIntoDetail,
  optimizeInterviewReviewTopic,
  resetInterviewReviewSession,
  type InterviewReviewGenerationProgress,
} from "../lib/interviewReviewApi";
import { getRecoverableSessionById } from "../lib/mockInterviewRecovery";
import type {
  ReviewChatMessage,
  ReviewMatchedAnswer,
  ReviewReportStatus,
  ReviewSessionDetail,
  ReviewSessionListItem,
  ReviewTopic,
  ReviewTopicDetail,
} from "../types/interviewReview";
import { cn } from "../lib/utils";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { useRuntimeSettingsStore } from "../store/runtimeSettingsStore";

type RubricPoint = { label: string; keywords: string[] };

const getDefaultTopicId = (session: ReviewSessionDetail | null | undefined) => {
  if (!session) return null;
  return session.topics.find((topic) => topic.id === session.defaultSelectedTopicId)?.id ?? session.topics[0]?.id ?? null;
};

const getScoreBadgeTone = (score: number) => {
  if (score >= 80) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (score >= 60) return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
};

const topicRubrics: Record<string, RubricPoint[]> = {
  "topic-react-performance": [
    { label: "Performance baseline", keywords: ["metric", "baseline", "lcp", "inp", "cls"] },
    { label: "Bottleneck tooling", keywords: ["network", "performance", "profiler", "devtools"] },
    { label: "Rendering and loading", keywords: ["lazy", "split", "virtual", "render", "resource"] },
  ],
};

const genericRubricFallback = (topic: ReviewTopicDetail): RubricPoint[] => [
  { label: "Framework completeness", keywords: topic.coreQuestion.slice(0, 8).split("") },
  { label: "Tools and methods", keywords: topic.answerHighlights.join(" ").split(" ").slice(0, 3) },
  { label: "Results and optimization", keywords: topic.suggestions.join(" ").split(" ").slice(0, 3) },
];

const getMatchedAnswerState = (status: ReviewMatchedAnswer["status"] | undefined, matchedAnswer: string | null) => {
  if (status === "incomplete") {
    return {
      matched: false,
      tone: "warning",
      message: "该回答只覆盖了部分要点，关键子问题没有答完整，建议直接补全缺失部分。",
    };
  }
  if (status === "logic_confused") {
    return {
      matched: false,
      tone: "danger",
      message: "该回答涉及此维度，但存在逻辑混乱，建议重组论证链路。",
    };
  }
  if (status === "knowledge_unclear") {
    return {
      matched: false,
      tone: "danger",
      message: "该回答涉及此维度，但知识点不清或概念混淆，建议先校准原理理解。",
    };
  }
  if (status === "missing" || !matchedAnswer) {
    return {
      matched: false,
      tone: "danger",
      message: "该维度未明确覆盖，建议补充对应回答。",
    };
  }
  return { matched: true, tone: "success", message: "" };
};

const buildAnswerComparison = (topic: ReviewTopicDetail) => {
  const explicitMatches = topic.matchedAnswers;
  const focusPoints = topic.assessmentFocus.map((focus) => ({ label: focus, keywords: [] }));
  const matches: Array<{
    point: RubricPoint;
    matchedAnswerIndex: number;
    matchedAnswer: string | null;
    status: ReviewMatchedAnswer["status"];
    reason: string | undefined;
  }> = explicitMatches.length > 0
    ? focusPoints.map((point, index) => {
        const explicitMatch =
          explicitMatches.find((item) => item.point === point.label) ??
          explicitMatches[index] ??
          ({ point: point.label, answerHighlightIndex: null, status: "missing", reason: "" } satisfies ReviewMatchedAnswer);
        return {
          point,
          matchedAnswerIndex: explicitMatch.answerHighlightIndex ?? -1,
          matchedAnswer: explicitMatch.answerHighlightIndex != null ? topic.answerHighlights[explicitMatch.answerHighlightIndex] ?? null : null,
          status: explicitMatch.status,
          reason: explicitMatch.reason,
        };
      })
    : (topicRubrics[topic.id] ?? genericRubricFallback(topic)).map((point) => {
        const normalizedAnswers = topic.answerHighlights.map((answer) => answer.toLowerCase());
        const matchedAnswerIndex = normalizedAnswers.findIndex((answer) => point.keywords.some((keyword) => answer.includes(keyword.toLowerCase())));
        return {
          point,
          matchedAnswerIndex,
          matchedAnswer: matchedAnswerIndex >= 0 ? topic.answerHighlights[matchedAnswerIndex] : null,
          status: matchedAnswerIndex >= 0 ? "covered" : "missing",
          reason: "",
        };
      });

  const matchedIndexes = new Set(matches.filter((item) => item.matchedAnswerIndex >= 0).map((item) => item.matchedAnswerIndex));
  const offTopicAnswers = topic.answerHighlights.map((answer, index) => ({ answer, index })).filter((item) => !matchedIndexes.has(item.index));
  return { matches, offTopicAnswers };
};

const buildTopicProblemSummary = (topic: ReviewTopic | ReviewTopicDetail) => {
  const explicitProblems = topic.problems
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const detailTopic = topic as Partial<ReviewTopicDetail>;
  const problemLines = (detailTopic.matchedAnswers ?? [])
    .filter((item) => item.status && item.status !== "covered")
    .map((item) => (item.reason?.trim() || `${item.point} 回答不完整，需要补充。`).replace(/\s+/g, " "));

  const weaknessLines = (detailTopic.weaknesses ?? [])
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  const merged = [...explicitProblems, ...problemLines, ...weaknessLines];
  return merged.length > 0 ? Array.from(new Set(merged)) : ["当前没有提炼出明确问题，建议结合考察点继续补充细节。"];
};

const isReviewEligibleSessionId = (sessionId: string) => {
  const snapshot = getRecoverableSessionById(sessionId)?.snapshot;
  if (!snapshot) {
    return true;
  }
  return snapshot.status === "completed" || snapshot.interviewState.closed === true;
};

const formatGenerationProgressMessage = (
  progress: InterviewReviewGenerationProgress | null,
  totalTopics: number
) => {
  if (!progress) {
    return totalTopics > 0 ? `正在准备 ${totalTopics} 个 Topic 的评估任务...` : "正在准备 Topic 评估任务...";
  }

  if (progress.status === "starting") {
    return progress.totalTopics > 0
      ? `正在准备 ${progress.totalTopics} 个 Topic 的评估任务...`
      : "正在准备 Topic 评估任务...";
  }

  if (progress.topicName) {
    return `已完成第 ${progress.currentTopic} 个 Topic：${progress.topicName}`;
  }

  return `已完成 ${progress.currentTopic}/${progress.totalTopics} 个 Topic`;
};

const InterviewReviewPage = () => {
  const runtimeConfig = useRuntimeSettingsStore();
  const [sessions, setSessions] = useState<ReviewSessionListItem[]>(() => getInterviewReviewSessionsSnapshot());
  const [selectedSession, setSelectedSession] = useState<ReviewSessionDetail | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [reportStatuses, setReportStatuses] = useState<Record<string, ReviewReportStatus>>(() =>
    Object.fromEntries(getInterviewReviewSessionsSnapshot().map((session) => [session.id, session.reportStatus]))
  );
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<InterviewReviewGenerationProgress | null>(null);
  const [optimizationDraft, setOptimizationDraft] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ReviewChatMessage[]>([]);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [problemsExpanded, setProblemsExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchInterviewReviewSessions().then((data) => {
      if (!alive) return;
      setSessions(data);
      setReportStatuses((current) => ({ ...Object.fromEntries(data.map((session) => [session.id, session.reportStatus])), ...current }));
    });
    return () => {
      alive = false;
    };
  }, []);

  const selectedTopic = useMemo(() => {
    if (!selectedSession) return null;
    return selectedSession.topics.find((topic) => topic.id === selectedTopicId) ?? selectedSession.topics.find((topic) => topic.id === getDefaultTopicId(selectedSession)) ?? selectedSession.topics[0] ?? null;
  }, [selectedSession, selectedTopicId]);

  const selectedTopicDetail = useMemo(
    () => (selectedSession && selectedTopic ? selectedSession.topicDetails[selectedTopic.id] ?? null : null),
    [selectedSession, selectedTopic]
  );

  const topicChatMessages = useMemo(
    () => (selectedSession && selectedTopicDetail ? chatMessages.filter((message) => message.sessionId === selectedSession.id && message.topicId === selectedTopicDetail.id) : []),
    [chatMessages, selectedSession, selectedTopicDetail]
  );

  const selectedTopicProblems = useMemo(
    () => (selectedTopicDetail ? buildTopicProblemSummary(selectedTopicDetail) : selectedTopic ? buildTopicProblemSummary(selectedTopic) : []),
    [selectedTopic, selectedTopicDetail]
  );
  const [loadingTopicDetailId, setLoadingTopicDetailId] = useState<string | null>(null);

  useEffect(() => {
    setProblemsExpanded(false);
  }, [selectedTopicId]);

  useEffect(() => {
    const sessionId = selectedSession?.id;
    const topicId = selectedTopic?.id;
    const topicDetail = selectedTopicDetail;
    const reportStatus = selectedSession?.reportStatus;

    if (!sessionId || !topicId || reportStatus !== "ready" || isGeneratingReport) {
      return;
    }
    if (topicDetail || loadingTopicDetailId === topicId) {
      return;
    }

    setLoadingTopicDetailId(topicId);
    void generateInterviewReviewTopicDetail(sessionId, topicId, runtimeConfig)
      .then((result) => {
        setLoadingTopicDetailId((current) => (current === topicId ? null : current));
        setSelectedSession((current) => {
          if (!current || current.id !== sessionId) {
            return current;
          }
          return {
            ...current,
            topicDetails: {
              ...current.topicDetails,
              [result.topic.id]: result.topic,
            },
          };
        });
      })
      .catch((error) => {
        setLoadingTopicDetailId((current) => (current === topicId ? null : current));
        setOptimizationError(error instanceof Error ? error.message : "Failed to generate topic detail.");
      });
  }, [isGeneratingReport, loadingTopicDetailId, runtimeConfig, selectedSession?.id, selectedSession?.reportStatus, selectedTopic?.id, selectedTopicDetail]);

  useEffect(() => {
    if (!selectedSession || !isGeneratingReport) {
      return;
    }

    const sessionId = selectedSession.id;
    const timer = window.setInterval(() => {
      const progress = getInterviewReviewGenerationProgress(sessionId);
      setGenerationProgress(progress);
      setSelectedSession((current) => {
        if (!current || current.id !== sessionId) {
          return current;
        }
        return mergeInterviewReviewProgressIntoDetail(current, progress);
      });
      setSelectedTopicId((current) => current ?? progress?.completedTopics[0]?.id ?? null);
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [isGeneratingReport, selectedSession?.id]);

  useEffect(() => {
    if (!selectedSession) {
      setIsGeneratingReport(false);
      setGenerationProgress(null);
      return;
    }

    const sessionId = selectedSession.id;
    const pending = isInterviewReviewReportGenerating(sessionId);
    if (!pending) {
      setIsGeneratingReport(false);
      setGenerationProgress(null);
      return;
    }

    setIsGeneratingReport(true);
    const progress = getInterviewReviewGenerationProgress(sessionId);
    setGenerationProgress(progress);
    setSelectedSession((current) => mergeInterviewReviewProgressIntoDetail(current, progress));
    const inFlight = getInterviewReviewGenerationPromise(sessionId);
    if (!inFlight) {
      const cleared = clearStaleInterviewReviewGeneration(sessionId);
      if (cleared) {
        setIsGeneratingReport(false);
        setGenerationProgress(null);
        setOptimizationError("上一次复盘生成已中断，请重新点击“生成报告”。");
      }
      return;
    }

    let alive = true;
    void inFlight
      .then((result) => {
        if (!alive) return;
        setReportStatuses((current) => ({ ...current, [result.sessionId]: result.reportStatus }));
        const detail = result.detail ?? getInterviewReviewSessionDetailSnapshot(sessionId);
        if (!detail) return;
        setSelectedSession(detail);
        setSelectedTopicId((current) => current ?? getDefaultTopicId(detail));
      })
      .catch((error) => {
        if (!alive) return;
        setOptimizationError(error instanceof Error ? error.message : "Failed to generate interview review report.");
      })
      .finally(() => {
        if (!alive) return;
        setIsGeneratingReport(false);
        setGenerationProgress(null);
      });

    return () => {
      alive = false;
    };
  }, [selectedSession?.id]);

  const interviewRecords = useMemo(() => sessions.map((session) => ({ ...session, status: reportStatuses[session.id] ?? session.reportStatus })), [reportStatuses, sessions]);
  const selectedSessionTopicCount = useMemo(
    () => (selectedSession ? getInterviewReviewTopicCount(selectedSession.id, selectedSession) : 0),
    [selectedSession]
  );

  const triggerReportGeneration = async (sessionId: string) => {
    setIsGeneratingReport(true);
    setGenerationProgress(null);
    console.info("[interview-review] trigger generation", {
      sessionId,
      runtimeApiKeyConfigured: Boolean(runtimeConfig.apiKey?.trim()),
      runtimeBaseUrlConfigured: Boolean(runtimeConfig.baseURL?.trim()),
      runtimeModelConfigured: Boolean(runtimeConfig.model?.trim()),
    });
    const result = await generateInterviewReviewReport(sessionId, runtimeConfig, {
      onProgress: (progress) => {
        setGenerationProgress(progress);
        setSelectedSession((current) => mergeInterviewReviewProgressIntoDetail(current, progress));
      },
    });
    setReportStatuses((current) => ({ ...current, [result.sessionId]: result.reportStatus }));
    const detail = result.detail ?? getInterviewReviewSessionDetailSnapshot(sessionId);
    if (detail) {
      console.info("[interview-review] detail loaded after generation", {
        sessionId,
        topicCount: detail.topics.length,
        reportStatus: detail.reportStatus,
      });
      setSelectedSession(detail);
      setSelectedTopicId((current) => current ?? getDefaultTopicId(detail));
      setGenerationProgress(null);
      return;
    }

    setOptimizationError("未能保存复盘结果，请重试。");
  };

  const handleOpenRecord = (sessionId: string) => {
    setOptimizationDraft("");
    setOptimizationError(null);
    setChatMessages([]);
    const detail = getInterviewReviewSessionDetailSnapshot(sessionId);
    const reviewEligible = isReviewEligibleSessionId(sessionId);
    const generating = isInterviewReviewReportGenerating(sessionId);
    console.info("[interview-review] open record", {
      sessionId,
      localDetailFound: Boolean(detail),
      localReportStatus: detail?.reportStatus ?? null,
      localTopicCount: detail?.topics.length ?? 0,
      reviewEligible,
      generating,
    });
    setSelectedSession(detail);
    setSelectedTopicId(getDefaultTopicId(detail));
    setIsGeneratingReport(generating);
    setGenerationProgress(generating ? getInterviewReviewGenerationProgress(sessionId) : null);

    if (!reviewEligible) {
      setOptimizationError("请先完成模拟面试后再生成复盘报告");
      return;
    }
  };

  const handleBackToList = () => {
    setSelectedSession(null);
    setSelectedTopicId(null);
    setOptimizationDraft("");
    setOptimizationError(null);
    setIsGeneratingReport(false);
    setGenerationProgress(null);
  };

  const handleGenerateReport = () => {
    if (!selectedSession) return;
    const sessionId = selectedSession.id;
    setOptimizationDraft("");
    setOptimizationError(null);
    setSelectedTopicId(null);
    setChatMessages([]);
    resetInterviewReviewSession(sessionId);
    const resetDetail = getInterviewReviewSessionDetailSnapshot(sessionId);
    if (resetDetail) {
      setSelectedSession(resetDetail);
    }
    void triggerReportGeneration(sessionId)
      .catch((error) => setOptimizationError(error instanceof Error ? error.message : "Failed to generate interview review report."))
      .finally(() => setIsGeneratingReport(false));
  };

  const handleOptimizeTopic = async () => {
    if (!selectedSession || !selectedTopicDetail || !optimizationDraft.trim() || isOptimizing) return;
    const userMessage = optimizationDraft.trim();
    setOptimizationDraft("");
    setChatMessages((current) => [...current, { messageId: `user-${Date.now()}`, sessionId: selectedSession.id, topicId: selectedTopicDetail.id, role: "user", content: userMessage, createdAt: new Date().toISOString() }]);
    setIsOptimizing(true);
    setOptimizationError(null);
    try {
      const result = await optimizeInterviewReviewTopic({
        sessionId: selectedSession.id,
        topicId: selectedTopicDetail.id,
        message: userMessage,
        topic: selectedTopicDetail,
        conversation: topicChatMessages,
        runtimeConfig,
      });
      setChatMessages((current) => [...current, result.message]);
    } catch (error) {
      setOptimizationDraft(userMessage);
      setOptimizationError(error instanceof Error ? error.message : "Failed to optimize answer.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleOptimizationDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void handleOptimizeTopic();
  };

  if (!selectedSession) {
    return (
      <div className="flex min-h-[calc(100vh-140px)] items-center justify-center px-4 py-10 md:px-6">
        <div className="w-full max-w-3xl">
          <Card className="min-h-[520px] rounded-[20px] border border-border/70 bg-background shadow-sm">
            <CardHeader>
              <CardTitle className="text-center text-xl">选择面试记录</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {optimizationError ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-4 text-sm leading-6 text-rose-600 dark:text-rose-300">{optimizationError}</div> : null}
              {interviewRecords.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">请先在"模拟面试"页面完成模拟面试，完成后此处即可显示面试记录。</p>
              ) : null}
              {interviewRecords.map((record) => {
                const ready = record.status === "ready";
                return (
                  <button key={record.id} type="button" onClick={() => handleOpenRecord(record.id)} className="w-full rounded-[16px] border border-border/70 bg-background px-4 py-3.5 text-left hover:border-primary/25 hover:bg-sidebar/10">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="grid flex-1 gap-2.5 md:grid-cols-[1.2fr_1fr_1.1fr]">
                        <div className="space-y-1 rounded-2xl bg-sidebar/35 px-3 py-2.5"><p className="text-xs text-muted-foreground">岗位名称</p><p className="text-base font-medium text-foreground">{record.role}</p></div>
                        <div className="space-y-1 rounded-2xl bg-sidebar/35 px-3 py-2.5"><p className="text-xs text-muted-foreground">面试时间</p><p className="text-base font-semibold text-foreground">{record.interviewAt}</p></div>
                        <div className="space-y-1 rounded-2xl bg-sidebar/35 px-3 py-2.5"><p className="text-xs text-muted-foreground">记录状态</p><div className="flex items-center gap-2"><Badge className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", ready ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>{ready ? "已生成复盘" : "待生成复盘"}</Badge><span className="text-sm text-muted-foreground">{record.topicCount} 个 Topic</span></div></div>
                      </div>
                      <span className="inline-flex whitespace-nowrap rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">查看复盘<ChevronRight className="ml-1 h-4 w-4" /></span>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pb-6">
      <section className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-sidebar/50 p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">面试复盘报告</h1></div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/70 bg-background/90 px-4 py-3 shadow-sm"><p className="text-xs text-muted-foreground">当前面试记录</p><p className="text-sm font-semibold text-foreground">{selectedSession.role}</p></div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_480px] 2xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" className="h-9 rounded-full border border-border/70 px-4 text-muted-foreground hover:bg-sidebar/35" onClick={handleBackToList}><ArrowLeft className="mr-2 h-4 w-4" />返回记录列表</Button>
            <Button type="button" variant="outline" className="rounded-2xl" onClick={handleGenerateReport} disabled={isGeneratingReport}>{selectedSession.reportStatus === "ready" ? "重新生成" : "生成报告"}</Button>
          </div>

          <Card className="rounded-3xl border border-border/70 shadow-sm">
            <CardHeader><div className="flex items-center justify-between"><CardTitle>面试总览</CardTitle>{selectedSession.reportStatus === "ready" ? <Badge className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">总体评分 {selectedSession.overallScore}</Badge> : <Badge variant="outline">待生成</Badge>}</div></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">{[{ label: "岗位方向", value: selectedSession.role }, { label: "面试时间", value: selectedSession.interviewAt }, { label: "Topic 数量", value: String(selectedSessionTopicCount) }].map((item) => <div key={item.label} className="space-y-2 rounded-2xl bg-sidebar/35 px-4 py-4"><p className="text-xs text-muted-foreground">{item.label}</p><p className="text-lg font-semibold text-foreground">{item.value}</p></div>)}</div>
              <div className="rounded-2xl border border-border/60 bg-background px-4 py-4"><p className="mb-2 text-xs text-muted-foreground">评价</p><p className="text-sm leading-7 text-foreground">{selectedSession.summary}</p></div>
              {optimizationError ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-4 text-sm leading-6 text-rose-600 dark:text-rose-300">{optimizationError}</div> : null}
            </CardContent>
          </Card>

          <AnimatePresence mode="wait">
            {isGeneratingReport && selectedSession.topics.length === 0 ? (
              <motion.div key="generating" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <Card className="rounded-3xl border border-border/70 shadow-sm">
                  <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-5 p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">正在生成面试复盘</h2>
                      <p className="text-sm text-muted-foreground">正在调用 LLM 分析面试记录并生成结构化复盘，请稍候。</p>
                    </div>
                    <div className="w-full max-w-md rounded-3xl border border-border/70 bg-sidebar/25 px-5 py-4 text-left">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">生成进度</p>
                        <p className="text-sm font-semibold text-primary">
                          {generationProgress
                            ? `${generationProgress.currentTopic}/${generationProgress.totalTopics}`
                            : `0/${selectedSessionTopicCount}`}
                        </p>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/60">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{
                            width: `${
                              generationProgress?.totalTopics
                                ? (generationProgress.currentTopic / generationProgress.totalTopics) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {formatGenerationProgressMessage(generationProgress, selectedSessionTopicCount)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ) : selectedSession.topics.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}><Card className="rounded-3xl border border-dashed border-border/70 shadow-sm"><CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center"><Sparkles className="h-8 w-8 text-primary" /><div><h2 className="text-xl font-semibold text-foreground">尚未生成 LLM 复盘评价</h2><p className="text-sm text-muted-foreground">点击“生成报告”后会调用后端生成复盘，并把结果保存在当前浏览器的本地记录中。</p></div></CardContent></Card></motion.div>
            ) : (
              <motion.div key="topics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-5 pt-2">
                {isGeneratingReport ? (
                  <Card className="rounded-3xl border border-border/70 bg-sidebar/20 shadow-sm">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">复盘总览生成中</p>
                        <p className="text-sm font-semibold text-primary">
                          {generationProgress
                            ? `${generationProgress.currentTopic}/${generationProgress.totalTopics}`
                            : `0/${selectedSessionTopicCount}`}
                        </p>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-border/60">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{
                            width: `${
                              generationProgress?.totalTopics
                                ? (generationProgress.currentTopic / generationProgress.totalTopics) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
                {selectedSession.topics.map((topic) => {
                  const isActive = topic.id === (selectedTopic?.id ?? getDefaultTopicId(selectedSession));
                  const detailReady = Boolean(selectedSession.topicDetails[topic.id]);
                  const detailLoading = loadingTopicDetailId === topic.id;
                  return (
                    <Card key={topic.id} className={cn("rounded-3xl border border-border/70 shadow-sm", isActive && "border-primary/25")}>
                      <CardContent className="space-y-5 p-5 md:p-6">
                        <div className="rounded-2xl border border-border/70 bg-sidebar/25 px-5 py-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 flex-1">
                              <button type="button" onClick={() => setSelectedTopicId(topic.id)} className="text-left text-2xl font-semibold text-foreground">
                                {topic.name}
                              </button>
                            </div>
                            <div className="flex shrink-0 items-center gap-3 self-start md:ml-4">
                              <Badge variant="outline" className={cn("rounded-full border px-4 py-2 text-base font-semibold", getScoreBadgeTone(topic.score))}>
                              AI 评分 {topic.score}
                              </Badge>
                              <Button
                                type="button"
                                variant={detailReady ? "outline" : "default"}
                                className={cn(
                                  "rounded-2xl whitespace-nowrap",
                                  isGeneratingReport && "cursor-not-allowed opacity-60",
                                  detailReady
                                    ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-300"
                                    : "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                                )}
                                onClick={() => setSelectedTopicId(topic.id)}
                                disabled={isGeneratingReport}
                              >
                                {detailLoading ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    生成中...
                                  </>
                                ) : detailReady ? (
                                  <>
                                    <Eye className="mr-2 h-4 w-4" />
                                    查看深度分析
                                  </>
                                ) : (
                                  <>
                                    <Wand2 className="mr-2 h-4 w-4" />
                                    生成深度分析
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-3xl border border-border/70 bg-background px-5 py-5">
                          <p className="mb-2 text-sm font-semibold text-foreground">核心问题</p>
                          <p className="text-base leading-8 text-foreground">{topic.coreQuestion}</p>
                        </div>
                        <div className="rounded-3xl border border-border/70 bg-background px-5 py-5">
                          <p className="mb-2 text-sm font-semibold text-foreground">预览评价</p>
                          <p className="text-sm leading-7 text-foreground">{topic.evaluation}</p>
                        </div>
                        <div className="rounded-3xl border border-border/70 bg-background px-5 py-5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-foreground">当前最主要的问题</p>
                          </div>
                          <div className="mt-3 space-y-2 text-sm leading-7 text-muted-foreground">
                            {buildTopicProblemSummary(topic).slice(0, 2).map((problem, index) => (
                              <p key={`${topic.id}-preview-problem-${index}`}>{problem}</p>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card className="min-h-[620px] overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-background to-sidebar/20 shadow-sm xl:h-[calc(100vh-1.5rem)]">
            <CardHeader className="border-b border-border/60 bg-background/95 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-xl font-semibold tracking-tight">面试回复打磨</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-[540px] flex-col p-0 xl:h-[calc(100%-5rem)]">
              {isGeneratingReport ? (
                <div className="flex min-h-[540px] flex-1 items-center justify-center p-8">
                  <div className="max-w-sm rounded-3xl border border-border/70 bg-background px-6 py-6 text-center shadow-sm">
                    <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
                    <p className="mt-4 text-base font-semibold text-foreground">正在生成复盘总览</p>
                  </div>
                </div>
              ) : selectedTopic ? (
                <>
                  <div className="flex-1 overflow-y-auto px-4 py-5">
                    <div className="space-y-4">
                      <div className="rounded-3xl border border-border/70 bg-background px-5 py-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                            <h3 className="text-xl font-semibold tracking-tight text-foreground">{selectedTopic.name}</h3>
                          </div>
                          <Badge variant="outline" className={cn("shrink-0 rounded-full border px-3 py-1 text-sm font-semibold", getScoreBadgeTone(selectedTopic.score))}>
                            当前分数 {selectedTopic.score}
                          </Badge>
                        </div>
                        <div className="mt-4 space-y-4 text-sm leading-7">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">核心问题</p>
                            <p className="mt-2 text-[15px] leading-7 text-foreground">{selectedTopic.coreQuestion}</p>
                          </div>
                          <div>
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">回答存在的问题</p>
                              {selectedTopicProblems.length > 2 ? <button type="button" onClick={() => setProblemsExpanded((current) => !current)} className="text-xs font-medium text-primary hover:underline">{problemsExpanded ? "收起" : "展开全部"}</button> : null}
                            </div>
                            <div className="mt-3 space-y-2">
                              {(problemsExpanded ? selectedTopicProblems : selectedTopicProblems.slice(0, 2)).map((problem, index) => (
                                <div key={`${selectedTopic.id}-problem-${index}`} className="rounded-2xl border border-border/60 bg-sidebar/20 px-4 py-3 text-sm leading-7 text-foreground/85">
                                  {problem}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      {!selectedTopicDetail ? (
                        <div className="rounded-3xl border border-border/70 bg-background px-5 py-6 text-sm text-muted-foreground shadow-sm">
                          {loadingTopicDetailId === selectedTopic.id ? (
                            <>
                              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                              正在生成该 Topic 的深度分析...
                            </>
                          ) : (
                            "正在准备该 Topic 的深度分析。"
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="space-y-4">
                            <div className="rounded-3xl border border-border/70 bg-background px-5 py-5 shadow-sm">
                              <div className="mb-4 flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">面试官考察意图</p>
                                <span className="rounded-full bg-sidebar/40 px-3 py-1 text-xs text-muted-foreground">
                                  {selectedTopicDetail.assessmentFocus.length} 个考察点
                                </span>
                              </div>
                              <div className="space-y-3">
                                {selectedTopicDetail.assessmentFocus.map((focus, index) => (
                                  <div key={`${selectedTopicDetail.id}-focus-${index}`} className="rounded-2xl border border-border/60 bg-sidebar/20 px-4 py-3">
                                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">考察点 {index + 1}</p>
                                    <p className="mt-2 text-[15px] leading-7 text-foreground">{focus}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-3xl border border-border/70 bg-background px-5 py-5 shadow-sm">
                              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">我的实际回答</p>
                              <div className="space-y-3">
                                {buildAnswerComparison(selectedTopicDetail).matches.map((match, index) => {
                                  const state = getMatchedAnswerState(match.status, match.matchedAnswer);
                                  const warning = state.tone === "warning";
                                  return <div key={match.point.label} className={cn("rounded-2xl border px-4 py-4", state.matched ? "border-emerald-500/20 bg-emerald-500/5" : warning ? "border-amber-500/20 bg-amber-500/5" : "border-rose-500/20 bg-rose-500/5")}><div className="flex items-start gap-3">{state.matched ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <TriangleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", warning ? "text-amber-500" : "text-rose-500")} />}<div className="min-w-0 flex-1"><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">采分点 {index + 1}</p>{state.matched ? <p className="mt-2 text-[15px] leading-7 text-foreground">{match.matchedAnswer}</p> : <div className="mt-2 space-y-2"><p className={cn("text-sm leading-7", warning ? "text-amber-800 dark:text-amber-200" : "text-rose-700 dark:text-rose-200")}>{state.message}</p>{match.matchedAnswer ? <div className="rounded-xl bg-background/80 px-3 py-2 text-sm leading-7 text-foreground/85">实际回答：{match.matchedAnswer}</div> : null}{match.reason ? <p className={cn("text-xs leading-6", warning ? "text-amber-700/90 dark:text-amber-300/90" : "text-rose-600/90 dark:text-rose-300/90")}>判定依据：{match.reason}</p> : null}</div>}</div></div></div>;
                                })}
                              </div>
                            </div>
                          </div>
                          {topicChatMessages.map((message) => message.role === "user" ? <div key={message.messageId} className="flex justify-end"><div className="max-w-[85%] rounded-[22px] rounded-br-md bg-primary px-4 py-3 text-sm leading-7 text-primary-foreground shadow-sm">{message.content}</div></div> : <div key={message.messageId} className="rounded-3xl border border-primary/15 bg-primary/5 px-4 py-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">深度打磨回答</p><p className="mt-3 text-sm leading-7 text-foreground">{message.content}</p>{message.evidence?.find((item) => item.type === "optimized_answer" && item.content.trim()) ? <div className="mt-4 rounded-2xl border border-primary/20 bg-background/90 px-4 py-3"><p className="text-xs font-semibold tracking-[0.16em] text-primary">建议回答</p><p className="mt-2 text-sm leading-7 text-foreground">{message.evidence.find((item) => item.type === "optimized_answer")?.content}</p></div> : null}</div>)}
                          {isOptimizing ? <div className="rounded-3xl border border-border/60 bg-background px-4 py-4 text-sm text-muted-foreground shadow-sm"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />正在生成打磨建议...</div> : null}
                          {optimizationError ? <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 px-4 py-4 text-sm leading-6 text-rose-600 dark:text-rose-300 shadow-sm">{optimizationError}</div> : null}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-border/60 px-4 pb-4 pt-3"><div className="flex items-center gap-2 rounded-[16px] border border-border/60 bg-muted/20 px-2 py-1.5"><Textarea value={optimizationDraft} onChange={(event) => setOptimizationDraft(event.target.value)} onKeyDown={handleOptimizationDraftKeyDown} placeholder={selectedTopicDetail ? "输入你想探讨的话题，或询问这个问题还能从哪些角度拓展。" : "等待该 Topic 的深度分析生成后，再继续打磨回答。"} className="min-h-[48px] flex-1 resize-none rounded-[12px] border-0 bg-transparent px-3 py-2.5 text-sm leading-6 shadow-none hover:bg-transparent focus:bg-transparent focus:ring-0 focus-visible:ring-0" maxLength={1500} disabled={!selectedTopicDetail} /><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full text-foreground hover:bg-transparent hover:text-foreground"><Mic className="h-4 w-4" /></Button><Button type="button" size="icon" className="h-8 w-8 shrink-0 rounded-full border-0 bg-primary/60 text-primary-foreground hover:bg-primary/60" onClick={handleOptimizeTopic} disabled={!selectedTopicDetail || !optimizationDraft.trim() || isOptimizing}><Send className="h-4 w-4" /></Button></div><div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground/90"><span>建议控制在 1200 字以内</span><span>{optimizationDraft.length}/1500</span></div></div>
                </>
              ) : (
                <div className="flex min-h-[540px] items-center justify-center p-6 text-sm text-muted-foreground">暂无 Topic 数据。</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </motion.div>
  );
};

export default InterviewReviewPage;
