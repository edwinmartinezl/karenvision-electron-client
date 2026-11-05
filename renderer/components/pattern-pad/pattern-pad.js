const MAX_LOCAL_ATTEMPTS = 3;

export class PatternPad {
  constructor(rootEl, deps = {}) {
    this.rootEl = rootEl || null;
    this.deps = deps || {};
    this.sequence = [];
    this.nodeButtons = [];
    this.drawing = false;
    this.activePointerId = null;
    this.padEl = null;
    this.polylineEl = null;
    this.statusEl = null;
    this.attemptsEl = null;
    this.boardEl = null;
    this.errorResetTimer = null;
    this.blockResetTimer = null;
    this.isError = false;
    this.isLocked = false;
    this.isBlocked = false;
    this.localAttempts = 0;

    this.onBoardPointerDown = this.onBoardPointerDown.bind(this);
    this.onBoardPointerMove = this.onBoardPointerMove.bind(this);
    this.onBoardPointerUp = this.onBoardPointerUp.bind(this);
    this.onNodeKeyDown = this.onNodeKeyDown.bind(this);
  }

  mount() {
    if (!this.rootEl) return;
    this.render();
    this.bindEvents();
    this.updateUi();
  }

  destroy() {
    this.unbindEvents();
    this.cancelTimers();
    if (this.rootEl) {
      this.rootEl.innerHTML = "";
    }
    this.nodeButtons = [];
    this.padEl = null;
    this.polylineEl = null;
    this.statusEl = null;
    this.attemptsEl = null;
    this.boardEl = null;
    this.sequence = [];
    this.drawing = false;
    this.activePointerId = null;
    this.isError = false;
    this.isLocked = false;
    this.isBlocked = false;
    this.localAttempts = 0;
  }

  render() {
    this.rootEl.innerHTML = `
      <div class="pattern-pad" data-component="pattern-pad">
        <div class="pattern-pad-caption">Traza cualquier patrón y suelta para continuar.</div>
        <div class="pattern-pad-board" data-pattern-board>
          <svg class="pattern-pad-lines" viewBox="0 0 300 300" aria-hidden="true" focusable="false">
            <polyline class="pattern-pad-polyline" points=""></polyline>
          </svg>
          <div class="pattern-pad-grid" role="grid" aria-label="Patrón 3 por 3">
            ${Array.from({ length: 9 }, (_, i) => (
              `<button type="button" class="pattern-node" data-pattern-node="${i + 1}" role="gridcell" aria-label="Punto del patron" aria-pressed="false"></button>`
            )).join("")}
          </div>
        </div>
        <div class="pattern-pad-meta">
          <div class="pattern-pad-status" aria-live="polite"></div>
          <div class="pattern-pad-attempts" aria-live="polite"></div>
        </div>
      </div>
    `;

    this.padEl = this.rootEl.querySelector(".pattern-pad");
    this.boardEl = this.rootEl.querySelector("[data-pattern-board]");
    this.polylineEl = this.rootEl.querySelector(".pattern-pad-polyline");
    this.statusEl = this.rootEl.querySelector(".pattern-pad-status");
    this.attemptsEl = this.rootEl.querySelector(".pattern-pad-attempts");
    this.nodeButtons = Array.from(this.rootEl.querySelectorAll("[data-pattern-node]"));
  }

  bindEvents() {
    this.boardEl?.addEventListener("pointerdown", this.onBoardPointerDown);
    this.boardEl?.addEventListener("pointermove", this.onBoardPointerMove);
    this.boardEl?.addEventListener("pointerup", this.onBoardPointerUp);
    this.boardEl?.addEventListener("pointercancel", this.onBoardPointerUp);
    this.boardEl?.addEventListener("lostpointercapture", this.onBoardPointerUp);
    this.nodeButtons.forEach((btn) => btn.addEventListener("keydown", this.onNodeKeyDown));
    window.addEventListener("pointerup", this.onBoardPointerUp);
  }

  unbindEvents() {
    this.boardEl?.removeEventListener("pointerdown", this.onBoardPointerDown);
    this.boardEl?.removeEventListener("pointermove", this.onBoardPointerMove);
    this.boardEl?.removeEventListener("pointerup", this.onBoardPointerUp);
    this.boardEl?.removeEventListener("pointercancel", this.onBoardPointerUp);
    this.boardEl?.removeEventListener("lostpointercapture", this.onBoardPointerUp);
    this.nodeButtons.forEach((btn) => btn.removeEventListener("keydown", this.onNodeKeyDown));
    window.removeEventListener("pointerup", this.onBoardPointerUp);
  }

  cancelErrorReset() {
    if (!this.errorResetTimer) return;
    window.clearTimeout(this.errorResetTimer);
    this.errorResetTimer = null;
  }

  cancelBlockReset() {
    if (!this.blockResetTimer) return;
    window.clearTimeout(this.blockResetTimer);
    this.blockResetTimer = null;
  }

  cancelTimers() {
    this.cancelErrorReset();
    this.cancelBlockReset();
  }

  setErrorState(enabled) {
    this.isError = !!enabled;
    this.padEl?.classList.toggle("pp-error", this.isError);
  }

  setBlockedState(enabled) {
    this.isBlocked = !!enabled;
    this.padEl?.classList.toggle("pp-locked", this.isBlocked);
  }

  clear() {
    this.cancelTimers();
    this.sequence = [];
    this.drawing = false;
    this.activePointerId = null;
    this.isLocked = false;
    this.setErrorState(false);
    this.setBlockedState(false);
    this.localAttempts = 0;
    this.updateUi();
  }

  clearSequence() {
    this.sequence = [];
    this.drawing = false;
    this.activePointerId = null;
    this.updateUi();
  }

  focus() {
    this.nodeButtons[0]?.focus?.();
  }

  serializePattern() {
    return this.sequence.join("-");
  }

  patternToPin4() {
    const sum = this.sequence.reduce((acc, value) => acc + Number(value || 0), 0);
    const len = this.sequence.length;
    const pin = ((sum * 7) + (len * 13)) % 10000;
    return String(pin).padStart(4, "0");
  }

  isNodeSelected(indexValue) {
    return this.sequence.includes(Number(indexValue));
  }

  canInteract() {
    return !this.isLocked && !this.isBlocked;
  }

  addNode(indexValue) {
    if (!this.canInteract()) {
      return false;
    }
    const indexNum = Number(indexValue);
    if (!Number.isInteger(indexNum) || indexNum < 1 || indexNum > 9) {
      return false;
    }
    if (this.sequence.includes(indexNum)) {
      return false;
    }
    this.sequence.push(indexNum);
    this.updateUi();
    return true;
  }

  getNodeCenter(indexValue) {
    const indexNum = Number(indexValue);
    const col = (indexNum - 1) % 3;
    const row = Math.floor((indexNum - 1) / 3);
    return {
      x: (col * 100) + 50,
      y: (row * 100) + 50
    };
  }

  updateUi() {
    const active = new Set(this.sequence);
    const first = this.sequence[0] || null;
    const last = this.sequence[this.sequence.length - 1] || null;

    this.nodeButtons.forEach((btn) => {
      const indexNum = Number(btn.dataset.patternNode);
      const isActive = active.has(indexNum);
      btn.classList.toggle("is-active", isActive);
      btn.classList.toggle("is-first", first === indexNum);
      btn.classList.toggle("is-last", last === indexNum);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      btn.disabled = this.isBlocked;
    });

    if (this.polylineEl) {
      const points = this.sequence.map((value) => {
        const p = this.getNodeCenter(value);
        return `${p.x},${p.y}`;
      }).join(" ");
      this.polylineEl.setAttribute("points", points);
      this.polylineEl.classList.toggle("has-points", this.sequence.length > 0);
    }

    this.padEl?.classList.toggle("is-drawing", this.drawing);

    if (this.statusEl) {
      let statusText = "Traza cualquier patrón";
      if (this.isBlocked) {
        statusText = "Bloqueado 2s. Intenta de nuevo";
      } else if (this.isError) {
        statusText = "Patrón incorrecto";
      } else if (this.drawing && this.sequence.length > 0) {
        statusText = "Suelta para continuar";
      } else if (this.sequence.length > 0) {
        statusText = "Patrón listo";
      } else {
        statusText = "Traza cualquier patrón";
      }
      this.statusEl.textContent = statusText;
    }

    if (this.attemptsEl) {
      this.attemptsEl.textContent = "";
    }
  }

  resolveNodeFromEvent(event) {
    if (!event) return null;
    const candidate = document.elementFromPoint(event.clientX, event.clientY);
    if (!candidate) return null;
    const node = candidate.closest?.("[data-pattern-node]");
    if (!node || !this.rootEl?.contains(node)) {
      return null;
    }
    return node;
  }

  onBoardPointerDown(event) {
    if (!this.canInteract()) {
      return;
    }
    const node = event.target?.closest?.("[data-pattern-node]");
    if (!node || !this.rootEl?.contains(node)) {
      return;
    }
    event.preventDefault();

    this.cancelTimers();
    this.setErrorState(false);
    this.setBlockedState(false);
    this.sequence = [];
    this.drawing = true;
    this.activePointerId = Number.isInteger(event.pointerId) ? event.pointerId : null;

    if (event.pointerId !== undefined) {
      try {
        this.boardEl?.setPointerCapture?.(event.pointerId);
      } catch (_err) {
        // no-op
      }
    }

    this.addNode(node.dataset.patternNode);
    node.focus?.();
  }

  onBoardPointerMove(event) {
    if (!this.drawing || !this.canInteract()) return;
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
      return;
    }
    const node = this.resolveNodeFromEvent(event);
    if (!node) return;
    this.addNode(node.dataset.patternNode);
  }

  onBoardPointerUp(event) {
    if (!this.drawing) {
      return;
    }
    if (this.activePointerId !== null && event && event.pointerId !== undefined && event.pointerId !== this.activePointerId) {
      return;
    }

    const pointerId = event?.pointerId;
    if (pointerId !== undefined) {
      try {
        this.boardEl?.releasePointerCapture?.(pointerId);
      } catch (_err) {
        // no-op
      }
    }

    this.drawing = false;
    this.activePointerId = null;
    this.updateUi();
    void this.validateSequence();
  }

  moveFocusByArrow(currentIndex, key) {
    const idx = Number(currentIndex);
    if (!Number.isInteger(idx) || idx < 1 || idx > 9) return;
    const col = (idx - 1) % 3;
    const row = Math.floor((idx - 1) / 3);
    let nextCol = col;
    let nextRow = row;
    if (key === "ArrowLeft") nextCol = Math.max(0, col - 1);
    if (key === "ArrowRight") nextCol = Math.min(2, col + 1);
    if (key === "ArrowUp") nextRow = Math.max(0, row - 1);
    if (key === "ArrowDown") nextRow = Math.min(2, row + 1);
    const nextIndex = (nextRow * 3) + nextCol + 1;
    const nextBtn = this.nodeButtons.find((btn) => Number(btn.dataset.patternNode) === nextIndex);
    nextBtn?.focus?.();
  }

  onNodeKeyDown(event) {
    const handledKeys = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter"];
    if (!handledKeys.includes(event.key)) {
      return;
    }

    if (!this.canInteract()) {
      event.preventDefault();
      return;
    }

    const node = event.currentTarget;
    const indexValue = Number(node?.dataset?.patternNode || 0);

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      this.sequence = [];
      this.setErrorState(false);
      this.updateUi();
      return;
    }

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      this.moveFocusByArrow(indexValue, event.key);
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      if (this.isNodeSelected(indexValue)) {
        void this.validateSequence();
        return;
      }
      this.cancelTimers();
      this.setErrorState(false);
      this.addNode(indexValue);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.cancelTimers();
      this.setErrorState(false);
      if (!this.isNodeSelected(indexValue)) {
        this.addNode(indexValue);
      }
      void this.validateSequence();
    }
  }

  triggerInvalidPattern() {
    this.cancelTimers();
    this.setErrorState(false);
    this.setBlockedState(false);
    this.isLocked = false;
    this.updateUi();
  }

  async validateSequence() {
    this.drawing = false;
    this.activePointerId = null;

    if (this.sequence.length === 0 || !this.canInteract()) {
      this.updateUi();
      return;
    }

    this.cancelTimers();
    this.isLocked = false;
    this.setErrorState(false);
    this.setBlockedState(false);
    this.updateUi();

    await this.deps.onNavigateNext?.();
  }
}
