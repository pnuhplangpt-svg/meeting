
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:8000")
        page.wait_for_selector("#screenHome.visible")
        # Wait a bit for fonts and icons
        time.sleep(2)
        page.screenshot(path="debug_home_admin_btn.png")
        print("Screenshot saved to debug_home_admin_btn.png")
        browser.close()

if __name__ == "__main__":
    run()
