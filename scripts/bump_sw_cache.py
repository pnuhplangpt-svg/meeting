#!/usr/bin/env python3
"""CACHE_NAME 버전 자동 bump 스크립트.

service-worker.js 의 CACHE_NAME 끝 숫자를 1 증가시킨다.

사용법:
  python scripts/bump_sw_cache.py           # 실제 파일 수정
  python scripts/bump_sw_cache.py --dry-run # 변경 내용만 출력, 파일 수정 없음

배포 훅 예시 (package.json scripts):
  "prebuild": "python scripts/bump_sw_cache.py"
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SW_FILE = ROOT / "service-worker.js"

# CACHE_NAME = 'jdong-reservation-v<숫자>'
_PATTERN = re.compile(r"(const CACHE_NAME\s*=\s*'jdong-reservation-v)(\d+)(')")


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    if not SW_FILE.exists():
        print(f"ERROR: {SW_FILE} not found", file=sys.stderr)
        return 1

    content = SW_FILE.read_text(encoding="utf-8")
    m = _PATTERN.search(content)
    if not m:
        print(
            "ERROR: CACHE_NAME 패턴을 찾을 수 없습니다. "
            "service-worker.js 에 'jdong-reservation-v<숫자>' 형식이 있는지 확인하세요.",
            file=sys.stderr,
        )
        return 1

    old_ver = int(m.group(2))
    new_ver = old_ver + 1
    new_content = content[: m.start(2)] + str(new_ver) + content[m.end(2) :]

    if dry_run:
        print(f"[dry-run] CACHE_NAME bump: v{old_ver} → v{new_ver} (파일 수정 없음)")
    else:
        SW_FILE.write_text(new_content, encoding="utf-8")
        print(f"CACHE_NAME bumped: v{old_ver} → v{new_ver}  ({SW_FILE.relative_to(ROOT)})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
