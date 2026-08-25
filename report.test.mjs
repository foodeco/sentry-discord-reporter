import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIssuesUrl,
  chunkDiscordMessages,
  computeWindow,
  extractEventContext,
  normalizeConfig,
  renderProjectIndex,
  renderProjectMarkdown,
  renderReport,
  ruleResult,
  selectIssues,
  stackFrames,
} from "./report.mjs";

test("09시 예약은 전날 20시부터 당일 09시까지 조회한다", () => {
  const window = computeWindow({ slot: "09", now: new Date("2026-08-22T00:05:00.000Z") });
  assert.equal(window.start.toISOString(), "2026-08-21T11:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-22T00:00:00.000Z");
});

test("한 조직의 여러 프로젝트와 환경을 한 Sentry 요청에 넣는다", () => {
  const organization = {
    slug: "weing",
    baseUrl: "https://sentry.io",
    projects: ["api", "web"],
    environments: ["production"],
    query: "is:unresolved",
  };
  const window = { start: new Date("2026-08-21T11:00:00Z"), end: new Date("2026-08-22T00:00:00Z") };
  const url = buildIssuesUrl(organization, window, 30);

  assert.deepEqual(url.searchParams.getAll("project"), ["api", "web"]);
  assert.deepEqual(url.searchParams.getAll("environment"), ["production"]);
  assert.equal(url.searchParams.get("limit"), "30");
});

test("노이즈·낮은 레벨·오래된 이슈를 제거하고 조직별 ID로 중복 제거한다", () => {
  const config = normalizeConfig({
    organizations: [{ slug: "weing", projects: ["api"] }],
    levels: ["error", "fatal"],
    ignoreContains: ["resizeobserver loop"],
    ignoredIssueIds: ["API-99"],
  });
  const organization = config.organizations[0];
  const window = { start: new Date("2026-08-22T00:00:00Z"), end: new Date("2026-08-22T05:00:00Z") };
  const base = { __organization: organization, project: { slug: "api" }, status: "unresolved", count: "1", userCount: 1 };
  const selected = selectIssues([
    { ...base, id: "1", shortId: "API-1", title: "Database unavailable", level: "fatal", firstSeen: "2026-08-22T01:00:00Z", lastSeen: "2026-08-22T02:00:00Z" },
    { ...base, id: "1", shortId: "API-1", title: "Database unavailable", level: "fatal", firstSeen: "2026-08-22T01:00:00Z", lastSeen: "2026-08-22T03:00:00Z" },
    { ...base, id: "2", shortId: "API-2", title: "ResizeObserver loop limit exceeded", level: "error", firstSeen: "2026-08-22T01:00:00Z", lastSeen: "2026-08-22T02:00:00Z" },
    { ...base, id: "3", shortId: "API-3", title: "warning", level: "warning", firstSeen: "2026-08-22T01:00:00Z", lastSeen: "2026-08-22T02:00:00Z" },
    { ...base, id: "4", shortId: "API-99", title: "ignored", level: "error", firstSeen: "2026-08-22T01:00:00Z", lastSeen: "2026-08-22T02:00:00Z" },
    { ...base, id: "5", shortId: "API-5", title: "old", level: "error", firstSeen: "2026-08-20T01:00:00Z", lastSeen: "2026-08-21T23:00:00Z" },
  ], config, window);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].lastSeen, "2026-08-22T03:00:00Z");
});

test("Discord 메시지는 지정 길이를 넘지 않는다", () => {
  const messages = chunkDiscordMessages("header", ["a".repeat(1200), "b".repeat(1200)], 1900);
  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => message.length <= 1900));
});

test("AI로 보낼 이벤트 문맥에서 인증값과 이메일을 마스킹한다", () => {
  const context = extractEventContext({
    title: "Authorization: Bearer top.secret.value",
    message: "user@example.com password=hunter2",
    entries: [],
    tags: [
      ["degraded_mode", "true"],
      ["dependency", "translatable-banner"],
      ["fallback", "empty-list"],
      ["ignored", "value"],
    ],
    contexts: {
      api: {
        source: "ortaclinic",
        endpoint: "/api/banners?token=secret",
        statusCode: 502,
        transportCode: "ERR_BAD_RESPONSE",
      },
    },
  });

  assert.doesNotMatch(context, /top\.secret\.value|user@example\.com|hunter2/);
  assert.match(context, /\[REDACTED\]|\[EMAIL\]/);
  assert.match(context, /degraded_mode=true.*dependency=translatable-banner.*fallback=empty-list/);
  assert.match(context, /API: source=ortaclinic, endpoint=\/api\/banners, status=502, transport=ERR_BAD_RESPONSE/);
  assert.doesNotMatch(context, /ignored=value|token=secret/);
});

test("Sentry 스택 경로를 커밋 소스 경로와 줄 번호로 정규화한다", () => {
  const frames = stackFrames({
    eventContext: "- E:\\weing_repo\\api\\src\\client.ts:42 getOne | await request()\n- webpack-internal:///(rsc)/./src/app/page.tsx:9 Page",
  });

  assert.deepEqual(frames, [
    { path: "src/client.ts", line: 42, symbol: "getOne" },
    { path: "src/app/page.tsx", line: 9, symbol: "Page" },
  ]);
});

test("명시적 폴백으로 처리된 신규 오류를 P2로 분류한다", () => {
  const window = { start: new Date("2026-08-22T00:00:00Z"), end: new Date("2026-08-22T03:00:00Z") };
  const result = ruleResult({
    __organization: { slug: "weing" },
    id: "1",
    level: "error",
    firstSeen: "2026-08-22T01:00:00Z",
    count: "3",
    eventContext: "Tags: degraded_mode=true, dependency=translatable-banner, fallback=empty-list",
  }, window);

  assert.equal(result.priority, "P2");
  assert.match(result.reason, /신규.*폴백 처리.*구간 3건/);
});

test("AI 분석 결과를 원인과 조치로 구분해 Discord에 표시한다", () => {
  const organization = { slug: "weing" };
  const issue = {
    __organization: organization,
    id: "1",
    shortId: "API-1",
    project: { slug: "api" },
    title: "Database unavailable",
    level: "error",
    count: "3",
    userCount: 2,
    lastSeen: "2026-08-22T02:00:00Z",
    permalink: "https://sentry.io/issues/1",
  };
  const analysis = {
    mode: "Codex CLI (ChatGPT)",
    summary: "DB 연결 오류",
    issues: [{
      issueKey: "weing:1",
      priority: "P1",
      noise: false,
      reason: "신규 오류",
      analysis: "연결 풀이 고갈된 것으로 추정됩니다.",
      nextAction: "풀 사용량을 확인하고 누수를 수정한 뒤 부하 테스트하세요.",
    }],
  };
  const window = { start: new Date("2026-08-22T00:00:00Z"), end: new Date("2026-08-22T03:00:00Z") };

  const report = renderReport([issue], analysis, window).join("\n");

  assert.match(report, /원인: 연결 풀이 고갈/);
  assert.match(report, /조치: 풀 사용량을 확인/);
});

test("프로젝트별 Markdown에 현황, 원인, 조치와 Sentry 링크를 종합한다", () => {
  const organization = { slug: "weing" };
  const issue = {
    __organization: organization,
    id: "1",
    shortId: "API-1",
    project: { slug: "api" },
    title: "Database unavailable",
    level: "error",
    count: "8",
    userCount: 3,
    firstSeen: "2026-08-22T01:00:00Z",
    lastSeen: "2026-08-22T02:00:00Z",
    permalink: "https://sentry.io/issues/1",
  };
  const result = {
    key: "weing/api",
    organization: "weing",
    project: "api",
    issues: [issue],
    sourceRoot: "../api",
    analysis: {
      mode: "Codex CLI + source@1234567",
      sourceCommit: "1234567890abcdef",
      summary: "DB 연결 실패가 집중 발생했습니다.",
      issues: [{
        issueKey: "weing:1",
        priority: "P1",
        noise: false,
        reason: "영향 사용자 3명",
        analysis: "src/db.ts의 connect 호출에서 풀이 고갈된 것으로 추정됩니다.",
        nextAction: "풀 사용량을 확인하고 복구 테스트를 실행하세요.",
      }],
    },
  };
  const window = { start: new Date("2026-08-22T00:00:00Z"), end: new Date("2026-08-22T03:00:00Z") };

  const report = renderProjectMarkdown(result, window);
  const index = renderProjectIndex([result], window);

  assert.match(report, /보고 1건.*P1 1.*구간 이벤트 8건/);
  assert.match(report, /추정 원인: src\/db\.ts/);
  assert.match(report, /권장 조치: 풀 사용량/);
  assert.match(report, /\[API-1\]\(https:\/\/sentry\.io\/issues\/1\)/);
  assert.match(index, /\.\/weing__api\.md/);
});
