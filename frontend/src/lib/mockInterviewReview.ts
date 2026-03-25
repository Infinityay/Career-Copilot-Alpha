import type { ReviewReportStatus, ReviewSession, ReviewTopicDetail } from "../types/interviewReview";

const withAssessmentFocus = (
  topic: Omit<ReviewTopicDetail, "problems" | "assessmentFocus">
): ReviewTopicDetail => ({
  ...topic,
  problems: (topic.weaknesses ?? []).slice(0, 2),
  assessmentFocus: topic.highlightedPoints,
});

const withTopicDetails = (
  session: Omit<ReviewSession, "topicDetails" | "topics" | "reportStatus"> & {
    reportStatus: ReviewReportStatus;
    topics: ReviewTopicDetail[];
  }
): ReviewSession => ({
  ...session,
  topicDetails: Object.fromEntries(session.topics.map((topic) => [topic.id, topic])),
});

export const reviewSessions: ReviewSession[] = [
  {
    id: "session-frontend-1",
    title: "高级前端工程师模拟面试",
    role: "高级前端工程师",
    round: "技术一面",
    interviewAt: "2026-03-16 19:30",
    reportStatus: "ready",
    defaultSelectedTopicId: "topic-state-management",
    overallScore: 84,
    summary:
      "基础知识扎实，工程化与协作表达清晰，但在性能瓶颈定位与复杂状态一致性问题上还可以进一步展开。",
    strengths: ["表达结构清楚", "项目经验贴近岗位", "能主动补充业务取舍"],
    risks: ["性能优化案例深度一般", "高并发场景拆解略快", "监控闭环展开不够完整"],
    priority: "优先补强性能优化与线上定位能力。",
    topics: [
      withAssessmentFocus({
        id: "topic-react-performance",
        name: "React 性能优化",
        domain: "前端框架",
        score: 78,
        coreQuestion: "你会如何定位一个大型 React 页面首屏慢、交互卡顿的问题？",
        answerHighlights: [
          "我会先看 Network、Performance 和 React Profiler 三层信息，判断瓶颈是在资源、渲染还是交互。",
          "优化上会考虑代码分割、懒加载、图片资源压缩以及缓存策略。",
          "如果是列表场景，我会检查不必要渲染并结合虚拟列表降低开销。"
        ],
        highlightedPoints: ["性能指标基线认知", "瓶颈定位工具链", "渲染与加载优化手段"],
        matchedAnswers: [
          { point: "性能指标基线认知", answerHighlightIndex: null },
          { point: "瓶颈定位工具链", answerHighlightIndex: 0 },
          { point: "渲染与加载优化手段", answerHighlightIndex: 1 }
        ],
        evaluation:
          "回答覆盖了常见优化动作，但对性能指标优先级、问题归因路径和真实案例量化结果的描述仍不够具体。",
        strengths: ["优化思路完整", "工具链熟悉", "兼顾加载与渲染"],
        weaknesses: ["缺少指标基线", "案例量化不足", "CPU/内存视角偏弱"],
        suggestions: [
          "补充 LCP、INP、CLS 等指标和排查顺序。",
          "说明一次线上性能优化前后的量化对比。",
          "补充组件粒度和状态粒度的权衡。"
        ],
        followUps: [
          "如果懒加载后白屏时间变长，你会如何权衡？",
          "你如何判断 useMemo 是否真的带来收益？"
        ],
        optimizedAnswer:
          "我会先界定问题发生在加载、渲染还是交互阶段，再结合 Web Vitals 和埋点数据锁定关键指标。随后使用 DevTools Performance 与 React Profiler 找出长任务、重复渲染和大体积资源，最后再根据瓶颈选择代码分割、虚拟列表、缓存和状态下沉，并给出优化前后的指标对比。"
      }),
      withAssessmentFocus({
        id: "topic-state-management",
        name: "复杂状态管理",
        domain: "工程设计",
        score: 86,
        coreQuestion: "当多个模块共享复杂状态且存在异步更新时，你如何避免状态错乱？",
        answerHighlights: [
          "我会先区分服务端状态和客户端状态，避免把不同生命周期的数据混在一起。",
          "共享状态会尽量通过单向数据流和原子化 store 约束写入。",
          "异步更新需要具备可追踪、可取消和可回放的能力，这样才能处理竞态问题。"
        ],
        highlightedPoints: ["状态边界拆分能力", "异步一致性控制", "共享状态治理方式"],
        matchedAnswers: [
          { point: "状态边界拆分能力", answerHighlightIndex: 0 },
          { point: "异步一致性控制", answerHighlightIndex: 2 },
          { point: "共享状态治理方式", answerHighlightIndex: 1 }
        ],
        evaluation:
          "整体回答成熟，工程设计意识明确；如果补充失败重试、竞态取消和脏数据恢复策略，会更完整。",
        strengths: ["边界划分清晰", "一致性意识强", "考虑了可维护性"],
        weaknesses: ["异常流细节不足", "缺少方案取舍对比"],
        suggestions: [
          "补充请求竞态处理方式，例如 AbortController 或版本号校验。",
          "说明状态归一化和 selector 的使用时机。"
        ],
        followUps: [
          "如果用户快速切换筛选条件导致旧请求回流，应该怎么处理？",
          "什么时候你会放弃全局状态，转而使用局部状态？"
        ],
        optimizedAnswer:
          "我会先按生命周期拆分状态，把服务端数据交给专门的数据层管理，把短生命周期的 UI 状态保留在组件附近。对异步流程增加取消机制或版本号校验，避免旧结果覆盖新状态；对跨模块共享数据则通过只读 selector 暴露，减少多点写入带来的不一致。"
      }),
      withAssessmentFocus({
        id: "topic-system-design",
        name: "前端监控与排障",
        domain: "线上稳定性",
        score: 72,
        coreQuestion: "如果线上用户反馈页面偶发白屏，你会如何构建排查链路？",
        answerHighlights: [
          "我会先确认影响范围、发布时间和出问题的入口页面。",
          "排查时会结合日志、埋点、Sentry 和 source map 去定位具体报错。",
          "如果风险较大，会考虑灰度回滚和临时兜底页来先止损。"
        ],
        highlightedPoints: ["影响范围与版本定位", "监控排查链路", "止损与兜底策略"],
        matchedAnswers: [
          { point: "影响范围与版本定位", answerHighlightIndex: 0 },
          { point: "监控排查链路", answerHighlightIndex: 1 },
          { point: "止损与兜底策略", answerHighlightIndex: 2 }
        ],
        evaluation:
          "方向正确，但排查链路还偏概括，对环境信息采集、灰度止损和恢复入口的展开略少，可信度还有提升空间。",
        strengths: ["知道先定影响面", "熟悉常见监控工具"],
        weaknesses: ["稳定性闭环不完整", "应急流程偏弱", "缺少前端恢复方案"],
        suggestions: [
          "补充版本、设备、网络、入口页等上下文采集。",
          "明确白屏检测和降级策略。",
          "补充回滚与灰度止损流程。"
        ],
        followUps: [
          "白屏监控的误报如何控制？",
          "如果用户已经进入不可恢复状态，前端还能做什么？"
        ],
        optimizedAnswer:
          "我会先确认问题是否与最近发布相关，并按版本、浏览器、系统和入口路径分桶定位影响面。随后结合白屏检测、JS 错误、资源加载失败和路由切换日志还原链路，必要时快速灰度回滚；同时准备兜底页和错误恢复入口，保证用户仍可继续操作。"
      }),
      withAssessmentFocus({
        id: "topic-project-ownership",
        name: "项目负责人能力",
        domain: "项目经验",
        score: 90,
        coreQuestion: "介绍一个你主导推动并落地产生明显业务结果的项目。",
        answerHighlights: [
          "我会先讲清楚项目背景、目标和限制条件，再说明我为什么这样拆优先级。",
          "推进过程中我主动拉齐产品、研发和运营的预期，确保关键依赖同步。",
          "最终我会用结果数据和复盘说明这个项目带来的业务价值。"
        ],
        highlightedPoints: ["背景目标约束拆解", "跨团队推进动作", "结果量化与复盘"],
        matchedAnswers: [
          { point: "背景目标约束拆解", answerHighlightIndex: 0 },
          { point: "跨团队推进动作", answerHighlightIndex: 1 },
          { point: "结果量化与复盘", answerHighlightIndex: 2 }
        ],
        evaluation:
          "这是本场表现最强的部分，叙事完整且结果导向明确。如果补充失败尝试与复盘反思，会更有高级感。",
        strengths: ["结果量化充分", "推进过程清晰", "体现 owner 意识"],
        weaknesses: ["风险预案展开略少"],
        suggestions: ["补充关键冲突与取舍细节。", "增加失败尝试或二次迭代复盘。"],
        followUps: [
          "如果资源被砍半，你会保留哪一部分？",
          "如何判断这个项目值得持续投入？"
        ],
        optimizedAnswer:
          "我会按背景、目标、动作、结果和复盘来讲，重点说明自己如何定义优先级、协调依赖团队，并通过阶段性指标验证方案有效性。这样既能体现推动能力，也能让结果更有说服力。"
      })
    ]
  },
  {
    id: "session-product-ops-1",
    title: "产品运营岗模拟面试",
    role: "产品运营",
    round: "业务面",
    interviewAt: "2026-03-14 15:00",
    reportStatus: "ready",
    defaultSelectedTopicId: "topic-user-growth",
    overallScore: 80,
    summary:
      "用户洞察和活动复盘较好，但数据分析拆解不够细，部分问题仍停留在经验层，没有完全形成指标驱动表达。",
    strengths: ["业务感知较强", "表达自然", "案例贴近真实场景"],
    risks: ["数据归因不够深入", "实验设计意识偏弱", "优先级判断标准不够明确"],
    priority: "优先补强数据分析与实验设计表达。",
    topics: [
      withAssessmentFocus({
        id: "topic-user-growth",
        name: "用户增长拆解",
        domain: "增长分析",
        score: 82,
        coreQuestion: "如果新用户次日留存下降，你会怎么分析？",
        answerHighlights: [
          "我会先看是全量下降还是某一类渠道或版本出现异常。",
          "接着从首日关键行为漏斗入手，看问题出现在注册后哪个环节。",
          "最后结合分群分析和验证实验去判断是 onboarding 还是激励策略出了问题。"
        ],
        highlightedPoints: ["留存问题拆解框架", "用户分群与漏斗意识", "验证实验设计"],
        matchedAnswers: [
          { point: "留存问题拆解框架", answerHighlightIndex: 0 },
          { point: "用户分群与漏斗意识", answerHighlightIndex: 1 },
          { point: "验证实验设计", answerHighlightIndex: 2 }
        ],
        evaluation:
          "整体合格，分析框架有雏形，但对指标路径和验证实验的表达还可以更结构化。",
        strengths: ["思路清晰", "有分群意识"],
        weaknesses: ["验证顺序一般", "缺少实验方案"],
        suggestions: ["使用漏斗和 cohort 明确问题区间。", "给出一到两个可执行的验证实验。"],
        followUps: ["如果没有埋点，你会先补哪些关键事件？"],
        optimizedAnswer:
          "我会先确认下降是全量还是局部分群问题，再用注册到次日关键行为链路定位流失区间，结合渠道、版本和首日行为差异做归因。若怀疑 onboarding 或激励机制变化，再通过灰度或实验验证假设。"
      }),
      withAssessmentFocus({
        id: "topic-campaign-review",
        name: "活动复盘",
        domain: "运营执行",
        score: 88,
        coreQuestion: "如何判断一次拉新活动是否成功？",
        answerHighlights: [
          "我会区分曝光、转化、留存和 ROI，先看目标指标是否达成。",
          "同时会评估目标人群质量和活动成本，避免只看拉新量。",
          "最后根据复购和后续转化判断这次活动是否值得放大。"
        ],
        highlightedPoints: ["活动指标定义", "流量质量与成本评估", "后续迭代与长期价值"],
        matchedAnswers: [
          { point: "活动指标定义", answerHighlightIndex: 0 },
          { point: "流量质量与成本评估", answerHighlightIndex: 1 },
          { point: "后续迭代与长期价值", answerHighlightIndex: 2 }
        ],
        evaluation: "回答成熟，能够兼顾结果和投入，是较强项。",
        strengths: ["指标完整", "结果导向明确", "复盘意识好"],
        weaknesses: ["长期价值衡量还可以再加强"],
        suggestions: ["补充短期转化与长期留存之间的权衡。"],
        followUps: ["如果活动数据很好但复购很差，你会如何解释？"],
        optimizedAnswer:
          "我会先对照活动目标看核心指标是否达成，再把流量质量、转化效率和后续留存拆开，避免被单一拉新量误导。最后结合成本和用户质量评估 ROI，确认是否值得规模化复制。"
      }),
      withAssessmentFocus({
        id: "topic-cross-team",
        name: "跨部门协作",
        domain: "通用能力",
        score: 70,
        coreQuestion: "当产品、研发和运营目标不一致时，你如何推进？",
        answerHighlights: [
          "我会先统一目标，确认这次协作最重要的结果是什么。",
          "然后把冲突点摊开讨论，找到每个团队最担心的风险。"
        ],
        highlightedPoints: ["目标统一与冲突识别", "推进抓手与分阶段方案", "真实案例支撑"],
        matchedAnswers: [
          { point: "目标统一与冲突识别", answerHighlightIndex: 0 },
          { point: "推进抓手与分阶段方案", answerHighlightIndex: null },
          { point: "真实案例支撑", answerHighlightIndex: null }
        ],
        evaluation:
          "表达偏原则化，缺少具体博弈过程和落地动作，可信度一般。",
        strengths: ["态度积极", "知道先对齐目标"],
        weaknesses: ["细节不足", "缺少真实案例", "缺少推进抓手"],
        suggestions: [
          "补充一个真实案例，说明冲突如何被化解。",
          "用优先级、资源、风险三个维度组织回答。"
        ],
        followUps: ["如果关键方始终不配合，你会怎么做？"],
        optimizedAnswer:
          "我会先把争议从立场问题转成目标和约束问题，明确每一方最担心的风险，再把方案拆成可执行阶段，先推进共识最高的一步。这样既能降低协作阻力，也能通过阶段结果反向争取资源。"
      }),
      withAssessmentFocus({
        id: "topic-data-thinking",
        name: "数据分析表达",
        domain: "数据能力",
        score: 76,
        coreQuestion: "你最近一次通过数据发现问题并推动优化的经历是什么？",
        answerHighlights: [
          "我能说明问题背景，以及指标变化对业务的影响。",
          "但我对数据来源、观察周期和口径定义讲得不够完整。"
        ],
        highlightedPoints: ["数据口径定义", "问题定位与归因", "验证与排除偶然波动"],
        matchedAnswers: [
          { point: "数据口径定义", answerHighlightIndex: 1 },
          { point: "问题定位与归因", answerHighlightIndex: 0 },
          { point: "验证与排除偶然波动", answerHighlightIndex: null }
        ],
        evaluation:
          "缺少数据口径、样本范围和判断依据，容易让面试官觉得结论偏经验。",
        strengths: ["能连接业务现象与动作"],
        weaknesses: ["口径不完整", "分析链路偏短"],
        suggestions: [
          "补充数据来源、观察周期和核心指标。",
          "说明如何排除偶然波动。"
        ],
        followUps: ["如何区分相关性和因果性？"],
        optimizedAnswer:
          "我会先明确数据来源、观察周期和核心口径，先确认问题是否稳定存在，再找出影响最大的环节并设计验证动作。最后不仅说明结果变好了，还要说明为什么可以判断这次优化是有效的。"
      })
    ]
  }
].map((session) =>
  withTopicDetails(
    session as Omit<ReviewSession, "topicDetails" | "topics" | "reportStatus"> & {
      reportStatus: ReviewReportStatus;
      topics: ReviewTopicDetail[];
    }
  )
);
