# Sentry Discord Reporter

여러 Sentry 조직과 프로젝트의 오류를 모아 노이즈를 제거하고 Discord로 전송하는 독립 실행형 Node.js 리포터입니다.

## 현재 상태

- Sentry 조직 2곳과 프로젝트 3곳의 이슈·최신 이벤트 조회 검증 완료
- Discord Webhook 조회·실제 메시지 전송 검증 완료
- 수동 실행 및 로컬 Codex AI 원인·조치 분석 가능
- 프로젝트별 Markdown 인덱스·상세 분석 문서 생성
- GitHub Actions 예약: 매일 09:00, 14:00, 20:00 KST
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
3. 최소한 **Issue & Event: Read** 권한을 설정하고 저장합니다.
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

## 예약 실행

### GitHub Actions

`.github/workflows/sentry-report.yml`은 다음 시각에 실행됩니다.

- 09:00 KST
- 14:00 KST
- 20:00 KST

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

항상 켜져 있는 Windows 장비라면 작업 스케줄러에서 `npm start`를 09:00, 14:00, 20:00에 실행할 수 있습니다. 이 방식은 `.env`와 `codex login`으로 로그인한 ChatGPT 계정을 사용합니다. Codex 분석을 끄려면 `CODEX_CLI_ANALYSIS=0`으로 설정합니다. 현재 저장소에는 영구 작업 등록만 아직 추가되지 않았습니다.

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

- `levels`에 포함되지 않은 낮은 레벨 제거
- `ignoreContains`에 일치하는 오류 제거
- `ignoredIssueIds`에 등록한 이슈 제거
- 이메일, Bearer/JWT, password/token/api key 형태 마스킹
- 예외 메시지, 애플리케이션 스택 프레임과 허용된 태그만 길이를 제한해 분석
- 로컬 Codex는 비밀 환경변수를 전달하지 않고 Sentry 스택과 연결된 커밋 소스 구간만 조사
- AI 분석 실패 시 규칙 기반 리포트로 전환

## 테스트

```powershell
npm run test:unit
```

외부 서비스 없이 예약 구간, 다중 프로젝트 요청, 노이즈 필터, Discord 메시지 길이와 민감정보 마스킹을 검증합니다.
