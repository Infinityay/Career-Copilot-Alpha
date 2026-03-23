import { Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion as m } from "framer-motion";
import {
  BookOpen,
  ChevronDown,
  ClipboardList,
  FileText,
  GitCompare,
  Menu,
  Mic,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { Suspense, lazy, useState, useEffect, useRef, useCallback, type MouseEvent, type ReactNode } from "react";

import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
import { ThemeToggle } from "./components/ui/theme-toggle";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { cn } from "./lib/utils";
import { useRuntimeSettingsStore } from "./store/runtimeSettingsStore";
import { useThemeStore } from "./store/sessionStore";
import {
  MOCK_INTERVIEW_RECOVERY_EVENT,
  getPendingSessions,
  getRecoverableSessions,
  removeRecoverableSession,
  type PendingSessionRecord,
  type RecoverableSessionRecord,
} from "./lib/mockInterviewRecovery";
import type { RuntimeConfig, RuntimeModelProvider } from "./lib/api";

const ResumePage = lazy(() => import("./pages/ResumePage"));
const DiagnosisPage = lazy(() => import("./pages/DiagnosisPage"));
const QuestionBankPage = lazy(() => import("./pages/QuestionBankPage"));
const MockInterviewPage = lazy(() => import("./pages/MockInterviewPage"));
const InterviewReviewPage = lazy(() => import("./pages/InterviewReviewPage"));

type NavItem = {
  path: string;
  label: string;
  icon: typeof FileText;
  disabled?: boolean;
};

type RuntimeSettingsTriggerProps = {
  mobile?: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
};

type RuntimeSettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
};

type RuntimeSectionProps = {
  title: string;
  description: string;
  children: ReactNode;
};

type RuntimeStatus = {
  label: string;
  description: string;
  value: string;
  active: boolean;
  defaultAvailable?: boolean;
};

const creatingStepLabel: Record<string, string> = {
  retrieving_evidence: "正在检索相关面经...",
  generating_plan: "正在生成面试计划...",
  starting_interview: "正在初始化面试官...",
  idle: "正在创建模拟面试...",
};

const navItems: NavItem[] = [
  { path: "/resume", label: "简历解析", icon: FileText },
  { path: "/diagnosis", label: "简历优化", icon: GitCompare },
  { path: "/questions", label: "面经题库", icon: BookOpen },
  { path: "/interview", label: "模拟面试", icon: Mic },
  { path: "/interview-review", label: "面试报告", icon: ClipboardList },
];

const hasConfiguredValue = (value?: string | null) => Boolean(value?.trim());

const runtimeProviderOptions: Array<{ value: RuntimeModelProvider; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google_genai", label: "Gemini" },
];

const getRuntimeSettingsState = (config: RuntimeConfig) => {
  const customLlmEnabled = Boolean(
    hasConfiguredValue(config.modelProvider) ||
      hasConfiguredValue(config.apiKey) ||
      hasConfiguredValue(config.baseURL) ||
      hasConfiguredValue(config.model)
  );
  const ocrEnabled = hasConfiguredValue(config.ocrApiKey);
  const speechEnabled = Boolean(
    hasConfiguredValue(config.speechAppKey) || hasConfiguredValue(config.speechAccessKey)
  );
  const enabledCount = Number(customLlmEnabled) + Number(ocrEnabled) + Number(speechEnabled);

  return {
    customLlmEnabled,
    ocrEnabled,
    speechEnabled,
    enabledCount,
    summary: enabledCount === 0 ? "默认" : `${enabledCount} 项已启用`,
  };
};

const useThemeEffect = () => {
  const { theme } = useThemeStore();

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handler);
        return () => mediaQuery.removeEventListener("change", handler);
      }
      mediaQuery.addListener(handler);
      return () => mediaQuery.removeListener(handler);
    }

    applyTheme(theme === "dark");
  }, [theme]);
};

type SidebarProps = {
  mobile?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
  onOpenRuntimeSettings: (trigger: HTMLButtonElement) => void;
};

const RuntimeSection = ({ title, description, children }: RuntimeSectionProps) => (
  <Card className="border-border/70 bg-background/80 shadow-sm">
    <CardHeader className="pb-3">
      <CardTitle className="text-sm">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">{children}</CardContent>
  </Card>
);

const RuntimeSettingsOverlay = ({ open, onClose }: RuntimeSettingsOverlayProps) => {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const {
    modelProvider,
    apiKey,
    baseURL,
    model,
    ocrApiKey,
    speechAppKey,
    speechAccessKey,
    setModelProvider,
    setApiKey,
    setBaseURL,
    setModel,
    setOcrApiKey,
    setSpeechAppKey,
    setSpeechAccessKey,
    clearRuntimeConfig,
  } = useRuntimeSettingsStore();

  const runtimeState = getRuntimeSettingsState({
    modelProvider,
    apiKey,
    baseURL,
    model,
    ocrApiKey,
    speechAppKey,
    speechAccessKey,
  });

  const statusItems: RuntimeStatus[] = [
    {
      label: "后端默认 LLM API",
      description: "默认能力",
      value: "默认可用",
      active: true,
      defaultAvailable: true,
    },
    {
      label: "自定义 LLM API",
      description: "本地覆盖",
      value: runtimeState.customLlmEnabled ? "已启用" : "未启用",
      active: runtimeState.customLlmEnabled,
    },
    {
      label: "GLM OCR 高精度解析",
      description: "简历 OCR",
      value: runtimeState.ocrEnabled ? "已启用" : "未启用",
      active: runtimeState.ocrEnabled,
    },
    {
      label: "豆包语音输入",
      description: "模拟面试",
      value: runtimeState.speechEnabled ? "已启用" : "未启用",
      active: runtimeState.speechEnabled,
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end"
          role="dialog"
          aria-modal="true"
          aria-labelledby="runtime-settings-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/25 backdrop-blur-sm"
            onClick={onClose}
            aria-label="关闭运行时设置"
          />

          <m.div
            initial={isMobile ? { y: "100%" } : { x: "100%" }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: "100%" } : { x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            className={cn(
              "relative z-10 flex w-full flex-col overflow-hidden border bg-background shadow-2xl",
              isMobile
                ? "max-h-[min(92vh,48rem)] rounded-t-[1.75rem] border-x border-t"
                : "h-full max-w-[32rem] border-y-0 border-r-0 border-l"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            {isMobile && <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted" />}

            <Card className="flex h-full flex-col rounded-none border-0 bg-transparent shadow-none">
              <CardHeader className="gap-3 border-b bg-background/95 pb-4 backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Settings2 className="h-4 w-4 text-primary" />
                      <CardTitle id="runtime-settings-title" className="text-base">
                        运行时设置
                      </CardTitle>
                      <Badge variant={runtimeState.enabledCount === 0 ? "outline" : "secondary"}>
                        {runtimeState.summary}
                      </Badge>
                    </div>
                    <CardDescription>
                      默认使用服务端能力，可按需启用本地覆盖。
                    </CardDescription>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    aria-label="关闭运行时设置"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-4 overflow-y-auto p-4">
                <Card className="border-border/70 bg-muted/20 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">能力与状态</CardTitle>
                    <CardDescription>默认支持与本地增强能力一目了然。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {statusItems.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.description}</div>
                        </div>
                        <Badge
                          variant={
                            item.defaultAvailable
                              ? "secondary"
                              : item.active
                                ? "default"
                                : "outline"
                          }
                          className="shrink-0"
                        >
                          {item.value}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <RuntimeSection
                  title="自定义 LLM API"
                  description="留空时回退到服务端默认 LLM 配置。"
                >
                  {(() => {
                    const activeProvider: RuntimeModelProvider = modelProvider || "openai";
                    const providerMeta: Record<RuntimeModelProvider, { apiKeyPlaceholder: string; modelPlaceholder: string }> = {
                      openai: {
                        apiKeyPlaceholder: "sk-...",
                        modelPlaceholder: "gpt-4o-mini",
                      },
                      anthropic: {
                        apiKeyPlaceholder: "sk-ant-...",
                        modelPlaceholder: "claude-sonnet-4-5",
                      },
                      google_genai: {
                        apiKeyPlaceholder: "AIza...",
                        modelPlaceholder: "gemini-2.0-flash",
                      },
                    };
                    const currentProviderMeta = providerMeta[activeProvider];

                    return (
                      <>
                        <div className="space-y-1.5">
                          <label htmlFor="runtime-provider" className="text-xs font-medium text-muted-foreground">
                            Provider
                          </label>
                          <select
                            id="runtime-provider"
                            value={modelProvider || "openai"}
                            onChange={(event) =>
                              setModelProvider(event.target.value as RuntimeModelProvider)
                            }
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {runtimeProviderOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="runtime-api-key" className="text-xs font-medium text-muted-foreground">
                            API Key
                          </label>
                          <Input
                            id="runtime-api-key"
                            value={apiKey ?? ""}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder={currentProviderMeta.apiKeyPlaceholder}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </div>

                        {activeProvider === "openai" && (
                          <div className="space-y-1.5">
                            <label htmlFor="runtime-base-url" className="text-xs font-medium text-muted-foreground">
                              Base URL
                            </label>
                            <Input
                              id="runtime-base-url"
                              value={baseURL ?? ""}
                              onChange={(event) => setBaseURL(event.target.value)}
                              placeholder="https://api.openai.com/v1"
                              autoComplete="off"
                              spellCheck={false}
                            />
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label htmlFor="runtime-model" className="text-xs font-medium text-muted-foreground">
                            Model
                          </label>
                          <Input
                            id="runtime-model"
                            value={model ?? ""}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder={currentProviderMeta.modelPlaceholder}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </div>
                      </>
                    );
                  })()}
                </RuntimeSection>

                <RuntimeSection
                  title="高精度简历 OCR"
                  description="仅影响图片 / PDF 简历解析。"
                >
                  <div className="space-y-1.5">
                    <label htmlFor="runtime-ocr-api-key" className="text-xs font-medium text-muted-foreground">
                      GLM OCR API Key
                    </label>
                    <Input
                      id="runtime-ocr-api-key"
                      value={ocrApiKey ?? ""}
                      onChange={(event) => setOcrApiKey(event.target.value)}
                      placeholder="填写后优先使用 OCR 增强解析"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="text-xs text-muted-foreground">
                      去{" "}
                      <a
                        href="https://bigmodel.cn/usercenter/proj-mgmt/apikeys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-4 hover:text-primary/80"
                      >
                        智谱开放平台
                      </a>{" "}
                      获取。
                    </p>
                  </div>
                </RuntimeSection>

                <RuntimeSection
                  title="模拟面试语音输入"
                  description="用于模拟面试语音输入，建议两项同时填写。"
                >
                  <div className="space-y-1.5">
                    <label
                      htmlFor="runtime-speech-app-key"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Doubao App Key
                    </label>
                    <Input
                      id="runtime-speech-app-key"
                      value={speechAppKey ?? ""}
                      onChange={(event) => setSpeechAppKey(event.target.value)}
                      placeholder="填写后启用语音输入配置"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="runtime-speech-access-key"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Doubao Access Key
                    </label>
                    <Input
                      id="runtime-speech-access-key"
                      value={speechAccessKey ?? ""}
                      onChange={(event) => setSpeechAccessKey(event.target.value)}
                      placeholder="建议与 App Key 搭配使用"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="text-xs text-muted-foreground">
                      去{" "}
                      <a
                        href="https://www.volcengine.com/docs/6561/196768?lang=zh"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-4 hover:text-primary/80"
                      >
                        火山引擎文档
                      </a>{" "}
                      查看获取方式。
                    </p>
                  </div>
                </RuntimeSection>
              </CardContent>

              <CardFooter className="justify-between gap-3 border-t bg-background/95 px-4 pb-4 pt-4 backdrop-blur">
                <Button type="button" variant="outline" onClick={clearRuntimeConfig}>
                  清空全部配置
                </Button>
                <Button type="button" onClick={onClose}>
                  关闭
                </Button>
              </CardFooter>
            </Card>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
};

const RuntimeSettingsTrigger = ({ mobile = false, onOpen }: RuntimeSettingsTriggerProps) => {
  const { modelProvider, apiKey, baseURL, model, ocrApiKey, speechAppKey, speechAccessKey } =
    useRuntimeSettingsStore();
  const runtimeState = getRuntimeSettingsState({
    modelProvider,
    apiKey,
    baseURL,
    model,
    ocrApiKey,
    speechAppKey,
    speechAccessKey,
  });

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "gap-2 text-left",
        mobile ? "max-w-[11rem] justify-between px-3" : "w-full justify-between"
      )}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Settings2 className="h-4 w-4 shrink-0" />
        <span className="truncate">运行时设置</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{runtimeState.summary}</span>
    </Button>
  );
};

const Sidebar = ({ mobile = false, onNavigate, onClose, onOpenRuntimeSettings }: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPendingId = new URLSearchParams(location.search).get("pending");
  const currentSessionParam = new URLSearchParams(location.search).get("session");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<RecoverableSessionRecord[]>([]);
  const [pendingItems, setPendingItems] = useState<PendingSessionRecord[]>([]);

  const loadHistory = useCallback(() => {
    const sessions = getRecoverableSessions().sort(
      (a, b) => +new Date(b.snapshot.lastActiveAt) - +new Date(a.snapshot.lastActiveAt)
    );
    const pending = getPendingSessions();
    setHistoryItems(sessions);
    setPendingItems(pending);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, location.pathname, location.search]);

  useEffect(() => {
    const onStorage = () => loadHistory();
    window.addEventListener("storage", onStorage);
    window.addEventListener(MOCK_INTERVIEW_RECOVERY_EVENT, onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(MOCK_INTERVIEW_RECOVERY_EVENT, onStorage);
    };
  }, [loadHistory]);

  const isInterviewActive = location.pathname === "/interview";

  const handleCreateInterview = () => {
    navigate("/interview?new=1");
    onNavigate?.();
  };

  const handleOpenInterviewSession = (sessionId: string) => {
    navigate(`/interview?session=${encodeURIComponent(sessionId)}`);
    onNavigate?.();
  };

  const handleDeleteInterviewSession = (event: MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.stopPropagation();
    removeRecoverableSession(sessionId);
    setHistoryItems((current) => current.filter((item) => item.snapshot.sessionId !== sessionId));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b px-4 md:h-16">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold">FaceTomato 面柿</span>
        </div>

        {mobile && onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-2 hover:bg-accent"
            aria-label="关闭导航菜单"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path === "/resume" && location.pathname === "/");
          const Icon = item.icon;

          if (item.disabled) {
            return (
              <button
                key={item.path}
                disabled
                aria-disabled="true"
                tabIndex={-1}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  "pointer-events-none opacity-40 text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                <span className={cn("text-[10px]", mobile && "ml-auto")}>待开发</span>
              </button>
            );
          }

          if (item.path === "/interview") {
            return (
              <div key={item.path} className="space-y-1">
                <div className={cn("flex items-center rounded-md", isInterviewActive ? "bg-accent" : "")}>
                  <button
                    type="button"
                    onClick={handleCreateInterview}
                    className={cn(
                      "flex flex-1 items-center gap-3 rounded-l-md px-3 py-2.5 text-sm transition-colors",
                      isInterviewActive
                        ? "font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                    aria-label="新建模拟面试"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                    <Plus className="ml-auto h-3.5 w-3.5 opacity-70" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((current) => !current)}
                    className={cn(
                      "flex h-full items-center rounded-r-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                      isInterviewActive && "text-accent-foreground"
                    )}
                    aria-label="展开历史模拟面试"
                    aria-expanded={historyOpen}
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform", historyOpen && "rotate-180")} />
                  </button>
                </div>

                {historyOpen && (
                  <div className="space-y-1 rounded-md border border-border/60 bg-background/70 p-1">
                    {historyItems.length === 0 && pendingItems.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground">暂无历史面试</p>
                    ) : (
                      <>
                        {pendingItems.map((item) => {
                          const isSelected = currentPendingId === item.pending.pendingId;
                          return (
                          <div
                            key={`pending:${item.pending.pendingId}`}
                            className={cn(
                              "flex items-center gap-1 rounded px-1 py-1 transition-colors",
                              isSelected ? "bg-accent ring-1 ring-border" : "hover:bg-accent"
                            )}
                            title={item.pending.pendingId}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                navigate(`/interview?pending=${encodeURIComponent(item.pending.pendingId)}`);
                                onNavigate?.();
                              }}
                              className="min-w-0 flex-1 rounded px-1 py-0.5 text-left"
                            >
                              <div
                                className={cn(
                                  "truncate text-xs font-medium",
                                  isSelected && "text-accent-foreground"
                                )}
                              >
                                {item.pending.interviewType} · {item.pending.category}
                              </div>
                              <div
                                className={cn(
                                  "truncate text-[11px] text-muted-foreground",
                                  isSelected && "text-accent-foreground/80"
                                )}
                              >
                                {creatingStepLabel[item.pending.creatingStep] ?? creatingStepLabel.idle}
                              </div>
                            </button>
                            <span className="shrink-0 rounded-full border border-blue-300/70 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                              生成中
                            </span>
                          </div>
                          );
                        })}
                        {historyItems.slice(0, 12).map((session) => {
                          const isSelected = currentSessionParam === session.snapshot.sessionId;
                          return (
                            <div
                              key={session.snapshot.sessionId}
                              className={cn(
                                "flex items-center gap-1 rounded px-1 py-1 transition-colors",
                                isSelected ? "bg-accent ring-1 ring-border" : "hover:bg-accent"
                              )}
                              title={session.snapshot.sessionId}
                            >
                              <button
                                type="button"
                                onClick={() => handleOpenInterviewSession(session.snapshot.sessionId)}
                                className="min-w-0 flex-1 rounded px-1 py-0.5 text-left"
                                aria-current={isSelected ? "true" : undefined}
                              >
                                <div
                                  className={cn(
                                    "truncate text-xs font-medium",
                                    isSelected && "text-accent-foreground"
                                  )}
                                >
                                  {session.snapshot.interviewType} · {session.snapshot.category}
                                </div>
                                <div
                                  className={cn(
                                    "truncate text-[11px] text-muted-foreground",
                                    isSelected && "text-accent-foreground/80"
                                  )}
                                >
                                  最近活跃 {new Date(session.snapshot.lastActiveAt).toLocaleString()}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={(event) => handleDeleteInterviewSession(event, session.snapshot.sessionId)}
                                className="shrink-0 self-center rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                                aria-label={`删除面试 ${session.snapshot.interviewType} ${session.snapshot.category}`}
                                title="删除这条历史面试"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => onNavigate?.()}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                isActive
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t p-3">
        {!mobile && <RuntimeSettingsTrigger onOpen={onOpenRuntimeSettings} />}
        <div className={cn(!mobile && "mt-3")}>
          <ThemeToggle />
        </div>
        <div className="mt-3 rounded-md bg-accent/50 p-3 text-xs text-muted-foreground">
          数据仅保存在当前浏览器，清理浏览器缓存后会丢失
        </div>
      </div>
    </div>
  );
};

const App = () => {
  useThemeEffect();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRuntimeSettingsOpen, setIsRuntimeSettingsOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lastRuntimeSettingsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    triggerRef.current?.focus();
  }, []);

  const openRuntimeSettings = useCallback((trigger: HTMLButtonElement) => {
    lastRuntimeSettingsTriggerRef.current = trigger;
    setMobileMenuOpen(false);
    setIsRuntimeSettingsOpen(true);
  }, []);

  const closeRuntimeSettings = useCallback(() => {
    setIsRuntimeSettingsOpen(false);
    lastRuntimeSettingsTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const hasOverlayOpen = mobileMenuOpen || isRuntimeSettingsOpen;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }

      if (isRuntimeSettingsOpen) {
        closeRuntimeSettings();
        return;
      }

      if (mobileMenuOpen) {
        closeMobileMenu();
      }
    },
    [closeMobileMenu, closeRuntimeSettings, isRuntimeSettingsOpen, mobileMenuOpen]
  );

  useEffect(() => {
    if (!hasOverlayOpen) {
      return;
    }

    document.addEventListener("keydown", handleKeyDown);
    if (mobileMenuOpen) {
      drawerRef.current?.focus();
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown, hasOverlayOpen, mobileMenuOpen]);

  return (
    <div className="h-dvh min-h-screen bg-background">
      <div className="flex h-full">
        <aside className="hidden w-64 shrink-0 border-r bg-muted/30 md:block">
          <Sidebar onOpenRuntimeSettings={openRuntimeSettings} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileText className="h-4 w-4" />
              </div>
              <span className="text-base font-semibold">FaceTomato 面柿</span>
            </div>

            <div className="flex items-center gap-2">
              <RuntimeSettingsTrigger mobile onOpen={openRuntimeSettings} />
              <ThemeToggle />
              <button
                ref={triggerRef}
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-md p-2 hover:bg-accent"
                aria-label="打开导航菜单"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-nav-drawer"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </header>

          <main className="main-content flex-1 overflow-y-auto scrollbar-hide p-4 md:p-6">
            <div className="mx-auto h-full max-w-7xl">
              <Routes>
                <Route path="/" element={<ResumePage />} />
                <Route path="/resume" element={<ResumePage />} />
                <Route path="/diagnosis" element={<DiagnosisPage />} />
                <Route path="/questions" element={<QuestionBankPage />} />
                <Route path="/interview" element={<MockInterviewPage />} />
                <Route path="/interview-review" element={<InterviewReviewPage />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>

      <RuntimeSettingsOverlay open={isRuntimeSettingsOpen} onClose={closeRuntimeSettings} />

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-nav-title"
        >
          <div
            className="absolute inset-0 bg-black/40 transition-opacity"
            onClick={closeMobileMenu}
            aria-hidden="true"
          />
          <aside
            id="mobile-nav-drawer"
            ref={drawerRef}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-background shadow-xl outline-none"
          >
            <h2 id="mobile-nav-title" className="sr-only">
              导航菜单
            </h2>
            <Sidebar
              mobile
              onOpenRuntimeSettings={openRuntimeSettings}
              onNavigate={() => setMobileMenuOpen(false)}
              onClose={closeMobileMenu}
            />
          </aside>
        </div>
      )}
    </div>
  );
};

export default App;
