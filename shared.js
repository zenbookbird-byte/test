/**
 * shared.js — CopyTrade Pro shared utilities
 * Included by every dashboard page. Exposes window.CTP.
 *
 * Features:
 *  - Toast notification system  (CTP.toast)
 *  - Sound alerts               (CTP.playSound / CTP.setSoundEnabled)
 *  - Browser push notifications (CTP.requestNotifPermission)
 *  - /events SSE stream         (CTP.connectEvents / CTP.onEvent)
 *  - Keyboard shortcut manager  (CTP.addShortcut / ? overlay)
 *  - CSV export helper          (CTP.exportCSV)
 */
;(function (window) {
  'use strict';

  /* ════════════════════════════════════════════════════════
     TOAST SYSTEM
  ════════════════════════════════════════════════════════ */
  const TOAST_CFG = {
    buy:    { label: 'BUY',    bg: 'rgba(56,189,248,.15)',  border: '#38bdf8', icon: '→' },
    sell:   { label: 'EXIT',   bg: 'rgba(255,208,0,.12)',   border: '#ffd000', icon: '←' },
    win:    { label: 'WIN',    bg: 'rgba(0,255,106,.12)',   border: '#00ff6a', icon: '✓' },
    loss:   { label: 'LOSS',   bg: 'rgba(255,59,59,.12)',   border: '#ff3b3b', icon: '✗' },
    signal: { label: 'SIGNAL', bg: 'rgba(168,85,247,.12)',  border: '#a855f7', icon: '◉' },
    pause:  { label: 'PAUSED', bg: 'rgba(255,208,0,.12)',   border: '#ffd000', icon: '⏸' },
    resume: { label: 'LIVE',   bg: 'rgba(0,255,106,.12)',   border: '#00ff6a', icon: '▶' },
    error:  { label: 'ERROR',  bg: 'rgba(255,59,59,.1)',    border: '#ff3b3b', icon: '⚠' },
    info:   { label: 'INFO',   bg: 'rgba(255,255,255,.06)', border: '#505050', icon: 'ℹ' },
  };

  function _ensureContainer() {
    let c = document.getElementById('ctp-toasts');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'ctp-toasts';
    Object.assign(c.style, {
      position: 'fixed', top: '16px', right: '16px', zIndex: '9999',
      display: 'flex', flexDirection: 'column', gap: '8px',
      pointerEvents: 'none', maxWidth: '340px',
    });
    document.body.appendChild(c);
    return c;
  }

  function toast(type, message, sub) {
    const cfg = TOAST_CFG[type] || TOAST_CFG.info;
    const c   = _ensureContainer();
    const el  = document.createElement('div');
    Object.assign(el.style, {
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: '10px', padding: '10px 14px',
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      backdropFilter: 'blur(8px)', pointerEvents: 'auto',
      opacity: '0', transform: 'translateX(20px)',
      transition: 'opacity .2s, transform .2s',
      minWidth: '220px',
    });
    el.innerHTML = `
      <span style="font-size:1rem;line-height:1.2;flex-shrink:0">${cfg.icon}</span>
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:.58rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${cfg.border}">${cfg.label}</span>
        </div>
        <div style="font-size:.78rem;color:#efefef;margin-top:2px;word-break:break-word">${_esc(message)}</div>
        ${sub ? `<div style="font-size:.68rem;color:#505050;margin-top:2px">${_esc(sub)}</div>` : ''}
      </div>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#505050;cursor:pointer;font-size:.9rem;padding:0;flex-shrink:0;align-self:flex-start">✕</button>
    `;
    c.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity   = '1';
      el.style.transform = 'translateX(0)';
    });
    setTimeout(() => {
      el.style.opacity   = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 250);
    }, 6000);
    playSound(type);
    sendNotif(type, message);
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }


  /* ════════════════════════════════════════════════════════
     SOUND ALERTS  (Web Audio API)
  ════════════════════════════════════════════════════════ */
  let _soundEnabled = true;
  let _audioCtx     = null;

  function _getCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  // Plays a short beep. freq=Hz, dur=ms, type=oscillator waveform
  function _beep(freq, dur, vol, type='sine', delay=0) {
    try {
      const ctx  = _getCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type      = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur/1000);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime  + delay + dur/1000 + 0.05);
    } catch {}
  }

  const SOUNDS = {
    win:    () => { _beep(440,120,.15); _beep(660,180,.12,undefined,.13); _beep(880,200,.1,undefined,.28); },
    loss:   () => { _beep(330,200,.12); _beep(220,300,.1,undefined,.22); },
    buy:    () => { _beep(520,80,.08,'square'); },
    sell:   () => { _beep(380,100,.08,'square'); },
    signal: () => { _beep(600,60,.06); _beep(600,60,.06,undefined,.12); },
    pause:  () => { _beep(300,200,.08,'triangle'); },
    resume: () => { _beep(500,150,.08,'triangle'); },
  };

  function playSound(type) {
    if (!_soundEnabled) return;
    const fn = SOUNDS[type];
    if (fn) fn();
  }

  function setSoundEnabled(val) { _soundEnabled = !!val; }
  function isSoundEnabled()     { return _soundEnabled; }


  /* ════════════════════════════════════════════════════════
     BROWSER PUSH NOTIFICATIONS
  ════════════════════════════════════════════════════════ */
  let _notifEnabled = false;

  async function requestNotifPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') { _notifEnabled = true; return true; }
    if (Notification.permission === 'denied')  return false;
    const result = await Notification.requestPermission();
    _notifEnabled = result === 'granted';
    return _notifEnabled;
  }

  function sendNotif(type, message) {
    if (!_notifEnabled || document.visibilityState === 'visible') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const cfg = TOAST_CFG[type] || TOAST_CFG.info;
    try {
      new Notification(`CopyTrade Pro · ${cfg.label}`, {
        body: message,
        icon: '/favicon.ico',
        tag:  type + '-' + Date.now(),
      });
    } catch {}
  }


  /* ════════════════════════════════════════════════════════
     /events SSE STREAM
  ════════════════════════════════════════════════════════ */
  const _eventHandlers = [];
  let   _evtSource     = null;

  function connectEvents() {
    if (_evtSource) return;
    _evtSource = new EventSource('/events');
    _evtSource.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        _dispatchEvent(ev);
      } catch {}
    };
    _evtSource.onerror = () => {
      // Auto-reconnect in 5s
      _evtSource.close(); _evtSource = null;
      setTimeout(connectEvents, 5000);
    };
  }

  function _dispatchEvent(ev) {
    // Show a toast for trading events
    const labels = {
      win:    (ev) => [`+$${Math.abs(ev.pnl||0).toFixed(2)} — ${(ev.title||'').slice(0,50)}`],
      loss:   (ev) => [`-$${Math.abs(ev.pnl||0).toFixed(2)} — ${(ev.title||'').slice(0,50)}`],
      buy:    (ev) => [`$${(ev.size||0).toFixed(2)} @ ${(ev.price||0).toFixed(3)}`, (ev.title||'').slice(0,50)],
      sell:   (ev) => [(ev.title||'').slice(0,60)],
      signal: (ev) => [`${ev.votes}/${ev.threshold} wallets agree`, (ev.title||'').slice(0,50)],
      pause:  ()   => ['Bot paused — scanning stopped'],
      resume: ()   => ['Bot resumed — back to scanning'],
    };
    const fn = labels[ev.type];
    if (fn) {
      const [msg, sub] = fn(ev);
      toast(ev.type, msg, sub);
    }
    // Dispatch to page-specific handlers
    _eventHandlers.forEach(h => { try { h(ev); } catch {} });
  }

  function onEvent(handler) { _eventHandlers.push(handler); }


  /* ════════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS
  ════════════════════════════════════════════════════════ */
  const _shortcuts = {};   // key → {description, handler}
  let   _helpOpen  = false;

  function addShortcut(key, description, handler) {
    _shortcuts[key.toLowerCase()] = { description, handler };
  }

  function _showHelp() {
    if (_helpOpen) { _closeHelp(); return; }
    _helpOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'ctp-kb-help';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '10000', backdropFilter: 'blur(4px)',
    });
    const keys = Object.entries(_shortcuts).map(([k, v]) =>
      `<tr>
        <td style="padding:6px 14px 6px 0">
          <kbd style="background:#1e1e1e;border:1px solid #333;border-radius:4px;padding:2px 8px;font-size:.8rem;font-family:monospace">${_esc(k.toUpperCase())}</kbd>
        </td>
        <td style="font-size:.8rem;color:#ccc">${_esc(v.description)}</td>
      </tr>`
    ).join('');
    overlay.innerHTML = `
      <div style="background:#0e0e0e;border:1px solid #282828;border-radius:14px;padding:28px 32px;min-width:300px">
        <div style="font-size:.6rem;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#505050;margin-bottom:16px">Keyboard Shortcuts</div>
        <table style="border-collapse:collapse;width:100%">${keys}</table>
        <div style="margin-top:18px;font-size:.65rem;color:#383838;text-align:center">Press <kbd style="background:#1e1e1e;border:1px solid #333;border-radius:3px;padding:1px 6px">?</kbd> or <kbd style="background:#1e1e1e;border:1px solid #333;border-radius:3px;padding:1px 6px">ESC</kbd> to close</div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeHelp(); });
    document.body.appendChild(overlay);
  }

  function _closeHelp() {
    _helpOpen = false;
    document.getElementById('ctp-kb-help')?.remove();
  }

  document.addEventListener('keydown', (e) => {
    // Don't fire shortcuts when typing in inputs
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === '?' || k === '/') { e.preventDefault(); _showHelp(); return; }
    if (k === 'escape')         { _closeHelp(); return; }
    const sc = _shortcuts[k];
    if (sc) { e.preventDefault(); sc.handler(); }
  });


  /* ════════════════════════════════════════════════════════
     CSV EXPORT HELPER
  ════════════════════════════════════════════════════════ */
  function exportCSV(rows, filename) {
    if (!rows.length) { toast('info', 'No data to export'); return; }
    const headers = Object.keys(rows[0]);
    const lines   = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = r[h] ?? '';
        return String(v).includes(',') ? `"${String(v).replace(/"/g,'""')}"` : String(v);
      }).join(',')),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename || `copytrade-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }


  /* ════════════════════════════════════════════════════════
     GLOBAL INIT
  ════════════════════════════════════════════════════════ */
  function init(opts) {
    opts = opts || {};
    if (opts.events !== false) connectEvents();
    if (opts.notifications) requestNotifPermission();
    // Register universal shortcuts
    addShortcut('?', 'Show this help', _showHelp);
    addShortcut('n', 'Request notification permission', requestNotifPermission);
    addShortcut('s', 'Toggle sound alerts', () => {
      setSoundEnabled(!isSoundEnabled());
      toast('info', isSoundEnabled() ? 'Sound ON' : 'Sound OFF');
    });
  }


  /* ════════════════════════════════════════════════════════
     EXPORTS
  ════════════════════════════════════════════════════════ */
  window.CTP = {
    toast, playSound, setSoundEnabled, isSoundEnabled,
    requestNotifPermission, sendNotif,
    connectEvents, onEvent,
    addShortcut, showShortcutHelp: _showHelp,
    exportCSV,
    init,
  };

})(window);
