// UoS auto-register. Runs in YOUR logged-in browser tab, so no cookies or passwords leave the browser.
// 1. Sign in to UoS "Register for Classes" (reg-prod.ec.sharjah.ac.ae) and stay on any of its pages.
// 2. Edit the four settings below, press F12 > Console, paste this whole file, press Enter.
// 3. GO = false: only beeps when registration opens (with AT blank it does one quick check and stops).
//    GO = true: registers all CRNs the moment it opens.
// Keep the tab open and in front, the PC plugged in and awake. To stop: type  uosStop = true  in the console.
(async () => {
  const CRNS = ['22459', '21046', '20112', '21036', '21037', '21047', '20203'];
  const TERM = '202620';
  const AT = '09:00';   // registration opening time (24h, your PC clock). Until a minute before, it checks every 4 min
  const GO = false;     // true = actually register the moment it opens

  const base = '/StudentRegistrationSsb/ssb/';
  if (!location.pathname.startsWith('/StudentRegistrationSsb/')) return console.error('Open a reg-prod.ec.sharjah.ac.ae registration page first, then paste this.');
  const run = window.uosRun = (window.uosRun || 0) + 1;  // pasting again stops the older copy
  window.uosStop = false;
  const stopped = () => window.uosStop || window.uosRun !== run;
  const token = document.querySelector('meta[name="synchronizerToken"]')?.content || '';
  const sid = Math.random().toString(36).slice(2, 7) + Date.now();
  const H = { 'X-Requested-With': 'XMLHttpRequest', 'X-Synchronizer-Token': token };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => new Date().toLocaleTimeString();
  const strip = h => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const beep = (f = 880, ms = 700) => { try { const a = new AudioContext(), o = a.createOscillator(); o.connect(a.destination); o.frequency.value = f; o.start(); setTimeout(() => o.stop(), ms); } catch (e) {} };
  class LoggedOut extends Error {}

  // one request; network errors and timeouts are retried, a lost login is not
  async function req(path, opts = {}, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        const r = await fetch(base + path, { credentials: 'include', signal: AbortSignal.timeout(15000), ...opts, headers: { ...H, ...opts.headers } });
        const t = await r.text();
        if (t.trim() === 'userNotLoggedIn' || r.url.includes('/login') || r.url.includes('saml')) throw new LoggedOut();
        if (r.status >= 500 && i < tries) throw new Error('HTTP ' + r.status);
        return t;
      } catch (e) {
        if (e instanceof LoggedOut || i >= tries) throw e;
        await sleep(500 * i);
      }
    }
  }
  const json = async (path, opts, tries) => { const t = await req(path, opts, tries); try { return JSON.parse(t); } catch (e) { throw new Error('Unexpected reply from ' + path.split('?')[0] + ': ' + strip(t).slice(0, 200)); } };

  async function isOpen() {
    // Banner hands out a fwdURL even while closed, so first require the term in YOUR registration term list
    const open = await json('classRegistration/getTerms?searchTerm=&offset=1&max=10');
    if (!open.some(t => t.code === TERM)) return `${TERM} not in your registration terms yet (open now: ${open.map(t => t.code).join(', ') || 'none'})`;
    const j = await json('term/search?mode=registration', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ term: TERM, studyPath: '', studyPathText: '', startDatepicker: '', endDatepicker: '', uniqueSessionId: sid })
    });
    if ((j.studentEligFailures || []).length) return j.studentEligFailures.map(strip).join('; ');  // e.g. no time ticket yet
    if ((j.fwdURL || '').includes('classRegistration')) { await req('classRegistration/classRegistration'); return true; }
    return JSON.stringify(j).slice(0, 300);
  }

  async function register() {
    const t0 = performance.now(), models = [];
    for (const crn of CRNS) {  // one at a time: Banner keeps the cart in your session
      try {
        const j = await json(`classRegistration/addRegistrationItem?term=${TERM}&courseReferenceNumber=${crn}&olr=false`);
        if (!j.success || !j.model) { console.warn(crn, 'could not add:', strip(JSON.stringify(j.message || j)).slice(0, 300)); continue; }
        j.model.selectedAction = j.model.selectedAction || 'RW';
        models.push(j.model);
      } catch (e) { if (e instanceof LoggedOut) throw e; console.warn(crn, 'could not add:', e.message); }
    }
    if (!models.length) throw new Error('none of the CRNs could be added');
    // all CRNs in one batch so Banner checks lecture + lab links together; not retried, so it can't double-submit
    const j = await json('classRegistration/submitRegistration/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ create: [], update: models, destroy: [], uniqueSessionId: sid })
    }, 1);
    const rows = (j.data && j.data.update) || [];
    if (!rows.length) throw new Error('unexpected submit reply: ' + strip(JSON.stringify(j)).slice(0, 300));
    console.table(rows.map(r => ({ CRN: r.courseReferenceNumber, status: r.statusDescription, messages: (r.messages || []).map(m => strip(m.message)).join('; ') })));
    const ok = rows.filter(r => /regist/i.test(r.statusDescription || '') && !(r.messages || []).some(m => m.type === 'ERROR')).length;
    console.log(`%c${ok} of ${CRNS.length} CRNs look registered (${Math.round(performance.now() - t0)} ms). Refresh Register for Classes to confirm.`, 'font-size:14px;font-weight:bold');
    if (ok < CRNS.length) manual('some CRNs failed (see the table)');
  }
  function manual(why) {
    beep(440, 1500);
    console.log(`%cDO IT BY HAND NOW: ${why}.\n1) Fastest: Register for Classes > Plans tab > Add All > Submit\n2) Or: Enter CRNs tab, paste: ${CRNS.join(' ')}`, 'font-size:16px;color:red;font-weight:bold');
    try { navigator.clipboard.writeText(CRNS.join(' ')); console.log('(CRNs copied to your clipboard)'); } catch (e) {}
  }

  try {
    const terms = await json('classRegistration/getTerms?searchTerm=&offset=1&max=10');
    console.log('Logged in. Terms open to you for registration:', terms.map(t => t.code + ' ' + t.description).join(', ') || 'none yet');
    console.log(`Plan: ${CRNS.join(' ')} · term ${TERM} · ${AT ? 'opens ' + AT : 'no time set'} · ${GO ? 'WILL REGISTER' : 'dry run (GO = false)'}`);
    let at = null;
    if (AT) {
      const [h, m] = AT.split(':').map(Number); at = new Date(); at.setHours(h, m, 0, 0);
      if (at < Date.now() - 300000) at.setDate(at.getDate() + 1);
    }
    for (let i = 0; !stopped(); i++) {
      const early = at && at - Date.now() > 60000;  // more than a minute to go: check every 4 min (keeps the session alive)
      let s;
      try { s = await isOpen(); } catch (e) {
        if (e instanceof LoggedOut) throw e;
        s = 'check failed (' + (e.message || e) + '), retrying';  // network blip: keep going
      }
      if (stopped()) break;
      if (s === true) {
        beep(); console.log(`%c${now()} REGISTRATION IS OPEN`, 'font-size:16px;color:green');
        if (!GO) return console.log('Dry run: register now under Enter CRNs:', CRNS.join(' '));
        try { await register(); } catch (e) { if (e instanceof LoggedOut) throw e; manual(e.message || e); }
        return;
      }
      if (!AT && !GO) return console.log(`${now()} not open yet: ${s}`);  // quick test run
      if (early || i % 30 === 0 || s.startsWith('check failed')) console.log(`${now()} not open yet: ${s}${early ? ` · opens ${at.toLocaleTimeString()}, ${Math.round((at - Date.now()) / 60000)} min left` : ''}`);
      await sleep(early ? Math.min(at - Date.now() - 60000, 240000) : 1000);
    }
    console.log('Stopped.');
  } catch (e) {
    if (e instanceof LoggedOut) { beep(330, 2000); console.error('%cLOGGED OUT: sign in again on this tab (Register for Classes), then paste the script again.', 'font-size:16px'); }
    else console.error(e.message || e);
  }
})();
