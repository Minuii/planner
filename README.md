# UoS Registration Toolkit (Spring 2026/2027)

Tools for planning a University of Sharjah timetable and registering for it.

**Live planner:** https://minuii.github.io/planner/ (fresh UoS data every 15 min via GitHub Actions; to pause: `gh workflow disable planner.yml -R Minuii/planner`).

| File | What it is |
|---|---|
| `uos-planner-202620.html` | **The planner with Spring data built in.** Double-click to open. |
| `uos-class-planner.html` | Empty planner template (used by the script to build the file above). |
| `uos_classes.py` | Downloads every Spring section from UoS and rebuilds the planner. |
| `uos-classes-202620.json` | The raw downloaded data (the planner can import it). |
| `uos_probe.py` | Extra checks: site health, section details, seat watcher, "registration open" alert. |
| `extension/` | Chrome extension: auto-register panel on the UoS registration page (`uos_autoreg.js` also works pasted in the Console). |
| `uos_prereqs.py` | Grabs every course's prerequisites into `uos-prereqs-202620.json` for the planner's *What can I take* tab. Re-run if UoS changes them. |

Everything needs only Python 3.8+ (no installs) and Chrome.

---

## 1. Get fresh class data

Seats change daily, so refresh before deciding:

```
python uos_classes.py --term 202620
```

This downloads every section (takes a minute or two), saves `uos-classes-202620.json`, rebuilds
`uos-planner-202620.html`, and opens it. Add `--no-open` to skip opening it.

Other options:

- `python uos_classes.py --list-terms` shows the term codes (Spring = `202620`).
- `python uos_classes.py --term 202620 --wait 15` checks every 15 minutes until classes are published.

**If it says `HTTP Error 500`:** that's the UoS server, not you. Run `python uos_probe.py health` (see section 4) to check.

---

## 2. Plan your timetable (the planner)

Open `uos-planner-202620.html`.

1. **Add courses**: type a code or title in *My courses*, or paste several codes at once (`1440261, 0408205`) and press Enter.
2. **Filters** (left side):
   - **Days I can attend**, **Start no earlier than / Finish by**.
   - **Different times per day**: e.g. Monday from 9:30, Tuesday from 11:00. Blank = use the main times.
   - **Keep free from / until**: a break, e.g. 12:00–1:00 for lunch.
   - **Sections for: Men / Women / Mixed**: untick the ones you can't take (see the section-number rule below).
   - **Campus**, **Preferred professors** (tick to prefer, ✕ to avoid), **open seats only**, **hide TBA times**.
3. **Sections tab**: every option per course. Click *Add* to put it on your timetable, *Skip* to exclude it.
   Lecture + lab come as one option (e.g. `61 + 61L`), so picking it adds both.
4. **Auto-plan tab**: lists every clash-free timetable, sorted by fewest days, fewest gaps, latest start, etc.
   Tick *Keep my current picks fixed* to lock a section (e.g. your Diff. Eq. section) and plan around it.
5. **My timetable** (right): your week, clashes in red. *Copy CRNs* copies the list for registration.
   *Test CRNs* loads a pasted CRN list onto the timetable.

### Section numbers (checked against Spring data)

| Section number | Who | Note |
|---|---|---|
| 01–29 | Men | Some labs say "Main Campus" but meet on the Men's campus |
| 31–59 | Women | Same for labs |
| 61+ | Mixed | Main / Medical campus |
| ending in **E** | English | e.g. `06E` |
| ending in **A** | Arabic | e.g. `02A` |

The planner shows these as tags next to each section.

---

## 3. Current plan (17 CH)

| Course | Sec | CRN(s) | Time |
|---|---|---|---|
| 1440 261 Differential Equations | 03 | 22459 | Mon/Wed 12:30–1:45 |
| 0408 150 Engineering Graphics | 02 + 02X | 21036, 21037 | Tue 8:00–8:50, Thu 8:00–10:45 |
| 0408 200 Dynamics | 61 | 21046 | Mon/Wed 8:00–9:15 |
| 0408 205 Fluid Mechanics | 61 | 21047 | Tue/Thu 11:00–12:15 |
| 0202 207 Technical Writing | 01 | 20203 | Tue/Thu 12:30–1:45 |
| 0308 150 Intro to Economics (English) | 06E | 20593 | Mon/Wed 3:30–4:45 |

```
22459 21036 21037 21046 21047 20203 20593
```

Day ends: Mon 4:45 · Tue 1:45 · Wed 4:45 · Thu 1:45.
For 18 CH add Chem Lab 63L (`22218`, Thu 2:00–4:50).

Why these sections: Dynamics only has one section you can take (Mon/Wed 8:00), which forces Graphics 02,
and Fluids 61 (Tue/Thu 11:00) rules out Electronics. The Fluids Lab sections all clash.
Check with your advisor if the lab must be taken with Fluids.

---

## 4. Probe tools (`uos_probe.py`)

All of these work without logging in.

| Command | What it does |
|---|---|
| `python uos_probe.py health` | Hits each UoS page a few times: `5/5 ok` = fine, failures = their server is having issues. |
| `python uos_probe.py details 22459 21047` | Per CRN: class details, seats + waitlist, prerequisites, corequisites, restrictions. |
| `python uos_probe.py seats 0408205 0202207 --every 5` | Lists every section of those courses, then beeps when seats change, a section fills, or a new section appears. Checks every 5 min. |
| `python uos_probe.py open` | Beeps when Spring stops showing "(View Only)". |

Stop any watcher with `Ctrl+C`.

---

## 5. Auto-register (`extension/`)

Runs inside **your own logged-in Chrome tab**. No cookies, no passwords: it uses the session your browser
already has.

### Install the extension (once)

1. In Chrome open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension` folder inside this folder.
3. Open the UoS registration site and click **Register for Classes**. A green **UoS auto-register** panel
   appears bottom-right (click its header to fold it away).

If you change files in `extension/`, press the reload icon on its card in `chrome://extensions`, then refresh the page.

### Test it (any day)

In the panel: put your CRNs, leave **Actually register** unticked, clear **Opens at**, press **Start**.
You should see `Logged in. Terms open to you for registration: ...` and one `not open yet: ...` line.
If it says **LOGGED OUT**, sign in on that tab and press Start again.

### On registration day

1. A few minutes before it opens, sign in to **Register for Classes** (refresh the tab).
2. In the panel: CRNs `22459 21046 20112 21036 21037 21047 20203`, **Opens at** `09:00`, term `202620`,
   tick **Actually register**, press **Start** and confirm.
3. Leave the tab **open and in front**, the PC **plugged in and awake**.

No extension? Open `extension/uos_autoreg.js` in Notepad, set `GO: true` in `SETTINGS` at the top, copy it all,
paste into the registration tab's Console (F12) and press Enter. Same behaviour, results in the Console.

What it does:

- Until a minute before `AT`, it checks every few minutes (this also stops your session timing out).
- From a minute before, it checks every second.
- It only counts registration as open when Spring appears in your registration terms **and** Banner reports
  nothing blocking you (like no time ticket). Otherwise it prints Banner's reason and keeps waiting.
- When open: it beeps, submits **all CRNs together** (so lecture + lab are checked as a pair), and prints a
  table with each CRN's status and any error message.
- Wi-Fi drops and slow replies are retried (30 s timeout per request), so it keeps going.
- If the UoS server crashes while it's registering (500/502/503 errors, error pages, timeouts), it keeps retrying
  each step for about 6 minutes before giving up. Retrying the submit can't register you twice.
- If your login expires, it beeps low for 2 s and prints **LOGGED OUT**: sign in again and paste again.
- If anything fails at registration time, it beeps, prints **DO IT BY HAND NOW** in red and copies your CRNs
  to the clipboard. Fastest fix: *Plans* tab > **Add All** > **Submit** (your Plan Ahead plan has the same
  7 CRNs), or paste the CRNs under *Enter CRNs*.
- Pasting it again stops the older copy, so it never registers twice.

After it runs, **refresh the Register for Classes page to confirm**. If a CRN failed, the table says why.
Add that section by hand under the *Enter CRNs* tab.

To stop it early: press **Stop** on the panel (Console way: type `uosStop = true`).

### Things to know

- You'll realistically get in within a second or two of opening. "The exact millisecond" isn't possible.
- Turn on *Set time automatically* in Windows so your clock is accurate.
- The registration step itself can only be fully tested once registration opens. Watch the table output.
- Check that UoS allows automated registration. If unsure, run with `GO = false`: it still beeps the moment
  registration opens, and you paste your CRNs into *Enter CRNs* yourself.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `uos_classes.py` → `HTTP Error 500` | UoS server problem. Run `python uos_probe.py health`, wait, retry. |
| Planner shows old seat counts | Run `python uos_classes.py --term 202620` again. |
| Picking a lab removes the lecture | Fixed: lecture + lab now come as one option. Rebuild with the command above if you see it. |
| Auto-register → "LOGGED OUT" | Click Register for Classes, sign in on that same tab, press Start (or paste) again. |
| No panel on the page | Check the extension is on in `chrome://extensions`, and refresh the registration tab. |
| Chrome won't let you paste in the Console | Type `allow pasting`, press Enter, then paste. |

**Delete `uos_cookie.txt`** if it's still in this folder. It's left over from an old approach and contains a
login cookie.
