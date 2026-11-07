/* =========================================================================
 * ui.js —— 手机横屏端 UI：抽屉、底部工具栏、属性编辑（键位/样式/绑定）、逻辑图
 * ========================================================================= */
import {
  ASPECTS,
  DEFAULT_PRESET_CATEGORY,
  KEYCODE_GROUPS,
  argb,
  createCustomPresetFromControl,
  cssColor,
  hexOf,
  keycodeName,
  keycodesLabel,
  makeButtonEvent,
  makeDpadStyle,
  makeDirectionEvent,
  makeRockerStyle,
  TRIGGER_LABELS,
  TRIGGERS,
} from './data.js';
import * as store from './store.js';
import { renderStage } from './stage.js';
import { buildController, downloadController, importController } from './export.js';

const UI = {};
let closeModalFn = null;
let actionTrigger = 'pressEvent';
let logicOpen = false;
let activeDrawer = null;
let showPreviewTimer = null;
let activePresetCategory = 'all';
const modalStack = [];

const MODE_META = {
  select: { label: '选择', hint: '点控件选中；拖动移动；右下角放大缩小；长按空白呼出框选' },
  move: { label: '移动', hint: '点控件逐个多选；拖动任一选中控件整体移动；长按空白框选' },
  preview: { label: '预览', hint: '模拟按键与控件组显隐；可切换游戏内/游戏外' },
};

/* ------------------------------------------------------------------ 初始化 */
export function initUI() {
  const $ = (id) => document.getElementById(id);
  Object.assign(UI, {
    app: $('app'),
    btnMenu: $('btnMenu'),
    btnAdd: $('btnAdd'),
    btnProps: $('btnProps'),
    btnLogic: $('btnLogic'),
    btnImport: $('btnImport'),
    btnExport: $('btnExport'),
    btnFullscreen: $('btnFullscreen'),
    btnUndo: $('btnUndo'),
    btnMulti: $('btnMulti'),
    btnPreviewState: $('btnPreviewState'),
    aspectSelect: $('aspectSelect'),
    modeSwitch: $('modeSwitch'),
    zenModeSwitch: $('zenModeSwitch'),
    fileImport: $('fileImport'),
    groupPanel: $('groupPanel'),
    paletteBody: $('paletteBody'),
    inspector: $('inspector'),
    leftDrawer: $('leftDrawer'),
    rightDrawer: $('rightDrawer'),
    drawerBackdrop: $('drawerBackdrop'),
    btnLeftClose: $('btnLeftClose'),
    btnRightClose: $('btnRightClose'),
    btnNewPreset: $('btnNewPreset'),
    btnImportControls: $('btnImportControls'),
    btnLoadDemo: $('btnLoadDemo'),
    btnEmptyImport: $('btnEmptyImport'),
    modeHint: $('modeHint'),
    previewStateChip: $('previewStateChip'),
    canvasSizeLabel: $('canvasSizeLabel'),
    zoomLabel: $('zoomLabel'),
    btnExitZen: $('btnExitZen'),
    zenLogicBtn: $('zenLogicBtn'),
    logicRoot: $('logicRoot'),
    modalRoot: $('modalRoot'),
    toastRoot: $('toastRoot'),
    rightDrawerTitle: $('rightDrawerTitle'),
    emptyHint: $('emptyHint'),
  });

  UI.btnMenu.addEventListener('click', openAppMenu);
  UI.btnAdd.addEventListener('click', () => openDrawer('left'));
  UI.btnProps.addEventListener('click', () => openDrawer('right'));
  UI.btnLeftClose.addEventListener('click', closeDrawers);
  UI.btnRightClose.addEventListener('click', closeDrawers);
  UI.drawerBackdrop.addEventListener('click', closeDrawers);

  UI.btnLogic.addEventListener('click', openLogicGraph);
  UI.zenLogicBtn.addEventListener('click', openLogicGraph);
  UI.btnFullscreen.addEventListener('click', toggleZen);
  UI.btnExitZen.addEventListener('click', toggleZen);
  UI.btnImport.addEventListener('click', () => UI.fileImport.click());
  UI.btnImportControls.addEventListener('click', () => UI.fileImport.click());
  UI.btnEmptyImport.addEventListener('click', () => UI.fileImport.click());
  UI.fileImport.addEventListener('change', onImportFile);
  UI.btnExport.addEventListener('click', openExportModal);
  UI.btnUndo.addEventListener('click', () => {
    if (store.undo()) toast('已撤回上一步');
    else toast('没有可撤回的操作', 'err');
  });
  UI.btnLoadDemo.addEventListener('click', loadDemo);
  UI.btnNewPreset.addEventListener('click', () => openPresetDialog());

  UI.modeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) store.setMode(btn.dataset.mode);
  });
  UI.zenModeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (btn) store.setMode(btn.dataset.mode);
  });
  UI.btnMulti.addEventListener('click', () => {
    store.updateCanvas({ multiSelect: !store.state.canvas.multiSelect });
  });
  UI.btnPreviewState.addEventListener('click', () => {
    const next = store.state.canvas.previewState === 'in_game' ? 'out_game' : 'in_game';
    store.updateCanvas({ previewState: next });
  });
  UI.aspectSelect.addEventListener('change', () => {
    if (UI.aspectSelect.value === 'custom') {
      openResolutionModal();
      return;
    }
    store.updateCanvas({ aspect: UI.aspectSelect.value });
    fitView();
  });

  window.addEventListener('app:delete', () => store.deleteSelected());
  window.addEventListener('app:duplicate', () => store.duplicateSelected());
  window.addEventListener('app:select-all', () => store.selectAll());
  window.addEventListener('app:nudge', (e) => store.nudgeSelected(e.detail.dx, e.detail.dy));
  window.addEventListener('app:export', openExportModal);
  window.addEventListener('app:focus-text', (e) => focusControlText(e.detail.id));
  window.addEventListener('app:toggle-zen', toggleZen);
  window.addEventListener('app:preview-action', (e) => {
    UI.modeHint.textContent = e.detail.action || '预览';
    UI.modeHint.style.color = 'var(--accent)';
    clearTimeout(showPreviewTimer);
    showPreviewTimer = setTimeout(() => {
      UI.modeHint.textContent = MODE_META[store.state.mode].label;
      UI.modeHint.style.color = '';
    }, 2200);
  });
  window.addEventListener('app:view-changed', (e) => {
    if (UI.zoomLabel) UI.zoomLabel.textContent = `${Math.round((e.detail.scale || 1) * 100)}%`;
  });
  document.addEventListener('app:saved-done', () => { /* 状态栏已移除 */ });
  document.addEventListener('keydown', onGlobalKey);


  renderUI('init');
  requestAnimationFrame(() => {
    const boot = document.getElementById('bootScreen');
    if (boot) boot.classList.add('hidden');
  });
}

function scrollSave(el) {
  return el ? { el, top: el.scrollTop } : null;
}
function scrollRestore(saved) {
  if (!saved || !saved.el) return;
  saved.el.scrollTop = saved.top;
  requestAnimationFrame(() => {
    if (saved.el) saved.el.scrollTop = saved.top;
  });
}
function leftScrollEl() {
  return document.querySelector('#leftDrawer .drawer-scroll');
}

export function renderUI(reason) {
  if (reason === 'saved') return;
  if (reason === 'history') { renderChrome(); return; }
  const savedLeft = scrollSave(leftScrollEl());
  const savedRight = scrollSave(UI.inspector);
  renderChrome();
  const groupReasons = ['init', 'group', 'group-order', 'canvas', 'import', 'reset', 'undo', 'add', 'delete',
    'duplicate', 'preset-category', 'history'];
  if (groupReasons.includes(reason)) renderGroupPanel();
  const presetReasons = ['init', 'preset-add', 'preset-update', 'preset-remove',
    'preset-category', 'undo', 'import', 'history'];
  if (presetReasons.includes(reason)) renderCustomPresets();
  renderInspector();
  updateEmptyHint();
  scrollRestore(savedLeft);
  if (!['select', 'group', 'import', 'undo', 'add', 'delete', 'duplicate', 'mode', 'preview', 'init', 'reset', 'group-order'].includes(reason)) {
    scrollRestore(savedRight);
  }
  if (logicOpen && ['init', 'bindings', 'group', 'undo', 'import', 'logic-position', 'group-order'].includes(reason)) renderLogicGraph();
}

function renderChrome() {
  UI.modeSwitch.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === store.state.mode);
  });
  UI.zenModeSwitch.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === store.state.mode);
  });
  const mode = store.state.mode;
  UI.btnMulti.hidden = mode === 'preview';
  UI.btnPreviewState.hidden = mode !== 'preview';
  UI.btnMulti.classList.toggle('is-on', Boolean(store.state.canvas.multiSelect));
  UI.btnPreviewState.textContent = store.state.canvas.previewState === 'in_game' ? '游戏内' : '游戏外';
  UI.btnPreviewState.classList.toggle('is-on', store.state.canvas.previewState === 'out_game');
  UI.modeHint.textContent = MODE_META[mode].label;
  UI.previewStateChip.hidden = mode !== 'preview';
  UI.previewStateChip.textContent = store.state.canvas.previewState === 'in_game' ? '游戏内' : '游戏外';
  if (UI.btnUndo) UI.btnUndo.disabled = !store.canUndo();
  UI.aspectSelect.value = store.state.canvas.aspect;
  const dims = store.stageDims();
  UI.canvasSizeLabel.textContent = `${dims.w} × ${dims.h}`;
  UI.app.classList.toggle('mobile', true);
}

function updateEmptyHint() {
  UI.emptyHint.classList.toggle('hidden', store.state.controls.length > 0);
}

/* ------------------------------------------------------------ 抽屉管理 */
export function openDrawer(side) {
  activeDrawer = side;
  UI.drawerBackdrop.hidden = false;
  UI.leftDrawer.hidden = side !== 'left';
  UI.rightDrawer.hidden = side !== 'right';
  if (side === 'right') renderInspector();
}
function closeDrawers() {
  activeDrawer = null;
  UI.drawerBackdrop.hidden = true;
  UI.leftDrawer.hidden = true;
  UI.rightDrawer.hidden = true;
}

/* ------------------------------------------------------------ 控件组面板 */
function renderGroupPanel() {
  const collapsed = Boolean(store.state.canvas.groupCollapsed);
  const wrap = document.createElement('div');
  wrap.className = 'group-panel' + (collapsed ? ' collapsed' : '');

  const head = document.createElement('div');
  head.className = 'group-head';
  const title = document.createElement('span');
  title.className = 'group-title';
  title.textContent = `控件组 (${store.state.groups.length})`;
  const tools = document.createElement('div');
  tools.className = 'group-tools';

  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'mini-btn';
  collapse.textContent = collapsed ? '展开' : '收起';
  collapse.addEventListener('click', () => store.updateCanvas({ groupCollapsed: !collapsed }));

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'mini-btn';
  add.textContent = '＋ 新建';
  add.addEventListener('click', () => {
    openTextModal('新建控件组', `控件组 ${store.state.groups.length + 1}`, (value) => {
      const g = store.addGroup(value);
      toast(`已创建「${g.name}」`, 'ok');
    });
  });
  const sortBtn = document.createElement('button');
  sortBtn.type = 'button';
  sortBtn.className = 'mini-btn';
  sortBtn.textContent = '排序';
  sortBtn.addEventListener('click', openGroupSortModal);
  tools.append(collapse, add, sortBtn);
  head.append(title, tools);

  const list = document.createElement('div');
  list.className = 'group-list';
  store.state.groups.forEach((group) => {
    const row = document.createElement('div');
    row.className = 'group-row'
      + (group.id === store.state.activeGroupId ? ' active' : '')
      + (group.visibility === 'INVISIBLE' ? ' hidden-group' : '');
    row.addEventListener('click', () => store.setActiveGroup(group.id));
    row.addEventListener('dblclick', () => {
      store.selectGroup(group.id);
      toast(`已选中「${group.name}」的 ${store.groupControls(group.id).length} 个控件`);
    });

    const dot = document.createElement('span');
    dot.className = 'g-dot';
    dot.style.background = group.color;
    dot.style.color = group.color;
    const name = document.createElement('span');
    name.className = 'g-name';
    name.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'g-count';
    count.textContent = String(store.groupControls(group.id).length);

    const visSwitch = document.createElement('label');
    visSwitch.className = 'group-switch';
    visSwitch.title = '游戏内显示开关';
    visSwitch.addEventListener('pointerdown', (e) => e.stopPropagation());
    visSwitch.addEventListener('click', (e) => e.stopPropagation());
    const visInput = document.createElement('input');
    visInput.type = 'checkbox';
    visInput.checked = group.visibility === 'VISIBLE';
    const visTrack = document.createElement('span');
    visTrack.className = 'gs-track';
    visInput.addEventListener('click', (e) => e.stopPropagation());
    visInput.addEventListener('change', (e) => {
      e.stopPropagation();
      store.updateGroup(group.id, { visibility: visInput.checked ? 'VISIBLE' : 'INVISIBLE' });
    });
    visSwitch.append(visInput, visTrack);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'g-btn';
    edit.textContent = '✎';
    edit.title = '重命名';
    edit.addEventListener('click', (e) => {
      e.stopPropagation();
      openTextModal('重命名控件组', group.name, (value) => {
        store.renameGroup(group.id, value);
        toast('已重命名');
      });
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'g-btn';
    del.textContent = '✕';
    del.title = '删除控件组';
    del.disabled = store.state.groups.length <= 1;
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmModal('删除控件组', `确定删除「${group.name}」？组内控件会移到相邻组。`, () => {
        store.removeGroup(group.id);
        toast('已删除控件组');
      });
    });
    row.append(dot, name, count, visSwitch, edit, del);
    list.appendChild(row);
  });

  if (!collapsed) wrap.append(head, list);
  else wrap.append(head);
  UI.groupPanel.replaceChildren(wrap);
}

/* ------------------------------------------------------------ 自定义预设 */
function renderCustomPresets() {
  const sc = leftScrollEl();
  const top = sc ? sc.scrollTop : 0;
  renderCustomPresetsInner();
  if (sc) {
    sc.scrollTop = top;
    requestAnimationFrame(() => { if (sc) sc.scrollTop = top; });
  }
}

function renderCustomPresetsInner() {
  if (!UI.paletteBody) return;
  UI.paletteBody.replaceChildren();
  const categories = store.presetCategories;
  if (activePresetCategory !== 'all' && !categories.includes(activePresetCategory)) {
    activePresetCategory = 'all';
  }
  const tabs = document.createElement('div');
  tabs.className = 'preset-tabs';
  const mkTab = (value, label) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'preset-tab' + (activePresetCategory === value ? ' is-active' : '');
    tab.textContent = label;
    tab.addEventListener('click', () => {
      activePresetCategory = value;
      renderCustomPresets();
    });
    if (value !== 'all') {
      let timer = null;
      const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
      tab.addEventListener('pointerdown', () => {
        clearTimer();
        timer = setTimeout(() => {
          timer = null;
          openCategoryManage(value);
        }, 550);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => tab.addEventListener(ev, clearTimer));
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCategoryManage(value);
      });
      if (value !== DEFAULT_PRESET_CATEGORY) {
        const del = document.createElement('span');
        del.className = 'pt-del';
        del.textContent = '✕';
        del.title = '删除分类';
        del.addEventListener('pointerdown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmDeleteCategory(value);
        });
        tab.appendChild(del);
      }
    }
    return tab;
  };
  tabs.appendChild(mkTab('all', '全部'));
  categories.forEach((c) => tabs.appendChild(mkTab(c, c)));
  const addTab = document.createElement('button');
  addTab.type = 'button';
  addTab.className = 'preset-tab-add';
  addTab.textContent = '＋';
  addTab.title = '新建分类';
  addTab.addEventListener('click', openAddCategoryModal);
  tabs.appendChild(addTab);
  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'preset-tab-add preset-tab-manage';
  manage.textContent = '⚙';
  manage.title = '分类管理（重命名/删除）';
  manage.addEventListener('click', openCategoryListModal);
  tabs.appendChild(manage);
  UI.paletteBody.appendChild(tabs);

  const list = store.customPresets.filter((p) => activePresetCategory === 'all'
    || (p.category || DEFAULT_PRESET_CATEGORY) === activePresetCategory);
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'custom-empty';
    empty.innerHTML = activePresetCategory === 'all'
      ? '还没有自定义预设<br>点上方「＋ 新建」定义按键/摇杆<br>也可导入 FCL 控制器 JSON'
      : '这个分类下还没有预设<br>新建预设时可选择分类';
    UI.paletteBody.appendChild(empty);
    return;
  }
  list.forEach((preset) => UI.paletteBody.appendChild(createPresetRow(preset)));
}

function createPresetRow(preset) {
  const row = document.createElement('div');
  row.className = 'custom-card-row';
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'custom-card-main';
  main.style.cssText = 'background:transparent;border:0;text-align:left;cursor:pointer';
  const name = document.createElement('span');
  name.className = 'preset-name';
  name.textContent = preset.name;
  main.appendChild(name);
  main.appendChild(presetDetailEl(preset));
  main.addEventListener('click', () => {
    const c = store.addPreset(preset);
    const group = c ? store.findGroup(c.groupId) : null;
    closeDrawers();
    toast(`已添加「${preset.name}」到「${group ? group.name : '当前组'}」`, 'ok');
    if (group && group.visibility === 'INVISIBLE') {
      toast('该控件组当前是隐藏状态，请打开组开关后再查看', 'err');
    }
  });
  const actions = document.createElement('div');
  actions.className = 'custom-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn-icon';
  edit.textContent = '✎';
  edit.title = '编辑预设';
  edit.addEventListener('click', () => openPresetDialog(preset));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn-icon danger';
  del.textContent = '✕';
  del.title = '删除预设';
  del.addEventListener('click', () => {
    store.removeCustomPreset(preset.id);
    toast('已删除预设');
  });
  actions.append(edit, del);
  row.append(main, actions);
  return row;
}

function presetDetailEl(preset) {
  const wrap = document.createElement('span');
  wrap.className = 'preset-detail';
  const tag = (text, cls = '') => {
    const t = document.createElement('span');
    t.className = 'tag ' + cls;
    t.textContent = text;
    wrap.appendChild(t);
    return t;
  };
  tag(preset.category || DEFAULT_PRESET_CATEGORY);
  if (preset.kind === 'direction') {
    tag(preset.dirStyle?.styleType === 'ROCKER' ? '摇杆' : '十字键');
    const ev = preset.dirEvent || {};
    tag(`↑${keycodesLabel(ev.upKeycode)}`, 'key');
    tag(`↓${keycodesLabel(ev.downKeycode)}`, 'key');
    tag(`←${keycodesLabel(ev.leftKeycode)}`, 'key');
    tag(`→${keycodesLabel(ev.rightKeycode)}`, 'key');
    tag(`死区 ${ev.deadZone ?? 0}`);
    tag(`尺寸 ${preset.base?.w ?? '?'}`);
    return wrap;
  }
  tag('按键');
  const event = preset.event || {};
  const found = ['pressEvent', 'longPressEvent', 'clickEvent', 'doubleClickEvent']
    .map((k) => ({ k, ev: event[k] }))
    .find(({ ev }) => ev && (ev.outputKeycodes?.length || ev.openMenu || ev.quickInput
      || ev.input || ev.outputText || ev.autoKeep || ev.bindViewGroup?.length));
  if (found) {
    tag(TRIGGER_LABELS[found.k.replace('Event', '')] || found.k);
    if (found.ev.outputKeycodes?.length) tag(keycodesLabel(found.ev.outputKeycodes), 'key');
    const flags = [];
    if (found.ev.autoKeep) flags.push('切换保持');
    if (found.ev.autoClick) flags.push('连点');
    if (found.ev.openMenu) flags.push('菜单');
    if (found.ev.quickInput) flags.push('快捷输入');
    if (found.ev.input) flags.push('输入法');
    if (found.ev.outputText) flags.push('文本');
    if (event.pointerFollow) flags.push('视角');
    if (event.swipable) flags.push('滑键');
    if (flags.length) tag(flags.join('/'));
    if (found.ev.bindViewGroup?.length) tag(`绑定 ${found.ev.bindViewGroup.length} 组`, 'warn');
  } else {
    tag('无动作', 'warn');
  }
  tag(`尺寸 ${preset.base?.w ?? '?'}×${preset.base?.h ?? '?'}`);
  const style = preset.style || {};
  const dots = document.createElement('span');
  dots.className = 'preset-color-dots';
  [style.fillColor, style.strokeColor, style.textColor].forEach((c) => {
    const d = document.createElement('i');
    d.style.background = cssColor(c ?? 0);
    dots.appendChild(d);
  });
  wrap.appendChild(dots);
  return wrap;
}

function openAddCategoryModal() {
  openTextModal('新建预设分类', '新分类', (value) => {
    if (store.addPresetCategory(value)) {
      activePresetCategory = value;
      renderCustomPresets();
      toast('已新建分类', 'ok');
    } else {
      toast('分类已存在或名称无效', 'err');
    }
  });
}

function openCategoryManage(category) {
  const body = document.createElement('div');
  const input = inputEl({ id: 'catRename', value: category });
  body.appendChild(field('分类名称', input));
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = '长按分类标签可再次打开本面板；删除分类后其预设会移入「默认」。';
  body.appendChild(note);
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeModal);
  const del = document.createElement('button');
  del.className = 'btn btn-danger';
  del.textContent = '删除分类';
  del.addEventListener('click', () => {
    if (store.removePresetCategory(category)) {
      activePresetCategory = 'all';
      closeModal();
      toast('已删除分类');
    } else {
      toast('默认分类不可删除', 'err');
    }
  });
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = '保存';
  save.addEventListener('click', () => {
    const value = input.value.trim();
    if (value === category) { closeModal(); return; }
    if (store.renamePresetCategory(category, value)) {
      activePresetCategory = value;
      closeModal();
      toast('已重命名分类', 'ok');
    } else {
      toast('名称无效或已存在', 'err');
    }
  });
  openModal({ title: '分类管理', body, footer: [cancel, del, save] });
}

function confirmDeleteCategory(name) {
  confirmModal('删除分类', `确定删除分类「${name}」？该分类下的预设会移到「默认」分类。`, () => {
    if (store.removePresetCategory(name)) {
      if (activePresetCategory === name) activePresetCategory = 'all';
      renderCustomPresets();
      toast('已删除分类', 'ok');
    } else {
      toast('默认分类不可删除', 'err');
    }
  });
}

function openCategoryListModal() {
  const body = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'cat-list';
  const renderList = () => {
    const modalBody = list.closest('.modal-body');
    const keptTop = modalBody ? modalBody.scrollTop : 0;
    list.replaceChildren();
    store.presetCategories.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'cat-list-row';
      const name = document.createElement('span');
      name.className = 'cat-list-name';
      name.textContent = c;
      const actions = document.createElement('div');
      actions.className = 'cat-list-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'mini-btn';
      rename.textContent = '重命名';
      rename.addEventListener('click', () => {
        openCategoryManage(c);
      });
      actions.appendChild(rename);
      if (c !== DEFAULT_PRESET_CATEGORY) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mini-btn danger';
        del.textContent = '删除';
        del.addEventListener('click', () => {
          if (store.removePresetCategory(c)) {
            if (activePresetCategory === c) activePresetCategory = 'all';
            toast('已删除分类', 'ok');
            renderList();
            renderCustomPresets();
          } else {
            toast('删除失败', 'err');
          }
        });
        actions.appendChild(del);
      } else {
        const tag = document.createElement('span');
        tag.className = 'cat-default-label';
        tag.textContent = '默认分类';
        actions.appendChild(tag);
      }
      row.append(name, actions);
      list.appendChild(row);
    });
    if (modalBody) modalBody.scrollTop = keptTop;
  };
  renderList();
  body.appendChild(list);
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = '「默认」分类不可删除；删除其他分类时，其预设会自动移到「默认」。也可以长按分类标签或右键打开分类管理。';
  body.appendChild(note);
  const add = document.createElement('button');
  add.className = 'btn';
  add.textContent = '＋ 新建分类';
  add.addEventListener('click', () => {
    openTextModal('新建预设分类', '新分类', (value) => {
      if (store.addPresetCategory(value)) {
        renderList();
        renderCustomPresets();
        toast('已新建分类', 'ok');
      } else {
        toast('分类已存在或名称无效', 'err');
      }
    }, { stack: true });
  });
  const close = document.createElement('button');
  close.className = 'btn btn-primary';
  close.textContent = '关闭';
  close.addEventListener('click', closeModal);
  openModal({
    title: '分类管理',
    subtitle: '可重命名或删除分类',
    body,
    footer: [add, close],
    onMount: () => {},
  });
}

/* ------------------------------------------------------------ 属性面板 */
function renderInspector() {
  if (store.state.mode === 'preview') {
    UI.inspector.replaceChildren(previewPanel());
    UI.rightDrawerTitle.textContent = '预览';
    return;
  }
  const selected = store.selectedControls();
  if (!selected.length) {
    UI.inspector.replaceChildren(emptyInspector());
    UI.rightDrawerTitle.textContent = '属性';
    bindCommon();
    return;
  }
  if (selected.length === 1) {
    UI.inspector.replaceChildren(singleInspector(selected[0]));
    UI.rightDrawerTitle.textContent = '控件属性';
    bindSingle(selected[0]);
    return;
  }
  UI.inspector.replaceChildren(multiInspector(selected));
  UI.rightDrawerTitle.textContent = '多选属性';
  bindCommon();
}

function panelHead(title, sub) {
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = `<h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}`;
  return head;
}

function section(title, ...children) {
  const sec = document.createElement('div');
  sec.className = 'section';
  const h = document.createElement('div');
  h.className = 'section-title';
  const span = document.createElement('span');
  span.textContent = title;
  h.appendChild(span);
  sec.appendChild(h);
  children.forEach((c) => c && sec.appendChild(c));
  return sec;
}

function field(label, control) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  if (label) {
    const l = document.createElement('label');
    l.textContent = label;
    wrap.appendChild(l);
  }
  if (control) wrap.appendChild(control);
  return wrap;
}

function inputEl({ id, type = 'text', value = '', min, max, step, placeholder }) {
  const el = document.createElement('input');
  el.className = 'input';
  el.type = type;
  el.id = id;
  if (value !== undefined) el.value = value;
  if (min !== undefined) el.min = min;
  if (max !== undefined) el.max = max;
  if (step !== undefined) el.step = step;
  if (placeholder) el.placeholder = placeholder;
  return el;
}

function selectEl(id, options, value) {
  const el = document.createElement('select');
  el.className = 'select';
  el.id = id;
  options.forEach(({ value: v, label }) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    el.appendChild(o);
  });
  el.value = value;
  return el;
}

function infoRow(k, v) {
  const d = document.createElement('div');
  d.className = 'kv-row';
  d.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
  return d;
}

function groupSelect(value) {
  return selectEl('ctrlGroup', store.state.groups.map((g) => ({
    value: g.id,
    label: `${g.name}${g.visibility === 'INVISIBLE' ? '（隐藏）' : ''}`,
  })), value);
}

function emptyInspector() {
  const dims = store.stageDims();
  const nameField = field('布局名称', inputEl({ id: 'metaName', value: store.state.meta.name }));
  const authorField = field('作者', inputEl({ id: 'metaAuthor', value: store.state.meta.author }));
  const versionRow = document.createElement('div');
  versionRow.className = 'field-row';
  versionRow.append(
    field('版本名', inputEl({ id: 'metaVersion', value: store.state.meta.version })),
    field('版本号', inputEl({ id: 'metaVersionCode', type: 'number', value: store.state.meta.versionCode, min: 1 })),
  );
  const stats = document.createElement('div');
  stats.className = 'kv-list';
  stats.append(
    infoRow('控件总数', String(store.state.controls.length)),
    infoRow('控件组', `${store.state.groups.length} 组`),
    infoRow('按键 / 方向', `${store.state.controls.filter((c) => c.type === 'button').length} / ${store.state.controls.filter((c) => c.type === 'direction').length}`),
    infoRow('画布尺寸', `${dims.w} × ${dims.h}`),
  );
  const aspectOptions = Object.entries(ASPECTS).map(([value, v]) => ({ value, label: v.label }));
  aspectOptions.push({ value: 'custom', label: '自定义分辨率…' });
  const aspectField = field('画布分辨率',
    selectEl('canvasAspect', aspectOptions, store.state.canvas.aspect));
  const stepField = field('网格步长',
    selectEl('gridStep', [5, 10, 20, 25].map((v) => ({ value: String(v), label: `${v / 10}%` })), String(store.state.canvas.gridStep)));

  const actions = document.createElement('div');
  actions.className = 'actions-row';
  const demoBtn = document.createElement('button');
  demoBtn.className = 'btn';
  demoBtn.textContent = '载入示例';
  demoBtn.addEventListener('click', loadDemo);
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-danger';
  clearBtn.textContent = '清空画布';
  clearBtn.addEventListener('click', confirmClear);
  actions.append(demoBtn, clearBtn);

  const note = document.createElement('div');
  note.className = 'note';
  note.innerHTML = '手机端操作：点选控件；拖动移动；右下角手柄缩放；长按空白呼出框选。底部「多选」可逐个点选。';

  return fragment(
    panelHead('布局设置', '未选中控件时的全局设置'),
    section('布局信息', nameField, authorField, versionRow),
    section('画布', aspectField, stepField),
    section('统计', stats),
    section('操作', actions, note),
  );
}

function fragment(...nodes) {
  const frag = document.createDocumentFragment();
  nodes.forEach((n) => n && frag.appendChild(n));
  return frag;
}

function previewPanel() {
  const stateWrap = document.createElement('div');
  stateWrap.className = 'mode-bar';
  const inGame = document.createElement('button');
  inGame.className = 'mode-btn' + (store.state.canvas.previewState === 'in_game' ? ' is-active' : '');
  inGame.textContent = '游戏内';
  inGame.addEventListener('click', () => store.updateCanvas({ previewState: 'in_game' }));
  const outGame = document.createElement('button');
  outGame.className = 'mode-btn' + (store.state.canvas.previewState === 'out_game' ? ' is-active' : '');
  outGame.textContent = '游戏外 / 菜单';
  outGame.addEventListener('click', () => store.updateCanvas({ previewState: 'out_game' }));
  stateWrap.append(inGame, outGame);
  const note = document.createElement('div');
  note.className = 'note';
  note.innerHTML = '预览模式下：点按控件会模拟它的动作；绑定到控件组的按钮会实际切换组显隐。'
    + '「游戏内/游戏外」用来检查「仅游戏内」「仅游戏外」控件的显示。';
  const back = document.createElement('button');
  back.className = 'btn btn-primary btn-block';
  back.textContent = '退出预览';
  back.addEventListener('click', () => store.setMode('select'));
  return fragment(panelHead('预览模式', '模拟按键与控件组显隐'),
    section('游戏状态', stateWrap), section('说明', note, back));
}

function singleInspector(control) {
  const group = store.findGroup(control.groupId);
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = `<div class="selected-head">
      <span class="type-badge ${control.type === 'direction' ? 'gold' : ''}">${control.type === 'direction'
        ? (control.dirStyle?.styleType === 'ROCKER' ? 'ROCKER' : 'DPAD') : 'BUTTON'}</span>
      <div style="min-width:0"><div class="selected-title">${escapeHtml(control.presetName || '控件')}</div>
      <div class="selected-sub">${escapeHtml(group ? group.name : '未分组')}</div></div>
    </div>`;

  const children = [];
  children.push(section('所属控件组', field('', groupSelect(control.groupId))));

  if (control.type === 'button') {
    const text = document.createElement('textarea');
    text.className = 'textarea';
    text.id = 'ctrlText';
    text.value = control.text;
    text.rows = 2;
    text.placeholder = '显示文字，支持换行';
    children.push(section('内容', field('显示文字', text)));
  }

  const vis = selectEl('ctrlVisibility', [
    { value: 'ALWAYS', label: '始终显示' },
    { value: 'IN_GAME', label: '仅游戏内' },
    { value: 'MENU', label: '仅游戏外（菜单）' },
  ], control.base.visibility);
  const ref = selectEl('ctrlRef', [
    { value: 'SCREEN_WIDTH', label: '按屏幕宽度' },
    { value: 'SCREEN_HEIGHT', label: '按屏幕高度' },
  ], control.base.ref);
  children.push(section('可见性 / 尺寸', field('可见性', vis), field('尺寸参考', ref)));

  const wInput = inputEl({ id: 'ctrlW', type: 'number', value: control.base.w, min: 10, max: 1000 });
  const hInput = inputEl({ id: 'ctrlH', type: 'number', value: control.base.h, min: 10, max: 1000 });
  if (control.type === 'direction') hInput.disabled = true;
  const sizeRow = document.createElement('div');
  sizeRow.className = 'field-row';
  sizeRow.append(field('宽', wInput), field('高', hInput));
  const xInput = inputEl({ id: 'ctrlX', type: 'number', value: control.base.x, min: 0, max: 1000 });
  const yInput = inputEl({ id: 'ctrlY', type: 'number', value: control.base.y, min: 0, max: 1000 });
  const posRow = document.createElement('div');
  posRow.className = 'field-row';
  posRow.append(field('X', xInput), field('Y', yInput));
  children.push(section('尺寸 / 位置', sizeRow, posRow));

  if (control.type === 'button') {
    children.push(behaviorSection(control));
  } else {
    children.push(directionSection(control));
  }
  children.push(styleSection(control));

  const actions = document.createElement('div');
  actions.className = 'actions-row';
  const dup = document.createElement('button');
  dup.className = 'btn';
  dup.textContent = '复制';
  dup.addEventListener('click', () => store.duplicateSelected());
  const del = document.createElement('button');
  del.className = 'btn btn-danger';
  del.textContent = '删除';
  del.addEventListener('click', () => store.deleteSelected());
  actions.append(dup, del);
  const saveAs = document.createElement('button');
  saveAs.className = 'btn btn-ghost btn-block';
  saveAs.style.marginTop = '8px';
  saveAs.textContent = '另存为自定义预设';
  saveAs.addEventListener('click', () => openPresetDialog(null, control));
  children.push(section('操作', actions, saveAs));

  const wrap = document.createElement('div');
  wrap.appendChild(head);
  children.forEach((c) => wrap.appendChild(c));
  return wrap;
}

/* ------------------------------------------------- 行为：键位映射 + 绑定 */
function ensureAllEvents(control) {
  if (!control.event) control.event = makeButtonEvent({});
  const base = makeButtonEvent({});
  Object.keys(TRIGGERS).forEach((k) => {
    const key = TRIGGERS[k];
    if (!control.event[key]) control.event[key] = base[key];
    if (!Array.isArray(control.event[key].outputKeycodes)) control.event[key].outputKeycodes = [];
    if (!Array.isArray(control.event[key].bindViewGroup)) control.event[key].bindViewGroup = [];
  });
  return control.event;
}

function behaviorSection(control) {
  ensureAllEvents(control);
  const wrap = document.createElement('div');

  const tabs = document.createElement('div');
  tabs.className = 'trigger-tabs';
  Object.entries(TRIGGER_LABELS).forEach(([key, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'trigger-tab' + (TRIGGERS[key] === actionTrigger ? ' is-active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      actionTrigger = TRIGGERS[key];
      renderInspector();
    });
    tabs.appendChild(b);
  });
  wrap.appendChild(tabs);

  const ev = control.event[actionTrigger];
  const keyBtn = keyValueButton(ev.outputKeycodes, () => {
    openKeyPicker(ev.outputKeycodes, (codes) => {
      store.snapshot();
      ev.outputKeycodes = codes;
      store.scheduleSave();
      renderInspector();
    });
  });
  wrap.appendChild(field('键码（点击选择，可组合）', keyBtn));

  const flags = document.createElement('div');
  flags.className = 'check-row';
  [
    ['autoKeep', '切换保持'], ['autoClick', '连点'], ['openMenu', '打开菜单'],
    ['quickInput', '快捷输入'], ['input', '输入法'],
  ].forEach(([key, label]) => {
    const lab = document.createElement('label');
    lab.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(ev[key]);
    cb.dataset.behaviorFlag = key;
    lab.append(cb, document.createTextNode(label));
    flags.appendChild(lab);
  });
  wrap.appendChild(flags);

  const globalFlags = document.createElement('div');
  globalFlags.className = 'check-row';
  [['pointerFollow', '拖动视角', control.event.pointerFollow],
    ['swipable', '滑动联动', control.event.swipable]].forEach(([key, label, val]) => {
    const lab = document.createElement('label');
    lab.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(val);
    cb.dataset.behaviorGlobal = key;
    lab.append(cb, document.createTextNode(label));
    globalFlags.appendChild(lab);
  });
  wrap.appendChild(globalFlags);

  const out = inputEl({ id: 'ctrlOutputText', value: ev.outputText || '', placeholder: '发送文本，如 /time set day' });
  wrap.appendChild(field('发送文本', out));

  // 绑定控件组
  const bindList = document.createElement('div');
  bindList.className = 'kv-list';
  const bindMap = new Map();
  ev.bindViewGroup.forEach((bind) => {
    const [gid, mode] = String(bind).split(':');
    bindMap.set(gid, mode || 'toggle');
  });
  store.state.groups.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const name = document.createElement('span');
    name.className = 'k';
    name.innerHTML = `<span class="color-dot" style="background:${g.color}"></span>${escapeHtml(g.name)}`;
    const sel = selectEl(`bind-${g.id}`, [
      { value: 'none', label: '不绑定' },
      { value: 'toggle', label: '切换显隐' },
      { value: 'show', label: '显示' },
      { value: 'hide', label: '隐藏' },
    ], bindMap.get(g.id) || 'none');
    sel.style.height = '28px';
    sel.style.fontSize = '11.5px';
    sel.addEventListener('change', () => {
      const target = control.event[actionTrigger];
      const arr = (target.bindViewGroup || []).filter((b) => String(b).split(':')[0] !== g.id);
      if (sel.value !== 'none') arr.push(sel.value === 'toggle' ? g.id : `${g.id}:${sel.value}`);
      target.bindViewGroup = arr;
      store.scheduleSave();
      if (logicOpen) renderLogicGraph();
    });
    row.append(name, sel);
    bindList.appendChild(row);
  });
  const bindWrap = document.createElement('div');
  bindWrap.append(bindList);
  wrap.appendChild(bindWrap);

  return section('键位映射与动作', wrap);
}

function directionSection(control) {
  if (!control.dirEvent) control.dirEvent = makeDirectionEvent();
  const ev = control.dirEvent;
  const wrap = document.createElement('div');
  const mk = (key, label) => {
    const btn = keyValueButton(ev[key] || [], () => {
      openKeyPicker(ev[key] || [], (codes) => {
        store.snapshot();
        ev[key] = codes;
        store.scheduleSave();
        renderInspector();
      });
    });
    return field(label, btn);
  };
  const grid = document.createElement('div');
  grid.className = 'field-row';
  grid.append(mk('upKeycode', '上'), mk('downKeycode', '下'));
  const grid2 = document.createElement('div');
  grid2.className = 'field-row';
  grid2.append(mk('leftKeycode', '左'), mk('rightKeycode', '右'));
  wrap.append(grid, grid2);
  const opts = document.createElement('div');
  opts.className = 'field-row';
  opts.append(
    field('跟随方式', selectEl('dirFollow', [
      { value: 'CENTER_FOLLOW', label: '中心跟随' },
      { value: 'FIXED', label: '固定' },
      { value: 'FOLLOW', label: '跟随' },
    ], ev.followOption)),
    field('死区', inputEl({ id: 'dirDeadZone', type: 'number', value: ev.deadZone, min: 0, max: 100 })),
  );
  wrap.appendChild(opts);
  const sneak = document.createElement('label');
  sneak.className = 'check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'dirSneak';
  cb.checked = Boolean(ev.sneak);
  sneak.append(cb, document.createTextNode('双击切换潜行'));
  wrap.appendChild(sneak);
  return section('方向键映射', wrap);
}

/* ------------------------------------------------------- 键位选择器 */
function refreshKeyValue(btn, codes) {
  btn.replaceChildren();
  if (!codes || !codes.length) {
    const empty = document.createElement('span');
    empty.className = 'kv-empty';
    empty.textContent = '点击选择按键';
    btn.appendChild(empty);
    return;
  }
  codes.forEach((code, i) => {
    if (i) {
      const plus = document.createElement('span');
      plus.className = 'kv-plus';
      plus.textContent = '+';
      btn.appendChild(plus);
    }
    const chip = document.createElement('span');
    chip.className = 'kv-key';
    chip.textContent = keycodeName(code);
    btn.appendChild(chip);
  });
}

function keyValueButton(codes, onPick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'key-value';
  refreshKeyValue(btn, codes);
  btn.addEventListener('click', onPick);
  return btn;
}

function openKeyPicker(currentCodes, onConfirm) {
  const selected = [...(currentCodes || [])];
  const body = document.createElement('div');

  const selectedBox = document.createElement('div');
  selectedBox.className = 'key-picker-selected';
  body.appendChild(selectedBox);

  const groupsBar = document.createElement('div');
  groupsBar.className = 'key-picker-groups';
  const grid = document.createElement('div');
  grid.className = 'key-grid';
  body.append(groupsBar, grid);

  let currentGroup = 0;
  const renderSelected = () => {
    selectedBox.replaceChildren();
    if (!selected.length) {
      const empty = document.createElement('span');
      empty.className = 'kp-empty';
      empty.textContent = '还没有选择按键；点击下方按键会按顺序组成组合键';
      selectedBox.appendChild(empty);
      return;
    }
    selected.forEach((code, index) => {
      const chip = document.createElement('span');
      chip.className = 'kp-chip';
      chip.append(document.createTextNode(keycodeName(code)));
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        selected.splice(index, 1);
        renderSelected();
        renderGrid();
      });
      chip.appendChild(rm);
      selectedBox.appendChild(chip);
    });
  };
  const renderGrid = () => {
    grid.replaceChildren();
    const group = KEYCODE_GROUPS[currentGroup];
    group.codes.forEach((code) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key-chip' + (selected.includes(code) ? ' is-selected' : '');
      btn.textContent = keycodeName(code);
      btn.addEventListener('click', () => {
        const idx = selected.indexOf(code);
        if (idx >= 0) selected.splice(idx, 1);
        else selected.push(code);
        renderSelected();
        renderGrid();
      });
      grid.appendChild(btn);
    });
  };
  KEYCODE_GROUPS.forEach((group, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'key-picker-group' + (i === 0 ? ' is-active' : '');
    tab.textContent = group.name;
    tab.addEventListener('click', () => {
      currentGroup = i;
      [...groupsBar.children].forEach((c, ci) => c.classList.toggle('is-active', ci === i));
      renderGrid();
    });
    groupsBar.appendChild(tab);
  });
  renderSelected();
  renderGrid();

  const clear = document.createElement('button');
  clear.className = 'btn btn-ghost';
  clear.textContent = '清空';
  clear.addEventListener('click', () => {
    selected.length = 0;
    renderSelected();
    renderGrid();
  });
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeModal);
  const ok = document.createElement('button');
  ok.className = 'btn btn-primary';
  ok.textContent = '确定';
  ok.addEventListener('click', () => {
    closeModal();
    onConfirm([...selected]);
  });
  openModal({
    title: '选择按键',
    subtitle: '按点击顺序组成组合键，再次点击已选按键可移除',
    body,
    footer: [clear, cancel, ok],
    stack: true,
  });
}

/* ---------------------------------------------------------- 样式编辑器 */
function styleSection(control) {
  const wrap = document.createElement('div');
  if (control.type === 'direction') {
    const ds = control.dirStyle || {};
    const rs = ds.rockerStyle || {};
    wrap.append(
      field('摇杆帽大小（千分比）', inputEl({ id: 'rockerSize', type: 'number', value: rs.rockerSize ?? 400, min: 50, max: 1000 })),
      colorRow('背景填充', rs.bgFillColor ?? 0),
      colorRow('背景描边', rs.bgStrokeColor ?? 0),
      colorRow('摇杆填充', rs.rockerFillColor ?? 0),
      colorRow('摇杆描边', rs.rockerStrokeColor ?? 0),
    );
    return section('样式编辑', wrap);
  }
  const s = control.style || {};
  wrap.append(
    colorRow('填充颜色', s.fillColor ?? 0),
    colorRow('描边颜色', s.strokeColor ?? 0),
    colorRow('文字颜色', s.textColor ?? 0),
  );
  const grid = document.createElement('div');
  grid.className = 'field-row';
  grid.append(
    field('圆角（100=10dp）', inputEl({ id: 'styleRadius', type: 'number', value: s.cornerRadius ?? 100, min: 0, max: 2000 })),
    field('描边宽度', inputEl({ id: 'styleStroke', type: 'number', value: s.strokeWidth ?? 20, min: 0, max: 500 })),
  );
  const grid2 = document.createElement('div');
  grid2.className = 'field-row';
  grid2.append(
    field('文字大小 sp', inputEl({ id: 'styleTextSize', type: 'number', value: s.textSize ?? 12, min: 0, max: 200 })),
    field('', (() => { const d = document.createElement('div'); return d; })()),
  );
  wrap.append(grid, grid2);
  return section('样式编辑', wrap);
}

function colorRow(label, value) {
  const { hex, alpha } = hexOf(value);
  const row = document.createElement('div');
  row.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  const box = document.createElement('div');
  box.className = 'color-field';
  const color = document.createElement('input');
  color.type = 'color';
  color.value = hex;
  color.dataset.colorKey = label;
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.value = String(alpha);
  range.style.flex = '1';
  const val = document.createElement('span');
  val.className = 'opacity-val';
  val.textContent = alpha + '%';
  range.addEventListener('input', () => { val.textContent = range.value + '%'; });
  box.append(color, range, val);
  row.append(lab, box);
  return row;
}

/* ------------------------------------------------------------ 方向/多选 */
function multiInspector(list) {
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = `<h2>已选 ${list.length} 个控件</h2><p>可批量对齐、移组、复制或删除</p>`;
  const groupSel = groupSelect(list[0].groupId);
  const alignGrid = document.createElement('div');
  alignGrid.className = 'align-grid';
  [['left', '左对齐'], ['hcenter', '水平居中'], ['right', '右对齐'],
    ['top', '顶对齐'], ['vcenter', '垂直居中'], ['bottom', '底对齐']].forEach(([kind, label]) => {
    const b = document.createElement('button');
    b.className = 'align-btn';
    b.textContent = label;
    b.addEventListener('click', () => store.alignSelected(kind));
    alignGrid.appendChild(b);
  });
  const actions = document.createElement('div');
  actions.className = 'actions-row';
  const dup = document.createElement('button');
  dup.className = 'btn';
  dup.textContent = '复制';
  dup.addEventListener('click', () => store.duplicateSelected());
  const selAll = document.createElement('button');
  selAll.className = 'btn';
  selAll.textContent = '全选';
  selAll.addEventListener('click', () => store.selectAll());
  const del = document.createElement('button');
  del.className = 'btn btn-danger';
  del.textContent = '删除';
  del.addEventListener('click', () => store.deleteSelected());
  actions.append(dup, selAll, del);
  const wrap = document.createElement('div');
  wrap.append(head, section('批量设置', field('移到控件组', groupSel)), section('对齐', alignGrid), section('操作', actions));
  return wrap;
}

/* ------------------------------------------------------------ 属性绑定 */
function bindCommon() {
  const bindText = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { store.state.meta[key] = el.value; });
    el.addEventListener('change', () => store.emit('meta', { skipStage: true }));
  };
  bindText('metaName', 'name');
  bindText('metaAuthor', 'author');
  bindText('metaVersion', 'version');
  ['metaName', 'metaAuthor', 'metaVersion', 'metaVersionCode'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('focus', () => store.snapshot());
  });
  const vc = document.getElementById('metaVersionCode');
  if (vc) {
    vc.addEventListener('change', () => {
      const n = parseInt(vc.value, 10);
      if (Number.isFinite(n) && n >= 1) { store.state.meta.versionCode = n; store.emit('meta', { skipStage: true }); }
    });
  }
  const aspect = document.getElementById('canvasAspect');
  if (aspect) {
    aspect.addEventListener('change', () => {
      if (aspect.value === 'custom') { openResolutionModal(); return; }
      store.updateCanvas({ aspect: aspect.value });
      fitView();
    });
  }
  const step = document.getElementById('gridStep');
  if (step) step.addEventListener('change', () => store.updateCanvas({ gridStep: parseInt(step.value, 10) || 10 }));
}

function bindSingle(control) {
  bindCommon();
  const groupSel = document.getElementById('ctrlGroup');
  if (groupSel) groupSel.addEventListener('change', () => store.moveSelectedToGroup(groupSel.value));
  const text = document.getElementById('ctrlText');
  if (text) {
    text.addEventListener('focus', () => store.snapshot());
    text.addEventListener('input', () => { control.text = text.value; renderStage(); store.scheduleSave(); });
    text.addEventListener('change', () => store.emit('text-edit', { skipStage: true }));
  }
  const vis = document.getElementById('ctrlVisibility');
  if (vis) vis.addEventListener('change', () => {
    store.snapshot();
    control.base.visibility = vis.value;
    store.emit('visibility', { skipStage: true });
  });
  const ref = document.getElementById('ctrlRef');
  if (ref) ref.addEventListener('change', () => { store.snapshot(); control.base.ref = ref.value; store.emit('ref', { skipStage: true }); });
  const num = (id, apply) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { store.snapshot(); apply(clampInput(el.value, Number(el.min) || 0, Number(el.max) || 1000, 0)); });
  };
  num('ctrlW', (v) => {
    control.base.w = Math.max(10, v);
    if (control.type === 'direction') control.base.h = control.base.w;
    store.emit('size', { skipStage: true });
  });
  num('ctrlH', (v) => { control.base.h = Math.max(10, v); store.emit('size', { skipStage: true }); });
  num('ctrlX', (v) => { control.base.x = v; store.emit('pos', { skipStage: true }); });
  num('ctrlY', (v) => { control.base.y = v; store.emit('pos', { skipStage: true }); });

  document.querySelectorAll('[data-behavior-flag]').forEach((cb) => {
    cb.addEventListener('change', () => {
      store.snapshot();
      control.event[actionTrigger][cb.dataset.behaviorFlag] = cb.checked;
      store.scheduleSave();
    });
  });
  document.querySelectorAll('[data-behavior-global]').forEach((cb) => {
    cb.addEventListener('change', () => {
      store.snapshot();
      control.event[cb.dataset.behaviorGlobal] = cb.checked;
      store.scheduleSave();
    });
  });
  const out = document.getElementById('ctrlOutputText');
  if (out) {
    out.addEventListener('focus', () => store.snapshot());
    out.addEventListener('input', () => {
      control.event[actionTrigger].outputText = out.value;
      store.scheduleSave();
    });
  }

  const follow = document.getElementById('dirFollow');
  if (follow) follow.addEventListener('change', () => { store.snapshot(); control.dirEvent.followOption = follow.value; store.scheduleSave(); });
  const dead = document.getElementById('dirDeadZone');
  if (dead) dead.addEventListener('change', () => { store.snapshot(); control.dirEvent.deadZone = clampInput(dead.value, 0, 100, 0); store.scheduleSave(); });
  const sneak = document.getElementById('dirSneak');
  if (sneak) sneak.addEventListener('change', () => { store.snapshot(); control.dirEvent.sneak = sneak.checked; store.scheduleSave(); });

  bindStyleInputs(control);
}

function bindStyleInputs(control) {
  const readColorRow = (label) => {
    const rows = [...document.querySelectorAll('.color-field')];
    const found = rows.find((box) => {
      const lab = box.parentElement.querySelector('label');
      return lab && lab.textContent === label;
    });
    if (!found) return null;
    return {
      color: found.querySelector('input[type="color"]'),
      alpha: found.querySelector('input[type="range"]'),
    };
  };
  const applyColor = (label, setter) => {
    const row = readColorRow(label);
    if (!row) return;
    const update = () => setter(argb(row.color.value, parseInt(row.alpha.value, 10) || 0));
    row.color.addEventListener('focus', () => store.snapshot());
    row.alpha.addEventListener('pointerdown', () => store.snapshot());
    row.color.addEventListener('input', update);
    row.alpha.addEventListener('input', update);
  };
  if (control.type === 'direction') {
    if (!control.dirStyle) control.dirStyle = makeRockerStyle();
    const rs = control.dirStyle.rockerStyle || (control.dirStyle.rockerStyle = {});
    applyColor('背景填充', (c) => { rs.bgFillColor = c; renderStage(); store.scheduleSave(); });
    applyColor('背景描边', (c) => { rs.bgStrokeColor = c; renderStage(); store.scheduleSave(); });
    applyColor('摇杆填充', (c) => { rs.rockerFillColor = c; renderStage(); store.scheduleSave(); });
    applyColor('摇杆描边', (c) => { rs.rockerStrokeColor = c; renderStage(); store.scheduleSave(); });
    const rockerSize = document.getElementById('rockerSize');
    if (rockerSize) rockerSize.addEventListener('change', () => {
      store.snapshot();
      rs.rockerSize = clampInput(rockerSize.value, 50, 1000, 400);
      renderStage();
      store.scheduleSave();
    });
    return;
  }
  const s = control.style || (control.style = {});
  applyColor('填充颜色', (c) => {
    s.fillColor = c;
    s.fillColorPressed = argb(hexOf(c).hex, Math.min(100, hexOf(c).alpha + 40));
    renderStage(); store.scheduleSave();
  });
  applyColor('描边颜色', (c) => { s.strokeColor = c; s.strokeColorPressed = c; renderStage(); store.scheduleSave(); });
  applyColor('文字颜色', (c) => {
    s.textColor = c;
    s.textColorPressed = -1;
    renderStage(); store.scheduleSave();
  });
  const radius = document.getElementById('styleRadius');
  if (radius) radius.addEventListener('change', () => {
    store.snapshot();
    s.cornerRadius = clampInput(radius.value, 0, 2000, 100);
    s.cornerRadiusPressed = s.cornerRadius;
    renderStage(); store.scheduleSave();
  });
  const stroke = document.getElementById('styleStroke');
  if (stroke) stroke.addEventListener('change', () => {
    store.snapshot();
    s.strokeWidth = clampInput(stroke.value, 0, 500, 20);
    s.strokeWidthPressed = s.strokeWidth;
    renderStage(); store.scheduleSave();
  });
  const textSize = document.getElementById('styleTextSize');
  if (textSize) textSize.addEventListener('change', () => {
    store.snapshot();
    s.textSize = clampInput(textSize.value, 0, 200, 12);
    s.textSizePressed = s.textSize;
    renderStage(); store.scheduleSave();
  });
}

/* ------------------------------------------------------------ 逻辑关系图 */
function openLogicGraph() {
  closeDrawers();
  logicOpen = true;
  UI.logicRoot.classList.add('active');
  renderLogicGraph();
}
function closeLogicGraph() {
  logicOpen = false;
  UI.logicRoot.classList.remove('active');
  UI.logicRoot.innerHTML = '';
}
function renderLogicGraph() {
  if (!logicOpen) return;
  const groups = store.state.groups;
  const W = 1100;
  const H = 660;
  const NS = 'http://www.w3.org/2000/svg';
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.34;
  const savedPositions = store.state.logic?.positions || {};
  const nodes = groups.map((g, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, groups.length);
    const saved = savedPositions[g.id];
    const x = saved ? Math.max(90, Math.min(W - 90, saved.x)) : cx + (groups.length === 1 ? 0 : Math.cos(angle) * radius * 1.55);
    const y = saved ? Math.max(50, Math.min(H - 50, saved.y)) : cy + (groups.length === 1 ? 0 : Math.sin(angle) * radius);
    return { group: g, x, y };
  });
  const pos = new Map(nodes.map((nd) => [nd.group.id, nd]));
  const edges = new Map();
  store.state.controls.forEach((c) => {
    ['pressEvent', 'longPressEvent', 'clickEvent', 'doubleClickEvent'].forEach((key) => {
      const ev = c.event?.[key];
      if (!ev || !Array.isArray(ev.bindViewGroup)) return;
      ev.bindViewGroup.forEach((bind) => {
        const [gid, mode] = String(bind).split(':');
        if (!pos.has(c.groupId) || !pos.has(gid)) return;
        const kind = mode || 'toggle';
        const id = `${c.groupId}->${gid}:${kind}`;
        const prev = edges.get(id) || { src: c.groupId, dst: gid, kind, count: 0 };
        prev.count += 1;
        edges.set(id, prev);
      });
    });
  });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const defs = document.createElementNS(NS, 'defs');
  ['toggle', 'show', 'hide'].forEach((kind) => {
    const marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', `arrow-${kind}`);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    path.setAttribute('fill', kind === 'show' ? '#7ce38b' : kind === 'hide' ? '#ff8080' : '#8fb8ff');
    marker.appendChild(path);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);
  edges.forEach((edge) => {
    const a = pos.get(edge.src);
    const b = pos.get(edge.dst);
    if (!a || !b) return;
    const isSelf = edge.src === edge.dst;
    let d; let lx; let ly;
    if (isSelf) {
      const x = a.x + 90;
      d = `M ${a.x + 70} ${a.y - 26} C ${x + 60} ${a.y - 110}, ${x + 60} ${a.y + 110}, ${a.x + 70} ${a.y + 26}`;
      lx = x + 34; ly = a.y;
    } else {
      const dx = b.x - a.x; const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len; const uy = dy / len;
      const sx = a.x + ux * 78; const sy = a.y + uy * 30;
      const ex = b.x - ux * 78; const ey = b.y - uy * 30;
      const mx = (sx + ex) / 2 - uy * 34; const my = (sy + ey) / 2 + ux * 34;
      d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
      lx = (sx + ex) / 2 - uy * 20; ly = (sy + ey) / 2 + ux * 20;
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', `logic-edge ${edge.kind}`);
    path.setAttribute('d', d);
    path.setAttribute('marker-end', `url(#arrow-${edge.kind})`);
    svg.appendChild(path);
    const hit = document.createElementNS(NS, 'path');
    hit.setAttribute('class', 'logic-edge-hit');
    hit.setAttribute('d', d);
    hit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEdgeEditor(edge);
    });
    svg.appendChild(hit);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('class', 'logic-edge-label');
    label.setAttribute('x', lx); label.setAttribute('y', ly);
    label.setAttribute('text-anchor', 'middle');
    const kindText = edge.kind === 'show' ? '显示' : edge.kind === 'hide' ? '隐藏' : '切换';
    label.textContent = `${kindText}${edge.count > 1 ? ` ×${edge.count}` : ''}`;
    svg.appendChild(label);
  });
  nodes.forEach((nd) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'logic-node' + (nd.group.id === store.state.activeGroupId ? ' active' : ''));
    g.setAttribute('transform', `translate(${nd.x - 78}, ${nd.y - 30})`);
    g.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const start = svgPoint(svg, ev);
      const origin = { x: nd.x, y: nd.y };
      let moved = false;
      const onMove = (e) => {
        const cur = svgPoint(svg, e);
        const dx = cur.x - start.x;
        const dy = cur.y - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        nd.x = Math.max(90, Math.min(W - 90, origin.x + dx));
        nd.y = Math.max(50, Math.min(H - 50, origin.y + dy));
        g.setAttribute('transform', `translate(${nd.x - 78}, ${nd.y - 30})`);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (moved) {
          store.snapshot();
          store.setLogicPosition(nd.group.id, nd.x, nd.y);
          renderLogicGraph();
        } else {
          store.setActiveGroup(nd.group.id);
          store.selectGroup(nd.group.id);
          renderLogicGraph();
          toast(`已选中「${nd.group.name}」的控件`);
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('width', '156'); rect.setAttribute('height', '60'); rect.setAttribute('rx', '12');
    g.appendChild(rect);
    const name = document.createElementNS(NS, 'text');
    name.setAttribute('x', '14'); name.setAttribute('y', '26');
    name.textContent = truncate(nd.group.name, 10);
    g.appendChild(name);
    const count = document.createElementNS(NS, 'text');
    count.setAttribute('class', 'logic-node-count');
    count.setAttribute('x', '14'); count.setAttribute('y', '46');
    count.textContent = `${store.groupControls(nd.group.id).length} 个控件`;
    g.appendChild(count);
    if (nd.group.visibility === 'INVISIBLE') {
      const vis = document.createElementNS(NS, 'text');
      vis.setAttribute('class', 'logic-node-vis');
      vis.setAttribute('x', '128'); vis.setAttribute('y', '46');
      vis.textContent = '隐藏';
      g.appendChild(vis);
    }
    svg.appendChild(g);
  });

  const panel = document.createElement('div');
  panel.className = 'logic-panel';
  const head = document.createElement('div');
  head.className = 'logic-head';
  head.innerHTML = '<div><h3>控件组逻辑关系</h3><p>箭头 = 按钮 bindViewGroup 绑定；点击节点选中该组控件</p></div>';
  const actions = document.createElement('div');
  actions.className = 'logic-actions';
  const addRel = document.createElement('button');
  addRel.className = 'btn btn-sm';
  addRel.textContent = '＋ 添加关系';
  addRel.addEventListener('click', openAddRelationModal);
  const resetLayout = document.createElement('button');
  resetLayout.className = 'btn btn-sm';
  resetLayout.textContent = '重置布局';
  resetLayout.addEventListener('click', () => {
    store.snapshot();
    store.state.logic = { positions: {} };
    store.scheduleSave();
    renderLogicGraph();
    toast('已重置节点位置');
  });
  const refresh = document.createElement('button');
  refresh.className = 'btn btn-sm';
  refresh.textContent = '刷新';
  refresh.addEventListener('click', renderLogicGraph);
  const close = document.createElement('button');
  close.className = 'btn btn-primary btn-sm';
  close.textContent = '关闭';
  close.addEventListener('click', closeLogicGraph);
  actions.append(addRel, resetLayout, refresh, close);
  head.appendChild(actions);
  panel.appendChild(head);
  const body = document.createElement('div');
  body.className = 'logic-body';
  body.appendChild(svg);
  const hint = document.createElement('div');
  hint.className = 'logic-hint';
  hint.textContent = `共 ${groups.length} 个控件组 · ${edges.size} 条绑定关系`;
  body.appendChild(hint);
  const legend = document.createElement('div');
  legend.className = 'logic-legend';
  legend.innerHTML = '<span><i style="background:#8fb8ff"></i>切换显隐</span>'
    + '<span><i style="background:#7ce38b"></i>显示</span><span><i style="background:#ff8080"></i>隐藏</span>';
  body.appendChild(legend);
  if (edges.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'logic-empty';
    empty.innerHTML = '还没有绑定关系。<br>选中按钮 → 属性抽屉「键位映射与动作」→ 绑定控件组。';
    body.appendChild(empty);
  }
  panel.appendChild(body);
  const backdrop = document.createElement('div');
  backdrop.className = 'logic-backdrop';
  backdrop.addEventListener('click', closeLogicGraph);
  UI.logicRoot.replaceChildren(backdrop, panel);
}

/* ------------------------------------------------- 逻辑图编辑：关系/节点 */
function svgPoint(svg, ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: ev.clientX, y: ev.clientY };
  const out = pt.matrixTransform(ctm.inverse());
  return { x: out.x, y: out.y };
}

function mutateEdgeBindings(edge, mode) {
  const src = store.findGroup(edge.src);
  if (!src) return 0;
  let changed = 0;
  const controls = store.groupControls(src.id).filter((c) => c.type === 'button');
  controls.forEach((control) => {
    ['pressEvent', 'longPressEvent', 'clickEvent', 'doubleClickEvent'].forEach((key) => {
      const ev = control.event?.[key];
      if (!ev || !Array.isArray(ev.bindViewGroup)) return;
      const next = [];
      ev.bindViewGroup.forEach((bind) => {
        const [gid, m] = String(bind).split(':');
        const kind = m || 'toggle';
        if (gid === edge.dst && kind === edge.kind) {
          changed += 1;
          if (mode) next.push(mode === 'toggle' ? gid : `${gid}:${mode}`);
        } else {
          next.push(bind);
        }
      });
      ev.bindViewGroup = next;
    });
  });
  return changed;
}

function openEdgeEditor(edge) {
  const src = store.findGroup(edge.src);
  const dst = store.findGroup(edge.dst);
  if (!src || !dst) return;
  const kindText = edge.kind === 'show' ? '显示' : edge.kind === 'hide' ? '隐藏' : '切换';
  const body = document.createElement('div');
  const info = document.createElement('div');
  info.className = 'note';
  info.innerHTML = `来源：<b>${escapeHtml(src.name)}</b> → 目标：<b>${escapeHtml(dst.name)}</b><br>`
    + `当前动作：<b>${kindText}</b>（绑定 ${edge.count} 处）`;
  body.appendChild(info);
  body.appendChild(field('修改动作', selectEl('edgeMode', [
    { value: 'toggle', label: '切换显隐' },
    { value: 'show', label: '显示' },
    { value: 'hide', label: '隐藏' },
  ], edge.kind)));
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeModal);
  const del = document.createElement('button');
  del.className = 'btn btn-danger';
  del.textContent = '删除关系';
  del.addEventListener('click', () => {
    store.snapshot();
    const changed = mutateEdgeBindings(edge, null);
    store.scheduleSave();
    closeModal();
    renderLogicGraph();
    toast(changed ? `已删除 ${changed} 处绑定` : '没有可删除的绑定');
  });
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = '应用';
  save.addEventListener('click', () => {
    const mode = body.querySelector('#edgeMode').value;
    store.snapshot();
    const changed = mutateEdgeBindings(edge, mode);
    store.scheduleSave();
    closeModal();
    renderLogicGraph();
    toast(changed ? `已修改 ${changed} 处绑定` : '没有可修改的绑定');
  });
  openModal({ title: '编辑逻辑关系', body, footer: [cancel, del, save] });
}

function openAddRelationModal() {
  const groups = store.state.groups;
  const body = document.createElement('div');
  const sourceSel = selectEl('relSource', groups.map((g) => ({ value: g.id, label: g.name })), groups[0]?.id);
  const targetSel = selectEl('relTarget', groups.map((g) => ({ value: g.id, label: g.name })), groups[1]?.id || groups[0]?.id);
  const triggerSel = selectEl('relTrigger', [
    { value: 'pressEvent', label: '按下' },
    { value: 'longPressEvent', label: '长按' },
    { value: 'clickEvent', label: '轻点' },
    { value: 'doubleClickEvent', label: '双击' },
  ], 'pressEvent');
  const modeSel = selectEl('relMode', [
    { value: 'toggle', label: '切换显隐' },
    { value: 'show', label: '显示' },
    { value: 'hide', label: '隐藏' },
  ], 'toggle');
  const buttonWrap = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'field-row';
  grid.append(field('来源控件组', sourceSel), field('目标控件组', targetSel));
  const grid2 = document.createElement('div');
  grid2.className = 'field-row';
  grid2.append(field('触发时机', triggerSel), field('动作', modeSel));
  body.append(grid, grid2, field('触发按钮（来源组内）', buttonWrap));

  const renderButtons = () => {
    buttonWrap.replaceChildren();
    const btns = store.groupControls(sourceSel.value).filter((c) => c.type === 'button');
    if (!btns.length) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = '该控件组内还没有按键控件，请先添加按钮。';
      buttonWrap.appendChild(note);
      return;
    }
    const sel = selectEl('relButton', btns.map((b) => ({
      value: b.id,
      label: (b.text || b.presetName || '按钮') + (b.presetName ? ` · ${b.presetName}` : ''),
    })), btns[0].id);
    buttonWrap.appendChild(sel);
  };
  renderButtons();
  sourceSel.addEventListener('change', renderButtons);

  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = '绑定会写入该按钮的 bindViewGroup，逻辑图与导出会同步更新。';
  body.appendChild(note);

  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeModal);
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = '添加';
  save.addEventListener('click', () => {
    const buttonSel = body.querySelector('#relButton');
    if (!buttonSel) { toast('来源组没有可用按钮', 'err'); return; }
    const control = store.findControl(buttonSel.value);
    if (!control) { toast('找不到按钮', 'err'); return; }
    if (!control.event) control.event = makeButtonEvent({});
    const ev = control.event[triggerSel.value];
    if (!ev) control.event[triggerSel.value] = makeButtonEvent({})[triggerSel.value];
    const target = targetSel.value;
    const mode = modeSel.value;
    store.snapshot();
    control.event[triggerSel.value].bindViewGroup.push(mode === 'toggle' ? target : `${target}:${mode}`);
    store.scheduleSave();
    closeModal();
    renderLogicGraph();
    toast('已添加绑定关系', 'ok');
  });
  openModal({ title: '添加逻辑关系', subtitle: '把来源组某个按钮绑定到目标控件组', body, footer: [cancel, save] });
}

/* ------------------------------------------------------- 控件组排序 */
function openGroupSortModal() {
  const body = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'sort-list';
  const render = () => {
    const modalBody = list.closest('.modal-body');
    const keptTop = modalBody ? modalBody.scrollTop : 0;
    list.replaceChildren();
    store.state.groups.forEach((g, index) => {
      const row = document.createElement('div');
      row.className = 'sort-row' + (g.id === store.state.activeGroupId ? ' active' : '');
      const dot = document.createElement('span');
      dot.className = 'g-dot';
      dot.style.background = g.color;
      dot.style.color = g.color;
      const name = document.createElement('span');
      name.className = 'sort-name';
      name.textContent = g.name;
      const count = document.createElement('span');
      count.className = 'g-count';
      count.textContent = `${store.groupControls(g.id).length}`;
      const tools = document.createElement('div');
      tools.className = 'sort-tools';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'mini-btn';
      up.textContent = '↑';
      up.disabled = index === 0;
      up.addEventListener('click', () => { store.moveGroup(g.id, -1); render(); });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'mini-btn';
      down.textContent = '↓';
      down.disabled = index === store.state.groups.length - 1;
      down.addEventListener('click', () => { store.moveGroup(g.id, 1); render(); });
      tools.append(up, down);
      row.append(dot, name, count, tools);
      list.appendChild(row);
    });
    if (modalBody) modalBody.scrollTop = keptTop;
  };
  render();
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = '排序会影响左侧控件组列表、画布叠加顺序以及导出 viewGroups 的顺序。';
  body.append(list, note);
  const close = document.createElement('button');
  close.className = 'btn btn-primary';
  close.textContent = '完成';
  close.addEventListener('click', closeModal);
  openModal({ title: '控件组排序', subtitle: '用 ↑ ↓ 调整顺序', body, footer: [close] });
}

/* ------------------------------------------------------- 全局菜单（☰） */
function openAppMenu() {
  const body = document.createElement('div');
  const section = (title, items) => {
    const head = document.createElement('div');
    head.className = 'app-menu-title';
    head.textContent = title;
    body.appendChild(head);
    items.forEach(({ label, hint, action }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-menu-item';
      const text = document.createElement('span');
      text.className = 'app-menu-label';
      text.textContent = label;
      btn.appendChild(text);
      if (hint) {
        const h = document.createElement('span');
        h.className = 'app-menu-hint';
        h.textContent = hint;
        btn.appendChild(h);
      }
      btn.addEventListener('click', action);
      body.appendChild(btn);
    });
  };

  section('编辑', [
    { label: '添加控件 / 控件组', hint: '打开左侧面板', action: () => { closeModal(); openDrawer('left'); } },
    { label: '布局与画布设置', hint: '名称/作者/分辨率', action: () => { closeModal(); store.select([]); openDrawer('right'); } },
    { label: '控件组排序', hint: '调整显示与导出顺序', action: () => { closeModal(); openGroupSortModal(); } },
    { label: '控件组逻辑关系', hint: '可拖动编辑', action: () => { closeModal(); openLogicGraph(); } },
  ]);
  section('文件', [
    { label: '导入 FCL 控制器', hint: '整个 JSON', action: () => { closeModal(); UI.fileImport.click(); } },
    { label: '导出 FCL 控制器', hint: 'controllerVersion 21', action: () => { closeModal(); openExportModal(); } },
    { label: '载入示例键位', hint: '', action: () => { closeModal(); loadDemo(); } },
    { label: '清空画布', hint: '保留控件组', action: () => { closeModal(); confirmClear(); } },
  ]);
  section('界面', [
    { label: '自定义预设分类', hint: '重命名/删除', action: () => { closeModal(); openCategoryListModal(); } },
    { label: '全屏编辑', hint: '隐藏上下栏', action: () => { closeModal(); toggleZen(); } },
    { label: '操作说明', hint: '手势与快捷键', action: () => { closeModal(); openHelpModal(); } },
  ]);
  const version = document.createElement('div');
  version.className = 'app-menu-version';
  version.textContent = `FCL 键位工坊 · ${window.__FCL_VERSION__ || ''}`;
  body.appendChild(version);
  const close = document.createElement('button');
  close.className = 'btn btn-ghost';
  close.textContent = '关闭';
  close.addEventListener('click', closeModal);
  openModal({ title: '全局菜单', subtitle: '文件 / 界面 / 帮助', body, footer: [close] });
}

function openHelpModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="help-list">
      <div><b>点控件</b>选中；「移动」模式或多选下可逐个加选</div>
      <div><b>拖动控件</b>移动；拖右下角手柄缩放</div>
      <div><b>长按空白</b>约 0.36s 后拖动 = 框选</div>
      <div><b>双指</b>缩放/平移画布；单指拖空白平移</div>
      <div><b>双击控件</b>打开属性并聚焦文字</div>
      <div><b>F</b> 全屏编辑 / <b>Esc</b> 退出</div>
      <div><b>Ctrl/⌘ + A / D / E</b> 全选 / 复制 / 导出</div>
      <div><b>Delete</b> 删除选中；方向键微调（Shift ×10）</div>
    </div>`;
  const close = document.createElement('button');
  close.className = 'btn btn-primary';
  close.textContent = '知道了';
  close.addEventListener('click', closeModal);
  openModal({ title: '操作说明', body, footer: [close] });
}

/* -------------------------------------------------------------- 弹窗 */
function openModal({ title, subtitle = '', body, footer, wide = false, onMount, stack = false }) {
  if (!stack) closeAllModals();
  const root = document.createElement('div');
  root.className = 'modal-root active';
  root.style.zIndex = String(90 + modalStack.length * 2);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal' + (wide ? ' modal-wide' : '');
  modal.innerHTML = `
    <div class="modal-head">
      <div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
      <button class="modal-close" type="button" title="关闭">✕</button>
    </div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div>`;
  const bodyEl = modal.querySelector('.modal-body');
  const footEl = modal.querySelector('.modal-foot');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  if (footer) footer.forEach((node) => footEl.appendChild(node));
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  root.append(backdrop, modal);
  document.body.appendChild(root);
  modalStack.push(root);
  closeModalFn = closeModal;
  if (onMount) onMount({ body: bodyEl, modal });
  return closeModal;
}
function closeAllModals() {
  while (modalStack.length) {
    const root = modalStack.pop();
    root.remove();
  }
  closeModalFn = null;
}
function closeModal() {
  const root = modalStack.pop();
  if (root) root.remove();
  closeModalFn = modalStack.length ? closeModal : null;
}
function openTextModal(title, defaultValue, onSave, options = {}) {
  const body = document.createElement('div');
  const input = inputEl({ id: 'textModalInput', value: defaultValue });
  body.appendChild(field('名称', input));
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeModal);
  const ok = document.createElement('button');
  ok.className = 'btn btn-primary';
  ok.textContent = '确定';
  ok.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) { toast('名称不能为空', 'err'); return; }
    closeModal();
    onSave(value);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
  openModal({ title, body, footer: [cancel, ok], stack: Boolean(options.stack), onMount: ({ body: b }) => {
    const el = b.querySelector('#textModalInput');
    requestAnimationFrame(() => { el.focus(); el.select(); });
  } });
}
function confirmModal(title, message, onOk) {
  const body = document.createElement('div');
  body.innerHTML = `<div class="note">${escapeHtml(message)}</div>`;
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeModal);
  const ok = document.createElement('button');
  ok.className = 'btn btn-danger';
  ok.textContent = '确认';
  ok.addEventListener('click', () => { closeModal(); onOk(); });
  openModal({ title, body, footer: [cancel, ok] });
}

export function openResolutionModal() {
  const c = store.state.canvas;
  const body = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'field-row';
  grid.append(
    field('宽度（px）', inputEl({ id: 'resW', type: 'number', value: c.customW || 1920, min: 320, max: 4096 })),
    field('高度（px）', inputEl({ id: 'resH', type: 'number', value: c.customH || 1080, min: 240, max: 4096 })),
  );
  body.appendChild(grid);
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = '自定义分辨率用于画布预览与坐标比例（千分比不受影响）。';
  body.appendChild(note);
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => { closeModal(); UI.aspectSelect.value = store.state.canvas.aspect; });
  const ok = document.createElement('button');
  ok.className = 'btn btn-primary';
  ok.textContent = '应用';
  ok.addEventListener('click', () => {
    const w = clampInput(body.querySelector('#resW').value, 320, 4096, 1920);
    const h = clampInput(body.querySelector('#resH').value, 240, 4096, 1080);
    store.updateCanvas({ aspect: 'custom', customW: w, customH: h });
    closeModal();
    fitView();
    toast(`画布已设为 ${w} × ${h}`, 'ok');
  });
  openModal({ title: '自定义画布分辨率', body, footer: [cancel, ok] });
}

/* -------------------------------------------------------------- 导出 */
export function openExportModal() {
  const controller = buildController(store.state);
  const text = JSON.stringify(controller, null, 2);
  const body = document.createElement('div');
  const fieldWrap = field('FCL 控制器 JSON（controllerVersion ' + controller.controllerVersion + '）');
  const ta = document.createElement('textarea');
  ta.className = 'json-pre';
  ta.readOnly = true;
  ta.value = text;
  fieldWrap.appendChild(ta);
  const note = document.createElement('div');
  note.className = 'note';
  note.style.marginTop = '10px';
  note.innerHTML = `文件 id：<b>${controller.id}</b>　共 ${controller.viewGroups.length} 个控件组 / `
    + `${controller.viewGroups.reduce((n, g) => n + g.viewData.buttonList.length, 0)} 个按键。`;
  body.append(fieldWrap, note);
  const close = document.createElement('button');
  close.className = 'btn btn-ghost';
  close.textContent = '关闭';
  close.addEventListener('click', closeModal);
  const copy = document.createElement('button');
  copy.className = 'btn';
  copy.textContent = '复制';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); } catch { ta.focus(); ta.select(); }
  });
  const download = document.createElement('button');
  download.className = 'btn btn-primary';
  download.textContent = '下载 JSON';
  download.addEventListener('click', () => { downloadController(controller); toast('已开始下载', 'ok'); });
  openModal({ title: '导出 FCL 控制器', subtitle: '含全部控件组与绑定关系', wide: true, body, footer: [close, copy, download] });
}

/* ------------------------------------------------------------ 导入 / 示例 */
function onImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const result = importController(String(reader.result));
      if (!result.controls.length) throw new Error('文件里没有可导入的控件');
      store.replaceControls(result.controls, result.meta, result.groups);
      closeDrawers();
      fitView();
      toast(`已导入 ${result.groups.length} 个控件组 / ${result.controls.length} 个控件`, 'ok');
      result.warnings?.forEach((w) => toast(w, 'err'));
    } catch (err) {
      toast('导入失败：' + err.message, 'err');
    } finally {
      UI.fileImport.value = '';
    }
  };
  reader.onerror = () => toast('文件读取失败', 'err');
  reader.readAsText(file);
}

export async function loadDemo() {
  try {
    let text;
    const inlineDemo = document.getElementById('demoData');
    if (inlineDemo && inlineDemo.textContent.trim()) {
      text = inlineDemo.textContent;
    } else if (globalThis.__FCL_DEMO_JSON__) {
      text = JSON.stringify(globalThis.__FCL_DEMO_JSON__);
    } else {
      const res = await fetch('data/demo0001.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('示例数据不存在');
      text = await res.text();
    }
    const result = importController(text);
    store.replaceControls(result.controls, result.meta, result.groups);
    closeDrawers();
    fitView();
    toast(`已载入示例：${result.groups.length} 组 / ${result.controls.length} 控件`, 'ok');
  } catch (err) {
    toast('载入示例失败：' + err.message, 'err');
  }
}

function confirmClear() {
  confirmModal('清空画布', '确定删除画布上的全部控件（控件组保留）？', () => {
    store.resetLayout();
    toast('画布已清空');
  });
}

function fitView() {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('app:zen-changed'));
  });
}

/* ------------------------------------------------------------ 自定义预设 */
export function openPresetDialog(existing = null, sourceControl = null) {
  const seed = sourceControl
    ? createCustomPresetFromControl(sourceControl, (sourceControl.presetName || '自定义') + ' 预设')
    : existing;
  const isEdit = Boolean(existing);
  const kind = seed?.kind || 'button';
  const base = seed?.base || { w: 120, h: 120, ref: 'SCREEN_WIDTH' };
  const style = seed?.style || {};
  const ev = seed?.event || makeButtonEvent({});
  const dirEvent = seed?.dirEvent || makeDirectionEvent();
  const activeTrigger = Object.keys(TRIGGERS).find((k) => {
    const e = ev[TRIGGERS[k]];
    return e && (e.outputKeycodes?.length || e.autoKeep || e.autoClick || e.openMenu || e.quickInput || e.input || e.outputText);
  }) || 'press';
  const activeEv = ev[TRIGGERS[activeTrigger]] || makeButtonEvent({})[TRIGGERS[activeTrigger]];

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="field span-2"><label>预设名称</label><input class="input" id="presetName" value="${escapeAttr(seed?.name || '')}" placeholder="例如：连击 / 跳跃"></div>
      <div class="field"><label>控件类型</label>
        <select class="select" id="presetKind">
          <option value="button"${kind === 'button' ? ' selected' : ''}>按键</option>
          <option value="direction"${kind === 'direction' ? ' selected' : ''}>方向键 / 摇杆</option>
        </select>
      </div>
      <div class="field"><label>尺寸参考</label>
        <select class="select" id="presetRef">
          <option value="SCREEN_WIDTH"${base.ref !== 'SCREEN_HEIGHT' ? ' selected' : ''}>屏幕宽度</option>
          <option value="SCREEN_HEIGHT"${base.ref === 'SCREEN_HEIGHT' ? ' selected' : ''}>屏幕高度</option>
        </select>
      </div>
      <div class="field"><label>预设分类</label>
        <div style="display:flex;gap:6px">
          <select class="select" id="presetCategory" style="flex:1"></select>
          <button class="btn btn-sm" type="button" id="presetNewCategory">＋</button>
        </div>
      </div>
    </div>
    <div class="form-section">动作</div>
    <div id="buttonForm">
      <div class="form-grid">
        <div class="field"><label>显示文字</label><input class="input" id="presetText" value="${escapeAttr(seed?.text || '')}"></div>
        <div class="field"><label>触发方式</label>
          <select class="select" id="presetTrigger">
            <option value="press"${activeTrigger === 'press' ? ' selected' : ''}>按下</option>
            <option value="click"${activeTrigger === 'click' ? ' selected' : ''}>轻点</option>
            <option value="longPress"${activeTrigger === 'longPress' ? ' selected' : ''}>长按</option>
            <option value="doubleClick"${activeTrigger === 'doubleClick' ? ' selected' : ''}>双击</option>
          </select>
        </div>
        <div class="field span-2"><label>键码（点击选择，可组合）</label>
          <div id="presetKeys"></div></div>
        <div class="field"><label>宽</label><input class="input" id="presetW" type="number" value="${base.w}"></div>
        <div class="field"><label>高</label><input class="input" id="presetH" type="number" value="${base.h}"${kind === 'direction' ? ' disabled' : ''}></div>
      </div>
      <div class="field"><label>附加动作</label>
        <div class="check-row" id="presetFlags">
          <label class="check"><input type="checkbox" data-flag="autoKeep"${activeEv.autoKeep ? ' checked' : ''}>切换保持</label>
          <label class="check"><input type="checkbox" data-flag="autoClick"${activeEv.autoClick ? ' checked' : ''}>连点</label>
          <label class="check"><input type="checkbox" data-flag="pointerFollow"${ev.pointerFollow ? ' checked' : ''}>拖动视角</label>
          <label class="check"><input type="checkbox" data-flag="swipable"${ev.swipable ? ' checked' : ''}>滑动联动</label>
          <label class="check"><input type="checkbox" data-flag="openMenu"${activeEv.openMenu ? ' checked' : ''}>打开菜单</label>
          <label class="check"><input type="checkbox" data-flag="quickInput"${activeEv.quickInput ? ' checked' : ''}>快捷输入</label>
          <label class="check"><input type="checkbox" data-flag="input"${activeEv.input ? ' checked' : ''}>输入法</label>
        </div>
      </div>
      <div class="field"><label>发送文本</label><input class="input" id="presetOutputText" value="${escapeAttr(activeEv.outputText || '')}"></div>
      <div class="form-section">外观</div>
      ${colorFieldHTML('fill', '填充颜色', style.fillColor ?? 0x33000000)}
      ${colorFieldHTML('stroke', '描边颜色', style.strokeColor ?? 0x66ffffff)}
      ${colorFieldHTML('text', '文字颜色', style.textColor ?? -1)}
      <div class="form-grid">
        <div class="field"><label>圆角</label><input class="input" id="presetRadius" type="number" value="${style.cornerRadius ?? 100}"></div>
        <div class="field"><label>文字大小</label><input class="input" id="presetTextSize" type="number" value="${style.textSize ?? 12}"></div>
      </div>
    </div>
    <div id="directionForm" style="display:none">
      <div class="form-grid">
        <div class="field"><label>方向样式</label>
          <select class="select" id="presetDirType">
            <option value="ROCKER"${(seed?.dirStyle?.styleType || 'ROCKER') === 'ROCKER' ? ' selected' : ''}>摇杆</option>
            <option value="BUTTON"${seed?.dirStyle?.styleType === 'BUTTON' ? ' selected' : ''}>十字键</option>
          </select>
        </div>
        <div class="field"><label>死区</label><input class="input" id="presetDeadZone" type="number" value="${dirEvent.deadZone}"></div>
        <div class="field"><label>上键码</label><div id="presetUp"></div></div>
        <div class="field"><label>下键码</label><div id="presetDown"></div></div>
        <div class="field"><label>左键码</label><div id="presetLeft"></div></div>
        <div class="field"><label>右键码</label><div id="presetRight"></div></div>
        <div class="field"><label>跟随方式</label>
          <select class="select" id="presetFollow">
            <option value="CENTER_FOLLOW"${dirEvent.followOption === 'CENTER_FOLLOW' ? ' selected' : ''}>中心跟随</option>
            <option value="FIXED"${dirEvent.followOption === 'FIXED' ? ' selected' : ''}>固定</option>
            <option value="FOLLOW"${dirEvent.followOption === 'FOLLOW' ? ' selected' : ''}>跟随</option>
          </select>
        </div>
        <div class="field"><label>双击潜行</label>
          <select class="select" id="presetSneak">
            <option value="1"${dirEvent.sneak ? ' selected' : ''}>开启</option>
            <option value="0"${!dirEvent.sneak ? ' selected' : ''}>关闭</option>
          </select>
        </div>
      </div>
    </div>`;
  let presetKeysValue = [...(activeEv.outputKeycodes || [])];
  const presetDirValues = {
    up: [...(dirEvent.upKeycode || [])],
    down: [...(dirEvent.downKeycode || [])],
    left: [...(dirEvent.leftKeycode || [])],
    right: [...(dirEvent.rightKeycode || [])],
  };
  const ensureHost = (sel) => {
    let host = body.querySelector(sel);
    if (!host) {
      host = document.createElement('div');
      host.id = sel.replace('#', '');
      body.appendChild(host);
    }
    return host;
  };
  const keysBtn = keyValueButton(presetKeysValue, () => {
    openKeyPicker(presetKeysValue, (codes) => {
      presetKeysValue = codes;
      refreshKeyValue(keysBtn, codes);
    });
  });
  ensureHost('#presetKeys').appendChild(keysBtn);
  [['up', '#presetUp'], ['down', '#presetDown'], ['left', '#presetLeft'], ['right', '#presetRight']]
    .forEach(([key, sel]) => {
      const btn = keyValueButton(presetDirValues[key], () => {
        openKeyPicker(presetDirValues[key], (codes) => {
          presetDirValues[key] = codes;
          refreshKeyValue(btn, codes);
        });
      });
      ensureHost(sel).appendChild(btn);
    });

  let categorySelect = body.querySelector('#presetCategory');
  if (!categorySelect) {
    categorySelect = document.createElement('select');
    categorySelect.id = 'presetCategory';
    body.appendChild(categorySelect);
  }
  store.presetCategories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });
  categorySelect.value = store.presetCategories.includes(seed?.category)
    ? seed.category : DEFAULT_PRESET_CATEGORY;
  const newCategoryBtn = body.querySelector('#presetNewCategory');
  if (newCategoryBtn) newCategoryBtn.addEventListener('click', () => {
    openTextModal('新建预设分类', '新分类', (value) => {
      if (!store.addPresetCategory(value)) { toast('分类已存在或名称无效', 'err'); return; }
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      categorySelect.appendChild(opt);
      categorySelect.value = value;
    });
  });

  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeModal);
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = isEdit ? '保存修改' : '保存预设';
  save.addEventListener('click', () => {
    const name = body.querySelector('#presetName').value.trim();
    if (!name) { toast('请填写预设名称', 'err'); return; }
    const kindVal = body.querySelector('#presetKind').value;
    const refVal = body.querySelector('#presetRef').value;
    const categoryVal = (body.querySelector('#presetCategory')?.value) || DEFAULT_PRESET_CATEGORY;
    const wVal = clampInput(body.querySelector('#presetW').value, 10, 1000, 120);
    const hVal = kindVal === 'direction' ? wVal : clampInput(body.querySelector('#presetH').value, 10, 1000, wVal);
    if (kindVal === 'direction') {
      const dirType = body.querySelector('#presetDirType').value;
      savePreset({
        id: existing?.id || 'custom.' + makeId(),
        kind: 'direction', group: '自定义', category: categoryVal, name,
        hint: '自定义方向 · ' + dirType, text: '',
        base: { w: wVal, h: hVal, ref: refVal },
        style: styleFromForm(body),
        event: makeButtonEvent({}),
        dirStyle: dirType === 'ROCKER' ? makeRockerStyle() : makeDpadStyle(),
        dirEvent: makeDirectionEvent({
          upKeycode: presetDirValues.up,
          downKeycode: presetDirValues.down,
          leftKeycode: presetDirValues.left,
          rightKeycode: presetDirValues.right,
          followOption: body.querySelector('#presetFollow').value,
          deadZone: clampInput(body.querySelector('#presetDeadZone').value, 0, 100, 10),
          sneak: body.querySelector('#presetSneak').value === '1',
        }),
      }, isEdit);
      return;
    }
    const triggerVal = body.querySelector('#presetTrigger').value;
    const flags = {};
    body.querySelectorAll('#presetFlags input[type="checkbox"]').forEach((cb) => { flags[cb.dataset.flag] = cb.checked; });
    savePreset({
      id: existing?.id || 'custom.' + makeId(),
      kind: 'button', group: '自定义', name,
      hint: triggerLabel(triggerVal) + ' · ' + (presetKeysValue.length ? keycodesLabel(presetKeysValue) : '无键码'),
      text: body.querySelector('#presetText').value,
      base: { w: wVal, h: hVal, ref: refVal },
      style: styleFromForm(body),
      event: makeButtonEvent({
        trigger: triggerVal,
        keycodes: presetKeysValue,
        autoKeep: flags.autoKeep, autoClick: flags.autoClick,
        pointerFollow: flags.pointerFollow, swipable: flags.swipable,
        openMenu: flags.openMenu, quickInput: flags.quickInput,
        input: flags.input, outputText: body.querySelector('#presetOutputText').value,
      }),
    }, isEdit);
  });
  openModal({
    title: isEdit ? '编辑自定义预设' : '新建自定义预设',
    subtitle: '保存后在左侧「添加控件」里复用',
    body, footer: [cancel, save],
    onMount: ({ body: bodyEl }) => {
      const kindSel = bodyEl.querySelector('#presetKind');
      const sync = () => {
        const dir = kindSel.value === 'direction';
        bodyEl.querySelector('#buttonForm').style.display = dir ? 'none' : '';
        bodyEl.querySelector('#directionForm').style.display = dir ? '' : 'none';
        bodyEl.querySelector('#presetH').disabled = dir;
      };
      kindSel.addEventListener('change', sync);
      sync();
      bodyEl.querySelectorAll('.color-field input[type="range"]').forEach((range) => {
        range.addEventListener('input', () => {
          range.closest('.opacity').querySelector('.opacity-val').textContent = range.value + '%';
        });
      });
    },
  });
}
function savePreset(preset, isEdit) {
  if (isEdit) { store.updateCustomPreset(preset.id, preset); toast('已保存修改', 'ok'); }
  else { store.addCustomPreset(preset); toast('已保存自定义预设', 'ok'); }
  closeModal();
}
function colorFieldHTML(key, label, color) {
  const { hex, alpha } = hexOf(color);
  return `<div class="field"><label>${label}</label>
    <div class="color-field">
      <input type="color" id="color-${key}" value="${hex}">
      <div class="opacity"><input type="range" id="alpha-${key}" min="0" max="100" value="${alpha}"></div>
      <span class="opacity-val">${alpha}%</span>
    </div></div>`;
}
function styleFromForm(body) {
  const read = (key) => argb(body.querySelector(`#color-${key}`).value,
    parseInt(body.querySelector(`#alpha-${key}`).value, 10) || 0);
  const fill = read('fill');
  const stroke = read('stroke');
  const textColor = read('text');
  const radius = clampInput(body.querySelector('#presetRadius').value, 0, 2000, 100);
  const textSize = clampInput(body.querySelector('#presetTextSize').value, 0, 200, 12);
  return {
    textColor, textSize, strokeColor: stroke, strokeWidth: 20, cornerRadius: radius, fillColor: fill,
    textColorPressed: -1, textSizePressed: textSize,
    strokeColorPressed: -1, strokeWidthPressed: 20, cornerRadiusPressed: radius,
    fillColorPressed: argb(body.querySelector('#color-fill').value,
      Math.min(100, (parseInt(body.querySelector('#alpha-fill').value, 10) || 0) + 55)),
  };
}
function parseKeys(text, fallback = []) {
  const parsed = String(text || '').split(/[\s,，]+/).map((s) => parseInt(s, 10)).filter(Number.isFinite);
  return parsed.length ? parsed : [...fallback];
}

/* ------------------------------------------------------------ 全屏 */
async function toggleZen() {
  const zen = !document.body.classList.contains('zen-mode');
  document.body.classList.toggle('zen-mode', zen);
  if (zen) closeDrawers();
  try {
    if (zen && document.fullscreenEnabled && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (!zen && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch { /* 忽略 */ }
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('app:zen-changed'));
  });
}

/* ------------------------------------------------------------ 键盘/工具 */
function onGlobalKey(e) {
  if (e.key === 'Escape') {
    if (logicOpen) { closeLogicGraph(); e.stopPropagation(); return; }
    if (modalStack.length) { closeModal(); e.stopPropagation(); return; }
    if (activeDrawer) { closeDrawers(); e.stopPropagation(); }
  }
}

function focusControlText(id) {
  store.select([id]);
  actionTrigger = 'pressEvent';
  openDrawer('right');
  requestAnimationFrame(() => {
    const ta = document.getElementById('ctrlText');
    if (ta) { ta.focus(); ta.select(); }
  });
}

export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  UI.toastRoot.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, 2400);
}

function clampInput(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function triggerLabel(key) { return TRIGGER_LABELS[key] || key; }
function truncate(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str).replace(/\n/g, '&#10;'); }
function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2, 10);
}
