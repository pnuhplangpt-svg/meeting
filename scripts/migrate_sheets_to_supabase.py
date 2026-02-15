#!/usr/bin/env python3
"""Google Sheets(Apps Script API) -> Supabase rooms/reservations migration helper.

Phase B read-path migration script for solo developers.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List


def env(name: str, required: bool = True, default: str = "") -> str:
    value = os.environ.get(name, default).strip()
    if required and not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes"}


def get_apps_script_json(base_url: str, query: Dict[str, str]) -> Dict[str, Any]:
    query_string = urllib.parse.urlencode(query)
    url = f"{base_url}?{query_string}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = resp.read().decode("utf-8")
    data = json.loads(payload)
    if not data.get("success"):
        raise RuntimeError(f"Apps Script error for action={query.get('action')}: {data.get('error')}")
    return data


def supabase_upsert(base_url: str, service_key: str, table: str, rows: List[Dict[str, Any]], on_conflict: str) -> None:
    if not rows:
        print(f"[skip] {table}: no rows")
        return

    endpoint = f"{base_url}/rest/v1/{table}?on_conflict={urllib.parse.quote(on_conflict)}"
    body = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()


def chunked(items: List[Dict[str, Any]], size: int) -> Iterable[List[Dict[str, Any]]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def map_rooms(raw_rooms: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mapped = []
    for row in raw_rooms:
        floor = str(row.get("층", "")).strip().upper()
        if not floor:
            continue
        mapped.append(
            {
                "id": str(row.get("회의실ID", floor)).strip() or floor,
                "floor": floor,
                "name": str(row.get("이름", "")).strip() or floor,
                "is_active": normalize_bool(row.get("활성화", True)),
            }
        )
    return mapped


def map_reservations(raw_reservations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mapped = []
    for row in raw_reservations:
        rid = str(row.get("예약ID", "")).strip()
        date = str(row.get("날짜", "")).strip()
        floor = str(row.get("층", "")).strip().upper()
        start_time = str(row.get("시작시간", "")).strip()
        end_time = str(row.get("종료시간", "")).strip()
        if not (rid and date and floor and start_time and end_time):
            continue

        mapped.append(
            {
                "id": rid,
                "date": date,
                "floor": floor,
                "start_time": start_time,
                "end_time": end_time,
                "team_name": str(row.get("팀명", "")).strip(),
                "user_name": str(row.get("예약자", "")).strip(),
                # Apps Script 공개 조회 응답은 비밀번호 해시를 내려주지 않음.
                # Phase B(읽기 전환)에서는 placeholder를 넣고, Phase C 전에 실제 hash backfill 권장.
                "password_hash": "__PHASE_B_PLACEHOLDER__",
                "created_at": str(row.get("생성일시", "")).strip() or None,
            }
        )
    return mapped


def main() -> int:
    try:
        apps_script_url = env("APPS_SCRIPT_URL")
        supabase_url = env("SUPABASE_URL")
        supabase_service_role_key = env("SUPABASE_SERVICE_ROLE_KEY")
        proxy_secret = env("PROXY_SHARED_SECRET", required=False)
        admin_token = env("ADMIN_TOKEN", required=False)
        batch_size_raw = env("MIGRATION_BATCH_SIZE", required=False, default="500")
        batch_size = max(1, int(batch_size_raw))
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    room_query: Dict[str, str] = {"action": "getRooms"}
    if admin_token:
        room_query["includeInactive"] = "1"
        room_query["adminToken"] = admin_token
    if proxy_secret:
        room_query["proxySecret"] = proxy_secret

    reservation_query: Dict[str, str] = {"action": "getReservations"}
    if proxy_secret:
        reservation_query["proxySecret"] = proxy_secret

    try:
        print("[step] fetch rooms from Apps Script")
        rooms_raw = get_apps_script_json(apps_script_url, room_query).get("data", [])
        rooms = map_rooms(rooms_raw)
        print(f"[info] rooms fetched={len(rooms_raw)} mapped={len(rooms)}")

        print("[step] fetch reservations from Apps Script")
        reservations_raw = get_apps_script_json(apps_script_url, reservation_query).get("data", [])
        reservations = map_reservations(reservations_raw)
        print(f"[info] reservations fetched={len(reservations_raw)} mapped={len(reservations)}")

        print("[step] upsert rooms to Supabase")
        for part in chunked(rooms, batch_size):
            supabase_upsert(supabase_url, supabase_service_role_key, "rooms", part, "id")

        print("[step] upsert reservations to Supabase")
        for part in chunked(reservations, batch_size):
            supabase_upsert(supabase_url, supabase_service_role_key, "reservations", part, "id")

        print("[done] migration completed")
        if not admin_token:
            print("[warn] ADMIN_TOKEN 미설정으로 활성 회의실만 이관했습니다.")
        print("[warn] reservations.password_hash는 placeholder입니다. Phase C 전에 실제 hash backfill 필요합니다.")
        return 0
    except Exception as exc:
        print(f"[error] migration failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

