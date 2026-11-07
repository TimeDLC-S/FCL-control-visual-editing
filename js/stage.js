/* =========================================================================
 * stage.js —— 手机端画布：触摸拖动/缩放/长按框选/双指缩放平移/预览显隐
 * ========================================================================= */
import { DENSITY, cssColor, keycodesLabel } from './data.js';
import {
  controlRect,
  emit,
  findControl,
  findGroup,
  select,
  snapshot,
  selectedControls,
  setMode,
  stageDims,
  state,
} from './store.js';

const UI = {};
const LONG_PRESS_MS = 360;
const TAP_MOVE_PX = 10;

let drag = null;
let marqueeEl = null;
let selBoxes = new Map();
let handleEl = null;
let countEl = null;
let rafId = null;
let longPressTimer = null;
let emptyGesture = null;
const latched = new Set();
const previewGroupVisible = new Map();
let previewPointerId = null;
let previewDownId = null;
let lastMode = null;
let lastDimsKey = '';

const pointers = new Map();
let pinch = null;
const view = { zoom: 1, panX: 0, panY: 0 };

export function initStage() {
  UI.stage = document.getElementById('stage');
  UI.scaler = document.getElementById('stageScaler');
  UI.frame = document.getElementById('screenFrame');
  UI.grid = document.getElementById('stageGrid');
  UI.controls = document.getElementById('controlsLayer');
  UI.overlay = document.getElementById('overlayLayer');
  UI.empty = document.getElementById('emptyHint');
  UI.area = document.getElementById('stageArea');
  UI.zoom = document.getElementById('zoomLabel');
  UI.sizeLabel = document.getElementById('canvasSizeLabel');

  UI.area.addEventListener('pointerdown', onPointerDown);
  UI.stage.addEventListener('dblclick', onStageDoubleClick);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', updateScale);
  window.addEventListener('app:zen-changed', () => requestAnimationFrame(updateScale));
  new ResizeObserver(() => updateScale()).observe(UI.area);
}

/* --------------------------------------------------------------- 视图缩放 */
function applyViewTransform() {
  UI.scaler.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  document.dispatchEvent(new CustomEvent('app:view-%', { detail: { scale: view.zoom } }));
}

export function updateScale() {
  const dims = stageDims();
  const key = `${dims.w}x${dims.h}`;
  if (key !== lastDimsKey) {
    lastDimsKey = key;
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
  }
  const rect = UI.area.getBoundingClientRect();
  const shotScale = window.__SHOT_SCALE__ || 1;
  const padW = 12;
  const padH = 12;
  const availW = Math.max(160, rect.width / shotScale - padW);
  const availH = Math.max(120, rect.height / shotScale - padH);
  const fit = Math.max(0.03, Math.min(availW / dims.w, availH / dims.h));
  UI.scaler.style.width = Math.round(dims.w * fit) + 'px';
  UI.scaler.style.height = Math.round(dims.h * fit) + 'px';
  UI.stage.style.width = dims.w + 'px';
  UI.stage.style.height = dims.h + 'px';
  UI.stage.style.transform = `scale(${fit})`;
  UI.stage.style.setProperty('--scale', String(fit));
  UI.stage.style.setProperty('--inv-scale', String(1 / (fit * view.zoom)));
  UI.scaler.dataset.fit = String(fit);
  applyViewTransform();
  if (UI.zoom) UI.zoom.textContent = `${Math.round(fit * view.zoom * 100)}%`;
  if (UI.sizeLabel) UI.sizeLabel.textContent = `${dims.w} × ${dims.h}`;
  window.dispatchEvent(new CustomEvent('app:view-changed', { detail: { scale: fit * view.zoom } }));
}

function resetView() {
  view.zoom = 1;
  view.panX = 0;
  view.panY = 0;
  updateScale();
}

/* --------------------------------------------------------------- 坐标换算 */
function stageRectNow() {
  const dims = stageDims();
  const rect = UI.stage.getBoundingClientRect();
  const shotScale = window.__SHOT_SCALE__ || 1;
  return { rect, scale: rect.width / dims.w / shotScale };
}
function clientToStage(clientX, clientY, cached) {
  const { rect, scale } = cached || stageRectNow();
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}
function insideStage(clientX, clientY) {
  const dims = stageDims();
  const rect = UI.stage.getBoundingClientRect();
  const shotScale = window.__SHOT_SCALE__ || 1;
  const x = (clientX - rect.left) / shotScale;
  const y = (clientY - rect.top) / shotScale;
  return x >= 0 && y >= 0 && x <= dims.w * (rect.width / dims.w / shotScale) && y <= dims.h * (rect.height / dims.h / shotScale);
}

/* ------------------------------------------------------------------ 渲染 */
export function renderStage() {
  const dims = stageDims();
  UI.stage.classList.toggle('no-grid', !state.canvas.grid);
  UI.stage.classList.toggle('is-preview', state.mode === 'preview');
  UI.stage.classList.toggle('mode-select', state.mode === 'select');
  UI.stage.classList.toggle('mode-move', state.mode === 'move');

  const step = Number(state.canvas.gridStep) || 10;
  UI.stage.style.setProperty('--grid-minor', (step * 0.1).toFixed(2) + '%');
  UI.stage.style.setProperty('--grid-major', (step * 0.5).toFixed(2) + '%');

  if (state.mode === 'preview' && lastMode !== 'preview') {
    previewGroupVisible.clear();
    state.groups.forEach((g) => previewGroupVisible.set(g.id, g.visibility === 'VISIBLE'));
  }
  lastMode = state.mode;

  const previewState = state.canvas.previewState || 'in_game';
  const groupVisible = (groupId) => {
    const g = findGroup(groupId);
    if (!g) return true;
    if (state.mode === 'preview') return previewGroupVisible.get(g.id) !== false;
    // 编辑模式：只有开关打开的控件组才显示（隐藏组不画半透明幽灵）
    return g.visibility === 'VISIBLE';
  };
  const typeVisible = (control) => {
    if (state.mode !== 'preview') return true;
    const type = control.base.visibility;
    if (type === 'ALWAYS') return true;
    if (type === 'IN_GAME') return previewState === 'in_game';
    if (type === 'MENU') return previewState === 'out_game';
    return true;
  };

  const groupIndex = new Map(state.groups.map((g, i) => [g.id, i]));
  const ctrlIndex = new Map(state.controls.map((c, i) => [c.id, i]));
  const ordered = [...state.controls].sort((a, b) => {
    const ga = groupIndex.get(a.groupId) ?? 0;
    const gb = groupIndex.get(b.groupId) ?? 0;
    if (ga !== gb) return ga - gb;
    return ctrlIndex.get(a.id) - ctrlIndex.get(b.id);
  });

  const selectedSet = new Set(state.selection);
  const fragment = document.createDocumentFragment();
  ordered.forEach((control) => {
    if (!groupVisible(control.groupId)) return;
    if (!typeVisible(control)) return;
    const group = findGroup(control.groupId);
    fragment.appendChild(createControlEl(control, selectedSet.has(control.id), group));
  });
  UI.controls.replaceChildren(fragment);

  UI.empty.classList.toggle('hidden', state.controls.length > 0);
  renderOverlay();
  updateScale();
}

function controlStyleVars(control, rect) {
  const style = control.style || {};
  return {
    left: rect.x + 'px',
    top: rect.y + 'px',
    width: rect.w + 'px',
    height: rect.h + 'px',
    borderRadius: (style.cornerRadius || 0) / 10 * DENSITY + 'px',
    borderWidth: (style.strokeWidth || 0) / 10 * DENSITY + 'px',
    borderColor: cssColor(style.strokeColor ?? 0),
    borderStyle: style.strokeWidth ? 'solid' : 'none',
    background: cssColor(style.fillColor ?? 0),
    color: cssColor(style.textColor ?? -1),
    fontSize: (style.textSize ?? 12) * DENSITY + 'px',
  };
}

function createControlEl(control, isSelected, group) {
  const rect = controlRect(control);
  const el = document.createElement('div');
  el.className = 'ctrl ' + control.type;
  el.dataset.id = control.id;
  el.dataset.group = control.groupId || '';
  if (isSelected && state.mode !== 'preview') el.classList.add('is-selected');
  if (control.isPanel) el.classList.add('is-panel');
  Object.assign(el.style, controlStyleVars(control, rect));
  el.title = group ? group.name : '';

  if (group && state.mode !== 'preview') {
    const dot = document.createElement('span');
    dot.className = 'ctrl-group-dot';
    dot.style.background = group.color;
    dot.style.color = group.color;
    el.appendChild(dot);
  }
  if (control.base.visibility !== 'ALWAYS' && state.mode !== 'preview') {
    const tag = document.createElement('span');
    tag.className = 'ctrl-tag';
    tag.textContent = control.base.visibility === 'IN_GAME' ? 'G' : 'O';
    el.appendChild(tag);
  }
  if (control.type === 'direction') {
    el.appendChild(createDirectionInner(control, rect));
  } else {
    const label = document.createElement('span');
    label.className = 'ctrl-label';
    label.textContent = control.text || '';
    el.appendChild(label);
  }
  if (state.mode === 'preview' && latched.has(control.id)) applyButtonLook(el, control, true);
  return el;
}

function createDirectionInner(control, rect) {
  const style = control.dirStyle || {};
  const size = Math.min(rect.w, rect.h);
  const frag = document.createDocumentFragment();
  if (style.styleType === 'ROCKER') {
    const rs = style.rockerStyle || {};
    const bg = document.createElement('div');
    bg.className = 'dir-rocker-bg';
    bg.style.background = cssColor(rs.bgFillColor ?? 0);
    bg.style.border = `${(rs.bgStrokeWidth || 0) / 10 * DENSITY}px solid ${cssColor(rs.bgStrokeColor ?? 0)}`;
    bg.style.borderRadius = '50%';
    frag.appendChild(bg);
    const knob = document.createElement('div');
    knob.className = 'dir-rocker-knob';
    const kd = (size * (rs.rockerSize || 400)) / 1000;
    knob.style.cssText = `width:${kd}px;height:${kd}px;left:${(rect.w - kd) / 2}px;top:${(rect.h - kd) / 2}px;`
      + `background:${cssColor(rs.rockerFillColor ?? 0)};`
      + `border:${(rs.rockerStrokeWidth || 0) / 10 * DENSITY}px solid ${cssColor(rs.rockerStrokeColor ?? -1)}`;
    frag.appendChild(knob);
  } else {
    const bs = style.buttonStyle || {};
    const interval = (bs.interval ?? 60) / 1000;
    const cell = (size * (1 - 2 * interval)) / 3;
    const p1 = size * interval + cell;
    const p2 = size - cell;
    [['▲', p1, 0], ['◀', 0, p1], ['▶', p2, p1], ['▼', p1, p2], ['◆', p1, p1]]
      .forEach(([glyph, x, y]) => {
        const cellEl = document.createElement('div');
        cellEl.className = 'dir-dpad-cell';
        cellEl.textContent = glyph;
        cellEl.style.cssText = `left:${x}px;top:${y}px;width:${cell}px;height:${cell}px;`
          + `background:${cssColor(bs.fillColor ?? 0)};`
          + `border:${(bs.strokeWidth || 0) / 10 * DENSITY}px solid ${cssColor(bs.strokeColor ?? 0)};`
          + `border-radius:${(bs.cornerRadius || 0) / 10 * DENSITY}px;`
          + `color:${cssColor(bs.textColor ?? -1)};`
          + `font-size:${(bs.textSize ?? 12) * DENSITY * 0.8}px`;
        frag.appendChild(cellEl);
      });
  }
  return frag;
}

/* ------------------------------------------------------------ 选中框 */
function renderOverlay() {
  UI.overlay.replaceChildren();
  selBoxes = new Map();
  handleEl = null;
  countEl = null;
  marqueeEl = null;
  if (state.mode === 'preview') return;
  const selected = selectedControls().filter((c) => {
    const g = findGroup(c.groupId);
    return !g || g.visibility === 'VISIBLE';
  });
  if (!selected.length) return;
  selected.forEach((control) => {
    const r = controlRect(control);
    const box = document.createElement('div');
    box.className = 'sel-box' + (selected.length > 1 ? ' multi' : '');
    box.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    UI.overlay.appendChild(box);
    selBoxes.set(control.id, box);
  });
  if (selected.length === 1 && state.mode === 'select') {
    const c = selected[0];
    const r = controlRect(c);
    const handle = document.createElement('div');
    handle.className = 'sel-handle';
    handle.style.left = r.x + r.w + 'px';
    handle.style.top = r.y + r.h + 'px';
    handle.dataset.handle = '1';
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button !== 0) return;
      beginResize(e, c);
    });
    UI.overlay.appendChild(handle);
    handleEl = handle;
  }
  if (selected.length > 1) {
    const rects = selected.map((c) => controlRect(c));
    const count = document.createElement('div');
    count.className = 'sel-count';
    count.textContent = `${selected.length} 个控件`;
    count.style.left = Math.min(...rects.map((r) => r.x)) + 'px';
    count.style.top = Math.min(...rects.map((r) => r.y)) + 'px';
    UI.overlay.appendChild(count);
    countEl = count;
  }
}

function syncOverlay() {
  selectedControls().forEach((c) => {
    const box = selBoxes.get(c.id);
    if (!box) return;
    const r = controlRect(c);
    box.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
  });
  if (handleEl && state.selection.length === 1) {
    const r = controlRect(selectedControls()[0]);
    handleEl.style.left = r.x + r.w + 'px';
    handleEl.style.top = r.y + r.h + 'px';
  }
  if (countEl && state.selection.length > 1) {
    const rects = selectedControls().map((c) => controlRect(c));
    countEl.style.left = Math.min(...rects.map((r) => r.x)) + 'px';
    countEl.style.top = Math.min(...rects.map((r) => r.y)) + 'px';
    countEl.textContent = `${state.selection.length} 个控件`;
  }
}

function applyElRect(control) {
  const el = UI.controls.querySelector(`.ctrl[data-id="${control.id}"]`);
  if (!el) return;
  const r = controlRect(control);
  el.style.left = r.x + 'px';
  el.style.top = r.y + 'px';
  el.style.width = r.w + 'px';
  el.style.height = r.h + 'px';
}
function applySelectionClasses() {
  const set = new Set(state.selection);
  UI.controls.querySelectorAll('.ctrl').forEach((el) => {
    el.classList.toggle('is-selected', set.has(el.dataset.id) && state.mode !== 'preview');
  });
}
function setSelection(ids, options = {}) {
  let next;
  if (options.toggle) {
    const set = new Set(state.selection);
    ids.forEach((id) => (set.has(id) ? set.delete(id) : set.add(id)));
    next = [...set];
  } else if (options.add) {
    next = [...new Set([...state.selection, ...ids])];
  } else {
    next = [...new Set(ids)];
  }
  state.selection = next;
  applySelectionClasses();
  renderOverlay();
  emit('select', { skipStage: true });
}

/* ---------------------------------------------------------------- 手势 */
function pointerDownInfo(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) startPinch();
}

function startPinch() {
  const pts = [...pointers.values()];
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  pinch = {
    startDist: dist || 1,
    startZoom: view.zoom,
    startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    startPan: { x: view.panX, y: view.panY },
  };
  cancelEmptyGesture();
  drag = null;
}
function updatePinch() {
  if (!pinch || pointers.size < 2) return;
  const pts = [...pointers.values()];
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  view.zoom = Math.max(0.6, Math.min(3.5, pinch.startZoom * (dist / pinch.startDist)));
  view.panX = pinch.startPan.x + (mid.x - pinch.startMid.x);
  view.panY = pinch.startPan.y + (mid.y - pinch.startMid.y);
  applyViewTransform();
  updateScale();
}
function endPinch() {
  pinch = null;
}

function onPointerDown(e) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    startPinch();
    e.preventDefault();
    return;
  }
  if (pointers.size > 2) return;
  if (pinch) return;

  if (state.mode === 'preview') {
    onPreviewDown(e);
    return;
  }
  const p = clientToStage(e.clientX, e.clientY);
  const dims = stageDims();
  if (p.x < 0 || p.y < 0 || p.x > dims.w || p.y > dims.h) {
    startPan(e);
    return;
  }
  const controlEl = e.target.closest('.ctrl');
  const control = controlEl ? findControl(controlEl.dataset.id) : null;

  if (!control) {
    // 空白：短按清选、长按框选、拖动平移画布
    emptyGesture = { startClient: { x: e.clientX, y: e.clientY }, p, pointerId: e.pointerId, mode: 'pending' };
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!emptyGesture || emptyGesture.mode !== 'pending') return;
      emptyGesture.mode = 'marquee';
      startMarquee(emptyGesture.p, e.pointerId);
    }, LONG_PRESS_MS);
    e.preventDefault();
    return;
  }

  // 控件
  const selected = state.selection.includes(control.id);
  if (state.mode === 'move') {
    if (!selected) {
      if (e.shiftKey) setSelection([control.id], { toggle: true });
      else setSelection([control.id], { add: true });
      startMove(p, e.pointerId);
    } else if (e.shiftKey) {
      setSelection([control.id], { toggle: true });
      return;
    } else {
      startMove(p, e.pointerId, { toggleOffId: control.id });
    }
  } else {
    if (state.canvas.multiSelect || e.shiftKey) {
      setSelection([control.id], { toggle: true });
      e.preventDefault();
      return;
    }
    if (!selected) setSelection([control.id]);
    startMove(p, e.pointerId);
  }
  try { UI.area.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  e.preventDefault();
}

function startMove(p, pointerId, extra = {}) {
  drag = {
    kind: 'move', start: p, pointerId,
    origin: new Map(state.selection.map((id) => {
      const c = findControl(id);
      return [id, { ...c.base }];
    })),
    moved: false, ...extra,
  };
}
function beginResize(e, control) {
  const p = clientToStage(e.clientX, e.clientY);
  try { UI.area.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  drag = {
    kind: 'resize', id: control.id, start: p,
    pointerId: e.pointerId, origin: { ...control.base }, moved: false,
  };
  e.preventDefault();
}
function startMarquee(p, pointerId) {
  drag = {
    kind: 'marquee', start: p, current: p, pointerId,
    baseSelection: [...state.selection], moved: false,
  };
  marqueeEl = document.createElement('div');
  marqueeEl.className = 'marquee';
  marqueeEl.style.display = 'none';
  UI.overlay.appendChild(marqueeEl);
}
function cancelEmptyGesture() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  emptyGesture = null;
}
function startPan(e) {
  emptyGesture = {
    startClient: { x: e.clientX, y: e.clientY }, pointerId: e.pointerId, mode: 'pan',
    startPan: { x: view.panX, y: view.panY },
  };
  e.preventDefault();
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) { updatePinch(); return; }
  if (state.mode === 'preview') return;

  if (emptyGesture && emptyGesture.pointerId === e.pointerId) {
    const dx = e.clientX - emptyGesture.startClient.x;
    const dy = e.clientY - emptyGesture.startClient.y;
    if (emptyGesture.mode === 'pending' && Math.hypot(dx, dy) > TAP_MOVE_PX) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      if (drag && drag.kind === 'marquee') { drag = null; if (marqueeEl) marqueeEl.remove(); marqueeEl = null; }
      emptyGesture.mode = 'pan';
      emptyGesture.startPan = { x: view.panX, y: view.panY };
      emptyGesture.startClient = { x: e.clientX, y: e.clientY };
    }
    if (emptyGesture.mode === 'pan') {
      view.panX = emptyGesture.startPan.x + (e.clientX - emptyGesture.startClient.x);
      view.panY = emptyGesture.startPan.y + (e.clientY - emptyGesture.startClient.y);
      applyViewTransform();
      updateScale();
      return;
    }
  }

  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.pending = { x: e.clientX, y: e.clientY };
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!drag || !drag.pending) return;
    const { x, y } = drag.pending;
    drag.pending = null;
    updateDrag(x, y);
  });
}

function updateDrag(clientX, clientY) {
  const p = clientToStage(clientX, clientY);
  const dims = stageDims();
  if (drag.kind === 'marquee') {
    drag.current = p;
    drag.moved = true;
    const x = Math.min(drag.start.x, p.x);
    const y = Math.min(drag.start.y, p.y);
    const w = Math.abs(p.x - drag.start.x);
    const h = Math.abs(p.y - drag.start.y);
    if (marqueeEl) {
      marqueeEl.style.display = 'block';
      marqueeEl.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    }
    return;
  }
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  if (!drag.moved && (drag.kind === 'move' || drag.kind === 'resize')) {
    snapshot();
  }
  drag.moved = true;
  const stepPx = (dims.w * (Number(state.canvas.gridStep) || 10)) / 1000;
  const snap = state.canvas.snap;
  const snapPx = (v) => (snap ? Math.round(v / stepPx) * stepPx : v);

  if (drag.kind === 'move') {
    state.selection.forEach((id) => {
      const control = findControl(id);
      const origin = drag.origin.get(id);
      if (!control || !origin) return;
      const baseDim = control.base.ref === 'SCREEN_HEIGHT' ? dims.h : dims.w;
      const wPx = (baseDim * origin.w) / 1000;
      const hPx = (baseDim * origin.h) / 1000;
      const startLeft = ((dims.w - wPx) * origin.x) / 1000;
      const startTop = ((dims.h - hPx) * origin.y) / 1000;
      const left = Math.max(0, Math.min(dims.w - wPx, snapPx(startLeft + dx)));
      const top = Math.max(0, Math.min(dims.h - hPx, snapPx(startTop + dy)));
      control.base.x = Math.round((left / (dims.w - wPx)) * 1000) || 0;
      control.base.y = Math.round((top / (dims.h - hPx)) * 1000) || 0;
      applyElRect(control);
    });
    syncOverlay();
  } else if (drag.kind === 'resize') {
    const control = findControl(drag.id);
    if (!control) return;
    const baseDim = control.base.ref === 'SCREEN_HEIGHT' ? dims.h : dims.w;
    const startW = (baseDim * drag.origin.w) / 1000;
    const startH = (baseDim * drag.origin.h) / 1000;
    let wPx = Math.max(20, startW + dx);
    let hPx = Math.max(20, startH + dy);
    if (control.type === 'direction') {
      const d = Math.max(dx, dy);
      wPx = hPx = Math.max(36, startW + d);
    }
    let wPm = Math.min(1000, Math.max(10, Math.round((wPx / baseDim) * 1000)));
    let hPm = Math.min(1000, Math.max(10, Math.round((hPx / baseDim) * 1000)));
    if (snap) {
      wPm = Math.max(10, Math.round(wPm / state.canvas.gridStep) * state.canvas.gridStep);
      hPm = Math.max(10, Math.round(hPm / state.canvas.gridStep) * state.canvas.gridStep);
    }
    control.base.w = wPm;
    control.base.h = control.type === 'direction' ? wPm : hPm;
    applyElRect(control);
    syncOverlay();
  }
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) endPinch();
    return;
  }
  if (state.mode === 'preview') {
    onPreviewUp(e);
    return;
  }
  if (emptyGesture && emptyGesture.pointerId === e.pointerId) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    const g = emptyGesture;
    emptyGesture = null;
    if (g.mode === 'pending') {
      setSelection([]);
      renderStage();
      return;
    }
  }
  if (!drag) return;
  const finished = drag;
  drag = null;
  if (finished.kind === 'marquee') {
    const x1 = Math.min(finished.start.x, finished.current.x);
    const y1 = Math.min(finished.start.y, finished.current.y);
    const x2 = Math.max(finished.start.x, finished.current.x);
    const y2 = Math.max(finished.start.y, finished.current.y);
    if (x2 - x1 > 4 || y2 - y1 > 4) {
      const hit = state.controls.filter((c) => {
        const r = controlRect(c);
        return r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1;
      }).map((c) => c.id);
      setSelection([...finished.baseSelection, ...hit]);
    }
    if (marqueeEl) marqueeEl.remove();
    marqueeEl = null;
    renderStage();
    emit('select', { skipStage: true });
    return;
  }
  if (!finished.moved && finished.toggleOffId) setSelection([finished.toggleOffId], { toggle: true });
  renderStage();
  emit('drag');
}

function onPointerCancel(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) endPinch(); return; }
  cancelEmptyGesture();
  if (drag) { drag = null; if (marqueeEl) marqueeEl.remove(); marqueeEl = null; renderStage(); }
}

function onStageDoubleClick(e) {
  if (state.mode === 'preview') return;
  const controlEl = e.target.closest('.ctrl');
  if (!controlEl) return;
  window.dispatchEvent(new CustomEvent('app:focus-text', { detail: { id: controlEl.dataset.id } }));
}

/* ---------------------------------------------------------------- 预览 */
function onPreviewDown(e) {
  const controlEl = e.target.closest('.ctrl');
  if (!controlEl) return;
  const control = findControl(controlEl.dataset.id);
  if (!control) return;
  e.preventDefault();
  previewPointerId = e.pointerId;
  previewDownId = control.id;
  if (isToggle(control)) {
    elPress(controlEl, control);
    return;
  }
  elPress(controlEl, control);
  executePreviewActions(control, 'pressEvent');
}

function onPreviewUp(e) {
  if (previewPointerId == null || (e && e.pointerId !== previewPointerId)) return;
  const id = previewDownId;
  previewPointerId = null;
  previewDownId = null;
  if (!id) return;
  const control = findControl(id);
  if (!control) return;
  const el = UI.controls.querySelector(`.ctrl[data-id="${id}"]`);
  if (isToggle(control)) {
    if (latched.has(control.id)) latched.delete(control.id);
    else latched.add(control.id);
    if (el) applyButtonLook(el, control, latched.has(control.id));
    executePreviewActions(control, 'clickEvent');
  } else if (el) {
    applyButtonLook(el, control, false);
    el.classList.remove('is-pressed');
  }
}

function isToggle(control) {
  return Boolean(control.event?.clickEvent?.autoKeep || control.event?.longPressEvent?.autoKeep);
}
function elPress(el, control) {
  if (control.type === 'direction') { el.classList.add('is-pressed'); return; }
  if (isToggle(control)) return;
  applyButtonLook(el, control, true);
  el.classList.add('is-pressed');
}

function executePreviewActions(control, triggerKey) {
  if (control.type !== 'button') return;
  const ev = control.event?.[triggerKey];
  if (!ev) return;
  const msgs = [];
  let groupChanged = false;
  (ev.bindViewGroup || []).forEach((bind) => {
    const [gid, mode] = String(bind).split(':');
    const group = findGroup(gid);
    if (!group) return;
    const current = previewGroupVisible.get(gid) !== false;
    let next = current;
    if (mode === 'show') next = true;
    else if (mode === 'hide') next = false;
    else next = !current;
    if (next !== current) groupChanged = true;
    previewGroupVisible.set(gid, next);
    msgs.push(`${mode === 'show' ? '显示' : mode === 'hide' ? '隐藏' : '切换'}「${group.name}」`);
  });
  if (groupChanged) renderStage();
  if (msgs.length) {
    window.dispatchEvent(new CustomEvent('app:preview-action', {
      detail: { control, action: `已${msgs.join('、')}` },
    }));
  } else if (ev.outputKeycodes?.length) {
    window.dispatchEvent(new CustomEvent('app:preview-action', {
      detail: { control, action: `发送 ${keycodesLabel(ev.outputKeycodes)}` },
    }));
  }
}

function applyButtonLook(el, control, pressed) {
  if (control.type === 'direction') { el.style.filter = pressed ? 'brightness(1.35)' : ''; return; }
  const s = control.style || {};
  const pick = pressed
    ? { fill: s.fillColorPressed ?? s.fillColor, stroke: s.strokeColorPressed ?? s.strokeColor, text: s.textColorPressed ?? s.textColor, radius: s.cornerRadiusPressed ?? s.cornerRadius }
    : { fill: s.fillColor, stroke: s.strokeColor, text: s.textColor, radius: s.cornerRadius };
  el.style.background = cssColor(pick.fill ?? 0);
  el.style.borderColor = cssColor(pick.stroke ?? 0);
  el.style.color = cssColor(pick.text ?? -1);
  el.style.borderRadius = (pick.radius || 0) / 10 * DENSITY + 'px';
  el.classList.toggle('is-latched', pressed);
}

/* ---------------------------------------------------------------- 键盘 */
function onKeyDown(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  const meta = e.ctrlKey || e.metaKey;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selection.length) { e.preventDefault(); window.dispatchEvent(new CustomEvent('app:delete')); }
    return;
  }
  if (e.key === 'Escape') {
    if (document.body.classList.contains('zen-mode')) { window.dispatchEvent(new CustomEvent('app:toggle-zen')); }
    else { setSelection([]); renderStage(); }
    return;
  }
  if (['1', '2', '3'].includes(e.key)) { setMode({ 1: 'select', 2: 'move', 3: 'preview' }[e.key]); return; }
  if (e.key.toLowerCase() === 'f' && !meta) { window.dispatchEvent(new CustomEvent('app:toggle-zen')); return; }
  if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); select(state.controls.map((c) => c.id)); return; }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); window.dispatchEvent(new CustomEvent('app:duplicate')); return; }
  if (meta && e.key.toLowerCase() === 'e') { e.preventDefault(); window.dispatchEvent(new CustomEvent('app:export')); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (!state.selection.length) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const map = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    const [dx, dy] = map[e.key];
    selectedControls().forEach((c) => {
      c.base.x = Math.max(0, Math.min(1000, c.base.x + dx));
      c.base.y = Math.max(0, Math.min(1000, c.base.y + dy));
      applyElRect(c);
    });
    syncOverlay();
    emit('nudge', { skipStage: true });
  }
}
