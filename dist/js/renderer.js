/** Canvas renderer. World layers use world coordinates; HUD stays in DOM. */
import { PHYSICS, COMBAT, WORLD, COLORS } from './config.js?v=28';
import { clamp, muzzlePoint, weaponGripPoint } from './physics.js?v=28';
import { projectPoint } from './camera.js?v=28';

// SOURCE: GameCharacter.as action frame arrays. The 3×13 sheet is a frame atlas,
// not three independent suit rows: STAND/WALK/SHOWGUN/SHOT/HIT all index into it.
const ACTOR_FRAMES = {
  // Frames 6 and 7 in the sheet throw the head back / flip the face (they are
  // reaction poses, not idle). Looping them made the character's head jerk
  // upward several times a second. Idle now only cycles the calm, forward-
  // facing prone frames so the head stays steady.
  stand: [0, 8, 9, 10],
  walk: [1, 2, 3, 4, 5],
  show: [19, 20, 21],
  shot: [22, 23, 26, 27, 27],
  hit: [12, 24, 25, 38, 11],
  // SOURCE: GameCharacter.as — 开火准备动作按 BallList @ActionType 二选一：
  //   SHOWGUN    = PlayerAction("showgun",    [[19, 20, 21, 21, 21]]) 举枪
  //   SHOWTHROWS = PlayerAction("showthrows", [[28, 29, 30, 30, 30]]) 投掷
  showgun: [19, 20, 21, 21, 21],
  showthrows: [28, 29, 30, 30, 30],
};
const FIRE_ANIM_SECONDS = 0.28;
const HURT_ANIM_SECONDS = 0.5;

// One shared timeline for the whole death presentation. 倒地 -> 墓碑落下成形 ->
// 灵魂升起 -> 停留一拍 -> 结算。main.js advances each actor's `tombAge` and only
// opens the result screen once every dead actor has passed `total`, so
// simultaneous deaths wait for both tombstones and settlement can never cover
// a half-built grave. Keep every phase length here — nowhere else.
const DEATH_STONE_SECONDS = 0.45 + 0.38 + 0.47;
export const DEATH_SEQUENCE = Object.freeze({
  collapse: 0.45,
  drop: 0.38,
  form: 0.47,
  soulDelay: DEATH_STONE_SECONDS,
  soulRise: 1.05,
  hold: 0.55,
  total: DEATH_STONE_SECONDS + 1.05 + 0.55,
});

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function ellipseShadow(ctx, x, y, width, alpha = 0.26) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#0a2b3a';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, width / 2, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A plain 2D surface used for one-time asset baking. Kept local to the renderer
// so the baked sprites can be blitted with drawImage instead of rebuilding a
// gradient every frame (the same "bake once, reuse" idea as the reference game).
function makeSurface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export class Renderer {
  constructor({ canvas, terrain, images }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.terrain = terrain;
    this.images = images;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.lastView = null;
    this.hintBoxes = [];
    this._skyGradient = null;
    this._skyGradientHeight = 0;
    this._overlayCanvas = null;
    this._glowSprite = null;
  }

  resize(width, height, dpr) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // Sky gradient only depends on height; cache it instead of allocating a
    // fresh CanvasGradient every frame (that churn shows up on mobile GPUs).
    this._skyGradient = null;
    // Limit DPR on phones/tablets: a 4000 px world with chunk canvases does
    // not need 3× backing-store pixels.
    this.dpr = Math.max(1, Math.min(2, dpr || 1));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    // Full-screen finish (vignette + bottom shade) and the muzzle glow are
    // static; bake them once per resize instead of rebuilding gradients in the
    // per-frame hot path. Redrawing here keeps them correct after a rotate.
    this._bakeOverlay();
    this._bakeGlow();
  }

  _bakeOverlay() {
    const { width, height } = this;
    const surface = makeSurface(width, height);
    const ctx = surface.getContext('2d');
    const vignette = ctx.createRadialGradient(
      width / 2, height * 0.48, Math.min(width, height) * 0.2,
      width / 2, height * 0.48, Math.max(width, height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(8,38,52,0)');
    vignette.addColorStop(1, 'rgba(3,23,34,0.3)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const bottom = ctx.createLinearGradient(0, height * 0.72, 0, height);
    bottom.addColorStop(0, 'rgba(3,24,35,0)');
    bottom.addColorStop(1, 'rgba(3,20,30,0.2)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, height * 0.72, width, height * 0.28);
    this._overlayCanvas = surface;
  }

  _bakeGlow() {
    const radius = 62;
    const size = radius * 2;
    const surface = makeSurface(size, size);
    const ctx = surface.getContext('2d');
    const glow = ctx.createRadialGradient(radius, radius, 4, radius, radius, radius);
    glow.addColorStop(0, 'rgba(255,255,235,0.9)');
    glow.addColorStop(1, 'rgba(255,255,235,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.fill();
    this._glowSprite = surface;
  }

  draw(game, view, reducedMotion = false) {
    const ctx = this.ctx;
    const { width, height, dpr } = this;
    this.lastView = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    if (!this._skyGradient || this._skyGradientHeight !== height) {
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#8fd7ef');
      sky.addColorStop(0.52, '#b7dfe1');
      sky.addColorStop(1, '#edcda9');
      this._skyGradient = sky;
      this._skyGradientHeight = height;
    }
    ctx.fillStyle = this._skyGradient;
    ctx.fillRect(0, 0, width, height);

    const shake = game.effects.shake || 0;
    const t = game.visualTime ?? game.time;
    const sx = reducedMotion ? 0 : Math.sin(t * 91) * shake * 8;
    const sy = reducedMotion ? 0 : Math.cos(t * 73) * shake * 5;

    ctx.save();
    ctx.translate(view.left + sx, view.top + sy);
    ctx.scale(view.zoom, view.zoom);

    this._drawBackground(ctx, view);
    this._drawWind(ctx, game, view);
    this.terrain.draw(ctx, view);
    this.terrain.drawDead(ctx, view);
    this._drawAimGuide(ctx, game, view);

    game.actors.forEach((actor) => this._drawActor(ctx, game, actor));
    this._drawShots(ctx, game);
    this._drawMuzzle(ctx, game);
    this._drawHeal(ctx, game);
    this._drawParticles(ctx, game.effects.particles);

    ctx.restore();

    this._drawActorLabels(ctx, game, view);
    this._drawShotRecords(ctx, game, view);
    this._drawFloats(ctx, game, view);
    this._drawOffscreenHints(ctx, game, view);
    this._drawScreenFinish(ctx, width, height, game);
  }

  _drawBackground(ctx, view) {
    const back = this.images.back;
    const tileW = back.naturalWidth || back.width;
    const tileH = back.naturalHeight || back.height;
    const worldRight = Math.min(WORLD.width, view.worldLeft + view.viewW + 2);
    const startIndex = Math.max(0, Math.floor(view.worldLeft / tileW));
    const endIndex = Math.min(Math.ceil(WORLD.width / tileW), Math.ceil(worldRight / tileW) + 1);
    for (let i = startIndex; i < endIndex; i += 1) {
      const x = i * tileW;
      if (x > worldRight || x + tileW < view.worldLeft - 2) continue;
      ctx.save();
      if (i % 2 === 1) {
        ctx.translate(x + tileW, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(x, 0);
      }
      ctx.drawImage(back, 0, 0, tileW, Math.min(tileH, WORLD.height));
      ctx.restore();
    }
    // A little deep-water/ground tone below the original image if a device
    // ever exposes the last few pixels at the bottom.
    if (tileH < WORLD.height) {
      ctx.fillStyle = '#7a5a3d';
      ctx.fillRect(view.worldLeft, tileH, Math.min(view.viewW, WORLD.width - view.worldLeft), WORLD.height - tileH);
    }
  }

  _drawWind(ctx, game, view) {
    const w = game.wind.value;
    const magnitude = Math.abs(w);
    const dir = Math.sign(w) || 1;
    const count = 14;
    const left = Math.max(0, view.worldLeft - 80);
    const right = Math.min(WORLD.width, view.worldLeft + view.viewW + 80);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    for (let i = 0; i < count; i += 1) {
      const speed = 8 + magnitude * 16;
      const span = Math.max(1, right - left + 180);
      const visualTime = game.visualTime ?? game.time;
      const x = left + ((i * 277 + visualTime * speed * dir) % span + span) % span;
      const y = 245 + (i % 7) * 83 + Math.sin(i * 2.1) * 22;
      const length = 20 + magnitude * 18 + (i % 3) * 5;
      ctx.globalAlpha = 0.07 + Math.min(0.1, magnitude * 0.026);
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + length * 0.5 * dir, y - 7, x + length * dir, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _weaponVisible(game, actor) {
    if (!actor.alive) return false;
    if ((actor.fireTimer || 0) > 0) return true;
    if (actor.index === 0) return !!game.charging;
    return game.turn === 1 && ['enemy_think', 'enemy_aim'].includes(game.phase);
  }

  poseForActor(game, actor) {
    return {
      frame: this._frameForActor(game, actor),
      weaponVisible: this._weaponVisible(game, actor),
    };
  }

  // SOURCE: PrepareShootAction.doPrepareToShootAction() —
  //   _actionType = ball.ActionType == 0 ? GameCharacter.SHOWTHROWS
  //                                       : GameCharacter.SHOWGUN;
  // 枪炮类（弓箭/AK/黄金枪/轰天/雷霆/马桶）开火举枪 SHOWGUN；投掷类
  // （石斧/风神/烈火/司马砸缸/水果篮/手术刀/黑白家电）开火抡臂 SHOWTHROWS。
  // POW 大招按 Special 弹自己的 ActionType（数据上与普通弹一致）。
  _fireFrames(game, actor) {
    const def = game.weapons?.find((w) => w.id === actor.weapon);
    if (!def) return ACTOR_FRAMES.shot;
    const pow = !!(game.shot && game.shot.owner === actor.index && game.shot.pow);
    const actionType = pow ? def.specialActionType : def.actionType;
    return actionType === 0 ? ACTOR_FRAMES.showthrows : ACTOR_FRAMES.showgun;
  }

  _frameForActor(game, actor) {
    if ((actor.hurtTimer || 0) > 0) {
      const progress = clamp(1 - actor.hurtTimer / HURT_ANIM_SECONDS, 0, 0.999);
      return ACTOR_FRAMES.hit[Math.floor(progress * ACTOR_FRAMES.hit.length)];
    }
    if ((actor.fireTimer || 0) > 0) {
      const progress = clamp(1 - actor.fireTimer / FIRE_ANIM_SECONDS, 0, 0.999);
      const frames = this._fireFrames(game, actor);
      return frames[Math.floor(progress * frames.length)];
    }
    if (actor.walkDirection) {
      const phase = actor.walkPhase ?? actor.walkTime ?? 0;
      return ACTOR_FRAMES.walk[Math.floor(phase * 7.2) % ACTOR_FRAMES.walk.length];
    }
    // SOURCE: PrepareShootAction plays SHOWGUN while the weapon is raised.
    if (actor.index === 0 && game.charging) {
      const progress = clamp((game.chargeElapsed || 0) / 0.16, 0, 0.999);
      return ACTOR_FRAMES.show[Math.floor(progress * ACTOR_FRAMES.show.length)];
    }
    if (actor.index === 1 && this._weaponVisible(game, actor)) {
      const t = game.visualTime ?? game.time ?? 0;
      return ACTOR_FRAMES.show[Math.floor(t * 10) % ACTOR_FRAMES.show.length];
    }
    // SOURCE: GameCharacter.as STAND includes 0,6,7,8,9,10, but frames 6/7
    // throw the head back and read as a reaction, not idle. Loop the calm
    // forward-facing frames instead; frame 0 has the weapon stowed on the back.
    const t = game.visualTime ?? game.time ?? 0;
    const index = Math.floor(t * 5 + actor.index * 2) % ACTOR_FRAMES.stand.length;
    return ACTOR_FRAMES.stand[index];
  }

  // SOURCE: GamePlayer death handler creates a TombView at the death spot and
  // lifts the player to y-70 in the SOUL/SOUL_MOVE state; GhostMoveAction then
  // drifts the soul upward. Here the whole presentation is a single timeline
  // driven by `actor.tombAge` (stamped by main.js from DEATH_SEQUENCE):
  //   倒地 -> 墓碑落下并刻好 -> 灵魂升起 -> 停留一拍.
  // Nothing loops and nothing depends on wall-clock time, so the animation is
  // deterministic and the settlement gate can measure exactly when it ends.
  _drawTombAndSoul(ctx, game, actor, x, y) {
    const D = DEATH_SEQUENCE;
    const age = Math.max(0, Number.isFinite(actor.tombAge) ? actor.tombAge : 0);
    const stoneStart = D.collapse;
    const landed = stoneStart + D.drop;
    const direction = Math.sign(actor.facing) || 1;

    // 1) 倒地: the body topples around its feet and settles before the stone.
    if (age < stoneStart) {
      const p = clamp(age / D.collapse, 0, 1);
      const ease = p * p * (3 - 2 * p);
      const scale = COMBAT.characterScale;
      const frame = ACTOR_FRAMES.hit[ACTOR_FRAMES.hit.length - 1];
      const sheet = actor.index === 0 ? this.images.playerSheet : this.images.enemySheet;
      ellipseShadow(ctx, x, y, 82, 0.24 - ease * 0.07);
      ctx.save();
      ctx.globalAlpha = 1 - ease * 0.4;
      ctx.translate(x + direction * ease * 12, y - ease * 5);
      ctx.rotate(direction * ease * 1.3);
      ctx.scale(direction * scale, scale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        sheet,
        (frame % 13) * COMBAT.characterFrameWidth,
        Math.floor(frame / 13) * COMBAT.characterFrameHeight,
        COMBAT.characterFrameWidth, COMBAT.characterFrameHeight,
        -COMBAT.characterFrameWidth / 2, -COMBAT.characterAnchorY,
        COMBAT.characterFrameWidth, COMBAT.characterFrameHeight,
      );
      ctx.restore();
      return;
    }

    const dropP = clamp((age - stoneStart) / D.drop, 0, 1);
    const dropEase = 1 - Math.pow(1 - dropP, 3);
    const sinceLand = age - landed;
    // A single damped hop when the stone hits the ground; purely decorative.
    const bounce = sinceLand > 0 && sinceLand < 0.24
      ? Math.sin((sinceLand / 0.24) * Math.PI) * 9 * (1 - sinceLand / 0.24)
      : 0;
    const formP = clamp(sinceLand / D.form, 0, 1);
    const moundP = clamp(age / landed, 0, 1);

    ctx.save();
    ctx.translate(x, y);

    // 2) 墓碑: soil mound rises while the stone falls from above.
    ctx.fillStyle = 'rgba(6,20,28,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 32 + 4 * moundP, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5b4632';
    ctx.beginPath();
    ctx.ellipse(0, 2, 26 + 6 * moundP, 6 + 4 * moundP, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dust ring kicked up by the landing.
    if (sinceLand >= 0 && sinceLand < 0.5) {
      const dp = sinceLand / 0.5;
      ctx.save();
      ctx.globalAlpha = (1 - dp) * 0.5;
      ctx.strokeStyle = 'rgba(214,232,214,0.9)';
      ctx.lineWidth = 1 + 3 * (1 - dp);
      ctx.beginPath();
      ctx.ellipse(0, 1, 22 + dp * 48, 6 + dp * 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(0, -(1 - dropEase) * 84 + bounce);
    ctx.globalAlpha = clamp(dropP * 4, 0, 1);
    // stone slab
    ctx.fillStyle = '#7d8a8f';
    ctx.strokeStyle = '#3c4a50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-18, -30);
    ctx.arc(0, -30, 18, Math.PI, 0);
    ctx.lineTo(18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // bevel highlight reveals as the stone settles
    if (formP > 0) {
      ctx.save();
      ctx.globalAlpha *= formP;
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.lineTo(-14, -30);
      ctx.arc(-2, -30, 12, Math.PI, 0);
      ctx.lineTo(10, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // carved cross, engraved from the centre outwards
      const cross = 0.25 + formP * 0.75;
      ctx.strokeStyle = '#e9f2f4';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(0, -39); ctx.lineTo(0, -39 + 21 * cross);
      ctx.moveTo(-8 * cross, -32); ctx.lineTo(8 * cross, -32);
      ctx.stroke();
    }
    ctx.restore();

    // Engraving glint right before the soul leaves the body.
    if (age >= D.soulDelay - 0.3 && age < D.soulDelay + 0.15) {
      const gp = clamp((age - (D.soulDelay - 0.3)) / 0.45, 0, 1);
      ctx.save();
      ctx.globalAlpha = Math.sin(gp * Math.PI) * 0.8;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(220,250,255,0.95)';
      ctx.lineWidth = 1.6;
      const s = 3 + gp * 7;
      ctx.beginPath();
      ctx.moveTo(-s, -32); ctx.lineTo(s, -32);
      ctx.moveTo(0, -32 - s); ctx.lineTo(0, -32 + s);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // 3) 灵魂: rises once after the stone is complete, then fades. The hold
    // phase (last `hold` seconds) is the quiet beat before settlement.
    if (age < D.soulDelay) return;
    const pS = clamp((age - D.soulDelay) / D.soulRise, 0, 1);
    const riseEase = 1 - Math.pow(1 - pS, 2);
    const rise = 26 + riseEase * 108;
    const sway = Math.sin(pS * Math.PI * 2 + actor.index) * 5;
    const fadeOut = clamp((pS - 0.7) / 0.3, 0, 1);
    const alpha = Math.min(1, pS / 0.15) * (1 - fadeOut);
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha) * 0.55;
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x + sway, y - rise);
    // halo
    const halo = ctx.createRadialGradient(0, -18, 4, 0, -18, 40);
    halo.addColorStop(0, 'rgba(180,240,255,0.55)');
    halo.addColorStop(1, 'rgba(180,240,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, -18, 40, 0, Math.PI * 2);
    ctx.fill();
    // ghost body (rounded head + tapered tail)
    ctx.fillStyle = 'rgba(198,244,255,0.85)';
    ctx.beginPath();
    ctx.arc(0, -30, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-12, -26);
    ctx.quadraticCurveTo(-16, 4, -6, 12);
    ctx.quadraticCurveTo(0, 4, 4, 12);
    ctx.quadraticCurveTo(12, 6, 12, -26);
    ctx.closePath();
    ctx.fill();
    // eyes
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(30,80,110,0.85)';
    ctx.beginPath(); ctx.arc(-4.5, -31, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4.5, -31, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  _drawActor(ctx, game, actor) {
    const x = actor.renderX ?? actor.x;
    const y = actor.renderY ?? actor.y;
    if (!actor.alive) {
      this._drawTombAndSoul(ctx, game, actor, x, y);
      return;
    }
    const opponent = game.actors[1 - actor.index];
    const direction = actor.walkDirection
      ? (Math.sign(actor.facing) || 1)
      : (Math.sign(opponent.x - actor.x) || Math.sign(actor.facing) || 1);
    const theme = actor.index === 0 ? COLORS.player : COLORS.enemy;
    const aim = actor.index === 0 ? game.angle : (actor.aimAngle || game.enemyAimAngle || 45);
    const slope = actor.falling ? 0 : (actor.slope || 0) * Math.PI / 180;
    const visualTime = game.visualTime ?? game.time ?? 0;
    const walkPhase = actor.walkPhase ?? actor.walkTime ?? 0;
    const walkWave = actor.walkDirection ? Math.sin(walkPhase * 7.2) : 0;
    const bob = actor.walkDirection
      ? Math.abs(walkWave) * 2.2
      : Math.sin(visualTime * 2.1 + actor.index * 1.7) * 0.7;
    // A short backward kick while the SHOT frames play; it decays before the
    // next turn so the prone sprite never drifts away from its terrain anchor.
    const fireProgress = (actor.fireTimer || 0) > 0
      ? clamp(1 - actor.fireTimer / FIRE_ANIM_SECONDS, 0, 1)
      : 1;
    const recoil = (actor.fireTimer || 0) > 0
      ? -direction * Math.sin(Math.min(1, fireProgress * 2.2) * Math.PI) * 5
      : 0;
    const visualX = x + recoil;
    const visualY = y + bob;
    const scale = COMBAT.characterScale;
    const frame = this._frameForActor(game, actor);
    const sx = (frame % 13) * COMBAT.characterFrameWidth;
    const sy = Math.floor(frame / 13) * COMBAT.characterFrameHeight;
    const shadowW = 82 + Math.abs(walkWave) * 8;

    if (actor.grounded !== false && !actor.falling) {
      ctx.save();
      ctx.translate(x, y + 1);
      ctx.rotate(slope);
      ellipseShadow(ctx, 0, 0, shadowW, actor.alive ? 0.28 : 0.12);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = actor.alive ? 1 : 0.35;

    // Prone combat avatar from the original 3×13 GameCharacter sheet. The
    // STAND frames already contain the stowed weapon on the back.
    ctx.save();
    ctx.translate(visualX, visualY);
    ctx.rotate(slope + walkWave * 0.012);
    ctx.scale(direction, 1);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    const sheet = actor.index === 0 ? this.images.playerSheet : this.images.enemySheet;
    ctx.drawImage(
      sheet,
      sx, sy, COMBAT.characterFrameWidth, COMBAT.characterFrameHeight,
      -COMBAT.characterFrameWidth / 2, -COMBAT.characterAnchorY,
      COMBAT.characterFrameWidth, COMBAT.characterFrameHeight,
    );
    ctx.restore();

    // SOURCE: GamePlayer adds weaponMovie after the body, so the held weapon is
    // in front. It is only visible for SHOWGUN/SHOT, never during STAND.
    if (actor.alive && this._weaponVisible(game, actor)) {
      const grip = weaponGripPoint(
        { ...actor, x: visualX, y: visualY, slope: actor.falling ? 0 : actor.slope },
        direction,
        COMBAT,
      );
      ctx.save();
      ctx.translate(grip.x, grip.y);
      ctx.scale(direction, 1);
      ctx.rotate(-(aim - COMBAT.weaponArtAngle) * Math.PI / 180);
      ctx.imageSmoothingEnabled = false;
      const ws = COMBAT.weaponDrawScale;
      const weaponImage = this.images.weapons?.[actor.weapon]
        || this.images.weapons?.fruit
        || this.images.weapon;
      ctx.globalAlpha = 0.98;
      ctx.drawImage(
        weaponImage,
        -COMBAT.weaponPivotX * ws,
        -COMBAT.weaponPivotY * ws,
        78 * ws,
        78 * ws,
      );
      ctx.restore();
    }

    if (actor.flash > 0 && this._glowSprite) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.45, actor.flash * 0.5);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this._glowSprite, visualX - 62, visualY - 32 - 62, 124, 124);
      ctx.restore();
    }

    if (game.charging && actor.index === 0) {
      const pct = game.force / PHYSICS.forceMax;
      ctx.save();
      ctx.globalAlpha = 0.24 + Math.sin(visualTime * 12) * 0.06;
      ctx.strokeStyle = theme;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(visualX, visualY - 38, 58 + pct * 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawActorLabels(ctx, game, view) {
    const width = this.width;
    const labelWidth = clamp(width * 0.14, 72, 104);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const actor of game.actors) {
      const projected = projectPoint(view, actor.renderX ?? actor.x, (actor.renderY ?? actor.y) - 112);
      if (projected.x < -labelWidth || projected.x > width + labelWidth) continue;
      if (projected.y < -40 || projected.y > this.height + 30) continue;
      const x = clamp(projected.x, labelWidth / 2 + 8, width - labelWidth / 2 - 8);
      const barY = clamp(projected.y, 54, this.height - 112);
      const theme = actor.index === 0 ? COLORS.player : COLORS.enemy;
      const isActive = game.turn === actor.index
        && ['player', 'enemy_move', 'enemy_think', 'enemy_aim'].includes(game.phase);
      const hpRatio = clamp(actor.hp / actor.maxHp, 0, 1);

      if (isActive && actor.alive) {
        const bounce = Math.sin(game.time * 5) * 3;
        ctx.save();
        ctx.translate(x, barY - 28 + bounce);
        ctx.fillStyle = theme;
        ctx.strokeStyle = 'rgba(4,25,34,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(7, 0);
        ctx.lineTo(0, 8);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();
      }

      ctx.font = '800 10px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(3,24,34,0.82)';
      ctx.strokeText(actor.name, x, barY);
      ctx.fillStyle = actor.alive ? '#f6feff' : '#9fb5bd';
      ctx.fillText(actor.name, x, barY);

      ctx.fillStyle = 'rgba(3,24,34,0.66)';
      roundedRect(ctx, x - labelWidth / 2 - 2, barY + 6, labelWidth + 4, 7, 3.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundedRect(ctx, x - labelWidth / 2, barY + 8, labelWidth, 3, 1.5);
      ctx.fill();
      if (hpRatio > 0) {
        ctx.fillStyle = theme;
        roundedRect(ctx, x - labelWidth / 2, barY + 8, labelWidth * hpRatio, 3, 1.5);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawAimGuide(ctx, game, view) {
    if (!game || game.phase !== 'player' || game.shot || game.player?.falling) return;
    const actor = game.player;
    const visualActor = {
      ...actor,
      x: actor.renderX ?? actor.x,
      y: actor.renderY ?? actor.y,
    };
    const direction = Math.sign(game.enemy.x - actor.x) || 1;
    const angle = game.angle * Math.PI / 180;
    const muzzle = muzzlePoint(visualActor, game.angle, direction);
    const screenLength = game.charging ? 58 : 44;
    const length = screenLength / view.zoom;
    const wedge = 6.5 * Math.PI / 180;
    const x0 = muzzle.x;
    const y0 = muzzle.y;
    const x1 = x0 + direction * Math.cos(angle) * length;
    const y1 = y0 - Math.sin(angle) * length;
    const wx1 = x0 + direction * Math.cos(angle - wedge) * (length * 0.46);
    const wy1 = y0 - Math.sin(angle - wedge) * (length * 0.46);
    const wx2 = x0 + direction * Math.cos(angle + wedge) * (length * 0.46);
    const wy2 = y0 - Math.sin(angle + wedge) * (length * 0.46);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,210,106,0.13)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(wx1, wy1);
    ctx.lineTo(wx2, wy2);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,226,148,0.9)';
    ctx.lineWidth = 2.1 / view.zoom;
    ctx.setLineDash([5 / view.zoom, 5 / view.zoom]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,236,178,0.95)';
    ctx.beginPath();
    ctx.arc(x1, y1, 2.6 / view.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawShots(ctx, game) {
    const shots = game.shots?.length ? game.shots : (game.shot ? [game.shot] : []);
    for (const shot of shots) {
      if (!shot?.alive) continue;
      this._drawShot(ctx, game, shot);
    }
  }

  _drawShot(ctx, game, shot) {
    if (!shot) return;
    // RemoteMatch dead-reckons the shell from the newest authoritative sample
    // with x+v*t+0.5*a*t². This keeps the 60/120 Hz render smooth while the
    // server still owns collision and damage at 25 Hz snapshots.
    const x = shot.renderX ?? shot.x;
    const y = shot.renderY ?? shot.y;
    const trail = (shot.trail || []).slice(-8);
    const tints = {
      axe: '255,178,92', bow: '255,222,137', gun: '255,196,112', goldgun: '255,215,96',
      fire: '255,157,68', cannon: '207,220,238', wind: '220,245,255',
      thunder: '150,203,255', brick: '255,143,86', fruit: '255,213,117',
      scalpel: '209,247,255', toilet: '255,230,176', appliance: '143,218,255',
    };
    const tint = tints[shot.weapon] || '255,225,142';

    ctx.save();
    ctx.lineCap = 'round';
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i += 1) {
        const q = i / trail.length;
        ctx.strokeStyle = `rgba(${tint},${0.06 + q * 0.3})`;
        ctx.lineWidth = 3.5 + q * 5;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      const last = trail[trail.length - 1];
      ctx.strokeStyle = `rgba(255,255,255,${shot.weapon === 'cannon' ? 0.45 : 0.8})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    // SOURCE: BallList.xml Amount=3 的大招弹换专属弹体（411 榴莲 / 171 烈火 /
    // 151 雷霆 / 371 马桶），其余大招沿用该武器普通弹体；carry 弹是纸飞机。
    const POW_PROJECTILES = {
      fruit: 'fruit-pow', fire: 'fire-pow', thunder: 'thunder-pow', toilet: 'toilet-pow',
    };
    const ammoKey = shot.carry ? 'carry'
      : (shot.pow && POW_PROJECTILES[shot.weapon]) ? POW_PROJECTILES[shot.weapon]
      : shot.weapon;
    const image = this.images.projectiles?.[ammoKey] || this.images.projectiles?.[shot.weapon] || this.images.shell;
    // Draw shells at a uniform fraction of their ORIGINAL art instead of
    // stretching every weapon to a fixed ~70 px. The old rule blew small
    // shells (e.g. 27 px cannon / 轰天) up to 64–78 px and looked oversized.
    const natW = image.naturalWidth || image.width || 32;
    const natH = image.naturalHeight || image.height || 32;
    const AMMO_SCALE = 0.82, AMMO_MAX = 52, AMMO_MIN = 24;
    let drawW = natW * AMMO_SCALE;
    let drawH = natH * AMMO_SCALE;
    const longest = Math.max(drawW, drawH);
    if (longest > AMMO_MAX) { const k = AMMO_MAX / longest; drawW *= k; drawH *= k; }
    else if (longest < AMMO_MIN) { const k = AMMO_MIN / longest; drawW *= k; drawH *= k; }
    const heading = Math.atan2(shot.vy || 0, shot.vx || shot.direction || 1);
    const spin = shot.weapon === 'fruit' ? (game.visualTime ?? game.time) * 4.2 * Math.sign(shot.direction || 1)
      : shot.weapon === 'brick' ? (game.visualTime ?? game.time) * 3.4 * Math.sign(shot.direction || 1) : 0;
    ctx.translate(x, y);
    ctx.rotate(heading + spin);
    ctx.shadowColor = `rgba(${tint},0.9)`;
    ctx.shadowBlur = 14;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  _drawMuzzle(ctx, game) {
    for (const m of game.effects.muzzle) {
      const alpha = m.life / m.maxLife;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.scale(m.direction, 1);
      ctx.rotate(-m.angle * Math.PI / 180);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = '#fff5bf';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(22 + (1 - alpha) * 18, -10);
      ctx.lineTo(15, 0);
      ctx.lineTo(22 + (1 - alpha) * 18, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffb43f';
      ctx.beginPath();
      ctx.arc(0, 0, 7 + (1 - alpha) * 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawHeal(ctx, game) {
    for (const h of game.effects.heal || []) {
      const t = 1 - h.life / h.maxLife;
      const alpha = clamp(h.life / h.maxLife, 0, 1);
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#86ffab';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 18 + t * 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = '#6dff9c';
      ctx.beginPath();
      ctx.arc(0, 0, 12 + t * 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = '#d8ffe2';
      ctx.font = '900 26px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', 0, -34 - t * 18);
      ctx.restore();
    }
  }

  _drawParticles(ctx, particles) {
    ctx.save();
    for (const p of particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = p.smoke ? alpha * 0.58 : alpha;
      ctx.fillStyle = p.color;
      if (p.shape === 'rock') {
        const r = p.size * (0.7 + alpha * 0.3);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.x * 0.17 + p.y * 0.11);
        ctx.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
        ctx.restore();
      } else if (p.shape === 'dirt') {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * (0.8 + alpha * 0.5), p.size * 0.65, 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.smoke ? 1 : 0.6 + alpha * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawShotRecords(ctx, game, view) {
    const record = game.playerVolley;
    if (!record?.from) return;
    const drawPin = (point, color, label, filled) => {
      const p = projectPoint(view, point.x, point.y);
      if (p.x < -60 || p.x > this.width + 60 || p.y < -40 || p.y > this.height + 40) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(p.x, p.y, filled ? 6 : 5, 0, Math.PI * 2);
      ctx.stroke();
      if (filled) {
        ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y - 17);
      ctx.stroke();
      ctx.fillStyle = 'rgba(4,25,34,0.88)';
      roundedRect(ctx, p.x - 10, p.y - 28, 20, 13, 5);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = '800 9px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p.x, p.y - 21);
      ctx.restore();
    };

    drawPin(record.from, '#8de9ff', '起', false);
    for (const impact of record.impacts || []) {
      drawPin(impact, impact.type === 'out' ? '#ffb38b' : '#ffd36a', '落', true);
    }
  }

  _drawFloats(ctx, game, view) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of game.effects.floats) {
      const point = projectPoint(view, f.x, f.y);
      if (point.x < -50 || point.x > this.width + 50 || point.y < -30 || point.y > this.height + 30) continue;
      const alpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = Math.min(1, alpha * 1.8);
      // SOURCE: a critical is drawn as a second, larger damage number.
      const size = f.size || 22;
      ctx.font = `${f.weight || 800} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.lineWidth = size > 22 ? 6 : 5;
      ctx.strokeStyle = 'rgba(4,26,36,0.82)';
      ctx.strokeText(f.text, point.x, point.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, point.x, point.y);
    }
    ctx.restore();
  }

  _drawOffscreenHints(ctx, game, view) {
    const width = this.width;
    const height = this.height;
    this.hintBoxes = [];
    // During flight both actors may legitimately leave the frame; the minimap
    // carries that information. Direction hints are only for a panned aim view.
    if (game.phase === 'flight' || game.phase === 'resolve' || game.phase === 'over') return;
    const margin = 24;
    const bottomSafe = Math.max(120, height - 108);
    // Keep the hint in a dedicated lane between the top HUD/utility buttons
    // and the right-side aim cluster. It must never cover a control.
    const hintY = Math.min(106, bottomSafe);
    const hints = { left: null, right: null };

    const consider = (hint) => {
      const side = hint.p.x < width / 2 ? 'left' : 'right';
      // Shot focus has priority; opponent next; the player last.
      const rank = hint.kind === 'shot' ? 3 : hint.kind === 'enemy' ? 2 : 1;
      if (!hints[side] || rank > hints[side].rank) hints[side] = { ...hint, side, rank };
    };

    for (const actor of game.actors) {
      if (!actor?.alive) continue;
      const p = projectPoint(view, actor.x, actor.y - 50);
      if (p.x < margin || p.x > width - margin || p.y < 54 || p.y > height - 96) {
        consider({
          p,
          kind: actor.index === 0 ? 'player' : 'enemy',
          color: actor.index === 0 ? COLORS.player : COLORS.enemy,
          label: actor.index === 0 ? '你' : `对手 ${Math.round(game.metrics().horizontal)}m`,
        });
      }
    }
    if (game.shot) {
      const p = projectPoint(view, game.shot.x, game.shot.y);
      if (p.x < margin || p.x > width - margin || p.y < 54 || p.y > height - 96) {
        consider({ p, kind: 'shot', color: COLORS.gold, label: '炮弹' });
      }
    }

    ctx.save();
    for (const side of ['left', 'right']) {
      const hint = hints[side];
      if (!hint) continue;
      const onLeft = side === 'left';
      const x = onLeft ? 13 : width - 13;
      const y = hintY;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(onLeft ? 1 : -1, 1);
      ctx.fillStyle = hint.color;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(13, -8);
      ctx.lineTo(13, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.font = '700 10px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = onLeft ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const textW = ctx.measureText(hint.label).width;
      const boxW = textW + 12;
      const boxX = onLeft ? x + 17 : x - 17 - boxW;
      const boxY = y - 8;
      ctx.fillStyle = 'rgba(5,26,35,0.70)';
      roundedRect(ctx, boxX, boxY, boxW, 16, 8);
      ctx.fill();
      ctx.fillStyle = hint.color;
      ctx.fillText(hint.label, onLeft ? boxX + 6 : boxX + boxW - 6, y);
      const arrowX0 = onLeft ? x : x - 13;
      const arrowX1 = onLeft ? x + 13 : x;
      const box0 = Math.min(boxX, arrowX0) - 1;
      const box1 = Math.max(boxX + boxW, arrowX1) + 1;
      this.hintBoxes.push({
        side, kind: hint.kind, label: hint.label,
        x: box0, y: boxY, width: box1 - box0, height: 16,
      });
    }
    ctx.restore();
  }

  _drawScreenFinish(ctx, width, height, game) {
    // Pre-baked in resize(); one blit replaces two gradient allocations/frame.
    if (this._overlayCanvas) ctx.drawImage(this._overlayCanvas, 0, 0, width, height);

    if (game.effects.flash > 0) {
      ctx.fillStyle = `rgba(255,240,200,${game.effects.flash * 0.25})`;
      ctx.fillRect(0, 0, width, height);
    }
  }
}
