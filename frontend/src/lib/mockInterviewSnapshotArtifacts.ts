import type { MockInterviewRound, MockInterviewSessionSnapshot } from "../types/mockInterview";
import type {
  ReviewReportStatus,
  ReviewSessionDetail,
  ReviewTopic,
  ReviewTopicDetail,
} from "../types/interviewReview";

type TranscriptBucket = { assistant: string[]; user: string[] };

export function formatSnapshotInterviewAt(value: string) {
  return new Date(value)
    .toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\//g, "-");
}

export function getSnapshotRole(snapshot: MockInterviewSessionSnapshot) {
  return (
    snapshot.jdData?.basicInfo.jobTitle ||
    snapshot.resumeSnapshot.basicInfo.desiredPosition ||
    snapshot.category
  );
}

function scoreTopicFromAnswers(answers: string[]) {
  if (answers.length === 0) {
    return 58;
  }

  const totalChars = answers.reduce((sum, answer) => sum + answer.trim().length, 0);
  const avgChars = totalChars / Math.max(answers.length, 1);
  return Math.max(
    58,
    Math.min(90, 62 + Math.min(18, Math.floor(avgChars / 18)) + Math.min(12, answers.length * 4))
  );
}

function buildHighlightedPoints(topicName: string) {
  const lowered = topicName.toLowerCase();
  if (lowered.includes("opening") || topicName.includes("开场")) {
    return ["背景与岗位匹配", "表达结构清晰度", "求职动机"];
  }
  if (lowered.includes("project") || topicName.includes("项目")) {
    return ["项目背景与目标", "个人职责边界", "结果与量化指标"];
  }
  if (lowered.includes("coding") || lowered.includes("code") || topicName.includes("代码")) {
    return ["思路拆解", "复杂度意识", "边界处理"];
  }
  return ["问题拆解框架", "关键取舍说明", "结果验证方式"];
}

function buildTopicDomain(topicName: string) {
  const lowered = topicName.toLowerCase();
  if (lowered.includes("opening") || topicName.includes("开场")) {
    return "基础沟通";
  }
  if (lowered.includes("project") || topicName.includes("项目")) {
    return "项目经验";
  }
  if (lowered.includes("coding") || lowered.includes("code") || topicName.includes("代码")) {
    return "编码能力";
  }
  return "能力评估";
}

function buildOutlineForReview(snapshot: MockInterviewSessionSnapshot): MockInterviewRound[] {
  if (snapshot.interviewPlan.plan.length > 0) {
    return snapshot.interviewPlan.plan;
  }

  return snapshot.messages
    .filter((message) => message.role === "assistant")
    .map((message, index) => ({
      round: index + 1,
      topic: `面试主题 ${index + 1}`,
      description: message.content,
    }));
}

function splitMessagesByOutline(snapshot: MockInterviewSessionSnapshot, outline: MockInterviewRound[]): TranscriptBucket[] {
  const buckets = outline.map(() => ({ assistant: [] as string[], user: [] as string[] }));
  if (buckets.length === 0) {
    return [];
  }

  const transcript = [...snapshot.messages];
  let pointer = 0;

  for (let roundIndex = 0; roundIndex < outline.length; roundIndex += 1) {
    let questionsLeft = Math.max(0, snapshot.interviewState.questionsPerRound[String(roundIndex + 1)] ?? 0);

    while (pointer < transcript.length && questionsLeft > 0) {
      const message = transcript[pointer];
      pointer += 1;

      if (message.role === "assistant") {
        buckets[roundIndex].assistant.push(message.content);
        questionsLeft -= 1;

        while (pointer < transcript.length && transcript[pointer].role !== "assistant") {
          if (transcript[pointer].role === "user") {
            buckets[roundIndex].user.push(transcript[pointer].content);
          }
          pointer += 1;
        }
      } else if (message.role === "user") {
        buckets[roundIndex].user.push(message.content);
      }
    }
  }

  while (pointer < transcript.length) {
    const message = transcript[pointer];
    pointer += 1;
    const targetIndex = Math.max(0, Math.min(outline.length - 1, snapshot.interviewState.currentRound - 1));
    buckets[targetIndex][message.role === "user" ? "user" : "assistant"].push(message.content);
  }

  return buckets;
}

function buildTopic(
  sessionId: string,
  round: MockInterviewRound,
  index: number,
  bucket: TranscriptBucket
): ReviewTopicDetail {
  const answerHighlights = bucket.user.slice(0, 3);
  const fallbackAnswers =
    answerHighlights.length > 0 ? answerHighlights : [`当前主题 ${round.topic} 还没有足够的候选人回答沉淀。`];
  const highlightedPoints = buildHighlightedPoints(round.topic);
  const score = scoreTopicFromAnswers(bucket.user);

  return {
    id: `topic-${sessionId}-${index + 1}`,
    name: round.topic,
    domain: buildTopicDomain(round.topic),
    score,
    coreQuestion: bucket.assistant[0] ?? round.description,
    problems:
      bucket.user.length >= 2
        ? [`${round.topic} 缺少更明确的量化结果。`, "案例和方法之间的因果关系还可以更清晰。"]
        : [`${round.topic} 的回答展开不足。`, "缺少足够多的真实场景细节。"],
    assessmentFocus: highlightedPoints,
    answerHighlights: fallbackAnswers,
    highlightedPoints,
    matchedAnswers: highlightedPoints.map((point, pointIndex) => ({
      point,
      answerHighlightIndex: pointIndex < fallbackAnswers.length ? pointIndex : null,
    })),
    evaluation: `${round.topic} 这一题整体完成度为 ${score} 分。当前回答${bucket.user.length > 0 ? "具备基本结构" : "仍然偏空"}，建议继续围绕案例细节、指标和取舍表达做增强。`,
    strengths:
      bucket.user.length > 0
        ? [
            `${round.topic} 已经给出了连续的回答脉络。`,
            "能够围绕问题主线展开，而不是只回答结论。",
            "回答中开始体现出一定的复盘和总结意识。",
          ]
        : [`${round.topic} 的基础理解还在，但表达素材不够充分。`],
    weaknesses:
      bucket.user.length >= 2
        ? [
            `${round.topic} 缺少更明确的量化结果。`,
            "案例和方法之间的因果关系还可以更清晰。",
            "还没有把取舍逻辑讲透。",
          ]
        : [`${round.topic} 的回答展开不足。`, "缺少足够多的真实场景细节。"],
    suggestions: [
      `先用 1 句话讲清 ${round.topic} 的问题背景，再展开过程。`,
      "补充一个真实案例，避免回答停留在抽象层。",
      "最后落到结果、指标或复盘结论上。",
    ],
    followUps: [
      `如果面试官继续追问 ${round.topic}，你会优先补充什么？`,
      "这个回答里最能体现你个人判断的一步是什么？",
    ],
    optimizedAnswer:
      bucket.user.length > 0
        ? `关于 ${round.topic}，我会先明确背景和目标，再按分析框架展开关键决策、实际动作和验证结果。如果有权衡，我会补充为什么选择当前方案，以及最终带来了什么可量化的收益。`
        : `关于 ${round.topic}，我会先补上背景、目标和限制条件，再说明我的处理方法、关键取舍和最终结果，避免只停留在概念层。`,
  };
}

export function buildInterviewReviewFromSnapshot(
  snapshot: MockInterviewSessionSnapshot,
  reportStatus: ReviewReportStatus = "pending"
): ReviewSessionDetail {
  const outline = buildOutlineForReview(snapshot);
  const buckets = splitMessagesByOutline(snapshot, outline);
  const topicDetails = outline.map((round, index) =>
    buildTopic(snapshot.sessionId, round, index, buckets[index] ?? { assistant: [], user: [] })
  );
  const topics: ReviewTopic[] = topicDetails.map((topic) => ({
    id: topic.id,
    name: topic.name,
    domain: topic.domain,
    score: topic.score,
    coreQuestion: topic.coreQuestion,
    evaluation: topic.evaluation,
    problems: topic.problems,
  }));
  const overallScore = Math.round(
    topics.reduce((sum, topic) => sum + topic.score, 0) / Math.max(topics.length, 1)
  );
  const strongest = [...topics].sort((a, b) => b.score - a.score)[0];
  const weakest = [...topics].sort((a, b) => a.score - b.score)[0];
  const role = getSnapshotRole(snapshot);

  return {
    id: snapshot.sessionId,
    title: `${role}模拟面试复盘`,
    role,
    round: "模拟面试",
    interviewAt: formatSnapshotInterviewAt(snapshot.createdAt),
    reportStatus,
    defaultSelectedTopicId: topics[0]?.id ?? null,
    overallScore,
    summary: `${role} 模拟面试已完成结构化复盘。整体回答在 ${strongest?.name ?? "当前主题"} 上更稳定，但 ${weakest?.name ?? "薄弱主题"} 仍需要补充更多分析过程、结果验证和真实案例。`,
    strengths: [
      `${strongest?.name ?? "当前强项"} 的回答结构相对完整。`,
      "能够围绕问题主线给出连续表达，而不是只堆概念。",
      "多数回答已经体现出一定的问题拆解意识。",
    ],
    risks: [
      `${weakest?.name ?? "当前弱项"} 的答案仍偏概括，缺少更强的结论支撑。`,
      "量化结果、指标验证和取舍表达还不够稳定。",
      "部分回答更像经验总结，案例细节还可以再落地。",
    ],
    priority: `优先补强 ${weakest?.name ?? "当前弱项"}，并把 ${strongest?.name ?? "强项"} 的回答模板复用到其他 Topic。`,
    topics,
    topicDetails: Object.fromEntries(topicDetails.map((topic) => [topic.id, topic])),
  };
}

export function buildMockInterviewTranscriptMarkdown(snapshot: MockInterviewSessionSnapshot): string {
  const exportedAt = new Date().toISOString();
  const jdText = snapshot.jdText.trim();
  const transcript = snapshot.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => {
      const speaker = message.role === "assistant" ? "面试官问" : "候选人答";
      return `${speaker}\n${message.content.trim()}`;
    })
    .join("\n\n");

  return [
    "# 本轮面试基础信息",
    "",
    `- 面试岗位：${snapshot.category}`,
    `- 面试类型：${snapshot.interviewType}`,
    `- 导出时间：${exportedAt}`,
    "",
    "## 面试 JD",
    "",
    jdText || "未提供 JD 信息",
    "",
    "## 面试对话",
    "",
    "```text",
    transcript,
    "```",
  ].join("\n\n").trimEnd() + "\n";
}
