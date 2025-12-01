import { Lost } from '/lost.js';
import { LostUI } from '/lost-ui.js';

const DEFAULT_CONFIG = {
  title: 'Wheel of Choices',
  spinSeconds: 4,
  burnMode: false,
  segments: [
    { label: 'Red', color: '#ef4444' },
    { label: 'Green', color: '#22c55e' },
    { label: 'Blue', color: '#3b82f6' },
    { label: 'Yellow', color: '#eab308' },
  ],
};

const COLOR_PALETTE = [
  '#000000', '#ffffff', '#d1d5db', '#4b5563',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#fb7185',
  '#fca5a5', '#fdba74', '#fde047', '#bef264', '#86efac', '#99f6e4',
  '#7dd3fc', '#93c5fd', '#a5b4fc', '#c4b5fd', '#f0abfc', '#f9a8d4'
];

class WheelApp {
  constructor() {
    // Initialize Lost Framework
    this.lost = new Lost({
      storageKey: 'wof-wheels-v2',
      currentKey: 'wof-current-wheel-v2',
      defaultData: DEFAULT_CONFIG,
      validator: this.validateWheel.bind(this)
    });

    this.lost.addEventListener('update', (e) => this.onStateUpdate(e.detail));

    // Initialize UI Framework
    this.lostUI = new LostUI(this.lost, {
      container: document.body,
      theme: 'auto',
      showLightDarkButton: true,
      header: {
        title: 'Wheel of Choices',
        menuTitle: 'Wheels',
        extraContent: () => {
          const btn = document.createElement('button');
          btn.className = 'action-btn';
          btn.id = 'openCfg';
          btn.title = 'Configure';
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-settings"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37a1.724 1.724 0 0 0 2.572 -1.065"></path><path d="M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0 -6"></path></svg>';
          return btn;
        }
      },
      sidebar: {
        heading: 'Your Wheels',
        showImport: null,
        onNew: () => this.createNewWheel(),
        title: (wheel) => {
          if (wheel && typeof wheel.title === 'string' && wheel.title.trim()) {
            return wheel.title.trim();
          }
          return 'Untitled Wheel';
        },
        subline: (wheel) => {
          const segCount = Array.isArray(wheel?.segments) ? wheel.segments.length : 0;
          return `${segCount} option${segCount !== 1 ? 's' : ''}${wheel?.burnMode ? ' (burn mode)' : ''}`;
        }
      },
      footer: {
        label: 'Share your wheel:'
      }
    });

    // UI References (Mixed: some from document, some from LostUI)
    this.ui = {
      openCfgBtn: this.lostUI.elements.header.querySelector('#openCfg'), // Config button we injected
      cfgDlg: document.getElementById('cfg'),
      wheelTitleInput: document.getElementById('wheelTitle'),
      spinSecsInput: document.getElementById('spinSecs'),
      burnModeInput: document.getElementById('burnMode'),
      segmentsInput: document.getElementById('segmentsInput'),
      chipsLane: document.getElementById('chipsLane'),
      randColorsBtn: document.getElementById('randColors'),
      segCountHint: document.getElementById('segCountHint'),
      stage: document.getElementById('stage'),
      canvas: document.getElementById('wheel'),
      goBtn: document.getElementById('goBtn'),
      resetBtn: document.getElementById('resetBtn'),
      winnerOverlay: document.getElementById('winnerOverlay'),
      winnerTitle: document.getElementById('winnerTitle'),
      winnerCard: document.getElementById('winnerCard'),
      themeColor: document.querySelector('meta[name="theme-color"]'),
    };

    // Editor State
    this.editor = {
      lines: [],
      colors: [],
      paletteEl: null,
      currentChipIdx: -1,
      lineHeight: 0,
      topPadding: 0,
    };

    // Rendering State
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.ctx = this.ui.canvas.getContext('2d');
    this.wheelGeom = { cx: 0, cy: 0, R: 0, rInner: 0, rOuter: 0 };
    this.rot = 0;
    this.spinning = false;
    this.spinAnim = null;
    this.renderSegments = [];
    this.lastWinnerIdx = -1;
    this.swipe = { active: false, x0: 0, y0: 0, t0: 0, x1: 0, y1: 0, t1: 0 };

    this.bindEvents();
    this.init();
  }

  async init() {
    this.lost.load();
    this.lostUI.load();

    this.resizeCanvas();
    this.draw();
    this.updateGoDisabled();
  }

  // ----- Validation & Migration -----
  validateWheel(wheel) {
    if (!wheel || typeof wheel !== 'object') return false;
    // ID check is handled by Lost mostly, but good to check structure
    if (!Array.isArray(wheel.segments) || wheel.segments.length < 2 || wheel.segments.length > 100) return false;
    
    const validSegments = wheel.segments.every(s =>
        s && typeof s.label === 'string' && typeof s.color === 'string'
    );
    return validSegments;
  }

  // ----- State Handling -----
  onStateUpdate(currentWheel) {
    console.log('onStateUpdate', currentWheel);
    if (!currentWheel) return;
    
    // Sanitize wheel data
    currentWheel.title = String(currentWheel.title ?? DEFAULT_CONFIG.title).slice(0, 120);
    currentWheel.spinSeconds = Number(currentWheel.spinSeconds ?? DEFAULT_CONFIG.spinSeconds) || DEFAULT_CONFIG.spinSeconds;
    currentWheel.spinSeconds = Math.max(1, Math.min(60, currentWheel.spinSeconds));
    currentWheel.burnMode = !!currentWheel.burnMode;
    
    let segs = Array.isArray(currentWheel.segments) ? currentWheel.segments : [];
    segs = segs
        .filter(s => s && typeof s.label === 'string')
        .map(s => ({ 
            label: s.label.slice(0, 120), 
            color: String(s.color || '#888'),
            _burned: !!s._burned
        }))
        .slice(0, 100);
    if (segs.length < 2) segs = [...DEFAULT_CONFIG.segments];
    currentWheel.segments = segs;

    // Update UI
    this.rebuildSegmentsForWheel(currentWheel);
    
    if (typeof currentWheel._rotation === 'number') {
      this.rot = currentWheel._rotation;
    } else {
      this.rot = 0;
    }
    
    if (currentWheel.burnMode) {
      this.ui.resetBtn.style.display = 'block';
    } else {
      this.ui.resetBtn.style.display = 'none';
    }

    this.draw();
    this.updateGoDisabled();

    document.title = currentWheel.title || 'Wheel of Choices';
  }


  // ----- Editor & UI -----
  syncEditorFromConfig() {
    const wheel = this.lost.getCurrent();
    if (!wheel) return;
    this.editor.lines = wheel.segments.map(s => s.label);
    this.editor.colors = wheel.segments.map(s => s.color);
    this.ui.segmentsInput.value = this.editor.lines.join('\n');
    this.ui.segCountHint.textContent = `${this.editor.lines.length} segments`;
    this.positionChips();
  }

  parseLinesFromTextarea() {
      const rawLines = this.ui.segmentsInput.value.replace(/\r/g, '').split('\n');
      const prev = this.editor.lines;
      const prevColors = this.editor.colors;

      const lineToColorMap = new Map();
      for (let i = 0; i < prev.length; i++) {
          if (prev[i] && prevColors[i]) {
              lineToColorMap.set(prev[i], prevColors[i]);
          }
      }

      const lines = [];
      const newColors = [];
      
      for (let rawLine of rawLines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          
          // Check if line ends with a hex color (#xxxxxx)
          const colorMatch = trimmed.match(/^(.+?)\s+(#[0-9a-fA-F]{6})$/);
          
          if (colorMatch) {
              const label = colorMatch[1].trim();
              const color = colorMatch[2].toLowerCase();
              lines.push(label);
              newColors.push(color);
          } else {
              lines.push(trimmed);
              // Try to reuse color from previous state if same line exists
              if (lineToColorMap.has(trimmed)) {
                  newColors.push(lineToColorMap.get(trimmed));
              } else {
                  newColors.push(this.randomColor());
              }
          }
      }
      
      this.editor.lines = lines.slice(0, 100);
      this.editor.colors = newColors.slice(0, 100);
      this.ui.segCountHint.textContent = `${this.editor.lines.length} segments`;
      this.positionChips();
  }

  randomColor() {
      return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  }

  positionChips() {
      const style = getComputedStyle(this.ui.segmentsInput);
      const lh = parseFloat(style.lineHeight) || 22;
      const padTop = parseFloat(style.paddingTop) || 10;
      const scrollTop = this.ui.segmentsInput.scrollTop;
      this.editor.lineHeight = lh;
      this.editor.topPadding = padTop;

      this.ui.chipsLane.innerHTML = '';
      for (let i = 0; i < this.editor.lines.length; i++) {
          const top = padTop + i * lh - scrollTop + 2;
          const btn = document.createElement('button');
          btn.className = 'chip';
          btn.style.top = `${top}px`;
          btn.style.background = this.editor.colors[i] || this.randomColor();
          btn.title = `Color for "${this.editor.lines[i]}"`;
          btn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.showPaletteForChip(i, btn);
          });
          this.ui.chipsLane.appendChild(btn);
      }
  }

  ensurePalette() {
      if (this.editor.paletteEl) return this.editor.paletteEl;
      const pal = document.createElement('div');
      pal.className = 'palette';
      pal.style.display = 'none';
      COLOR_PALETTE.forEach(c => {
          const b = document.createElement('button');
          b.style.background = c;
          b.addEventListener('click', (e) => {
              e.preventDefault();
              if (this.editor.currentChipIdx >= 0) {
                  this.editor.colors[this.editor.currentChipIdx] = c;
                  this.positionChips();
                  this.persistFromEditor();
              }
              this.hidePalette();
          });
          pal.appendChild(b);
      });
      this.ui.cfgDlg.appendChild(pal);
      this.editor.paletteEl = pal;
      return pal;
  }

  showPaletteForChip(idx, chipBtn) {
      this.editor.currentChipIdx = idx;
      const pal = this.ensurePalette();
      const chipRect = chipBtn.getBoundingClientRect();
      const dialogRect = this.ui.cfgDlg.getBoundingClientRect();

      const relativeLeft = chipRect.right - dialogRect.left + 10;
      const relativeTop = chipRect.top - dialogRect.top - 10;

      const paletteWidth = 180;
      const paletteHeight = 100;

      let left = Math.min(relativeLeft, dialogRect.width - paletteWidth - 16);
      let top = Math.max(10, Math.min(relativeTop, dialogRect.height - paletteHeight - 16));

      pal.style.left = `${left}px`;
      pal.style.top = `${top}px`;
      pal.style.display = 'grid';
  }

  hidePalette() {
      if (this.editor.paletteEl) this.editor.paletteEl.style.display = 'none';
      this.editor.currentChipIdx = -1;
  }

  persistFromEditor() {
      const wheel = this.lost.getCurrent();
      if (!wheel) return;

      const labels = this.editor.lines.map(s => s.slice(0, 120));
      const segments = labels.map((label, i) => ({ label, color: this.editor.colors[i] || this.randomColor() }));
      const clean = segments.filter(Boolean).slice(0, 100);
      
      this.lost.update(wheel.id, { segments: clean, _rotation: 0 });
  }

  // ----- Rendering -----
  rebuildSegmentsForWheel(wheel) {
      if (!wheel) {
          this.renderSegments = [];
          return;
      }
      this.renderSegments = wheel.segments.map(s => ({
          label: s.label,
          color: s.color,
          _burned: !!s._burned
      }));
  }

  resizeCanvas() {
      const rect = this.ui.stage.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;
      const w = Math.floor(cssW * this.dpr);
      const h = Math.floor(cssH * this.dpr);
      if (this.ui.canvas.width !== w || this.ui.canvas.height !== h) {
          this.ui.canvas.width = w; this.ui.canvas.height = h;
      }
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(this.dpr, this.dpr);

      const size = Math.min(cssW - 6, cssH - 6);
      const centerX = (cssW - parseFloat(getComputedStyle(this.ui.stage).paddingLeft)) / 2 + parseFloat(getComputedStyle(this.ui.stage).paddingLeft);
      const centerY = cssH / 2;
      const R = size * 0.48;
      const rOuter = R * 0.98;
      const rInner = Math.max(40, R * 0.22);

      this.wheelGeom = { cx: centerX, cy: centerY, R, rInner, rOuter };
      this.draw();
  }

  hexToLuma(hex) {
      const c = hex.replace('#', '');
      const r = parseInt(c.substr(0, 2), 16) / 255;
      const g = parseInt(c.substr(2, 2), 16) / 255;
      const b = parseInt(c.substr(4, 2), 16) / 255;
      const [R, G, B] = [r, g, b].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow(((v + 0.055) / 1.055), 2.4));
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  draw() {
      const { cx, cy, R, rInner, rOuter } = this.wheelGeom;
      if (rInner <= 3) return;

      this.ctx.clearRect(0, 0, this.ui.canvas.width, this.ui.canvas.height);

      // Base plate
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, rOuter + 1, 0, Math.PI * 2);
      this.ctx.fillStyle = '#0a0d13';
      this.ctx.fill();
      this.ctx.restore();

      const n = Math.max(0, this.renderSegments.length);
      if (n === 0) return;

      // Pre-calculate Font Size
      const thickness = rOuter - rInner;
      const scale = Math.max(1, Math.min(2, R / 150));
      const offsetFromOuter = 14 * scale + 8;
      const textRadius = rOuter - offsetFromOuter;
      const availableWidth = Math.max(10, textRadius - (rInner + 12));
      const theta = Math.PI * 2 / n;

      // Measure text at a reference size to determine width/size ratio
      const fontStack = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
      const refFontSize = 24;
      this.ctx.save();
      this.ctx.font = `${refFontSize}px ${fontStack}`;
      let maxRefWidth = 0;
      for (const seg of this.renderSegments) {
          const w = this.ctx.measureText(seg.label.trim()).width;
          if (w > maxRefWidth) maxRefWidth = w;
      }
      this.ctx.restore();

      const widthPerPx = maxRefWidth / refFontSize;

      // Constraint 1: Chord length at the inner end of text
      // F <= 0.75 * 2 * sin(theta/2) * (textRadius - F * widthPerPx)
      // F (1 + K * widthPerPx) <= K * textRadius
      const K = 1.5 * Math.sin(theta / 2);
      const maxChordSize = (K * textRadius) / (1 + K * widthPerPx);

      // Constraint 2: Radial length (must fit between rOuter and rInner)
      const maxRadialSize = widthPerPx > 0 ? availableWidth / widthPerPx : 100;

      // Constraint 3: General limits (thickness ratio, absolute max)
      const maxThicknessSize = thickness * 0.22;

      let fontSize = Math.min(48, maxChordSize, maxRadialSize, maxThicknessSize);
      fontSize = Math.max(8, Math.floor(fontSize));

      for (let i = 0; i < n; i++) {
          const a0 = i * theta + this.rot;
          const a1 = (i + 1) * theta + this.rot;
          this.ctx.beginPath();
          this.ctx.moveTo(cx, cy);
          this.ctx.arc(cx, cy, rOuter, a0, a1);
          this.ctx.arc(cx, cy, rInner, a1, a0, true);
          this.ctx.closePath();
          this.ctx.fillStyle = this.renderSegments[i].color || '#888';
          this.ctx.fill();
          
          if (this.renderSegments[i]._burned) {
              this.ctx.fillStyle = 'rgba(128, 128, 128, 0.80)';
              this.ctx.fill();
          }

          this.ctx.lineWidth = 1;
          this.ctx.strokeStyle = '#0008';
          this.ctx.stroke();

          this.ctx.beginPath();
          this.ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
          this.ctx.lineTo(cx + Math.cos(a0) * rOuter, cy + Math.sin(a0) * rOuter);
          this.ctx.strokeStyle = '#0009';
          this.ctx.lineWidth = 1;
          this.ctx.stroke();

          const aMid = (a0 + a1) / 2;
          this.drawRadialLabel(aMid, this.renderSegments[i].label, this.renderSegments[i].color, this.renderSegments[i]._burned, fontSize);
      }

      this.ctx.beginPath();
      this.ctx.arc(cx, cy, rInner - 3, 0, Math.PI * 2);
      this.ctx.strokeStyle = '#000a';
      this.ctx.lineWidth = 6;
      this.ctx.stroke();

      this.drawPointerLeft();
  }

  drawRadialLabel(angle, label, color, burned, fontSize) {
      const { cx, cy, rInner, rOuter, R } = this.wheelGeom;

      const scale = Math.max(1, Math.min(2, R / 150));
      const offsetFromOuter = 14 * scale + 8;
      const textRadius = rOuter - offsetFromOuter;
      const availableWidth = Math.max(10, textRadius - rInner);

      const fontStack = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
      this.ctx.font = `${fontSize}px ${fontStack}`;

      let text = label.trim();
      
      if (this.ctx.measureText(text).width > availableWidth) {
          let safe = 0;
          while (text.length > 3 && safe < 100) {
             const w = this.ctx.measureText(text + '…').width;
             if (w <= availableWidth) break;
             text = text.slice(0, -1);
             safe++;
          }
          text += '…';
      }

      const luma = this.hexToLuma(color);
      this.ctx.save();
      this.ctx.translate(cx, cy);
      this.ctx.rotate(angle + Math.PI);

      const transparency = burned ? '80' : 'ff';
      this.ctx.fillStyle = ((luma > 0.54) ? '#0b0e14' : '#fffffb') + transparency;
      this.ctx.font = `${fontSize}px ${fontStack}`;
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';

      this.ctx.fillText(text, -textRadius, 0);
      this.ctx.restore();
  }

  drawPointerLeft() {
      const { cx, cy, rOuter, R } = this.wheelGeom;
      const scale = Math.max(1, Math.min(2, R / 150));
      const baseSize = 14 * scale;
      const x = cx - rOuter - baseSize;
      const y = cy;
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.moveTo(x, y - baseSize);
      this.ctx.lineTo(x, y + baseSize);
      this.ctx.lineTo(x + baseSize * 2, y);
      this.ctx.closePath();
      this.ctx.fillStyle = '#f5f5f5';
      this.ctx.fill();
      this.ctx.lineWidth = 2 * scale;
      this.ctx.strokeStyle = '#1118';
      this.ctx.stroke();
      this.ctx.restore();
  }

  updateGoDisabled() {
      const n = this.renderSegments.length;
      let ok = n >= 2 && n <= 100;
      const wheel = this.lost.getCurrent();
      if (wheel && wheel.burnMode) {
          const available = this.renderSegments.filter(s => !s._burned).length;
          if (available === 0) ok = false;
      }
      this.ui.goBtn.disabled = !ok || this.spinning;
  }

  handleSpinEnd(targetIdx) {
      const wheel = this.lost.getCurrent();
      if (!wheel) return;

      const updates = { _rotation: this.rot };

      if (wheel.burnMode) {
           const segs = [...wheel.segments];
           if (!segs[targetIdx]._burned) {
               segs[targetIdx]._burned = true;
               updates.segments = segs;
               
               const remaining = segs.filter(s => !s._burned).length;
               if (remaining === 0) {
                   setTimeout(() => {
                       if (confirm('No options left. Reset the wheel?')) {
                           this.resetBurnedSegments();
                       }
                   }, 1000);
               }
           }
      }
      this.lost.update(wheel.id, updates);
  }

  resetBurnedSegments() {
      const wheel = this.lost.getCurrent();
      if (!wheel) return;
      const newSegments = wheel.segments.map(s => {
          const copy = { ...s };
          delete copy._burned;
          return copy;
      });
      this.lost.update(wheel.id, { segments: newSegments });
  }

  // ----- Spin Logic -----
  startSpin(bySwipeMagnitude = 0) {
      if (this.spinning || this.renderSegments.length < 2) return;
      const n = this.renderSegments.length;
      const theta = Math.PI * 2 / n;

      const candidates = this.renderSegments.map((s, i) => i).filter(i => !this.renderSegments[i]._burned);
      if (candidates.length === 0) return;
      const targetIdx = candidates[Math.floor(Math.random() * candidates.length)];

      const baseTarget = Math.PI - (targetIdx + 0.5) * theta;
      const minTurns = 6, maxTurns = 12;
      const extra = Math.min(maxTurns, Math.max(minTurns, Math.floor(minTurns + bySwipeMagnitude * 4)));
      const target = baseTarget + extra * Math.PI * 2;

      const wheel = this.lost.getCurrent();
      const duration = (wheel ? wheel.spinSeconds : 7) * 1000;
      const start = performance.now();
      const startRot = this.rot;

      this.spinning = true;
      this.updateGoDisabled();
      cancelAnimationFrame(this.spinAnim);

      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const normalizeAngle = (a) => {
          a = a % (Math.PI * 2);
          if (a < 0) a += Math.PI * 2;
          return a;
      };

      const frame = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const k = easeOutCubic(t);
          this.rot = startRot + (target - startRot) * k;
          this.draw();
          if (t < 1) {
              this.spinAnim = requestAnimationFrame(frame);
          } else {
              this.spinning = false;
              this.rot = normalizeAngle(this.rot);
              this.lastWinnerIdx = targetIdx;
              this.updateGoDisabled();
              this.showWinnerOverlay(this.renderSegments[targetIdx].label, this.renderSegments[targetIdx].color);
              this.handleSpinEnd(targetIdx);
          }
      };
      this.spinAnim = requestAnimationFrame(frame);
  }

  showWinnerOverlay(text, color) {
      this.ui.winnerTitle.textContent = text;
      this.ui.winnerCard.style.background = color;
      const luma = this.hexToLuma(color);
      const textColor = (luma > 0.54) ? '#0b0e14' : '#fffffb';
      this.ui.winnerCard.style.color = textColor;
      this.ui.winnerOverlay.classList.add('show');
      if (this.ui.themeColor) {
          this.ui.themeColor.setAttribute('content', color);
      }
  }

  hideWinnerOverlay() {
      this.ui.winnerOverlay.classList.remove('show');
      if (this.ui.themeColor) {
          this.ui.themeColor.setAttribute('content', '#c00');
      }
  }

  createNewWheel() {
      this.lost.create({
          title: 'New Wheel',
          spinSeconds: 4,
          segments: [
              { label: 'Option 1', color: '#ef4444' },
              { label: 'Option 2', color: '#22c55e' },
              { label: 'Option 3', color: '#3b82f6' },
              { label: 'Option 4', color: '#eab308' },
          ]
      });
  }

  // ----- Event Binding -----
  bindEvents() {
      // Canvas / Swipe
      this.ui.canvas.addEventListener('touchstart', (e) => {
          e.preventDefault();
          const touch = e.touches[0];
          this.swipe.active = true;
          this.swipe.x0 = touch.clientX; this.swipe.y0 = touch.clientY; this.swipe.t0 = performance.now();
      }, { passive: false });

      this.ui.canvas.addEventListener('touchmove', (e) => {
          if (!this.swipe.active) return;
          e.preventDefault();
          const touch = e.touches[0];
          this.swipe.x1 = touch.clientX; this.swipe.y1 = touch.clientY; this.swipe.t1 = performance.now();
      }, { passive: false });

      this.ui.canvas.addEventListener('touchend', (e) => {
          if (!this.swipe.active) return;
          e.preventDefault();
          this.swipe.active = false;
          const dx = (this.swipe.x1 || this.swipe.x0) - this.swipe.x0;
          const dy = (this.swipe.y1 || this.swipe.y0) - this.swipe.y0;
          const dt = Math.max(1, (this.swipe.t1 || this.swipe.t0) - this.swipe.t0);
          const v = Math.hypot(dx, dy) / dt;
          const mag = Math.min(1, v * 1.8);
          if (mag > 0.08) this.startSpin(mag);
      }, { passive: false });
      
      this.ui.canvas.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'touch') return;
          this.swipe.active = true;
          this.swipe.x0 = e.clientX; this.swipe.y0 = e.clientY; this.swipe.t0 = performance.now();
      }, { passive: true });

      window.addEventListener('pointermove', (e) => {
          if (!this.swipe.active || e.pointerType === 'touch') return;
          this.swipe.x1 = e.clientX; this.swipe.y1 = e.clientY; this.swipe.t1 = performance.now();
      }, { passive: true });

      window.addEventListener('pointerup', (e) => {
          if (!this.swipe.active || e.pointerType === 'touch') return;
          this.swipe.active = false;
          const dx = (this.swipe.x1 || this.swipe.x0) - this.swipe.x0;
          const dy = (this.swipe.y1 || this.swipe.y0) - this.swipe.y0;
          const dt = Math.max(1, (this.swipe.t1 || this.swipe.t0) - this.swipe.t0);
          const v = Math.hypot(dx, dy) / dt;
          const mag = Math.min(1, v * 1.8);
          if (mag > 0.08) this.startSpin(mag);
      }, { passive: true });

      // Buttons
      this.ui.goBtn.addEventListener('click', () => this.startSpin());
      this.ui.resetBtn.addEventListener('click', () => this.resetBurnedSegments());

      // Editor
      this.ui.openCfgBtn.addEventListener('click', () => {
          const wheel = this.lost.getCurrent();
          if (!wheel) return;
          this.ui.wheelTitleInput.value = wheel.title;
          this.ui.spinSecsInput.value = String(wheel.spinSeconds);
          this.ui.burnModeInput.checked = !!wheel.burnMode;
          this.syncEditorFromConfig();
          this.ui.cfgDlg.showModal();
          setTimeout(() => this.positionChips(), 30);
          this.ui.segmentsInput.focus();
      });
      
      this.ui.segmentsInput.addEventListener('input', () => {
          this.parseLinesFromTextarea();
          this.persistFromEditor();
      });
      this.ui.segmentsInput.addEventListener('scroll', () => this.positionChips());
      
      // Copy event: append hex colors to each line
      this.ui.segmentsInput.addEventListener('copy', (e) => {
          const start = this.ui.segmentsInput.selectionStart;
          const end = this.ui.segmentsInput.selectionEnd;
          const selectedText = this.ui.segmentsInput.value.substring(start, end);
          
          if (!selectedText) return;
          
          const lines = selectedText.split('\n');
          const textareaLines = this.ui.segmentsInput.value.substring(0, end).split('\n');
          const startLineIdx = this.ui.segmentsInput.value.substring(0, start).split('\n').length - 1;
          
          const enrichedLines = lines.map((line, idx) => {
              const lineIdx = startLineIdx + idx;
              const trimmedLine = line.trim();
              
              // Find matching line in editor.lines to get its color
              const editorIdx = this.editor.lines.indexOf(trimmedLine);
              if (editorIdx >= 0 && this.editor.colors[editorIdx]) {
                  return `${line} ${this.editor.colors[editorIdx]}`;
              }
              return line;
          });
          
          const enrichedText = enrichedLines.join('\n');
          e.clipboardData.setData('text/plain', enrichedText);
          e.preventDefault();
      });
      
      // Paste event: extract colors and update textarea
      this.ui.segmentsInput.addEventListener('paste', (e) => {
          e.preventDefault();
          const pastedText = e.clipboardData.getData('text/plain');
          
          const start = this.ui.segmentsInput.selectionStart;
          const end = this.ui.segmentsInput.selectionEnd;
          const currentValue = this.ui.segmentsInput.value;
          
          // Insert pasted text at cursor position
          const newValue = currentValue.substring(0, start) + pastedText + currentValue.substring(end);
          this.ui.segmentsInput.value = newValue;
          
          // Trigger parsing which will extract colors
          this.parseLinesFromTextarea();
          this.persistFromEditor();
          
          // Update textarea to show lines without color codes
          this.ui.segmentsInput.value = this.editor.lines.join('\n');
          
          // Set cursor position after pasted content (adjusted for removed color codes)
          const newCursorPos = Math.min(this.ui.segmentsInput.value.length, start + pastedText.length);
          this.ui.segmentsInput.setSelectionRange(newCursorPos, newCursorPos);
      });
      
      this.ui.randColorsBtn.addEventListener('click', () => {
          this.editor.colors = this.editor.lines.map(() => this.randomColor());
          this.positionChips();
          this.persistFromEditor();
      });
      
      this.ui.wheelTitleInput.addEventListener('input', () => {
          const wheel = this.lost.getCurrent();
          if (!wheel) return;
          this.lost.update(wheel.id, { title: this.ui.wheelTitleInput.value.slice(0, 120) });
      });
      
      this.ui.spinSecsInput.addEventListener('input', () => {
           const wheel = this.lost.getCurrent();
           if (!wheel) return;
           const v = Number(this.ui.spinSecsInput.value || wheel.spinSeconds);
           this.lost.update(wheel.id, { spinSeconds: Math.max(1, Math.min(60, v)) });
      });
      
      this.ui.burnModeInput.addEventListener('change', () => {
          const wheel = this.lost.getCurrent();
          if (wheel) {
              const updateData = { burnMode: this.ui.burnModeInput.checked };
              if (!updateData.burnMode) {
                  // Reset burned segments when turning off Burn Mode
                  updateData.segments = wheel.segments.map(s => {
                      const copy = { ...s };
                      delete copy._burned;
                      return copy;
                  });
              }
              this.lost.update(wheel.id, updateData);
          }
      });

      // Overlay
      this.ui.winnerOverlay.addEventListener('click', (e) => {
          if (!this.ui.winnerCard.contains(e.target)) this.hideWinnerOverlay();
      });
      
      // Resize
      window.addEventListener('resize', () => {
          this.resizeCanvas();
          this.hidePalette();
      }, { passive: true });
      window.addEventListener('scroll', () => this.hidePalette(), { passive: true });
      document.addEventListener('click', (e) => {
          if (this.editor.paletteEl && this.editor.paletteEl.style.display !== 'none' && !this.editor.paletteEl.contains(e.target)) {
              this.hidePalette();
          }
      });
      // Hash Change
  }

}

// Start the app
new WheelApp();
