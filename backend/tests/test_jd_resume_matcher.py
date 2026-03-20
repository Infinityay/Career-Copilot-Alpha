import asyncio

from app.schemas.jd import JDData
from app.schemas.jd_match import JDMatchResult
from app.schemas.resume import ResumeData, WorkExperienceItem, EmploymentPeriod, EducationItem, EducationPeriod, ProjectItem, ProjectPeriod
from app.services.jd_resume_matcher import JDResumeMatcher
from app.services.runtime_config import ResolvedRuntimeConfig


def test_flatten_resume_text_excludes_basic_info_skills():
    matcher = JDResumeMatcher.__new__(JDResumeMatcher)
    resume_data = ResumeData(
        workExperience=[
            WorkExperienceItem(
                companyName="Example Corp",
                employmentPeriod=EmploymentPeriod(startDate="2024.01", endDate="至今"),
                title="前端负责人",
                position="前端工程师",
                jobDescription="使用 React 和 TypeScript 负责核心工作台开发",
            )
        ],
        projects=[
            ProjectItem(
                projectName="FaceTamato",
                projectPeriod=ProjectPeriod(startDate="2024.02", endDate="2024.06"),
                role="核心开发",
                companyOrOrganization="个人项目",
                projectDescription="基于 FastAPI 和 React 实现求职辅助平台",
            )
        ],
        education=[
            EducationItem(
                school="示例大学",
                degreeLevel="本科",
                period=EducationPeriod(startDate="2020.09", endDate="2024.06"),
                major="计算机科学与技术",
            )
        ],
    )

    flattened = matcher._flatten_resume_text(resume_data)

    assert "basicInfo.skills" not in flattened
    assert flattened == {
        "workExperience[0].jobDescription": "使用 React 和 TypeScript 负责核心工作台开发",
        "workExperience[0].title": "前端负责人",
        "workExperience[0].position": "前端工程师",
        "projects[0].projectDescription": "基于 FastAPI 和 React 实现求职辅助平台",
        "projects[0].role": "核心开发",
        "education[0].major": "计算机科学与技术",
    }


def test_match_uses_request_scoped_jd_extractor_when_jd_data_missing(monkeypatch):
    matcher = JDResumeMatcher.__new__(JDResumeMatcher)
    matcher.runtime_config = ResolvedRuntimeConfig(
        model_provider="anthropic",
        api_key="runtime-key",
        base_url=None,
        model="claude-sonnet",
    )
    matcher.prompts = {"jdMatch": "prompt"}
    matcher._create_messages = lambda prompt, resume_json, jd_json: [prompt, resume_json, jd_json]
    matcher._calculate_summary = lambda result: result
    matcher._build_regex_diff = lambda result, resume_data, jd_data: type("RegexDiff", (), {"hasDiff": False})()
    matcher.match_llm = object()

    captured = {}

    class StubExtractor:
        def extract_all(self, jd_text: str):
            captured["jd_text"] = jd_text
            return JDData(), 0.12

    def fake_from_runtime_config(runtime_config):
        captured["runtime_config"] = runtime_config
        return StubExtractor()

    monkeypatch.setattr(
        "app.services.jd_resume_matcher.JDExtractor.from_runtime_config",
        fake_from_runtime_config,
    )
    monkeypatch.setattr(
        "app.services.jd_resume_matcher.invoke_with_fallback",
        lambda llm, messages, schema: JDMatchResult(),
    )

    result, elapsed = asyncio.run(matcher.match(ResumeData(), "anthropic jd text", jd_data=None))

    assert result.matches == []
    assert elapsed >= 0
    assert captured["jd_text"] == "anthropic jd text"
    assert captured["runtime_config"] == matcher.runtime_config
