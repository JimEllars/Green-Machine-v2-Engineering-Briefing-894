from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Navigate to the dashboard (adjust URL if necessary)
    page.goto("http://localhost:5173")

    # Take a screenshot to verify UI components are present
    page.screenshot(path="/home/jules/verification/screenshots/dashboard.png")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    run_cuj(page)
    browser.close()
