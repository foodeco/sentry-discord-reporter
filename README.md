# Sentry Discord Reporter

여러 Sentry 조직과 프로젝트의 오류를 모아 노이즈를 제거하고 Discord로 전송하는 독립 실행형 Node.js 리포터입니다.

## 현재 상태

- Sentry 이슈·조회 구간 이벤트 목록·대표 이벤트 원문 조회
- Discord Webhook 조회·실제 메시지 전송 검증 완료
- 수동 실행 및 로컬 Codex AI 원인·조치 분석 가능
- 프로젝트별 Markdown에 이벤트 분포·응답 오류·스택·Breadcrumbs·Trace/소스맵 진단 수록
- Discord에는 전체 현황, 프로젝트별 종합 요약, 우선 확인할 Sentry 링크 전송
- Orca 자동화 예약: 매일 09:00, 20:00 KST

로컬 소스가 연결된 프로젝트는 Codex CLI로 커밋 소스와 Sentry 이벤트를 함께 분석합니다. 소스 분석을 사용할 수 없으면 설정된 OpenAI API 또는 로컬 Codex CLI로 Sentry 이벤트를 분석합니다. AI 분석이 실패하면 규칙 기반 리포트를 생성합니다.

## 요구 사항

- Node.js 22 이상
- 조직별 Sentry Auth Token
- Discord Incoming Webhook URL
- 선택: ChatGPT로 로그인한 Codex CLI 또는 OpenAI API Key

외부 npm 패키지와 상시 실행 서버는 필요하지 않습니다.

## 설정

### 1. 환경변수

```powershell
Copy-Item .env.example .env
```

여러 조직을 조회할 때는 `.env`에 조직 slug별 토큰을 JSON으로 입력합니다.

```env
SENTRY_AUTH_TOKEN=
SENTRY_TOKENS_JSON={"org-a":"auth-token-a","org-b":"auth-token-b"}
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
CODEX_CLI_ANALYSIS=1
# 비우면 조회된 이슈를 모두 보고합니다. 숫자를 넣으면 그 건수만 우선순위로 남깁니다.
# MAX_ISSUES_PER_RUN=
REPORTS_DIR=reports
DRY_RUN=0
```

조직이 하나일 때만 `SENTRY_AUTH_TOKEN`을 사용합니다. 조직이 여러 개면 `SENTRY_AUTH_TOKEN`은 무시되고 `SENTRY_TOKENS_JSON`이 사용됩니다.

`.env`는 Git에서 제외되어 있습니다. 실제 비밀값을 `.env.example`, README, 커밋 또는 이슈에 기록하지 마세요.

### 2. Sentry Auth Token

조직마다 다음 순서로 생성합니다.

1. **Organization Settings → Custom Integrations**로 이동합니다.
2. Internal Integration을 생성하거나 선택합니다.
3. **Issue & Event: Read**를 설정합니다. Trace 조회에는 **Organization: Read**, 소스맵 진단에는 **Project: Read**도 설정하고 저장합니다.
4. 화면의 **New Token**을 눌러 Auth Token을 생성합니다.
5. 생성된 Token을 `SENTRY_TOKENS_JSON`의 해당 조직 slug에 입력합니다.

화면 아래의 **Client Secret은 API Auth Token이 아니며 이 프로젝트에서 사용하지 않습니다.** DSN도 오류 수집 SDK용 값이므로 사용하지 않습니다.

- [Sentry Auth Token 생성](https://docs.sentry.io/api/guides/create-auth-token/)
- [Organization Issues API](https://docs.sentry.io/api/events/list-an-organizations-issues/)

### 3. Discord Webhook

Discord 채널의 **채널 편집 → 연동 → 웹후크 → 새 웹후크 → 웹후크 URL 복사**에서 발급합니다. Webhook URL 자체가 비밀값입니다.

- [Discord Webhooks](https://docs.discord.com/developers/platform/webhooks)

### 4. 조회 대상

조직과 프로젝트는 `targets.json`에서 관리합니다.

```json
{
  "organizations": [
    {
      "slug": "my-organization",
      "baseUrl": "https://sentry.io",
      "projects": ["web", "admin", "api"],
      "environments": ["production"],
      "query": "is:unresolved"
    }
  ],
  "sourceRoots": {
    "my-organization/web": "../web",
    "my-organization/admin": "../admin",
    "my-organization/api": "../api"
  },
  "levels": ["error", "fatal"],
  "ignoreContains": ["무시할 오류 문구"],
  "ignoredIssueIds": ["PROJECT-123"]
}
```

- 조직 slug: Sentry Organization Settings에서 확인
- 프로젝트 slug: **Settings → Projects → 프로젝트 → General Settings**에서 확인
- 환경 이름: Issues 화면의 Environment 필터에서 확인
- US/DE 리전 또는 Self-hosted 사용 시 `baseUrl`을 해당 API 호스트로 변경
- `sourceRoots`: 선택 사항. `조직-slug/프로젝트-slug`를 키로 하고 이 저장소 기준 소스 경로를 값으로 지정

`sourceRoots`가 연결된 로컬 실행은 Sentry 스택과 일치하는 현재 `HEAD`의 코드 구간만 Git으로 추출·마스킹해 분석 입력에 포함합니다. 소스 저장소의 미커밋 파일은 읽거나 수정하지 않습니다.

모노레포는 해당 앱 디렉터리를 지정합니다. 현재 도레는 로컬 `weing-admin-mono`(origin: `weing-front/weing-medical`)의 `apps/dore-client`, `apps/dore-admin`에 연결되어 있습니다. Sentry `release`와 로컬 `HEAD`가 다르면 배포 당시 코드와의 추가 대조가 필요합니다.

## 실행

### 즉시 Discord 전송

`.env`의 `DRY_RUN=0` 상태에서 실행합니다.

```powershell
npm start
```

기본 수동 조회 범위는 최근 24시간입니다.

보고가 0건인 프로젝트는 조회 종료 시각 전 14일 범위에서 마지막 저장 이벤트를 추가 확인합니다. 설정한 환경을 유지하고 레벨·해결 상태 필터를 해제해, 보고 대상이 없는 경우와 저장 이벤트 자체가 없는 경우를 Markdown·Discord에서 구분합니다. 마지막 시각은 저장된 이벤트의 발생 시각이며 실제 무발생과 수집 중단을 확정적으로 구별하지는 않습니다. 조회 권한이나 API 오류는 `수집 상태 미확인`으로 표시합니다. 할당량은 별도 조회하지 않으므로 Sentry Subscription/Stats에서 확인해야 합니다. 이 확인은 Errors 이벤트 대상이며 Spans 수집 상태를 나타내지 않습니다.

### 조회 범위 지정

```powershell
$env:LOOKBACK_HOURS = "6"
npm start
Remove-Item Env:LOOKBACK_HOURS
```

### Discord 전송 없이 확인

```powershell
$env:DRY_RUN = "1"
npm start
Remove-Item Env:DRY_RUN
```

프로세스 환경변수는 `.env`보다 우선합니다.

실행할 때마다 `reports/YYYY-MM-DD/HHmm/index.md`와 프로젝트별 상세 문서가 생성됩니다. 인덱스에는 프로젝트별 P0~P3, 노이즈, 이벤트 수와 요약이 표시되고, 상세 문서에는 각 이슈의 관측 사실·추정 원인·권장 조치·Sentry 링크가 기록됩니다. `REPORTS_DIR`로 출력 루트를 바꿀 수 있습니다.

Discord 리포트는 전체 이슈 수와 P0/P1 현황으로 시작합니다. 프로젝트별로 공통 증상과 우선 조치를 요약하고, 확보한 이벤트 중 많이 관측된 유형 최대 3개와 P0/P1 이슈 최대 3개의 확인 링크를 표시합니다. 예약 실패 이슈 수와 대표 워크플로 결과, 보고 0건 프로젝트의 수집 상태도 함께 표시합니다. AI를 사용할 수 없는 실행은 집계와 관측 결과를 보냅니다.

### 상세 근거 수집

리포트 조회 구간의 이벤트를 페이지 단위로 읽습니다. 이슈의 대표 제목과 전체 건수만으로 오류 유형을 판단하지 않습니다. 예를 들어 제목이 `status code 500`인 그룹 안에 `404 warning 35건 + 500 error 1건`이 있으면 두 유형의 건수를 따로 표시합니다. 구간 밖의 `events/latest/`는 사용하지 않습니다.

보고 대상의 레벨 조건은 Sentry 검색 `level:[error,fatal]`처럼 구간 이벤트에 적용합니다. 그룹의 대표 레벨이 나중에 warning으로 바뀌어도 구간 안의 error가 누락되지 않습니다. 신규 여부는 전체 이력의 `lifetime.firstSeen`을 우선 사용하고 구간 첫 발생과 구분합니다. 조직 설정당 이슈 최대 100건을 조회하고, `MAX_ISSUES_PER_RUN`을 비우면 그 후보를 모두 보고합니다. 값을 지정하면 그 건수만 우선순위에 따라 남깁니다.

예약 API 실패는 원본이 `warning`이어도 별도로 수집해 **최소 P1로 보고**합니다. `api_source` 태그가 있는 warning을 조직 설정당 최대 100그룹 조회하고, 대표 이벤트의 실제 API endpoint에 `/reservation`, `/reservations`, `/reservation-api/` 경로가 있는지 확인합니다. 예약 생성·조회·연결 API가 대상이며, 예약 페이지에서 발생한 단순 입력 누락 경고는 이 예외에 포함하지 않습니다. 예약 API 오류는 AI가 노이즈나 낮은 우선순위로 분류해도 보고에 유지합니다. 명시한 무시 규칙과 해결 상태 필터는 유지합니다. `MAX_ISSUES_PER_RUN`을 지정한 경우에만 최종 보고 건수를 제한하며, Sentry 원본 레벨은 변경하지 않습니다.

`operation=cart-reservation.submit`인 예약 워크플로 오류도 최소 P1로 보고합니다. 스마트닥터·위잉의 예약 확인 방향, 실패 단계·상태·사유와 Sentry 이벤트 링크를 표시합니다. `smart-doctor-only`나 `none`은 응답으로 확인한 결과이며, 타임아웃 시 실제 DB에 예약이 없다는 뜻은 아닙니다. 복구용 고객번호·이름·연락처는 Sentry에서 확인하고 Discord·AI 입력에는 복제하지 않습니다.

`MAX_ISSUES_PER_RUN`을 지정하면 P0, 예약 API·워크플로 실패, 나머지 이슈 순으로 그 건수를 선택합니다. 오래된 워크플로 오류가 원문 확인 전에 제외되지 않도록 조회한 후보를 먼저 분석한 뒤 최종 한도를 적용합니다. 따라서 한도를 둔 실행은 실제 보고 건수보다 많은 후보의 이벤트 상세를 조회할 수 있습니다. Sentry 후보 조회는 조직 설정별 쿼리당 최대 100그룹이며, 그 밖의 예약 오류는 후속 페이지 조회를 추가해야 수집할 수 있습니다.

스마트닥터와 위잉의 예약 결과는 확보된 응답 근거로 판단합니다. 한쪽 실패만 기록되어 있거나 통신 상세가 삭제된 경우, 반대편을 성공으로 간주하지 않습니다.

| API | 리포트에 포함되는 근거 | 읽기 권한 |
|---|---|---|
| [Issue Events](https://docs.sentry.io/api/events/list-an-issues-events/) | 구간별 레벨·메시지, 메서드, 경로, 릴리스, 브라우저, 집중 시각 | `event:read` |
| [Issue Event](https://docs.sentry.io/api/events/retrieve-an-issue-event/) | 예외·스택, API 상태/전송 코드, locale, 응답 오류 code/message/detail, 요청, 통신·이동 Breadcrumbs, SDK, Trace/Replay 링크 | `event:read` |
| [Trace](https://docs.sentry.io/api/discover/retrieve-a-trace/) | 반환된 span과 연결 오류 수, 오래 걸린 span의 프로젝트·연산·시간 | `org:read` |
| [Source Map Debug](https://docs.sentry.io/api/events/get-debug-information-related-to-source-maps-for-a-given-event/) | debug ID·artifact bundle·release artifact 유무, 대응 소스맵이 없는 프레임 수 | `project:read` |
| [Project Error Events](https://docs.sentry.io/api/events/list-a-projects-error-events/) | 보고 0건 프로젝트의 마지막 저장 이벤트 시각(조회 종료 전 14일 이내) | `project:read` |

- 이슈당 이벤트 목록 최대 1,000건, 대표 원문 최대 5건을 조회합니다. 원문은 레벨·메시지 유형, 메서드, 릴리스, 경로, 브라우저 순으로 다른 사례를 선택합니다. 비율은 대표 원문이 아닌 확보한 이벤트 목록에서 계산합니다.
- 분포는 상위 8종, 스택은 예외당 마지막 12프레임, 통신·이동 Breadcrumbs는 마지막 8건까지 표시합니다. 원문 발췌는 이벤트당 8,000자, AI 입력은 대표 이벤트당 2,500자까지입니다. 잘린 경우 표시합니다.
- Trace와 소스맵 추가 진단은 첫 대표 이벤트에 적용합니다. 소스맵 진단은 Sentry의 JavaScript 처리 오류가 있을 때 호출합니다. 다른 대표 이벤트에도 Trace/Replay 연결 ID가 있으면 링크를 제공합니다.
- API 오류·권한 부족·수집 한도·이벤트 수 불일치를 문서에 남깁니다. Trace 403은 데이터가 없다는 뜻이 아닙니다. 같은 조직의 Trace 403 이후 추가 호출은 생략합니다.
- AI 분석에 실패해도 수집 근거를 Markdown에 보존합니다. 노이즈로 분류된 이슈도 상세 근거를 남깁니다. Discord에는 오류 유형별 분포를 요약합니다.
- 폴백 처리 건수는 구간 전체 이벤트 태그에서 계산하며, 일부 표본의 폴백 태그만으로 전체 이슈의 우선순위를 낮추지 않습니다. 로컬 소스 연결은 AI 입력 길이에 잘리지 않은 대표 이벤트 발췌를 사용합니다.

API는 Sentry에 이미 저장된 데이터를 조회합니다. 백엔드의 어느 DB 쿼리나 외부 요청에서 지연됐는지 확인하려면 해당 서버의 Sentry 계측과 연결된 Trace span이 수집되어 있어야 합니다. 소스맵이 누락된 배포는 해당 debug ID와 일치하는 파일을 업로드해야 원본 코드 위치를 복원할 수 있습니다. 새 배포의 소스맵으로 과거 배포의 프레임이 복원된다고 가정하지 않습니다.

## 예약 실행

### Orca 자동화

Orca의 `Sentry Discord 요약 09:00` 및 `Sentry Discord 요약 20:00` 예약은 이 저장소의 기존 로컬 워크스페이스에서 실행합니다. `REPORT_SLOT=09`는 전날 20시부터 당일 09시까지, `REPORT_SLOT=20`은 당일 09시부터 20시까지 조회합니다. 저장소의 `.env`로 Sentry와 Discord에 연결하고, ChatGPT로 로그인한 로컬 Codex CLI로 요약합니다. 별도 OpenAI API 키가 필요하지 않습니다. 로컬 Orca 스케줄러가 동작하는 장비에서 실행됩니다.

각 예약은 워크스페이스에서 다음 PowerShell 명령을 한 번 실행합니다. 20시 예약에는 `REPORT_SLOT`을 `20`으로 설정합니다. 미리보기에서는 `DRY_RUN`을 `1`로 지정합니다.

```powershell
$env:REPORT_SLOT = '09'
$env:CODEX_CLI_ANALYSIS = '1'
$env:DRY_RUN = '0'
npm start
```

정기 실행에 사용하는 `.env`와 프로세스 환경에는 `REPORT_END`, `LOOKBACK_HOURS`를 지정하지 않습니다.

### 누락 구간 수동 복구

`REPORT_END`에 시간대를 포함한 조회 종료 시각을 지정합니다. `LOOKBACK_HOURS`는 오전 보고에 `13`, 저녁 보고에 `11`을 사용합니다. 예를 들어 9월 13일 오전 보고를 미리 보려면 다음과 같이 실행합니다. Discord 전송 시에는 `DRY_RUN`을 `0`으로 지정합니다.

```powershell
$env:REPORT_END = '2026-09-13T09:00:00+09:00'
$env:LOOKBACK_HOURS = '13'
$env:DRY_RUN = '1'
npm start
Remove-Item Env:REPORT_END, Env:LOOKBACK_HOURS, Env:DRY_RUN
```

### 로컬 Windows

항상 켜져 있는 Windows 장비라면 작업 스케줄러에서 `npm start`를 09:00, 20:00에 실행할 수 있습니다. 이 방식은 `.env`와 `codex login`으로 로그인한 ChatGPT 계정을 사용합니다. Codex 분석을 끄려면 `CODEX_CLI_ANALYSIS=0`으로 설정합니다. 현재 저장소에는 영구 작업 등록만 아직 추가되지 않았습니다.

## 원격 저장소

```text
git@github.com:foodeco/sentry-discord-reporter.git
```

최초 커밋을 만든 뒤 다음 명령으로 업로드합니다.

```powershell
git push -u origin main
```

조직명과 프로젝트 slug가 저장되므로 비공개 저장소를 권장합니다.

## 노이즈 및 개인정보 처리

- 조회 구간에 `levels`에 해당하는 이벤트가 하나 이상 있는 이슈 선택(그룹 내 다른 레벨의 이벤트도 분포에 포함)
- `api_source`가 있는 예약 API warning은 endpoint 확인 후 최소 P1로 포함
- `ignoreContains`에 일치하는 오류 제거
- `ignoredIssueIds`에 등록한 이슈 제거
- 이메일, Bearer/JWT, password/token/api key 형태 마스킹
- 예외·스택·허용된 태그와 응답 오류 필드만 길이를 제한해 분석
- 요청 body·headers·cookies·user와 응답 전체는 제외하고 URL 쿼리·fragment·URL 인증정보를 제거
- 로컬 Codex는 비밀 환경변수를 전달하지 않고 Sentry 스택과 연결된 커밋 소스 구간만 조사
- AI 분석 실패 시 규칙 기반 리포트로 전환

## 테스트

```powershell
npm run test:unit
```

외부 서비스 없이 예약 구간, 다중 프로젝트 요청, 노이즈 필터, Discord 메시지 길이와 민감정보 마스킹을 검증합니다. 혼합된 404/500·희귀 HEAD의 대표 선정, 기간 밖 이벤트 제외, 페이지 중복·실패, Trace 권한 부족과 소스맵 진단 근거 보존도 검증합니다.
예약 API warning과 오래된 워크플로 오류가 보고 한도나 AI 노이즈 분류로 사라지지 않는 회귀도 검증합니다. 양방향 부분 성공·양쪽 미확인의 표시와 복구 개인정보의 리포터 미전달도 확인합니다.
