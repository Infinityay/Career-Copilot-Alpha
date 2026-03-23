# Backend Configuration

本文档详细说明 `backend/.env` 中各项配置的作用，以及：

- 哪些必须填写
- 哪些是条件必填
- 哪些是选填
- 哪些功能不用时应该直接注释

后端配置文件位置：`backend/.env`

复制方式：

```bash
cd backend
cp .env.example .env
```

安装方式分两种：

```bash
# 默认安装：不包含本地 RAG 大依赖
cd backend
uv sync

# 需要本地 RAG / 索引能力时再显式安装
cd backend
uv sync --extra rag
```

---

## 先记住这 6 条规则

1. **至少要配置一组 LLM 提供商**，否则简历解析、JD 分析、模拟面试等核心功能都无法工作。
2. `MODEL_PROVIDER` 只能选择一种当前生效的提供商：
   - `openai`
   - `google_genai`
   - `anthropic`
3. **未使用的提供商配置请直接注释掉**，不要保留 `your-xxx-api-key` 这种占位值。
4. 语音识别不是必需功能；如果不用，**整段 `VOLCENGINE_SPEECH_*` 都可以注释掉**。
5. OCR 不是必需功能；如果不用图片 OCR，`ZHIPU_APIKEY` 可以注释掉。
6. RAG 依赖默认不安装；只有在启用 mock interview RAG、构建索引或运行 RAG-only 测试时，才需要执行 `uv sync --extra rag`。
7. `API_KEY` / `BASE_URL` / `MODEL` 是**旧兼容字段**，默认不要填；除非你明确要走旧配置逻辑，否则请注释掉。

---

## 最小可用配置模板

### 方案 A：最小 OpenAI 配置（推荐新用户先用这个）

```env
# =========================
# Application
# =========================
APP_HOST=0.0.0.0
APP_PORT=6522
CORS_ORIGINS=http://localhost:5569,http://127.0.0.1:5569
MAX_UPLOAD_MB=10

# =========================
# LLM 配置（必填）
# =========================
MODEL_PROVIDER=openai
OPENAI_API_KEY=your-real-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# =========================
# 可选：OCR（不用就注释）
# =========================
# ZHIPU_APIKEY=

# =========================
# 可选：语音识别（不用就整段注释）
# =========================
# VOLCENGINE_SPEECH_BASE_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
# VOLCENGINE_SPEECH_MODE=nostream
# VOLCENGINE_SPEECH_APP_KEY=
# VOLCENGINE_SPEECH_ACCESS_KEY=
# VOLCENGINE_SPEECH_RESOURCE_ID=volc.bigasr.sauc.duration

# =========================
# Rate Limiter（一般不用改）
# =========================
RATE_LIMIT_REQUESTS_PER_SECOND=0.1
RATE_LIMIT_CHECK_EVERY_N_SECONDS=0.1
RATE_LIMIT_MAX_BUCKET_SIZE=5

# =========================
# Interview data（通常不用改）
# =========================
INTERVIEW_DB_PATH=data/interviews.db
INTERVIEW_ZVEC_INDEX_PATH=data/interview_zvec

# =========================
# Mock interview RAG（轻量部署建议关闭）
# =========================
MOCK_INTERVIEW_RAG=false
INTERVIEW_RAG_TOPK=5
INTERVIEW_RAG_CANDIDATE_TOPK=12
INTERVIEW_RAG_DENSE_WEIGHT=1.2
INTERVIEW_RAG_SPARSE_WEIGHT=1.0
INTERVIEW_DENSE_EMBEDDING_PROVIDER=local_hf_qwen3
INTERVIEW_DENSE_EMBEDDING_MODEL_NAME=Qwen/Qwen3-Embedding-0.6B
INTERVIEW_DENSE_EMBEDDING_MODEL_SOURCE=huggingface
INTERVIEW_DENSE_EMBEDDING_DEVICE=cpu
INTERVIEW_DENSE_EMBEDDING_NORMALIZE=true
INTERVIEW_SPARSE_EMBEDDING_PROVIDER=bm25
INTERVIEW_SPARSE_EMBEDDING_LANGUAGE=zh

# =========================
# 旧兼容字段（默认不要填）
# =========================
# API_KEY=
# BASE_URL=
# MODEL=
```

### 方案 B：Anthropic 配置

```env
MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-real-anthropic-api-key
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# 不用的提供商请注释
# OPENAI_API_KEY=
# OPENAI_BASE_URL=
# OPENAI_MODEL=
# GOOGLE_API_KEY=
# GOOGLE_MODEL=
```

### 方案 C：Google Gemini 配置

```env
MODEL_PROVIDER=google_genai
GOOGLE_API_KEY=your-real-google-api-key
GOOGLE_MODEL=gemini-2.0-flash

# 不用的提供商请注释
# OPENAI_API_KEY=
# OPENAI_BASE_URL=
# OPENAI_MODEL=
# ANTHROPIC_API_KEY=
# ANTHROPIC_MODEL=
```

---

## 详细变量分类

下面按“是否必须、什么时候必须、不用时怎么处理”来说明。

### 1. 应用基础配置

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `APP_HOST` | 否 | 仅当你想改监听地址时 | 保持默认 | 默认 `0.0.0.0` |
| `APP_PORT` | 否 | 仅当你想改端口时 | 保持默认 | 默认 `6522` |
| `CORS_ORIGINS` | 建议填写 | 前后端分域部署时尤其重要 | 本地开发保留默认即可 | 可写多个，逗号分隔 |
| `MAX_UPLOAD_MB` | 否 | 仅当你想放宽/收紧上传大小时 | 保持默认 | 默认 `10` MB |

---

### 2. LLM 配置（核心必填）

这是整个项目最重要的一组配置。

#### 2.1 必填原则

你必须至少配置以下三组选一：

- OpenAI / OpenAI Compatible
- Google Gemini
- Anthropic Claude

#### 2.2 `MODEL_PROVIDER`

| 变量 | 是否必须填写 | 合法值 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `MODEL_PROVIDER` | **是** | `openai` / `google_genai` / `anthropic` | 不能省略 | 指定当前后端默认使用哪家模型 |

#### 2.3 OpenAI / OpenAI-Compatible

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `OPENAI_API_KEY` | **是/条件必填** | `MODEL_PROVIDER=openai` 时必填 | 不用 OpenAI 就注释掉 | 核心认证字段 |
| `OPENAI_BASE_URL` | 否，但强烈建议写 | 使用 OpenAI 兼容接口时尤其重要 | 官方 OpenAI 可保留默认 | 官方默认是 `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 否，但建议写 | 使用 OpenAI 时建议明确指定 | 不用 OpenAI 就注释掉 | 默认示例是 `gpt-4o-mini` |

**什么时候算“必填”？**
- 如果 `MODEL_PROVIDER=openai`，那么至少要保证 `OPENAI_API_KEY` 可用。
- `OPENAI_BASE_URL` 在官方 OpenAI 下可直接用默认；如果你接的是兼容平台，就必须改成对应地址。

#### 2.4 Google Gemini

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `GOOGLE_API_KEY` | **是/条件必填** | `MODEL_PROVIDER=google_genai` 时必填 | 不用就注释掉 | Google API Key |
| `GOOGLE_MODEL` | 否，但建议写 | 使用 Google 时建议明确指定 | 不用就注释掉 | 默认代码值是 `gemini-2.0-flash` |

> 注意：这两个字段当前不在 `.env.example` 里，但后端配置类已经支持，可以手动加到 `backend/.env`。

#### 2.5 Anthropic Claude

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | **是/条件必填** | `MODEL_PROVIDER=anthropic` 时必填 | 不用就注释掉 | Anthropic API Key |
| `ANTHROPIC_MODEL` | 否，但建议写 | 使用 Anthropic 时建议明确指定 | 不用就注释掉 | 默认代码值是 `claude-sonnet-4-5-20250929` |

> 注意：这两个字段当前不在 `.env.example` 里，但后端配置类已经支持，可以手动加到 `backend/.env`。

---

### 3. OCR 配置

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `ZHIPU_APIKEY` | 否 | 你希望启用图片/OCR 解析时 | **不用就直接注释掉** | OCR 能力的默认后端 key |

**建议：**
- 如果只处理普通文本 PDF / DOCX，先不配也可以。
- 如果要提升图片简历、扫描版 PDF 的处理能力，再配置它。

---

### 4. 语音识别配置

语音输入不是必需功能。

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `VOLCENGINE_SPEECH_BASE_URL` | 否 | 你启用语音时通常保留默认 | 不用语音就整段注释 | 默认即可 |
| `VOLCENGINE_SPEECH_MODE` | 否 | 你启用语音时可按需求调整 | 不用语音就整段注释 | 默认 `nostream` |
| `VOLCENGINE_SPEECH_APP_KEY` | **成对条件必填** | 启用语音时必填 | 不用就注释掉 | 需要与 `ACCESS_KEY` 配对 |
| `VOLCENGINE_SPEECH_ACCESS_KEY` | **成对条件必填** | 启用语音时必填 | 不用就注释掉 | 需要与 `APP_KEY` 配对 |
| `VOLCENGINE_SPEECH_RESOURCE_ID` | 否 | 启用语音时通常保留默认 | 不用语音就整段注释 | 默认即可 |
| `VOLCENGINE_SPEECH_TOKEN` | 否 | 当前通常不需要 | 建议不写 | 代码里当前定义了配置项，但现有主要逻辑不依赖它 |

**重要：**
- `VOLCENGINE_SPEECH_APP_KEY` 和 `VOLCENGINE_SPEECH_ACCESS_KEY` 必须同时存在，语音状态才会被认为可用。
- 如果你不用语音功能，最简单的方式就是把整段 `VOLCENGINE_SPEECH_*` 全部注释掉。

---

### 5. Rate Limiter 配置

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `RATE_LIMIT_REQUESTS_PER_SECOND` | 否 | 想调整模型调用节流时 | 保持默认 | 会影响后端模型请求节流 |
| `RATE_LIMIT_CHECK_EVERY_N_SECONDS` | 否 | 想调整检查频率时 | 保持默认 | 一般不用改 |
| `RATE_LIMIT_MAX_BUCKET_SIZE` | 否 | 想调整最大积压时 | 保持默认 | 一般不用改 |

**建议：**
- 新用户先完全不改。
- 只有在并发压力、排队体验、上游限速不合适时再调。

---

### 6. 题库与数据路径配置

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `INTERVIEW_DB_PATH` | 否，但建议保留 | 你改了数据库文件位置时 | 有默认数据就不用改 | 默认 `data/interviews.db` |
| `INTERVIEW_ZVEC_INDEX_PATH` | 否 | 你启用 RAG 且索引位置变化时 | 不用 RAG 可保留默认 | 默认 `data/interview_zvec` |

**建议：**
- 如果你直接使用仓库内已有的 `backend/data`，通常不用改。
- 如果你在 Docker 中挂载了别的数据目录，再按实际路径调整。

---

### 7. 模拟面试 RAG 配置

先区分两个层面：

1. **安装层**：是否执行了 `uv sync --extra rag`
2. **运行时层**：是否设置 `MOCK_INTERVIEW_RAG=true`

这两层不是一回事：

- `MOCK_INTERVIEW_RAG=false` = 你主动在运行时关闭 RAG
- 没有安装 `rag` 可选依赖 = 运行环境根本不具备本地 RAG 能力

对于轻量部署，建议先关闭：

```env
MOCK_INTERVIEW_RAG=false
```

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `MOCK_INTERVIEW_RAG` | 否，但建议明确写 | 你要决定是否启用 RAG 时 | 建议显式写 `false` 或 `true` | 默认示例为 `false` |
| `INTERVIEW_RAG_TOPK` | 否 | 启用 RAG 并想调召回数量时 | 不用改 | 一般保持默认 |
| `INTERVIEW_RAG_CANDIDATE_TOPK` | 否 | 启用 RAG 并想调候选集时 | 不用改 | 一般保持默认 |
| `INTERVIEW_RAG_DENSE_WEIGHT` | 否 | 启用 RAG 并想调重排权重时 | 不用改 | 一般保持默认 |
| `INTERVIEW_RAG_SPARSE_WEIGHT` | 否 | 启用 RAG 并想调重排权重时 | 不用改 | 一般保持默认 |

**建议：**
- 只想快速跑起来：`MOCK_INTERVIEW_RAG=false`
- 需要更强的 mock interview 检索增强时，再执行 `uv sync --extra rag`、构建本地索引，并开启 `MOCK_INTERVIEW_RAG=true`
- 即使你写了 `MOCK_INTERVIEW_RAG=true`，如果当前依赖不可用，后端也会自动回退到 non-RAG

---

### 8. Embedding / 索引配置

这组配置主要服务于 RAG，不是新用户的第一优先级。

| 变量 | 是否必须填写 | 什么时候必须 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `INTERVIEW_DENSE_EMBEDDING_PROVIDER` | 否 | 启用 RAG 且要切 embedding 方案时 | 保持默认 | 默认 `local_hf_qwen3` |
| `INTERVIEW_DENSE_EMBEDDING_MODEL_NAME` | 否 | 启用 RAG 时通常保留默认 | 保持默认 | 默认 `Qwen/Qwen3-Embedding-0.6B` |
| `INTERVIEW_DENSE_EMBEDDING_MODEL_SOURCE` | 否 | 启用 RAG 且需要换源时 | 保持默认 | 默认 `huggingface` |
| `INTERVIEW_DENSE_EMBEDDING_DEVICE` | 否 | 启用 RAG 且要指定设备时 | 保持默认 | 轻量部署建议 `cpu` |
| `INTERVIEW_DENSE_EMBEDDING_NORMALIZE` | 否 | 启用 RAG 时通常保留默认 | 保持默认 | 默认 `true` |
| `INTERVIEW_SPARSE_EMBEDDING_PROVIDER` | 否 | 启用 RAG 时通常保留默认 | 保持默认 | 默认 `bm25` |
| `INTERVIEW_SPARSE_EMBEDDING_LANGUAGE` | 否 | 启用 RAG 时通常保留默认 | 保持默认 | 默认 `zh` |

**建议：**
- 不熟悉 embedding 的情况下，不要改这组。
- 如果你修改了索引侧 embedding 配置，需要重建索引。

建立 / 重建面经索引前，先安装 `rag` 可选依赖：

```bash
cd backend
uv sync --extra rag
uv run python scripts/build_interview_zvec_index.py
```

更多说明见：[`rag-config.md`](./rag-config.md)

---

### 9. 旧兼容字段（默认不要用）

| 变量 | 是否必须填写 | 是否推荐 | 不用时怎么处理 | 说明 |
|---|---|---|---|---|
| `API_KEY` | 否 | **不推荐** | 注释掉 | 旧兼容字段 |
| `BASE_URL` | 否 | **不推荐** | 注释掉 | 旧兼容字段 |
| `MODEL` | 否 | **不推荐** | 注释掉 | 旧兼容字段 |

这三个字段如果同时填写，后端会优先走这套旧逻辑。除非你明确知道自己在做什么，否则不要启用。

---

### 10. 进阶可选字段（`.env.example` 里暂未列出）

后端代码还支持以下进阶变量；它们不是启动必须项，默认一般不需要加：

| 变量 | 是否必须填写 | 用途 | 默认行为 |
|---|---|---|---|
| `GOOGLE_API_KEY` | 条件必填 | Google 模型认证 | 用 Google 时再加 |
| `GOOGLE_MODEL` | 否 | Google 默认模型 | 不写则用代码默认值 |
| `ANTHROPIC_API_KEY` | 条件必填 | Anthropic 模型认证 | 用 Anthropic 时再加 |
| `ANTHROPIC_MODEL` | 否 | Anthropic 默认模型 | 不写则用代码默认值 |
| `MOCK_INTERVIEW_SESSION_TTL_MINUTES` | 否 | 模拟面试匿名恢复 token TTL | 不写则用代码默认值 |
| `MOCK_INTERVIEW_PLAN_TIMEOUT_SECONDS` | 否 | 模拟面试计划生成超时 | 不写则用代码默认值 |
| `VOLCENGINE_SPEECH_TOKEN` | 否 | 语音 token 预留配置 | 当前通常不需要 |

---

## `.env` 推荐维护方式

### 推荐做法

- **只保留正在使用的 provider 配置**
- 所有不用的 key 直接注释掉
- 不要把占位文本当成真实配置提交
- 团队协作时提交 `.env.example`，不要提交真实 `.env`

### 不推荐做法

```env
OPENAI_API_KEY=your-openai-api-key
GOOGLE_API_KEY=your-google-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

上面这种写法看起来“都有”，实际上部署时最容易误导别人。**不用的就注释掉，不要保留假值。**

---

## 前端 Runtime Settings 与 `.env` 的关系

前端“运行时设置”可以按请求覆盖后端默认值，字段包括：

- LLM：`apiKey`、`baseURL`、`model`
- OCR：`ocrApiKey`
- Speech：`speechAppKey`、`speechAccessKey`

合并规则：

- **请求里传了的字段**：优先使用前端运行时设置
- **请求里没传的字段**：回退到后端 `.env`
- `model_provider` 仍由后端环境变量控制，不通过前端运行时切换

所以：
- 对团队共享部署，建议先把 `.env` 配好
- 个人临时测试某个模型时，再用前端 Runtime Settings 覆盖

---

## 常见配置建议

### 1. 我只想先跑起来

用最小 OpenAI 配置即可：

- 配 `MODEL_PROVIDER=openai`
- 配 `OPENAI_API_KEY`
- 其余 OCR / Speech 可全部注释
- `MOCK_INTERVIEW_RAG=false`

### 2. 我不用语音功能

把整段 `VOLCENGINE_SPEECH_*` 全部注释掉。

### 3. 我不用 OCR

把 `ZHIPU_APIKEY` 注释掉。

### 4. 我不想折腾本地 embedding / RAG

保持：

```env
MOCK_INTERVIEW_RAG=false
```

其余 RAG 参数保留默认即可，不必改。

### 5. 我要改成 OpenAI 兼容平台

至少修改：

- `MODEL_PROVIDER=openai`
- `OPENAI_API_KEY=...`
- `OPENAI_BASE_URL=你的兼容平台地址`
- `OPENAI_MODEL=你的模型名`
