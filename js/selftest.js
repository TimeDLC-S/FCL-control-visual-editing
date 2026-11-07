/* =========================================================================
 * selftest.js —— 浏览器内自检（仅 ?selftest=1 时运行，用于开发验证）
 * 用合成 PointerEvent 走真实交互路径，结果写到页面上，便于外部观察。
 * ========================================================================= */
import { ASPECTS, makeButtonEvent } from './data.js';
import * as store from './store.js';
import { renderStage } from './stage.js';
import { buildController } from './export.js';
import { openPresetDialog } from './ui.js';

const results = [];

function assert(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail: condition ? '' : String(detail) });
}

function pointer(target, type, clientX, clientY, extra = {}) {
  const ev = new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX, clientY,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1, pointerType: 'touch', ...extra,
  });
  target.dispatchEvent(ev);
  return ev;
}

function controlEl(id) {
  return document.querySelector(`.ctrl[data-id="${id}"]`);
}

function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function frame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

function panelLine(text, cls = '') {
  const line = document.createElement('div');
  line.className = 'selftest-line ' + cls;
  line.textContent = text;
  return line;
}

export async function runSelfTest() {
  renderStage();
  await frame();

  const root = document.createElement('div');
  root.id = 'selftestPanel';
  root.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;max-width:70vw;max-height:60vh;overflow:auto;'
    + 'background:#000c;border:1px solid #64e2ff;border-radius:8px;padding:10px;color:#cfe;font:12px/1.5 monospace;white-space:pre-wrap';
  document.body.appendChild(root);

  /* 1. 示例 / 控件组 */
  const count = store.state.controls.length;
  assert('示例载入', count >= 30, `controls=${count}`);
  assert('示例控件组', store.state.groups.length >= 3, `groups=${store.state.groups.length}`);
  assert('控件都有 groupId', store.state.controls.every((c) => store.findGroup(c.groupId)));
  const visibleGroupIds = new Set(store.state.groups.filter((g) => g.visibility === 'VISIBLE').map((g) => g.id));
  const expectedRendered = store.state.controls.filter((c) => visibleGroupIds.has(c.groupId)).length;
  const rendered = document.querySelectorAll('#controlsLayer .ctrl').length;
  assert('控件渲染数量', rendered === expectedRendered, `rendered=${rendered} expected=${expectedRendered}`);
  assert('控件组面板行', document.querySelectorAll('.group-row').length === store.state.groups.length);
  assert('横屏比例配置', !ASPECTS['9:16'] && Boolean(ASPECTS['16:9']));

  /* 2. 模式切换 */
  store.setMode('move');
  await frame();
  assert('模式切换 move', store.state.mode === 'move');
  assert('移动模式class', document.getElementById('stage').classList.contains('mode-move'));

  /* 3. 移动模式点选多选（无需 Shift） */
  store.clearSelection();
  renderStage();
  await frame();
  const btns = store.state.controls.filter((c) => c.type === 'button').slice(0, 2);
  for (const c of btns) {
    const el = controlEl(c.id);
    const p = center(el);
    pointer(el, 'pointerdown', p.x, p.y);
    pointer(window, 'pointerup', p.x, p.y);
    await frame();
  }
  assert('点选多选（2 个）', store.state.selection.length >= 2,
    `selected=${store.state.selection.length}`);

  /* 4. 整体拖动多选控件 */
  const before = btns.map((c) => ({ id: c.id, x: c.base.x, y: c.base.y }));
  const dragEl = controlEl(btns[0].id);
  const dp = center(dragEl);
  pointer(dragEl, 'pointerdown', dp.x, dp.y);
  pointer(window, 'pointermove', dp.x + 46, dp.y + 34);
  await frame();
  pointer(window, 'pointerup', dp.x + 46, dp.y + 34);
  await frame();
  const movedAll = before.every((b) => {
    const c = store.findControl(b.id);
    return c && (c.base.x !== b.x || c.base.y !== b.y);
  });
  assert('多选整体拖动', movedAll,
    before.map((b) => `${store.findControl(b.id).base.x},${store.findControl(b.id).base.y}`).join(' | '));

  /* 5. 长按空白框选（手机端） */
  store.clearSelection();
  renderStage();
  await frame();
  const stage = document.getElementById('stage');
  const sr = stage.getBoundingClientRect();
  const sx = sr.right - 24;
  const sy = sr.top + 24;
  pointer(document.getElementById('stageArea'), 'pointerdown', sx, sy);
  await new Promise((r) => setTimeout(r, 620));
  pointer(window, 'pointermove', sr.left + sr.width * 0.55, sr.top + sr.height * 0.6);
  await frame();
  pointer(window, 'pointerup', sr.left + sr.width * 0.55, sr.top + sr.height * 0.6);
  await frame();
  assert('长按空白框选', store.state.selection.length >= 2, `selected=${store.state.selection.length}`);

  /* 6. 右下角手柄缩放（一次拖动应能明显变大） */
  store.setMode('select');
  const single = store.state.controls.find((c) => c.type === 'button' && !c.isPanel);
  store.select([single.id]);
  renderStage();
  await frame();
  const beforeW = single.base.w;
  const handle = document.querySelector('.sel-handle');
  if (handle) {
    const hr = handle.getBoundingClientRect();
    pointer(handle, 'pointerdown', hr.left + hr.width / 2, hr.top + hr.height / 2);
    pointer(window, 'pointermove', hr.left + 120, hr.top + 120);
    await frame();
    pointer(window, 'pointerup', hr.left + 120, hr.top + 120);
    await frame();
    assert('手柄缩放幅度', single.base.w > beforeW + 20, `${beforeW} -> ${single.base.w}`);
  } else {
    assert('手柄缩放幅度', false, '没有找到缩放柄');
  }

  /* 7. 单控件拖动 */
  const one = store.state.controls.find((c) => c.type === 'button' && !c.isPanel);
  store.select([one.id]);
  renderStage();
  await frame();
  const oe = controlEl(one.id);
  const op = center(oe);
  const ox = one.base.x;
  pointer(oe, 'pointerdown', op.x, op.y);
  pointer(window, 'pointermove', op.x + 30, op.y);
  await frame();
  pointer(window, 'pointerup', op.x + 30, op.y);
  await frame();
  assert('单控件拖动', one.base.x !== ox, `${ox} -> ${one.base.x}`);

  /* 7.5 选择模式下的显式多选开关 */
  store.setMode('select');
  store.updateCanvas({ multiSelect: true });
  store.clearSelection();
  renderStage();
  await frame();
  const pick = store.state.controls.filter((c) => c.type === 'button' && !c.isPanel).slice(0, 2);
  for (const c of pick) {
    const el = controlEl(c.id);
    const p0 = center(el);
    pointer(el, 'pointerdown', p0.x, p0.y);
    pointer(window, 'pointerup', p0.x, p0.y);
    await frame();
  }
  assert('选择模式显式多选', store.state.selection.length >= 2,
    `selected=${store.state.selection.length}`);
  store.updateCanvas({ multiSelect: false });

  /* 8. 绑定关系 + 逻辑关系图 */
  const groups = store.state.groups;
  const target = groups.find((g) => g.id !== one.groupId) || groups[0];
  one.event.pressEvent.bindViewGroup = [target.id, `${groups[0].id}:show`];
  store.emit('bindings');
  await frame();
  const controller = buildController(store.state);
  const exportedBinds = [];
  controller.viewGroups.forEach((vg) => vg.viewData.buttonList.forEach((b) => {
    ['pressEvent', 'longPressEvent', 'clickEvent', 'doubleClickEvent'].forEach((k) => {
      exportedBinds.push(...(b.event[k].bindViewGroup || []));
    });
  }));
  assert('导出保留绑定关系', exportedBinds.length >= 2, `binds=${exportedBinds.length}`);
  window.dispatchEvent(new CustomEvent('app:toggle-zen'));
  await frame();
  assert('全屏模式进入', document.body.classList.contains('zen-mode'));
  window.dispatchEvent(new CustomEvent('app:toggle-zen'));
  await frame();
  assert('全屏模式退出', !document.body.classList.contains('zen-mode'));

  /* 9. 控件组切换 / 显隐 */
  const hideTarget = store.state.groups.find((g) => g.visibility === 'VISIBLE'
    && store.state.controls.some((c) => c.groupId === g.id));
  if (hideTarget) {
    const beforeHide = document.querySelectorAll('#controlsLayer .ctrl').length;
    store.updateGroup(hideTarget.id, { visibility: 'INVISIBLE' });
    renderStage();
    await frame();
    const afterHide = document.querySelectorAll('#controlsLayer .ctrl').length;
    assert('隐藏组不渲染', afterHide < beforeHide, `${beforeHide} -> ${afterHide}`);
    store.updateGroup(hideTarget.id, { visibility: 'VISIBLE' });
    renderStage();
    await frame();
    const afterShow = document.querySelectorAll('#controlsLayer .ctrl').length;
    assert('显示组恢复渲染', afterShow === beforeHide, `${afterHide} -> ${afterShow}`);
  } else {
    assert('隐藏组不渲染', false, '没有可隐藏的组');
  }

  /* 9.4 弹窗/编辑路径（含 clampInput 回归） */
  const aspectSel = document.getElementById('aspectSelect');
  aspectSel.value = 'custom';
  aspectSel.dispatchEvent(new Event('change', { bubbles: true }));
  await frame();
  const resW = document.getElementById('resW');
  assert('自定义分辨率弹窗', Boolean(resW));
  if (resW) {
    resW.value = '1600';
    document.getElementById('resH').value = '900';
    const applyBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '应用');
    if (applyBtn) applyBtn.click();
    await frame();
    const dd = store.stageDims();
    assert('自定义分辨率应用', dd.w === 1600 && dd.h === 900, `${dd.w}x${dd.h}`);
  }
  store.updateCanvas({ aspect: '16:9' });
  await frame();

  const beforePresets = store.customPresets.length;
  openPresetDialog();
  await frame();
  const presetNameInput = document.getElementById('presetName');
  assert('自定义预设弹窗', Boolean(presetNameInput));
  if (presetNameInput) {
    presetNameInput.value = '自检预设';
    document.getElementById('presetKeys').value = '57';
    const saveBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.includes('保存'));
    if (saveBtn) saveBtn.click();
    await frame();
    assert('自定义预设可保存', store.customPresets.length === beforePresets + 1);
  }

  const sc = store.state.controls.find((c) => c.type === 'button' && !c.isPanel);
  store.select([sc.id]);
  await frame();
  const radiusInput = document.getElementById('styleRadius');
  if (radiusInput) {
    radiusInput.value = '300';
    radiusInput.dispatchEvent(new Event('change', { bubbles: true }));
    await frame();
    assert('样式编辑生效', sc.style.cornerRadius === 300, String(sc.style.cornerRadius));
  } else {
    assert('样式编辑生效', false, '没有样式输入框');
  }

  /* 9.5 手机端 UI / 新功能 */
  assert('底部工具栏存在', getComputedStyle(document.querySelector('.mobile-bottom')).display !== 'none');
  assert('顶栏导入按钮存在', Boolean(document.getElementById('btnImport')));
  assert('添加区没有内置示例卡片', document.querySelectorAll('.preset-card').length === 0);
  document.getElementById('btnAdd').click();
  await frame();
  assert('左侧抽屉可打开', document.getElementById('leftDrawer').hidden === false);
  document.getElementById('btnLeftClose').click();
  await frame();
  assert('左侧抽屉可关闭', document.getElementById('leftDrawer').hidden === true);

  store.updateCanvas({ groupCollapsed: true });
  await frame();
  assert('控件组可收起', document.querySelectorAll('.group-list').length === 0);
  store.updateCanvas({ groupCollapsed: false });
  await frame();

  store.updateCanvas({ aspect: 'custom', customW: 1280, customH: 720 });
  await frame();
  const dimsCustom = store.stageDims();
  assert('自定义分辨率', dimsCustom.w === 1280 && dimsCustom.h === 720, `${dimsCustom.w}x${dimsCustom.h}`);
  store.updateCanvas({ aspect: '16:9' });
  await frame();

  // 键位映射 / 样式编辑器
  const editable = store.state.controls.find((c) => c.type === 'button' && !c.isPanel);
  store.select([editable.id]);
  await frame();
  const keyEntry = document.querySelector('#inspector .key-value');
  assert('键位映射入口存在', Boolean(keyEntry));
  assert('样式编辑器存在', document.querySelectorAll('.drawer .color-field').length >= 3,
    `colors=${document.querySelectorAll('.drawer .color-field').length}`);

  // 预览：游戏内/游戏外
  store.updateCanvas({ previewState: 'out_game' });
  await frame();
  assert('预览游戏外状态', document.getElementById('btnPreviewState').textContent === '游戏外');
  store.updateCanvas({ previewState: 'in_game' });
  await frame();

  // 预览里点绑定按钮应切换控件组显隐
  store.setMode('preview');
  renderStage();
  await frame();
  const binder = store.state.controls.find((c) => c.type === 'button'
    && c.event?.pressEvent?.bindViewGroup?.length
    && store.findGroup(c.groupId)?.visibility === 'VISIBLE'
    && (c.base.visibility === 'ALWAYS' || c.base.visibility === 'IN_GAME'));
  if (binder) {
    const beforeCount = document.querySelectorAll('#controlsLayer .ctrl').length;
    const bel = controlEl(binder.id);
    const bp = center(bel);
    pointer(bel, 'pointerdown', bp.x, bp.y);
    pointer(window, 'pointerup', bp.x, bp.y);
    await frame();
    const afterCount = document.querySelectorAll('#controlsLayer .ctrl').length;
    assert('预览点击触发组显隐', afterCount !== beforeCount, `${beforeCount} -> ${afterCount}`);
  } else {
    assert('预览点击触发组显隐', false, '没有绑定按钮');
  }
  store.setMode('select');

  /* 9.6 撤回 / 分类 / 键位选择器 / 控件组开关 / 逻辑图拖动 */
  assert('顶部撤回按钮存在', Boolean(document.getElementById('btnUndo')));
  const beforeUndo = store.state.controls.length;
  store.addPreset(store.getPreset('builtin.jump'));
  await frame();
  assert('添加操作已入栈', store.canUndo() && store.state.controls.length === beforeUndo + 1);
  store.undo();
  await frame();
  assert('撤回上一步', store.state.controls.length === beforeUndo,
    `${store.state.controls.length} vs ${beforeUndo}`);

  store.addPresetCategory('自检分类');
  await frame();
  assert('新建预设分类', store.presetCategories.includes('自检分类'), JSON.stringify(store.presetCategories));
  store.addCustomPreset({
    id: 'custom.selftest2',
    kind: 'button',
    group: '自定义',
    category: '自检分类',
    name: '分类预设',
    hint: 'selftest',
    text: '类',
    base: { w: 120, h: 120, ref: 'SCREEN_WIDTH' },
    style: store.state.controls[0].style,
    event: makeButtonEvent({ keycodes: [57] }),
  });
  await frame();
  assert('预设分类标签', [...document.querySelectorAll('.preset-tab')].some((t) => t.textContent.includes('自检分类')));
  assert('预设详情显示', document.querySelectorAll('.preset-detail').length > 0);

  store.addPresetCategory('待删分类');
  await frame();
  const delTab = [...document.querySelectorAll('.preset-tab')].find((t) => t.textContent.includes('待删分类'));
  assert('分类标签可删除入口', Boolean(delTab && delTab.querySelector('.pt-del')));
  if (delTab) {
    delTab.querySelector('.pt-del').click();
    await frame();
    const confirmBtn = [...document.querySelectorAll('.modal-root.active .modal-foot .btn')]
      .find((b) => b.textContent.trim() === '确认');
    if (confirmBtn) confirmBtn.click();
    await frame();
    assert('分类可删除', !store.presetCategories.includes('待删分类'),
      JSON.stringify(store.presetCategories));
    assert('分类管理按钮存在', [...document.querySelectorAll('.preset-tab-manage')].length > 0);
  }

  const switchInputs = document.querySelectorAll('.group-switch input');
  assert('控件组开关', switchInputs.length === store.state.groups.length,
    `${switchInputs.length} vs ${store.state.groups.length}`);

  const pickControl = store.state.controls.find((c) => c.type === 'button' && !c.isPanel);
  store.select([pickControl.id]);
  await frame();
  const keyBtn = document.querySelector('#inspector .key-value');
  assert('键位选择按钮', Boolean(keyBtn));
  if (keyBtn) {
    keyBtn.click();
    await frame();
    const spaceChip = [...document.querySelectorAll('.key-chip')].find((b) => b.textContent === '空格');
    assert('键位选择器打开', Boolean(spaceChip));
    if (spaceChip) {
      spaceChip.click();
      const okBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '确定');
      if (okBtn) okBtn.click();
      await frame();
      assert('键位选择写入', pickControl.event.pressEvent.outputKeycodes.includes(57),
        JSON.stringify(pickControl.event.pressEvent.outputKeycodes));
    }
  }

  openPresetDialog();
  await frame();
  const presetKeyBtn = document.querySelector('#presetKeys .key-value');
  assert('预设弹窗键位选择入口', Boolean(presetKeyBtn));
  if (presetKeyBtn) {
    presetKeyBtn.click();
    await frame();
    const activeModals = document.querySelectorAll('.modal-root.active').length;
    assert('键位选择器叠层显示', activeModals >= 2, `modals=${activeModals}`);
    const spaceChip2 = [...document.querySelectorAll('.key-chip')].find((b) => b.textContent === '空格');
    if (spaceChip2) {
      spaceChip2.click();
      const ok2 = [...document.querySelectorAll('.modal-root.active .modal-foot .btn')]
        .find((b) => b.textContent.trim() === '确定');
      if (ok2) ok2.click();
      await frame();
      assert('选择后预设弹窗保留', Boolean(document.getElementById('presetName')));
    }
    [...document.querySelectorAll('.modal-root.active .modal-close')].forEach((btn) => btn.click());
    await frame();
  }

  document.getElementById('btnLogic').click();
  await frame();
  const node = document.querySelector('.logic-node');
  assert('逻辑图节点渲染', Boolean(node));
  if (node) {
    const nr = node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: nr.left + 20, clientY: nr.top + 20, pointerId: 7,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: nr.left + 120, clientY: nr.top + 80, pointerId: 7,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, clientX: nr.left + 120, clientY: nr.top + 80, pointerId: 7,
    }));
    await frame();
    assert('逻辑图节点可拖动', Object.keys(store.state.logic.positions).length > 0,
      JSON.stringify(store.state.logic.positions));
    const logicClose = [...document.querySelectorAll('.logic-actions .btn')].find((b) => b.textContent.trim() === '关闭');
    if (logicClose) logicClose.click();
    await frame();
  }

  /* 9.7 控件组开关 / 排序 / 全局菜单 / 滚动保持 */
  const firstRow = document.querySelector('.group-row');
  const firstGroupName = firstRow ? firstRow.querySelector('.g-name').textContent : '';
  const firstGroup = store.state.groups.find((g) => g.name === firstGroupName);
  const switchInput = firstRow ? firstRow.querySelector('.group-switch input') : null;
  assert('控件组开关可交互', Boolean(switchInput));
  if (firstGroup && switchInput) {
    const beforeVis = firstGroup.visibility;
    switchInput.click();
    await frame();
    assert('控件组开关可切换', firstGroup.visibility !== beforeVis,
      `${beforeVis} -> ${firstGroup.visibility}`);
    store.updateGroup(firstGroup.id, { visibility: beforeVis });
    await frame();
  }

  const beforeOrder = store.state.groups.map((g) => g.id).join(',');
  const sortBtn = [...document.querySelectorAll('.group-head .mini-btn')].find((b) => b.textContent === '排序');
  assert('排序按钮存在', Boolean(sortBtn));
  if (sortBtn) {
    sortBtn.click();
    await frame();
    const downBtn = document.querySelector('.sort-row:nth-child(1) .sort-tools .mini-btn:last-child');
    if (downBtn) downBtn.click();
    await frame();
    const afterOrder = store.state.groups.map((g) => g.id).join(',');
    assert('控件组排序生效', afterOrder !== beforeOrder, `${beforeOrder} -> ${afterOrder}`);
    const firstRowName = document.querySelector('.group-row .g-name');
    assert('排序后组面板刷新', Boolean(firstRowName)
      && firstRowName.textContent === store.state.groups[0].name,
      `${firstRowName ? firstRowName.textContent : ''} vs ${store.state.groups[0].name}`);
    [...document.querySelectorAll('.modal-root.active .modal-close')].forEach((b) => b.click());
    await frame();
  }

  document.getElementById('btnMenu').click();
  await frame();
  assert('全局菜单打开', Boolean(document.querySelector('.modal-root.active .app-menu-item')));
  [...document.querySelectorAll('.modal-root.active .modal-close')].forEach((b) => b.click());
  await frame();

  // 制造可滚动内容，验证点击控件组后滚动位置保持
  for (let i = 0; i < 10; i += 1) {
    store.addCustomPreset({
      id: `custom.scrolltest${i}`,
      kind: 'button',
      group: '自定义',
      category: store.presetCategories[0],
      name: `滚动测试预设 ${i}`,
      hint: 'scroll',
      text: 'S',
      base: { w: 100, h: 100, ref: 'SCREEN_WIDTH' },
      style: store.state.controls[0].style,
      event: makeButtonEvent({ keycodes: [57] }),
    });
  }
  document.getElementById('btnAdd').click();
  await frame();
  const scrollEl = document.querySelector('#leftDrawer .drawer-scroll');
  assert('抽屉滚动容器存在', Boolean(scrollEl));
  if (scrollEl) {
    scrollEl.scrollTop = 150;
    const recorded = scrollEl.scrollTop;
    if (recorded > 0) {
      const rows = [...document.querySelectorAll('.group-row')];
      const target = rows[rows.length - 1];
      if (target) target.click();
      await frame();
      assert('点击控件组保持滚动位置', Math.abs(scrollEl.scrollTop - recorded) <= 2,
        `${recorded} -> ${scrollEl.scrollTop}`);
    } else {
      assert('点击控件组保持滚动位置', false, '内容仍不可滚动');
    }
  }
  document.getElementById('btnLeftClose').click();
  await frame();

  /* 10. 导出多控件组 */
  const ctrl2 = buildController(store.state);
  assert('导出 controllerVersion', ctrl2.controllerVersion === 21);
  assert('导出控件组数量', ctrl2.viewGroups.length === store.state.groups.length,
    `${ctrl2.viewGroups.length} vs ${store.state.groups.length}`);
  assert('导出按钮总数', ctrl2.viewGroups.reduce((n, g) => n + g.viewData.buttonList.length, 0)
    === store.state.controls.filter((c) => c.type === 'button').length);
  assert('导出方向键总数', ctrl2.viewGroups.reduce((n, g) => n + g.viewData.directionList.length, 0)
    === store.state.controls.filter((c) => c.type === 'direction').length);
  assert('导出 id 8 位', /^[A-Za-z0-9]{8}$/.test(ctrl2.id));

  /* 11. 删除 & 本地存储 */
  const beforeDelete = store.state.controls.length;
  store.select([store.state.controls[0].id]);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await frame();
  assert('Delete 删除选中', store.state.controls.length === beforeDelete - 1);
  store.flushSave();
  const saved = JSON.parse(localStorage.getItem('fcl-workbench-v1') || 'null');
  assert('本地自动保存（含控件组）', saved && Array.isArray(saved.controls) && Array.isArray(saved.groups));

  /* 输出 */
  const passed = results.filter((r) => r.ok).length;
  root.appendChild(panelLine(`SELFTEST ${passed}/${results.length}`, passed === results.length ? 'ok' : 'err'));
  results.forEach((r) => root.appendChild(panelLine((r.ok ? '✓ ' : '✗ ') + r.name
    + (r.detail ? '  ' + r.detail : ''), r.ok ? '' : 'err')));
  document.title = `SELFTEST ${passed}/${results.length}`;
  window.__selftest = { passed, total: results.length, results };
  return window.__selftest;
}
