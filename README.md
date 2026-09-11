# Sentry Discord Reporter

여러 Sentry 조직과 프로젝트의 오류를 모아 노이즈를 제거하고 Discord로 전송하는 독립 실행형 Node.js 리포터입니다.

## 현재 상태

- Sentry 이슈·조회 구간 이벤트 목록·대표 이벤트 원문 조회
- Discord Webhook 조회·실제 메시지 전송 검증 완료
- 수동 실행 및 로컬 Codex AI 원인·조치 분석 가능
- 프로젝트별 Markdown에 이벤트 분포·응답 오류·스택·Breadcrumbs·Trace/소스맵 진단 수록
- GitHub Actions 예약: 매일 09:00, 20:00 KST
- Windows 예약 작업 등록은 아직 미완료

OpenAI API 키가 있으면 Responses API를 우선 사용합니다. 키가 없거나 호출에 실패하면 로그인된 로컬 Codex CLI로 원인과 조치를 분석하고, 두 방법 모두 사용할 수 없을 때만 규칙 기반 리포트로 동작합니다. 현재 로그인된 ChatGPT/Codex 계정은 GitHub-hosted Actions에서 그대로 사용할 수 없습니다.

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
MAX_ISSUES_PER_RUN=30
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

### 상세 근거 수집

리포트 조회 구간의 이벤트를 페이지 단위로 읽습니다. 이슈의 대표 제목과 전체 건수만으로 오류 유형을 판단하지 않습니다. 예를 들어 제목이 `status code 500`인 그룹 안에 `404 warning 35건 + 500 error 1건`이 있으면 두 유형의 건수를 따로 표시합니다. 구간 밖의 `events/latest/`는 사용하지 않습니다.

보고 대상의 레벨 조건은 Sentry 검색 `level:[error,fatal]`처럼 구간 이벤트에 적용합니다. 그룹의 대표 레벨이 나중에 warning으로 바뀌어도 구간 안의 error가 누락되지 않습니다. 신규 여부는 전체 이력의 `lifetime.firstSeen`을 우선 사용하고 구간 첫 발생과 구분합니다. 조직 설정당 이슈 최대 100건을 조회하고 `MAX_ISSUES_PER_RUN`(기본 30)만큼 우선순위에 따라 보고하므로, 전체 점검에는 이 값을 100까지 늘릴 수 있습니다.

| API | 리포트에 포함되는 근거 | 읽기 권한 |
|---|---|---|
| [Issue Events](https://docs.sentry.io/api/events/list-an-issues-events/) | 구간별 레벨·메시지, 메서드, 경로, 릴리스, 브라우저, 집중 시각 | `event:read` |
| [Issue Event](https://docs.sentry.io/api/events/retrieve-an-issue-event/) | 예외·스택, API 상태/전송 코드, locale, 응답 오류 code/message/detail, 요청, 통신·이동 Breadcrumbs, SDK, Trace/Replay 링크 | `event:read` |
| [Trace](https://docs.sentry.io/api/discover/retrieve-a-trace/) | 반환된 span과 연결 오류 수, 오래 걸린 span의 프로젝트·연산·시간 | `org:read` |
| [Source Map Debug](https://docs.sentry.io/api/events/get-debug-information-related-to-source-maps-for-a-given-event/) | debug ID·artifact bundle·release artifact 유무, 대응 소스맵이 없는 프레임 수 | `project:read` |

- 이슈당 이벤트 목록 최대 1,000건, 대표 원문 최대 5건을 조회합니다. 원문은 레벨·메시지 유형, 메서드, 릴리스, 경로, 브라우저 순으로 다른 사례를 선택합니다. 비율은 대표 원문이 아닌 확보한 이벤트 목록에서 계산합니다.
- 분포는 상위 8종, 스택은 예외당 마지막 12프레임, 통신·이동 Breadcrumbs는 마지막 8건까지 표시합니다. 원문 발췌는 이벤트당 8,000자, AI 입력은 대표 이벤트당 2,500자까지입니다. 잘린 경우 표시합니다.
- Trace와 소스맵 추가 진단은 첫 대표 이벤트에 적용합니다. 소스맵 진단은 Sentry의 JavaScript 처리 오류가 있을 때 호출합니다. 다른 대표 이벤트에도 Trace/Replay 연결 ID가 있으면 링크를 제공합니다.
- API 오류·권한 부족·수집 한도·이벤트 수 불일치를 문서에 남깁니다. Trace 403은 데이터가 없다는 뜻이 아닙니다. 같은 조직의 Trace 403 이후 추가 호출은 생략합니다.
- AI 분석에 실패해도 수집 근거를 Markdown에 보존합니다. 노이즈로 분류된 이슈도 상세 근거를 남깁니다. Discord에는 오류 유형별 분포를 요약합니다.
- 폴백 처리 건수는 구간 전체 이벤트 태그에서 계산하며, 일부 표본의 폴백 태그만으로 전체 이슈의 우선순위를 낮추지 않습니다. 로컬 소스 연결은 AI 입력 길이에 잘리지 않은 대표 이벤트 발췌를 사용합니다.

API는 Sentry에 이미 저장된 데이터를 조회합니다. 백엔드의 어느 DB 쿼리나 외부 요청에서 지연됐는지 확인하려면 해당 서버의 Sentry 계측과 연결된 Trace span이 수집되어 있어야 합니다. 소스맵이 누락된 배포는 해당 debug ID와 일치하는 파일을 업로드해야 원본 코드 위치를 복원할 수 있습니다. 새 배포의 소스맵으로 과거 배포의 프레임이 복원된다고 가정하지 않습니다.

## 예약 실행

### GitHub Actions

`.github/workflows/sentry-report.yml`은 다음 시각에 실행됩니다.

- 09:00 KST
- 20:00 KST

09시 보고는 전날 20시부터 당일 09시까지, 20시 보고는 당일 09시부터 20시까지 조회합니다.

원격 저장소의 **Settings → Secrets and variables → Actions**에 다음 Repository Secret을 등록합니다.

| Secret | 필수 | 용도 |
|---|---:|---|
| `SENTRY_TOKENS_JSON` | 여러 조직일 때 | 조직 slug별 Auth Token JSON |
| `SENTRY_AUTH_TOKEN` | 한 조직일 때 | 단일 조직 Auth Token |
| `DISCORD_WEBHOOK_URL` | 예 | Discord 전송 |
| `OPENAI_API_KEY` | 아니요 | OpenAI API 분석 |

Actions 화면의 **Run workflow**로 예약 시간 외 수동 실행도 가능합니다.

GitHub-hosted Actions에는 로컬의 ChatGPT 로그인과 형제 소스 저장소가 없으므로, 기본 설정에서는 OpenAI API 또는 규칙 기반 분석을 사용합니다. 생성 문서를 Actions에서 보관하려면 워크플로의 artifact 업로드 단계를 사용합니다.

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
