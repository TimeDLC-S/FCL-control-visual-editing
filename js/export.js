/* =========================================================================
 * export.js —— 与 FCL 控制器 JSON 互转
 * 导出：把当前画布控件转换成 FCL 控制器格式（controllerVersion 21）
 * 导入：读取 FCL 控制器 JSON，映射回编辑器模型
 * 本模块不依赖 DOM，可在 Node 中直接测试。
 * ========================================================================= */
import {
  EMPTY_EVENT,
  GROUP_COLORS,
  int32,
  makeButtonEvent,
  makeButtonStyle,
  makeDpadStyle,
  makeDirectionEvent,
  makeRockerStyle,
  uid,
} from './data.js';

const CONTROLLER_VERSION = 21;

function randomId8() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function fullEvent(source) {
  const base = EMPTY_EVENT();
  if (!source || typeof source !== 'object') return base;
  return {
    ...base,
    ...source,
    outputKeycodes: Array.isArray(source.outputKeycodes) ? source.outputKeycodes.map(Number).filter(Number.isFinite) : [],
    bindViewGroup: Array.isArray(source.bindViewGroup) ? [...source.bindViewGroup] : [],
    outputText: typeof source.outputText === 'string' ? source.outputText : '',
  };
}

function fullButtonEvent(source) {
  const src = source || {};
  return {
    pointerFollow: Boolean(src.pointerFollow),
    Movable: Boolean(src.Movable),
    swipable: Boolean(src.swipable),
    pressEvent: fullEvent(src.pressEvent),
    longPressEvent: fullEvent(src.longPressEvent),
    clickEvent: fullEvent(src.clickEvent),
    doubleClickEvent: fullEvent(src.doubleClickEvent),
  };
}

function fullDirectionEvent(source) {
  const base = makeDirectionEvent();
  const src = source || {};
  const list = (value, fallback) => {
    if (Array.isArray(value) && value.length) return value.map(Number).filter(Number.isFinite);
    return [...fallback];
  };
  return {
    ...base,
    ...src,
    upKeycode: list(src.upKeycode, base.upKeycode),
    downKeycode: list(src.downKeycode, base.downKeycode),
    leftKeycode: list(src.leftKeycode, base.leftKeycode),
    rightKeycode: list(src.rightKeycode, base.rightKeycode),
    followOption: ['FIXED', 'CENTER_FOLLOW', 'FOLLOW'].includes(src.followOption) ? src.followOption : base.followOption,
    sneak: src.sneak !== undefined ? Boolean(src.sneak) : base.sneak,
    sneakKeycode: Number.isFinite(Number(src.sneakKeycode)) ? Number(src.sneakKeycode) : base.sneakKeycode,
    deadZone: clampInt(src.deadZone, 0, 100, base.deadZone),
    canLock: Boolean(src.canLock),
    lockThreshold: clampInt(src.lockThreshold, 0, 100, base.lockThreshold),
  };
}

function clampInt(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function styleSignature(style) {
  const keys = [
    'textColor', 'textSize', 'strokeColor', 'strokeWidth', 'cornerRadius', 'fillColor',
    'textColorPressed', 'textSizePressed', 'strokeColorPressed', 'strokeWidthPressed',
    'cornerRadiusPressed', 'fillColorPressed',
  ];
  return keys.map((k) => Number(style?.[k] ?? 0)).join(',');
}

function sanitizeStyle(style) {
  return {
    textColor: Number(style?.textColor ?? -1),
    textSize: clampInt(style?.textSize, 0, 200, 12),
    strokeColor: Number(style?.strokeColor ?? 0),
    strokeWidth: clampInt(style?.strokeWidth, 0, 2000, 20),
    cornerRadius: clampInt(style?.cornerRadius, 0, 2000, 100),
    fillColor: Number(style?.fillColor ?? 0),
    textColorPressed: Number(style?.textColorPressed ?? -1),
    textSizePressed: clampInt(style?.textSizePressed, 0, 200, 12),
    strokeColorPressed: Number(style?.strokeColorPressed ?? 0),
    strokeWidthPressed: clampInt(style?.strokeWidthPressed, 0, 2000, 20),
    cornerRadiusPressed: clampInt(style?.cornerRadiusPressed, 0, 2000, 100),
    fillColorPressed: Number(style?.fillColorPressed ?? 0),
  };
}

function sanitizeDirectionStyle(ds) {
  const base = ds?.styleType === 'ROCKER' ? makeRockerStyle() : makeDpadStyle();
  const buttonStyle = sanitizeStyle(ds?.buttonStyle || base.buttonStyle);
  const rockerStyle = {
    rockerSize: clampInt(ds?.rockerStyle?.rockerSize, 50, 1000, 400),
    bgCornerRadius: clampInt(ds?.rockerStyle?.bgCornerRadius, 0, 1000, 500),
    bgStrokeWidth: clampInt(ds?.rockerStyle?.bgStrokeWidth, 0, 2000, 20),
    bgStrokeColor: Number(ds?.rockerStyle?.bgStrokeColor ?? int32(0x66ffffff)),
    bgFillColor: Number(ds?.rockerStyle?.bgFillColor ?? int32(0x33000000)),
    rockerCornerRadius: clampInt(ds?.rockerStyle?.rockerCornerRadius, 0, 1000, 500),
    rockerStrokeWidth: clampInt(ds?.rockerStyle?.rockerStrokeWidth, 0, 2000, 10),
    rockerStrokeColor: Number(ds?.rockerStyle?.rockerStrokeColor ?? -1),
    rockerFillColor: Number(ds?.rockerStyle?.rockerFillColor ?? int32(0x88ffffff)),
  };
  return {
    styleType: ds?.styleType === 'ROCKER' ? 'ROCKER' : 'BUTTON',
    buttonStyle: { interval: clampInt(ds?.buttonStyle?.interval, 0, 333, 60), ...buttonStyle },
    rockerStyle,
  };
}

/* ------------------------------------------------------------------ 导出 */
export function buildController(appState) {
  const controls = appState.controls || [];
  const groups = (appState.groups && appState.groups.length)
    ? appState.groups
    : [{ id: uid(), name: '主布局', visibility: 'VISIBLE', color: GROUP_COLORS[0] }];
  const validGroupIds = new Set(groups.map((g) => g.id));
  const buttonStyles = [];
  const directionStyles = [];
  const buttonStyleIndex = new Map();
  const buttonStyleNames = new Set();
  const directionStyleIndex = new Map();
  const directionStyleNames = new Set();
  const usedStyleNames = new Set();

  function uniqueName(base, used) {
    let name = base || '工坊:样式';
    let i = 2;
    while (used.has(name)) {
      name = `${base} (${i})`;
      i += 1;
    }
    used.add(name);
    return name;
  }

  const viewGroups = groups.map((g) => ({
    id: g.id || uid(),
    name: g.name || '控件组',
    visibility: g.visibility === 'INVISIBLE' ? 'INVISIBLE' : 'VISIBLE',
    viewData: { buttonList: [], directionList: [] },
  }));
  const groupById = new Map(viewGroups.map((vg) => [vg.id, vg]));

  function baseInfoOf(control) {
    const dims = control.base || {};
    return {
      visibilityType: ['ALWAYS', 'IN_GAME', 'MENU'].includes(dims.visibility) ? dims.visibility : 'ALWAYS',
      xPosition: clampInt(dims.x, 0, 1000, 500),
      yPosition: clampInt(dims.y, 0, 1000, 500),
      sizeType: 'PERCENTAGE',
      absoluteWidth: 50,
      absoluteHeight: 50,
      percentageWidth: {
        reference: dims.ref === 'SCREEN_HEIGHT' ? 'SCREEN_HEIGHT' : 'SCREEN_WIDTH',
        size: clampInt(dims.w, 1, 1000, 120),
      },
      percentageHeight: {
        reference: dims.ref === 'SCREEN_HEIGHT' ? 'SCREEN_HEIGHT' : 'SCREEN_WIDTH',
        size: clampInt(dims.h, 1, 1000, 120),
      },
    };
  }

  controls.forEach((control) => {
    const baseInfo = baseInfoOf(control);
    const targetGroup = groupById.get(control.groupId) || viewGroups[0];

    if (control.type === 'direction') {
      const ds = sanitizeDirectionStyle(control.dirStyle || {});
      const key = JSON.stringify({ ...ds, name: undefined });
      let name = directionStyleIndex.get(key);
      if (!name) {
        const baseName = control.dirStyle?.name || `工坊:方向-${directionStyles.length + 1}`;
        name = uniqueName(baseName, directionStyleNames);
        directionStyleIndex.set(key, name);
        directionStyles.push({ name, ...ds });
      }
      targetGroup.viewData.directionList.push({
        id: control.id.startsWith('ctrl-') ? uid() : control.id,
        style: name,
        baseInfo,
        event: fullDirectionEvent(control.dirEvent),
      });
      return;
    }

    const style = sanitizeStyle(control.style);
    const key = styleSignature(style);
    let name = buttonStyleIndex.get(key);
    if (!name) {
      const baseName = control.presetName && !control.isPanel
        ? `工坊:${control.presetName}`
        : (control.isPanel ? '工坊:面板' : '工坊:按键');
      name = uniqueName(baseName, buttonStyleNames);
      buttonStyleIndex.set(key, name);
      buttonStyles.push({ name, ...style });
    }
    const buttonEvent = fullButtonEvent(control.event);
    ['pressEvent', 'longPressEvent', 'clickEvent', 'doubleClickEvent'].forEach((k) => {
      buttonEvent[k].bindViewGroup = buttonEvent[k].bindViewGroup.filter((bind) => {
        const groupId = String(bind).split(':')[0];
        return validGroupIds.has(groupId);
      });
    });
    targetGroup.viewData.buttonList.push({
      id: control.id.startsWith('ctrl-') ? uid() : control.id,
      text: control.text || '',
      style: name,
      baseInfo,
      event: buttonEvent,
    });
  });

  return {
    id: randomId8(),
    name: appState.meta?.name || '我的键位',
    version: appState.meta?.version || '1.0',
    versionCode: Number(appState.meta?.versionCode) || 1,
    author: appState.meta?.author || '',
    description: '由 FCL 键位工坊导出',
    controllerVersion: CONTROLLER_VERSION,
    buttonStyles,
    directionStyles,
    viewGroups,
  };
}

/* ------------------------------------------------------------------ 导入 */
export function importController(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文件');
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.viewGroups)) {
    throw new Error('不是 FCL 控制器文件（缺少 viewGroups）');
  }
  const buttonStyles = new Map((doc.buttonStyles || []).map((s) => [s?.name, s]));
  const directionStyles = new Map((doc.directionStyles || []).map((s) => [s?.name, s]));
  const defaultButtonStyle = sanitizeStyle(buttonStyles.values().next().value || {});
  const controls = [];
  const groups = [];
  const idMap = new Map();
  let groupsImported = 0;

  const mapBase = (bi = {}, isDirection = false) => {
    const sizeType = bi.sizeType === 'ABSOLUTE' ? 'ABSOLUTE' : 'PERCENTAGE';
    const ref = bi.percentageWidth?.reference === 'SCREEN_HEIGHT' ? 'SCREEN_HEIGHT' : 'SCREEN_WIDTH';
    let w;
    let h;
    if (sizeType === 'ABSOLUTE') {
      // 编辑器用千分比：把 dp 近似换算成参考边千分比（按 1920×1080 估算）
      const baseW = ref === 'SCREEN_HEIGHT' ? 1080 : 1920;
      w = Math.round((Number(bi.absoluteWidth) || 50) * 2.5 / baseW * 1000);
      h = Math.round((Number(bi.absoluteHeight) || 50) * 2.5 / baseW * 1000);
    } else {
      w = clampInt(bi.percentageWidth?.size, 1, 1000, 120);
      h = clampInt(bi.percentageHeight?.size, 1, 1000, 120);
    }
    if (isDirection) h = w;
    return {
      x: clampInt(bi.xPosition, 0, 1000, 500),
      y: clampInt(bi.yPosition, 0, 1000, 500),
      w,
      h,
      ref,
      visibility: ['ALWAYS', 'IN_GAME', 'MENU'].includes(bi.visibilityType) ? bi.visibilityType : 'ALWAYS',
    };
  };

  (doc.viewGroups || []).forEach((vg, vgIndex) => {
    if (!vg || !vg.viewData) return;
    groupsImported += 1;
    const sourceId = vg.id || uid();
    const groupId = uid();
    idMap.set(sourceId, groupId);
    groups.push({
      id: groupId,
      name: vg.name || `控件组 ${vgIndex + 1}`,
      visibility: vg.visibility === 'INVISIBLE' ? 'INVISIBLE' : 'VISIBLE',
      color: GROUP_COLORS[vgIndex % GROUP_COLORS.length],
    });
    (vg.viewData.buttonList || []).forEach((btn) => {
      if (!btn) return;
      controls.push({
        id: uid(),
        groupId,
        type: 'button',
        presetId: null,
        presetName: '导入',
        text: typeof btn.text === 'string' ? btn.text : '',
        base: mapBase(btn.baseInfo, false),
        style: sanitizeStyle(buttonStyles.get(btn.style) || defaultButtonStyle),
        event: fullButtonEvent(btn.event),
        isPanel: !btn.text,
      });
    });
    (vg.viewData.directionList || []).forEach((dir) => {
      if (!dir) return;
      const ds = directionStyles.get(dir.style) || makeRockerStyle();
      controls.push({
        id: uid(),
        groupId,
        type: 'direction',
        presetId: null,
        presetName: '导入',
        text: '',
        base: mapBase(dir.baseInfo, true),
        style: makeButtonStyle(),
        event: makeButtonEvent({}),
        dirStyle: { name: ds.name || '导入:方向', ...sanitizeDirectionStyle(ds) },
        dirEvent: fullDirectionEvent(dir.event),
      });
    });
  });

  controls.forEach((c) => {
    ['pressEvent', 'longPressEvent', 'clickEvent', 'doubleClickEvent'].forEach((k) => {
      const ev = c.event?.[k];
      if (!ev || !Array.isArray(ev.bindViewGroup)) return;
      ev.bindViewGroup = ev.bindViewGroup
        .map((bind) => {
          const [gid, mode] = String(bind).split(':');
          const mapped = idMap.get(gid);
          if (!mapped) return null;
          return mode ? `${mapped}:${mode}` : mapped;
        })
        .filter(Boolean);
    });
  });

  return {
    controls,
    groups,
    meta: {
      name: doc.name || '导入的键位',
      author: doc.author || '',
      version: doc.version || '1.0',
      versionCode: Number(doc.versionCode) || 1,
    },
    warnings: groupsImported > 1 ? [`文件包含 ${groupsImported} 个布局，已全部叠放到画布`] : [],
  };
}

/* ------------------------------------------------------------------ 下载 */
export function downloadController(controller) {
  const text = JSON.stringify(controller, null, 2) + '\n';
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${controller.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return text;
}
