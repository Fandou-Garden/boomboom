/**
 * Pointer + keyboard controls.
 * Holds are tracked by source, so two fingers may move and aim at once.
 * Cancellation never launches a shot.
 */
const MOVE_KEYS = new Map([
  ['ArrowLeft', 'left'], ['a', 'left'], ['A', 'left'],
  ['ArrowRight', 'right'], ['d', 'right'], ['D', 'right'],
]);
const AIM_KEYS = new Map([
  ['ArrowUp', 'up'], ['w', 'up'], ['W', 'up'],
  ['ArrowDown', 'down'], ['s', 'down'], ['S', 'down'],
]);

export class InputController {
  constructor({
    root,
    fireButton,
    moveButtons,
    aimButtons,
    onChargeStart = () => {},
    onChargeRelease = () => {},
    onChargeCancel = () => {},
    onAngleTap = () => {},
    onAngleScrub = () => {},
    onChargeScrub = () => {},
    onAbort = () => {},
    onSkillSlot = () => {},
    onPowShortcut = () => {},
    onHealShortcut = () => {},
    onUserGesture = () => {},
    canAcceptInput = () => true,
    angleScrubSurface = null,
  }) {
    this.root = root;
    this.fireButton = fireButton;
    this.moveButtons = moveButtons;
    this.aimButtons = aimButtons;
    this.onChargeStart = onChargeStart;
    this.onChargeRelease = onChargeRelease;
    this.onChargeCancel = onChargeCancel;
    this.onAngleTap = onAngleTap;
    this.onAngleScrub = onAngleScrub;
    this.onChargeScrub = onChargeScrub;
    this.onAbort = onAbort;
    this.onSkillSlot = onSkillSlot;
    this.onPowShortcut = onPowShortcut;
    this.onHealShortcut = onHealShortcut;
    this.onUserGesture = onUserGesture;
    this.canAcceptInput = canAcceptInput;
    this.angleScrubSurface = angleScrubSurface;
    this.sources = new Map();
    this.activePointers = new Map();
    this.angleDrag = null;
    this.firePointer = null;
    this.spaceDown = false;
    this._bound = false;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;

    for (const button of [...this.moveButtons, ...this.aimButtons]) {
      button.addEventListener('pointerdown', (event) => this._holdPointerDown(event, button));
      button.addEventListener('lostpointercapture', (event) => {
        if (this.activePointers.get(event.pointerId)?.pointerType === 'hold') {
          this._clearPointer(event.pointerId, true);
        }
      });
      button.addEventListener('click', (event) => {
        if (event.detail !== 0) return;
        const action = button.dataset.hold;
        if (action === 'up' || action === 'down') {
          this.onAngleTap(action === 'up' ? 1 : -1);
        }
      });
    }

    if (this.angleScrubSurface) {
      this.angleScrubSurface.addEventListener('pointerdown', (event) => this._anglePointerDown(event));
      this.angleScrubSurface.addEventListener('lostpointercapture', (event) => this._endAngleDrag(event.pointerId));
    }

    this.fireButton.addEventListener('pointerdown', (event) => this._firePointerDown(event));
    this.fireButton.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId === this.firePointer) this._clearPointer(event.pointerId, true);
    });

    window.addEventListener('pointerup', (event) => {
      this._endAngleDrag(event.pointerId);
      this._clearPointer(event.pointerId, false);
    }, { passive: false });
    window.addEventListener('pointercancel', (event) => {
      this._endAngleDrag(event.pointerId);
      this._clearPointer(event.pointerId, true);
    }, { passive: false });
    // Touch pointers emit pointermove even when a finger slides slightly.
    // Keep the hold alive and suppress native scrolling/selection side effects.
    // Mouse pointers can scrub angle (over the readout) and power (on fire).
    window.addEventListener('pointermove', (event) => this._pointerMove(event), { passive: false });
    window.addEventListener('keydown', (event) => this._keyDown(event), { passive: false });
    window.addEventListener('keyup', (event) => this._keyUp(event), { passive: false });
    window.addEventListener('blur', () => this.cancelAll('blur'));
    window.addEventListener('pagehide', () => this.cancelAll('pagehide'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancelAll('hidden');
    });
    window.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  _holdPointerDown(event, button) {
    if (!this.canAcceptInput()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const action = button.dataset.hold;
    try { button.setPointerCapture(event.pointerId); } catch { /* no-op */ }
    this.activePointers.set(event.pointerId, { pointerType: 'hold', action });
    this._addSource(action, `p:${event.pointerId}`);
    button.classList.add('is-held');
    if (action === 'up' || action === 'down') this.onAngleTap(action === 'up' ? 1 : -1);
  }

  _firePointerDown(event) {
    if (!this.canAcceptInput()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this.firePointer != null) return;
    event.preventDefault();
    try { this.fireButton.setPointerCapture(event.pointerId); } catch { /* no-op */ }
    this.firePointer = event.pointerId;
    this.activePointers.set(event.pointerId, {
      pointerType: 'fire', action: 'fire', lastY: event.clientY,
    });
    this.fireButton.classList.add('is-held');
    const accepted = this.onChargeStart() !== false;
    if (!accepted) {
      this.firePointer = null;
      this.activePointers.delete(event.pointerId);
      this.fireButton.classList.remove('is-held');
    }
  }

  _anglePointerDown(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (!this.canAcceptInput() || this.angleDrag) return;
    event.preventDefault();
    this.angleDrag = { pointerId: event.pointerId, lastY: event.clientY };
    try { this.angleScrubSurface.setPointerCapture(event.pointerId); } catch { /* no-op */ }
  }

  _endAngleDrag(pointerId) {
    if (this.angleDrag?.pointerId === pointerId) this.angleDrag = null;
  }

  _pointerMove(event) {
    if (this.angleDrag?.pointerId === event.pointerId) {
      event.preventDefault();
      const dy = this.angleDrag.lastY - event.clientY;
      if (Math.abs(dy) >= 1) {
        this.onAngleScrub(dy);
        this.angleDrag.lastY = event.clientY;
      }
      return;
    }

    const info = this.activePointers.get(event.pointerId);
    if (!info) return;
    event.preventDefault();
    if (info.pointerType === 'fire' && event.pointerType === 'mouse') {
      const dy = info.lastY - event.clientY;
      if (Math.abs(dy) >= 1) {
        this.onChargeScrub(dy);
        info.lastY = event.clientY;
      }
    }
  }

  _clearPointer(pointerId, cancelled) {
    const info = this.activePointers.get(pointerId);
    if (!info) return;
    this.activePointers.delete(pointerId);
    if (info.pointerType === 'fire') {
      if (this.firePointer !== pointerId) return;
      this.firePointer = null;
      this.fireButton.classList.remove('is-held');
      if (cancelled) this.onChargeCancel('pointercancel');
      else this.onChargeRelease('pointerup');
      return;
    }
    this._removeSource(info.action, `p:${pointerId}`);
    const button = [...this.moveButtons, ...this.aimButtons].find((b) => b.dataset.hold === info.action);
    button?.classList.remove('is-held');
  }

  _addSource(action, source) {
    if (!this.sources.has(action)) this.sources.set(action, new Set());
    this.sources.get(action).add(source);
  }

  _removeSource(action, source) {
    const set = this.sources.get(action);
    if (!set) return;
    set.delete(source);
    if (set.size === 0) this.sources.delete(action);
  }

  isHeld(action) {
    return (this.sources.get(action)?.size || 0) > 0;
  }

  getMoveDirection() {
    return (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
  }

  getAimDirection() {
    return (this.isHeld('up') ? 1 : 0) - (this.isHeld('down') ? 1 : 0);
  }

  isMovementHeld() {
    return this.isHeld('left') || this.isHeld('right');
  }

  _isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  }

  _isForeignButton(target) {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button, a, [role="button"]');
    return !!control && !control.closest('#controls');
  }

  _keyDown(event) {
    if (!this.canAcceptInput()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (this._isTypingTarget(event.target)) return;
    if (event.repeat) return;
    this.onUserGesture();

    const skillSlot = /^Digit([1-8])$/.exec(event.code);
    if (skillSlot) {
      event.preventDefault();
      this.onSkillSlot(Number(skillSlot[1]) - 1);
      return;
    }
    if (event.code === 'KeyR') {
      event.preventDefault();
      this.onPowShortcut();
      return;
    }
    if (event.code === 'KeyH') {
      event.preventDefault();
      this.onHealShortcut();
      return;
    }
    // A mouse click leaves focus on a HUD button. Space must still charge;
    // otherwise the first shot after choosing a skill is swallowed. Native
    // Space on help/sound/restart remains untouched.
    if (this._isForeignButton(event.target)) return;

    if (MOVE_KEYS.has(event.key)) {
      const action = MOVE_KEYS.get(event.key);
      event.preventDefault();
      this._addSource(action, `k:${event.key}`);
    } else if (AIM_KEYS.has(event.key)) {
      const action = AIM_KEYS.get(event.key);
      event.preventDefault();
      this._addSource(action, `k:${event.key}`);
      this.onAngleTap(action === 'up' ? 1 : -1);
    } else if (event.code === 'Space') {
      event.preventDefault();
      if (this.spaceDown) return;
      this.spaceDown = true;
      this.fireButton.classList.add('is-held');
      const accepted = this.onChargeStart() !== false;
      if (!accepted) {
        this.spaceDown = false;
        this.fireButton.classList.remove('is-held');
      }
    }
  }

  _keyUp(event) {
    if (this._isTypingTarget(event.target)) return;
    if (MOVE_KEYS.has(event.key)) {
      const action = MOVE_KEYS.get(event.key);
      this._removeSource(action, `k:${event.key}`);
    } else if (AIM_KEYS.has(event.key)) {
      const action = AIM_KEYS.get(event.key);
      this._removeSource(action, `k:${event.key}`);
    } else if (event.code === 'Space' && this.spaceDown) {
      event.preventDefault();
      this.spaceDown = false;
      this.fireButton.classList.remove('is-held');
      this.onChargeRelease('keyup');
    }
  }

  cancelAll(reason = 'cancel') {
    const hadCharge = this.firePointer != null || this.spaceDown;
    for (const pointerId of this.activePointers.keys()) {
      const button = this.fireButton;
      try { button.releasePointerCapture?.(pointerId); } catch { /* no-op */ }
    }
    this.activePointers.clear();
    this.angleDrag = null;
    this.firePointer = null;
    this.spaceDown = false;
    this.sources.clear();
    this.fireButton.classList.remove('is-held');
    for (const button of [...this.moveButtons, ...this.aimButtons]) button.classList.remove('is-held');
    if (hadCharge) this.onChargeCancel(reason);
    this.onAbort(reason);
  }
}
