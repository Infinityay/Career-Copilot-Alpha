import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JDData, RuntimeConfig } from "@/lib/api";
import { buildMockInterviewTranscriptMarkdown } from "@/lib/mockInterviewDeveloperReport";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import MockInterviewPage from "../MockInterviewPage";
import { useResumeStore } from "@/store/resumeStore";
import { useOptimizationStore } from "@/store/optimizationStore";
import { useMockInterviewStore } from "@/store/mockInterviewStore";
import { useQuestionBankStore } from "@/store/questionBankStore";
import { useRuntimeSettingsStore } from "@/store/runtimeSettingsStore";
import type { ResumeData } from "@/types/resume";
import type { MockInterviewPlan, MockInterviewRetrievalItem, MockInterviewRetrievalResult, MockInterviewState } from "@/types/mockInterview";
import type { InterviewData } from "@/types/interview";

const mockResume: ResumeData = {
  basicInfo: {
    name: "测试用户",
    personalEmail: "test@example.com",
    phoneNumber: "13800138000",
    age: "22",
    born: "2004-01",
    gender: "男",
    desiredPosition: "前端开发",
    desiredLocation: ["上海"],
    currentLocation: "上海",
    placeOfOrigin: "江苏",
    rewards: [],
  },
  workExperience: [],
  education: [],
  projects: [],
  academicAchievements: [],
};

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({
  matches: false,
  media: "",
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})));

const defaultLimits = {
  durationMinutes: 60,
  softInputChars: 1200,
  maxInputChars: 1500,
  contextWindowMessages: 8,
  sessionTtlMinutes: 90,
};

const defaultRetrievalItem: MockInterviewRetrievalItem = {
  interviewId: 11,
  title: "阿里前端一面",
  company: "阿里巴巴",
  category: "前端开发",
  interviewType: "校招",
  stage: "一面",
  publishTime: "2024-10-01 10:00:00",
  snippet: "React 和工程化",
  score: 1.11,
  reason: "公司：阿里巴巴",
};

const defaultRetrieval: MockInterviewRetrievalResult = {
  queryText: "前端开发\n校招\nReact",
  appliedFilters: {
    category: "前端开发",
    interviewType: "校招",
    company: "阿里",
  },
  items: [defaultRetrievalItem],
};

const defaultJdData: JDData = {
  basicInfo: {
    jobTitle: "前端开发工程师",
    jobType: "全职",
    location: "上海",
    company: "阿里巴巴",
    department: "前端",
    updateTime: "",
  },
  requirements: {
    degree: "",
    experience: "",
    techStack: ["React", "TypeScript"],
    mustHave: ["前端工程化"],
    niceToHave: [],
    jobDuties: ["负责前端业务开发"],
  },
};

const defaultPlan: MockInterviewPlan = {
  plan: [
    { round: 1, topic: "开场介绍", description: "自我介绍与岗位动机。" },
    { round: 2, topic: "项目概述", description: "整体介绍最相关项目。" },
    { round: 3, topic: "技术深挖", description: "围绕关键技术决策和难点持续深挖。" },
    { round: 4, topic: "LeetCode 编码", description: "围绕指定代码题考察算法与实现能力。" },
  ],
  total_rounds: 4,
  estimated_duration: "45-60分钟",
  leetcode_problem: "实现一个 LRU Cache",
};

const defaultState: MockInterviewState = {
  currentRound: 1,
  questionsPerRound: { "1": 0 },
  assistantQuestionCount: 0,
  turnCount: 0,
  reflectionHistory: [],
  closed: false,
};

const defaultDeveloperContext = {
  sessionMode: "frontend_local_only" as const,
  privacyMode: "frontend_local_export_only" as const,
  ragEnabled: true,
  transcriptPersistence: "frontend_local_only" as const,
  tracePersistence: "frontend_local_only" as const,
};

const defaultDeveloperTrace = {
  type: "retrieval" as const,
  createdAt: "2026-03-17T10:00:00.000Z",
  payload: {
    queryText: "前端开发\n校招\nReact",
    filterChain: [defaultRetrieval.appliedFilters],
    appliedFilters: defaultRetrieval.appliedFilters,
    candidateTopk: 20,
    topk: 5,
    denseWeight: 0.6,
    sparseWeight: 0.4,
    ragEnabled: true,
    resultItems: defaultRetrieval.items,
    elapsedMs: 12,
  },
};

const defaultInterviewDetail: InterviewData = {
  id: 11,
  title: "阿里前端一面",
  content: "这里是完整面经内容\n包含 React 与工程化细节。",
  publish_time: "2024-10-01 10:00:00",
  category: "前端开发",
  company: "阿里巴巴",
  department: "前端架构",
  stage: "一面",
  result: "offer",
  interview_type: "校招",
};

function buildRetrievalItem(index: number, overrides: Partial<MockInterviewRetrievalItem> = {}): MockInterviewRetrievalItem {
  return {
    ...defaultRetrievalItem,
    interviewId: 100 + index,
    title: `面经 ${index}`,
    company: `公司 ${index}`,
    stage: `${index} 面`,
    snippet: `摘要 ${index}`,
    score: Number((1 + index / 100).toFixed(2)),
    ...overrides,
  };
}

function buildRetrieval(items: MockInterviewRetrievalItem[]): MockInterviewRetrievalResult {
  return {
    ...defaultRetrieval,
    items,
  };
}

function makeReadySession(overrides: Partial<ReturnType<typeof useMockInterviewStore.getState>> = {}): Partial<ReturnType<typeof useMockInterviewStore.getState>> {
  return {
    sessionId: "session-1",
    status: "ready" as const,
    limits: defaultLimits,
    startedAtMs: Date.now(),
    selectedInterviewType: "校招" as const,
    selectedCategory: "前端开发" as const,
    resumeFingerprint: "fp-test",
    expiresAt: "2099-03-16T12:00:00.000Z",
    interviewPlan: defaultPlan,
    interviewState: {
      ...defaultState,
      assistantQuestionCount: 1,
    },
    retrieval: defaultRetrieval,
    developerContext: defaultDeveloperContext,
    developerTrace: [defaultDeveloperTrace],
    messages: [{ id: "assistant-1", role: "assistant" as const, content: "你好，请先做自我介绍。" }],
    ...overrides,
  };
}

function createSseStream(events: Array<{ event: string; data: unknown }>, chunkWaits?: Array<number | Promise<void>>) {
  const encoder = new TextEncoder();
  const chunks = events.map((item) => encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`));

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [index, chunk] of chunks.entries()) {
        const wait = chunkWaits?.[index] ?? 0;
        if (typeof wait === "number") {
          if (wait > 0) {
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        } else {
          await wait;
        }
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function mockInterviewApis(options?: {
  delayedSession?: boolean;
  interviewDetail?: InterviewData;
  jdData?: JDData;
  jdExtractError?: string;
  jdExtractDelayMs?: number;
  sessionError?: string;
  sessionDelayMs?: number;
  doneStatus?: "ready" | "completed";
  replyTransitionsRound?: number | null;
  replyMessageStartDelayMs?: number;
  replyMessageDeltaDelayMs?: number;
  replyErrorAfterAnalysis?: string;
  onReplyAnalysisEvent?: () => void;
}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("/api/speech/status")) {
      return Promise.resolve(Response.json({ available: false }));
    }

    if (/\/api\/interviews\/\d+$/.test(url)) {
      return Promise.resolve(Response.json(options?.interviewDetail ?? defaultInterviewDetail));
    }

    if (url.includes("/api/jd/extract")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const response = options?.jdExtractError
        ? Response.json({ detail: options.jdExtractError }, { status: 400 })
        : Response.json({ data: body.runtimeConfig ? options?.jdData ?? defaultJdData : options?.jdData ?? defaultJdData });

      if (options?.jdExtractDelayMs) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(response), options.jdExtractDelayMs);
        });
      }

      return Promise.resolve(response);
    }

    if (url.includes("/api/mock-interview/session/stream-create")) {
      if (options?.sessionError) {
        return Promise.resolve(
          new Response(createSseStream([{ event: "error", data: { message: options.sessionError, status: 400 } }]), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
        );
      }

      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return Promise.resolve(
        new Response(
          createSseStream(
            [
              { event: "progress", data: { stage: "retrieving_evidence", message: "正在检索相关面经" } },
              { event: "developer_trace", data: defaultDeveloperTrace },
              { event: "progress", data: { stage: "generating_plan", message: "正在生成面试计划" } },
              {
                event: "session_created",
                data: {
                  sessionId: "session-1",
                  interviewType: "校招",
                  category: "前端开发",
                  status: "ready",
                  limits: defaultLimits,
                  interviewPlan: defaultPlan,
                  interviewState: defaultState,
                  jdData: body.jdText ? options?.jdData ?? defaultJdData : null,
                  retrieval: defaultRetrieval,
                  resumeFingerprint: "fp-test",
                  expiresAt: "2026-03-16T12:00:00.000Z",
                  developerContext: defaultDeveloperContext,
                },
              },
              { event: "done", data: { sessionId: "session-1", status: "ready" } },
            ],
            [options?.sessionDelayMs ?? 0, options?.sessionDelayMs ?? 0, options?.sessionDelayMs ?? 0, options?.sessionDelayMs ?? 0, 0]
          ),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
      );
    }

    if (url.includes("/api/mock-interview/session/") && url.includes("/stream")) {
      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      const isReply = requestBody.mode === "reply";
      const shouldTransition = isReply && options?.replyTransitionsRound != null;
      const nextRound = shouldTransition ? options.replyTransitionsRound! : requestBody.interviewState.currentRound;
      const userTurnCount = isReply ? requestBody.interviewState.turnCount + 1 : requestBody.interviewState.turnCount;
      const assistantQuestionCount = (requestBody.interviewState.assistantQuestionCount ?? 0) + 1;
      const currentRoundKey = String(nextRound);
      const currentRoundQuestionCount = (requestBody.interviewState.questionsPerRound?.[currentRoundKey] ?? 0) + 1;
      const nextState: MockInterviewState = {
        currentRound: nextRound,
        questionsPerRound: {
          ...(requestBody.interviewState.questionsPerRound ?? {}),
          [currentRoundKey]: currentRoundQuestionCount,
        },
        assistantQuestionCount,
        turnCount: userTurnCount,
        reflectionHistory: isReply
          ? [
              ...(requestBody.interviewState.reflectionHistory ?? []),
              {
                depth_score: 4,
                authenticity_score: 4,
                completeness_score: 4,
                logic_score: 4,
                overall_assessment: "回答较完整，可以继续。",
                should_continue: !shouldTransition,
                suggested_follow_up: shouldTransition ? "" : "请补充更多技术细节。",
                reason: shouldTransition ? "当前轮次完成。" : "还有可追问空间。",
              },
            ]
          : requestBody.interviewState.reflectionHistory ?? [],
        closed: options?.doneStatus === "completed",
      };
      const assistantText = isReply ? "继续说说你在这个项目里的技术取舍。" : "你好，请先做自我介绍。";
      const assistantMessageId = isReply ? "assistant-2" : "assistant-1";
      const replyPrelude = isReply
        ? [
            { event: "user_message", data: { id: "user-1", role: "user", content: requestBody.message } },
            { event: "answer_analysis_started", data: { stage: "analyzing_answer", message: "正在分析你的回答" } },
            {
              event: "reflection_result",
              data: {
                depth_score: 4,
                authenticity_score: 4,
                completeness_score: 4,
                logic_score: 4,
                overall_assessment: "回答较完整，可以继续。",
                should_continue: !shouldTransition,
                suggested_follow_up: shouldTransition ? "" : "请补充更多技术细节。",
                reason: shouldTransition ? "当前轮次完成。" : "还有可追问空间。",
              },
            },
            {
              event: "developer_trace",
              data: {
                type: "reflection",
                createdAt: "2026-03-17T10:01:00.000Z",
                payload: {
                  promptKey: "reflection",
                  candidateAnswer: requestBody.message,
                  currentRoundHistory: "面试官: 请介绍一下项目。",
                  questionCount: requestBody.interviewState.questionsPerRound?.[String(requestBody.interviewState.currentRound)] ?? 0,
                  output: {
                    depth_score: 4,
                    authenticity_score: 4,
                    completeness_score: 4,
                    logic_score: 4,
                    overall_assessment: "回答较完整，可以继续。",
                    should_continue: !shouldTransition,
                    suggested_follow_up: shouldTransition ? "" : "请补充更多技术细节。",
                    reason: shouldTransition ? "当前轮次完成。" : "还有可追问空间。",
                  },
                  fallbackUsed: false,
                  elapsedMs: 7,
                },
              },
            },
            ...(shouldTransition
              ? [{ event: "round_transition", data: { from_round: requestBody.interviewState.currentRound, to_round: nextRound, topic: defaultPlan.plan[nextRound - 1].topic } }]
              : []),
          ]
        : [];
      const replyErrorEvents = isReply && options?.replyErrorAfterAnalysis
        ? [{ event: "error", data: { message: options.replyErrorAfterAnalysis, status: 500 } }]
        : [];
      const assistantEvents = options?.replyErrorAfterAnalysis && isReply
        ? []
        : [
            { event: "message_start", data: { messageId: assistantMessageId, role: "assistant" } },
            { event: "message_delta", data: { messageId: assistantMessageId, delta: assistantText } },
            {
              event: "message_end",
              data: {
                messageId: assistantMessageId,
                content: assistantText,
                interviewState: nextState,
                elapsedMs: 12,
              },
            },
            {
              event: "developer_trace",
              data: {
                type: "interviewer_generation",
                createdAt: "2026-03-17T10:02:00.000Z",
                payload: {
                  promptKey: "interviewer",
                  round: nextState.currentRound,
                  topic: defaultPlan.plan[nextState.currentRound - 1].topic,
                  suggestedFollowUp: shouldTransition ? "" : "请补充更多技术细节。",
                  closeInterview: options?.doneStatus === "completed",
                  recentConversation: [],
                  finalMessage: assistantText,
                  elapsedMs: 12,
                },
              },
            },
            {
              event: "done",
              data: {
                sessionId: "session-1",
                status: options?.doneStatus ?? "ready",
                interviewState: nextState,
              },
            },
          ];
      const events = [...replyPrelude, ...replyErrorEvents, ...assistantEvents];
      const analysisPause =
        isReply && options?.onReplyAnalysisEvent
          ? Promise.resolve().then(() => {
              options.onReplyAnalysisEvent?.();
            })
          : null;
      const waits = events.map((item) => {
        if (item.event === "answer_analysis_started" && isReply) {
          return 0;
        }
        if (item.event === "message_start" && isReply) {
          return analysisPause ?? (options?.replyMessageStartDelayMs ?? 0);
        }
        if (item.event === "message_delta" && isReply) {
          return options?.replyMessageDeltaDelayMs ?? 0;
        }
        return 0;
      });
      return Promise.resolve(
        new Response(
          createSseStream(events, waits),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
      );
    }

    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname}</div>;
}

function renderPage(initialPath: string = "/interview") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/interview"
          element={(
            <>
              <LocationDisplay />
              <MockInterviewPage />
            </>
          )}
        />
        <Route
          path="/resume"
          element={(
            <>
              <LocationDisplay />
              <div>Resume Page</div>
            </>
          )}
        />
      </Routes>
    </MemoryRouter>
  );
}

const RECOVERABLE_SESSIONS_KEY = "face-tamato-mock-interview-recoverable-sessions";
const LEGACY_RECOVERABLE_SESSIONS_KEY = RECOVERABLE_SESSIONS_KEY;

const getLatestSpeechStatusUrl = () => {
  const speechCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/speech/status"));
  return speechCalls[speechCalls.length - 1]?.[0];
};

describe("MockInterviewPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    fetchMock.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    useResumeStore.persist.clearStorage();
    useOptimizationStore.persist.clearStorage();
    useMockInterviewStore.persist.clearStorage();
    useRuntimeSettingsStore.persist.clearStorage();
    useRuntimeSettingsStore.getState().clearRuntimeConfig();
    fetchMock.mockResolvedValue(Response.json({ available: false }));

    useResumeStore.setState({
      parsedResume: null,
      parseStatus: "idle",
      parseError: null,
    });

    useOptimizationStore.getState().reset();
    useMockInterviewStore.getState().resetSession();
    useQuestionBankStore.setState({
      selectedId: null,
      neighbors: null,
      detailLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays on mock interview page and shows resume prompt when parsed resume is missing", () => {
    renderPage();

    expect(screen.getByTestId("location-display")).toHaveTextContent("/interview");
    expect(screen.getByText("请先上传简历")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前往简历解析" })).toBeInTheDocument();
    expect(screen.queryByText("Resume Page")).not.toBeInTheDocument();
  });

  it("shows shared resume parsing state when resume parsing is in progress", () => {
    useResumeStore.setState({ parsedResume: null, parseStatus: "parsing", parseError: null });

    renderPage();

    expect(screen.getByText("正在解析简历")).toBeInTheDocument();
    expect(screen.getByText("请稍候，系统正在提取并结构化您的简历内容")).toBeInTheDocument();
  });

  it("navigates to resume page only after clicking the resume prompt action", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "前往简历解析" }));

    expect(screen.getByTestId("location-display")).toHaveTextContent("/resume");
    expect(screen.getByText("Resume Page")).toBeInTheDocument();
  });

  it("renders two centered dropdowns and keeps start button disabled until selections are done", async () => {
    const user = userEvent.setup();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });

    renderPage();

    expect(screen.getByRole("combobox", { name: "面试岗位类型" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "面试岗位领域" })).toBeInTheDocument();

    const startButton = screen.getByRole("button", { name: "开始模拟面试" });
    expect(startButton).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    expect(startButton).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    expect(startButton).toBeEnabled();
  });

  it("parses JD before streaming session creation when jdText exists but jdData is missing", async () => {
    const user = userEvent.setup();
    mockInterviewApis();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useOptimizationStore.setState({ jdText: "已有 JD 内容", jdData: null });
    useRuntimeSettingsStore.getState().setRuntimeConfig({
      modelProvider: "anthropic",
      apiKey: "sk-test",
      baseURL: "https://custom.example/v1",
      model: "gpt-4o",
    });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));

    await screen.findByRole("heading", { name: "模拟面试对话" });
    const jdExtractCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/jd/extract"));
    const createSessionCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/mock-interview/session/stream-create"));

    expect(jdExtractCall).toBeTruthy();
    expect(createSessionCall).toBeTruthy();
    expect(JSON.parse(String(jdExtractCall?.[1]?.body)).runtimeConfig).toEqual({
      modelProvider: "anthropic",
      apiKey: "sk-test",
      baseURL: "https://custom.example/v1",
      model: "gpt-4o",
    });
    expect(JSON.parse(String(createSessionCall?.[1]?.body)).jdData).toEqual(defaultJdData);
    expect(JSON.parse(String(createSessionCall?.[1]?.body)).runtimeConfig).toEqual({
      modelProvider: "anthropic",
      apiKey: "sk-test",
      baseURL: "https://custom.example/v1",
      model: "gpt-4o",
    });
    expect(screen.queryByRole("dialog", { name: "请先填写岗位 JD" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "面试岗位类型" })).not.toBeInTheDocument();
    expect(screen.getByText("你好，请先做自我介绍。", { exact: false })).toBeInTheDocument();
  });

  it("opens JD modal when JD is missing", async () => {
    const user = userEvent.setup();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));

    const dialog = screen.getByRole("dialog", { name: "请先填写岗位 JD" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("模拟面试必须先解析岗位 JD 信息，才能生成更贴近目标岗位的面试计划。")).toBeInTheDocument();
  });

  it("requires JD before starting interview and does not create session directly", async () => {
    const user = userEvent.setup();
    mockInterviewApis();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));

    expect(screen.getByRole("dialog", { name: "请先填写岗位 JD" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => /\/api\/mock-interview\/session$/.test(String(url)))).toBe(false);
  });

  it("saves JD and continues interview", async () => {
    const user = userEvent.setup();
    mockInterviewApis();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));
    await user.type(screen.getByLabelText("岗位 JD 内容"), "阿里前端开发，熟悉 React 和 TypeScript");
    await user.click(screen.getByRole("button", { name: "保存 JD 并开始" }));

    expect(await screen.findByRole("heading", { name: "模拟面试对话" })).toBeInTheDocument();
  });

  it("shows creation loading state before the first interview stream", async () => {
    const user = userEvent.setup();
    mockInterviewApis({ sessionDelayMs: 80 });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useOptimizationStore.setState({ jdText: "阿里前端开发，熟悉 React 和 TypeScript", jdData: defaultJdData });
    useMockInterviewStore.setState({ developerContext: { ...defaultDeveloperContext, ragEnabled: false } as never });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));

    expect(await screen.findByText("正在准备面试上下文")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "模拟面试对话" })).toBeInTheDocument();
  });

  it("syncs parsed jdData back into optimization store for later reuse", async () => {
    const user = userEvent.setup();
    mockInterviewApis();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));
    await user.type(screen.getByLabelText("岗位 JD 内容"), "阿里前端开发，熟悉 React 和 TypeScript");
    await user.click(screen.getByRole("button", { name: "保存 JD 并开始" }));

    await screen.findByRole("heading", { name: "模拟面试对话" });
    expect(useOptimizationStore.getState().jdText).toBe("阿里前端开发，熟悉 React 和 TypeScript");
    expect(useOptimizationStore.getState().jdData?.basicInfo.company).toBe("阿里巴巴");
  });

  it("only refreshes speech status when speech runtime keys change", async () => {
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useOptimizationStore.setState({ jdText: "已有 JD 内容", jdData: defaultJdData });

    renderPage();

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/speech/status"))).toBe(true);
    });

    const initialCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/speech/status")).length;

    useRuntimeSettingsStore.getState().setRuntimeConfig({
      modelProvider: "anthropic",
      apiKey: "sk-test",
      model: "claude-sonnet-4-6",
    } satisfies RuntimeConfig);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/speech/status")).length).toBe(initialCalls);
    });

    useRuntimeSettingsStore.getState().setSpeechAppKey("speech-app");

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/speech/status")).length).toBe(initialCalls + 1);
    });
    expect(String(getLatestSpeechStatusUrl())).toContain("runtime_speech_app_key=speech-app");
    expect(String(getLatestSpeechStatusUrl())).not.toContain("runtime_speech_access_key=");

    useRuntimeSettingsStore.getState().setSpeechAccessKey("speech-access");

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/speech/status")).length).toBe(initialCalls + 2);
    });
    expect(String(getLatestSpeechStatusUrl())).toContain("runtime_speech_app_key=speech-app");
    expect(String(getLatestSpeechStatusUrl())).toContain("runtime_speech_access_key=speech-access");
  });

  it("shows round header and keeps plan details collapsed by default", () => {
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useMockInterviewStore.setState(makeReadySession());

    renderPage();

    expect(screen.getByText("第 1 / 4 轮")).toBeInTheDocument();
    expect(screen.getByText("当前主题 开场介绍")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "面试轮次" })).toBeInTheDocument();
    expect(screen.queryByText("整体介绍最相关项目。")).not.toBeInTheDocument();
  });

  it("expands compact retrieval panel and shows at most five content previews without score", async () => {
    const user = userEvent.setup();
    mockInterviewApis({
      interviewDetail: {
        ...defaultInterviewDetail,
        content: "12345678901234567890后面还有更多内容",
      },
    });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useMockInterviewStore.setState(
      makeReadySession({
        retrieval: buildRetrieval(Array.from({ length: 6 }, (_, index) => buildRetrievalItem(index + 1))),
      })
    );

    renderPage();

    await user.click(screen.getByRole("button", { name: "参考面经 6" }));

    const panel = await screen.findByRole("dialog", { name: "参考面经列表" });
    expect(within(panel).getByText("面经 5")).toBeInTheDocument();
    expect(within(panel).queryByText("面经 6")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(panel).getAllByText("12345678901234567890...").length).toBeGreaterThan(0);
    });
    expect(within(panel).queryByText("1.01")).not.toBeInTheDocument();
  });

  it("opens interview detail when clicking a retrieval summary and supports closing", async () => {
    const user = userEvent.setup();
    mockInterviewApis();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useMockInterviewStore.setState(makeReadySession());

    renderPage();

    await user.click(screen.getByRole("button", { name: "参考面经 1" }));
    await user.click(screen.getByRole("button", { name: /查看面经：阿里前端一面/ }));

    expect(await screen.findByRole("heading", { name: "阿里前端一面" })).toBeInTheDocument();
    expect(screen.getByText("这里是完整面经内容")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回列表" }));

    await waitFor(() => {
      expect(screen.queryByText("这里是完整面经内容")).not.toBeInTheDocument();
    });
  });

  it("submits answer when pressing Enter in composer and updates round state from canonical payload", async () => {
    const user = userEvent.setup();
    mockInterviewApis({ replyTransitionsRound: 2 });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useOptimizationStore.setState({ jdText: "已有 JD 内容", jdData: defaultJdData });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));

    const textbox = await screen.findByPlaceholderText("输入你的回答...");
    await user.type(textbox, "我主要负责前端性能优化{enter}");

    expect(await screen.findByText("我主要负责前端性能优化")).toBeInTheDocument();
    expect(await screen.findByText("继续说说你在这个项目里的技术取舍。", { exact: false })).toBeInTheDocument();
    expect(await screen.findByText("第 2 / 4 轮")).toBeInTheDocument();
    expect(screen.getByText("当前主题 项目概述")).toBeInTheDocument();
  });

  it("shows analyzing then typing placeholders during reply streaming", async () => {
    const user = userEvent.setup();
    mockInterviewApis({
      replyMessageDeltaDelayMs: 80,
    });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useMockInterviewStore.setState(makeReadySession());
    useOptimizationStore.setState({ jdText: "已有 JD 内容", jdData: defaultJdData });

    const originalFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("/api/mock-interview/session/") || !url.includes("/stream")) {
        return originalFetch?.(input, init) as ReturnType<typeof fetch>;
      }

      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      const nextState: MockInterviewState = {
        currentRound: requestBody.interviewState.currentRound,
        questionsPerRound: {
          ...(requestBody.interviewState.questionsPerRound ?? {}),
          [String(requestBody.interviewState.currentRound)]:
            (requestBody.interviewState.questionsPerRound?.[String(requestBody.interviewState.currentRound)] ?? 0) + 1,
        },
        assistantQuestionCount: (requestBody.interviewState.assistantQuestionCount ?? 0) + 1,
        turnCount: requestBody.interviewState.turnCount + 1,
        reflectionHistory: [
          ...(requestBody.interviewState.reflectionHistory ?? []),
          {
            depth_score: 4,
            authenticity_score: 4,
            completeness_score: 4,
            logic_score: 4,
            overall_assessment: "回答较完整，可以继续。",
            should_continue: true,
            suggested_follow_up: "请补充更多技术细节。",
            reason: "还有可追问空间。",
          },
        ],
        closed: false,
      };

      return Promise.resolve(
        new Response(
          createSseStream(
            [
              { event: "user_message", data: { id: "user-1", role: "user", content: requestBody.message } },
              { event: "answer_analysis_started", data: { stage: "analyzing_answer", message: "正在分析你的回答" } },
              {
                event: "reflection_result",
                data: {
                  depth_score: 4,
                  authenticity_score: 4,
                  completeness_score: 4,
                  logic_score: 4,
                  overall_assessment: "回答较完整，可以继续。",
                  should_continue: true,
                  suggested_follow_up: "请补充更多技术细节。",
                  reason: "还有可追问空间。",
                },
              },
              {
                event: "developer_trace",
                data: {
                  type: "reflection",
                  createdAt: "2026-03-17T10:01:00.000Z",
                  payload: {
                    promptKey: "reflection",
                    candidateAnswer: requestBody.message,
                    currentRoundHistory: "面试官: 请介绍一下项目。",
                    questionCount: requestBody.interviewState.questionsPerRound?.[String(requestBody.interviewState.currentRound)] ?? 0,
                    output: {
                      depth_score: 4,
                      authenticity_score: 4,
                      completeness_score: 4,
                      logic_score: 4,
                      overall_assessment: "回答较完整，可以继续。",
                      should_continue: true,
                      suggested_follow_up: "请补充更多技术细节。",
                      reason: "还有可追问空间。",
                    },
                    fallbackUsed: false,
                    elapsedMs: 7,
                  },
                },
              },
              { event: "message_start", data: { messageId: "assistant-2", role: "assistant" } },
              { event: "message_delta", data: { messageId: "assistant-2", delta: "继续说说你在这个项目里的技术取舍。" } },
              {
                event: "message_end",
                data: {
                  messageId: "assistant-2",
                  content: "继续说说你在这个项目里的技术取舍。",
                  interviewState: nextState,
                  elapsedMs: 12,
                },
              },
              {
                event: "developer_trace",
                data: {
                  type: "interviewer_generation",
                  createdAt: "2026-03-17T10:02:00.000Z",
                  payload: {
                    promptKey: "interviewer",
                    round: nextState.currentRound,
                    topic: defaultPlan.plan[nextState.currentRound - 1].topic,
                    suggestedFollowUp: "请补充更多技术细节。",
                    closeInterview: false,
                    recentConversation: [],
                    finalMessage: "继续说说你在这个项目里的技术取舍。",
                    elapsedMs: 12,
                  },
                },
              },
              {
                event: "done",
                data: {
                  sessionId: "session-1",
                  status: "ready",
                  interviewState: nextState,
                },
              },
            ],
            [0, 20, 120, 0, 0, 80, 0, 0, 0]
          ),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
      );
    });

    renderPage();

    const textbox = screen.getByPlaceholderText("输入你的回答...");
    await user.type(textbox, "这是我的补充回答{enter}");

    expect(await screen.findByText("这是我的补充回答")).toBeInTheDocument();
    expect(await screen.findByText("正在分析你的回答")).toBeInTheDocument();
    await waitFor(() => {
      const state = useMockInterviewStore.getState();
      expect(state.pendingAssistantPhase).toBe("idle");
      expect(state.streamingMessageId).toBe("assistant-2");
    });
    expect(await screen.findByText("正在输入")).toBeInTheDocument();
    expect(await screen.findByText("继续说说你在这个项目里的技术取舍。", { exact: false })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("正在输入")).not.toBeInTheDocument();
    });
  });

  it("clears analyzing placeholder when reply stream fails before message start", async () => {
    const user = userEvent.setup();
    const originalFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("/api/mock-interview/session/") || !url.includes("/stream")) {
        return originalFetch?.(input, init) as ReturnType<typeof fetch>;
      }

      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      return Promise.resolve(
        new Response(
          createSseStream(
            [
              { event: "user_message", data: { id: "user-1", role: "user", content: requestBody.message } },
              { event: "answer_analysis_started", data: { stage: "analyzing_answer", message: "正在分析你的回答" } },
              { event: "error", data: { message: "模拟面试请求失败", status: 500 } },
            ],
            [0, 40, 120]
          ),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
      );
    });

    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useMockInterviewStore.setState(makeReadySession());
    useOptimizationStore.setState({ jdText: "已有 JD 内容", jdData: defaultJdData });

    renderPage();

    const textbox = screen.getByPlaceholderText("输入你的回答...");
    await user.type(textbox, "这是会失败的回答{enter}");

    expect(await screen.findByText("正在分析你的回答")).toBeInTheDocument();
    expect(await screen.findByText("模拟面试请求失败")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("正在分析你的回答")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("正在输入")).not.toBeInTheDocument();
  });

  it("disables composer after interview completion", async () => {
    const user = userEvent.setup();
    mockInterviewApis({ doneStatus: "completed" });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useOptimizationStore.setState({ jdText: "已有 JD 内容", jdData: defaultJdData });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));

    expect(await screen.findByText("本场模拟面试已结束，可重新开始新一场。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入你的回答...")).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出面试问答（Markdown）" })).toBeInTheDocument();
  });

  it("exports interview transcript markdown after completion", async () => {
    const user = userEvent.setup();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn<() => string>(() => "blob:mock-report");
    const revokeObjectURL = vi.fn<(url: string) => void>();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mockInterviewApis({ doneStatus: "completed" });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useOptimizationStore.setState({ jdText: "已有 JD 内容", jdData: defaultJdData });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));
    await user.click(await screen.findByRole("button", { name: "导出面试问答（Markdown）" }));

    expect(clickSpy).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    const snapshot = JSON.parse(localStorage.getItem(RECOVERABLE_SESSIONS_KEY) ?? "[]")[0].snapshot;
    const markdown = buildMockInterviewTranscriptMarkdown(snapshot);
    expect(markdown).toContain("# 本轮面试基础信息");
    expect(markdown).toContain("- 面试岗位：前端开发");
    expect(markdown).toContain("- 面试类型：校招");
    expect(markdown).toContain("- 导出时间：");
    expect(markdown).toContain("## 面试 JD");
    expect(markdown).toContain("已有 JD 内容");
    expect(markdown).toContain("## 面试对话");
    expect(markdown).toContain("```text");
    expect(markdown).toContain("面试官问\n你好，请先做自我介绍。");

    Object.defineProperty(URL, "createObjectURL", { value: originalCreateObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: originalRevokeObjectURL, configurable: true });
    clickSpy.mockRestore();
  });

  it("shows clear error when JD parsing fails", async () => {
    const user = userEvent.setup();
    mockInterviewApis({ jdExtractError: "JD 内容无法解析" });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));
    await user.type(screen.getByLabelText("岗位 JD 内容"), "无法解析的 JD");
    await user.click(screen.getByRole("button", { name: "保存 JD 并开始" }));

    expect(await screen.findByText("JD 解析失败，请检查内容后重试：JD 内容无法解析")).toBeInTheDocument();
  });

  it("shows clear error when session creation stream fails and stays on setup", async () => {
    const user = userEvent.setup();
    mockInterviewApis({ sessionError: "生成计划失败" });
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });

    renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位类型" }), "校招");
    await user.selectOptions(screen.getByRole("combobox", { name: "面试岗位领域" }), "前端开发");
    await user.click(screen.getByRole("button", { name: "开始模拟面试" }));
    await user.type(screen.getByLabelText("岗位 JD 内容"), "阿里前端开发，熟悉 React 和 TypeScript");
    await user.click(screen.getByRole("button", { name: "保存 JD 并开始" }));

    expect(await screen.findByText("面试计划生成失败，请稍后重试：生成计划失败")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "模拟面试对话" })).not.toBeInTheDocument();
  });

  it("restores unsent draft from persisted store after remount", async () => {
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useMockInterviewStore.setState(
      makeReadySession({
        draftMessage: "这是一段还没发送的草稿",
        selectedInterviewType: "校招",
        selectedCategory: "前端开发",
      })
    );

    const view = renderPage();

    expect(screen.getByDisplayValue("这是一段还没发送的草稿")).toBeInTheDocument();

    view.unmount();
    renderPage();

    expect(screen.getByDisplayValue("这是一段还没发送的草稿")).toBeInTheDocument();
  });

  it("restores canonical snapshot and clears invalid snapshot records", async () => {
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    localStorage.setItem(
      RECOVERABLE_SESSIONS_KEY,
      JSON.stringify([
        {
          snapshot: {
            snapshotVersion: 1,
            sessionId: "legacy-session",
            stage: "basic",
          },
        },
        {
          snapshot: {
            snapshotVersion: 2,
            sessionId: "session-1",
            interviewType: "校招",
            category: "前端开发",
            status: "ready",
            limits: defaultLimits,
            jdText: "已有 JD 内容",
            jdData: defaultJdData,
            resumeSnapshot: mockResume,
            retrieval: defaultRetrieval,
            interviewPlan: defaultPlan,
            interviewState: {
              ...defaultState,
              currentRound: 2,
              turnCount: 1,
            },
            messages: [{ id: "assistant-1", role: "assistant", content: "请介绍一下项目。" }],
            resumeFingerprint: "fp-test",
            createdAt: "2026-03-16T10:00:00.000Z",
            lastActiveAt: "2026-03-16T10:10:00.000Z",
            expiresAt: "2099-03-16T12:00:00.000Z",
            developerContext: null,
            developerTrace: [],
          },
        },
      ])
    );

    renderPage("/interview?session=session-1");

    expect(await screen.findByText("第 2 / 4 轮")).toBeInTheDocument();
    expect(screen.getByText("当前主题 项目概述")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(RECOVERABLE_SESSIONS_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].snapshot.sessionId).toBe("session-1");
    expect(stored[0].snapshot.snapshotVersion).toBe(3);
    expect(stored[0].snapshot.developerTrace).toEqual([]);
  });

  it("migrates recoverable sessions from legacy storage key", async () => {
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    localStorage.setItem(
      LEGACY_RECOVERABLE_SESSIONS_KEY,
      JSON.stringify([
        {
          snapshot: {
            snapshotVersion: 2,
            sessionId: "session-legacy-key",
            interviewType: "校招",
            category: "前端开发",
            status: "ready",
            limits: defaultLimits,
            jdText: "历史 JD 内容",
            jdData: defaultJdData,
            resumeSnapshot: mockResume,
            retrieval: defaultRetrieval,
            interviewPlan: defaultPlan,
            interviewState: {
              ...defaultState,
              currentRound: 3,
              turnCount: 2,
            },
            messages: [{ id: "assistant-1", role: "assistant", content: "继续说说性能优化。" }],
            resumeFingerprint: "fp-legacy",
            createdAt: "2026-03-16T10:00:00.000Z",
            lastActiveAt: "2026-03-16T10:15:00.000Z",
            expiresAt: "2099-03-16T12:00:00.000Z",
            developerContext: null,
            developerTrace: [],
          },
        },
      ])
    );

    renderPage("/interview?session=session-legacy-key");

    expect(await screen.findByText("第 3 / 4 轮")).toBeInTheDocument();
    const migrated = JSON.parse(localStorage.getItem(RECOVERABLE_SESSIONS_KEY) ?? "[]");
    expect(migrated).toHaveLength(1);
    expect(migrated[0].snapshot.sessionId).toBe("session-legacy-key");
    expect(migrated[0].snapshot.snapshotVersion).toBe(3);
    expect(JSON.parse(localStorage.getItem(LEGACY_RECOVERABLE_SESSIONS_KEY) ?? "[]")).toHaveLength(1);
  });

  it("clears draft when restarting", async () => {
    const user = userEvent.setup();
    useResumeStore.setState({ parsedResume: mockResume, parseStatus: "success" });
    useMockInterviewStore.setState(
      makeReadySession({
        draftMessage: "待清空草稿",
        interviewState: {
          ...defaultState,
          turnCount: 1,
        },
      })
    );

    renderPage();

    expect(screen.getByDisplayValue("待清空草稿")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新开始" }));
    await user.click(await screen.findByRole("button", { name: "确认重新开始" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "开始模拟面试" })).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("待清空草稿")).not.toBeInTheDocument();
  });
});
