---
name: visual-qa
description: Post-deploy visual QA — opens app.aurisiq.io in headless Chrome, checks for console errors, takes screenshot only on failure, reports result in #aurisiq
user_invocable: true
---

# Visual QA — Post-Deploy Verification

Run this skill after every deploy to Vercel. It uses Chrome DevTools MCP to verify the app loads correctly.

## Steps

1. **Navigate to the app** using the `chrome-devtools` MCP tools:
   - Use `chrome_navigate` to open `https://app.aurisiq.io`
   - Wait for the page to fully load (network idle)

2. **Check for console errors**:
   - Use `chrome_console_messages` or `chrome_evaluate` to run `JSON.stringify(window.__consoleErrors || [])`
   - Also evaluate: `document.querySelectorAll('.message-error').length` to check for visible error messages
   - Check that the page is not blank: `document.body.innerText.length > 10`

3. **Check key routes** — navigate to each and verify no errors:
   - `https://app.aurisiq.io` (login)
   - `https://app.aurisiq.io/analisis` (historial)
   - `https://app.aurisiq.io/analisis/nueva` (C2)
   - `https://app.aurisiq.io/speech` (C5)
   - `https://app.aurisiq.io/equipo` (G1)

4. **Screenshot only on failure**:
   - If any route has console errors or is blank, use `chrome_screenshot` to capture the state
   - Save to `/tmp/aurisiq-visual-qa-error.png`

5. **Report in #aurisiq** (channel ID: `C0AL7UWC1SM`):
   - Use the Slack MCP `slack_send_message` tool
   - If all routes pass: post a short success message with the routes checked
   - If any route fails: post the error details and mention which route failed

## Report format

**Success:**
```
*Visual QA — PASS*
Checked 5 routes after deploy. No console errors, no blank pages.
Routes: / · /analisis · /analisis/nueva · /speech · /equipo
```

**Failure:**
```
*Visual QA — FAIL*
Route `/analisis/nueva` has errors:
- Console: [error details]
- Screenshot saved to /tmp/aurisiq-visual-qa-error.png
```

## Notes
- This skill requires the `chrome-devtools` MCP server configured in `~/.claude.json`
- The MCP runs Chrome in headless mode — no browser window opens
- Auth-protected routes will show the login page — that is expected and NOT an error
- Only report errors that would affect a user: console errors, blank pages, HTTP errors
