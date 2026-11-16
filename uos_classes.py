"""Grab University of Sharjah classes from Banner and build a ready-to-use planner.

Usage (Python 3.8+, no installs needed):
    python uos_classes.py --list-terms          show term codes
    python uos_classes.py --term 202620         grab every class in Spring 2026/2027
    python uos_classes.py --term 202620 --courses 1501211,1440102,0202
    python uos_classes.py --term 202620 --wait 15
                                                keep checking every 15 min until
                                                classes are published, then grab

Output (next to this script):
    uos-classes-<term>.json       raw data (also importable into the planner)
    uos-planner-<term>.html       uos-class-planner.html with the data built in
"""
import argparse
import html
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://reg-prod.ec.sharjah.ac.ae/StudentRegistrationSsb/ssb/"
PAGE = 500  # Banner caps a page at 500 sections
DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
DAY_LETTERS = "UMTWRFS"
HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "uos-class-planner.html"
MARKER = "window.UOS_DATA=null;/*UOS_DATA*/"


class Banner:
    def __init__(self, cookie=None):
        self.cookie = cookie
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.opener.addheaders = [("User-Agent", "Mozilla/5.0 (uos_classes.py)"),
                                  ("Accept", "application/json, text/javascript, */*")]
        if cookie:
            self.opener.addheaders.append(("Cookie", cookie))
        try:  # starts a session; UoS often 500s on this page, and the data endpoints set the cookie anyway
            self.request("classSearch/classSearch", raw=True, tries=2)
        except RuntimeError:
            pass

    def request(self, path, data=None, raw=False, tries=4):
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        for attempt in range(tries):
            try:
                with self.opener.open(BASE + path, data=body, timeout=60) as r:
                    text = r.read().decode("utf-8", "replace")
                if raw:
                    return text
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    raise RuntimeError("UoS sent a web page instead of data (session expired or "
                                       "login needed). Run the script again.") from None
            except (OSError, urllib.error.URLError) as e:
                if attempt == tries - 1:
                    raise RuntimeError(f"Could not reach the UoS site: {e}") from None
                time.sleep(2 * (attempt + 1))

    def terms(self):
        return self.request("classSearch/getTerms?searchTerm=&offset=1&max=50")

    def subjects(self, term):
        return self.request(f"classSearch/get_subject?searchTerm=&term={term}&offset=1&max=2000")

    def search(self, term, subject="", number="", mode="search"):
        self.request("classSearch/resetDataForm", data={})
        self.request(f"term/search?mode={mode}", data={"term": term})
        out, offset, total = [], 0, None
        while total is None or offset < total:
            q = {"txt_term": term, "pageOffset": offset, "pageMaxSize": PAGE,
                 "sortColumn": "subjectDescription", "sortDirection": "asc"}
            if subject:
                q["txt_subject"] = subject
            if number:
                q["txt_courseNumber"] = number
            j = self.request("searchResults/searchResults?" + urllib.parse.urlencode(q))
            total = j.get("totalCount") or 0
            out += j.get("data") or []
            offset += PAGE
            if total > PAGE:
                print(f"    {min(offset, total)}/{total} sections", end="\r", flush=True)
        if total > PAGE:
            print()
        return out

    def linked(self, term, crn):
        j = self.request(f"searchResults/fetchLinkedSections?term={term}&courseReferenceNumber={crn}")
        return j.get("linkedData") or []


def map_section(x):
    """Same compact shape the planner's mapSection() produces."""
    dec = lambda s: html.unescape(s) if s else ""
    meets = []
    for m in x.get("meetingsFaculty") or []:
        t = m.get("meetingTime")
        if not t:
            continue
        meets.append({
            "d": "".join(DAY_LETTERS[i] for i, k in enumerate(DAY_KEYS) if t.get(k)),
            "b": t.get("beginTime") or "", "e": t.get("endTime") or "",
            "bldg": dec(t.get("building")), "room": dec(t.get("room")),
            "campus": dec(t.get("campusDescription")),
        })
    cr = x.get("creditHours")
    return {
        "crn": x["courseReferenceNumber"], "subj": x["subject"], "subjDesc": dec(x.get("subjectDescription")),
        "num": x["courseNumber"], "title": dec(x.get("courseTitle")), "seq": x.get("sequenceNumber"),
        "type": dec(x.get("scheduleTypeDescription")),
        "cr": cr if cr is not None else (x.get("creditHourLow") or 0),
        "campus": dec(x.get("campusDescription")), "max": x.get("maximumEnrollment"),
        "seats": x.get("seatsAvailable"),
        "linked": bool(x.get("isSectionLinked")),
        "instr": [dec(f.get("displayName")) for f in x.get("faculty") or []],
        "meets": meets,
    }


def parse_courses(text):
    out = []
    for tok in text.replace(";", ",").split(","):
        d = "".join(ch for ch in tok if ch.isdigit())
        if len(d) >= 4:
            out.append((d[:4], d[4:]))
    return out


def clean(desc):
    return desc.replace("(View Only)", "").strip()


def grab(b, term, term_desc, courses, mode):
    sections = {}
    if courses:
        for i, (subj, num) in enumerate(courses, 1):
            print(f"  [{i}/{len(courses)}] {subj} {num}".rstrip())
            found = b.search(term, subj, num, mode)
            if not found:
                print(f"    nothing offered for {subj} {num}".rstrip())
            for x in found:
                sections[x["courseReferenceNumber"]] = x
    else:
        print("  Fetching every section in the term...")
        for x in b.search(term, mode=mode):
            sections[x["courseReferenceNumber"]] = x
    print(f"  {len(sections)} sections")

    # Lectures linked to labs/tutorials: ask Banner which lab goes with which lecture.
    by_course = {}
    for x in sections.values():
        by_course.setdefault(x["subjectCourse"], []).append(x)
    need = []
    for lst in by_course.values():
        linked = [x for x in lst if x.get("isSectionLinked")]
        prim = [x for x in linked if "lecture" in (x.get("scheduleTypeDescription") or "").lower()
                or (x.get("creditHours") or 0) > 0]
        need += prim or linked
    links = {}
    if need:
        done = 0

        def fetch(x):
            try:
                return x["courseReferenceNumber"], b.linked(term, x["courseReferenceNumber"])
            except RuntimeError:
                return x["courseReferenceNumber"], None

        with ThreadPoolExecutor(8) as pool:
            for crn, opts in pool.map(fetch, need):
                done += 1
                print(f"  Matching lectures with labs... {done}/{len(need)}", end="\r", flush=True)
                if opts is None:
                    continue
                links[crn] = []
                for opt in opts:
                    for y in opt:
                        sections.setdefault(y["courseReferenceNumber"], y)
                    links[crn].append([y["courseReferenceNumber"] for y in opt])
        print()

    out = []
    for x in sections.values():
        s = map_section(x)
        if s["crn"] in links:
            s["link"] = links[s["crn"]]
        out.append(s)
    return {"v": 1, "term": term, "termDesc": term_desc,
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "query": ",".join(s + n for s, n in courses) or "ALL", "sections": out}


def main():
    ap = argparse.ArgumentParser(description="Grab UoS classes from Banner and build the planner.")
    ap.add_argument("--term", help="term code, e.g. 202620 for Spring 2026/2027 (see --list-terms)")
    ap.add_argument("--courses", help="course codes like 1501211,1440102 or a subject like 0202 "
                                      "(default: every course in the term)")
    ap.add_argument("--list-terms", action="store_true", help="list term codes and exit")
    ap.add_argument("--wait", type=float, metavar="MIN",
                    help="if the term has no classes yet, check again every MIN minutes")
    ap.add_argument("--out", default=str(HERE), help="folder for the output files (default: next to this script)")
    ap.add_argument("--no-open", action="store_true", help="don't open the planner when done")
    ap.add_argument("--cookie", help="advanced: Cookie header from a logged-in browser session, "
                                     "only needed if Class Search ever hides the term")
    ap.add_argument("--registration", action="store_true",
                    help="advanced: search in Register-for-Classes mode (needs --cookie)")
    a = ap.parse_args()
    if a.registration and not a.cookie:
        ap.error("--registration needs --cookie from a logged-in browser session")
    mode = "registration" if a.registration else "search"

    b = Banner(a.cookie)
    terms = b.terms()
    if a.list_terms or not a.term:
        print("Terms on the UoS Class Search page:")
        for t in terms[:12]:
            print(f"  {t['code']}  {clean(t['description'])}")
        if not a.term:
            print("\nRun again with --term CODE, e.g.  python uos_classes.py --term", terms[0]["code"])
        return 0
    term = a.term.strip()
    term_desc = clean(next((t["description"] for t in terms if t["code"] == term), term))

    while True:
        subs = b.subjects(term)
        if subs:
            break
        msg = f"No classes are published for {term_desc} yet."
        if not a.wait:
            print(msg + " Try again later, or add --wait 15 to keep checking.")
            return 2
        print(f"{msg} Checking again in {a.wait:g} min ({datetime.now():%H:%M}).")
        time.sleep(a.wait * 60)
        b = Banner(a.cookie)
    if a.wait:
        print(f"\a{term_desc} classes are out!")

    print(f"Grabbing {term_desc} ({term}) from UoS...")
    data = grab(b, term, term_desc, parse_courses(a.courses or ""), mode)
    if not data["sections"]:
        print("No sections found. Check the course codes on the UoS Class Search page.")
        return 1

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    jpath = out / f"uos-classes-{term}.json"
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    jpath.write_text(blob, encoding="utf-8")
    print(f"Saved {jpath}")

    if not TEMPLATE.exists():
        print(f"(Put uos-class-planner.html next to this script to also get a ready-made planner. "
              f"For now, open the planner and use Import file on {jpath.name}.)")
        return 0
    page = TEMPLATE.read_text(encoding="utf-8")
    if MARKER not in page:
        print("uos-class-planner.html looks out of date; import the JSON file into it instead.")
        return 0
    blob = blob.replace("</", "<\\/") \
        .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    hpath = out / f"uos-planner-{term}.html"
    hpath.write_text(page.replace(MARKER, f"window.UOS_DATA={blob};"), encoding="utf-8")
    print(f"Saved {hpath}")
    if not a.no_open:
        webbrowser.open(hpath.as_uri())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)
