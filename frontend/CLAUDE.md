[根目录](../CLAUDE.md) > **frontend**

# Frontend 模块

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-18 | 增量扫描 | 同步到当前实现：补充 runtime settings、speech 输入链路、mock interview snapshot v3 / developer trace / transcript 导出、扩展测试清单与 API 依赖 |
| 2026-03-13 09:34:09 | 增量扫描 | 补充 mock interview、Vitest 测试、状态持久化与匿名恢复说明 |
| 2026-03-04 16:22:25 | 初始化 | 首次生成模块文档 |

---

## 模块职责

`frontend/` 是 FaceTamato（面柿）的 React 单页应用，负责四类核心交互：

- 简历上传、PDF/图片预览与结构化结果编辑
- JD 输入、匹配分析、优化建议展示
- 面经题库的筛选、分页、详情弹层与邻近导航
- 模拟面试创建、SSE 对话、语音输入、本地快照恢复与 transcript 导出

## 入口与启动

- 入口文件：`src/main.tsx`
- 根路由：`src/App.tsx`
- 开发命令：`npm run dev`
- 构建命令：`npm run build`
- 测试命令：`npm run test` / `npm run test:run`
- 代理配置：`vite.config.ts` 将 `/api`（含 WS）与 `/health` 代理到 `http://127.0.0.1:6522`

## 对外接口

### 前端路由

| 路由 | 页面 | 主要能力 |
|------|------|------|
| `/`、`/resume` | `ResumePage` | 上传简历、预览原文、展示与编辑结构化解析结果 |
| `/diagnosis` | `DiagnosisPage` | 结合 JD 展示概览、建议和匹配报告 |
| `/questions` | `QuestionBankPage` | 浏览面经列表、统计、筛选、详情 |
| `/interview` | `MockInterviewPage` | 创建模拟面试、恢复本地快照、流式对话、语音输入 |

### 依赖的后端 API（当前代码实际使用）

| 场景 | 主要接口 |
|------|------|
| 简历解析 | `POST /api/resume/parse` |
| 简历概览/建议 | `POST /api/resume/overview`、`POST /api/resume/suggestions` |
| JD 提取与 JD 匹配 | `POST /api/jd/extract`、`POST /api/resume/jd/match`、`POST /api/resume/jd/overview`、`POST /api/resume/jd/suggestions` |
| 面经题库 | `GET /api/interviews`、`GET /api/interviews/stats`、`GET /api/interviews/companies`、`GET /api/interviews/{id}`、`GET /api/interviews/{id}/neighbors` |
| 模拟面试（SSE） | `POST /api/mock-interview/session/stream-create`、`POST /api/mock-interview/session/{sessionId}/stream` |
| 语音输入 | `GET /api/speech/status`、`WS /api/speech/transcribe` |

> 注：当前前端 mock interview 流程未使用旧的 `/api/mock-interview/session/{sessionId}` 与 `/api/mock-interview/session/{sessionId}/resume`。

## 关键依赖与配置

### 核心依赖

| 依赖 | 用途 |
|------|------|
| `react` / `react-router-dom` | SPA 路由与视图层 |
| `zustand` + `persist` | 跨页面状态、会话暂存与本地恢复 |
| `framer-motion` | 页面和面板动画 |
| `pdfjs-dist` | PDF 预览渲染 |
| `fetch` | HTTP / SSE / WebSocket 交互 |
| `vitest` + Testing Library + `jsdom` | 前端单元/交互测试 |

### 关键配置文件

- `package.json`：开发、构建、测试脚本与依赖版本
- `vite.config.ts`：别名、端口、HTTP/WS 代理与 Vitest 配置
- `tsconfig.json`：严格模式、路径别名和 Vitest 类型
- `tailwind.config.cjs`：主题 token 与动画
- `src/test/setup.ts`：Vitest DOM 扩展

## 运行时配置（Runtime Settings）

### 配置来源与持久化

- Store：`src/store/runtimeSettingsStore.ts`
- 持久化 key：`face-tamato-runtime-settings`
- 字段：
  - `apiKey` / `baseURL` / `model`
  - `ocrApiKey`
  - `speechAppKey` / `speechAccessKey`

### UI 入口

- `src/App.tsx` 侧边栏与移动端头部都提供 “运行时设置” 入口
- 支持按能力分组编辑：自定义 LLM、OCR、语音输入

### 请求注入行为

- 通用处理：`src/lib/api.ts` 中 `sanitizeRuntimeConfig`
- 注入目标：
  - 简历解析：multipart form (`runtime_api_key`、`runtime_base_url`、`runtime_model`、`runtime_ocr_api_key`)
  - JD / 诊断相关：JSON `runtimeConfig`
  - mock interview create/stream：JSON `runtimeConfig`
  - speech status：query 参数（`runtime_speech_app_key`、`runtime_speech_access_key`）

## 数据模型

### 简历数据

- 类型定义：`src/types/resume.ts`
- 主模型：`ResumeData`

### JD 与匹配数据

- JD 类型：`src/lib/api.ts` 中的 `JDData`
- 优化状态与匹配结果：`src/store/optimizationStore.ts`
- 主模型：`ResumeOverview`、`ResumeSuggestions`、`MatchReport`

### 面经与模拟面试数据

- 面经类型：`src/types/interview.ts`
- 模拟面试类型：`src/types/mockInterview.ts`
- 关键结构：
  - `MockInterviewSessionResponse`
  - `MockInterviewSessionSnapshot`（当前 `snapshotVersion: 3`）
  - `MockInterviewDeveloperContext` / `MockInterviewDeveloperTraceEvent`
  - `MockInterviewRetrievalResult`
  - `MockInterviewPlan` / `MockInterviewState`

## 状态管理与本地持久化

| Store / 模块 | 文件 | 职责 |
|------|------|------|
| sessionStore | `src/store/sessionStore.ts` | 简历文件/文本与 JD 文本（sessionStorage），主题（localStorage） |
| resumeStore | `src/store/resumeStore.ts` | 结构化简历、解析状态、字段级更新 |
| optimizationStore | `src/store/optimizationStore.ts` | JD 文本、JDData、概览、建议、匹配报告 |
| questionBankStore | `src/store/questionBankStore.ts` | 题库筛选、分页、详情与邻近导航 |
| runtimeSettingsStore | `src/store/runtimeSettingsStore.ts` | 请求级 runtime 覆盖配置 |
| mockInterviewStore | `src/store/mockInterviewStore.ts` | 模拟面试会话、消息流、阶段、developer context/trace |
| mockInterviewRecovery | `src/lib/mockInterviewRecovery.ts` | `localStorage` 可恢复会话快照（v2->v3 升级、过期过滤、最近记录） |
| useSpeechInput | `src/store/useSpeechInput.ts` | 麦克风采集、PCM 编码、WS 推流与 partial/final 回填 |

## 模拟面试（当前实现）

### 流程概览

1. 在 `MockInterviewPage` 选择面试类型/领域并填写 JD
2. 调用 `POST /api/jd/extract` 获取 `jdData`
3. 调用 `POST /api/mock-interview/session/stream-create`（SSE）创建会话
4. 收到 `session_created` 后，调用 `POST /api/mock-interview/session/{sessionId}/stream`（`mode: start`）拉取首轮问题
5. 用户回复后继续调用同一 stream 接口（`mode: reply`）

### 事件面

- 创建阶段：`progress`、`developer_trace`、`session_created`、`done`、`error`
- 对话阶段：`user_message`、`answer_analysis_started`、`reflection_result`、`round_transition`、`message_start`、`message_delta`、`message_end`、`developer_trace`、`done`、`error`

### 本地恢复

- 本地 key：`face-tamato-mock-interview-recoverable-sessions`
- 快照结构：`MockInterviewSessionSnapshot`（v3）
- 支持历史恢复入口：`/interview?session=<sessionId>`
- 会话列表入口：`App.tsx` 侧边栏 “模拟面试” 历史下拉

### Developer trace 与导出

- trace 类型：`retrieval`、`plan_generation`、`reflection`、`interviewer_generation`
- trace 与 context 均写入 store + 快照
- 当前导出能力：`buildMockInterviewTranscriptMarkdown` 导出 Markdown 对话稿（`InterviewSessionHeader` 仅在 completed 状态显示导出按钮）

## 语音输入链路

- 可用性探测：`getSpeechStatus` -> `GET /api/speech/status`
- 实时转写：`useSpeechInput` -> `WS /api/speech/transcribe`
- 浏览器侧：麦克风 -> `AudioContext` -> 16kHz PCM -> WS
- 服务器事件：`ready` / `partial` / `final` / `end_of_turn` / `error`
- 页面整合：`MockInterviewPage` + `InterviewComposer`

## 测试与质量

已发现测试文件：

- 壳层与运行时设置
  - `src/test/App.test.tsx`

- 页面
  - `src/pages/__tests__/DiagnosisPage.test.tsx`
  - `src/pages/__tests__/MockInterviewPage.test.tsx`

- Resume 组件
  - `src/components/resume/__tests__/ResumeParsingState.test.tsx`
  - `src/components/resume/__tests__/ResumeExtractPanel.test.tsx`

- Optimization 组件
  - `src/components/optimization/__tests__/AnalysisPhase.test.tsx`
  - `src/components/optimization/__tests__/ResumeDisplayPanel.test.tsx`
  - `src/components/optimization/__tests__/SuggestionCard.test.tsx`

- Store / Lib
  - `src/store/__tests__/resumeStore.test.ts`
  - `src/store/__tests__/runtimeSettingsStore.test.ts`
  - `src/lib/__tests__/api.test.ts`

## 常见问题 (FAQ)

**Q: 为什么 mock interview 可以跨刷新恢复？**
A: 前端将会话快照（含 messages、plan、state、developerTrace）持久化到 `localStorage`，进入 `/interview?session=...` 时本地恢复。

**Q: mock interview 是否依赖后端持久化会话恢复接口？**
A: 当前前端不依赖后端恢复接口；后端按每次 stream 请求体重建临时会话。

**Q: 语音按钮为什么有时不可用？**
A: 同时受浏览器能力与后端 `/api/speech/status` 结果约束；runtime speech key 为空且后端默认未配置时会不可用。

**Q: transcript 导出包含什么？**
A: 当前导出为 Markdown 文本（岗位/类型/JD/问答对话）；不是结构化 developer report。

## 相关文件清单

```text
frontend/
  package.json
  vite.config.ts
  src/
    main.tsx
    App.tsx
    test/
      App.test.tsx
    pages/
      ResumePage.tsx
      DiagnosisPage.tsx
      QuestionBankPage.tsx
      MockInterviewPage.tsx
      __tests__/
        DiagnosisPage.test.tsx
        MockInterviewPage.test.tsx
    store/
      sessionStore.ts
      resumeStore.ts
      optimizationStore.ts
      questionBankStore.ts
      runtimeSettingsStore.ts
      mockInterviewStore.ts
      useSpeechInput.ts
      __tests__/
        resumeStore.test.ts
        runtimeSettingsStore.test.ts
    lib/
      api.ts
      interviewApi.ts
      mockInterviewApi.ts
      mockInterviewRecovery.ts
      mockInterviewDeveloperReport.ts
      download.ts
      __tests__/
        api.test.ts
    types/
      resume.ts
      interview.ts
      mockInterview.ts
    components/
      resume/
      optimization/
      questions/
      interview/
      ui/
```
