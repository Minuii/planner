// On-page panel for uos_autoreg.js: type CRNs / time, press Start. Settings are remembered in this browser.
(() => {
  const KEY = 'uosAutoregCfg';
  let cfg = { crns: '22459 21046 20112 21036 21037 21047 20203', term: '202620', at: '09:00', go: false, open: true };
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial}
    .p{font:13px/1.4 system-ui,sans-serif;color:#1d1d1b;background:#fbf9f4;border:1px solid #c9c2b2;border-radius:6px;width:340px;box-shadow:0 2px 10px #0003}
    .h{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#1e5a4c;color:#fff;border-radius:5px 5px 0 0;cursor:pointer;font-weight:600}
    .b{padding:10px;display:grid;gap:8px}
    label{display:grid;gap:3px;font-size:12px;color:#5b574d}
    input[type=text],input[type=time]{font:13px ui-monospace,monospace;padding:6px;border:1px solid #c9c2b2;border-radius:4px;background:#fff}
    .row{display:flex;gap:8px;align-items:center}
    button{font:600 13px system-ui;padding:7px 12px;border:0;border-radius:4px;cursor:pointer}
    .start{background:#1e5a4c;color:#fff;flex:1} .stop{background:#e4ded1;color:#1d1d1b}
    .log{font:11.5px/1.45 ui-monospace,monospace;background:#fff;border:1px solid #e4ded1;border-radius:4px;padding:6px;max-height:220px;overflow:auto;white-space:pre-wrap}
    .warn{color:#9a5b00} .error{color:#b3261e;font-weight:700} .big{font-weight:700} .red{color:#b3261e} .green{color:#1e7a3c}
    .st{font-size:12px} .on{color:#1e7a3c;font-weight:700}
  </style>
  <div class="p">
    <div class="h"><span>UoS auto-register</span><span id="tog"></span></div>
    <div class="b" id="body">
      <label>CRNs (spaces or commas)<input id="crns" type="text"></label>
      <div class="row">
        <label style="flex:1">Opens at<input id="at" type="time"></label>
        <label style="flex:1">Term<input id="term" type="text"></label>
      </div>
      <label class="row" style="color:#1d1d1b"><input id="go" type="checkbox"> Actually register (off = only beep when it opens)</label>
      <div class="row"><button class="start" id="start">Start</button><button class="stop" id="stop">Stop</button></div>
      <div class="st" id="st">Not running.</div>
      <div class="log" id="log"></div>
    </div>
  </div>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  const fill = () => {
    $('crns').value = cfg.crns; $('at').value = cfg.at; $('term').value = cfg.term; $('go').checked = cfg.go;
    $('body').hidden = !cfg.open; $('tog').textContent = cfg.open ? '–' : '+';
  };
  fill();
  root.addEventListener('change', () => { cfg = { ...cfg, crns: $('crns').value, at: $('at').value, term: $('term').value.trim(), go: $('go').checked }; save(); });
  $('tog').parentElement.onclick = () => { cfg.open = !cfg.open; save(); fill(); };

  const log = (kind, msg, css = '') => {
    const d = document.createElement('div');
    if (kind === 'table') { d.textContent = msg.map(r => `${r.CRN}  ${r.status}${r.messages ? '  ' + r.messages : ''}`).join('\n'); d.className = 'big'; }
    else { d.textContent = msg; d.className = kind + (/16px/.test(css) ? ' big' : '') + (/red/.test(css) ? ' red' : /green/.test(css) ? ' green' : ''); }
    $('log').append(d); $('log').scrollTop = 1e9;
    kind === 'table' ? console.table(msg) : console[kind]('[autoreg] ' + msg);
  };

  $('start').onclick = async () => {
    const crns = (cfg.crns.match(/\d{5}/g) || []);
    if (!crns.length) return log('error', 'Type at least one 5-digit CRN.');
    if (!/^\d{6}$/.test(cfg.term)) return log('error', 'Term should be 6 digits, e.g. 202620.');
    if (cfg.go && !confirm(`Register ${crns.length} CRNs for ${cfg.term} at ${cfg.at || 'the moment it opens'}?\n\n${crns.join(' ')}`)) return;
    try { window.uosAudio = window.uosAudio || new AudioContext(); window.uosAudio.resume(); } catch (e) {}  // this click unlocks the beep
    $('log').textContent = '';
    $('st').innerHTML = `<span class="on">Running</span>: keep this tab open and in front, PC awake. ${cfg.go ? 'Will register.' : 'Beep only.'}`;
    await window.uosAutoreg({ CRNS: crns, TERM: cfg.term, AT: cfg.at, GO: cfg.go }, log);
    $('st').textContent = 'Not running.';
  };
  $('stop').onclick = () => { window.uosStop = true; window.uosRun = (window.uosRun || 0) + 1; $('st').textContent = 'Stopped.'; log('log', 'Stopped.'); };
})();
