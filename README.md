# meeting

## Regression test (mocked E2E)

Run:

```bash
python3 scripts/run_mock_e2e.py
```

What it verifies:
- room list load
- reservation create
- reservation edit (no extra row created)
- reservation delete
- admin auth entry

The test uses an in-page mocked API (`fetch` override), so it is deterministic and does not require live Apps Script network access.

## Operations roadmap

- See `OPERATIONS_ROADMAP.md` for a phased hardening/operations plan (1-week / 2-week / 4-week).
- Start execution with `DEPLOY_CHECKLIST.md` (Priority 1 deployment checklist).
- For secrets/process control, follow `SECRETS_RUNBOOK.md` (Priority 1-2).

## Audit logging

- Server-side actions are written to an `Audit` sheet via `writeAudit(...)` in `Code.gs`.
- Logged events include reservation create/update/delete, user password verification, admin verification, and room management actions.
- Security dashboard metrics are derived from these audit records (`getSecurityAlerts()`).



## Monthly metrics report automation

Operational metrics now support report preview/send for admins.

### Script Properties

- `METRICS_REPORT_RECIPIENTS`: report recipients (comma / semicolon / newline separated emails)
- `METRICS_REPORT_THRESHOLD_ADMIN_FAIL`: alert threshold for admin auth failures (default: `10`)
- `METRICS_REPORT_THRESHOLD_PASSWORD_FAIL`: alert threshold for reservation password failures (default: `20`)

### Backend actions/functions

- `GET action=getOperationalMetricsReport&adminToken=...`: returns report text preview and threshold/recipient info
- `GET action=getOperationalMetricsTrend&adminToken=...`: returns 30-day daily trend + 7-day moving average for auth failures
- `POST action=sendOperationalMetricsReport`: sends report email immediately (admin token required)
- `runScheduledOperationalMetricsReport()`: trigger-safe function for time-based automatic sending


## Vercel Function proxy (Step 1)

To hide direct Apps Script endpoint usage from the browser, the frontend now calls `/api/proxy` and Vercel forwards requests to Apps Script server-side.

Required Vercel environment variables:

- `APPS_SCRIPT_URL`: deployed Google Apps Script Web App URL (`.../exec`)
- `PROXY_SHARED_SECRET`: long random secret shared with Apps Script Script Property `PROXY_SHARED_SECRET`

Example (local dev):

```bash
vercel env add APPS_SCRIPT_URL
vercel env add PROXY_SHARED_SECRET
```

Phase 2 hardening now included in `api/proxy`:
- GET/POST action allowlist enforcement
- action-specific required parameter/field checks
- per-IP+method basic rate limiting (60 req/min, best-effort in serverless runtime)
- optional shared-secret forwarding to Apps Script (`proxySecret`)

## Playwright 환경 빠른 구축 (로컬 PC)

헷갈릴 수 있어서 **한 번에 설치+검증**하는 스크립트를 추가했습니다.

```bash
cd /workspace/meeting
bash scripts/setup_playwright.sh
```

이 스크립트가 하는 일:
- `.venv` 가상환경 생성
- `playwright` Python 패키지 설치
- Firefox 브라우저 바이너리 설치
- `python scripts/run_mock_e2e.py` 실행으로 최종 검증

### 직접 수동 설치하려면

```bash
cd /workspace/meeting
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip playwright
python -m playwright install firefox
python scripts/run_mock_e2e.py
```

### 운영체제별 메모

- **Windows (PowerShell)**
  - `python -m venv .venv`
  - `.\.venv\Scripts\Activate.ps1`
  - 이후 명령은 동일
- **macOS / Linux**
  - `source .venv/bin/activate`
- Linux에서 시스템 라이브러리 부족으로 실패하면:
  - `python -m playwright install --with-deps firefox`

### 실패 체크 포인트

- `Playwright is not installed` 에러:
  - 가상환경 활성화가 안 되었거나 `playwright` 미설치
- 브라우저 실행 실패:
  - `python -m playwright install firefox` 재실행
- 회사망/프록시 환경:
  - 브라우저 다운로드가 차단될 수 있으니 네트워크 예외 필요
