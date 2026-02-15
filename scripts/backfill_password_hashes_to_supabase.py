#!/usr/bin/env python3
"""Backfill reservation password hashes from Apps Script to Supabase.

This enables strict Supabase-only verifyPassword cutover.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List


def env(name: str, required: bool = True, default: str = "") -> str:
    value = os.environ.get(name, default).strip()
    if required and not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def get_json(url: str) -> Dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = resp.read().decode("utf-8")
    return json.loads(payload)


def patch_hash(supabase_url: str, service_key: str, reservation_id: str, password_hash: str) -> None:
    url = (
        f"{supabase_url}/rest/v1/reservations"
        f"?id=eq.{urllib.parse.quote(reservation_id)}"
    )
    body = json.dumps({"password_hash": password_hash}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def main() -> int:
    try:
        apps_script_url = env("APPS_SCRIPT_URL")
        admin_token = env("ADMIN_TOKEN")
        supabase_url = env("SUPABASE_URL")
        service_key = env("SUPABASE_SERVICE_ROLE_KEY")
        proxy_secret = env("PROXY_SHARED_SECRET", required=False)
        dry_run = env("DRY_RUN", required=False, default="false").lower() == "true"
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    query = {
        "action": "exportReservationHashes",
        "adminToken": admin_token,
    }
    if proxy_secret:
        query["proxySecret"] = proxy_secret

    url = f"{apps_script_url}?{urllib.parse.urlencode(query)}"

    try:
        data = get_json(url)
        if not data.get("success"):
            raise RuntimeError(f"Apps Script error: {data.get('error')}")

        rows: List[Dict[str, str]] = data.get("data", [])
        candidates = [
            r for r in rows
            if r.get("reservationId")
            and r.get("passwordHash")
            and r.get("passwordHash") != "__PHASE_B_PLACEHOLDER__"
        ]

        print(f"[info] fetched hashes: {len(rows)}")
        print(f"[info] backfill candidates: {len(candidates)}")

        if dry_run:
            print("[done] DRY_RUN=true, no updates were sent")
            return 0

        updated = 0
        failed = 0
        for row in candidates:
            try:
                patch_hash(
                    supabase_url,
                    service_key,
                    str(row["reservationId"]),
                    str(row["passwordHash"]),
                )
                updated += 1
            except Exception as exc:
                failed += 1
                print(f"[warn] failed id={row.get('reservationId')}: {exc}")

        print(f"[done] updated={updated}, failed={failed}")
        return 0 if failed == 0 else 2
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
