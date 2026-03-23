# FaceTomato

<div align="center">

### FaceTomato · AI 辅助简历分析与模拟面试系统

<img src="./assets/facetomato_new.jpg" alt="FaceTomato preview" width="880" />

[![GitHub stars](https://img.shields.io/github/stars/Infinityay/FaceTomato?style=flat-square)](https://github.com/Infinityay/FaceTamato/stargazers)
[![Frontend](https://img.shields.io/badge/Frontend-React%2018%20%2B%20TypeScript-blue?style=flat-square)]()
[![Backend](https://img.shields.io/badge/Backend-FastAPI%20%2B%20LangChain-green?style=flat-square)]()
[![Storage](https://img.shields.io/badge/Storage-SQLite%20%2B%20Local%20Index-orange?style=flat-square)]()
[![License](https://img.shields.io/github/license/Infinityay/FaceTomato?style=flat-square)](https://github.com/Infinityay/FaceTomato/blob/main/LICENSE)


</div>

---

## ✨ 项目概述

**FaceTomato** 是一个面向求职场景的 AI 助手，覆盖从材料准备到面试演练的完整流程，帮助用户更高效地完成：

- 简历解析
- JD 匹配分析
- 简历优化
- 面经题库检索
- 模拟面试
- 语音输入辅助答题

用户可以从一份简历或一个岗位描述开始，让系统自动完成结构提取、能力匹配、改写建议与模拟问答，逐步搭建一套更完整的求职准备链路。

> FaceTomato 以 Tomato（番茄）为视觉与品牌意象，象征一种轻量但高价值、低门槛但强辅助的产品能力。
> 我们希望 FaceTomato 成为求职过程中的那个关键助攻：
> **🍅 “平凡外表下的高效赋能，助你在关键时刻稳定发挥”**

## 🚀 核心能力

### 1. 📄 简历解析

支持上传多种格式的简历文件，包括：

- PDF
- DOCX
- PNG / JPG
- TXT

系统会自动提取候选人的结构化信息，如教育背景、项目经历、技能标签、实习或工作经历等，形成可进一步分析的简历画像。

### 2. 🎯 JD 匹配分析

输入岗位描述后，系统会自动提取岗位要求，包括：

- 技能要求
- 学历要求
- 经验要求
- 岗位职责
- 加分项

并结合简历内容生成匹配评估，帮助用户快速发现自己的优势项、薄弱项与待补足项。

### 3. ✍️ 简历优化建议

支持两类优化模式：

- 通用优化：从表达、结构、量化成果、关键词覆盖等维度给出建议
- JD 定向优化：基于目标岗位要求，对简历内容进行有针对性的优化建议

### 4. 📚 面经题库检索

内置面经题库能力，支持：

- SQLite 分页检索
- 条件筛选
- 统计查看
- 邻近导航

便于用户围绕目标岗位、技术方向或高频题型进行针对性准备。

### 5. 🎙️ 模拟面试

提供面向真实面试场景的模拟对话能力，支持：

- SSE 流式创建面试会话
- 面试过程中的连续对话
- 前端本地快照恢复
- 多轮追问与上下文延续

让用户能够在接近真实面试的交互节奏中进行演练。

### 6. 🎤 语音输入

支持浏览器麦克风输入，并接入语音转写服务，实现更自然的面试答题体验。

适用于：

- 模拟真实口述作答
- 训练表达流畅度
- 提升临场回答状态

## 🌟 为什么使用 FaceTomato

相比单点式的简历工具或面试工具，FaceTomato 更强调求职准备链路的一体化：

1. **从输入材料到输出建议的一站式流程**  
   从上传简历、解析结构，到 JD 匹配、简历优化、题库检索、模拟面试，形成完整闭环。
2. **围绕岗位目标而非孤立功能设计**  
   不只是“改简历”或“刷题”，而是围绕目标岗位构建更系统的求职准备过程。
3. **兼顾结构化分析与交互式演练**  
   既能输出清晰的分析结果，也能通过模拟面试帮助用户真正“说出来”。
4. **支持前后端分离与本地化部署**  
   适合课程项目、校招训练、实验室演示以及后续二次开发。

## 🏗️ 系统组成

FaceTomato 由前端应用、后端服务、本地数据存储与检索模块构成。

- **Frontend**
  负责简历上传、JD 输入、分析结果展示、面试对话、语音输入等交互体验。
- **Backend**
  提供简历解析、JD 分析、优化建议生成、模拟面试、题库接口等服务。
- **Storage**
  使用 SQLite 管理题库与业务数据，使用浏览器本地存储做会话恢复，并结合本地索引支持检索能力。

## 🧱 技术栈

### Frontend

- React 18
- TypeScript
- Vite
- TailwindCSS
- Zustand
- Vitest

### Backend

- FastAPI
- Pydantic
- LangChain

### Storage

- SQLite
- localStorage / sessionStorage
- 本地 ZVEC 索引

## 📦 环境要求

- Node.js >= 18
- npm >= 9
- Python >= 3.12, < 3.13
- uv

## ⚡ 快速开始

### 1. 启动后端

进入后端目录并安装依赖：

```bash
cd backend
uv sync
cp .env.example .env
```

根据实际配置补全 `backend/.env` 后，运行后端服务：

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 6522
```

启动后可访问接口文档：

`http://127.0.0.1:6522/docs`

### 2. 启动前端

进入前端目录并安装依赖：

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：

`http://127.0.0.1:5569`

## 🐳 Docker 启动

首次使用前，请先准备后端环境变量：

```bash
cp backend/.env.example backend/.env
```

然后在项目根目录执行：

```bash
docker compose up --build
```

启动后默认访问地址：

- 前端：`http://127.0.0.1:5569`
- 后端：`http://127.0.0.1:6522`
- 后端文档：`http://127.0.0.1:6522/docs`

## ⚙️ 配置说明

当前仓库中与配置和检索能力相关的说明主要包括：

- `backend/.env.example`：后端环境变量示例
- `backend/RAG_CONFIG.md`：面经检索与 RAG 相关配置说明

如需启用本地索引检索能力，可进一步参考 `backend/RAG_CONFIG.md`。

## 🛠️ Runtime Settings

前端支持在运行时按请求覆盖后端默认配置，主要字段包括：

- LLM：`apiKey`、`baseURL`、`model`
- OCR：`ocrApiKey`
- Speech：`speechAppKey`、`speechAccessKey`

后端会在 `runtime_config` 层将这些请求参数与 `.env` 默认值逐字段合并。

## 🧪 模拟面试当前行为

- 前端本地持久化会话快照，用于页面刷新后的恢复
- 后端在每次 `/stream` 请求时按请求体重建临时会话态
- 创建与对话过程中会返回 developer trace 事件
- 当 `MOCK_INTERVIEW_RAG=false` 或 `zvec` 不可用时，会自动回退到非 RAG 模式

## 🗂️ 面经索引构建

如需建立面经索引，可执行：

```bash
cd backend
uv run python scripts/build_interview_zvec_index.py
```

## 📁 项目结构

```text
FaceTomato/
├── frontend/                    # 前端应用
│   ├── src/                     # 页面、组件、状态管理与接口封装
│   ├── package.json
│   └── Dockerfile
├── backend/                     # 后端服务
│   ├── app/                     # API、schema、service 与 prompt
│   ├── data/                    # 本地数据库与索引元数据
│   ├── scripts/                 # 索引构建与数据迁移脚本
│   ├── tests/                   # 后端测试
│   ├── .env.example
│   ├── pyproject.toml
│   └── RAG_CONFIG.md
├── docker-compose.yml
├── CLAUDE.md
└── README.md
```

## 💡 典型使用流程

### 场景一：简历优化

1. 上传简历
2. 系统完成结构化解析
3. 用户输入目标岗位 JD
4. 系统输出匹配评估与优化建议
5. 用户根据建议修改简历并再次迭代

### 场景二：模拟面试

1. 选择目标岗位或面试方向
2. 系统基于简历或 JD 生成问题
3. 用户通过文本或语音回答
4. 系统给出追问、反馈与改进建议
5. 用户反复演练，提升表达与逻辑

### 场景三：面经题库准备

1. 根据岗位或方向筛选题库
2. 查看高频问题与相关统计
3. 结合模拟面试进行专项训练

## 🔧 开发说明

### 前端开发

前端基于 React + TypeScript + Vite，适合快速迭代交互界面与组件能力。

### 后端开发

后端使用 FastAPI 提供服务接口，结合 Pydantic 进行数据校验，并通过 LangChain 组织部分 AI 工作流。

### 本地存储与恢复

为了保证模拟面试等长对话场景下的可恢复性，系统在浏览器侧使用 `localStorage` 和 `sessionStorage` 进行本地状态保存。

## ✅ 测试

- 后端测试目录：`backend/tests/`
- 前端测试命令：`cd frontend && npm run test`
- 前端单次执行：`cd frontend && npm run test:run`

## 🗺️ 未来计划

我们计划继续完善以下方向：

- 多岗位类型的更细粒度 JD 解析
- 更强的简历改写与量化表达建议
- 更贴近真实场景的面试追问机制
- 更完善的 RAG 检索与题库扩展能力
- 面试结果可视化与成长轨迹记录

## 🤝 贡献指南

欢迎通过以下方式参与项目建设：

- 提交 Issue 反馈问题
- 提交 Pull Request 改进功能
- 提出产品体验与交互建议

如果后续补充 `CONTRIBUTING.md`，可以在这里加入对应链接。

## ⚠️ 免责声明

本项目仅用于学习、研究、教学演示与非商业用途。

本项目输出的分析结果、优化建议与模拟面试内容仅供参考，不构成任何招聘结果保证。

用户应对上传的简历、岗位描述及相关数据的合法性、真实性与合规性负责。

若项目接入第三方模型、语音服务或检索服务，相关服务的可用性、准确性与合规性由对应服务提供方负责。

开发者不对因使用本项目产生的直接或间接损失承担责任。

## 📄 许可证

本项目采用 [MIT License](https://github.com/Infinityay/FaceTomato/blob/main/LICENSE) 开源协议，详情见仓库根目录下的 `LICENSE` 文件。

## 📬 联系方式

如需交流、反馈或合作，可通过以下方式联系：

- GitHub Issues
- 项目仓库主页
- 邮箱（如需可补充）

## ⭐ 支持项目

如果这个项目对你有帮助，欢迎：

- Star 本仓库
- 提交 Issue / PR
- 分享给正在准备求职和面试的朋友

## 📈 Star History

<a href="https://www.star-history.com/?repos=Infinityay%2FFaceTomato&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Infinityay/FaceTomato&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Infinityay/FaceTomato&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Infinityay/FaceTomato&type=date&legend=top-left" />
 </picture>
</a>
