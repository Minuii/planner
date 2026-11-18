"""Grab catalog prerequisites for every course in a term's data file (one section per course).

    python uos_prereqs.py                 -> uos-prereqs-202620.json  (~1500 requests, a few minutes)

Output: {"1440261": "1440161 or 0212161", "0408205": "( 1430115 or 1430110 ) and ...", ...}
An expression uses 7-digit course codes, and/or, brackets, and TEST for placement-test rows.
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from uos_classes import Banner

HERE = Path(__file__).resolve().parent


def parse(html):
    expr = []
    for row in re.findall(r"<tr>(.*?)</tr>", html, re.S)[1:]:  # skip header row
        c = [re.sub(r"<[^>]+>|\s+", " ", x).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(c) < 9:
            continue
        andor, lp, test, _, subj, num, _, _, rp = c[:9]
        if expr and andor:
            expr.append(andor.lower())
        code = subj.split(" ")[0] + num if subj and num else "TEST" if test else ""
        expr += [x for x in (lp, code, rp) if x]
    return " ".join(expr)


def main(term="202620"):
    secs = json.loads((HERE / f"uos-classes-{term}.json").read_text(encoding="utf-8"))["sections"]
    one = {}
    for s in secs:
        one.setdefault(s["subj"] + s["num"], s["crn"])
    b = Banner()
    b.request("term/search?mode=search", data={"term": term})

    def get(item):
        code, crn = item
        try:
            return code, parse(b.request("searchResults/getSectionPrerequisites", raw=True,
                                         data={"term": term, "courseReferenceNumber": crn}))
        except RuntimeError:
            return code, None

    with ThreadPoolExecutor(4) as ex:  # ponytail: 4 at a time, gentle on UoS
        out = {c: e for c, e in ex.map(get, one.items()) if e}
    path = HERE / f"uos-prereqs-{term}.json"
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} of {len(one)} courses have prerequisites -> {path.name}")


if __name__ == "__main__":
    assert parse("<tr><th>h</th></tr><tr><td></td><td>(</td><td></td><td></td><td>1430 Applied Physics</td>"
                 "<td>115</td><td>U</td><td>P</td><td></td></tr><tr><td>Or</td><td></td><td></td><td></td>"
                 "<td>1430 Applied Physics</td><td>110</td><td>U</td><td>P</td><td>)</td></tr>") \
        == "( 1430115 or 1430110 )"
    main(*sys.argv[1:2])
