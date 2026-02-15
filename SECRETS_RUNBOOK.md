# Vercel 비밀값 운영 런북

이 문서는 `DEPLOY_CHECKLIST.md`의 인증/보안 설정 항목을 실제 운영 절차로 구체화합니다.

---

## 1) 관리 대상

필수 키:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROXY_PASSWORD_PEPPER`
- `PROXY_TOKEN_SECRET`
- `PROXY_ADMIN_CODE`

선택 키:
- `SUPABASE_STRICT_PASSWORD_HASH`
- `METRICS_REPORT_RECIPIENTS`
- `METRICS_REPORT_THRESHOLD_ADMIN_FAIL`
- `METRICS_REPORT_THRESHOLD_PASSWORD_FAIL`

주의:
- 값 자체를 코드/문서/스크린샷에 남기지 않습니다.
- 키 존재 여부만 체크하고 값은 절대 공유하지 않습니다.

---

## 2) 신규 환경 설정 절차

1. Vercel 프로젝트 → Settings → Environment Variables 이동
2. 필수 키 추가
3. 배포(재배포) 수행
4. 기능 확인
   - 관리자 인증
   - 예약 생성/수정/삭제

완료 기준:
- 필수 키 모두 존재
- 배포 후 주요 기능 정상

---

## 3) 정기 교체 절차

권장 주기:
- `PROXY_ADMIN_CODE`: 분기 1회
- `PROXY_PASSWORD_PEPPER`: 반기 1회 (또는 보안 이슈 발생 시 즉시)
- `PROXY_TOKEN_SECRET`: 반기 1회 (또는 보안 이슈 발생 시 즉시)

교체 순서:
1. 교체 일정 공지(업무 시간 외 권장)
2. 새 값 준비(보안 채널)
3. Vercel 환경변수 값 교체
4. 즉시 재배포
5. 배포 후 점검
   - 관리자 인증 재확인
   - 신규 예약 생성/수정/삭제 확인

---

## 4) 사고 대응 (유출/오입력/누락)

### 4-1. `PROXY_ADMIN_CODE` 유출 의심
1. 즉시 `PROXY_ADMIN_CODE` 교체
2. 재배포
3. 최근 관리자 작업 로그 점검
4. 필요 시 관리자 기능 일시 중지 공지

### 4-2. `PROXY_PASSWORD_PEPPER` 유실/오변경
증상:
- 기존 예약 비밀번호 인증 실패 증가

대응:
1. 직전 정상 pepper로 복구
2. 재배포
3. 영향 기간 사용자 공지
4. 향후 교체 절차 재정비

### 4-3. 키 누락 배포
1. 배포 즉시 중지
2. 누락 키 입력
3. 재배포
4. 체크리스트 재검증

---

## 5) 점검 체크리스트 (주간)

- [ ] 필수 키 존재 확인
- [ ] 비밀값 접근 권한자 최소화 확인
- [ ] 최근 교체 이력 기록 확인

---

## 6) 기록 템플릿

- 작업 일시:
- 작업자:
- 변경 키:
- 변경 사유:
- 배포 버전:
- 검증 결과:
- 승인자:
