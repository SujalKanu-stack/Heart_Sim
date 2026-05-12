/**
 * CardioSim – 2.5D Interactive Heart Engine
 * Handles: Mouse Parallax, SVG animation, blood particles, cardiac cycle phases,
 *          valve states, UI controls, sound, simulated ECG, Quiz
 */

'use strict';

/* ──────────────────────────────────────────────
   1. STATE & REFERENCES
────────────────────────────────────────────── */
const state = {
  running: false,
  bpm: 72,
  beatCount: 0,
  phase: 0,           // 0-3 cardiac cycle phases
  phaseTimer: null,
  labelsVisible: true,
  soundEnabled: false,
  audioCtx: null,

  // ECG state
  beatProgress: 0,
  beatStartTime: performance.now(),
  
  // Parallax state
  mouseX: 0.5,
  mouseY: 0.5,
  targetRotX: 0,
  targetRotY: 0,
  currentRotX: 0,
  currentRotY: 0,
  baseScale: 1
};

/* Cardiac cycle phases (ms per phase at 72 BPM = 833ms/beat) */
const PHASES = [
  { name: 'Atrial Diastole',    ratio: 0.25 },
  { name: 'Atrial Systole',     ratio: 0.15 },
  { name: 'Ventricular Systole',ratio: 0.35 },
  { name: 'Ventricular Diastole',ratio: 0.25 },
];

/* DOM References */
const heartSVG       = document.getElementById('heartSVG');
const parallaxContainer = document.getElementById('parallaxContainer');
const particles      = document.getElementById('particles');
const btnPlay        = document.getElementById('btnPlayPause');
const bpmSlider      = document.getElementById('bpmSlider');
const bpmDisplay     = document.getElementById('bpmDisplay');
const toggleLabels   = document.getElementById('toggleLabels');
const toggleSound    = document.getElementById('toggleSound');
const pulseRing      = document.getElementById('pulseRing');
const tooltip        = document.getElementById('tooltip');
const infoPanelContent = document.getElementById('infoPanelContent');
const ecgCanvas      = document.getElementById('ecgCanvas');

/* Stats Elements */
const statPhase    = document.getElementById('statPhase');
const statBeat     = document.getElementById('statBeat');
const statBP       = document.getElementById('statBP');
const cycleSteps   = Array.from(document.querySelectorAll('.cycle-step'));

/* SVG Elements */
const rightAtrium    = document.getElementById('right-atrium');
const leftAtrium     = document.getElementById('left-atrium');
const rightVentricle = document.getElementById('right-ventricle');
const leftVentricle  = document.getElementById('left-ventricle');
const valveTricuspid = document.getElementById('valve-tricuspid');
const valveMitral    = document.getElementById('valve-mitral');
const valvePulmonary = document.getElementById('valve-pulmonary');
const valveAortic    = document.getElementById('valve-aortic');

/* ──────────────────────────────────────────────
   2. INIT & PARALLAX
────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupControls();
  setupClickables();
  setupQuiz();
  updateStats();

  resizeEcg();
  window.addEventListener('resize', resizeEcg);
  
  setupParallax();
  requestAnimationFrame(visualLoop);
});

function setupParallax() {
  parallaxContainer.addEventListener('mousemove', (e) => {
    const rect = parallaxContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Normalize to -1 ... 1
    state.mouseX = (x / rect.width) * 2 - 1;
    state.mouseY = (y / rect.height) * 2 - 1;
    
    // Target rotation (max 20 degrees)
    state.targetRotY = state.mouseX * 25; 
    state.targetRotX = -state.mouseY * 25;
  });
  
  parallaxContainer.addEventListener('mouseleave', () => {
    state.targetRotX = 0;
    state.targetRotY = 0;
  });
}

function visualLoop() {
  requestAnimationFrame(visualLoop);
  
  // 1. Smooth Parallax Rotation
  state.currentRotX += (state.targetRotX - state.currentRotX) * 0.1;
  state.currentRotY += (state.targetRotY - state.currentRotY) * 0.1;

  // 2. Heartbeat Scale
  let scale = 1.0;
  if (state.running) {
    const now = performance.now();
    const beatDuration = (60 / state.bpm) * 1000;
    const elapsed = now - state.beatStartTime;
    state.beatProgress = (elapsed % beatDuration) / beatDuration;
    
    if (state.beatProgress > 0 && state.beatProgress < 0.15) {
      scale = 1.0 - Math.sin((state.beatProgress / 0.15) * Math.PI) * 0.02; // Atria
    } else if (state.beatProgress >= 0.15 && state.beatProgress < 0.50) {
      const vProg = (state.beatProgress - 0.15) / 0.35;
      scale = 1.0 - Math.sin(vProg * Math.PI) * 0.08; // Ventricles
    }
  }

  // Smooth out scale
  state.baseScale += (scale - state.baseScale) * 0.3;

  // Apply to SVG
  heartSVG.style.transform = `rotateX(${state.currentRotX}deg) rotateY(${state.currentRotY}deg) scale(${state.baseScale})`;

  // 3. Draw ECG if running
  if(state.running) drawECGSegment();
}

/* ──────────────────────────────────────────────
   3. SIMULATION CONTROLS
────────────────────────────────────────────── */
function setupControls() {
  btnPlay.addEventListener('click', () => {
    state.running ? stopSimulation() : startSimulation();
  });

  bpmSlider.addEventListener('input', () => {
    state.bpm = parseInt(bpmSlider.value);
    bpmDisplay.textContent = `${state.bpm} BPM`;
    updateStats();
  });

  toggleSound.addEventListener('change', () => {
    state.soundEnabled = toggleSound.checked;
    if (state.soundEnabled && !state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  });

  // Since we removed the labels group check from index.html in the new SVG layout,
  // we'll safely query dynamic labels to toggle them.
  toggleLabels.addEventListener('change', () => {
    state.labelsVisible = toggleLabels.checked;
    const allLabels = document.querySelectorAll('.vessel-label, .chamber-label');
    allLabels.forEach(l => l.style.opacity = state.labelsVisible ? '1' : '0');
  });
}

function startSimulation() {
  state.running = true;
  state.beatStartTime = performance.now();
  btnPlay.innerHTML = '<span class="btn-icon">⏸</span> Pause';
  btnPlay.classList.add('paused');
  runPhase(0);
}

function stopSimulation() {
  state.running = false;
  clearTimeout(state.phaseTimer);
  btnPlay.innerHTML = '<span class="btn-icon">▶</span> Start';
  btnPlay.classList.remove('paused');
  statPhase.textContent = '—';
}

function runPhase(phaseIndex) {
  if (!state.running) return;

  state.phase = phaseIndex;
  const beatMs = (60 / state.bpm) * 1000;
  const duration = beatMs * PHASES[phaseIndex].ratio;

  highlightCycleStep(phaseIndex);
  applyPhaseVisuals(phaseIndex);

  if (phaseIndex === 0) {
    state.beatCount++;
    statBeat.textContent = state.beatCount;
    state.beatStartTime = performance.now();
    
    triggerPulseRing();
    if (state.soundEnabled) playLubDub();
    spawnParticleWave('deoxy', 'ra-rv');
    spawnParticleWave('oxy', 'lung-la');

    // Slight BP shift
    const sys = 118 + Math.floor(Math.random() * 5);
    const dia = 78 + Math.floor(Math.random() * 4);
    statBP.innerHTML = `${sys}/${dia} <small>mmHg</small>`;
  }
  
  if (phaseIndex === 2) {
    spawnParticleWave('deoxy', 'rv-lung');
    spawnParticleWave('oxy', 'lv-body');
  }

  statPhase.textContent = PHASES[phaseIndex].name;

  state.phaseTimer = setTimeout(() => {
    const next = (phaseIndex + 1) % 4;
    runPhase(next);
  }, duration);
}

/* ──────────────────────────────────────────────
   4. PHASE VISUALS (Chambers + Valves)
────────────────────────────────────────────── */
function applyPhaseVisuals(phase) {
  // Clear valves
  [valveTricuspid, valveMitral, valvePulmonary, valveAortic].forEach(v => {
    v.style.fill = '#f0c060'; v.style.stroke = '#c08020';
  });

  const openValve = (v) => { v.style.fill = '#60ff90'; v.style.stroke = '#20c040'; };
  const closeValve = (v) => { v.style.fill = '#ff6040'; v.style.stroke = '#c02010'; };

  switch (phase) {
    case 0: // Atrial Diastole
      [valveTricuspid, valveMitral].forEach(openValve);
      [valvePulmonary, valveAortic].forEach(closeValve);
      break;

    case 1: // Atrial Systole
      contractChamber(rightAtrium);
      contractChamber(leftAtrium);
      [valveTricuspid, valveMitral].forEach(openValve);
      [valvePulmonary, valveAortic].forEach(closeValve);
      break;

    case 2: // Ventricular Systole
      contractChamber(rightVentricle);
      contractChamber(leftVentricle);
      [valveTricuspid, valveMitral].forEach(closeValve);
      [valvePulmonary, valveAortic].forEach(openValve);
      break;

    case 3: // Ventricular Diastole
      [valvePulmonary, valveAortic].forEach(closeValve);
      break;
  }
}

function contractChamber(el) {
  // Simple CSS filter and scale for chambers
  el.style.transformOrigin = 'center';
  el.style.filter = 'brightness(1.5)';
  setTimeout(() => { el.style.filter = ''; }, 200);
}

/* ──────────────────────────────────────────────
   5. BLOOD PARTICLES
────────────────────────────────────────────── */
const FLOW_PATHS = {
  'ra-rv':   [{ x:355, y:240 }, { x:355, y:260 }, { x:352, y:310 }, { x:350, y:360 }],
  'rv-lung': [{ x:350, y:360 }, { x:310, y:300 }, { x:260, y:220 }, { x:220, y:165 }, { x:160, y:120 }, { x:110, y:100 }],
  'lung-la': [{ x:110, y:120 }, { x:140, y:140 }, { x:180, y:160 }, { x:215, y:190 }],
  'la-lv':   [{ x:235, y:240 }, { x:235, y:260 }, { x:238, y:310 }, { x:240, y:360 }],
  'lv-body': [{ x:240, y:360 }, { x:255, y:270 }, { x:255, y:190 }, { x:258, y:130 }, { x:262, y:80 }, { x:300, y:38 }],
};

function spawnParticleWave(type, pathKey) {
  const path = FLOW_PATHS[pathKey];
  if (!path) return;
  for (let i = 0; i < 4; i++) {
    setTimeout(() => { if (state.running) spawnParticle(type, path); }, i * 60);
  }
}

function spawnParticle(type, waypoints) {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('r', '6');
  circle.setAttribute('cx', waypoints[0].x);
  circle.setAttribute('cy', waypoints[0].y);
  circle.setAttribute('fill', type === 'oxy' ? '#ff3366' : '#3388ff');
  circle.style.filter = 'drop-shadow(0 0 4px rgba(255,255,255,0.8))';
  particles.appendChild(circle);

  const totalDuration = 800; 
  const stepDuration = totalDuration / (waypoints.length - 1);
  let step = 0;

  function nextStep() {
    if (step >= waypoints.length - 1) { circle.remove(); return; }
    const from = waypoints[step];
    const to   = waypoints[step + 1];
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / stepDuration, 1);
      const eased = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
      circle.setAttribute('cx', from.x + (to.x - from.x) * eased);
      circle.setAttribute('cy', from.y + (to.y - from.y) * eased);
      
      if (progress < 1) requestAnimationFrame(tick);
      else { step++; nextStep(); }
    }
    requestAnimationFrame(tick);
  }
  nextStep();
}

function triggerPulseRing() {
  pulseRing.classList.remove('beat');
  void pulseRing.offsetWidth;
  pulseRing.classList.add('beat');
}

/* ──────────────────────────────────────────────
   6. ECG CANVAS
────────────────────────────────────────────── */
const ecgCtx = ecgCanvas.getContext('2d');
let ecgX = 0;
let ecgLastY = 0;

function resizeEcg() {
  ecgCanvas.width = ecgCanvas.clientWidth;
  ecgCanvas.height = ecgCanvas.clientHeight;
  ecgLastY = ecgCanvas.height / 2;
}

function drawECGSegment() {
  const h = ecgCanvas.height;
  const w = ecgCanvas.width;
  const midY = h / 2;
  
  let y = midY;
  const p = state.beatProgress;
  
  if (p > 0.05 && p < 0.12) {
    y = midY - Math.sin((p - 0.05) / 0.07 * Math.PI) * (h * 0.1);
  } else if (p > 0.14 && p < 0.16) {
    y = midY + Math.sin((p - 0.14) / 0.02 * Math.PI) * (h * 0.1);
  } else if (p >= 0.16 && p < 0.19) {
    y = midY - Math.sin((p - 0.16) / 0.03 * Math.PI) * (h * 0.45);
  } else if (p >= 0.19 && p < 0.22) {
    y = midY + Math.sin((p - 0.19) / 0.03 * Math.PI) * (h * 0.15);
  } else if (p > 0.35 && p < 0.50) {
    y = midY - Math.sin((p - 0.35) / 0.15 * Math.PI) * (h * 0.15);
  }
  
  y += (Math.random() - 0.5) * 2;

  ecgCtx.beginPath();
  ecgCtx.strokeStyle = '#3ddc84';
  ecgCtx.lineWidth = 2;
  ecgCtx.moveTo(ecgX, ecgLastY);
  
  ecgX += 2.5; 
  
  ecgCtx.lineTo(ecgX, y);
  ecgCtx.stroke();
  ecgCtx.clearRect(ecgX, 0, 10, h);

  if (ecgX >= w) {
    ecgX = 0;
    ecgLastY = y;
    ecgCtx.clearRect(0, 0, w, h);
  } else {
    ecgLastY = y;
  }
}

/* ──────────────────────────────────────────────
   7. SOUND & STATS
────────────────────────────────────────────── */
function playLubDub() {
  if (!state.audioCtx) return;
  playThud(state.audioCtx, 0, 80, 0.6);
  playThud(state.audioCtx, 0.22, 100, 0.4);
}

function playThud(ctx, delayS, freq, gain) {
  const osc  = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const when = ctx.currentTime + delayS;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(30, when + 0.12);
  gainNode.gain.setValueAtTime(gain, when);
  gainNode.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.2);
}

function updateStats() {
  statPhase.textContent = state.running ? (PHASES[state.phase]?.name || '—') : '—';
}

function highlightCycleStep(phaseIndex) {
  cycleSteps.forEach((el, i) => el.classList.toggle('active', i === phaseIndex));
}

/* ──────────────────────────────────────────────
   8. CLICKABLES & UI TABS
────────────────────────────────────────────── */
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function setupClickables() {
  document.querySelectorAll('.clickable').forEach(el => {
    el.addEventListener('click', (e) => {
      const label = el.dataset.label;
      const info  = el.dataset.info;
      if (!label) return;
      infoPanelContent.innerHTML = `<div class="info-card"><h3>${label}</h3><p>${info}</p></div>`;
    });

    el.addEventListener('mouseenter', (e) => {
      const label = el.dataset.label;
      const info  = el.dataset.info;
      if (!label) return;
      tooltip.innerHTML = `<strong>${label}</strong>${info}`;
      tooltip.classList.remove('hidden');
      positionTooltip(e);
    });
    el.addEventListener('mousemove', positionTooltip);
    el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  });
}

function positionTooltip(e) {
  let x = e.clientX + 16, y = e.clientY + 16;
  tooltip.style.left = `${x}px`;
  tooltip.style.top  = `${y}px`;
}

/* ──────────────────────────────────────────────
   9. QUIZ
────────────────────────────────────────────── */
const QUIZ_DATA = [
  { q: 'Which chamber pumps oxygenated blood to the entire body?', options: ['Right Atrium', 'Left Ventricle', 'Right Ventricle'], answer: 1, explanation: 'The left ventricle.' },
  { q: 'What color represents deoxygenated blood?', options: ['Red', 'Purple', 'Blue'], answer: 2, explanation: 'Blue.' }
];

function setupQuiz() {
  const container = document.getElementById('quizContainer');
  if(!container) return;
  container.innerHTML = '';
  QUIZ_DATA.forEach((item, qi) => {
    const div = document.createElement('div');
    div.className = 'quiz-question';
    div.innerHTML = `<p><strong>Q${qi + 1}.</strong> ${item.q}</p><div class="quiz-options">${item.options.map((opt, oi) => `<button class="quiz-option" data-qi="${qi}" data-oi="${oi}">${opt}</button>`).join('')}</div><div class="quiz-feedback" id="feedback-${qi}"></div>`;
    container.appendChild(div);
  });
  const btn = document.createElement('button');
  btn.className = 'btn-primary'; btn.textContent = 'Submit Answers'; btn.id = 'submitQuiz';
  container.appendChild(btn);

  const selected = {};
  container.querySelectorAll('.quiz-option').forEach(btn => btn.addEventListener('click', () => {
    container.querySelectorAll(`[data-qi="${btn.dataset.qi}"]`).forEach(b => { b.style.outline = ''; b.style.color = ''; });
    selected[btn.dataset.qi] = parseInt(btn.dataset.oi);
    btn.style.outline = '2px solid var(--gold)'; btn.style.color = 'var(--gold)';
  }));

  btn.addEventListener('click', () => {
    let score = 0;
    QUIZ_DATA.forEach((item, qi) => {
      const ans = selected[qi];
      const fb = document.getElementById(`feedback-${qi}`);
      if (ans === item.answer) { score++; fb.textContent = 'Correct!'; fb.className='quiz-feedback correct-fb'; }
      else { fb.textContent = 'Incorrect.'; fb.className='quiz-feedback wrong-fb'; }
    });
    document.getElementById('resultScore').textContent = `${score} / ${QUIZ_DATA.length}`;
    document.getElementById('quizResult').classList.remove('hidden');
    btn.remove();
  });
}
