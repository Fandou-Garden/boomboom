import { CONTROLS, PHYSICS, COMBAT, WORLD, SOURCE_COMMIT, SOURCE_REPO, AI, BATTLE, TERRAIN, VIEW } from './config.js?v=13';
import { loadImage, Terrain } from './terrain.js?v=13';
import { RemoteMatch } from './net-client.js?v=13';
import { Renderer } from './renderer.js?v=13';
import { Camera, projectPoint } from './camera.js?v=13';
import { InputController } from './input.js?v=13';
import { solvePerfect } from './ai.js?v=13';
import { muzzlePoint, simulateShot, segmentTerrainHit } from './physics.js?v=13';

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  canvas: $('scene'),
  topbar: $('topbar'),
  controls: $('controls'),
  hp0: $('hp0'), hp1: $('hp1'), hpBar0: $('hpBar0'), hpBar1: $('hpBar1'),
  playerCard: document.querySelector('.player-card'), enemyCard: document.querySelector('.enemy-card'),
  round: $('round'), turn: $('turn'), countdown: $('countdown'),
  windArrow: $('windArrow'), windValue: $('windValue'), windDir: $('windDir'), windBars: $('windBars'),
  minimap: $('minimap'), minimapWrap: $('minimapWrap'), minimapDistance: $('minimapDistance'),
  recenter: $('recenter'), elevationNote: $('elevationNote'), lastShot: $('lastShot'),
  angle: $('angle'), angleNote: $('angleNote'),
  forcePct: $('forcePct'), forceRaw: $('forceRaw'), chargeTrack: $('chargeTrack'),
  chargeFill: $('chargeFill'), chargeThumb: $('chargeThumb'), powerText: $('powerText'),
  aimStatus: $('aimStatus'), recommendMarker: $('recommendMarker'), lastPowerMarker: $('lastPowerMarker'),
  recommendBand: $('recommendBand'), recommendText: $('recommendText'), lastPowerText: $('lastPowerText'),
  fire: $('fire'), fireLabel: $('fireLabel'),
  statHp: $('statHp'), statStamina: $('statStamina'), statEnergy: $('statEnergy'), statWeapon: $('statWeapon'),
  heal: $('heal'), healCount: $('healCount'),
  weaponButton: $('weaponButton'), weaponPicker: $('weaponPicker'), weaponGrid: $('weaponGrid'),
  weaponConfirm: $('weaponConfirm'), weaponSource: $('weaponSource'),
  skillExtra2: $('skillExtra2'), skillScatter: $('skillScatter'), skillExtra1: $('skillExtra1'),
  skillBoost50: $('skillBoost50'), skillBoost40: $('skillBoost40'), skillBoost30: $('skillBoost30'),
  skillBoost20: $('skillBoost20'), skillBoost10: $('skillBoost10'),
  pow: $('pow'), powPct: $('powPct'),
  left: $('left'), right: $('right'), up: $('up'), down: $('down'),
  sound: $('sound'), timerToggle: $('timerToggle'), help: $('help'), fullscreen: $('fullscreen'), restart: $('restart'),
  modal: $('modal'), modalTitle: $('modalTitle'), modalBody: $('modalBody'), modalAction: $('modalAction'), modalClose: $('modalClose'),
  toast: $('toast'), turnFlash: $('turnFlash'), loading: $('loading'), fatal: $('fatal'), fatalText: $('fatalText'),
  rotateNotice: $('rotateNotice'), rotateFull: $('rotateFull'), rotateDismiss: $('rotateDismiss'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const isTest = params.get('test') === '1';
// Fixed slots in reading order. Empty slots 5–8 are intentionally no-ops;
// spending a skill never reorders this table.
const SKILL_SLOTS = ['extra2', 'scatter', 'extra1', 'boost50', 'boost40', 'boost30', 'boost20', 'boost10'];

let terrain = null;
let renderer = null;
let camera = null;
let game = null;
let input = null;
let minimapBase = null;
let layout = { width: 1, height: 1, topInset: 0, bottomInset: 0, dpr: 1 };
let view = null;
let lastFrame = performance.now();
let minimapAccum = 0;
let paused = true;
let modalMode = 'help';
let toastTimer = 0;
let flashTimer = 0;
let resultTimer = 0;
let lastTurnKey = '';
let portraitDismissed = false;
let booted = false;
let minimapDrag = null;
let lastRecommendationAt = 0;
let lastRecommendation = null;
let lastRecommendationMode = '';
let selectedWeaponId = 'fruit';
let weaponPickerBuilt = false;

const uiCache = {
  phase: '', angle: null, forcePct: null, wind: null, hp: [null, null], distance: null,
  elevation: null, note: '', disabled: null, charging: null, round: null, turn: '',
  fireLabel: '', countdown: null, lastPower: undefined, recommendKey: '',
  selectedSkill: undefined, skillUses: '', powSelected: null, powPct: null,
  stamina: null, energy: null, healDisabled: null, healCount: null, manualPan: null,
  weapon: null, weaponLocked: null,
};

class SoundEngine {
  constructor() {
    this.enabled = false;
    this.userMuted = false;
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.events = [];
    this.peak = 0;
    this.buffers = new Map();
    this.sampleLoading = null;
    this.sampleError = '';
    // Original IDs extracted from flash/audio.swf; see docs/AUDIO_MAPPING.md.
    // Fire/explosion are per weapon: BallList.xml ShootSound/BombSound of the
    // Common ball referenced by BombConfig.xml.
    this.sampleMap = {
      select: '008',
      'skill-select': '008',
      'pow-select': '008',
      heal: '039',
      pow: '039',
      death: '042',
      'turn-self': '016',
      'turn-enemy': '038',
      win: '063',
      lose: '064',
    };
    this.fireSamples = {
      fire: '025', cannon: '023', fruit: '114', appliance: '110', wind: '029',
    };
    this.boomSamples = {
      fire: '087', cannon: '087', fruit: '102', appliance: '100', wind: '089',
    };
    this.sampleFiles = {
      '008': 'assets/audio/sound-008-ui.mp3',
      '016': 'assets/audio/sound-016-turn-self.mp3',
      '023': 'assets/audio/sound-023-fire-cannon.mp3',
      '025': 'assets/audio/sound-025-fire-flame.mp3',
      '029': 'assets/audio/sound-029-fire-wind.mp3',
      '038': 'assets/audio/sound-038-turn-enemy.mp3',
      '039': 'assets/audio/sound-039-item.mp3',
      '042': 'assets/audio/sound-042-death.mp3',
      '063': 'assets/audio/sound-063-win.mp3',
      '064': 'assets/audio/sound-064-lose.mp3',
      '087': 'assets/audio/sound-087-boom-flame.mp3',
      '089': 'assets/audio/sound-089-boom-wind.mp3',
      '100': 'assets/audio/sound-100-boom-appliance.mp3',
      '102': 'assets/audio/sound-102-boom-fruit.mp3',
      '110': 'assets/audio/sound-110-fire-appliance.mp3',
      '114': 'assets/audio/sound-114-fire-fruit.mp3',
    };
  }

  _ensureGraph() {
    if (!this.ctx) return false;
    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    return true;
  }

  /** Called from a real pointer/key event. Failure never blocks gameplay. */
  async unlock() {
    if (this.userMuted) return false;
    if (this.enabled && this.ctx) {
      this.loadSamples();
      return true;
    }
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      this._ensureGraph();
      // Enable before awaiting resume so the same gesture's select/fire event
      // is not lost; the graph starts as soon as the context is running.
      this.enabled = true;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.loadSamples();
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  /** Fetch/decode originals early. This never enables playback or starts audio. */
  async preload() {
    if (this.sampleLoading) return this.sampleLoading;
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      this._ensureGraph();
      return await this.loadSamples();
    } catch {
      return 0;
    }
  }

  loadSamples() {
    if (this.sampleLoading || !this.ctx) return this.sampleLoading;
    this.sampleError = '';
    this.sampleLoading = Promise.all(Object.entries(this.sampleFiles).map(async ([id, url]) => {
      try {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const buffer = await new Promise((resolve, reject) => {
          this.ctx.decodeAudioData(data, resolve, reject);
        });
        this.buffers.set(id, buffer);
      } catch (error) {
        this.sampleError = `${id}: ${error?.message || error}`;
      }
    })).then(() => this.buffers.size);
    return this.sampleLoading;
  }

  async ready() {
    if (!this.sampleLoading) await this.unlock();
    return this.sampleLoading ? this.sampleLoading : 0;
  }

  async setEnabled(enabled) {
    this.userMuted = !enabled;
    if (!enabled) {
      this.enabled = false;
      return false;
    }
    return this.unlock();
  }

  tone(frequency, duration, type = 'sine', volume = 0.045, endFrequency = null, delay = 0) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  noise(duration = 0.25, volume = 0.06, cutoff = 900, delay = 0) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const sampleCount = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime + delay;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
  }

  _playBuffer(buffer, name) {
    if (!buffer || !this.ctx || !this.master) return false;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    const volumes = {
      fire: 0.95, explosion: 1, heal: 0.7, pow: 0.8, death: 0.9,
      select: 0.55, 'skill-select': 0.55, 'pow-select': 0.55,
      'turn-self': 0.62, 'turn-enemy': 0.5, win: 0.7, lose: 0.7,
    };
    source.buffer = buffer;
    gain.gain.value = volumes[name] ?? 0.8;
    source.connect(gain).connect(this.master);
    source.start();
    return true;
  }

  _playSynth(name) {
    if (name === 'fire') {
      this.tone(210, 0.2, 'sawtooth', 0.07, 54);
      this.noise(0.16, 0.05, 1800);
    } else if (name === 'explosion') {
      this.noise(0.68, 0.22, 620);
      this.tone(78, 0.55, 'sine', 0.18, 28);
      this.tone(52, 0.42, 'triangle', 0.12, 24, 0.03);
    } else if (name === 'hit') {
      this.noise(0.12, 0.1, 2600);
      this.tone(520, 0.15, 'square', 0.055, 220);
      this.tone(820, 0.09, 'sine', 0.04, 340, 0.02);
    } else if (name === 'pow') {
      this.tone(180, 0.45, 'sawtooth', 0.075, 760);
      this.tone(360, 0.38, 'triangle', 0.055, 980, 0.08);
      this.tone(720, 0.32, 'sine', 0.04, 1300, 0.13);
      this.noise(0.34, 0.05, 2400, 0.05);
    } else if (name === 'death') {
      this.tone(330, 0.42, 'triangle', 0.06, 90);
      this.noise(0.28, 0.05, 1400);
    } else if (name === 'out') {
      this.tone(180, 0.2, 'triangle', 0.03, 90);
    } else if (name === 'turn') {
      this.tone(520, 0.08, 'sine', 0.035);
      this.tone(720, 0.1, 'sine', 0.028, null, 0.07);
    } else if (name === 'heal') {
      this.tone(440, 0.16, 'sine', 0.04, 660);
      this.tone(660, 0.18, 'sine', 0.03, 880, 0.09);
    } else if (name === 'land') {
      this.noise(0.16, 0.045, 360);
      this.tone(110, 0.12, 'sine', 0.035, 60);
    } else if (name === 'select' || name === 'skill-select' || name === 'pow-select') {
      this.tone(760, 0.05, 'sine', 0.025);
    }
  }

  _measure(name, sampleId = null) {
    const event = { name, sample: sampleId, at: performance.now(), peak: 0 };
    this.events.push(event);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    if (!this.analyser) return;
    const samples = new Float32Array(this.analyser.fftSize);
    const started = performance.now();
    const read = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
      event.peak = Math.max(event.peak, peak);
      this.peak = Math.max(this.peak, peak);
      if (performance.now() - started < 260) window.setTimeout(read, 16);
    };
    window.setTimeout(read, 0);
  }

  play(name, weapon = null) {
    if (!this.enabled) return;
    let id = this.sampleMap[name];
    if (name === 'fire') id = this.fireSamples[weapon] || id;
    else if (name === 'explosion') id = this.boomSamples[weapon] || id;
    const buffer = id ? this.buffers.get(id) : null;
    this._measure(name, buffer ? id : null);
    if (buffer && this._playBuffer(buffer, name)) return;
    this._playSynth(name);
  }

  debug() {
    return {
      enabled: this.enabled,
      userMuted: this.userMuted,
      state: this.ctx?.state ?? 'none',
      samples: [...this.buffers.keys()],
      sampleError: this.sampleError,
      events: this.events.map((event) => ({ ...event })),
      peak: this.peak,
    };
  }

  resetMeter() {
    this.events.length = 0;
    this.peak = 0;
  }
}

const sound = new SoundEngine();
// Decode source clips before the first gesture so the first select/fire can
// already use the original sample. The context stays suspended until unlock().
sound.preload();

function setViewportVariables() {
  const vv = window.visualViewport;
  const width = Math.max(1, vv?.width || window.innerWidth);
  const height = Math.max(1, vv?.height || window.innerHeight);
  const top = vv?.offsetTop || 0;
  const left = vv?.offsetLeft || 0;
  document.documentElement.style.setProperty('--app-width', `${width}px`);
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  document.documentElement.style.setProperty('--vv-offset-top', `${top}px`);
  document.documentElement.style.setProperty('--vv-offset-left', `${left}px`);
  els.app.style.width = `${width}px`;
  els.app.style.height = `${height}px`;
  els.app.classList.toggle('app-compact', width <= 700);
  els.app.classList.toggle('app-tiny', width <= 560);
  els.app.classList.toggle('app-mini', width <= 435);
}

function measureLayout() {
  if (!booted) return;
  const appRect = els.app.getBoundingClientRect();
  const width = Math.max(1, appRect.width);
  const height = Math.max(1, appRect.height);
  // Phones/tablets cap the backing store at 1.5×: the world already uses
  // chunk canvases, and 3× DPR fill-rate is the main mobile frame cost.
  const dprCap = game?.lowPower ? 1.5 : 2;
  const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
  layout = { width, height, dpr, topInset: 0, bottomInset: 0 };
  renderer?.resize(width, height, dpr);
  lastFrame = performance.now();
}

let layoutRaf = 0;
function scheduleLayout() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    setViewportVariables();
    measureLayout();
  });
}

function applyPlayerControls(dt) {
  if (!game || paused) return;
  if (game.phase !== 'player' || game.charging) {
    if (game.phase !== 'player') game.player.walkDirection = 0;
    return;
  }
  const direction = input?.getMoveDirection() || 0;
  if (direction) game.movePlayer(direction, dt);
  else game.stopMoving();
  const aim = input?.getAimDirection() || 0;
  if (aim) game.setAngle(aim * CONTROLS.angleSpeed * dt);
}

function effectiveCameraMode() {
  if (!game) return 'both';
  if (game.phase === 'flight' && game.shot) return 'shot';
  return 'both';
}

function frame(now) {
  if (!booted) return;
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  paused = !els.modal.hidden || !els.rotateNotice.hidden || !els.weaponPicker.hidden;

  if (!paused) {
    applyPlayerControls(dt);
    game.update(dt);
  }

  const cameraShot = game.shot
    ? { ...game.shot, x: game.shot.renderX ?? game.shot.x, y: game.shot.renderY ?? game.shot.y }
    : null;
  view = camera.update({
    width: layout.width,
    height: layout.height,
    mode: effectiveCameraMode(),
    shot: cameraShot,
    actors: game.actors,
    activeIndex: game.turn,
    focusPoint: game.phase === 'resolve' && game.lastImpact ? game.lastImpact : null,
    dt,
    reducedMotion,
  });
  renderer.draw(game, view, reducedMotion);
  // The minimap redraws cached layers plus several shadowBlur strokes; at
  // 120 Hz that is wasted work on a tiny widget. Cap it at ~30 Hz while the
  // main canvas keeps the full refresh rate.
  minimapAccum += dt;
  if (minimapAccum >= 1 / 30) {
    minimapAccum = 0;
    drawMinimap();
  }
  syncUI();
  requestAnimationFrame(frame);
}

function setText(el, text) {
  if (el && el.textContent !== String(text)) el.textContent = String(text);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function setHpNumber(el, hp, maxHp, label) {
  if (!el) return;
  setText(el, Math.round(hp));
  el.setAttribute('aria-label', `${label} ${Math.round(hp)} / ${maxHp}`);
}

function phaseLabel() {
  if (!game) return '装载中';
  if (game.phase === 'player') return game.charging ? '蓄力锁定' : '你的回合';
  if (game.phase === 'heal') return '治疗中';
  if (game.phase === 'enemy_move') return '电脑移动中';
  if (game.phase === 'enemy_think') return '电脑测算中';
  if (game.phase === 'enemy_aim') return '电脑瞄准中';
  if (game.phase === 'flight') {
    const total = game.shots?.length || 1;
    const alive = game.shots?.filter((shot) => shot.alive).length || 1;
    return total > 1 ? `弹道飞行 ${alive}/${total}` : (game.shot?.owner === 0 ? '弹道飞行中' : '炮弹来袭');
  }
  if (game.phase === 'resolve') return '落点结算';
  if (game.phase === 'over') return game.winner === 0 ? '蓝波胜利' : '芽芽胜利';
  return '准备中';
}

function angleNoteText() {
  if (!game) return '';
  const direction = Math.sign(game.enemy.x - game.player.x) || 1;
  return direction > 0 ? '朝右上' : '朝左上';
}

function updateSkillButtons(phase) {
  const buffs = Array.isArray(game.selectedBuffs) ? game.selectedBuffs : [];
  for (const id of SKILL_SLOTS) {
    const button = document.querySelector(`.skill-button[data-skill="${id}"]`);
    if (!button) continue;
    const uses = Math.max(0, game.skillUses?.[id] ?? 0);
    const selected = game.selectedSkill === id || buffs.includes(id);
    button.disabled = phase !== 'player' || game.charging || uses <= 0;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function syncUI() {
  if (!game) return;
  const p = game.player;
  const e = game.enemy;
  const phase = game.phase;
  const wind = game.wind.value;
  const pct = Math.round(game.force / PHYSICS.forceMax * 100);
  const hp = [p.hp, e.hp];
  const now = performance.now();

  if (uiCache.hp[0] !== p.hp) {
    els.hpBar0.style.width = `${Math.max(0, p.hp / p.maxHp * 100)}%`;
    setHpNumber(els.hp0, p.hp, p.maxHp, '蓝波');
    if (uiCache.hp[0] != null) flashCard(els.playerCard);
    uiCache.hp[0] = p.hp;
  }
  if (uiCache.hp[1] !== e.hp) {
    els.hpBar1.style.width = `${Math.max(0, e.hp / e.maxHp * 100)}%`;
    setHpNumber(els.hp1, e.hp, e.maxHp, '芽芽');
    if (uiCache.hp[1] != null) flashCard(els.enemyCard);
    uiCache.hp[1] = e.hp;
  }

  if (uiCache.angle !== Math.round(game.angle)) {
    uiCache.angle = Math.round(game.angle);
    setText(els.angle, uiCache.angle);
  }
  const note = angleNoteText();
  if (uiCache.note !== note) {
    uiCache.note = note;
    setText(els.angleNote, note);
  }

  if (uiCache.phase !== phase || uiCache.charging !== game.charging) {
    uiCache.phase = phase;
    uiCache.charging = game.charging;
    els.fire.classList.toggle('is-charging', game.charging);
    const disabledHold = phase !== 'player' || game.charging;
    for (const button of [els.left, els.right, els.up, els.down]) button.disabled = disabledHold;
    els.fire.disabled = phase !== 'player';
    els.turn.classList.toggle('enemy-turn', phase.startsWith('enemy') || (phase === 'flight' && game.shot?.owner === 1));
    els.fire.setAttribute('aria-label', phase === 'player' ? '按住蓄力，松手发射' : '等待轮到你行动');
    els.heal.classList.toggle('is-healing', phase === 'heal');
  }

  const buttonFace = game.charging ? `${pct}%` : '发射';
  if (uiCache.fireLabel !== buttonFace) {
    uiCache.fireLabel = buttonFace;
    els.fireLabel.innerHTML = buttonFace;
  }
  if (uiCache.round !== game.round) {
    uiCache.round = game.round;
    setText(els.round, `回合 ${String(game.round).padStart(2, '0')}`);
  }
  const turnText = phaseLabel();
  if (uiCache.turn !== turnText) {
    uiCache.turn = turnText;
    setText(els.turn, turnText);
  }
  if (uiCache.forcePct !== pct) {
    uiCache.forcePct = pct;
    setText(els.forcePct, pct);
    els.fire.style.setProperty('--charge', `${pct}%`);
    els.chargeFill.style.width = `${pct}%`;
    els.chargeTrack.style.setProperty('--charge', `${pct}%`);
    els.chargeTrack.setAttribute('aria-valuenow', String(pct));
  }
  const roundedForce = Math.round(game.force);
  setText(els.forceRaw, `力度 ${roundedForce} / ${PHYSICS.forceMax}`);

  // Recommendation is recomputed only while both movement and angle input
  // are stationary. Real projectile simulation is not run every animation
  // frame. During charging the angle is locked, so the cache stays valid.
  const angleHeld = input?.getAimDirection?.() ?? 0;
  let recommendation = null;
  if (phase === 'player' && !p.walkDirection && !angleHeld) {
    const modeKey = `${game.angle.toFixed(2)}|${wind.toFixed(2)}|${p.x.toFixed(1)}|${p.y.toFixed(1)}|${e.x.toFixed(1)}|${e.y.toFixed(1)}|${game.terrain?.craters?.length ?? 0}|${game.selectedSkill || '-'}|${game.powSelected ? 'pow' : '-'}`;
    if (lastRecommendationMode !== modeKey || now - lastRecommendationAt > 170) {
      recommendation = game.recommendation();
      lastRecommendation = recommendation;
      lastRecommendationMode = modeKey;
      lastRecommendationAt = now;
    } else {
      recommendation = lastRecommendation;
    }
  } else {
    lastRecommendation = null;
    lastRecommendationMode = '';
  }

  const lastPct = game.lastPower != null ? Math.round(game.lastPower / PHYSICS.forceMax * 100) : null;
  const recPct = recommendation?.reachable ? recommendation.pct : null;
  const recRange = recommendation?.reachable ? recommendation.range : null;
  const recKey = recommendation?.reachable
    ? `${recPct}|${recommendation.hitType}|${recommendation.range?.minPct}|${recommendation.range?.maxPct}`
    : (recommendation ? 'unreachable' : 'none');
  if (uiCache.recommendKey !== recKey) {
    uiCache.recommendKey = recKey;
    els.recommendMarker.hidden = recPct == null;
    els.recommendBand.hidden = !recRange || recRange.minPct >= recRange.maxPct;
    if (recPct != null) {
      els.chargeTrack.style.setProperty('--recommend', `${recPct}%`);
      const suffix = recommendation.hitType === 'splash' ? ' · 溅射' : ' · 直击';
      els.recommendMarker.setAttribute('title', `推荐力度 ${recPct}%${suffix}（实测可命中）`);
    }
    if (recRange) {
      els.chargeTrack.style.setProperty('--recommend-start', `${recRange.minPct}%`);
      els.chargeTrack.style.setProperty('--recommend-end', `${recRange.maxPct}%`);
    }
  }
  if (uiCache.lastPower !== game.lastPower) {
    uiCache.lastPower = game.lastPower;
    const hasLast = BATTLE.showLastPowerMarker && lastPct != null;
    els.lastPowerMarker.hidden = !hasLast;
    if (hasLast) {
      els.chargeTrack.style.setProperty('--last', `${lastPct}%`);
      els.lastPowerMarker.setAttribute('title', `上一发实际力度 ${lastPct}%`);
    }
  }
  const recLabel = recPct == null
    ? '推荐 —'
    : `推荐 ${recPct}${recommendation.hitType === 'splash' ? ' · 溅射' : ' · 直击'}`;
  setText(els.recommendText, recLabel);
  setText(els.lastPowerText, `上一发 ${lastPct ?? '—'}`);
  els.powerText.classList.toggle('unreachable', phase === 'player' && recommendation && !recommendation.reachable);

  let aimMessage = '等待对手';
  let aimBad = false;
  if (phase === 'player') {
    if (p.walkDirection) aimMessage = '移动中 · 停稳后计算';
    else if (angleHeld) aimMessage = '调角中 · 停稳后计算';
    else if (recommendation?.reachable) aimMessage = '当前角度可覆盖';
    else if (recommendation) {
      aimMessage = '当前角度无可命中力度';
      aimBad = true;
    }
  } else if (phase === 'flight') {
    aimMessage = '飞行中 · 镜头跟随';
  } else if (phase === 'resolve') {
    aimMessage = '落点结算中';
  } else if (phase.startsWith('enemy')) {
    aimMessage = '电脑行动中';
  } else if (phase === 'over') {
    aimMessage = '本局结束';
  } else if (phase === 'heal') {
    aimMessage = '治疗结算中';
  }
  if (uiCache.note !== aimMessage) {
    // Keep angle note independent; this cache key is intentionally separate.
  }
  setText(els.aimStatus, aimMessage);
  els.aimStatus.classList.toggle('unreachable', aimBad);

  const healCount = Math.max(0, game.healsRemaining);
  if (uiCache.healCount !== healCount) {
    uiCache.healCount = healCount;
    setText(els.healCount, String(healCount));
  }
  const healDisabled = !game.canHeal();
  if (uiCache.healDisabled !== healDisabled) {
    uiCache.healDisabled = healDisabled;
    els.heal.disabled = healDisabled;
    const label = healDisabled
      ? (game.player.hp >= game.player.maxHp ? '满血，无法治疗' : '当前无法治疗')
      : `自我治疗 ${BATTLE.healAmount} 点，消耗本回合`;
    els.heal.setAttribute('aria-label', label);
    els.heal.title = label;
  }
  updateSkillButtons(phase);

  const powReady = game.energy >= BATTLE.energyMax;
  const powPct = Math.round(game.energy);
  const powDisabled = phase !== 'player' || game.charging || (!powReady && !game.powSelected);
  if (uiCache.powPct !== powPct) {
    uiCache.powPct = powPct;
    setText(els.powPct, `${powPct}%`);
    els.pow.style.setProperty('--pow', `${powPct}%`);
  }
  if (uiCache.powSelected !== game.powSelected || uiCache.disabled !== powDisabled) {
    uiCache.powSelected = game.powSelected;
    uiCache.disabled = powDisabled;
    els.pow.disabled = powDisabled;
    els.pow.classList.toggle('is-ready', powReady);
    els.pow.classList.toggle('is-selected', game.powSelected);
    els.pow.setAttribute('aria-pressed', String(game.powSelected));
    els.pow.setAttribute('aria-label', powReady || game.powSelected
      ? `POW 已充能 ${powPct}%，${game.powSelected ? '已选中，用蓝色主键发射' : '点击选择，不直接发射'}`
      : `POW 大招未充能，当前 ${powPct}%`);
  }

  if (uiCache.stamina !== '∞') {
    uiCache.stamina = '∞';
    setText(els.statStamina, '∞');
  }
  if (uiCache.energy !== Math.round(game.energy)) {
    uiCache.energy = Math.round(game.energy);
    setText(els.statEnergy, Math.round(game.energy));
  }
  const weaponDef = game.weapons?.find((w) => w.id === game.weapon);
  if (uiCache.weapon !== game.weapon) {
    uiCache.weapon = game.weapon;
    setText(els.statWeapon, weaponDef?.label || '水果篮');
  }
  const weaponLocked = (game.stats?.playerShots ?? 0) > 0;
  if (uiCache.weaponLocked !== weaponLocked) {
    uiCache.weaponLocked = weaponLocked;
    els.weaponButton.disabled = weaponLocked;
    els.weaponButton.title = weaponLocked ? '战斗开始后不能换武器' : '更换主武器（开局）';
  }
  setText(els.statHp, Math.round(p.hp));

  if (uiCache.wind !== wind) {
    uiCache.wind = wind;
    const abs = Math.abs(wind);
    setText(els.windValue, abs.toFixed(1));
    setText(els.windArrow, abs < 0.05 ? '·' : wind > 0 ? '→' : '←');
    els.windArrow.classList.toggle('no-wind', abs < 0.05);
    const lit = Math.min(4, Math.ceil(abs));
    [...els.windBars.children].forEach((bar, i) => bar.classList.toggle('lit', i < lit));
    setText(els.windDir, abs < 0.05 ? '无风' : wind > 0 ? '向右' : '向左');
  }

  const metrics = game.metrics();
  const distance = metrics.horizontal.toFixed(0);
  if (uiCache.distance !== distance) {
    uiCache.distance = distance;
    setText(els.minimapDistance, `${distance}m`);
  }
  const elevation = metrics.elevation;
  const elevNote = Math.abs(elevation) < 0.05 ? '等高' : elevation > 0 ? '对手在上' : '对手在下';
  if (uiCache.elevation !== elevNote) {
    uiCache.elevation = elevNote;
    setText(els.elevationNote, elevNote);
  }
  setText(els.lastShot, game.lastPlayerSummary);

  if (game.showCountdown && phase === 'player') {
    els.countdown.hidden = false;
    const seconds = Math.max(0, Math.ceil(game.countdown));
    setText(els.countdown, seconds > 0 ? `${seconds}s` : '超时');
    els.countdown.classList.toggle('expired', seconds <= 0);
  } else {
    els.countdown.hidden = true;
  }

  const panning = camera?.hasManualPan() || false;
  if (uiCache.manualPan !== panning) {
    uiCache.manualPan = panning;
    els.recenter.classList.toggle('is-active', panning);
    els.recenter.textContent = panning ? '回战场 •' : '回战场';
  }
}

function flashCard(card) {
  if (!card) return;
  card.classList.remove('hit');
  void card.offsetWidth;
  card.classList.add('hit');
  window.setTimeout(() => card.classList.remove('hit'), 380);
}

function showToast(text, { alert = false, duration = 3200 } = {}) {
  if (!text) return;
  clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.classList.toggle('alert', alert);
  els.toast.classList.remove('is-quiet');
  toastTimer = window.setTimeout(() => els.toast.classList.add('is-quiet'), duration);
}

function showTurnFlash(turn) {
  clearTimeout(flashTimer);
  els.turnFlash.textContent = turn === 0 ? '你的回合' : '电脑回合';
  els.turnFlash.classList.toggle('enemy', turn === 1);
  els.turnFlash.classList.remove('show');
  void els.turnFlash.offsetWidth;
  els.turnFlash.classList.add('show');
  flashTimer = window.setTimeout(() => els.turnFlash.classList.remove('show'), 1120);
}

function skillName(skill) {
  return BATTLE.skillDefs[skill]?.label || '';
}

function handleEvent(type, data = {}) {
  if (type === 'toast') {
    showToast(data.text || '', { duration: 4200 });
  } else if (type === 'sound') {
    sound.play(data.name, data.weapon);
  } else if (type === 'reset') {
    lastTurnKey = '';
    camera?.reset();
    camera?.clearPan();
    input?.cancelAll('reset');
    lastRecommendationAt = 0;
    lastRecommendation = null;
  } else if (type === 'turn') {
    const key = `${data.turn}:${data.round}`;
    if (key !== lastTurnKey) {
      lastTurnKey = key;
      input?.cancelAll('turn-change');
      camera?.clearPan();
      showTurnFlash(data.turn);
      if (game) {
        const windText = `${Math.abs(game.wind.value).toFixed(1)} · ${game.wind.value > 0 ? '向右' : game.wind.value < 0 ? '向左' : '无风'}`;
        showToast(data.turn === 0
          ? `第 ${data.round} 回合 · 风力 ${windText} · 推荐力度按当前角度计算`
          : `电脑回合 · 风力 ${windText}`, { duration: 2600 });
      }
      sound.play(data.turn === 0 ? 'turn-self' : 'turn-enemy');
    }
  } else if (type === 'heal') {
    showToast(`自我治疗 +${data.amount} · ${data.hp} / ${data.maxHp}，本回合行动已消耗`, { duration: 2600 });
    if (navigator.vibrate) navigator.vibrate(24);
  } else if (type === 'fire') {
    if (data.owner === 0) {
      const weaponLabel = game?.weapons?.find((w) => w.id === data.weapon)?.label || '';
      const extra = data.shells > 1 ? ` · ${skillName(data.skill)} 共 ${data.shells} 发` : '';
      showToast(`${weaponLabel ? `${weaponLabel} · ` : ''}炮弹已出膛${extra} · 观察风偏`, { duration: 1900 });
    } else {
      showToast('电脑开火，注意落点', { duration: 1800 });
    }
  } else if (type === 'skill-select') {
    const active = [data.skill, ...(data.buffs || [])].filter(Boolean);
    showToast(active.length
      ? `已选 ${active.map(skillName).join(' + ')} · 下一发生效，仍用蓝色主键发射`
      : '已取消技能选择', { duration: 2200 });
    sound.play('skill-select');
  } else if (type === 'weapon-select') {
    showToast(`主武器：${data.label || data.weapon} · 角度 ${data.angleMin}°–${data.angleMax}°`, { duration: 2600 });
    sound.play('select');
  } else if (type === 'pow-select') {
    showToast(data.selected ? 'POW 已选中 · 下一发增强，仍用蓝色主键发射' : '已取消 POW', { duration: 2200 });
    sound.play('pow-select');
  } else if (type === 'impact') {
    const sentinel = data.owner === 0 ? '芽芽' : '你';
    if (data.damage > 0) {
      showToast(`${data.owner === 0 ? '命中' : '你被命中'} ${sentinel} · −${data.damage} HP`, { alert: data.owner === 1, duration: 2200 });
      if (data.owner === 1 && navigator.vibrate) navigator.vibrate(40);
    } else if (data.type === 'out') {
      showToast('炮弹飞出了战场', { duration: 1800 });
    } else if (!data.shells || data.shells === 1) {
      showToast('炮弹落地，未命中', { duration: 1700 });
    }
  } else if (type === 'volley-resolve') {
    if (data.shots > 1) showToast(`${data.shots} 发已全部结算，即将切换回合`, { duration: 1700 });
  } else if (type === 'gameover') {
    clearTimeout(resultTimer);
    resultTimer = window.setTimeout(() => showResult(data), 420);
  }
}

function openHelp() {
  input?.cancelAll('help');
  game?.cancelCharge();
  modalMode = 'help';
  els.modalTitle.textContent = '看清战场，再算风';
  const weaponDef = game?.weapons?.find((w) => w.id === game.weapon);
  const weaponLabel = weaponDef?.label || '水果篮';
  const weaponRange = `${weaponDef?.angleMin ?? CONTROLS.angleMin}°–${weaponDef?.angleMax ?? CONTROLS.angleMax}°`;
  els.modalBody.innerHTML = `
    <p class="intro-strip"><span class="chip"><em>1</em>移动</span><span class="chip"><em>2</em>调角</span><span class="chip"><em>3</em>蓄力</span><span class="chip"><em>4</em>松手</span></p>
    <dl class="help-grid">
      <dt>镜头</dt><dd>瞄准时用同一比例缩放把双方装进画面，角色与脚下地形位于中下部，上方保留抛射空间。左上小地图显示双方和镜头框；拖动小地图只移动镜头，点“回战场”立即回到自动构图。距离过大时以小地图辅助，不挪近出生点。</dd>
      <dt>飞行</dt><dd>炮弹出手后镜头跟随炮弹，允许飞入天空，双方可能暂时离屏。小地图、风向、力度尺、转盘、技能和发射键始终固定在屏幕原位；飞行中不能再次发射。最后一发爆炸并结算后，镜头平滑回到下一回合双方视角，不会在飞行中反复缩放。</dd>
      <dt>移动</dt><dd>按住左下转盘左右键，或键盘 A / D、← / →。角色在 ${WORLD.width} px 世界地图上真实行走；本版本体力无限，移动不会耗尽体力。陡坎会挡住，脚下被炸空会受重力下落。</dd>
      <dt>角度</dt><dd>按住转盘上下键，或 W / S、↑ / ↓；桌面也可在中心角度数字上上下拖动。当前武器 <strong>${weaponLabel}</strong> 的范围是 ${weaponRange}。角色旁只显示一小段方向虚线与角度扇形，不预测整条弹道。</dd>
      <dt>力度</dt><dd>按住右下蓝色主键或空格蓄力，松手发射。力度从 5% 连续升到 100% 后立即回弹，不自动开炮；松手那一帧的实际力度就是出手力度。底部细尺显示当前值、蓝色实测推荐三角和白色上一发竖线；连续可命中时另显示蓝色区间。推荐值按当前角度、当前技能、POW 和同一套风力/碰撞逻辑逐发复算，打不到时只提示调角，不会自动调角或发射。</dd>
      <dt>战斗道具</dt><dd>右侧 1–8 格照原版战斗道具栏排列：<strong>1 附加攻击2次</strong>（共 3 发）、<strong>2 散弹</strong>（5 发扇形）、<strong>3 附加攻击1次</strong>（共 2 发）、<strong>4–8 伤害增幅 50/40/30/20/10%</strong>。攻击格与增幅格可以同时选择，增幅可叠加；每格每回合 1 次。选中后仍由蓝色主键或空格发射。治疗移到顶部心形按钮，快捷键 H，恢复 ${BATTLE.healAmount} 点并消耗本回合。</dd>
      <dt>武器</dt><dd>开局可在烈火、轰天、水果篮、黑白家电、风神之间切换；第一发炮弹出手后锁定，重开后可再选。五种武器的角度、武器外观与飞行炮弹均按原版 XML/SWF 对应资源接入。</dd>
      <dt>POW</dt><dd>POW 对应 R 键，也只负责选择（再按一次取消），不会自动开炮。能量满 ${BATTLE.energyMax}% 才亮；不足时按 R 会提示能量不足并保留当前技能。选中后蓝色主键发射，伤害、爆炸半径与弹坑更大。</dd>
      <dt>标记</dt><dd>你出手后，地图上以世界坐标标出上一发的站位“起”和实际落点“落”；镜头移动不会让标记漂移。电脑的落点不会覆盖你的记录。</dd>
      <dt>倒计时</dt><dd>右上时钟按钮可开启练习计时；默认关闭，单机练习不会催你。计时只显示，不自动出手。</dd>
      <dt>音效</dt><dd>首次点技能、按空格或按发射键时会自动尝试解锁音频，不需要先点空白处；静音、解锁失败或素材加载失败都不会阻断蓄力与开炮。开炮与爆炸按 <code>BombConfig.xml</code>/<code>BallList.xml</code> 的 Common 弹体逐武器取原版音：烈火 025/087、轰天 023/087、水果篮 114/102、黑白家电 110/100、风神 029/089；道具/POW 039、阵亡 042、选道具 008、回合 016/038、胜负 063/064 同样来自 <code>audio.swf</code> 离线提取。原版没有独立受击音，网页用明确标注的合成替代。完整映射见 <a href="docs/AUDIO_MAPPING.md" target="_blank" rel="noopener"><code>docs/AUDIO_MAPPING.md</code></a>。</dd>
    </dl>
    <p><strong>物理来源：</strong> 重力、空气阻力与风力来自 <code>BombObject.UpdateAGW()</code> 与 <code>EulerVector.ComputeOneEulerStep()</code>；开炮速度使用 <code>Living.ShootImp()</code>；风每回合按 <code>BaseGame.GetNextWind()</code> 变化。</p>
    <p><strong>音效来源：</strong> 原版 <code>SoundManager.as</code> 的 SoundID 经 <code>audio.swf</code> 离线解码为 MP3，不运行 Flash；触发点按 <code>ShootBombAction.executeImp()</code>、<code>SimpleBomb.bomb()</code>、<code>doUseItemAnimation()</code> 与 <code>die()</code> 对齐。</p>
    <p class="source-note">原仓库：<a href="${SOURCE_REPO}" target="_blank" rel="noopener">github.com/phucdz2kk4/Gunny</a> · 提交 <code>${SOURCE_COMMIT.slice(0, 7)}</code><br>地图 1001、地图距离、角色素材与单机规则保持不变；手机 HUD、双方广角构图、多弹技能、推荐力度与音效为网页新增实现。</p>
  `;
  els.modalAction.textContent = '回到对战';
  els.modal.hidden = false;
  els.modalClose.hidden = false;
  lastFrame = performance.now();
}

function showResult(data) {
  input?.cancelAll('result');
  modalMode = 'result';
  const win = data.winner === 0;
  sound.play(win ? 'win' : 'lose');
  const accuracy = data.stats.playerShots ? Math.round(data.stats.playerHits / data.stats.playerShots * 100) : 0;
  els.modalTitle.textContent = win ? '漂亮的一击，你赢了！' : '芽芽笑到了最后';
  els.modalBody.innerHTML = `
    <p>${win ? '你让最后一发炮弹穿过了风场。再开一局，试试改变角度或换一种技能。' : '风向每回合都在变。记住上一发的“起/落”标记，先修角度，再微调力度。'}</p>
    <div class="result-score">
      <div class="result-stat"><b>${data.round}</b><span>回合</span></div>
      <div class="result-stat"><b>${data.stats.playerShots}</b><span>你的炮弹</span></div>
      <div class="result-stat"><b>${data.stats.playerHits}</b><span>命中</span></div>
      <div class="result-stat"><b>${accuracy}%</b><span>命中率</span></div>
      <div class="result-stat"><b>${data.stats.playerDamageDealt}</b><span>伤害</span></div>
    </div>
    <p class="source-note">本局电脑发射 ${data.stats.enemyShots} 发、命中 ${data.stats.enemyHits} 发。风场沿用原版 GetNextWind 规则。</p>
  `;
  els.modalAction.textContent = '再战一局';
  els.modalClose.hidden = true;
  els.modal.hidden = false;
  lastFrame = performance.now();
}

function closeModal() {
  if (modalMode === 'result') return;
  els.modal.hidden = true;
  if (document.activeElement instanceof HTMLElement && els.modal.contains(document.activeElement)) {
    document.activeElement.blur();
  } else if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  lastFrame = performance.now();
}

function restartMatch() {
  clearTimeout(resultTimer);
  clearTimeout(flashTimer);
  input?.cancelAll('restart');
  if (!game) return;
  game.reset();
  camera.reset();
  camera.clearPan();
  els.modal.hidden = true;
  uiCache.hp = [null, null];
  uiCache.phase = '';
  uiCache.fireLabel = '';
  uiCache.forcePct = null;
  uiCache.lastPower = undefined;
  uiCache.recommendKey = '';
  uiCache.healDisabled = null;
  uiCache.healCount = null;
  uiCache.powSelected = null;
  uiCache.powPct = null;
  uiCache.manualPan = null;
  uiCache.weapon = null;
  uiCache.weaponLocked = null;
  uiCache.stamina = null;
  lastRecommendationAt = 0;
  lastRecommendation = null;
  lastRecommendationMode = '';
  lastFrame = performance.now();
  showToast('已重开 · 观察本回合风力', { duration: 2400 });
}

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function updateFullscreenUI() {
  const active = isFullscreenActive();
  document.documentElement.classList.toggle('is-fullscreen', active);
  els.fullscreen.setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
  els.fullscreen.title = active ? '退出全屏' : '全屏';
}

async function toggleFullscreen() {
  input?.cancelAll('fullscreen');
  if (!isFullscreenActive()) {
    const root = document.documentElement;
    let supported = true;
    try {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      else if (root.webkitRequestFullScreen) root.webkitRequestFullScreen();
      else supported = false;
    } catch {
      supported = false;
    }
    if (!supported || !isFullscreenActive()) {
      document.documentElement.classList.add('fullscreen-fallback');
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
      showToast(iOS
        ? 'iPhone 浏览器不支持网页全屏：请横屏，或“添加到主屏幕”后全屏打开。'
        : '当前浏览器不允许自动全屏，请手动横屏或使用系统全屏。', { alert: true, duration: 4200 });
      scheduleLayout();
      return;
    }
    try { await screen.orientation?.lock?.('landscape'); } catch { /* optional */ }
    updateFullscreenUI();
    showToast('已进入全屏', { duration: 1800 });
    scheduleLayout();
    window.setTimeout(scheduleLayout, 260);
  } else {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else document.webkitExitFullscreen?.();
    } catch { /* already exited */ }
    try { screen.orientation?.unlock?.(); } catch { /* optional */ }
    updateFullscreenUI();
    scheduleLayout();
  }
}

function syncOrientationNotice() {
  const portrait = window.innerHeight > window.innerWidth;
  const show = portrait && window.innerWidth < 950 && !portraitDismissed;
  els.rotateNotice.hidden = !show;
  if (show) {
    input?.cancelAll('orientation');
    game?.cancelCharge();
  }
  paused = !els.modal.hidden || !els.rotateNotice.hidden || !els.weaponPicker.hidden;
  lastFrame = performance.now();
}

function syncSoundButton() {
  els.sound.setAttribute('aria-pressed', String(sound.enabled));
  els.sound.setAttribute('aria-label', sound.enabled ? '关闭音效' : '开启音效');
  els.sound.title = sound.enabled ? '音效已开' : '音效已关';
}

function unlockSound() {
  // Fire-and-forget: decode/fetch failure must never block charging or firing.
  sound.unlock().then((ok) => { if (ok) syncSoundButton(); }).catch(() => {});
}

function canUsePlayerUi() {
  return !!game
    && !paused
    && game.phase === 'player'
    && els.modal.hidden
    && els.rotateNotice.hidden
    && els.weaponPicker.hidden
    && !game.charging;
}

function buildWeaponPicker() {
  if (!game?.weapons?.length) return;
  els.weaponGrid.innerHTML = game.weapons.map((weapon) => `
    <button class="weapon-option" type="button" role="radio" data-weapon="${weapon.id}" aria-checked="false">
      <img src="assets/${weapon.weaponSprite}.png" alt="">
      <strong>${weapon.label}</strong>
      <em>${weapon.angleMin}°–${weapon.angleMax}°</em>
      <small>${weapon.trait || '经典武器'}</small>
    </button>
  `).join('');
  weaponPickerBuilt = true;
}

function paintWeaponPicker() {
  if (!game?.weapons?.length) return;
  const fallback = game.weapons.find((weapon) => weapon.id === game.weapon) || game.weapons[0];
  if (!game.weapons.some((weapon) => weapon.id === selectedWeaponId)) selectedWeaponId = fallback.id;
  for (const option of els.weaponGrid.querySelectorAll('.weapon-option')) {
    const active = option.dataset.weapon === selectedWeaponId;
    option.classList.toggle('is-selected', active);
    option.setAttribute('aria-checked', String(active));
  }
  const chosen = game.weapons.find((weapon) => weapon.id === selectedWeaponId) || fallback;
  els.weaponSource.textContent = `${chosen.label} · ${chosen.trait || '经典武器'} · 角度 ${chosen.angleMin}°–${chosen.angleMax}°`;
}

function openWeaponPicker({ force = false } = {}) {
  if (!game) return false;
  if (!force && (game.stats?.playerShots ?? 0) > 0) {
    showToast('第一发炮弹已出手，本局武器已锁定；重开后可再选', { alert: true, duration: 2600 });
    return false;
  }
  buildWeaponPicker();
  selectedWeaponId = game.weapon || selectedWeaponId;
  paintWeaponPicker();
  els.weaponPicker.hidden = false;
  input?.cancelAll('weapon-picker');
  paused = true;
  return true;
}

function closeWeaponPicker() {
  els.weaponPicker.hidden = true;
  paused = !els.modal.hidden || !els.rotateNotice.hidden;
  lastFrame = performance.now();
}

function confirmWeaponChoice() {
  if (!game) return false;
  const ok = game.selectWeapon(selectedWeaponId);
  closeWeaponPicker();
  if (!ok) {
    showToast('武器选择失败，请重试', { alert: true, duration: 2200 });
    return false;
  }
  const label = game.weapons?.find((weapon) => weapon.id === selectedWeaponId)?.label || selectedWeaponId;
  showToast(`主武器：${label} · 开局角度已按该武器设置`, { duration: 2600 });
  return true;
}

function useSkillSlot(index) {
  unlockSound();
  const id = SKILL_SLOTS[index];
  if (!id || !canUsePlayerUi()) return false;
  if (id === 'heal') {
    if (!game.canHeal()) return false;
    input?.cancelAll('heal');
    const success = game.healPlayer();
    if (success) lastFrame = performance.now();
    return success;
  }
  const success = game.toggleSkill(id);
  if (success) lastFrame = performance.now();
  return success;
}

function useHeal() {
  unlockSound();
  if (!game || !canUsePlayerUi() || !game.canHeal()) return false;
  input?.cancelAll('heal');
  const success = game.healPlayer();
  if (success) lastFrame = performance.now();
  return success;
}

function usePowShortcut() {
  unlockSound();
  if (!canUsePlayerUi()) return false;
  if (game.energy < BATTLE.energyMax) {
    showToast('能量不足：POW 尚未充能', { alert: true, duration: 2000 });
    return false;
  }
  // R shares the POW button's toggle semantics: selected again = cancel.
  const success = game.togglePow();
  if (success) lastFrame = performance.now();
  return success;
}

function beginPlayerCharge() {
  unlockSound();
  if (!game || game.phase !== 'player') return false;
  if (input?.isMovementHeld()) {
    showToast('先松开移动键，再按住发射蓄力', { alert: true, duration: 2000 });
    return false;
  }
  if (!game.startCharge()) return false;
  lastFrame = performance.now();
  return true;
}

function releasePlayerCharge() {
  if (!game?.charging) return false;
  const success = game.releaseCharge();
  if (success) input?.cancelAll('shot');
  lastFrame = performance.now();
  return success;
}

function cancelPlayerCharge() {
  game?.cancelCharge();
  lastFrame = performance.now();
}

function setupInput() {
  input = new InputController({
    root: els.app,
    fireButton: els.fire,
    moveButtons: [els.left, els.right],
    aimButtons: [els.up, els.down],
    angleScrubSurface: document.querySelector('.joy-center'),
    canAcceptInput: () => !!game && !paused && game.phase === 'player'
      && els.modal.hidden && els.rotateNotice.hidden && els.weaponPicker.hidden,
    onChargeStart: beginPlayerCharge,
    onChargeRelease: releasePlayerCharge,
    onChargeCancel: cancelPlayerCharge,
    onSkillSlot: useSkillSlot,
    onPowShortcut: usePowShortcut,
    onHealShortcut: useHeal,
    onUserGesture: unlockSound,
    onAngleTap: (delta) => {
      if (!game || paused || game.phase !== 'player' || game.charging) return;
      game.setAngle(delta * CONTROLS.angleTapStep);
    },
    onAngleScrub: (pixels) => {
      if (!game || paused || game.phase !== 'player' || game.charging) return;
      game.setAngle(pixels * CONTROLS.angleDragPerPixel);
    },
    onAbort: cancelPlayerCharge,
  });
  input.bind();
}

function buildMinimapBase(back, fore) {
  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const ox = 0;
  const oy = 14;
  const mapW = 280;
  const mapH = 100;
  const scaleX = mapW / WORLD.width;
  const tileW = back.naturalWidth || back.width;
  const tileH = back.naturalHeight || back.height;

  ctx.fillStyle = '#082e3d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, mapW, mapH);
  ctx.clip();
  const tileCount = Math.ceil(WORLD.width / tileW);
  for (let i = 0; i < tileCount; i += 1) {
    const x = i * tileW;
    ctx.save();
    if (i % 2 === 1) {
      ctx.translate(ox + (x + tileW) * scaleX, oy);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(ox + x * scaleX, oy);
    }
    ctx.drawImage(back, 0, 0, tileW, tileH, 0, 0, tileW * scaleX, mapH);
    ctx.restore();
  }
  if (fore) {
    const foreW = fore.naturalWidth || fore.width;
    const foreH = fore.naturalHeight || fore.height;
    ctx.globalAlpha = 0.9;
    if (WORLD.width <= WORLD.sourceWidth) {
      ctx.drawImage(fore, 0, 0, foreW, foreH, ox, oy, mapW, mapH);
    } else {
      const halfW = mapW / 2;
      ctx.drawImage(fore, 0, 0, foreW, foreH, ox, oy, halfW, mapH);
      ctx.save();
      ctx.translate(ox + mapW, oy);
      ctx.scale(-1, 1);
      ctx.drawImage(fore, 0, 0, foreW, foreH, 0, 0, halfW, mapH);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  const shade = ctx.createLinearGradient(0, oy, 0, oy + mapH);
  shade.addColorStop(0, 'rgba(3,20,29,0.08)');
  shade.addColorStop(1, 'rgba(2,16,23,0.34)');
  ctx.fillStyle = shade;
  ctx.fillRect(ox, oy, mapW, mapH);
  return canvas;
}

function drawMinimap() {
  if (!minimapBase || !game || !view) return;
  const canvas = els.minimap;
  const ctx = canvas.getContext('2d');
  const mapW = 280;
  const mapH = 100;
  const oy = 14;
  const scaleX = mapW / WORLD.width;
  const scaleY = mapH / WORLD.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(minimapBase, 0, 0);

  const clampX = (x) => Math.max(0, Math.min(mapW, x));
  const clampY = (y) => Math.max(0, Math.min(mapH, y));
  const left = clampX(view.worldLeft * scaleX);
  const top = clampY(view.worldTop * scaleY);
  const right = clampX((view.worldLeft + view.viewW) * scaleX);
  const bottom = clampY((view.worldTop + view.viewH) * scaleY);
  ctx.save();
  ctx.strokeStyle = 'rgba(244, 254, 255, 0.94)';
  ctx.lineWidth = 1.6;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 3;
  ctx.strokeRect(left + 1, oy + top + 1, Math.max(3, right - left - 2), Math.max(3, bottom - top - 2));
  ctx.restore();

  for (const actor of game.actors) {
    if (!actor?.alive) continue;
    const x = (actor.renderX ?? actor.x) * scaleX;
    const y = oy + (actor.renderY ?? actor.y) * scaleY;
    ctx.save();
    ctx.fillStyle = actor.index === 0 ? '#56e0d2' : '#ffad66';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (game.shot) {
    const x = (game.shot.renderX ?? game.shot.x) * scaleX;
    const y = oy + (game.shot.renderY ?? game.shot.y) * scaleY;
    ctx.save();
    ctx.fillStyle = '#ffe07b';
    ctx.shadowColor = '#ffe07b';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Small corner marks keep the map readable without extra cards.
  ctx.fillStyle = 'rgba(4,24,33,0.55)';
  ctx.fillRect(0, 0, mapW, oy);
  ctx.fillRect(0, oy + mapH, mapW, 14);
}

function setupMinimap() {
  const wrap = els.minimapWrap;
  const localPoint = (event) => {
    const rect = wrap.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * 280,
      y: (event.clientY - rect.top) / rect.height * 128,
    };
  };
  wrap.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!game || game.phase === 'flight') return;
    event.preventDefault();
    const p = localPoint(event);
    minimapDrag = { id: event.pointerId, lastX: p.x, lastY: p.y };
    wrap.classList.add('dragging');
    try { wrap.setPointerCapture(event.pointerId); } catch { /* no-op */ }
  });
  wrap.addEventListener('pointermove', (event) => {
    if (!minimapDrag || event.pointerId !== minimapDrag.id) return;
    event.preventDefault();
    const p = localPoint(event);
    const dx = p.x - minimapDrag.lastX;
    const dy = p.y - minimapDrag.lastY;
    minimapDrag.lastX = p.x;
    minimapDrag.lastY = p.y;
    camera?.panBy(-dx / 280 * WORLD.width, -dy / 128 * WORLD.height);
    lastFrame = performance.now();
  });
  const end = (event) => {
    if (!minimapDrag || event.pointerId !== minimapDrag.id) return;
    minimapDrag = null;
    wrap.classList.remove('dragging');
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('lostpointercapture', end);
  els.recenter.addEventListener('click', () => {
    camera?.clearPan();
    els.recenter.blur();
    lastFrame = performance.now();
    showToast('镜头已回到战场', { duration: 1400 });
  });
}

function setupEvents() {
  els.help.addEventListener('click', openHelp);
  els.heal.addEventListener('click', (event) => {
    if (event.detail === 0) return;
    useHeal();
    if (document.activeElement === els.heal) els.heal.blur();
  });
  for (const button of document.querySelectorAll('.skill-button[data-skill]')) {
    button.addEventListener('click', (event) => {
      if (event.detail === 0) return;
      const id = button.dataset.skill;
      const success = useSkillSlot(SKILL_SLOTS.indexOf(id));
      if (document.activeElement === button) button.blur();
      if (success) lastFrame = performance.now();
    });
  }
  els.weaponButton.addEventListener('click', (event) => {
    if (event.detail === 0) return;
    openWeaponPicker();
    els.weaponButton.blur();
  });
  els.weaponConfirm.addEventListener('click', () => confirmWeaponChoice());
  els.weaponGrid.addEventListener('click', (event) => {
    const option = event.target.closest('.weapon-option');
    if (!option) return;
    selectedWeaponId = option.dataset.weapon;
    paintWeaponPicker();
  });
  els.pow.addEventListener('click', (event) => {
    if (event.detail === 0) return;
    usePowShortcut();
    if (document.activeElement === els.pow) els.pow.blur();
  });
  els.restart.addEventListener('click', () => { restartMatch(); els.restart.blur(); });
  els.fullscreen.addEventListener('click', async () => { await toggleFullscreen(); els.fullscreen.blur(); });
  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal && modalMode !== 'result') closeModal();
  });
  els.modalAction.addEventListener('click', () => {
    if (modalMode === 'result') restartMatch();
    else closeModal();
  });
  els.rotateFull.addEventListener('click', async () => {
    await toggleFullscreen();
    if (window.innerWidth > window.innerHeight) els.rotateNotice.hidden = true;
    paused = !els.modal.hidden || !els.rotateNotice.hidden || !els.weaponPicker.hidden;
    els.rotateFull.blur();
    scheduleLayout();
  });
  els.rotateDismiss.addEventListener('click', () => {
    portraitDismissed = true;
    els.rotateNotice.hidden = true;
    els.rotateDismiss.blur();
    scheduleLayout();
  });
  els.timerToggle.addEventListener('click', () => {
    if (!game) return;
    const next = !game.showCountdown;
    game.setCountdown(next, BATTLE.countdownSeconds);
    els.timerToggle.setAttribute('aria-pressed', String(next));
    els.timerToggle.setAttribute('aria-label', next ? '关闭练习倒计时' : '开启练习倒计时');
    els.timerToggle.blur();
    showToast(next
      ? `练习计时已开 · ${BATTLE.countdownSeconds}s，只显示不自动出手`
      : '练习计时已关 · 单机练习不催你出手', { duration: 2400 });
  });
  els.sound.addEventListener('click', async () => {
    const next = !sound.enabled;
    const enabled = await sound.setEnabled(next);
    syncSoundButton();
    if (enabled) {
      sound.play('select');
      showToast('音效已开启 · 原版开炮/爆炸声已就绪', { duration: 1900 });
    } else if (!next) {
      showToast('音效已关闭 · 蓄力与发射不受影响', { duration: 1700 });
    }
    els.sound.blur();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.modal.hidden && modalMode !== 'result') {
      event.preventDefault();
      closeModal();
    }
  });
  const handleViewportChange = () => {
    syncOrientationNotice();
    scheduleLayout();
  };
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', () => {
    input?.cancelAll('orientationchange');
    portraitDismissed = false;
    syncOrientationNotice();
    scheduleLayout();
    window.setTimeout(scheduleLayout, 260);
    window.setTimeout(scheduleLayout, 700);
  });
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('scroll', scheduleLayout);
  const handleFullscreenChange = () => {
    input?.cancelAll('fullscreenchange');
    updateFullscreenUI();
    syncOrientationNotice();
    scheduleLayout();
    window.setTimeout(scheduleLayout, 220);
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  updateFullscreenUI();
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(els.app);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input?.cancelAll('visibility');
    else lastFrame = performance.now();
  });
  window.addEventListener('blur', () => input?.cancelAll('window-blur'));
  document.addEventListener('dragstart', (event) => event.preventDefault());
}

function actorScreenRect(actor) {
  if (!view) return null;
  const artW = COMBAT.characterFrameWidth * COMBAT.characterScale;
  const artH = COMBAT.characterFrameHeight * COMBAT.characterScale;
  const p = projectPoint(view, actor.x - artW / 2, actor.y - artH - 8);
  return {
    x: p.x,
    y: p.y,
    width: artW * view.zoom,
    height: (artH + 8) * view.zoom,
    centerX: projectPoint(view, actor.x, actor.y - artH / 2).x,
    centerY: projectPoint(view, actor.x, actor.y - artH / 2).y,
  };
}

function exposeTestApi() {
  if (!isTest) return;
  window.__GUNNY_TEST__ = {
    snapshot() {
      if (!game) return null;
      const metrics = game.metrics();
      const recommendation = game.recommendation();
      return {
        phase: game.phase,
        round: game.round,
        turn: game.turn,
        winner: game.winner,
        wind: { value: game.wind.value, target: game.wind.target },
        angle: game.angle,
        force: game.force,
        chargeElapsed: game.chargeElapsed,
        charging: game.charging,
        selectedSkill: game.selectedSkill,
        selectedBuffs: [...(game.selectedBuffs || [])],
        skillUses: { ...game.skillUses },
        weapon: game.weapon,
        enemyWeapon: game.enemyWeapon,
        weapons: game.weapons,
        poses: game.actors.map((actor) => renderer?.poseForActor?.(game, actor) ?? null),
        angleMin: game.angleMin,
        angleMax: game.angleMax,
        weaponLocked: (game.stats?.playerShots ?? 0) > 0,
        powSelected: game.powSelected,
        energy: game.energy,
        stamina: Number.isFinite(game.stamina) ? game.stamina : '∞',
        showCountdown: game.showCountdown,
        countdown: game.countdown,
        recommendation,
        actors: game.actors.map((actor) => ({
          id: actor.id, x: actor.x, y: actor.y, hp: actor.hp, maxHp: actor.maxHp, alive: actor.alive,
          facing: actor.facing, walkDirection: actor.walkDirection, slope: actor.slope,
          vy: actor.vy, falling: actor.falling, grounded: actor.grounded,
          fireTimer: actor.fireTimer, hurtTimer: actor.hurtTimer,
        })),
        lastPower: game.lastPower,
        lastPowerPct: game.lastPower != null ? Math.round(game.lastPower / PHYSICS.forceMax * 100) : null,
        healsRemaining: game.healsRemaining, canHeal: game.canHeal(),
        shots: (game.shots || []).map((shot) => ({
          x: shot.x, y: shot.y, renderX: shot.renderX, renderY: shot.renderY,
          vx: shot.vx, vy: shot.vy, owner: shot.owner,
          alive: shot.alive, resolved: shot.resolved, impact: shot.impact,
          slot: shot.slot, shells: shot.shells, skill: shot.skill, weapon: shot.weapon, age: shot.age,
          pow: shot.pow, elevation: shot.elevation, force: shot.force,
        })),
        shot: game.shot ? {
          x: game.shot.x, y: game.shot.y, renderX: game.shot.renderX, renderY: game.shot.renderY,
          vx: game.shot.vx, vy: game.shot.vy, owner: game.shot.owner,
        } : null,
        stats: { ...game.stats },
        lastImpact: game.lastImpact,
        lastPlayerSummary: game.lastPlayerSummary,
        playerVolley: game.playerVolley ? {
          from: { ...game.playerVolley.from },
          impacts: game.playerVolley.impacts.map((impact) => ({ ...impact })),
          skill: game.playerVolley.skill,
          pow: game.playerVolley.pow,
          force: game.playerVolley.force,
          angle: game.playerVolley.angle,
          shells: game.playerVolley.shells,
        } : null,
        metrics,
        modalOpen: !els.modal.hidden,
        rotateOpen: !els.rotateNotice.hidden,
        paused,
        layout: { ...layout },
        world: { width: WORLD.width, height: WORLD.height, chunkSize: WORLD.chunkSize },
        terrain: terrain ? { chunks: terrain.chunks.length, craters: terrain.craters.length, dirtyChunks: terrain.dirtyChunks.size } : null,
        camera: view ? {
          left: view.left, top: view.top, scale: view.scale, zoom: view.zoom,
          viewW: view.viewW, viewH: view.viewH, worldLeft: view.worldLeft, worldTop: view.worldTop,
          cameraX: view.cameraX, cameraY: view.cameraY, allowSky: view.allowSky, allowWide: view.allowWide,
        } : null,
        effectiveCameraMode: effectiveCameraMode(),
        manualPan: camera?.hasManualPan() ?? false,
        hints: renderer?.hintBoxes ? renderer.hintBoxes.map((hint) => ({ ...hint })) : [],
        audio: sound.debug(),
      };
    },
    config: { CONTROLS, PHYSICS, COMBAT, WORLD, AI, BATTLE, TERRAIN, VIEW },
    layout: () => ({ ...layout }),
    controlRects() {
      const selectors = ['#left', '#right', '#up', '#down', '#fire', '#pow', '#heal', '#weaponButton', '#skillExtra2', '#skillScatter', '#skillExtra1', '#skillBoost50', '#skillBoost40', '#skillBoost30', '#skillBoost20', '#skillBoost10',
        '#joystick', '#angle', '#windValue', '#minimap', '#minimapWrap', '#recenter', '#controls', '#topbar', '#fullscreen', '#timerToggle',
        '#sound', '#help', '#restart', '#powerText', '#chargeTrack', '#statHp', '#statStamina', '#statEnergy',
        '.battle-hud', '.utilities', '.minimap-panel', '.skill-rail', '.power-panel', '.fire-cluster'];
      const rects = Object.fromEntries(selectors.map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return [selector, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } : null];
      }));
      if (game && view) {
        rects.actors = game.actors.map((actor) => actorScreenRect(actor));
      }
      return rects;
    },
    firePlayer(angle, force) {
      if (!game || game.phase !== 'player') return false;
      return game.fire(0, angle, force);
    },
    aimAndFirePlayer() {
      if (!game || game.phase !== 'player') return null;
      const plan = solvePerfect({
        shooter: game.player,
        target: game.enemy,
        wind: game.wind.value,
        terrain: game.terrain,
        angleMin: game.angleMin,
        angleMax: game.angleMax,
      });
      const ok = game.fire(0, plan.angle, plan.force);
      return { ok, angle: plan.angle, force: plan.force, expectedDistance: plan.expected.closest };
    },
    solveShot() {
      if (!game) return null;
      return solvePerfect({
        shooter: game.player,
        target: game.enemy,
        wind: game.wind.value,
        terrain: game.terrain,
        angleMin: game.angleMin,
        angleMax: game.angleMax,
      });
    },
    recommendation: () => game?.recommendation() ?? null,
    chargeForceAt: (seconds) => game?.forceForElapsed(seconds) ?? null,
    force: () => game?.force ?? null,
    charging: () => !!game?.charging,
    audioReady: () => sound.ready(),
    audioPlay: (name, weapon = null) => { sound.play(name, weapon); },
    setWind(value, target = Math.round(value * 10)) {
      if (!game) return;
      game.setWind(value, target);
    },
    setHp(index, hp) {
      if (!game) return;
      game.setHp(index, hp);
      uiCache.hp[index] = null;
      uiCache.healDisabled = null;
    },
    setAngle(value) {
      if (!game || game.phase !== 'player' || game.charging) return false;
      return game.setAngleAbsolute(value);
    },
    setEnergy(value) {
      if (!game) return;
      game.setEnergy(value);
    },
    setStamina(value) {
      if (!game) return;
      game.setStamina(value);
    },
    setCountdown(enabled, seconds = BATTLE.countdownSeconds) {
      if (!game) return;
      game.setCountdown(enabled, seconds);
      els.timerToggle.setAttribute('aria-pressed', String(game.showCountdown));
    },
    selectSkill(id) {
      const slot = SKILL_SLOTS.indexOf(id);
      return slot >= 0 ? useSkillSlot(slot) : false;
    },
    selectWeapon(id) {
      if (!game) return false;
      const ok = game.selectWeapon(id);
      if (ok) {
        selectedWeaponId = id;
        if (!els.weaponPicker.hidden) closeWeaponPicker();
      }
      return ok;
    },
    openWeaponPicker() {
      return openWeaponPicker({ force: true });
    },
    togglePow() {
      return game?.togglePow() ?? false;
    },
    heal() {
      if (!game?.canHeal()) return false;
      return game.healPlayer();
    },
    simulate(angle, force, { wind = game?.wind.value ?? 0, index = 0, includePath = false } = {}) {
      if (!game) return null;
      const shooter = game.actors[index];
      const target = game.actors[1 - index];
      const direction = Math.sign(target.x - shooter.x) || 1;
      const muzzle = muzzlePoint(shooter, angle, direction);
      return simulateShot({
        origin: { x: muzzle.x, y: muzzle.y },
        angle,
        force,
        direction,
        wind,
        target,
        terrain: game.terrain,
        includePath,
      });
    },
    terrainSolid: (x, y) => !!game?.terrain.isSolid(x, y),
    terrainAlpha: (x, y) => game?.terrain.alphaAt(x, y) ?? null,
    terrainDisplayAlpha: (x, y) => game?.terrain.displayAlphaAt(x, y) ?? null,
    terrainMaskHash: () => game?.terrain.maskHash() ?? null,
    terrainDisplaySync: () => game?.terrain.verifyDisplaySync() ?? null,
    terrainSegmentHit: (x0, y0, x1, y1) => {
      if (!game) return null;
      return segmentTerrainHit(x0, y0, x1, y1, game.terrain, 2, 2.5);
    },
    terrainInfo: () => game?.terrain.info() ?? null,
    terrainCraters: () => game?.terrain.craters.length ?? 0,
    terrainCraterRecords: () => (game?.terrain.craters ?? []).map((c) => ({ ...c })),
    lastCraterRemoved: () => game?.lastCraterRemoved ?? null,
    carveAt(x, y, kind = 'medium') {
      if (!game) return null;
      return game.carveAt(x, y, kind);
    },
    camera: {
      clearPan: () => camera?.clearPan(),
      panBy: (x, y) => camera?.panBy(x, y),
      hasPan: () => camera?.hasManualPan() ?? false,
    },
    shotRecordScreen() {
      if (!game?.playerVolley || !view) return null;
      const record = game.playerVolley;
      const project = (point) => projectPoint(view, point.x, point.y);
      return {
        world: {
          from: { ...record.from },
          impacts: record.impacts.map((impact) => ({ ...impact })),
        },
        screen: {
          from: project(record.from),
          impacts: record.impacts.map((impact) => project(impact)),
        },
      };
    },
    minimapInfo() {
      if (!game || !view) return null;
      return {
        mapW: 280,
        mapH: 100,
        mapY: 14,
        actors: game.actors.map((actor) => ({ x: actor.x / WORLD.width * 280, y: 14 + actor.y / WORLD.height * 100 })),
        frame: {
          left: Math.max(0, Math.min(280, view.worldLeft / WORLD.width * 280)),
          top: Math.max(0, Math.min(100, view.worldTop / WORLD.height * 100)),
          right: Math.max(0, Math.min(280, (view.worldLeft + view.viewW) / WORLD.width * 280)),
          bottom: Math.max(0, Math.min(100, (view.worldTop + view.viewH) / WORLD.height * 100)),
        },
      };
    },
    audioDebug: () => sound.debug(),
    audioReset: () => sound.resetMeter(),
    audioEnable: () => sound.setEnabled(true),
    restart: restartMatch,
    modal: {
      close: closeModal,
      help: openHelp,
    },
    setPosition(actorIndex, x) {
      if (!game) return;
      game.setPosition(actorIndex, x);
    },
    isSolid: (x, y) => !!game?.terrain.isSolid(x, y),
    fullscreen: { active: isFullscreenActive, toggle: toggleFullscreen },
    ready: true,
  };
}

async function boot() {
  try {
    setViewportVariables();
    const craterArtUrls = {
      50: { shape: 'assets/crater-50.png', brink: 'assets/craterbrink-50.png' },
      401: { shape: 'assets/crater-401.png', brink: 'assets/craterbrink-401.png' },
      4: { shape: 'assets/crater-4.png', brink: 'assets/craterbrink-4.png' },
    };
    const weaponIds = ['fire', 'cannon', 'fruit', 'appliance', 'wind'];
    const [back, playerSheet, enemySheet, shell, loadedTerrain, weaponImages, projectileImages] = await Promise.all([
      loadImage('assets/map-1001-back.jpg'),
      loadImage('assets/character-player-sheet.png'),
      loadImage('assets/character-enemy-sheet.png'),
      loadImage('assets/shell-bomb.png'),
      Terrain.load({
        foregroundUrl: 'assets/map-1001-fore.png',
        craterArtUrls,
      }),
      Promise.all(weaponIds.map(async (id) => [id, await loadImage(`assets/weapon-${id}.png`)])).then(Object.fromEntries),
      Promise.all(weaponIds.map(async (id) => [id, await loadImage(`assets/projectile-${id}.png`)])).then(Object.fromEntries),
    ]);
    terrain = loadedTerrain;
    renderer = new Renderer({
      canvas: els.canvas,
      terrain,
      images: { back, playerSheet, enemySheet, shell, weapons: weaponImages, projectiles: projectileImages },
    });
    minimapBase = buildMinimapBase(back, terrain.sourceImage);
    camera = new Camera();
    const lowPower = window.matchMedia?.('(pointer: coarse)').matches
      || Math.min(window.innerWidth, window.innerHeight) < 520;
    game = new RemoteMatch({ terrain, onEvent: handleEvent, lowPower });
    await game.ready();
    setupInput();
    setupEvents();
    setupMinimap();
    exposeTestApi();
    booted = true;
    measureLayout();
    selectedWeaponId = game.weapon || selectedWeaponId;
    if (isTest) {
      els.weaponPicker.hidden = true;
    } else {
      openWeaponPicker({ force: true });
    }
    syncOrientationNotice();
    els.loading.classList.add('is-hidden');
    showToast('开局先选武器 · 1–8 选战斗道具 · 右下按住蓄力并松手发射', { duration: 5200 });
    requestAnimationFrame(frame);
  } catch (error) {
    window.__GUNNY_BOOT_ERROR__ = error?.stack || String(error);
    console.error(error);
    els.loading.classList.add('is-hidden');
    els.fatal.hidden = false;
    els.fatalText.textContent = `${error.message || error}。请确认通过 HTTP 服务打开，且 assets 目录完整。`;
  }
}

boot();
