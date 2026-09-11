import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIssuesUrl,
  chunkDiscordMessages,
  computeWindow,
  extractEventContext,
  fetchIssueEvidence,
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

test("20시 예약은 당일 09시부터 20시까지 조회한다", () => {
  const window = computeWindow({ slot: "20", now: new Date("2026-08-22T11:05:00.000Z") });
  assert.equal(window.start.toISOString(), "2026-08-22T00:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-22T11:00:00.000Z");
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
  assert.equal(buildIssuesUrl(organization, window, 30, new Set(["error", "fatal"])).searchParams.get("query"), "is:unresolved level:[error,fatal]");
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
  assert.deepEqual(stackFrames({
    eventContext: "AI 입력에서 잘린 스택",
    eventEvidence: { samples: [{ context: `${"transport stack\n".repeat(200)}- src/app/page.tsx:42 Page | inApp=true column=4` }] },
  }), [{ path: "src/app/page.tsx", line: 42, symbol: "Page" }]);
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

test("혼합 오류의 일부 폴백 태그로 전체 이슈의 우선순위를 낮추지 않는다", () => {
  const window = { start: new Date("2026-09-10T11:00:00Z"), end: new Date("2026-09-11T00:00:00Z") };
  const issue = {
    __organization: { slug: "weing" }, id: "1", level: "error", priority: "high", count: "2",
    eventContext: "Tags: degraded_mode=true",
    eventEvidence: { listedCount: 2, complete: true, fallbackCount: 1, variants: [["error · timeout", 2]], samples: [] },
  };
  assert.equal(ruleResult(issue, window).priority, "P1");
  issue.eventEvidence.fallbackCount = 2;
  assert.equal(ruleResult(issue, window).priority, "P2");
  issue.eventEvidence.complete = false;
  assert.equal(ruleResult(issue, window).priority, "P1");
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

test("구간 페이지의 희귀 500·HEAD와 혼합 레벨을 원문·진단 근거로 보고하고 비밀값은 제외한다", async (t) => {
  const window = { start: new Date("2026-09-10T11:00:00Z"), end: new Date("2026-09-11T00:00:00Z") };
  const issue = {
    __organization: { slug: "weing", baseUrl: "https://sentry.io", environments: ["production"] },
    project: { slug: "web" }, id: "1", shortId: "WEB-1", title: "AxiosError: Request failed with status code 500",
    count: "37", level: "error", firstSeen: "2026-09-09T00:00:00Z", lastSeen: "2026-09-10T23:00:00Z",
    permalink: "https://sentry.io/issues/1",
  };
  const event = (id, status, method = "GET") => ({
    eventID: id, dateCreated: "2026-09-10T20:34:21Z", title: `AxiosError: Request failed with status code ${status}`,
    tags: [{ key: "level", value: status === 500 ? "error" : "warning" }, { key: "transaction", value: `${method} /ko?token=path-secret` }],
  });
  const warnings = Array.from({ length: 35 }, (_, index) => event(String(index + 1), 404));
  const rare = event("500", 500);
  const head = event("501", 500, "HEAD");
  const requested = [];
  let listCalls = 0;
  const traceCache = new Map();
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    requested.push(url);
    if (url.pathname.endsWith("/events/")) {
      listCalls += 1;
      assert.equal(url.searchParams.get("start"), window.start.toISOString());
      assert.equal(url.searchParams.get("end"), window.end.toISOString());
      assert.deepEqual(url.searchParams.getAll("environment"), ["production"]);
      if (!url.searchParams.has("cursor")) return Response.json(warnings, { headers: { link: '<https://untrusted.invalid/>; rel="next"; results="true"; cursor="page2"' } });
      return Response.json([warnings[0], rare, head, { ...event("old", 500), dateCreated: "2026-09-09T00:00:00Z" }, { ...event("future", 500), dateCreated: window.end.toISOString() }]);
    }
    if (url.pathname.includes("/trace/")) return Response.json({ detail: "Forbidden" }, { status: 403 });
    if (url.pathname.endsWith("/source-map-debug/")) return Response.json({
      has_debug_ids: true, project_has_some_artifact_bundle: false, release_has_some_artifact: false,
      exceptions: [{ frames: [{ debug_id_process: { debug_id: "abc", uploaded_source_map_with_correct_debug_id: false } }] }],
    });
    const id = url.pathname.split("/").at(-2);
    assert.ok(!["latest", "old", "future"].includes(id));
    const original = [rare, head, ...warnings].find((candidate) => candidate.eventID === id);
    return Response.json({
      ...original,
      contexts: {
        api: { method: "GET", endpoint: "/api/places/123?token=endpoint-secret", status: id === "500" ? 500 : 404,
          params: { locale: "ko", patientName: "private-patient" },
          response: { code: "UNKNOWN", detail: 'Connection prematurely closed BEFORE response user@example.com {"token":"json-secret"} </pre><script>untrusted()</script>', patientName: "private-patient" },
        },
        trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) },
      },
      entries: [
        { type: "request", data: { method: "GET", url: "https://name:url-secret@example.com/ko?token=query-secret", headers: [["Authorization", "header-secret"]], cookies: "cookie-secret", data: "body-secret" } },
        { type: "exception", data: { values: [{ type: "AxiosError", value: "Request failed", stacktrace: { frames: [{ filename: "server/chunk.js", lineNo: 8, inApp: false, function: "request" }, { filename: "src/page.tsx", lineNo: 4, inApp: true, function: "Page" }] } }] } },
        { type: "breadcrumbs", data: { values: [{ type: "http", timestamp: "2026-09-10T20:34:20Z", data: { method: "GET", url: encodeURIComponent("https://example.com/api/places?cid=crumb-secret&token=encoded-secret"), status_code: 500, body: "crumb-body-secret" } }] } },
      ],
      errors: [{ type: "js_no_source", message: "Source code was not found" }],
    });
  });
  const evidence = await fetchIssueEvidence(issue, "unused-test-token", window, traceCache);
  assert.equal(listCalls, 2);
  assert.equal(evidence.listedCount, 37);
  assert.equal(evidence.complete, true);
  assert.deepEqual(evidence.variants, [["warning · AxiosError: Request failed with status code 404", 35], ["error · AxiosError: Request failed with status code 500", 2]]);
  assert.deepEqual(evidence.methods, [["GET", 36], ["HEAD", 1]]);
  assert.equal(evidence.samples[0].id, "500");
  assert.ok(evidence.samples.some((sample) => sample.id === "501"));
  assert.ok(requested.every((url) => url.origin === "https://sentry.io"));
  assert.match(evidence.samples[0].diagnostics, /HTTP 403.*org:read/);
  assert.match(evidence.samples[0].diagnostics, /artifact bundle=false.*누락=1\/1/);
  const enriched = { ...issue, eventEvidence: evidence };
  const analysis = ruleResult(enriched, window);
  const result = { key: "weing/web", issues: [enriched], analysis: { mode: "rules-fallback", summary: "혼합 오류", issues: [analysis] } };
  const report = renderProjectMarkdown(result, window);
  assert.match(report, /404 → 35건/);
  assert.match(report, /status=500/);
  assert.match(report, /Connection prematurely closed BEFORE response/);
  assert.match(report, /server\/chunk\.js:8 request/);
  assert.match(report, /src\/page\.tsx:4 Page/);
  assert.match(report, /Breadcrumbs: 통신·이동 1건/);
  assert.match(report, /&lt;\/pre&gt;&lt;script&gt;/);
  assert.doesNotMatch(report, /<script>|private-patient|user@example\.com|(?:path|endpoint|json|url|query|header|cookie|body|crumb|encoded)-secret|crumb-body-secret/);
  assert.match(report, /https:\/\/example\.com\/api\/places 500/);
  assert.match(renderReport([enriched], result.analysis, window).join("\n"), /이벤트 분포:.*404 35건/);
  analysis.noise = true;
  assert.match(renderProjectMarkdown(result, window), /대표 이벤트 1/);
  await fetchIssueEvidence(issue, "unused-test-token", window, traceCache);
  assert.equal(requested.filter((url) => url.pathname.includes("/trace/")).length, 1);
});

test("이벤트 페이지 일부 실패를 전체 통계로 표시하지 않고 수집된 Trace span을 보존한다", async (t) => {
  const window = { start: new Date("2026-09-10T11:00:00Z"), end: new Date("2026-09-11T00:00:00Z") };
  const issue = { __organization: { slug: "weing", baseUrl: "https://sentry.io", environments: [] }, project: { slug: "web" }, id: "1", count: "2" };
  const event = { eventID: "1", dateCreated: "2026-09-10T21:00:00Z", title: "timeout", tags: [{ key: "level", value: "error" }] };
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    if (url.searchParams.has("cursor")) return Response.json({ detail: "Forbidden" }, { status: 403 });
    if (url.pathname.endsWith("/events/")) return Response.json([event], { headers: { link: '<https://sentry.io/>; rel="next"; results="true"; cursor="next"' } });
    if (url.pathname.includes("/trace/")) return Response.json([{ event_type: "span", project_slug: "api", op: "http.server", duration: 10010, errors: [{ event_id: "e" }], children: [{ event_type: "span", project_slug: "api", op: "db", duration: 9900 }] }]);
    return Response.json({ ...event, contexts: { trace: { trace_id: "c".repeat(32) } } });
  });
  const evidence = await fetchIssueEvidence(issue, "unused-test-token", window);
  assert.equal(evidence.complete, false);
  assert.equal(evidence.listedCount, 1);
  assert.match(evidence.limitations.join("\n"), /조회 실패.*403/);
  assert.match(evidence.limitations.join("\n"), /그룹 집계 2건과 조회 이벤트 1건/);
  assert.match(evidence.samples[0].diagnostics, /span 2건 · 연결 오류 1건/);
  assert.match(evidence.samples[0].diagnostics, /api · db · 9900ms/);
});

test("구간에 error가 있는 warning 그룹을 유지하고 과거 이슈를 신규로 오분류하지 않는다", () => {
  const config = normalizeConfig({ organizations: [{ slug: "weing", projects: ["web"] }] });
  const window = { start: new Date("2026-09-10T11:00:00Z"), end: new Date("2026-09-11T00:00:00Z") };
  const issue = {
    __organization: config.organizations[0], __levelFiltered: true, id: "1", level: "warning", status: "unresolved", count: "36",
    firstSeen: "2026-09-10T11:05:00Z", lastSeen: "2026-09-10T23:00:00Z", lifetime: { firstSeen: "2026-09-09T00:00:00Z" },
    eventEvidence: { variants: [["warning · 404", 35], ["error · 500", 1]], samples: [] },
  };
  assert.equal(selectIssues([issue], config, window).length, 1);
  const result = ruleResult(issue, window);
  assert.equal(result.priority, "P2");
  assert.doesNotMatch(result.reason, /신규/);
});
