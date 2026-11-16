"""Add CRNs to a UoS "Plan Ahead" plan.

One-time setup:
    pip install playwright
    python -m playwright install chromium

Run:
    python uos_plan.py 22459 21036 21037 21046 21047 20112 20203

A browser window opens on the UoS sign-in page. Sign in yourself (the script never sees your password).
Once you're in, the script adds the CRNs to a new plan and saves it. Check the result under Plan Ahead.
"""
import argparse
import json
import sys
import time

from playwright.sync_api import sync_playwright

SSB = "https://reg-prod.ec.sharjah.ac.ae/StudentRegistrationSsb/ssb/"

# Runs inside the logged-in page, so requests carry the browser's own session.
JS_CALL = """async ([path, method, body, isJson]) => {
  const token = document.querySelector('meta[name="synchronizerToken"]')?.content || '';
  const headers = {'X-Requested-With': 'XMLHttpRequest', 'X-Synchronizer-Token': token};
  if (body !== null) headers['Content-Type'] = isJson ? 'application/json'
                                                      : 'application/x-www-form-urlencoded; charset=UTF-8';
  const r = await fetch('/StudentRegistrationSsb/ssb/' + path, {method, headers, credentials: 'include',
    body: body === null ? undefined : (isJson ? JSON.stringify(body) : new URLSearchParams(body))});
  return {status: r.status, text: await r.text()};
}"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("crns", nargs="+")
    ap.add_argument("--term", default="202620")
    ap.add_argument("--name", default="Spring plan", help="plan description shown in Banner")
    a = ap.parse_args()
    sid = f"plan{int(time.time() * 1000)}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        def call(path, method="GET", body=None, is_json=False):
            r = page.evaluate(JS_CALL, [path, method, body, is_json])
            if r["text"].strip() == "userNotLoggedIn":
                sys.exit("Not logged in. Run again and finish signing in.")
            if r["status"] >= 400:
                sys.exit(f"{path} -> HTTP {r['status']}: {' '.join(r['text'].split())[:400]}")
            try:
                return json.loads(r["text"])
            except json.JSONDecodeError:
                return r["text"]

        page.goto(SSB + "plan/plan")
        print("Sign in in the browser window. Waiting...")
        while "/StudentRegistrationSsb/ssb/" not in page.url:  # back from Microsoft sign-in
            page.wait_for_timeout(1000)
        page.wait_for_load_state("networkidle")
        print("Signed in.")

        terms = call(f"plan/getTerms?searchTerm=&offset=1&max=10")
        print("Plan Ahead terms:", ", ".join(f"{t['code']} {t['description']}" for t in terms) or "none")
        if not any(t["code"] == a.term for t in terms):
            sys.exit(f"Term {a.term} isn't open for Plan Ahead yet.")

        j = call("term/search?mode=plan", "POST",
                 {"term": a.term, "studyPath": "", "studyPathText": "", "startDatepicker": "",
                  "endDatepicker": "", "uniqueSessionId": sid})
        if isinstance(j, dict) and j.get("studentEligFailures"):
            sys.exit("Banner says: " + "; ".join(j["studentEligFailures"]))

        models = []
        for crn in a.crns:
            j = call(f"plan/addPlanItem?term={a.term}&courseReferenceNumber={crn}")
            if isinstance(j, dict) and j.get("success") and j.get("model"):
                m = j["model"]
                print(f"  added {crn}: {m.get('subject', '')} {m.get('courseNumber', '')} sec {m.get('sequenceNumber', '')}")
                models.append(m)
            else:
                print(f"  {crn} NOT added: {json.dumps(j)[:300] if not isinstance(j, str) else ' '.join(j.split())[:300]}")
        if not models:
            sys.exit("Nothing to save.")

        j = call("plan/submitPlan/batch", "POST",
                 {"create": models, "update": [], "destroy": [], "uniqueSessionId": sid,
                  "planDescription": a.name}, is_json=True)
        print("Save reply:", json.dumps(j)[:600] if not isinstance(j, str) else " ".join(j.split())[:600])

        page.goto(SSB + "plan/selectPlan")
        print("\nOpened your plans in the browser: check the new plan is there. Close the window when done.")
        page.wait_for_event("close", timeout=0)


if __name__ == "__main__":
    main()
