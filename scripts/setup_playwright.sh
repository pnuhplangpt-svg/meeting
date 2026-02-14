#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PY_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"
BROWSER="${PLAYWRIGHT_BROWSER:-firefox}"

if ! command -v "$PY_BIN" >/dev/null 2>&1; then
  echo "[ERROR] Python not found: $PY_BIN"
  exit 1
fi

echo "[1/5] Creating virtual environment at $VENV_DIR"
"$PY_BIN" -m venv "$VENV_DIR"

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

echo "[2/5] Upgrading pip"
python -m pip install --upgrade pip || echo "[WARN] pip upgrade skipped (network/proxy 제한 가능)"

echo "[3/5] Installing playwright package"
if ! python -m pip install playwright; then
  cat <<'MSG'
[ERROR] playwright 패키지 설치 실패.
가능한 원인:
- 사내 프록시/방화벽으로 PyPI 접근 차단
- pip 인덱스 미설정

해결 방법 예시:
1) 프록시 설정 후 재시도
   export HTTPS_PROXY=http://<proxy-host>:<port>
   export HTTP_PROXY=http://<proxy-host>:<port>

2) 사내 미러 사용
   python -m pip install playwright -i https://<your-pypi-mirror>/simple

3) 네트워크 가능한 환경에서 wheel 다운로드 후 오프라인 설치
MSG
  exit 1
fi

echo "[4/5] Installing browser binaries: $BROWSER"
if ! python -m playwright install --with-deps "$BROWSER"; then
  echo "[WARN] --with-deps 실패. --with-deps 없이 재시도합니다."
  if ! python -m playwright install "$BROWSER"; then
    cat <<'MSG'
[ERROR] Playwright browser 설치 실패.
해결 방법 예시:
- 네트워크/프록시 확인
- Linux의 경우: python -m playwright install --with-deps firefox
- 수동으로 한 번 더: python -m playwright install firefox
MSG
    exit 1
  fi
fi

echo "[5/5] Running mocked E2E regression test"
python scripts/run_mock_e2e.py

echo "Done. Activate env later with: source $VENV_DIR/bin/activate"
