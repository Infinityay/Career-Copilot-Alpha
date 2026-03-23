[根目录](../CLAUDE.md) > **backend**

# Backend 模块

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-20 | 增量扫描 | 更新 backend 安装层：RAG 改为 `rag` 可选依赖，并补充 import-safe RAG 边界、mock interview 自动回退、索引脚本前置条件与默认/可选安装区分 |
| 2026-03-18 | 增量扫描 | 从“RAG 专题”升级为完整后端说明：补齐真实路由面、runtime config 合并、speech 转写、mock interview SSE/trace/timeout 与 RAG/non-RAG fallback、完整测试清单 |
| 2026-03-17 | 增量扫描 | 收缩 interview RAG embedding provider 为纯本地矩阵，保留 dense document/query 拆分与重建规则 |
| 2026-03-13 09:34:09 | 增量扫描 | 补充 mock interview、RAG 检索、匿名恢复与当前真实路由清单 |
| 2026-03-04 16:22:25 | 初始化 | 首次生成模块文档 |

---

## 模块职责

`backend/` 是 FaceTomato（面柿）的 FastAPI 服务端，负责：

- 简历文件解析与结构化抽取
- JD 文本抽取、简历概览与 JD 定向优化
- 面经题库的 SQLite 查询、统计与邻近导航
- 模拟面试创建与对话续流（SSE）
- 语音转写状态与 WebSocket 转写桥接
- interview RAG 检索与非 RAG 退化检索

## 入口与启动

- 应用入口：`app/main.py`
- 配置中心：`app/core/config.py`
- 启动命令：`uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 6522`
- 默认安装：`uv sync`
- RAG 可选安装：`uv sync --extra rag`
- API 文档：`http://127.0.0.1:6522/docs`
- 健康检查：`GET /health`

## 当前路由面（真实装配）

由 `app/main.py` 装配的 Router：

### Resume

- `POST /api/resume/parse`

### JD

- `POST /api/jd/extract`

### Resume Optimization

- `POST /api/resume/overview`
- `POST /api/resume/suggestions`

### JD Optimization

- `POST /api/resume/jd/match`
- `POST /api/resume/jd/overview`
- `POST /api/resume/jd/suggestions`

### Interviews

- `GET /api/interviews`
- `GET /api/interviews/stats`
- `GET /api/interviews/companies`
- `GET /api/interviews/categories`
- `GET /api/interviews/{id}`
- `GET /api/interviews/{id}/neighbors`

### Mock Interview

- `POST /api/mock-interview/session/stream-create`（SSE）
- `POST /api/mock-interview/session/{session_id}/stream`（SSE）

### Speech

- `GET /api/speech/status`
- `WS /api/speech/transcribe`

## Runtime 配置层

### Schema

- `app/schemas/runtime_config.py`
- 字段：`apiKey`、`baseURL`、`model`、`ocrApiKey`、`speechAppKey`、`speechAccessKey`

### 解析与合并

- `app/services/runtime_config.py`
  - `normalize_optional_string`: 空白字符串归一化为 `None`
  - `resolve_runtime_config`: 请求级 LLM 覆盖与 env 默认值逐字段合并
  - `resolve_ocr_api_key` / `resolve_ocr_api_key_from_runtime`
  - `resolve_speech_config`

### 合并原则

- 请求级覆盖仅覆盖传入字段，未传入字段回退到 env 配置
- `model_provider` 不在请求级覆盖范围内，仍由后端 active config 决定

## Mock Interview（当前实现）

核心文件：

- 路由：`app/api/routes/mock_interview.py`
- 服务：`app/services/mock_interview_service.py`
- schema：`app/schemas/mock_interview.py`

### 会话模型

- 创建阶段通过 `stream-create` 返回 `sessionId`、`interviewPlan`、`retrieval`、`developerContext` 等
- 对话阶段由前端在每次 `/stream` 请求中携带 `messages`、`interviewPlan`、`interviewState`、`retrieval` 等上下文
- 后端使用 `_build_ephemeral_session` 从请求体重建临时态，不依赖服务端持久化会话恢复

### SSE 事件

- 创建：`progress`、`developer_trace`、`session_created`、`done`、`error`
- 对话：`user_message`、`answer_analysis_started`、`reflection_result`、`round_transition`、`message_start`、`message_delta`、`message_end`、`developer_trace`、`done`、`error`

### Developer Trace / Context

- `developer_trace` 类型：
  - `retrieval`
  - `plan_generation`
  - `reflection`
  - `interviewer_generation`
- `developerContext` 标注当前前后端持久化策略（frontend local only）与 `ragEnabled`

### 轮次与限制

- 第 1 轮最多 1 问（开场轮）
- 后续轮次最多 5 问
- 最后一轮作为 coding round
- 超上限会触发强制轮转或结束

### 超时与失败回退

- 计划生成受 `MOCK_INTERVIEW_PLAN_TIMEOUT_SECONDS` 控制（服务内部最小 5s）
- 超时返回 504
- 结构化输出失败会触发 fallback 解析逻辑
- reflection 失败会返回显式 fallback reflection，避免流程中断

### RAG / Non-RAG 行为

- 安装层：
  - 默认 `uv sync` 不安装 RAG 依赖
  - 需要本地 RAG / 索引能力时使用 `uv sync --extra rag`
- 运行时关闭或回退条件：
  - `MOCK_INTERVIEW_RAG=false`
  - 未安装 `rag` 可选依赖
  - `zvec` 子进程探测 import 失败
  - 当前 dense/sparse provider 所需的 `sentence-transformers` / `modelscope` 等依赖不可用
- 关闭后使用 non-RAG 检索：基于 SQLite 的 tiered filter 回退（公司+类型+类别 -> 类型+类别 -> 仅类别）
- 开启时使用 `InterviewRagService.retrieve_for_plan`
- `developerContext.ragEnabled` 会反映最终是否真的启用了 RAG，而不是只看 env 开关

## Speech 转写链路

核心文件：

- 路由：`app/api/routes/speech.py`
- 服务工厂：`app/services/speech_transcription_service.py`
- Volcengine 实现：`app/services/volcengine_speech_transcription_service.py`

### `/api/speech/status`

- 基于 `resolve_speech_config` 判断可用性
- 支持 query 覆盖：`runtime_speech_app_key`、`runtime_speech_access_key`

### `WS /api/speech/transcribe`

- 首帧需 `{"type":"start"}` JSON（可带 language/encoding/sampleRate/speech keys）
- 后续二进制帧为 PCM 音频
- `{"type":"stop"}` 结束
- 服务向前端发送 `ready` / `partial` / `final` / `end_of_turn` / `error`

### 模式切换

- `VOLCENGINE_SPEECH_MODE=nostream` -> `VolcengineTranscriptionService`
- 其他模式 -> `VolcengineRealtimeTranscriptionService`

## Interview RAG / Embedding 子章节

核心文件：

- `app/services/interview_embedding_service.py`
- `app/services/interview_rag_service.py`
- `scripts/build_interview_zvec_index.py`

### 安装与导入边界

- `backend/pyproject.toml` 将 `modelscope`、`sentence-transformers`、`zvec` 放在 `rag` 可选依赖组
- `interview_embedding_service.py` 与 `interview_rag_service.py` 为 import-safe：默认安装环境下模块可导入
- 只有真正进入 RAG builder / RAG service / index 构建路径时，才会显式校验依赖并报错
- RAG-only 错误会提示先安装 backend 的 `rag` 可选依赖

### Provider 矩阵（当前限制）

- Dense provider：`local_default`、`local_hf_qwen3`
- Sparse provider：`bm25`、`local_default`

### Document/Query 拆分

- Dense 与 sparse 均区分 document builder 与 query builder
- 索引元信息区分 `index_embedding` 与 `query_embedding`

### 重建规则

- `InterviewZvecIndexService.ensure_index` 在以下情况重建：
  - 索引不存在
  - 索引签名变化
  - 影响建索引的 embedding metadata 变化
- 仅 query 侧变化不触发索引重建

## 关键环境变量

- 应用：`APP_HOST`、`APP_PORT`、`CORS_ORIGINS`、`MAX_UPLOAD_MB`
- LLM：`MODEL_PROVIDER`、`OPENAI_*`、`GOOGLE_*`、`ANTHROPIC_*`
- OCR：`ZHIPU_APIKEY`
- Mock interview：`MOCK_INTERVIEW_RAG`、`MOCK_INTERVIEW_SESSION_TTL_MINUTES`、`MOCK_INTERVIEW_PLAN_TIMEOUT_SECONDS`
- Speech：`VOLCENGINE_SPEECH_BASE_URL`、`VOLCENGINE_SPEECH_MODE`、`VOLCENGINE_SPEECH_APP_KEY`、`VOLCENGINE_SPEECH_ACCESS_KEY`、`VOLCENGINE_SPEECH_RESOURCE_ID`
- RAG：`INTERVIEW_DB_PATH`、`INTERVIEW_ZVEC_INDEX_PATH`、`INTERVIEW_RAG_*`、`INTERVIEW_DENSE_EMBEDDING_*`、`INTERVIEW_SPARSE_EMBEDDING_*`

## 测试与质量

当前测试文件（pytest）：

- 简历解析
  - `tests/test_pdf_parser.py`
  - `tests/test_resume_routes.py`

- Resume/JD 优化与匹配
  - `tests/test_resume_optimization_routes.py`
  - `tests/test_resume_optimizer.py`
  - `tests/test_jd_optimization_routes.py`
  - `tests/test_jd_resume_matcher.py`

- 题库与检索
  - `tests/test_interviews.py`
  - `tests/test_interview_rag_service.py`
  - `tests/test_interview_embedding_service.py`
  - `tests/test_embedding_config.py`
  - `tests/test_build_interview_zvec_index_script.py`

- Mock interview
  - `tests/test_mock_interview_routes.py`
  - `tests/test_mock_interview_service.py`
  - `tests/test_mock_interview_schemas.py`
  - `tests/test_mock_interview_prompts.py`

- 其他 schema
  - `tests/test_schema_normalization.py`

## 常见问题 (FAQ)

**Q: mock interview 会话是否持久化在后端？**
A: 当前 `/stream` 路径按请求体重建临时会话，恢复主路径在前端本地快照。

**Q: 为何开启了 RAG 仍可能退化？**
A: `MOCK_INTERVIEW_RAG=true` 只是运行时意图；如果没安装 `uv sync --extra rag`，或 `zvec` / `sentence-transformers` / `modelscope` 等当前组合所需依赖不可用，服务仍会自动切到 non-RAG，避免流程不可用。

**Q: 计划生成卡住怎么排查？**
A: 先检查 `MOCK_INTERVIEW_PLAN_TIMEOUT_SECONDS`、模型配置与上游模型服务状态；超时会返回 504。

**Q: 语音状态返回 unavailable 常见原因？**
A: 请求覆盖与 env 默认都未提供 `speechAppKey` + `speechAccessKey`。
