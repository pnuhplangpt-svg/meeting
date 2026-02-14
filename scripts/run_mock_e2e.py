#!/usr/bin/env python3
"""Mocked browser E2E regression test for reservation app.

- Starts a local static file server.
- Opens the app in Playwright (Firefox).
- Mocks Apps Script API responses in-page via fetch patching.
- Verifies create/edit/delete/admin flows, plus boundary rules (duplicate slot and inactive room rejection).
"""

from __future__ import annotations

import json
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PORT = 4173


def get_playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as exc:
        raise SystemExit(
            'Playwright is not installed. Run: pip install playwright && playwright install firefox'
        ) from exc
    return sync_playwright



class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args):
        return


def run_server() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), QuietHandler)

    def _serve():
        server.serve_forever()

    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    return server


def main() -> int:
    old_cwd = Path.cwd()
    server = None
    try:
        # Serve repository root
        import os

        os.chdir(ROOT)
        server = run_server()

        issues = []
        with get_playwright()() as p:
            browser = p.firefox.launch()
            page = browser.new_page(viewport={"width": 1366, "height": 768})
            page.on(
                "console",
                lambda m: issues.append({"type": f"console-{m.type}", "message": m.text})
                if m.type in ["error", "warning"]
                else None,
            )
            page.on("pageerror", lambda e: issues.append({"type": "pageerror", "message": str(e)}))

            page.add_init_script(
                """
                (function(){
                  const reservations = [];
                  const rooms = [
                    {'회의실ID':'6F','층':'6F','이름':'미니 회의실','활성화':true},
                    {'회의실ID':'7F','층':'7F','이름':'미니 회의실','활성화':true}
                  ];
                  window.__mockStore = { reservations, rooms };
                  window.fetch = async function(url, options){
                    const method = (options && options.method) || 'GET';
                    const mk = (obj)=>new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
                    const u = new URL(String(url), location.origin);
                    if (method === 'GET') {
                      const action = u.searchParams.get('action') || '';
                      if (action === 'getRooms') return mk({ success: true, data: rooms });
                      if (action === 'getReservations') {
                        let data = reservations.slice();
                        const date = u.searchParams.get('date');
                        const floor = u.searchParams.get('floor');
                        if (date) data = data.filter(r => r['날짜'] === date);
                        if (floor) data = data.filter(r => r['층'] === floor);
                        return mk({ success: true, data: data });
                      }
                      if (action === 'verifyAdmin') {
                        const code = u.searchParams.get('code');
                        return mk(code === '041082' ? { success: true, token: 'admin-token' } : { success: false, error: '관리자 인증 실패' });
                      }
                      return mk({ success: true, data: [] });
                    }

                    const body = JSON.parse((options && options.body) || '{}');
                    const action = body.action || '';
                    if (action === 'createReservation') {
                      const floor = String(body.floor || '').trim().toUpperCase();
                      const room = rooms.find(r => String(r['층']).toUpperCase() === floor && r['활성화'] === true);
                      if (!room) return mk({ success: false, error: '선택한 회의실은 예약할 수 없습니다.' });

                      const hasConflict = reservations.some(r =>
                        r['날짜'] === body.date &&
                        String(r['층']).toUpperCase() === floor &&
                        String(body.startTime) < String(r['종료시간']) &&
                        String(body.endTime) > String(r['시작시간'])
                      );
                      if (hasConflict) return mk({ success: false, error: '해당 시간에 이미 예약이 있습니다.' });

                      const id = 'id' + (reservations.length + 1);
                      reservations.push({
                        '예약ID': id,
                        '날짜': body.date,
                        '층': floor,
                        '시작시간': body.startTime,
                        '종료시간': body.endTime,
                        '팀명': body.teamName,
                        '예약자': body.userName
                      });
                      return mk({ success: true, data: { '예약ID': id } });
                    }
                    if (action === 'verifyPassword') return mk({ success: true, token: 'res-token' });
                    if (action === 'updateReservation') {
                      const row = reservations.find(r => r['예약ID'] === body.id);
                      if (row) {
                        row['시작시간'] = body.startTime;
                        row['종료시간'] = body.endTime;
                        row['팀명'] = body.teamName;
                        row['예약자'] = body.userName;
                      }
                      return mk({ success: true });
                    }
                    if (action === 'deleteReservation') {
                      const idx = reservations.findIndex(r => r['예약ID'] === body.id);
                      if (idx >= 0) reservations.splice(idx, 1);
                      return mk({ success: true });
                    }
                    if (['addRoom','updateRoom','deleteRoom'].includes(action)) {
                      return mk({ success: true });
                    }
                    return mk({ success: true });
                  };
                })();
                """
            )

            page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
            page.wait_for_timeout(800)

            result = page.evaluate(
                """
                (async function() {
                  const out = {};

                  await loadRoomsForHome();
                  out.roomsLoaded = document.querySelectorAll('.floor-card').length;

                  state.selectedFloor = '6F';
                  startReservation();
                  const dateBtn = [...document.querySelectorAll('[data-action="select-date"]')].find(b => !b.classList.contains('disabled'));
                  if (!dateBtn) throw new Error('No selectable date found');
                  selectDate(dateBtn.dataset.date);
                  await new Promise(r => setTimeout(r, 250));

                  const free = [...document.querySelectorAll('.time-slot')].filter(b => !b.classList.contains('time-slot-hidden') && !b.classList.contains('reserved'));
                  if (free.length < 2) throw new Error('Not enough selectable time slots for create flow');
                  selectTime(free[0].dataset.time);
                  selectTime(free[1].dataset.time);

                  inputTeam.value = '팀';
                  inputName.value = '사용자';
                  inputPassword.value = '1234';
                  updateConfirmButton();
                  await submitReservation();
                  out.afterCreate = window.__mockStore.reservations.length;

                  // duplicate slot should be rejected (no new row)
                  await submitReservation();
                  out.afterDuplicateTry = window.__mockStore.reservations.length;

                  // inactive room should be rejected (no new row)
                  window.__mockStore.rooms.push({'회의실ID':'9F','층':'9F','이름':'비활성 회의실','활성화':false});
                  state.selectedFloor = '9F';
                  await submitReservation();
                  out.afterInactiveRoomTry = window.__mockStore.reservations.length;
                  state.selectedFloor = '6F';

                  await loadReservations();
                  const rid = window.__mockStore.reservations[0]['예약ID'];

                  modalPasswordInput.value = '1234';
                  await verifyAndEdit(rid);
                  out.editModeId = state.editReservationId;

                  const free2 = [...document.querySelectorAll('.time-slot')].filter(b => !b.classList.contains('time-slot-hidden') && !b.classList.contains('reserved'));
                  if (free2.length < 3) throw new Error('Not enough selectable time slots for edit flow');
                  selectTime(free2[1].dataset.time);
                  selectTime(free2[2].dataset.time);

                  inputTeam.value = '팀수정';
                  inputName.value = '사용자수정';
                  inputPassword.value = '1234';
                  updateConfirmButton();
                  await submitUpdate(rid);
                  out.afterUpdateCount = window.__mockStore.reservations.length;
                  out.afterUpdateTeam = window.__mockStore.reservations[0]['팀명'];

                  modalPasswordInput.value = '1234';
                  await verifyAndDelete(rid);
                  modalDeleteConfirm.click();
                  await new Promise(r => setTimeout(r, 250));
                  out.afterDelete = window.__mockStore.reservations.length;

                  adminCodeInput.value = '041082';
                  await verifyAdminCode();
                  out.adminMode = adminMode;

                  return out;
                })();
                """
            )

            browser.close()

        # Assertions
        assert result["roomsLoaded"] >= 1, "rooms failed to load"
        assert result["afterCreate"] == 1, "create flow failed"
        assert result["afterDuplicateTry"] == 1, "duplicate slot rule failed"
        assert result["afterInactiveRoomTry"] == 1, "inactive room rule failed"
        assert result["editModeId"] == "id1", "edit mode id not set"
        assert result["afterUpdateCount"] == 1, "update created extra row"
        assert result["afterUpdateTeam"] == "팀수정", "update did not persist data"
        assert result["afterDelete"] == 0, "delete flow failed"
        assert result["adminMode"] is True, "admin auth flow failed"
        assert not issues, f"browser issues detected: {issues}"

        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, indent=2))
        return 0
    finally:
        if server:
            server.shutdown()
            server.server_close()
        import os

        os.chdir(old_cwd)


if __name__ == "__main__":
    raise SystemExit(main())
