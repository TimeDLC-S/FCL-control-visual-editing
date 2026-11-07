/* =========================================================================
 * data.js —— 常量、颜色工具、事件模板、内置预设
 * 数据模型与 FCL 控制器 JSON 对齐：
 *   控件位置/尺寸用千分比；颜色用 Android ARGB 有符号整数；
 *   事件字段直接使用 FCL 的四个事件 + 10 个动作字段。
 * ========================================================================= */

/* ------------------------------------------------------------------ 画布 */
export const ASPECTS = {
  '16:9': { label: '横屏 16:9', w: 1920, h: 1080 },
  '19.5:9': { label: '横屏 19.5:9', w: 1920, h: 886 },
  '20:9': { label: '横屏 20:9', w: 1920, h: 864 },
};

/* 控件组配色（画布/逻辑图通用） */
export const GROUP_COLORS = [
  '#64e2ff', '#ffcf6e', '#ff9f7a', '#9d8cff', '#7ce38b',
  '#ff8fbf', '#7ad7d0', '#d7c46e', '#8fb8ff', '#d08cff',
];

export function makeGroup(name, visibility = 'VISIBLE', colorIndex = 0, id = null) {
  return {
    id: id || uid(),
    name,
    visibility: visibility === 'INVISIBLE' ? 'INVISIBLE' : 'VISIBLE',
    color: GROUP_COLORS[colorIndex % GROUP_COLORS.length],
  };
}

/* 预览用虚拟像素密度：把 FCL 的 dp/sp/10倍值换算成舞台像素 */
export const DENSITY = 2.5;

/* ------------------------------------------------------------- 颜色工具 */
export function int32(value) {
  const v = typeof value === 'string' ? parseHex(value) : value;
  const u = v >>> 0;
  return u >= 0x80000000 ? u - 0x100000000 : u;
}

function parseHex(hex) {
  let s = hex.replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 6) s += 'ff';
  return parseInt(s, 16) >>> 0;
}

export function toRgba(color) {
  const u = color >>> 0;
  return {
    r: (u >>> 16) & 0xff,
    g: (u >>> 8) & 0xff,
    b: u & 0xff,
    a: (u >>> 24) & 0xff,
  };
}

export function cssColor(color) {
  const { r, g, b, a } = toRgba(color);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function hexOf(color) {
  const { r, g, b, a } = toRgba(color);
  const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { hex: '#' + hex, alpha: Math.round((a / 255) * 100) };
}

export function argb(hex, alphaPercent = 100) {
  const { r, g, b } = toRgba(parseHex(hex));
  const a = Math.max(0, Math.min(255, Math.round((alphaPercent / 100) * 255)));
  return int32((a << 24) | (r << 16) | (g << 8) | b);
}

/* --------------------------------------------------------------- 事件模板 */
export const EMPTY_EVENT = () => ({
  autoKeep: false,
  autoClick: false,
  openMenu: false,
  switchTouchMode: false,
  switchMouseMode: false,
  input: false,
  quickInput: false,
  outputText: '',
  outputKeycodes: [],
  bindViewGroup: [],
});

export const TRIGGERS = {
  press: 'pressEvent',
  longPress: 'longPressEvent',
  click: 'clickEvent',
  doubleClick: 'doubleClickEvent',
};

export const TRIGGER_LABELS = {
  press: '按下',
  longPress: '长按',
  click: '轻点',
  doubleClick: '双击',
};

/**
 * 生成按钮事件数据。
 * @param {object} spec
 *   trigger: press|longPress|click|doubleClick
 *   keycodes: number[]
 *   pointerFollow / movable / swipable
 *   autoKeep / autoClick / openMenu / switchTouchMode / switchMouseMode /
 *   input / quickInput / outputText
 */
export function makeButtonEvent(spec = {}) {
  const {
    trigger = 'press',
    pointerFollow = false,
    movable = false,
    swipable = false,
    keycodes = [],
    autoKeep = false,
    autoClick = false,
    openMenu = false,
    switchTouchMode = false,
    switchMouseMode = false,
    input = false,
    quickInput = false,
    outputText = '',
  } = spec;
  const event = {
    pointerFollow,
    Movable: movable,
    swipable,
    pressEvent: EMPTY_EVENT(),
    longPressEvent: EMPTY_EVENT(),
    clickEvent: EMPTY_EVENT(),
    doubleClickEvent: EMPTY_EVENT(),
  };
  Object.assign(event[TRIGGERS[trigger] || 'pressEvent'], {
    autoKeep,
    autoClick,
    openMenu,
    switchTouchMode,
    switchMouseMode,
    input,
    quickInput,
    outputText,
    outputKeycodes: [...keycodes],
    bindViewGroup: [],
  });
  return event;
}

export function makeDirectionEvent(over = {}) {
  return {
    upKeycode: [17],
    downKeycode: [31],
    leftKeycode: [30],
    rightKeycode: [32],
    followOption: 'CENTER_FOLLOW',
    sneak: true,
    sneakKeycode: 42,
    deadZone: 10,
    canLock: false,
    lockThreshold: 30,
    ...over,
  };
}

/* --------------------------------------------------------------- 样式模板 */
export function makeButtonStyle(over = {}) {
  return {
    textColor: -1,
    textSize: 12,
    strokeColor: int32(0x66ffffff),
    strokeWidth: 20,
    cornerRadius: 100,
    fillColor: int32(0x33000000),
    textColorPressed: int32(0xff0a0e13),
    textSizePressed: 12,
    strokeColorPressed: -1,
    strokeWidthPressed: 20,
    cornerRadiusPressed: 100,
    fillColorPressed: int32(0xccffffff),
    ...over,
  };
}

export const STYLE_LIB = {
  basic: makeButtonStyle(),
  action: makeButtonStyle({
    cornerRadius: 500,
    fillColor: int32(0x3d0e1820),
    strokeColor: int32(0x66ffffff),
  }),
  combat: makeButtonStyle({
    cornerRadius: 500,
    fillColor: int32(0x40ff6b6b),
    strokeColor: int32(0x99ff9a9a),
    fillColorPressed: int32(0xdfff8a8a),
  }),
  toggle: makeButtonStyle({
    fillColor: int32(0x33ffcf6e),
    strokeColor: int32(0x66ffcf6e),
    textColor: int32(0xffffe6b0),
    fillColorPressed: int32(0xccffcf6e),
    textColorPressed: int32(0xff2a1d00),
    strokeColorPressed: int32(0xffffd98a),
  }),
  text: makeButtonStyle({
    textColor: int32(0xe6edf7),
    textSize: 12,
    strokeColor: 0,
    strokeWidth: 0,
    cornerRadius: 0,
    fillColor: 0,
    textColorPressed: -1,
    strokeColorPressed: 0,
    strokeWidthPressed: 0,
    cornerRadiusPressed: 0,
    fillColorPressed: 0,
  }),
  panel: makeButtonStyle({
    textColor: int32(0xccffffff),
    textSize: 12,
    strokeColor: int32(0x33ffffff),
    strokeWidth: 20,
    cornerRadius: 120,
    fillColor: int32(0xb30a0f15),
    fillColorPressed: int32(0xb30a0f15),
    strokeColorPressed: int32(0x33ffffff),
    textColorPressed: int32(0xccffffff),
    cornerRadiusPressed: 120,
    strokeWidthPressed: 20,
  }),
  muted: makeButtonStyle({
    textColor: int32(0x99ffffff),
    fillColor: int32(0x22000000),
    strokeColor: int32(0x33ffffff),
  }),
};

export function makeRockerStyle(over = {}) {
  return {
    name: '工坊:摇杆',
    styleType: 'ROCKER',
    buttonStyle: makeButtonStyle({ cornerRadius: 500 }),
    rockerStyle: {
      rockerSize: 400,
      bgCornerRadius: 500,
      bgStrokeWidth: 20,
      bgStrokeColor: int32(0x66ffffff),
      bgFillColor: int32(0x33000000),
      rockerCornerRadius: 500,
      rockerStrokeWidth: 10,
      rockerStrokeColor: -1,
      rockerFillColor: int32(0x88ffffff),
    },
    ...over,
  };
}

export function makeDpadStyle(over = {}) {
  return {
    name: '工坊:十字键',
    styleType: 'BUTTON',
    buttonStyle: makeButtonStyle({
      interval: 60,
      cornerRadius: 500,
      fillColor: int32(0x33000000),
      strokeColor: int32(0x66ffffff),
    }),
    rockerStyle: makeRockerStyle().rockerStyle,
    ...over,
  };
}

/* --------------------------------------------------------------- 键码名称 */
export const KEYCODE_NAMES = {
  1: 'Esc', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
  12: '-', 13: '=', 14: 'Backspace', 15: 'Tab', 16: 'Q', 17: 'W', 18: 'E', 19: 'R', 20: 'T',
  21: 'Y', 22: 'U', 23: 'I', 24: 'O', 25: 'P', 26: '[', 27: ']', 28: 'Enter', 29: 'Ctrl',
  30: 'A', 31: 'S', 32: 'D', 33: 'F', 34: 'G', 35: 'H', 36: 'J', 37: 'K', 38: 'L', 39: ';',
  40: "'", 41: '`', 42: 'Shift', 43: '\\', 44: 'Z', 45: 'X', 46: 'C', 47: 'V', 48: 'B', 49: 'N',
  50: 'M', 51: ',', 52: '.', 53: '/', 54: 'RShift', 55: '*', 56: 'Alt', 57: '空格', 58: 'Caps',
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6', 65: 'F7', 66: 'F8', 67: 'F9',
  68: 'F10', 69: 'NumLock', 70: 'ScrollLock', 87: 'F11', 88: 'F12', 96: 'NumEnter',
  97: 'RCtrl', 98: 'Num/', 99: 'SysRq', 100: 'RAlt', 102: 'Home', 103: '↑', 104: 'PgUp',
  105: '←', 106: '→', 107: 'End', 108: '↓', 109: 'PgDn', 110: 'Insert', 111: 'Delete',
  1000: '鼠标左键', 1001: '鼠标中键', 1002: '鼠标右键', 1003: '滚轮上', 1004: '滚轮下',
};

/* 补全 FCLKeycodes 中的键名（键位选择器用） */
Object.assign(KEYCODE_NAMES, {
  0: '无', 13: '=', 26: '[', 27: ']', 43: '\\', 54: 'RShift', 55: 'KP*', 58: 'Caps',
  69: 'NumLock', 70: 'ScrollLock',
  71: 'KP7', 72: 'KP8', 73: 'KP9', 74: 'KP-', 75: 'KP4', 76: 'KP5', 77: 'KP6',
  78: 'KP+', 79: 'KP1', 80: 'KP2', 81: 'KP3', 82: 'KP0', 83: 'KP.', 96: 'KPEnter',
  97: 'RCtrl', 98: 'KP/', 99: 'SysRq', 100: 'RAlt', 102: 'Home', 103: '↑', 104: 'PgUp',
  105: '←', 106: '→', 107: 'End', 108: '↓', 109: 'PgDn', 110: 'Insert', 111: 'Delete',
  117: 'KP=', 119: 'Pause', 121: 'KP,', 125: 'LMeta', 126: 'RMeta',
  183: 'F13', 184: 'F14', 185: 'F15', 186: 'F16', 187: 'F17', 188: 'F18', 189: 'F19',
  190: 'F20', 191: 'F21', 192: 'F22', 193: 'F23', 194: 'F24', 240: '未知',
});

export const KEYCODE_GROUPS = [
  {
    name: '常用',
    codes: [1, 15, 58, 42, 54, 29, 97, 56, 100, 57, 28, 14, 111, 110, 102, 107, 104, 109, 103, 108, 105, 106],
  },
  {
    name: '字母',
    codes: [30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31, 20,
      22, 47, 17, 45, 21, 44],
  },
  {
    name: '数字符号',
    codes: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 26, 27, 39, 40, 41, 43, 51, 52, 53],
  },
  {
    name: '功能键',
    codes: [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 69, 70, 99, 119, 125, 126, 240],
  },
  {
    name: '小键盘',
    codes: [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 96, 98, 117, 121, 55],
  },
  {
    name: '鼠标',
    codes: [1000, 1001, 1002, 1003, 1004],
  },
];

export const DEFAULT_PRESET_CATEGORY = '默认';

export function keycodeName(code) {
  return KEYCODE_NAMES[code] || String(code);
}

export function keycodesLabel(codes) {
  if (!codes || !codes.length) return '—';
  return codes.map(keycodeName).join(' + ');
}

/* --------------------------------------------------------------- 内置预设 */
const P = (id, kind, group, name, hint, extra) => ({ id, kind, group, name, hint, ...extra });

const btn = (text, styleKey, w, h, eventSpec, extra = {}) => ({
  text,
  base: { w, h, ref: 'SCREEN_WIDTH' },
  style: STYLE_LIB[styleKey],
  event: makeButtonEvent(eventSpec),
  ...extra,
});

export const BUILTIN_PRESETS = [
  /* ------------------------------------------------ 移动 */
  P('builtin.w', 'button', '移动', 'W', '前进', btn('W', 'basic', 120, 120, { keycodes: [17] })),
  P('builtin.a', 'button', '移动', 'A', '左移', btn('A', 'basic', 120, 120, { keycodes: [30] })),
  P('builtin.s', 'button', '移动', 'S', '后退', btn('S', 'basic', 120, 120, { keycodes: [31] })),
  P('builtin.d', 'button', '移动', 'D', '右移', btn('D', 'basic', 120, 120, { keycodes: [32] })),

  /* ------------------------------------------------ 动作 */
  P('builtin.jump', 'button', '动作', '跳', '空格 Space',
    btn('跳', 'action', 140, 140, { keycodes: [57] })),
  P('builtin.sneak', 'button', '动作', '潜行', '点按切换 Shift',
    btn('潜', 'toggle', 140, 140, { trigger: 'click', autoKeep: true, keycodes: [42] })),
  P('builtin.sprint', 'button', '动作', '疾跑', '点按切换 Ctrl',
    btn('疾', 'toggle', 120, 120, { trigger: 'click', autoKeep: true, keycodes: [29] })),

  /* ------------------------------------------------ 战斗 */
  P('builtin.attack', 'button', '战斗', '攻击', '鼠标左键 · 可拖视角',
    btn('攻\n击', 'combat', 150, 150,
      { keycodes: [1000], pointerFollow: true, swipable: true })),
  P('builtin.use', 'button', '战斗', '使用', '鼠标右键 · 可拖视角',
    btn('使\n用', 'combat', 150, 150,
      { keycodes: [1002], pointerFollow: true, swipable: true })),

  /* ------------------------------------------------ 功能 */
  P('builtin.inventory', 'button', '功能', '背包', 'E',
    btn('E', 'basic', 100, 100, { keycodes: [18] })),
  P('builtin.drop', 'button', '功能', '丢弃', 'Q',
    btn('Q', 'basic', 100, 100, { keycodes: [16] })),
  P('builtin.chat', 'button', '功能', '聊天', 'T',
    btn('T', 'basic', 100, 100, { keycodes: [20] })),
  P('builtin.esc', 'button', '功能', 'Esc', '暂停/返回',
    btn('Esc', 'muted', 120, 120, { keycodes: [1] })),
  P('builtin.f3', 'button', '功能', 'F3', '调试信息',
    btn('F3', 'muted', 120, 120, { keycodes: [61] })),
  P('builtin.menu', 'button', '功能', '菜单', 'openMenu',
    btn('菜单', 'muted', 120, 120, { trigger: 'press', openMenu: true })),
  P('builtin.quickInput', 'button', '功能', '快捷输入', 'quickInput',
    btn('快捷', 'muted', 120, 120, { trigger: 'click', quickInput: true })),
  P('builtin.command', 'button', '功能', '指令', 'outputText 示例',
    btn('白天', 'muted', 120, 120, { trigger: 'click', outputText: '/time set day' })),

  /* ------------------------------------------------ 面板 / 文本 */
  P('builtin.panel', 'button', '面板', '半透明面板', '当背景/弹窗底板',
    {
      text: '',
      base: { w: 800, h: 400, ref: 'SCREEN_WIDTH' },
      style: STYLE_LIB.panel,
      event: makeButtonEvent({}),
      isPanel: true,
    }),
  P('builtin.text', 'button', '面板', '文字标签', '纯文字',
    {
      text: '文字',
      base: { w: 300, h: 60, ref: 'SCREEN_WIDTH' },
      style: STYLE_LIB.text,
      event: makeButtonEvent({}),
      isPanel: true,
    }),

  /* ------------------------------------------------ 方向键 */
  P('builtin.rocker', 'direction', '方向', '摇杆', 'ROCKER · WASD 移动',
    {
      text: '',
      base: { w: 450, h: 450, ref: 'SCREEN_WIDTH' },
      dirStyle: makeRockerStyle(),
      dirEvent: makeDirectionEvent({ deadZone: 10 }),
    }),
  P('builtin.dpad', 'direction', '方向', '十字键', 'BUTTON · WASD 移动',
    {
      text: '',
      base: { w: 450, h: 450, ref: 'SCREEN_WIDTH' },
      dirStyle: makeDpadStyle(),
      dirEvent: makeDirectionEvent({ deadZone: 0 }),
    }),
];

export const PALETTE_GROUPS = ['移动', '动作', '战斗', '功能', '面板', '方向'];

/* --------------------------------------------------------------- 控件工厂 */
let seed = 0;
export function uid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  seed += 1;
  return `ctrl-${Date.now().toString(36)}-${seed}`;
}

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 由预设生成控件实例 */
export function createControlFromPreset(preset, groupId = null) {
  const base = {
    x: 500,
    y: 500,
    w: preset.base?.w ?? 120,
    h: preset.base?.h ?? 120,
    ref: preset.base?.ref ?? 'SCREEN_WIDTH',
    visibility: 'ALWAYS',
  };
  const control = {
    id: uid(),
    groupId,
    type: preset.kind,
    presetId: preset.id,
    presetName: preset.name,
    text: preset.text ?? '',
    base,
    style: preset.style ? clone(preset.style) : STYLE_LIB.basic,
    event: preset.event ? clone(preset.event) : makeButtonEvent({}),
    isPanel: Boolean(preset.isPanel),
  };
  if (preset.kind === 'direction') {
    control.dirStyle = clone(preset.dirStyle);
    control.dirEvent = clone(preset.dirEvent);
    control.base.h = control.base.w;
  }
  return control;
}

/** 由预设生成自定义预设（用于“另存为自定义”） */
export function createCustomPresetFromControl(control, name) {
  return {
    id: 'custom.' + uid(),
    kind: control.type,
    group: '自定义',
    name: name || control.presetName || '自定义预设',
    hint: control.type === 'direction' ? '自定义方向' : '自定义按键',
    text: control.text,
    base: { w: control.base.w, h: control.base.h, ref: control.base.ref },
    style: clone(control.style),
    event: clone(control.event),
    isPanel: Boolean(control.isPanel),
    dirStyle: control.dirStyle ? clone(control.dirStyle) : undefined,
    dirEvent: control.dirEvent ? clone(control.dirEvent) : undefined,
  };
}
