from playwright.sync_api import sync_playwright
import time
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create context to grant permissions if needed, though usually not for localhost
        context = browser.new_context()
        page = context.new_page()
        
        # Subscribe to console messages
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

        # Disable Service Worker to prevent reload
        page.add_init_script("""
            Object.defineProperty(navigator, 'serviceWorker', {
                get: function() { return undefined; }
            });
        """)
        
        # Mock API calls
        def handle_route(route):
            url = route.request.url
            # print(f"Mocking {url}")
            
            if "action=getRooms" in url:
                 body = '{"success": true, "data": [{"회의실ID": "6F", "층": "6F", "이름": "회의실", "활성화": true}, {"회의실ID": "7F", "층": "7F", "이름": "회의실", "활성화": true}]}'
            elif "action=getReservations" in url:
                 # Return empty reservations means all slots free
                 body = '{"success": true, "data": []}'
            else:
                 body = '{"success": true, "data": []}'

            route.fulfill(
                status=200,
                content_type="application/json",
                body=body
            )

        # Intercept all calls to /api/proxy
        page.route("**/api/proxy*", handle_route)

        try:
            print("Navigating to app...")
            page.goto("http://localhost:8000")
            
            # 2. Check Home Screen
            print("Checking Home Screen...")
            expect_title = "J동 회의실 예약"
            if page.title() != expect_title:
                 print(f"Title mismatch: {page.title()} vs {expect_title}")
            
            # Verify Header specifically in Home Screen
            header = page.locator("#screenHome .header h1")
            header.wait_for(state="visible", timeout=5000)
            print(f"Header text: {header.text_content()}")
            
            # 3. Select Floor
            print("Selecting Floor...")
            # Wait for floor card
            page.wait_for_selector("#floorGrid .floor-card", state="visible", timeout=5000)
            
            floor_cards = page.locator("#floorGrid .floor-card")
            count = floor_cards.count()
            print(f"Found {count} floor cards")
            
            if count > 0:
                print("Clicking first floor card...")
                floor_cards.first.click()
            else:
                print("No floor cards found!")
                return

            # Wait for button to enable
            time.sleep(0.5)
            
            # Click Start Reservation
            print("Clicking Start Reservation...")
            page.click("#btnStartReserve")

            # Wait for transition/animation
            time.sleep(1)

            # 4. Check Reservation Screen
            print("Checking Reservation Screen...")
            page.wait_for_selector("#screenReserve", state="visible", timeout=5000)
            
            title_reserve = page.locator("#screenReserve #reserveTitle")
            print(f"Reserve Screen Title: {title_reserve.text_content()}")
            
            # 5. Select Date
            print("Selecting a date...")
            # Use specific locator for calendar inside #screenReserve
            # But #calendar is inside #screenReserve in updated HTML (line 99)
            page.wait_for_selector("#calendar .calendar-day:not(.disabled)", timeout=5000)
            
            valid_days = page.locator("#calendar .calendar-day:not(.disabled)")
            if valid_days.count() > 0:
                valid_days.last.click() 
                print("Date selected")
            else:
                print("No valid days found")
            
            # 6. Select Time
            time.sleep(1) 
            
            time_section = page.locator("#timeSection")
            if time_section.is_visible():
                print("Time section is visible")
                
                slots = page.locator("#timeGrid .time-slot:not(.reserved)")
                count = slots.count()
                
                if count >= 2:
                    print("Selecting start time...")
                    slots.nth(0).click()
                    time.sleep(0.5)
                    print("Selecting end time...")
                    slots.nth(1).click()
                    
                    # Check if Form appeared
                    form_section = page.locator("#formSection")
                    try:
                        form_section.wait_for(state="visible", timeout=3000)
                        print("Form section appeared! Test Passed.")
                    except:
                        print("Form section did not appear.")
                        page.screenshot(path="debug_form_fail.png")
                else:
                    print("Not enough available time slots.")
            else:
                print("Time section not visible. Calendar selection might have failed.")
                page.screenshot(path="debug_time_fail.png")

        except Exception as e:
            print(f"Test Error: {e}")
            page.screenshot(path="debug_final_error.png")
            
        finally:
            browser.close()

if __name__ == "__main__":
    run()
