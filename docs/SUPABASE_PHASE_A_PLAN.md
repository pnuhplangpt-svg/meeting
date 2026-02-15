# Supabase 마이그레이션 Phase A (설계/준비)

이 문서는 **초보도 따라갈 수 있게** 현재 Google Sheets + Apps Script 구조를 Supabase로 옮기기 위한
Phase A(설계/준비) 산출물을 한 곳에 정리한 실행 문서입니다.

---

## 1) 목표와 범위

### 목표
- 프론트엔드 계약(`action` 기반 API)은 유지하고, 백엔드 저장소를 단계적으로 교체한다.
- 운영 중단 없이 전환 가능한 데이터 모델/마이그레이션 절차를 확정한다.

### Phase A 범위
- API 액션 인벤토리 확정
- Supabase 스키마(DDL) 확정
- 데이터 매핑표 확정
- 리허설 체크리스트/롤백 기준 확정

### 제외 범위 (Phase B 이후)
- 실제 Vercel API 구현 교체
- 실제 데이터 이관 실행
- cutover(운영 전환)

---

## 2) 현재 API 액션 인벤토리 (기준 계약)

> 아래 액션 이름/역할은 유지한다. (프론트 변경 최소화 전략)

### GET actions
- `getReservations`
- `getReservationById`
- `getRooms`
- `verifyAdmin`
- `getSecurityAlerts`
- `getOperationalChecks`
- `getOperationalMetrics`
- `getOperationalMetricsReport`
- `getOperationalMetricsTrend`

### POST actions
- `createReservation`
- `updateReservation`
- `deleteReservation`
- `verifyPassword`
- `addRoom`
- `updateRoom`
- `deleteRoom`
- `sendOperationalMetricsReport`

---

## 3) Supabase 타깃 스키마 (초안)

SQL 원문: `sql/supabase_phase_a_schema.sql`

핵심 테이블
- `rooms`
- `reservations`
- `audit_logs`
- `auth_tokens`

핵심 제약
- 시간 범위 무결성: `start_time < end_time`
- 예약 충돌 검사 성능을 위한 인덱스: `(date, floor, start_time)`, `(date, floor, end_time)`
- 회의실 식별자/층 unique

토큰 전략
- 기존 CacheService 토큰을 `auth_tokens`로 이전 가능한 구조
- 운영 중 필요 시 Redis/KV로 대체 가능하게 서비스 레이어 분리

---

## 4) 데이터 매핑표 (Sheets → Supabase)

### 4-1. 예약(시트: `예약`) → `reservations`
- `예약ID` → `id`
- `날짜` → `date`
- `층` → `floor`
- `시작시간` → `start_time`
- `종료시간` → `end_time`
- `팀명` → `team_name`
- `예약자` → `user_name`
- `비밀번호해시` → `password_hash`
- `생성일시` → `created_at`

### 4-2. 회의실(시트: `회의실`) → `rooms`
- `회의실ID` → `id`
- `층` → `floor`
- `이름` → `name`
- `활성화` → `is_active`

### 4-3. 감사로그(시트: `Audit`) → `audit_logs`
- `시각` → `ts`
- `액션` → `action`
- `결과` → `result`
- `주체유형` → `actor_type`
- `대상ID` → `target_id`
- `메모` → `memo`

---

## 5) 마이그레이션 리허설 체크리스트 (Stage)

## Step 1. 사전 백업
- [ ] 현재 Google Sheet(예약/회의실/Audit) 전체 백업 export
- [ ] Apps Script 버전 태깅

## Step 2. 스키마 적용
- [ ] `sql/supabase_phase_a_schema.sql` 적용
- [ ] 테이블/인덱스/제약 생성 확인

## Step 3. 샘플 이행
- [ ] 회의실 4행 샘플 import
- [ ] 예약 20행 샘플 import
- [ ] Audit 50행 샘플 import

## Step 4. 정합성 검증
- [ ] row count 일치
- [ ] 무작위 10건 필드 값 일치
- [ ] 예약 충돌 쿼리/시간 필터 쿼리 정상

## Step 5. API 계약 리허설
- [ ] GET action 응답 스키마가 기존과 동일
- [ ] POST action 성공/실패 에러 메시지 정책 점검

---

## 6) 롤백 조건 / 전략

### 롤백 조건
- 예약 생성/수정/삭제 중 1개라도 실패율 상승
- 관리자 기능 실패
- 응답 지연이 기존 대비 유의하게 악화

### 롤백 전략
- 트래픽 라우팅을 기존 Apps Script 경로로 즉시 원복
- Supabase는 읽기 전용 상태로 유지 후 원인 분석
- 장애 보고서에 원인/영향/재시도 조건 기록

---

## 7) 다음 단계 (Phase B 진입 조건)

아래 3개가 충족되면 Phase B(읽기 API 전환) 시작
- [ ] 스키마 확정
- [ ] 매핑 검증 완료
- [ ] 리허설 체크리스트 1회 통과
