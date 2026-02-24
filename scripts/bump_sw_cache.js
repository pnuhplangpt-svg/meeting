#!/usr/bin/env node
/**
 * CACHE_NAME 버전 자동 bump 스크립트.
 * service-worker.js 의 CACHE_NAME 끝 숫자를 1 증가시킨다.
 *
 * 사용법:
 *   node scripts/bump_sw_cache.js           # 실제 파일 수정
 *   node scripts/bump_sw_cache.js --dry-run # 변경 내용만 출력, 파일 수정 없음
 */

const fs = require('fs');
const path = require('path');

const SW_FILE = path.join(__dirname, '..', 'service-worker.js');
const PATTERN = /(const CACHE_NAME\s*=\s*'jdong-reservation-v)(\d+)(')/;
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(SW_FILE)) {
  console.error(`ERROR: ${SW_FILE} not found`);
  process.exit(1);
}

const content = fs.readFileSync(SW_FILE, 'utf8');
const m = content.match(PATTERN);

if (!m) {
  console.error("ERROR: CACHE_NAME 패턴을 찾을 수 없습니다. service-worker.js 에 'jdong-reservation-v<숫자>' 형식이 있는지 확인하세요.");
  process.exit(1);
}

const oldVer = m[2];
const newVer = Math.floor(Date.now() / 1000);
const newContent = content.replace(PATTERN, `$1${newVer}$3`);

if (dryRun) {
  console.log(`[dry-run] CACHE_NAME: v${oldVer} → v${newVer} (파일 수정 없음)`);
} else {
  fs.writeFileSync(SW_FILE, newContent, 'utf8');
  console.log(`CACHE_NAME set: v${newVer}  (service-worker.js)`);
}
