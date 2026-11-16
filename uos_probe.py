"""Probe the UoS registration site. Separate from uos_classes.py (which it reuses, untouched).

    python uos_probe.py health                          which UoS pages are up / failing
    python uos_probe.py details 22459 21047             prereqs, restrictions, seats, waitlist per CRN
    python uos_probe.py seats 0408205 0202207 --every 5 watch sections of these courses, beep on changes
    python uos_probe.py open                            beep when Spring stops being "View Only"

Auto-register runs in your browser instead: see uos_autoreg.js.
"""
import argparse
import html
import re
import sys
import time
from datetime import datetime
import urllib.error
import urllib.parse
import urllib.request

from uos_classes import BASE, Banner

TERM = "202620"


def text(fragment):
    """HTML fragment -> readable lines."""
    t = re.sub(r"<(br|/tr|/p|/div|/h\d)[^>]*>", "\n", fragment, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return "\n".join(l for l in (re.sub(r"\s+", " ", x).strip() for x in t.splitlines()) if l)


def beep(msg):
    print(f"\a[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------- public probes ----------

def health(a):
    checks = ["registration/registration", "classSearch/classSearch",
              "classSearch/getTerms?searchTerm=&offset=1&max=3",
              f"classSearch/get_subject?searchTerm=&term={a.term}&offset=1&max=5"]
    opener = urllib.request.build_opener()
    opener.addheaders = [("User-Agent", "Mozilla/5.0")]
    for path in checks:
        codes = []
        for _ in range(a.tries):
            t0 = time.time()
            try:
                with opener.open(BASE + path, timeout=30) as r:
                    r.read()
                    codes.append(f"{r.status}/{(time.time() - t0) * 1000:.0f}ms")
            except urllib.error.HTTPError as e:
                codes.append(str(e.code))
            except OSError as e:
                codes.append(type(e).__name__)
        ok = sum(c.startswith("200") for c in codes)
        print(f"{ok}/{a.tries} ok  {path.split('?')[0]:<32} {' '.join(codes)}")


def details(a):
    b = Banner()
    b.request("term/search?mode=search", data={"term": a.term})
    for crn in a.crns:
        print(f"\n===== CRN {crn} =====")
        for ep in ["getClassDetails", "getEnrollmentInfo", "getSectionPrerequisites",
                   "getCorequisites", "getRestrictions"]:
            t = text(b.request("searchResults/" + ep, raw=True,
                               data={"term": a.term, "courseReferenceNumber": crn}))
            print(f"-- {ep[3:]}\n{t}")


def seats(a):
    b, last = Banner(), {}
    while True:
        now = {}
        for code in a.courses:
            d = re.sub(r"\D", "", code)
            for x in b.search(a.term, d[:4], d[4:]):
                now[x["courseReferenceNumber"]] = (f'{x["subject"]} {x["courseNumber"]} sec {x["sequenceNumber"]}',
                                                   x["seatsAvailable"], x["maximumEnrollment"])
        for crn, (name, free, cap) in sorted(now.items(), key=lambda kv: kv[1][0]):
            old = last.get(crn)
            if not last:
                print(f"{crn}  {name:<22} {free}/{cap} free")
            elif old is None:
                beep(f"NEW section {crn} {name}: {free}/{cap} free")
            elif old[1] != free:
                beep(f"{crn} {name}: {old[1]} -> {free} free" + ("  FULL" if free <= 0 else ""))
        for crn in last.keys() - now.keys():
            beep(f"section {crn} {last[crn][0]} disappeared")
        last = now
        print(f"[{datetime.now():%H:%M}] checked {len(now)} sections, next in {a.every:g} min", flush=True)
        time.sleep(a.every * 60)


def term_desc(b, term):
    return next((t["description"] for t in b.terms() if t["code"] == term), "")


def open_watch(a):
    b = Banner()
    first = term_desc(b, a.term)
    print(f"Now: {first!r}. Checking every {a.every:g} min.", flush=True)
    while True:
        time.sleep(a.every * 60)
        try:
            d = term_desc(b, a.term)
        except RuntimeError as e:
            print(e)
            continue
        if d != first:
            beep(f"Term changed: {first!r} -> {d!r}")
            if "view only" not in d.lower():
                return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--term", default=TERM)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("health"); p.add_argument("--tries", type=int, default=5); p.set_defaults(f=health)
    p = sp.add_parser("details"); p.add_argument("crns", nargs="+"); p.set_defaults(f=details)
    p = sp.add_parser("seats"); p.add_argument("courses", nargs="+", help="e.g. 0408205 0202207")
    p.add_argument("--every", type=float, default=5, help="minutes between checks"); p.set_defaults(f=seats)
    p = sp.add_parser("open"); p.add_argument("--every", type=float, default=5); p.set_defaults(f=open_watch)
    a = ap.parse_args()
    try:
        return a.f(a) or 0
    except KeyboardInterrupt:
        return 130
    except (RuntimeError, urllib.error.URLError) as e:
        print("Error:", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
