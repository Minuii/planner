"""Phone alerts via ntfy: compare two data files and push what changed for the courses/CRNs in watch.txt.

    NTFY_TOPIC=my-topic python uos_notify.py old.json new.json

watch.txt: 7-digit course codes (alert on new sections / seats opening) and
5-digit CRNs (alert when that section fills up). Anything after # is ignored.
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path


def changes(old, new, courses, crns):
    before = {s["crn"]: s for s in old["sections"]}
    out = []
    for s in new["sections"]:
        name = f'{s["subj"]} {s["num"]} sec {s["seq"]} (CRN {s["crn"]})'
        o = before.get(s["crn"])
        if s["subj"] + s["num"] in courses:
            if o is None:
                out.append(f"New section: {name}, {s['seats']} seats")
            elif o["seats"] <= 0 < s["seats"]:
                out.append(f"Seats open: {name}, {s['seats']} free")
        if s["crn"] in crns and o and o["seats"] > 0 >= s["seats"]:
            out.append(f"FULL now: {name}")
        elif s["crn"] in crns and o and any(o["seats"] > t >= s["seats"] for t in (10, 5)):
            out.append(f"Filling up: {name}, {s['seats']} left (was {o['seats']})")
    return out


def main(old_path, new_path):
    topic = os.environ.get("NTFY_TOPIC")
    watch = re.sub(r"#.*", "", (Path(__file__).parent / "watch.txt").read_text())
    courses, crns = set(re.findall(r"\b\d{7}\b", watch)), set(re.findall(r"\b\d{5}\b", watch))
    try:
        old = json.loads(Path(old_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return print("no previous data, nothing to compare")
    msgs = changes(old, json.loads(Path(new_path).read_text(encoding="utf-8")), courses, crns)
    print("\n".join(msgs) or "no changes for watched courses")
    if msgs and topic:
        urllib.request.urlopen(urllib.request.Request(
            f"https://ntfy.sh/{topic}", data="\n".join(msgs[:20]).encode(),
            headers={"Title": "UoS seats", "Tags": "school", "Click": "https://minuii.github.io/planner/"}), timeout=30)


if __name__ == "__main__":
    main(*sys.argv[1:3])
