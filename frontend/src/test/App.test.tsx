import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import App from "../App";
import { useRuntimeSettingsStore } from "../store/runtimeSettingsStore";
import { useQuestionBankStore } from "../store/questionBankStore";
import { useResumeStore } from "../store/resumeStore";
import { useOptimizationStore } from "../store/optimizationStore";
import { useMockInterviewStore } from "../store/mockInterviewStore";
import { useSessionStore, useThemeStore } from "../store/sessionStore";

const pageDoubles = vi.hoisted(() => ({
  resume: vi.fn(() => <div>Resume Page</div>),
  diagnosis: vi.fn(() => <div>Diagnosis Page</div>),
  questionBank: vi.fn(() => <div>Question Bank Page</div>),
  mockInterview: vi.fn(() => <div>Mock Interview Page</div>),
  interviewReview: vi.fn(() => <div>Interview Review Page</div>),
}));

vi.mock("../pages/ResumePage", () => ({
  default: pageDoubles.resume,
}));
vi.mock("../pages/DiagnosisPage", () => ({
  default: pageDoubles.diagnosis,
}));
vi.mock("../pages/QuestionBankPage", () => ({
  default: pageDoubles.questionBank,
}));
vi.mock("../pages/MockInterviewPage", () => ({
  default: pageDoubles.mockInterview,
}));
vi.mock("../pages/InterviewReviewPage", () => ({
  default: pageDoubles.interviewReview,
}));

const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query === "(max-width: 767px)" ? false : false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

vi.stubGlobal("matchMedia", mockMatchMedia);
vi.stubGlobal(
  "fetch",
  vi.fn(async () =>
    new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
);

const renderApp = (initialEntries = ["/resume"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>
  );

const resetPageDoubles = () => {
  pageDoubles.resume.mockReset();
  pageDoubles.resume.mockImplementation(() => <div>Resume Page</div>);
  pageDoubles.diagnosis.mockReset();
  pageDoubles.diagnosis.mockImplementation(() => <div>Diagnosis Page</div>);
  pageDoubles.questionBank.mockReset();
  pageDoubles.questionBank.mockImplementation(() => <div>Question Bank Page</div>);
  pageDoubles.mockInterview.mockReset();
  pageDoubles.mockInterview.mockImplementation(() => <div>Mock Interview Page</div>);
  pageDoubles.interviewReview.mockReset();
  pageDoubles.interviewReview.mockImplementation(() => <div>Interview Review Page</div>);
};

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

describe("App runtime settings", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetPageDoubles();

    useRuntimeSettingsStore.setState({
      modelProvider: "",
      apiKey: "",
      baseURL: "",
      model: "",
      ocrApiKey: "",
      speechAppKey: "",
      speechAccessKey: "",
    });
    useQuestionBankStore.setState({ selectedId: null, neighbors: null });
    useResumeStore.setState({
      parsedResume: null,
      parseMeta: null,
      parseStatus: "idle",
      parseError: null,
    });
    useOptimizationStore.setState({
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
    });
    useMockInterviewStore.setState({
      sessionId: null,
      resumeFingerprint: null,
      expiresAt: null,
      lastActiveAt: null,
      status: "idle",
      messages: [],
      streamingMessageId: null,
      pendingAssistantPhase: "idle",
      selectedInterviewType: "",
      selectedCategory: "",
      limits: null,
      interviewPlan: null,
      interviewState: null,
      retrieval: null,
      draftMessage: "",
      startedAtMs: null,
      error: null,
      creatingStep: "idle",
      developerContext: null,
      developerTrace: [],
    });
    useSessionStore.setState({
      resumeFile: null,
      resumeText: "",
      jdText: "",
      theme: "system",
    });
    useThemeStore.setState({ theme: "system" });
  });

  it("opens and closes the runtime settings overlay with grouped fields", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("Resume Page");
    await user.click(screen.getAllByRole("button", { name: /运行时设置/i })[0]);

    expect(await screen.findByRole("dialog", { name: "运行时设置" })).toBeInTheDocument();
    expect(screen.getByText("能力与状态")).toBeInTheDocument();
    expect(screen.getAllByText("自定义 LLM API").length).toBeGreaterThan(0);
    expect(screen.getAllByText("高精度简历 OCR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("模拟面试语音输入").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("GLM OCR API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Doubao App Key")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "运行时设置" })).not.toBeInTheDocument();
    });
  });

  it("updates trigger summary and status badges as runtime config changes", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("Resume Page");
    expect(screen.getAllByRole("button", { name: /运行时设置/i })[0]).toHaveTextContent("默认");

    await user.click(screen.getAllByRole("button", { name: /运行时设置/i })[0]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "anthropic");

    expect(screen.getAllByText("1 项已启用").length).toBeGreaterThan(0);
    expect(screen.getAllByText("自定义 LLM API").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已启用").length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("GLM OCR API Key"), "glm-key");
    expect(screen.getAllByText("2 项已启用").length).toBeGreaterThan(0);
  });

  it("clears all runtime settings from the overlay", async () => {
    const user = userEvent.setup();
    useRuntimeSettingsStore.setState({
      modelProvider: "openai",
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      model: "gpt-test",
      ocrApiKey: "ocr-key",
      speechAppKey: "app-key",
      speechAccessKey: "access-key",
    });

    renderApp();

    await screen.findByText("Resume Page");
    await user.click(screen.getAllByRole("button", { name: /运行时设置/i })[0]);
    expect(await screen.findByRole("dialog", { name: "运行时设置" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空全部配置" }));

    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue("openai");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("GLM OCR API Key")).toHaveValue("");
    expect(screen.getByLabelText("Doubao App Key")).toHaveValue("");
    expect(screen.getAllByText("默认").length).toBeGreaterThan(0);
  });

  it("renders question bank page on root route and highlights its nav item first", async () => {
    renderApp(["/"]);

    expect(await screen.findByText("Question Bank Page")).toBeInTheDocument();

    const navLinks = screen.getAllByRole("link");
    expect(navLinks[0]).toHaveTextContent("面经题库");
    expect(screen.getByRole("link", { name: "面经题库" })).toHaveClass("bg-accent");
    expect(screen.getByRole("link", { name: "简历解析" })).not.toHaveClass("bg-accent");
  });

  it("renders the FaceTomato brand name in the desktop and mobile headers", async () => {
    renderApp();

    await screen.findByText("Resume Page");

    expect(screen.getAllByText("FaceTomato 面柿")).toHaveLength(2);
  });

  it("shows a route fallback when a sidebar navigation suspends", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    let diagnosisReady = false;

    pageDoubles.diagnosis.mockImplementation(() => {
      if (!diagnosisReady) {
        throw deferred.promise;
      }

      return <div>Diagnosis Page</div>;
    });

    renderApp();

    await screen.findByText("Resume Page");
    await user.click(screen.getByRole("link", { name: "简历优化" }));

    expect(await screen.findByRole("status")).toHaveTextContent("页面加载中");

    diagnosisReady = true;
    deferred.resolve();

    expect(await screen.findByText("Diagnosis Page")).toBeInTheDocument();
  });
});
