// UoS auto-register. Runs in YOUR logged-in browser tab, so no cookies or passwords leave the browser.
// Easiest: load this folder as a Chrome extension (see README), then use the panel on the registration page.
// Or the console way:
// 1. Sign in to UoS "Register for Classes" (reg-prod.ec.sharjah.ac.ae) and stay on any of its pages.
// 2. Edit SETTINGS below, press F12 > Console, paste this whole file, press Enter.
// 3. GO = false: only beeps when registration opens (with AT blank it does one quick check and stops).
//    GO = true: registers all CRNs the moment it opens.
// Keep the tab open and in front, the PC plugged in and awake. To stop: type  uosStop = true  in the console.
{
  const SETTINGS = {
    CRNS: ['22459', '21046', '20112', '21036', '21037', '21047', '20203'],
    TERM: '202620',
    AT: '09:00',  // registration opening time (24h, your PC clock). Until a minute before, it checks every 4 min
    GO: false,    // true = actually register the moment it opens
  };

  // say(kind, message, css): kind is log / warn / error / table. The extension passes its own to show it on the panel.
  const consoleSay = (kind, msg, css) => kind === 'table' ? console.table(msg) : css ? console[kind]('%c' + msg, css) : console[kind](msg);

  window.uosAutoreg = async ({ CRNS, TERM, AT, GO }, say = consoleSay) => {
    const base = '/StudentRegistrationSsb/ssb/';
    if (!location.pathname.startsWith('/StudentRegistrationSsb/')) return say('error', 'Open a reg-prod.ec.sharjah.ac.ae registration page first.');
    const run = window.uosRun = (window.uosRun || 0) + 1;  // starting again stops the older copy
    window.uosStop = false;
    const stopped = () => window.uosStop || window.uosRun !== run;
    const token = document.querySelector('meta[name="synchronizerToken"]')?.content || '';
    const sid = Math.random().toString(36).slice(2, 7) + Date.now();
    const H = { 'X-Requested-With': 'XMLHttpRequest', 'X-Synchronizer-Token': token };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const now = () => new Date().toLocaleTimeString();
    const strip = h => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const beep = (f = 880, ms = 700) => { try { const a = window.uosAudio || new AudioContext(), o = a.createOscillator(); a.resume?.(); o.connect(a.destination); o.frequency.value = f; o.start(); setTimeout(() => o.stop(), ms); } catch (e) {} };
    class LoggedOut extends Error {}

    // one request. Network errors, timeouts, server errors (5xx) and garbled replies (error pages) are retried;
    // a lost login is not. Waits 0.5 s, 1 s, … up to 3 s between tries.
    const RETRY = 120;  // during registration: keep trying ~6 min if the server is crashing
    async function req(path, opts = {}, tries = 3, parse = false) {
      for (let i = 1; ; i++) {
        try {
          const r = await fetch(base + path, { credentials: 'include', signal: AbortSignal.timeout(30000), ...opts, headers: { ...H, ...opts.headers } });
          const t = await r.text();
          if (t.trim() === 'userNotLoggedIn' || r.url.includes('/login') || r.url.includes('saml')) throw new LoggedOut();
          if (r.status >= 500) throw new Error('server error ' + r.status);
          if (!parse) return t;
          try { return JSON.parse(t); } catch (e) { throw new Error('unexpected reply from ' + path.split('?')[0] + ': ' + strip(t).slice(0, 150)); }
        } catch (e) {
          if (e instanceof LoggedOut || i >= tries || stopped()) throw e;
          if (i % 5 === 0) say('warn', `${now()} server struggling (${e.message || e}), still retrying ${path.split('?')[0].split('/').pop()}…`);
          await sleep(Math.min(500 * i, 3000));
        }
      }
    }
    const json = (path, opts, tries) => req(path, opts, tries, true);

    let listed = false;  // once Spring is in your registration terms it stays there, so check that only until it is
    async function isOpen() {
      if (!listed) {  // Banner hands out a fwdURL even while closed, so first require the term in YOUR registration term list
        const open = await json('classRegistration/getTerms?searchTerm=&offset=1&max=10');
        if (!open.some(t => t.code === TERM)) return `${TERM} not in your registration terms yet (open now: ${open.map(t => t.code).join(', ') || 'none'})`;
        listed = true;
      }
      const j = await json('term/search?mode=registration', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ term: TERM, studyPath: '', studyPathText: '', startDatepicker: '', endDatepicker: '', uniqueSessionId: sid })
      });
      if ((j.studentEligFailures || []).length) return j.studentEligFailures.map(strip).join('; ');  // e.g. no time ticket yet
      if ((j.fwdURL || '').includes('classRegistration')) { await req('classRegistration/classRegistration', {}, RETRY); return true; }
      return JSON.stringify(j).slice(0, 300);
    }

    async function register() {
      const t0 = performance.now(), models = [];
      for (const crn of CRNS) {  // one at a time: Banner keeps the cart in your session
        try {
          const j = await json(`classRegistration/addRegistrationItem?term=${TERM}&courseReferenceNumber=${crn}&olr=false`, {}, RETRY);
          if (!j.success || !j.model) { say('warn', `${crn} could not add: ${strip(JSON.stringify(j.message || j)).slice(0, 300)}`); continue; }
          j.model.selectedAction = j.model.selectedAction || 'RW';
          models.push(j.model);
        } catch (e) { if (e instanceof LoggedOut) throw e; say('warn', `${crn} could not add: ${e.message}`); }
      }
      if (!models.length) throw new Error('none of the CRNs could be added');
      // all CRNs in one batch so Banner checks lecture + lab links together. Retried on crashes: a CRN you're
      // already in can't be registered twice (Banner just reports it as a duplicate on the second try).
      const j = await json('classRegistration/submitRegistration/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: [], update: models, destroy: [], uniqueSessionId: sid })
      }, RETRY);
      let rows = (j.data && j.data.update) || [];
      if (!rows.length) throw new Error('unexpected submit reply: ' + strip(JSON.stringify(j)).slice(0, 300));
      // closed section: if Banner offers a waitlist action for it, submit those again as Waitlisted
      const failed = r => !/regist/i.test(r.statusDescription || '') || (r.messages || []).some(m => m.type === 'ERROR');
      const wl = rows.filter(failed).map(r => [r, (r.registrationActions || []).find(a => /wait/i.test(a.description || ''))]).filter(x => x[1]);
      if (wl.length) {
        say('warn', `Closed: ${wl.map(x => x[0].courseReferenceNumber).join(', ')}. Joining the waitlist…`);
        try {
          const w = await json('classRegistration/submitRegistration/batch', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ create: [], update: wl.map(([r, a]) => ({ ...r, selectedAction: a.courseRegistrationStatus || a.voiceType || a.code })), destroy: [], uniqueSessionId: sid })
          }, RETRY);
          const back = new Map(((w.data && w.data.update) || []).map(r => [r.courseReferenceNumber, r]));
          rows = rows.map(r => back.get(r.courseReferenceNumber) || r);
        } catch (e) { if (e instanceof LoggedOut) throw e; say('warn', 'Waitlist step failed: ' + e.message); }
      }
      say('table', rows.map(r => ({ CRN: r.courseReferenceNumber, status: r.statusDescription, messages: (r.messages || []).map(m => strip(m.message)).join('; ') })));
      const ok = rows.filter(r => !failed(r)).length, waiting = rows.filter(r => /wait/i.test(r.statusDescription || '')).length;
      if (waiting) say('log', `${waiting} CRN(s) WAITLISTED. Watch your UoS email/phone alerts for a seat.`, 'font-size:14px;color:red;font-weight:bold');
      say('log', `${ok} of ${CRNS.length} CRNs look registered (${Math.round(performance.now() - t0)} ms). Refresh Register for Classes to confirm.`, 'font-size:14px;font-weight:bold');
      if (ok + waiting < CRNS.length) manual('some CRNs failed (see the table)');
    }
    function manual(why) {
      beep(440, 1500);
      say('log', `DO IT BY HAND NOW: ${why}.\n1) Fastest: Register for Classes > Plans tab > Add All > Submit\n2) Or: Enter CRNs tab, paste: ${CRNS.join(' ')}`, 'font-size:16px;color:red;font-weight:bold');
      try { navigator.clipboard.writeText(CRNS.join(' ')); say('log', '(CRNs copied to your clipboard)'); } catch (e) {}
    }

    try {
      const terms = await json('classRegistration/getTerms?searchTerm=&offset=1&max=10', {}, RETRY);
      listed = terms.some(t => t.code === TERM);
      say('log', 'Logged in. Terms open to you for registration: ' + (terms.map(t => t.code + ' ' + t.description).join(', ') || 'none yet'));
      say('log', `Plan: ${CRNS.join(' ')} · term ${TERM} · ${AT ? 'opens ' + AT : 'no time set'} · ${GO ? 'WILL REGISTER' : 'dry run (GO = false)'}`);
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
          beep(); say('log', `${now()} REGISTRATION IS OPEN`, 'font-size:16px;color:green');
          if (!GO) return say('log', 'Dry run: register now (Plans > Add All > Submit, or Enter CRNs): ' + CRNS.join(' '));
          try { await register(); } catch (e) { if (e instanceof LoggedOut) throw e; manual(e.message || e); }
          return;
        }
        if (!AT && !GO) return say('log', `${now()} not open yet: ${s}`);  // quick test run
        if (early || i % 30 === 0 || s.startsWith('check failed')) say('log', `${now()} not open yet: ${s}${early ? ` · opens ${at.toLocaleTimeString()}, ${Math.round((at - Date.now()) / 60000)} min left` : ''}`);
        await sleep(early ? Math.min(at - Date.now() - 60000, 240000) : 1000);
      }
      say('log', 'Stopped.');
    } catch (e) {
      if (e instanceof LoggedOut) { beep(330, 2000); say('error', 'LOGGED OUT: sign in again on this tab (Register for Classes), then start again.', 'font-size:16px'); }
      else say('error', e.message || String(e));
    }
  };

  if (!globalThis.chrome?.runtime?.id) window.uosAutoreg(SETTINGS);  // console paste runs right away; the extension waits for Start
}
