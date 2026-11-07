/* =========================================================================
 * store.js —— 应用状态、选中逻辑、控件组、本地持久化、自定义预设
 * 所有 UI 模块订阅 store，状态变化后由 main.js 统一重绘。
 * ========================================================================= */
import {
  ASPECTS,
  BUILTIN_PRESETS,
  GROUP_COLORS,
  clone,
  createControlFromPreset,
  createCustomPresetFromControl,
  DEFAULT_PRESET_CATEGORY,
  makeButtonEvent,
  makeGroup,
  uid,
} from './data.js';

const STORAGE_KEY = 'fcl-workbench-v1';
const PRESET_KEY = 'fcl-workbench-presets-v1';

const listeners = new Set();
let saveTimer = null;

export const state = {
  meta: { name: '未命名键位', author: '', version: '1.0', versionCode: 1 },
  canvas: {
    aspect: '16:9',
    customW: 1920,
    customH: 1080,
    grid: true,
    snap: true,
    gridStep: 10,
    multiSelect: false,
    previewState: 'in_game',
    groupCollapsed: false,
  },
  mode: 'select',
  groups: [],
  activeGroupId: null,
  controls: [],
  selection: [],
  logic: { positions: {} },
};

export const customPresets = [];
export const presetCategories = [DEFAULT_PRESET_CATEGORY];

const history = [];
const HISTORY_MAX = 40;

function defaultGroup() {
  return makeGroup('主布局', 'VISIBLE', 0);
}

function ensureGroups() {
  if (!Array.isArray(state.groups) || state.groups.length === 0) {
    const g = defaultGroup();
    state.groups = [g];
    state.activeGroupId = g.id;
  }
  if (!state.activeGroupId || !state.groups.some((g) => g.id === state.activeGroupId)) {
    state.activeGroupId = state.groups[0].id;
  }
}

/* --------------------------------------------------------------- 订阅通知 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason = 'change', flags = {}) {
  listeners.forEach((fn) => fn(reason, flags));
  if (reason === 'saved') return;
  scheduleSave();
}

/* --------------------------------------------------------------- 持久化 */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function localStorageAvailable() {
  try {
    const k = '__probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function normalizeGroup(g, index) {
  if (!g || typeof g !== 'object') return null;
  return {
    id: typeof g.id === 'string' && g.id ? g.id : uid(),
    name: typeof g.name === 'string' && g.name ? g.name : `控件组 ${index + 1}`,
    visibility: g.visibility === 'INVISIBLE' ? 'INVISIBLE' : 'VISIBLE',
    color: typeof g.color === 'string' ? g.color : GROUP_COLORS[index % GROUP_COLORS.length],
  };
}

export function loadFromStorage() {
  if (!localStorageAvailable()) {
    ensureGroups();
    return;
  }
  const raw = safeParse(localStorage.getItem(STORAGE_KEY));
  if (raw && Array.isArray(raw.controls)) {
    state.meta = { ...state.meta, ...(raw.meta || {}) };
    state.canvas = { ...state.canvas, ...(raw.canvas || {}) };
    state.logic = { positions: {}, ...(raw.logic || {}) };
    if (!state.logic.positions || typeof state.logic.positions !== 'object') state.logic.positions = {};
    if (!ASPECTS[state.canvas.aspect] && state.canvas.aspect !== 'custom') state.canvas.aspect = '16:9';
    state.mode = raw.mode === 'move' || raw.mode === 'preview' ? raw.mode : 'select';
    const groups = (Array.isArray(raw.groups) ? raw.groups : []).map(normalizeGroup).filter(Boolean);
    state.groups = groups;
    ensureGroups();
    state.activeGroupId = raw.activeGroupId && groups.some((g) => g.id === raw.activeGroupId)
      ? raw.activeGroupId : state.groups[0].id;
    state.controls = raw.controls.map((c) => normalizeControl(c, state.groups[0].id)).filter(Boolean);
  } else {
    ensureGroups();
  }
  const presetRaw = safeParse(localStorage.getItem(PRESET_KEY));
  const presets = Array.isArray(presetRaw) ? presetRaw : presetRaw?.presets;
  if (Array.isArray(presetRaw?.categories) && presetRaw.categories.length) {
    presetCategories.length = 0;
    presetRaw.categories.forEach((c) => {
      if (typeof c === 'string' && c && !presetCategories.includes(c)) presetCategories.push(c);
    });
  }
  if (!presetCategories.includes(DEFAULT_PRESET_CATEGORY)) presetCategories.unshift(DEFAULT_PRESET_CATEGORY);
  if (Array.isArray(presets)) {
    customPresets.length = 0;
    presets.map(normalizePreset).filter(Boolean).forEach((p) => customPresets.push(p));
  }
}

function normalizeControl(c, fallbackGroupId) {
  if (!c || typeof c !== 'object') return null;
  const base = { x: 500, y: 500, w: 120, h: 120, ref: 'SCREEN_WIDTH', visibility: 'ALWAYS', ...(c.base || {}) };
  base.w = Math.max(10, Math.min(1000, Math.round(Number(base.w) || 120)));
  base.h = Math.max(10, Math.min(1000, Math.round(Number(base.h) || 120)));
  base.x = Math.max(0, Math.min(1000, Math.round(Number(base.x) || 0)));
  base.y = Math.max(0, Math.min(1000, Math.round(Number(base.y) || 0)));
  const groupId = typeof c.groupId === 'string' && state.groups.some((g) => g.id === c.groupId)
    ? c.groupId : fallbackGroupId;
  return {
    id: c.id || uid(),
    groupId,
    type: c.type === 'direction' ? 'direction' : 'button',
    presetId: c.presetId || null,
    presetName: c.presetName || '控件',
    text: typeof c.text === 'string' ? c.text : '',
    base,
    style: c.style || {},
    event: c.event || makeButtonEvent({}),
    isPanel: Boolean(c.isPanel),
    dirStyle: c.dirStyle,
    dirEvent: c.dirEvent,
  };
}

function normalizePreset(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: p.id || 'custom.' + uid(),
    kind: p.kind === 'direction' ? 'direction' : 'button',
    group: '自定义',
    category: typeof p.category === 'string' && p.category ? p.category : DEFAULT_PRESET_CATEGORY,
    name: p.name || '自定义预设',
    hint: p.hint || (p.kind === 'direction' ? '自定义方向' : '自定义按键'),
    text: typeof p.text === 'string' ? p.text : '',
    base: { w: 120, h: 120, ref: 'SCREEN_WIDTH', ...(p.base || {}) },
    style: p.style || {},
    event: p.event || makeButtonEvent({}),
    isPanel: Boolean(p.isPanel),
    dirStyle: p.dirStyle,
    dirEvent: p.dirEvent,
    custom: true,
  };
}

export function scheduleSave() {
  if (!localStorageAvailable()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        meta: state.meta,
        canvas: state.canvas,
        mode: state.mode,
        groups: state.groups,
        activeGroupId: state.activeGroupId,
        controls: state.controls,
        logic: state.logic,
      }));
      localStorage.setItem(PRESET_KEY, JSON.stringify({
        categories: presetCategories,
        presets: customPresets,
      }));
    } catch (err) {
      console.warn('保存失败', err);
    }
    emit('saved');
  }, 260);
}

export function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      meta: state.meta,
      canvas: state.canvas,
      mode: state.mode,
      groups: state.groups,
      activeGroupId: state.activeGroupId,
      controls: state.controls,
      logic: state.logic,
    }));
    localStorage.setItem(PRESET_KEY, JSON.stringify({
      categories: presetCategories,
      presets: customPresets,
    }));
  } catch { /* 忽略 */ }
  emit('saved');
}

/* --------------------------------------------------------------- 尺寸工具 */
export function stageDims() {
  const c = state.canvas;
  if (c.aspect === 'custom') {
    return {
      w: Math.max(320, Math.min(4096, Math.round(Number(c.customW) || 1920))),
      h: Math.max(240, Math.min(4096, Math.round(Number(c.customH) || 1080))),
    };
  }
  return ASPECTS[c.aspect] || ASPECTS['16:9'];
}

/** 控件在舞台虚拟像素中的矩形 */
export function controlRect(control) {
  const { w: stageW, h: stageH } = stageDims();
  const baseDim = control.base.ref === 'SCREEN_HEIGHT' ? stageH : stageW;
  const wPx = (baseDim * control.base.w) / 1000;
  const hPx = (baseDim * control.base.h) / 1000;
  const xPx = ((stageW - wPx) * control.base.x) / 1000;
  const yPx = ((stageH - hPx) * control.base.y) / 1000;
  return { x: xPx, y: yPx, w: wPx, h: hPx };
}

export function findControl(id) {
  return state.controls.find((c) => c.id === id) || null;
}

export function selectedControls() {
  return state.selection.map(findControl).filter(Boolean);
}

export function findGroup(id) {
  return state.groups.find((g) => g.id === id) || null;
}

export function groupControls(groupId) {
  return state.controls.filter((c) => c.groupId === groupId);
}

/* --------------------------------------------------------------- 控件组 */
export function addGroup(name) {
  snapshot();
  const group = makeGroup(name || `控件组 ${state.groups.length + 1}`, 'VISIBLE',
    state.groups.length % GROUP_COLORS.length);
  state.groups.push(group);
  state.activeGroupId = group.id;
  emit('group');
  return group;
}

export function renameGroup(id, name) {
  const group = findGroup(id);
  if (!group) return;
  snapshot();
  group.name = name;
  emit('group');
}

export function updateGroup(id, patch) {
  const group = findGroup(id);
  if (!group) return;
  snapshot();
  Object.assign(group, patch);
  if (group.visibility === 'INVISIBLE') {
    const hiddenIds = new Set(state.controls.filter((c) => c.groupId === group.id).map((c) => c.id));
    state.selection = state.selection.filter((id) => !hiddenIds.has(id));
  }
  emit('group');
}

export function removeGroup(id) {
  if (state.groups.length <= 1) return;
  snapshot();
  const idx = state.groups.findIndex((g) => g.id === id);
  if (idx < 0) return;
  state.groups.splice(idx, 1);
  const fallback = state.groups[Math.max(0, idx - 1)];
  state.controls.forEach((c) => {
    if (c.groupId === id) c.groupId = fallback.id;
  });
  if (state.activeGroupId === id) state.activeGroupId = fallback.id;
  emit('group');
}

export function setActiveGroup(id) {
  if (!findGroup(id)) return;
  state.activeGroupId = id;
  emit('group');
}

export function moveSelectedToGroup(groupId) {
  if (!findGroup(groupId) || !state.selection.length) return;
  snapshot();
  selectedControls().forEach((c) => { c.groupId = groupId; });
  emit('group');
}

/* --------------------------------------------------------------- 历史/撤销 */
export function snapshot() {
  history.push({
    controls: clone(state.controls),
    groups: clone(state.groups),
    meta: clone(state.meta),
    activeGroupId: state.activeGroupId,
    categories: [...presetCategories],
    presets: clone(customPresets),
    logic: clone(state.logic || { positions: {} }),
  });
  if (history.length > HISTORY_MAX) history.shift();
  emit('history', { skipStage: true });
}

export function canUndo() {
  return history.length > 0;
}

export function undo() {
  const snap = history.pop();
  if (!snap) return false;
  state.controls = snap.controls;
  state.groups = snap.groups;
  state.meta = snap.meta;
  state.activeGroupId = snap.activeGroupId;
  state.logic = snap.logic || { positions: {} };
  state.selection = [];
  presetCategories.length = 0;
  snap.categories.forEach((c) => presetCategories.push(c));
  customPresets.length = 0;
  snap.presets.forEach((p) => customPresets.push(p));
  emit('undo');
  return true;
}

export function moveGroup(id, delta) {
  const index = state.groups.findIndex((g) => g.id === id);
  if (index < 0) return false;
  const target = index + delta;
  if (target < 0 || target >= state.groups.length) return false;
  snapshot();
  const [group] = state.groups.splice(index, 1);
  state.groups.splice(target, 0, group);
  emit('group-order');
  return true;
}

export function toggleGroupVisibility(id) {
  const group = findGroup(id);
  if (!group) return null;
  updateGroup(id, { visibility: group.visibility === 'VISIBLE' ? 'INVISIBLE' : 'VISIBLE' });
  return group.visibility;
}

/* ---------------------------------------------------------- 预设分类管理 */
export function addPresetCategory(name) {
  const value = String(name || '').trim();
  if (!value || presetCategories.includes(value)) return false;
  snapshot();
  presetCategories.push(value);
  emit('preset-category');
  return true;
}

export function renamePresetCategory(from, to) {
  const value = String(to || '').trim();
  if (!value || !presetCategories.includes(from) || from === DEFAULT_PRESET_CATEGORY) return false;
  if (presetCategories.includes(value)) return false;
  snapshot();
  presetCategories[presetCategories.indexOf(from)] = value;
  customPresets.forEach((p) => { if (p.category === from) p.category = value; });
  emit('preset-category');
  return true;
}

export function removePresetCategory(name) {
  if (!presetCategories.includes(name) || name === DEFAULT_PRESET_CATEGORY) return false;
  snapshot();
  presetCategories.splice(presetCategories.indexOf(name), 1);
  customPresets.forEach((p) => { if (p.category === name) p.category = DEFAULT_PRESET_CATEGORY; });
  emit('preset-category');
  return true;
}

/* ---------------------------------------------------------- 逻辑图位置 */
export function setLogicPosition(groupId, x, y) {
  if (!state.logic) state.logic = { positions: {} };
  state.logic.positions[groupId] = { x: Math.round(x), y: Math.round(y) };
  emit('logic-position', { skipStage: true });
}

export function clearLogicPosition(groupId) {
  if (state.logic?.positions) delete state.logic.positions[groupId];
  emit('logic-position', { skipStage: true });
}

/* --------------------------------------------------------------- 控件操作 */
export function addPreset(preset) {
  snapshot();
  ensureGroups();
  const control = createControlFromPreset(preset, state.activeGroupId);
  const offset = (state.controls.length % 6) * 22;
  control.base.x = Math.max(0, Math.min(1000, 500 - Math.round(control.base.w / 4) + offset));
  control.base.y = Math.max(0, Math.min(1000, 500 - Math.round(control.base.h / 4) + offset));
  state.controls.push(control);
  state.selection = [control.id];
  emit('add');
  return control;
}

export function duplicateSelected() {
  snapshot();
  const source = selectedControls();
  if (!source.length) return;
  const created = source.map((c) => {
    const copy = clone(c);
    copy.id = uid();
    copy.base.x = Math.max(0, Math.min(1000, copy.base.x + 20));
    copy.base.y = Math.max(0, Math.min(1000, copy.base.y + 20));
    return copy;
  });
  state.controls.push(...created);
  state.selection = created.map((c) => c.id);
  emit('duplicate');
}

export function deleteSelected() {
  snapshot();
  if (!state.selection.length) return;
  const set = new Set(state.selection);
  state.controls = state.controls.filter((c) => !set.has(c.id));
  state.selection = [];
  emit('delete');
}

export function select(ids, options = {}) {
  const { add = false, toggle = false, silent = false } = options;
  let next;
  if (toggle) {
    const set = new Set(state.selection);
    ids.forEach((id) => (set.has(id) ? set.delete(id) : set.add(id)));
    next = [...set];
  } else if (add) {
    next = [...new Set([...state.selection, ...ids])];
  } else {
    next = [...new Set(ids)];
  }
  state.selection = next;
  emit('select', { skipStage: silent });
}

export function clearSelection() {
  if (!state.selection.length) return;
  state.selection = [];
  emit('select');
}

export function selectAll() {
  state.selection = state.controls.map((c) => c.id);
  emit('select');
}

/** 选中某一控件组中的全部控件 */
export function selectGroup(groupId) {
  const ids = groupControls(groupId).map((c) => c.id);
  state.selection = ids;
  emit('select');
}

export function bringToFront(ids) {
  const set = new Set(ids);
  const front = state.controls.filter((c) => set.has(c.id));
  if (!front.length) return;
  state.controls = [...state.controls.filter((c) => !set.has(c.id)), ...front];
  emit('order');
}

export function nudgeSelected(dx, dy) {
  if (!state.selection.length) return;
  selectedControls().forEach((c) => {
    c.base.x = Math.max(0, Math.min(1000, c.base.x + dx));
    c.base.y = Math.max(0, Math.min(1000, c.base.y + dy));
  });
  emit('nudge');
}

export function alignSelected(kind) {
  snapshot();
  const list = selectedControls();
  if (list.length < 2) return;
  const rects = list.map((c) => ({ c, r: controlRect(c) }));
  const minX = Math.min(...rects.map((o) => o.r.x));
  const maxX = Math.max(...rects.map((o) => o.r.x + o.r.w));
  const minY = Math.min(...rects.map((o) => o.r.y));
  const maxY = Math.max(...rects.map((o) => o.r.y + o.r.h));
  const { w: stageW, h: stageH } = stageDims();
  rects.forEach(({ c, r }) => {
    if (kind === 'left') c.base.x = Math.round((minX / (stageW - r.w)) * 1000);
    if (kind === 'right') c.base.x = Math.round(((maxX - r.w) / (stageW - r.w)) * 1000);
    if (kind === 'hcenter') c.base.x = Math.round((((minX + maxX) / 2 - r.w / 2) / (stageW - r.w)) * 1000);
    if (kind === 'top') c.base.y = Math.round((minY / (stageH - r.h)) * 1000);
    if (kind === 'bottom') c.base.y = Math.round(((maxY - r.h) / (stageH - r.h)) * 1000);
    if (kind === 'vcenter') c.base.y = Math.round((((minY + maxY) / 2 - r.h / 2) / (stageH - r.h)) * 1000);
    c.base.x = Math.max(0, Math.min(1000, c.base.x));
    c.base.y = Math.max(0, Math.min(1000, c.base.y));
  });
  emit('align');
}

export function setMode(mode) {
  if (!['select', 'move', 'preview'].includes(mode)) return;
  state.mode = mode;
  if (mode === 'preview') state.selection = [];
  emit('mode');
}

export function updateMeta(patch) {
  Object.assign(state.meta, patch);
  emit('meta');
}

export function updateCanvas(patch) {
  Object.assign(state.canvas, patch);
  emit('canvas');
}

export function resetLayout() {
  snapshot();
  state.controls = [];
  state.selection = [];
  emit('reset');
}

/* --------------------------------------------------------------- 自定义预设 */
export function addCustomPreset(preset) {
  snapshot();
  customPresets.push({ ...preset, custom: true });
  emit('preset-add');
}

export function updateCustomPreset(id, preset) {
  snapshot();
  const idx = customPresets.findIndex((p) => p.id === id);
  if (idx >= 0) {
    customPresets[idx] = { ...preset, id, custom: true };
    emit('preset-update');
  }
}

export function removeCustomPreset(id) {
  snapshot();
  const idx = customPresets.findIndex((p) => p.id === id);
  if (idx >= 0) {
    customPresets.splice(idx, 1);
    emit('preset-remove');
  }
}

export function getPreset(id) {
  return BUILTIN_PRESETS.find((p) => p.id === id) || customPresets.find((p) => p.id === id) || null;
}

export function savePresetFromControl(control, name) {
  const preset = createCustomPresetFromControl(control, name);
  addCustomPreset(preset);
  return preset;
}

/** 导入/示例：批量写入控件、控件组与元数据 */
export function replaceControls(controls, metaPatch = {}, groups = null) {
  snapshot();
  if (Array.isArray(groups) && groups.length) {
    state.groups = groups.map(normalizeGroup).filter(Boolean);
  }
  ensureGroups();
  state.activeGroupId = (state.groups.find((g) => g.visibility === 'VISIBLE') || state.groups[0]).id;
  state.controls = controls.map((c) => normalizeControl(c, state.activeGroupId)).filter(Boolean);
  state.selection = [];
  Object.assign(state.meta, metaPatch);
  emit('import');
}
