# Interview RAG Configuration

本文档说明 `backend/` 下 mock interview / 面经检索使用的本地 RAG embedding 配置。

> 前提：本页的能力都属于 backend 的 **`rag` 可选依赖**。默认 `uv sync` 不会安装这些依赖；启用前请先执行 `uv sync --extra rag`。当前依赖组合中的 `zvec` 仍限制为非 Windows 平台，因此 Windows 默认只能使用 non-RAG / 回退路径。

---

## 1. 推荐默认方案

如果你不想额外调参，直接使用项目默认推荐组合：

- dense: `local_hf_qwen3`
- sparse: `bm25`

对应配置：

```env
INTERVIEW_DENSE_EMBEDDING_PROVIDER=local_hf_qwen3
INTERVIEW_SPARSE_EMBEDDING_PROVIDER=bm25
```

---

## 2. 安装层 vs 运行时开关

先区分两个概念：

- **安装层**：`uv sync --extra rag` 是否执行过
- **运行时层**：`MOCK_INTERVIEW_RAG` 是否开启

这两者缺一不可：

- 没有安装 `rag` 可选依赖：RAG builder、RAG service、索引脚本都会显式报错或自动回退
- 安装了 `rag` 可选依赖但 `MOCK_INTERVIEW_RAG=false`：运行时仍然走 non-RAG

### `MOCK_INTERVIEW_RAG`

是否开启 mock interview 的 RAG 检索。

- `true`：开启 RAG
- `false`：关闭 ZVEC-based RAG，mock interview 改走 SQLite non-RAG fallback 检索

```env
MOCK_INTERVIEW_RAG=true
```

如果只改这个开关、但没有安装 `uv sync --extra rag`，mock interview 会把 `ragEnabled` 标成 `false`，并自动退回 SQLite non-RAG 检索。

---

## 3. 检索与重排参数

这些参数不决定 provider，只影响召回与重排。

```env
INTERVIEW_RAG_TOPK=5
INTERVIEW_RAG_CANDIDATE_TOPK=12
INTERVIEW_RAG_DENSE_WEIGHT=1.2
INTERVIEW_RAG_SPARSE_WEIGHT=1.0
```

默认值通常够用，只有在你明确想调整召回偏好时再改。

---

## 4. 当前支持的 provider

### Dense

| provider | 实现 | 说明 |
|---|---|---|
| `local_default` | `zvec.DefaultLocalDenseEmbedding` | zvec 默认本地 dense |
| `local_hf_qwen3` | `LocalQwenDenseEmbedding` | 当前项目保留的本地 Qwen3 dense 兼容层 |

### Sparse

| provider | 实现 | 说明 |
|---|---|---|
| `bm25` | `zvec.BM25EmbeddingFunction` | 经典 lexical sparse 检索 |
| `local_default` | `zvec.DefaultLocalSparseEmbedding` | zvec 默认本地 sparse |

---

## 5. Dense 参数说明

### `INTERVIEW_DENSE_EMBEDDING_PROVIDER`

可选值：

- `local_default`
- `local_hf_qwen3`

### `INTERVIEW_DENSE_EMBEDDING_MODEL_NAME`

dense 模型名或本地模型路径。

- 对 `local_hf_qwen3` 有意义
- `local_default` 一般不需要额外改动

### `INTERVIEW_DENSE_EMBEDDING_MODEL_SOURCE`

本地 dense 模型来源。

可选值：

- `huggingface`
- `modelscope`

对 `local_default` 与 `local_hf_qwen3` 都有效。

### `INTERVIEW_DENSE_EMBEDDING_DEVICE`

本地 dense 模型运行设备，例如：

- `cpu`
- `cuda`

主要对 `local_hf_qwen3` 有意义。

### `INTERVIEW_DENSE_EMBEDDING_NORMALIZE`

是否对本地 dense 向量做 L2 normalize。

主要对 `local_hf_qwen3` 有意义。

---

## 6. Sparse 参数说明

### `INTERVIEW_SPARSE_EMBEDDING_PROVIDER`

可选值：

- `bm25`
- `local_default`

### `INTERVIEW_SPARSE_EMBEDDING_MODEL_SOURCE`

本地 sparse 模型来源。

可选值：

- `huggingface`
- `modelscope`

只对 `local_default` 有意义。

### `INTERVIEW_SPARSE_EMBEDDING_LANGUAGE`

BM25 的语言配置。

可选值：

- `zh`
- `en`

只对 `bm25` 有意义。

### `INTERVIEW_SPARSE_EMBEDDING_BM25_B`

BM25 的 `b` 参数，只对 `bm25` 有意义。

### `INTERVIEW_SPARSE_EMBEDDING_BM25_K1`

BM25 的 `k1` 参数，只对 `bm25` 有意义。

---

## 7. 参数生效表

### Dense

| 参数 | local_default | local_hf_qwen3 |
|---|---:|---:|
| `PROVIDER` | 有效 | 有效 |
| `MODEL_NAME` | 基本不用 | 有效 |
| `MODEL_SOURCE` | 有效 | 有效 |
| `DEVICE` | 无效 | 有效 |
| `NORMALIZE` | 无效 | 有效 |

### Sparse

| 参数 | bm25 | local_default |
|---|---:|---:|
| `PROVIDER` | 有效 | 有效 |
| `MODEL_SOURCE` | 无效 | 有效 |
| `LANGUAGE` | 有效 | 无效 |
| `BM25_B` | 可选 | 无效 |
| `BM25_K1` | 可选 | 无效 |

---

## 8. 合法组合

当前只支持以下四种 dense + sparse 组合：

- `local_default + bm25`
- `local_default + local_default`
- `local_hf_qwen3 + bm25`
- `local_hf_qwen3 + local_default`

---

## 9. `.env` 示例

### Demo 1：推荐默认方案 `local_hf_qwen3 + bm25`

```env
MOCK_INTERVIEW_RAG=true

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
```

### Demo 2：`local_default + bm25`

```env
MOCK_INTERVIEW_RAG=true

INTERVIEW_DENSE_EMBEDDING_PROVIDER=local_default
INTERVIEW_DENSE_EMBEDDING_MODEL_SOURCE=huggingface

INTERVIEW_SPARSE_EMBEDDING_PROVIDER=bm25
INTERVIEW_SPARSE_EMBEDDING_LANGUAGE=zh
```

### Demo 3：`local_default + local_default`

```env
MOCK_INTERVIEW_RAG=true

INTERVIEW_DENSE_EMBEDDING_PROVIDER=local_default
INTERVIEW_DENSE_EMBEDDING_MODEL_SOURCE=huggingface

INTERVIEW_SPARSE_EMBEDDING_PROVIDER=local_default
INTERVIEW_SPARSE_EMBEDDING_MODEL_SOURCE=huggingface
```

### Demo 4：`local_hf_qwen3 + local_default`

```env
MOCK_INTERVIEW_RAG=true

INTERVIEW_DENSE_EMBEDDING_PROVIDER=local_hf_qwen3
INTERVIEW_DENSE_EMBEDDING_MODEL_NAME=Qwen/Qwen3-Embedding-0.6B
INTERVIEW_DENSE_EMBEDDING_MODEL_SOURCE=huggingface
INTERVIEW_DENSE_EMBEDDING_DEVICE=cpu
INTERVIEW_DENSE_EMBEDDING_NORMALIZE=true

INTERVIEW_SPARSE_EMBEDDING_PROVIDER=local_default
INTERVIEW_SPARSE_EMBEDDING_MODEL_SOURCE=huggingface
```

---

## 10. 什么时候需要重建索引

切换下面这些 index-side 配置后，需要重建 `backend/data/interview_zvec`：

- dense document provider
- dense document model / model source / device / normalize
- sparse document provider
- sparse document model source / language / bm25 参数

执行命令：

```bash
cd backend
uv sync --extra rag
uv run python scripts/build_interview_zvec_index.py
```

---

## 11. 常见问题

### Q1. 我只改了 query 相关配置，也要重建索引吗？

通常不需要。`ensure_index()` 只比较 index-side embedding metadata。

### Q2. 为什么我已经把 `MOCK_INTERVIEW_RAG=true`，却还是看到 non-RAG？

因为运行时开关不等于安装层能力。若未执行 `uv sync --extra rag`，或当前 provider 依赖的 `zvec` / `sentence-transformers` / `modelscope` 不可用，服务会自动回退，并让 `developerContext.ragEnabled=false`。

### Q3. 本地 provider 第一次很慢，正常吗？

正常。首次使用本地模型可能下载权重，并且会占用较多内存。

### Q4. 当前最推荐什么？

`local_hf_qwen3 + bm25`。

### Q5. 当前项目支持多模态 embedding 吗？

不支持，当前只面向文本检索。

