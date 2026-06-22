// ============================================================
//  圣坛之蛇 · Dota Snake  —  含 Dota2 连杀播报系统
// ============================================================

// ---------- DOM ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const lengthEl = document.getElementById('length');
const clockEl = document.getElementById('clock');
const muteBtn = document.getElementById('muteBtn');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlaySub = document.getElementById('overlaySub');
const difficultyGroup = document.getElementById('difficulty');
const resumeBtn = document.getElementById('resumeBtn');
const pauseBtn = document.getElementById('pauseBtn');
const newGameBtn = document.getElementById('newGameBtn');

// ---------- 常量 ----------
const GRID = 20;
const LOGICAL = 420;
const CELL = LOGICAL / GRID;
const TAU = Math.PI * 2;
const MULTI_WINDOW = 18000; // Dota 连杀窗口：每次击杀后 18 秒内再击杀延续连杀（双杀/三杀…）

const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = LOGICAL * dpr;
canvas.height = LOGICAL * dpr;
ctx.scale(dpr, dpr);

const DIFFICULTY = {
  herald:   { step: 175, min: 115, accel: 1.3, label: '先锋' },
  crusader: { step: 130, min: 80,  accel: 2.2, label: '卫士' },
  legend:   { step: 95,  min: 55,  accel: 2.8, label: '传奇' },
  immortal: { step: 65,  min: 38,  accel: 3.4, label: '万古' },
};
let difficultyKey = localStorage.getItem('snakeDifficulty') || 'crusader';
if (!DIFFICULTY[difficultyKey]) difficultyKey = 'crusader';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const fmtClock = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ============================================================
//  音效（Web Audio 合成）
// ============================================================
const Sfx = (() => {
  let actx = null, master = null, ambient = null;
  let enabled = localStorage.getItem('snakeMuted') !== '1';
  function ensure() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC(); master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
  }
  function blip(freq, dur, type, vol, when = 0, glide = null) {
    if (!enabled || !actx) return;
    const t0 = actx.currentTime + when;
    const osc = actx.createOscillator(); const g = actx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + dur + 0.03);
  }
  function noise(dur, vol, ff) {
    if (!enabled || !actx) return;
    const n = Math.floor(actx.sampleRate * dur); const buf = actx.createBuffer(1, n, actx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource(); src.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = ff;
    const g = actx.createGain(); g.gain.value = vol; src.connect(f); f.connect(g); g.connect(master); src.start(actx.currentTime);
  }
  return {
    ensure, isEnabled: () => enabled,
    toggle() { enabled = !enabled; localStorage.setItem('snakeMuted', enabled ? '0' : '1'); if (!enabled) this.stopAmbient(); else ensure(); return enabled; },
    eat(c) { ensure(); const b = 720 + Math.min(c, 14) * 32; blip(b, 0.07, 'triangle', 0.18, 0); blip(b * 1.5, 0.1, 'triangle', 0.13, 0.05); },
    hit(level) { ensure(); const n = [392, 523, 659, 784, 988, 1175]; const k = Math.min(level + 1, n.length); for (let i = 0; i < k; i++) blip(n[i], 0.14, 'sawtooth', 0.12, i * 0.05); },
    start() { ensure(); blip(330, 0.16, 'sawtooth', 0.13, 0, 660); blip(660, 0.22, 'triangle', 0.1, 0.05); },
    death() { ensure(); blip(196, 0.55, 'sawtooth', 0.26, 0, 60); blip(98, 0.9, 'square', 0.2, 0.04, 44); noise(0.45, 0.28, 800); },
    click() { ensure(); blip(440, 0.04, 'square', 0.07, 0); },
    startAmbient() {
      if (!enabled) return; ensure(); if (!actx || ambient) return;
      const g = actx.createGain(); g.gain.value = 0.0001; g.gain.linearRampToValueAtTime(0.04, actx.currentTime + 2);
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
      const o1 = actx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      const o2 = actx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.5;
      const lfo = actx.createOscillator(); lfo.frequency.value = 0.08; const lg = actx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(f.frequency);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); o1.start(); o2.start(); lfo.start();
      ambient = { o1, o2, lfo, g };
    },
    stopAmbient() {
      if (!ambient || !actx) return;
      const { o1, o2, lfo, g } = ambient; const t = actx.currentTime;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
      [o1, o2, lfo].forEach((o) => { try { o.stop(t + 0.6); } catch (e) {} });
      ambient = null;
    },
  };
})();

// ============================================================
//  播报员：优先用 audio/ 真实音频，其次浏览器 TTS 念出短语
// ============================================================
const Announcer = (() => {
  let voice = null, enabled = true;
  let preferred = localStorage.getItem('snakeVoice') || '';
  // 优先挑选「自然/增强」女声
  const FEMALE = /(samantha|ava|allison|susan|zoe|karen|moira|tessa|fiona|serena|kate|stephanie|veena|nicky|joelle|sandy|paulina|isha|female|woman|girl|zira|aria|jenny|libby|sonia)/i;
  const NICE = /(enhanced|premium|neural|siri|natural|online)/i;
  function pick() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return;
    if (preferred) { const v = vs.find((x) => x.name === preferred); if (v) { voice = v; return; } }
    const en = vs.filter((v) => /^en/i.test(v.lang));
    const pool = en.length ? en : vs;
    voice = pool.find((v) => FEMALE.test(v.name) && NICE.test(v.name))   // 增强女声（最佳）
         || pool.find((v) => FEMALE.test(v.name))                         // 普通女声
         || pool.find((v) => NICE.test(v.name))                           // 任意增强声
         || pool[0] || null;
  }
  return {
    refresh: pick,
    listVoices() { return ('speechSynthesis' in window) ? speechSynthesis.getVoices() : []; },
    getVoice() { return voice; },
    setVoiceByName(name) { preferred = name; localStorage.setItem('snakeVoice', name); const v = this.listVoices().find((x) => x.name === name); if (v) voice = v; },
    setEnabled(b) { enabled = b; if (!b && 'speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} } },
    say(text, onend) {
      if (!enabled || !('speechSynthesis' in window)) { if (onend) onend(); return; }
      try {
        if (!voice) pick();
        const u = new SpeechSynthesisUtterance(text);
        if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
        u.rate = 0.85; u.pitch = 1.0; u.volume = 1; // 自然音高 + 略慢，更柔和
        u.onend = () => { if (onend) onend(); };
        u.onerror = () => { if (onend) onend(); };
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch (e) { if (onend) onend(); }
    },
  };
})();

// 短语 + 中文副标题
const CLIPS = {
  firstblood:   ['First Blood', '首杀'],
  doublekill:   ['Double Kill', '双杀'],
  triplekill:   ['Triple Kill', '三杀'],
  ultrakill:    ['Ultra Kill', '四杀'],
  rampage:      ['Rampage', '团灭'],
  killingspree: ['Killing Spree', '杀戮无双'],
  dominating:   ['Dominating', '主宰全场'],
  megakill:     ['Mega Kill', '横扫千军'],
  unstoppable:  ['Unstoppable', '势不可挡'],
  wickedsick:   ['Wicked Sick', '邪恶狂徒'],
  monsterkill:  ['Monster Kill', '怪物级杀戮'],
  godlike:      ['Godlike', '神之屠戮'],
  holyshit:     ['Holy Shit', '鬼神杀戮'],
};
const clipAudio = {}, clipReady = {};
function initClips() {
  for (const k in CLIPS) {
    try {
      const a = new Audio('audio/' + k + '.mp3'); a.preload = 'auto'; a.volume = 0.95;
      a.addEventListener('canplaythrough', () => { clipReady[k] = true; }, { once: true });
      a.addEventListener('error', () => { clipReady[k] = false; }, { once: true });
      clipAudio[k] = a;
    } catch (e) {}
  }
}
// 播放单条播报（真实音频优先，否则 TTS），结束后回调
function playAnnouncement(key, onDone) {
  let done = false;
  const finish = () => { if (done) return; done = true; if (onDone) onDone(); };
  if (clipReady[key] && clipAudio[key]) {
    const a = clipAudio[key];
    try { a.onended = finish; a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => finish()); }
    catch (e) { finish(); return; }
    setTimeout(finish, 3500); // 兜底
  } else {
    Announcer.say(CLIPS[key] ? CLIPS[key][0] : key, finish);
    setTimeout(finish, 2600); // 兜底（onend 不触发时）
  }
}

// 顺序播报队列：连杀与连续击杀可同一次触发，依次播报，高优先级先播
let annQueue = [], annBusy = false;
function enqueueAnn(key, prio) {
  if (!Sfx.isEnabled()) return;
  if (annQueue.some((a) => a.key === key)) return; // 去重：避免持续 Rampage/Holy Shit 堆积
  annQueue.push({ key, prio });
  if (annQueue.length > 3) { annQueue.sort((a, b) => b.prio - a.prio); annQueue.length = 3; }
  pumpAnn();
}
function pumpAnn() {
  if (annBusy || !annQueue.length) return;
  annQueue.sort((a, b) => b.prio - a.prio);
  const next = annQueue.shift();
  annBusy = true;
  playAnnouncement(next.key, () => { annBusy = false; setTimeout(pumpAnn, 150); });
}
function stopAnnouncements() {
  annQueue = []; annBusy = false;
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
  for (const k in clipAudio) { try { clipAudio[k].pause(); clipAudio[k].currentTime = 0; } catch (e) {} }
}

// 连杀分级
// 播报顺序规则：连续击杀(状态)永远先播，多重击杀(动作)后播。
// 用优先级实现 —— 连续击杀 prio(50+) 始终高于多重击杀 prio(10+)，队列按 prio 降序播放。

// 多重击杀(短时间连续击杀，prio 较低 → 后播)。5 杀及以上持续 RAMPAGE
function multiTier(m) {
  if (m === 2) return { key: 'doublekill', prio: 11 };
  if (m === 3) return { key: 'triplekill', prio: 12 };
  if (m === 4) return { key: 'ultrakill', prio: 13 };
  if (m >= 5) return { key: 'rampage', prio: 14 }; // 团灭，之后每杀持续触发
  return null;
}
// 连续击杀(中途不死，prio 较高 → 先播)：杀戮无双 → … → 神之屠戮 → 鬼神杀戮(10+ 持续)
function streakTier(s) {
  const map = { 3: ['killingspree', 51], 4: ['dominating', 52], 5: ['megakill', 53], 6: ['unstoppable', 54], 7: ['wickedsick', 55], 8: ['monsterkill', 56], 9: ['godlike', 57], 10: ['holyshit', 58] };
  if (map[s]) return { key: map[s][0], prio: map[s][1] };
  if (s > 10) return { key: 'holyshit', prio: 58 }; // 10 杀以上每次都喊 Holy Shit
  return null;
}

// ============================================================
//  状态
// ============================================================
let snake, prevSnake, direction, nextDirection, food;
let score, stepInterval, minInterval, baseAccel;
let acc, lastTime, state, elapsed;
let multi, streak, lastEatTime, exploded;
let particles = [], popups = [], shockwaves = [], banners = [];
let foodPulse = 0, ringAngle = 0, shakeT = 0, shakeT0 = 1, shakeAmp = 0, flash = 0;
let highScore = Number(localStorage.getItem('snakeHighScore') || 0);

// ============================================================
//  生命周期
// ============================================================
function resetBoard() {
  snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
  prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  score = 0; multi = 0; streak = 0; lastEatTime = -1e9; elapsed = 0; exploded = false;
  const d = DIFFICULTY[difficultyKey];
  stepInterval = d.step; minInterval = d.min; baseAccel = d.accel;
  acc = 0; particles = []; popups = []; shockwaves = []; banners = []; shakeT = 0; flash = 0;
  stopAnnouncements();
  scoreEl.textContent = '0'; lengthEl.textContent = snake.length; bestEl.textContent = highScore; clockEl.textContent = '0:00';
  placeFood();
  state = 'ready';
  overlayTitle.textContent = '圣坛之蛇';
  overlaySub.textContent = '选择段位，开始征程';
  difficultyGroup.classList.remove('hidden');
  resumeBtn.classList.add('hidden');
  pauseBtn.textContent = '暂停';
  highlightDifficulty();
  showOverlay();
}
function highlightDifficulty() {
  difficultyGroup.querySelectorAll('.rank').forEach((b) => b.classList.toggle('active', b.dataset.diff === difficultyKey));
}
function beginRun() {
  state = 'running'; lastTime = performance.now(); acc = 0; pauseBtn.textContent = '暂停';
  hideOverlay(); Sfx.ensure(); Sfx.start(); Sfx.startAmbient();
}
function togglePause() {
  if (state === 'running') {
    state = 'paused';
    overlayTitle.textContent = '已暂停'; overlaySub.textContent = '按空格键或“继续征战”恢复';
    difficultyGroup.classList.add('hidden'); resumeBtn.classList.remove('hidden'); pauseBtn.textContent = '继续';
    Sfx.stopAmbient(); stopAnnouncements(); showOverlay();
  } else if (state === 'paused') {
    state = 'running'; lastTime = performance.now(); acc = 0; pauseBtn.textContent = '暂停'; hideOverlay(); Sfx.startAmbient();
  }
}
function endGame() {
  state = 'over'; exploded = true;
  stopAnnouncements();
  const record = score > highScore;
  if (record) { highScore = score; localStorage.setItem('snakeHighScore', highScore); bestEl.textContent = highScore; }
  const pts = snake.map((_, i) => segCenter(i, 1));
  spawnExplosion(pts);
  shockwave(pts[0].x, pts[0].y, CELL * 5.5, 'rgba(255,90,90,0.85)', 0.7);
  triggerShake(12, 560); flash = 1.15;
  Sfx.death(); Sfx.stopAmbient();
  banner(record ? 'VICTORY' : 'DEFEAT', record ? '新纪录' : '败北', record ? 'gold' : 'dire', 2.2, 46);
  overlayTitle.textContent = record ? '🏆 新纪录' : '⚔ 败北';
  overlaySub.textContent = `黄金 ${score} · 长度 ${snake.length} · 用时 ${fmtClock(elapsed)}`;
  difficultyGroup.classList.remove('hidden'); resumeBtn.classList.add('hidden'); pauseBtn.textContent = '重新开始';
  highlightDifficulty();
  setTimeout(() => { if (state === 'over') showOverlay(); }, 900);
}
function placeFood() {
  let pos;
  do { pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }; }
  while (snake.some((s) => s.x === pos.x && s.y === pos.y));
  food = pos; foodPulse = 0;
}

function update() {
  const before = snake.map((s) => ({ x: s.x, y: s.y }));
  direction = nextDirection;
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
  const hitSelf = snake.slice(0, -1).some((s) => s.x === head.x && s.y === head.y);
  if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID || hitSelf) { prevSnake = before; endGame(); return; }
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    streak++;
    multi = (elapsed - lastEatTime < MULTI_WINDOW) ? multi + 1 : 1;
    lastEatTime = elapsed;
    const gain = 50 + Math.min(multi, 5) * 10;
    score += gain;
    scoreEl.textContent = score;
    lengthEl.textContent = snake.length;
    if (stepInterval > minInterval) stepInterval = Math.max(minInterval, stepInterval - baseAccel);

    const fx = food.x * CELL + CELL / 2, fy = food.y * CELL + CELL / 2;
    spawnBurst(fx, fy);
    shockwave(fx, fy, CELL * 2.6, 'rgba(255,205,90,0.85)', 0.45);
    spawnPopup(fx, fy - CELL * 0.3, '+' + gain);
    Sfx.eat(multi);

    // ---- Dota 连杀播报：连杀(18s窗口)与连续击杀(不死)是两套独立系统，可同一次触发 ----
    const anns = [];
    if (streak === 1) anns.push({ key: 'firstblood', prio: 100 });
    const st = streakTier(streak); if (st) anns.push(st);   // 连续击杀(状态)——先播
    const mt = multiTier(multi); if (mt) anns.push(mt);     // 多重击杀(动作)——后播
    if (anns.length) {
      for (const a of anns) enqueueAnn(a.key, a.prio);
      const top = anns.reduce((m, a) => (a.prio > m.prio ? a : m));
      const c = CLIPS[top.key];
      banner(c[0].toUpperCase(), c[1], top.key === 'firstblood' ? 'blood' : 'gold', 1.7, 38);
      Sfx.hit(Math.min(multi, 5));
      triggerShake(6 + Math.min(multi, 6), 320);
    }
    placeFood();
  } else {
    snake.pop();
  }
  prevSnake = before;
}

// ============================================================
//  特效
// ============================================================
function triggerShake(amp, dur) { shakeAmp = amp; shakeT = dur; shakeT0 = dur; }
function shockwave(x, y, maxR, color, life = 0.5) { shockwaves.push({ x, y, maxR, color, t: life, max: life }); }
function spawnPopup(x, y, text) { popups.push({ x, y, text, t: 0.9, max: 0.9 }); }
function banner(text, sub, color = 'gold', life = 1.4, size = 36) { banners.push({ text, sub, color, t: life, max: life, size }); }
function spawnBurst(x, y) {
  const colors = ['#ffd45c', '#ffe9a8', '#ffb347', '#fff3c4'];
  for (let i = 0; i < 18; i++) { const a = Math.random() * TAU, sp = 55 + Math.random() * 160, max = 0.45 + Math.random() * 0.45; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: max, max, size: 1.5 + Math.random() * 2.8, color: colors[(Math.random() * colors.length) | 0] }); }
}
function spawnExplosion(pts) {
  const colors = ['#7CFC8A', '#48d690', '#d0ffd8', '#ffd45c', '#ff8a5c'];
  const step = pts.length > 40 ? 2 : 1;
  for (let i = 0; i < pts.length; i += step) { const p = pts[i]; for (let k = 0; k < 3; k++) { const a = Math.random() * TAU, sp = 70 + Math.random() * 210, max = 0.6 + Math.random() * 0.7; particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: max, max, size: 1.8 + Math.random() * 3.2, color: colors[(Math.random() * colors.length) | 0] }); } }
}
function updateParticles(dt) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.t -= dt; if (p.t <= 0) { particles.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.vx *= 0.97; } }
function updatePopups(dt) { for (let i = popups.length - 1; i >= 0; i--) { popups[i].t -= dt; popups[i].y -= 30 * dt; if (popups[i].t <= 0) popups.splice(i, 1); } }
function updateShockwaves(dt) { for (let i = shockwaves.length - 1; i >= 0; i--) { shockwaves[i].t -= dt; if (shockwaves[i].t <= 0) shockwaves.splice(i, 1); } }
function updateBanners(dt) { for (let i = banners.length - 1; i >= 0; i--) { banners[i].t -= dt; if (banners[i].t <= 0) banners.splice(i, 1); } }

// ============================================================
//  绘制
// ============================================================
function rad(x, y, r, c) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, LOGICAL, LOGICAL); }

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, LOGICAL, LOGICAL);
  g.addColorStop(0, '#0b1220'); g.addColorStop(1, '#070a12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, LOGICAL, LOGICAL);
  rad(LOGICAL * 0.18, LOGICAL * 0.14, 200, 'rgba(50,160,100,0.12)');
  rad(LOGICAL * 0.84, LOGICAL * 0.88, 210, 'rgba(170,45,45,0.11)');
  ctx.save();
  ctx.translate(LOGICAL / 2, LOGICAL / 2); ctx.globalAlpha = 0.06; ctx.strokeStyle = '#d8b15a'; ctx.lineWidth = 1.5; ctx.rotate(ringAngle * 0.25);
  ctx.beginPath(); ctx.arc(0, 0, LOGICAL * 0.40, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, LOGICAL * 0.31, 0, TAU); ctx.stroke();
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * LOGICAL * 0.40, Math.sin(a) * LOGICAL * 0.40); ctx.lineTo(Math.cos(a) * LOGICAL * 0.43, Math.sin(a) * LOGICAL * 0.43); ctx.stroke(); }
  ctx.restore();
}
function drawGridPattern() {
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if ((x + y) & 1) { ctx.fillStyle = 'rgba(255,255,255,0.022)'; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
  ctx.strokeStyle = 'rgba(210,180,110,0.06)'; ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, LOGICAL); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(LOGICAL, i * CELL); ctx.stroke(); }
}
function drawShockwaves() {
  for (const s of shockwaves) { const p = 1 - s.t / s.max; ctx.globalAlpha = clamp(s.t / s.max, 0, 1); ctx.strokeStyle = s.color; ctx.lineWidth = (1 - p) * 3.5 + 1; ctx.beginPath(); ctx.arc(s.x, s.y, p * s.maxR, 0, TAU); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
function drawFood() {
  const cx = food.x * CELL + CELL / 2, cy = food.y * CELL + CELL / 2;
  const pulse = 1 + 0.09 * Math.sin(foodPulse / 240);
  const R = CELL * 0.44 * pulse;
  ctx.save(); ctx.translate(cx, cy);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.8); halo.addColorStop(0, 'rgba(255,205,100,0.42)'); halo.addColorStop(1, 'rgba(255,205,100,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, R * 2.8, 0, TAU); ctx.fill();
  ctx.save(); ctx.rotate(-ringAngle * 1.4); ctx.strokeStyle = 'rgba(255,220,140,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, R * 1.5, 0, TAU); ctx.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 1.5, Math.sin(a) * R * 1.5); ctx.lineTo(Math.cos(a) * R * 1.72, Math.sin(a) * R * 1.72); ctx.stroke(); }
  ctx.restore();
  ctx.shadowColor = '#ffcf6b'; ctx.shadowBlur = 16;
  const gem = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R); gem.addColorStop(0, '#fff3c4'); gem.addColorStop(0.5, '#ffd166'); gem.addColorStop(1, '#e0931e');
  ctx.fillStyle = gem; ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2; const x = Math.cos(a) * R, y = Math.sin(a) * R; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); } ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(-R * 0.3, -R * 0.3, R * 0.17, 0, TAU); ctx.fill();
  ctx.restore();
}
function segCenter(i, t) { const p = prevSnake[Math.min(i, prevSnake.length - 1)]; const c = snake[i]; return { x: (p.x + (c.x - p.x) * t) * CELL + CELL / 2, y: (p.y + (c.y - p.y) * t) * CELL + CELL / 2 }; }
function strokePath(pts, width) { ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
function polylineInfo(pts) { const seg = []; let total = 0; for (let i = 0; i < pts.length - 1; i++) { const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push(len); total += len; } return { seg, total }; }
function pointAt(pts, seg, s) { let a = 0; for (let i = 0; i < seg.length; i++) { if (a + seg[i] >= s) { const f = (s - a) / (seg[i] || 1); return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; } a += seg[i]; } return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }; }
function drawEnergyPulses(pts) {
  const { seg, total } = polylineInfo(pts); if (total <= 0) return;
  const spacing = CELL * 2.6, off = (ringAngle * 70) % spacing;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let s = off; s < total; s += spacing) {
    const p = pointAt(pts, seg, s); const fade = 0.6 + 0.4 * Math.sin((s / total) * Math.PI); const r = CELL * 0.18 * fade + CELL * 0.06;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2); g.addColorStop(0, `rgba(255,225,140,${0.8 * fade})`); g.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
function drawHead(p, dead) {
  const r = CELL * 0.48;
  ctx.save(); ctx.shadowColor = dead ? 'rgba(255,80,80,0.7)' : 'rgba(120,255,170,0.7)'; ctx.shadowBlur = 12;
  const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
  if (dead) { g.addColorStop(0, '#ffc0c0'); g.addColorStop(1, '#d05050'); } else { g.addColorStop(0, '#ccffc8'); g.addColorStop(1, '#3fcb82'); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); ctx.restore();
  const px = -direction.y, py = direction.x, fwd = r * 0.32, side = r * 0.4, er = r * 0.23;
  const eyes = [{ x: p.x + direction.x * fwd + px * side, y: p.y + direction.y * fwd + py * side }, { x: p.x + direction.x * fwd - px * side, y: p.y + direction.y * fwd - py * side }];
  for (const e of eyes) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(e.x, e.y, er, 0, TAU); ctx.fill(); ctx.fillStyle = dead ? '#a00' : '#0c2018'; ctx.beginPath(); ctx.arc(e.x + direction.x * er * 0.4, e.y + direction.y * er * 0.4, er * 0.55, 0, TAU); ctx.fill(); }
}
function drawSnake(t, dead) {
  const pts = snake.map((_, i) => segCenter(i, t)); if (pts.length < 2) return;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.save(); ctx.shadowColor = dead ? 'rgba(255,70,70,0.7)' : 'rgba(80,230,170,0.65)'; ctx.shadowBlur = 20; ctx.strokeStyle = dead ? 'rgba(255,80,80,0.18)' : 'rgba(70,220,160,0.2)'; strokePath(pts, CELL * 0.94); ctx.restore();
  const head = pts[0], tail = pts[pts.length - 1];
  const grad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
  if (dead) { grad.addColorStop(0, '#ff9a9a'); grad.addColorStop(1, '#6e2323'); } else { grad.addColorStop(0, '#eaffd0'); grad.addColorStop(0.4, '#5fe39a'); grad.addColorStop(0.75, '#2fb6b0'); grad.addColorStop(1, '#1f6e8c'); }
  ctx.strokeStyle = grad; strokePath(pts, CELL * 0.8);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; strokePath(pts, CELL * 0.3);
  if (!dead) drawEnergyPulses(pts);
  drawHead(head, dead);
}
function drawParticles() { for (const p of particles) { ctx.globalAlpha = clamp(p.t / p.max, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; }
function drawPopups() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 16px "Cinzel", Georgia, serif';
  for (const p of popups) { ctx.globalAlpha = clamp(p.t / p.max, 0, 1); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,30,20,0.7)'; ctx.strokeText(p.text, p.x, p.y); ctx.fillStyle = '#ffd45c'; ctx.fillText(p.text, p.x, p.y); }
  ctx.globalAlpha = 1;
}
function drawBanners() {
  for (const b of banners) {
    const p = 1 - b.t / b.max, inP = clamp(p / 0.16, 0, 1), outA = b.t < 0.4 ? clamp(b.t / 0.4, 0, 1) : 1, scale = 0.55 + easeOutBack(inP) * 0.45;
    ctx.save(); ctx.translate(LOGICAL / 2, LOGICAL * 0.3); ctx.scale(scale, scale); ctx.globalAlpha = outA;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${b.size}px "Cinzel", Georgia, serif`;
    let c1, c2, glow;
    if (b.color === 'dire') { c1 = '#ff6b6b'; c2 = '#c81e1e'; glow = 'rgba(255,80,80,0.7)'; }
    else if (b.color === 'blood') { c1 = '#ff9a3c'; c2 = '#c41212'; glow = 'rgba(255,90,40,0.8)'; }
    else { c1 = '#ffe08a'; c2 = '#e2920f'; glow = 'rgba(255,200,90,0.75)'; }
    const grad = ctx.createLinearGradient(0, -b.size * 0.6, 0, b.size * 0.6); grad.addColorStop(0, c1); grad.addColorStop(1, c2);
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(10,8,4,0.9)'; ctx.strokeText(b.text, 0, 0);
    ctx.shadowColor = glow; ctx.shadowBlur = 24; ctx.fillStyle = grad; ctx.fillText(b.text, 0, 0); ctx.shadowBlur = 0;
    if (b.sub) { ctx.font = '700 17px "Marcellus", Georgia, serif'; ctx.fillStyle = 'rgba(245,235,205,0.92)'; ctx.fillText(b.sub, 0, b.size * 0.72); }
    ctx.restore();
  }
}

function render(dt) {
  foodPulse += dt * 1000; ringAngle += dt;
  if (shakeT > 0) shakeT -= dt * 1000;
  if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
  updateParticles(dt); updatePopups(dt); updateShockwaves(dt); updateBanners(dt);
  const t = clamp(acc / stepInterval, 0, 1);

  drawBackground();
  ctx.save();
  if (shakeT > 0) { const k = shakeAmp * (shakeT / shakeT0); ctx.translate((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k); }
  drawGridPattern(); drawShockwaves(); drawFood();
  if (!(state === 'over' && exploded)) drawSnake(t, state === 'over');
  drawParticles(); drawPopups();
  ctx.restore();
  drawBanners();
  if (flash > 0) { ctx.fillStyle = `rgba(255,50,50,${flash * 0.38})`; ctx.fillRect(0, 0, LOGICAL, LOGICAL); }

  clockEl.textContent = fmtClock(elapsed);
}

// ============================================================
//  主循环
// ============================================================
function loop(time) {
  requestAnimationFrame(loop);
  let delta = time - lastTime; lastTime = time;
  if (!Number.isFinite(delta) || delta > 500) delta = 0;
  if (state === 'running') {
    elapsed += delta; acc += delta; let steps = 0;
    while (acc >= stepInterval && steps < 5) { acc -= stepInterval; update(); steps++; if (state !== 'running') break; }
  }
  render(delta / 1000);
}

// ============================================================
//  输入
// ============================================================
function setDirection(key) {
  if ((key === 'arrowup' || key === 'w') && direction.y === 0) nextDirection = { x: 0, y: -1 };
  else if ((key === 'arrowdown' || key === 's') && direction.y === 0) nextDirection = { x: 0, y: 1 };
  else if ((key === 'arrowleft' || key === 'a') && direction.x === 0) nextDirection = { x: -1, y: 0 };
  else if ((key === 'arrowright' || key === 'd') && direction.x === 0) nextDirection = { x: 1, y: 0 };
}
function dirKey(name) { return name === 'up' ? 'arrowup' : name === 'down' ? 'arrowdown' : name === 'left' ? 'arrowleft' : 'arrowright'; }
function steerStart() { if (state === 'ready') beginRun(); else if (state === 'over') { resetBoard(); beginRun(); } }

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const isDir = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key);
  if (isDir || key === ' ') e.preventDefault();
  Sfx.ensure();
  if (key === 'r') { Sfx.click(); resetBoard(); return; }
  if (key === ' ') { if (state === 'ready') beginRun(); else if (state === 'over') { resetBoard(); beginRun(); } else togglePause(); return; }
  if (!isDir) return;
  steerStart();
  if (state === 'running') setDirection(key);
});

document.querySelectorAll('.pad[data-dir]').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); Sfx.ensure(); steerStart();
    if (state === 'running') setDirection(dirKey(btn.dataset.dir));
    btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 110);
  });
});

difficultyGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.rank'); if (!btn) return;
  Sfx.ensure(); Sfx.click();
  difficultyKey = btn.dataset.diff; localStorage.setItem('snakeDifficulty', difficultyKey);
  resetBoard(); beginRun();
});

pauseBtn.addEventListener('click', () => { Sfx.ensure(); if (state === 'running' || state === 'paused') togglePause(); else if (state === 'over') { resetBoard(); beginRun(); } else if (state === 'ready') beginRun(); });
resumeBtn.addEventListener('click', () => { if (state === 'paused') togglePause(); });
newGameBtn.addEventListener('click', () => { Sfx.ensure(); Sfx.click(); resetBoard(); });
muteBtn.addEventListener('click', () => { const on = Sfx.toggle(); Announcer.setEnabled(on); muteBtn.textContent = on ? '🔊' : '🔇'; if (!on) stopAnnouncements(); else if (state === 'running') Sfx.startAmbient(); });

document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'running') togglePause(); });

let touchStart = null;
canvas.addEventListener('touchstart', (e) => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (!touchStart) return; Sfx.ensure();
  const dx = e.changedTouches[0].clientX - touchStart.x, dy = e.changedTouches[0].clientY - touchStart.y;
  steerStart();
  if (state === 'running' && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
    if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? 'arrowright' : 'arrowleft'); else setDirection(dy > 0 ? 'arrowdown' : 'arrowup');
  }
  touchStart = null;
}, { passive: true });

// ============================================================
//  启动
// ============================================================
function showOverlay() { overlay.classList.remove('hidden'); }
function hideOverlay() { overlay.classList.add('hidden'); }

// ---- 语音选择器 ----
const voiceSelect = document.getElementById('voiceSelect');
function populateVoices() {
  if (!voiceSelect || !('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;
  const en = vs.filter((v) => /^en/i.test(v.lang));
  const list = en.length ? en : vs;
  voiceSelect.innerHTML = '';
  for (const v of list) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = v.name.replace(/\s*\(.*?\)\s*/g, ' ').trim() + ' · ' + v.lang;
    voiceSelect.appendChild(o);
  }
  const cur = Announcer.getVoice();
  if (cur) voiceSelect.value = cur.name;
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { Announcer.refresh(); populateVoices(); };
}
if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    Sfx.ensure();
    Announcer.setVoiceByName(voiceSelect.value);
    Announcer.say('Double Kill'); // 切换后试听
  });
}

initClips();
Announcer.setEnabled(Sfx.isEnabled());
Announcer.refresh();
populateVoices();
setTimeout(populateVoices, 400); // 部分浏览器语音异步加载
muteBtn.textContent = Sfx.isEnabled() ? '🔊' : '🔇';
resetBoard();
lastTime = performance.now();
requestAnimationFrame(loop);
