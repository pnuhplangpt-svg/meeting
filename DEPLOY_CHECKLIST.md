# 배포 체크리스트 (Priority 1)

`OPERATIONS_ROADMAP.md`의 **1주차 1-1 (운영 체크리스트 확정)** 실행 문서입니다.

---

## 0. 배포 메타

- 배포 일시: `YYYY-MM-DD HH:mm`
- 배포 담당: `이름`
- 승인자(전산/리더): `이름`
- 대상 환경: `운영 / 테스트`
- 릴리즈 요약: `한 줄`

---

## 1. 배포 전 점검 (필수)

### 1-1. 코드/정적 리소스
- [ ] 최신 커밋 해시 확인
- [ ] `app.js`, `styles.css`, `service-worker.js`, `index.html` 변경점 검토
- [ ] 서비스워커 버전(`CACHE_NAME`) 변경 여부 확인

### 1-2. 인증/보안 설정
- [ ] Apps Script `Script Properties`에 `ADMIN_CODE` 설정 확인
- [ ] Apps Script `Script Properties`에 `PASSWORD_PEPPER` 설정 확인
- [ ] 관리자 코드 교체/보호 정책 확인(문서 기준)
- [ ] `SECRETS_RUNBOOK.md` 최신 절차 기준으로 키 점검
- [ ] Vercel 환경변수 `APPS_SCRIPT_URL` 설정/환경(prod, preview) 확인

### 1-3. 기능 회귀 점검
- [ ] 신규 예약 생성
- [ ] 예약 수정(시간 변경)
- [ ] 예약 삭제
- [ ] 관리자 모드 진입
- [ ] 회의실 추가/비활성화/삭제
- [ ] 디스플레이 모드 로드(`?display=6F`)

### 1-4. 자동 점검
- [ ] `node --check app.js`
- [ ] `node --check service-worker.js`
- [ ] `python3 -m py_compile scripts/run_mock_e2e.py`

---

## 2. 배포 실행

- [ ] 정적 파일 업로드/배포 완료
- [ ] Vercel Function(`/api/proxy`) 정상 배포 확인
- [ ] Apps Script 새 버전 배포 완료
- [ ] 배포 버전/시간 기록

---

## 3. 배포 직후 확인 (15분)

- [ ] 홈 화면 진입/층 카드 표시
- [ ] API 응답 정상(예약/회의실 조회)
- [ ] 콘솔 치명 오류 없음
- [ ] 오프라인 배너/온라인 복귀 동작 확인

---

## 4. 롤백 기준/절차

### 롤백 기준 (하나라도 해당 시)
- [ ] 신규 예약 생성 불가
- [ ] 예약 수정/삭제 불가
- [ ] 관리자 모드 접근 불가
- [ ] 다수 사용자에서 치명 에러 반복

### 롤백 절차
1. 직전 정상 버전 정적 파일로 되돌림
2. Apps Script 직전 배포 버전으로 되돌림
3. 캐시 영향 안내 공지 (필요 시)
4. 장애 원인/시각/영향 범위 기록

---

## 5. 결과 기록

- 결과: `성공 / 실패 / 롤백`
- 특이사항:
  - 
- 후속 조치:
  - 
