import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIssuesUrl,
  chunkDiscordMessages,
  computeWindow,
  extractEventContext,
  normalizeConfig,
  selectIssues,
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
  });

  assert.doesNotMatch(context, /top\.secret\.value|user@example\.com|hunter2/);
  assert.match(context, /\[REDACTED\]|\[EMAIL\]/);
});
