# Supabase Phase B 실행 가이드 (혼자 개발용)

이 문서는 **바로 실행 가능한 순서**만 담았습니다.

---

## 0. 목표

- 조회 3개 액션만 Supabase로 먼저 전환
  - `getRooms` (활성 회의실만)
  - `getReservations`
  - `getReservationById`
- 쓰기/관리자 민감 액션은 기존 Apps Script 유지

---

## 1. 사전 준비

- [ ] Supabase 프로젝트 생성
- [ ] SQL Editor에서 `sql/supabase_phase_a_schema.sql` 실행
- [ ] `rooms`, `reservations` 데이터 import

---

## 2. 데이터 이관 (rooms / reservations)

### 2-1. 환경변수 준비

```bash
export APPS_SCRIPT_URL='https://script.google.com/macros/s/REPLACE_ME/exec'
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='YOUR_SERVICE_ROLE_KEY'
# 선택: Apps Script에 PROXY_SHARED_SECRET 검증이 켜져 있으면 반드시 동일 값 입력
export PROXY_SHARED_SECRET='YOUR_SHARED_SECRET'
# 선택: 비활성 회의실까지 이관하려면 관리자 토큰 입력
export ADMIN_TOKEN='YOUR_ADMIN_TOKEN'
# 선택: 대량 데이터 시 배치 크기 (기본 500)
export MIGRATION_BATCH_SIZE='500'
```

### 2-2. 가장 쉬운 방식: SQL 파일 생성 후 붙여넣기

```bash
python3 scripts/export_supabase_insert_sql.py
```

- 실행 후 `supabase_import.sql` 파일이 생성됩니다.
- Supabase SQL Editor에 파일 내용을 그대로 붙여넣고 실행하면 됩니다.

(원하면 `OUTPUT_SQL_PATH`로 파일명을 변경할 수 있습니다.)

### 2-3. 자동 업서트 스크립트 방식 (기존)

```bash
python3 scripts/migrate_sheets_to_supabase.py
```

스크립트 동작:
- Apps Script에서 `getRooms`, `getReservations`를 읽음
- Supabase `rooms`, `reservations`에 upsert
- `ADMIN_TOKEN` 미설정 시 활성 회의실만 이관

주의:
- 현재 Apps Script 공개 API는 `비밀번호해시`를 내려주지 않으므로, `reservations.password_hash`는 placeholder로 채워집니다.
- 따라서 **Phase B(읽기 전환) 용도로만 사용**하고, Phase C(쓰기 전환) 전에 비밀번호 해시 백필 계획이 필요합니다.

### 2-4. 이관 검증 SQL

```sql
select count(*) as rooms_count from rooms;
select count(*) as reservations_count from reservations;

select floor, count(*) as cnt
from reservations
group by floor
order by floor;
```

---

## 3. Vercel 환경변수 설정

아래를 Vercel 프로젝트에 등록:

- `SUPABASE_READ_ENABLED=true`
- `SUPABASE_URL=https://<project>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<service_role_key>`
- 기존값 유지: `APPS_SCRIPT_URL`, `PROXY_SHARED_SECRET`

---

## 4. 배포 후 기능 확인

- [ ] 홈 화면 회의실 목록 로드 (`getRooms`)
- [ ] 예약 내역 로드 (`getReservations`)
- [ ] 예약 ID 조회 (`getReservationById`)
- [ ] 예약 생성/수정/삭제는 기존처럼 동작 (Apps Script 경유)

---

## 5. 문제 발생 시 즉시 롤백

- `SUPABASE_READ_ENABLED=false` 로 변경 후 재배포
- 조회가 즉시 기존 Apps Script 경로로 돌아감

---

## 6. Phase C(쓰기 전환)

아래 값을 Vercel에 추가 후 재배포하세요.

- `SUPABASE_WRITE_ENABLED=true`
- `PROXY_PASSWORD_PEPPER=<Apps Script의 PASSWORD_PEPPER와 동일 값>`
- `PROXY_TOKEN_SECRET=<긴 랜덤 문자열>`
- `PROXY_ADMIN_CODE=<6자리 관리자 코드>`

검증:
- [ ] 예약 생성 성공 (`createReservation`)
- [ ] 비밀번호 확인 성공 (`verifyPassword`)
- [ ] 예약 수정/취소 성공 (`updateReservation` / `deleteReservation`)
- [ ] 관리자 로그인/회의실 추가·수정·삭제 성공 (`verifyAdmin`, `addRoom/updateRoom/deleteRoom`)

문제 시 롤백:
- `SUPABASE_WRITE_ENABLED=false`
- `SUPABASE_READ_ENABLED=false` (필요 시)



---

## 7. Phase D(완전 컷오버)

### 7-1. 비밀번호 해시 백필

```bash
export APPS_SCRIPT_URL='https://script.google.com/macros/s/REPLACE_ME/exec'
export ADMIN_TOKEN='YOUR_ADMIN_TOKEN'
export PROXY_SHARED_SECRET='YOUR_SHARED_SECRET'
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='YOUR_SERVICE_ROLE_KEY'
python3 scripts/backfill_password_hashes_to_supabase.py
```

### 7-2. Strict 모드 활성화

Vercel env:
- `SUPABASE_STRICT_PASSWORD_HASH=true`

의미:
- placeholder 해시 예약은 Apps Script fallback 없이 차단
- 즉, Supabase-only 비밀번호 검증 경로 강제

### 7-3. 최종 검증

- [ ] 신규 예약 생성/수정/취소 정상
- [ ] 기존 예약 비밀번호 인증 정상
- [ ] Apps Script 직접 의존 없는지 운영 로그 확인
