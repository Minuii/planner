// UoS auto-register. Runs in YOUR logged-in browser tab, so no cookies or passwords leave the browser.
// 1. Sign in to UoS "Register for Classes" (reg-prod.ec.sharjah.ac.ae) and stay on any of its pages.
// 2. Edit the four settings below, press F12 > Console, paste this whole file, press Enter.
// 3. First run with GO = false (only checks login + whether registration is open). Then GO = true.
// Keep the tab open and the PC awake. To stop: type  uosStop = true  in the console.
(async () => {
  const CRNS = ['22459', '21046', '20112', '21036', '21037', '21047', '20203'];
  const TERM = '202620';
  const AT = '';        // e.g. '09:00' = registration opens at 9:00; until a minute before, it only checks every 4 min
  const GO = false;     // true = actually register the moment it opens

  const base = '/StudentRegistrationSsb/ssb/';
  if (!location.pathname.startsWith('/StudentRegistrationSsb/')) return console.error('Open a reg-prod.ec.sharjah.ac.ae registration page first, then paste this.');
  const token = document.querySelector('meta[name="synchronizerToken"]')?.content || '';
  const sid = Math.random().toString(36).slice(2, 7) + Date.now();
  const H = { 'X-Requested-With': 'XMLHttpRequest', 'X-Synchronizer-Token': token };
  const req = async (path, opts = {}) => {
    const r = await fetch(base + path, { credentials: 'include', ...opts, headers: { ...H, ...opts.headers } });
    const t = await r.text();
    if (t.trim() === 'userNotLoggedIn') throw new Error('Not logged in: sign in on this tab (Register for Classes), then paste again.');
    return t;
  };
  const strip = h => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const now = () => new Date().toLocaleTimeString();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const beep = () => { try { const a = new AudioContext(), o = a.createOscillator(); o.connect(a.destination); o.frequency.value = 880; o.start(); setTimeout(() => o.stop(), 700); } catch (e) {} };

  async function isOpen() {
    // Banner hands out a fwdURL even while closed, so first require the term in YOUR registration term list
    const open = JSON.parse(await req('classRegistration/getTerms?searchTerm=&offset=1&max=10'));
    if (!open.some(t => t.code === TERM)) return `${TERM} not in your registration terms yet (open now: ${open.map(t => t.code).join(', ') || 'none'})`;
    const t = await req('term/search?mode=registration', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ term: TERM, studyPath: '', studyPathText: '', startDatepicker: '', endDatepicker: '', uniqueSessionId: sid })
    });
    let j; try { j = JSON.parse(t); } catch (e) { return 'unexpected reply: ' + strip(t).slice(0, 200); }
    if ((j.studentEligFailures || []).length) return j.studentEligFailures.map(strip).join('; ');  // e.g. no time ticket yet
    if ((j.fwdURL || '').includes('classRegistration')) { await req('classRegistration/classRegistration'); return true; }
    return JSON.stringify(j).slice(0, 300);
  }

  async function register() {
    const models = [];
    for (const crn of CRNS) {
      const j = JSON.parse(await req(`classRegistration/addRegistrationItem?term=${TERM}&courseReferenceNumber=${crn}&olr=false`));
      if (!j.success) { console.warn(crn, 'could not add:', strip(JSON.stringify(j.message || j)).slice(0, 300)); continue; }
      j.model.selectedAction = j.model.selectedAction || 'RW';
      models.push(j.model);
    }
    if (!models.length) return;
    // all CRNs in one batch so Banner checks lecture + lab links together
    const j = JSON.parse(await req('classRegistration/submitRegistration/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ create: [], update: models, destroy: [], uniqueSessionId: sid })
    }));
    const rows = (j.data && j.data.update) || [];
    if (!rows.length) return console.error('Unexpected reply:', j);
    console.table(rows.map(r => ({ CRN: r.courseReferenceNumber, status: r.statusDescription, messages: (r.messages || []).map(m => strip(m.message)).join('; ') })));
    console.log('Check the result on the Register for Classes page (refresh it).');
  }

  try {
    const terms = JSON.parse(await req('classRegistration/getTerms?searchTerm=&offset=1&max=10'));
    console.log('Logged in. Terms open to you for registration:', terms.map(t => t.code + ' ' + t.description).join(', ') || 'none yet');
    window.uosStop = false;
    if (AT) {
      const [h, m] = AT.split(':').map(Number), at = new Date(); at.setHours(h, m, 0, 0);
      if (at < Date.now() - 300000) at.setDate(at.getDate() + 1);
      while (at - Date.now() > 60000 && !window.uosStop) {
        console.log(`${now()} opens ${at.toLocaleString()}, ${Math.round((at - Date.now()) / 60000)} min left; keeping the session alive`);
        await isOpen();  // a request every few minutes stops the session timing out
        await sleep(Math.min(at - Date.now() - 60000, 240000));
      }
    }
    for (let i = 0; !window.uosStop; i++) {
      const s = await isOpen();
      if (s === true) {
        beep(); console.log(`%c${now()} REGISTRATION IS OPEN`, 'font-size:16px;color:green');
        if (GO) await register(); else console.log('Dry run: set GO = true and paste again to register', CRNS.join(' '));
        return;
      }
      if (!GO) return console.log(`${now()} not open yet: ${s}`);
      if (i % 30 === 0) console.log(`${now()} not open yet: ${s}`);
      await sleep(1000);
    }
    console.log('Stopped.');
  } catch (e) { console.error(e.message || e); }
})();
