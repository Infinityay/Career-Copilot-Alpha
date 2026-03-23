# Backend Docs

这里集中存放 FaceTomato（面柿）后端相关的配置文档。

## 文档索引

- [`configuration.md`](./configuration.md)
  - 后端 `.env` 详细说明
  - 哪些变量必填、条件必填、选填
  - 哪些功能不用时应直接注释
  - 最小可用配置模板

- [`rag-config.md`](./rag-config.md)
  - mock interview / 面经检索 RAG 配置
  - embedding provider 说明
  - 索引重建时机
  - 常见 RAG 参数解释

## 后端快速启动

```bash
cd backend
uv sync
cp .env.example .env
```

默认安装不会包含本地 RAG 大依赖。
如果你要启用 mock interview RAG、构建 / 重建索引，或运行 RAG-only 测试，请先额外执行（当前依赖组合面向非 Windows 平台）：

```bash
cd backend
uv sync --extra rag
```

先根据 [`configuration.md`](./configuration.md) 填写 `backend/.env`，再启动：

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 6522
```

> 补充：仓库当前 `backend/Dockerfile` 仍按默认依赖构建镜像，因此 `docker compose` 路径默认只覆盖 non-RAG 模式；若要在容器内启用 RAG，需要额外修改镜像安装步骤。

接口文档：`http://127.0.0.1:6522/docs`

## 推荐阅读顺序

1. 先看 [`configuration.md`](./configuration.md)
2. 如果你要启用 mock interview RAG，再看 [`rag-config.md`](./rag-config.md)
