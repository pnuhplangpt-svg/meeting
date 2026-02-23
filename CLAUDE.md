# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

병원 J동 6~9층 미니 회의실 예약 시스템. Vercel에 배포되는 PWA(Progressive Web App)이며, 백엔드는 Supabase(PostgreSQL)를 사용한다.

## 명령어

### 구문 검사 (배포 전 필수)
```bash
node --check app.js
node --check service-worker.js
node --check api/proxy.js
python3 -m py_compile scripts/run_mock_e2e.py
```

### E2E 테스트 (Playwright + Firefox)
```bash
# 최초 환경 구성
bash scripts/setup_playwright.sh

# 테스트 실행
python3 scripts/run_mock_e2e.py
```

Windows PowerShell에서 직접 설치:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip playwright
python -m playwright install firefox
python scripts/run_mock_e2e.py
```

### my-app/ (Next.js 스캐폴드 — 실 서비스와 무관)
```bash
cd my-app
npm install
npm run dev    # 개발 서버
npm run build  # 빌드
npm run lint   # ESLint
```

## 아키텍처

### 전체 구조

```
index.html          ← 모든 화면(screen) 마크업 포함 단일 HTML
app.js              ← 진입점: DOM 이벤트 바인딩 + 앱 초기화
styles.css          ← 전체 스타일
service-worker.js   ← PWA 오프라인 캐싱 (cache-first 정적 / network-first API)
manifest.json       ← PWA 메타
api/proxy.js        ← Vercel 서버리스 함수 (유일한 백엔드 엔드포인트)
js/
  state.js          ← 전역 상태 (JS Proxy 기반 반응형)
  api.js            ← /api/proxy 호출 래퍼 (apiGet / apiPost)
  utils.js          ← 공유 유틸리티 (escapeHtml, formatDate 등)
  ui/
    common.js       ← 화면 전환, 토스트, 모달, 오프라인 배너, 서비스워커 등록
    home.js         ← 층/회의실 선택 화면
    reservation.js  ← 예약 생성/수정/삭제 플로우
    admin.js        ← 관리자 패널 (회의실 관리, 보안 지표, 운영 체크)
    display.js      ← 키오스크 디스플레이 모드 (?display=6F)
sql/
  supabase_phase_a_schema.sql  ← Supabase 테이블 스키마 (rooms, reservations, audit_logs, auth_tokens)
scripts/
  run_mock_e2e.py   ← Playwright 기반 mock E2E 테스트
  setup_playwright.sh
  migrate_sheets_to_supabase.py
  export_supabase_insert_sql.py
my-app/             ← Next.js 16 + Tailwind v4 스캐폴드 (미사용, 실 서비스 아님)
```

### 상태 관리 (`js/state.js`)

`state`는 JS `Proxy`로 감싼 단일 전역 객체다. UI 모듈이 `state.selectedFloor = '6F'` 처럼 직접 프로퍼티를 쓰면 자동으로 리스너에 통보된다. `subscribe(callback)` 으로 변경 구독 가능하지만, 대부분의 UI 모듈은 구독 대신 직접 DOM을 조작한다.

```js
// js/state.js 주요 프로퍼티
state.selectedFloor       // 선택된 층 ('6F' 등)
state.selectedDate        // 'YYYY-MM-DD'
state.selectedStartTime   // 'HH:MM'
state.selectedEndTime     // 'HH:MM'
state.reservationAuthToken // 예약 수정/삭제용 단기 토큰 (10분 TTL)
state.adminAuthToken      // 관리자 토큰 (12시간 TTL)
```

### 화면 전환

라우터가 없고 `navigateTo(screenId)` 함수(`js/ui/common.js`) 하나로 화면을 전환한다.

- 화면 ID: `screenHome`, `screenReservation`, `screenMyReservations`
- 관리자 모드는 별도 화면이 아닌 모달 오버레이
- 디스플레이 모드(`?display=6F`)는 앱 초기화 시 분기되어 별도 UI를 렌더링

### API 계층 (`js/api.js` → `api/proxy.js`)

모든 API 호출은 `/api/proxy` 단일 엔드포인트로 집중된다.

- **GET**: `?action=actionName&param=value` 형식
- **POST**: `{ action: 'actionName', ...fields }` JSON body

`apiGet(action, params)` / `apiPost(body)` 함수가 타임아웃(10초) + 재시도(GET 1회, POST 0회)를 처리한다.

**GET 액션**: `getReservations`, `getReservationById`, `getRooms`, `getSecurityAlerts`, `getOperationalChecks`, `getOperationalMetrics`, `getOperationalMetricsReport`, `getOperationalMetricsTrend`

**POST 액션**: `createReservation`, `updateReservation`, `deleteReservation`, `verifyPassword`, `verifyAdmin`, `addRoom`, `updateRoom`, `deleteRoom`, `sendOperationalMetricsReport`

### Vercel 서버리스 함수 (`api/proxy.js`)

- Supabase에 `SUPABASE_SERVICE_ROLE_KEY`로 접근 (클라이언트에는 키 미노출)
- 레이트 리밋: IP+method 기준 60 req/min
- action allowlist 강제 (허용 목록 외 action 거부)
- 감사 로그는 Supabase `audit_logs` 테이블에 기록

### PWA / 서비스워커 (`service-worker.js`)

- 정적 자산: cache-first 전략
- API 요청: network-first
- **정적 파일 수정 시 반드시 `CACHE_NAME` 버전을 올려야 캐시가 갱신됨**
  - 현재: `jdong-reservation-v8`

### Supabase 스키마

테이블: `rooms`, `reservations`, `audit_logs`, `auth_tokens`
- 모든 공개 테이블에 RLS 활성화; `anon`/`authenticated` 기본 차단
- 스키마 변경 시 `sql/supabase_phase_a_schema.sql` 수정 후 Supabase SQL Editor에 적용

## Vercel 환경변수

| 변수 | 설명 |
|------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 서비스 롤 키 |
| `PROXY_PASSWORD_PEPPER` | 예약 비밀번호 해싱 pepper |
| `PROXY_TOKEN_SECRET` | 프록시 토큰 서명 시크릿 |
| `PROXY_ADMIN_CODE` | 6자리 관리자 코드 |
| `SUPABASE_STRICT_PASSWORD_HASH` | `true`면 placeholder 해시 예약 차단 |
| `METRICS_REPORT_RECIPIENTS` | 운영 지표 리포트 수신자 (이메일, 콤마 구분) |

## 주의사항

- `my-app/` 디렉토리는 실 서비스와 무관한 Next.js 스캐폴드다. 실제 앱 코드는 루트의 `index.html`, `app.js`, `js/`, `api/`, `styles.css`, `service-worker.js`다.
- 회의실 데이터 필드명은 한국어: `'회의실ID'`, `'층'`, `'이름'`, `'활성화'`. Supabase 컬럼명과 혼용 주의.
- DOM 조작 시 `escapeHtml()` (`js/utils.js`) 을 반드시 사용할 것 (XSS 방지).

---

## 런칭 전 수정 과제

코드베이스 전수 분석 결과. 우선순위: P0(런칭 블로커) → P1(강력 권고) → P2(배포 후 1~2주) → P3(향후).

### P0 — 런칭 블로커 (기능 장애·보안 침해 직결)

| # | 파일 | 위치 | 문제 | 수정 방향 |
|---|------|------|------|----------|
| P0-1 | `api/proxy.js` | 라인 76–160 | **레이트리밋·인증 저장소 메모리 누수 + IP 스푸핑** — `globalThis` Map에 TTL 만료 항목 자동 정리 없음(Vercel warm instance 누적), `X-Forwarded-For` 헤더 무검증으로 레이트리밋 우회 가능 | `checkRateLimit`·`checkAuthThrottle` 진입 시 `pruneStore()` 호출로 만료 항목 정리; `x-real-ip` 헤더 우선 신뢰 |
| P0-2 | `api/proxy.js` | 라인 69–74, 372–378 | **필수 환경변수 미설정 시 시작 검증 없음** — `PROXY_TOKEN_SECRET` 등 누락 시 요청마다 런타임 에러 → 배포 직후 전체 장애 | `handler` 최상단에 `validateEnv()` early-exit 추가 |
| P0-3 | `api/proxy.js` + 신규 `vercel.json` | handler 응답 | **HTTP 보안 헤더 전무** — `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` 없음 → Clickjacking·MIME sniffing 취약 | handler에 `setSecurityHeaders(res)` 추가; `vercel.json`으로 정적 파일에도 헤더 적용 |
| P0-4 | `scripts/run_mock_e2e.py` | 라인 97 | **관리자 코드 `'041082'` 소스 하드코딩** — git 저장소 노출 시 실제 코드와 일치하면 보안 사고 | 환경변수(`MOCK_ADMIN_CODE`) 또는 무관한 mock 전용 값으로 교체 |
| P0-5 | `js/ui/reservation.js` | 라인 321–324 | **`innerHTML`에 `escapeHtml()` 누락(XSS)** — `renderSelectionSummary()`에서 `state.selectedFloor` 등 API 값 직접 삽입 | 해당 라인 모든 state 값을 `escapeHtml()`로 래핑 |

### P1 — 중요 개선 (UX 심각 영향·데이터 손실 가능)

| # | 파일 | 위치 | 문제 | 수정 방향 |
|---|------|------|------|----------|
| P1-1 | `js/ui/reservation.js`, `js/ui/admin.js` | 라인 556–578, 259, 304, 427, 527 | **모달 `onclick` 매 호출마다 재등록** — 빠른 연속 클릭 시 이전 id 클로저 잔류·async 중복 실행 위험 | `data-pendingId`/`data-pendingAction` 속성 기반 단일 `addEventListener` 패턴으로 전환 |
| P1-2 | `js/ui/reservation.js`, `js/ui/admin.js` | `verifyAndEdit`, `verifyAndDelete`, async 핸들러 전반 | **`showLoading(false)` 미호출** — 예외 발생 시 로딩 오버레이 영구 잔류 → UI 블로킹 | 모든 `showLoading(true)` 블록을 `try/catch/finally`로 변환, `finally`에서 `showLoading(false)` |
| P1-3 | `js/ui/common.js` | 라인 87–89 | **서비스워커 `setInterval` ID 미저장** — 중복 초기화 시 복수 interval 누적 | `_swUpdateInterval` 변수로 ID 저장 후 재등록 전 `clearInterval` |
| P1-4 | `js/ui/display.js` | 라인 43 | **`displayClockTimer` `clearInterval` 없음** — `initDisplayMode()` 재진입 시 타이머 누적 | 함수 진입 시 기존 `displayClockTimer`·`displayTimer` 정리 |
| P1-5 | `js/ui/common.js` | 라인 65–69 | **SW 갱신 시 폼 데이터 손실** — `controllerchange` 이벤트에서 예약 작성 중 즉시 `reload()` | 폼 입력 여부 확인 후 사용자 확인(confirm) 단계 삽입 |
| P1-6 | `js/ui/common.js` | 라인 197–244 | **`localStorage` 예외 무처리** — 프라이빗 브라우징에서 `SecurityError` → 배너 초기화 실패 | `safeStorageGet`/`safeStorageSet` 래퍼 함수로 try-catch 처리 |
| P1-7 | `api/proxy.js` | 라인 888–896 (`createReservation`) | **과거 날짜 예약 서버 미차단** — 형식만 검증, 직접 API 호출로 과거 날짜 예약 생성 가능 | KST 기준 오늘 이전 날짜 거부 로직 추가 |

### P2 — 일반 개선 (배포 후 1~2주)

| # | 파일 | 위치 | 문제 | 수정 방향 |
|---|------|------|------|----------|
| P2-1 | `api/proxy.js` | 라인 478–482, 540 (`isoDay`, 메트릭) | **서울 시간대 미적용** — UTC 기준 날짜 계산으로 자정 전후 1시간 오류 | `toLocaleString('en-CA', {timeZone:'Asia/Seoul'})` 활용 |
| P2-2 | `api/proxy.js` | 라인 908 | **예약 ID SHA1 기반** — 동일 ms 내 동일 조건 충돌 가능 | `crypto.randomUUID()` 대체 |
| P2-3 | `api/proxy.js` | 라인 7, 29 | **allowlist 중복 선언** — `getRooms`·`getReservationById` 2회씩 중복 | 중복 라인 제거 |
| P2-4 | `api/proxy.js` | 라인 521–575 | **메트릭 쿼리에 `LIMIT` 없음** — 데이터 증가 시 메모리·응답 시간 증가 | 감사로그/예약 조회에 `limit: '1000'` 추가 |
| P2-5 | `js/ui/reservation.js` | 라인 210–211 | **`SLOT_OPEN`/`SLOT_CLOSE` 하드코딩** — 운영 시간 변경 시 코드 수정 필요 | 파일 상단 상수 블록으로 분리 |
| P2-6 | `api/proxy.js` | 라인 52 | **관리자 토큰 TTL 12시간** — 유출 시 장시간 유효 | 4시간으로 단축 |

### P3 — 향후 과제 (운영 안정화 후)

| # | 항목 | 내용 |
|---|------|------|
| P3-1 | 비밀번호 해싱 강화 | SHA256+pepper → bcrypt/Argon2 (기존 예약 마이그레이션 전략 병행) |
| P3-2 | DB 레벨 동시성 제어 | PostgreSQL EXCLUSION constraint로 시간 중복 예약 원천 차단 |
| P3-3 | E2E 디스플레이 모드 테스트 | `run_mock_e2e.py`에 `?display=6F` 시나리오 추가 |
| P3-4 | 서비스워커 캐시 버전 자동화 | 배포 훅/스크립트로 `CACHE_NAME` 자동 bump |
| P3-5 | 운영 모니터링 | Vercel 로그 알림, Supabase 슬로우쿼리 알림 설정 |

### 총 작업 시간 추정

| 단계 | 예상 시간 |
|------|---------|
| P0 (5개) | 4시간 |
| P1 (7개) | 6시간 |
| P2 (6개) | 4.5시간 |
| P3 (5개) | 13시간 |
| **런칭 최소 조건 (P0+P1)** | **≈10시간** |
