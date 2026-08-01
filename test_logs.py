from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.on("console", lambda msg: print(f"Browser Console: {msg.type}: {msg.text}"))
    page.goto("http://localhost:5173")
    page.wait_for_timeout(4000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            browser.close()
