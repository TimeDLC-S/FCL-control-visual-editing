/* =========================================================================
 * main.js —— 应用入口：加载状态、初始化画布与 UI、串联重绘
 * ========================================================================= */
import * as store from './store.js';
import { initStage, renderStage, updateScale } from './stage.js';
import { initUI, renderUI, loadDemo, openExportModal, openPresetDialog, openDrawer, openResolutionModal } from './ui.js';
import { importController } from './export.js';

/* 开发期错误兜底：把异常显示在页面上，方便定位 */
function showFatalError(title, detail) {
  const box = document.createElement('div');
  box.id = 'fatalError';
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:90vw;max-height:50vh;overflow:auto;'
    + 'background:#300;color:#fdd;border:1px solid #f66;border-radius:8px;padding:10px;font:12px/1.5 monospace;white-space:pre-wrap';
  box.textContent = `[${title}] ${detail}`;
  document.body.appendChild(box);
  document.title = 'JSERR: ' + detail;
}
function cleanupBrokenModals() {
  document.querySelectorAll('.modal-root.active').forEach((root) => {
    const modal = root.querySelector('.modal');
    const body = root.querySelector('.modal-body');
    if (!modal || !body || (!body.textContent.trim() && !body.children.length)) root.remove();
  });
}
window.__FCL_VERSION__ = 'v6.2-hotfix-2';
console.info('[FCL] UI version', window.__FCL_VERSION__);
window.addEventListener('error', (e) => {
  showFatalError('error', e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')
    + '\n如界面出现空白弹层，请强制刷新；手机端建议直接用 dist/fcl-key-workbench.html 单文件版');
  cleanupBrokenModals();
});
window.addEventListener('unhandledrejection', (e) => showFatalError('promise', String(e.reason && (e.reason.stack || e.reason.message || e.reason))));

/* ---- 开发/演示参数（不影响正常使用） ----
 * ?storage=clear   清空本地保存
 * ?demo=1          直接载入示例键位
 * ?mode=move|preview|select
 * ?tab=buttons|directions|custom
 * ?select=all|first
 * ?modal=preset|export
 */
const params = new URLSearchParams(location.search);
if (params.get('storage') === 'clear') {
  try {
    localStorage.removeItem('fcl-workbench-v1');
    localStorage.removeItem('fcl-workbench-presets-v1');
  } catch { /* ignore */ }
}
if (history.scrollRestoration) history.scrollRestoration = 'manual';

store.loadFromStorage();
initStage();
initUI();

store.subscribe((reason, flags = {}) => {
  if (!flags.skipStage) renderStage();
  renderUI(reason);
});

renderStage();
renderUI('init');

requestAnimationFrame(() => {
  updateScale();
  window.scrollTo(0, 0);
});

function applyViewportShot() {
  const spec = params.get('viewport');
  if (!spec) return;
  const m = /^(\d+)x(\d+)$/.exec(spec);
  if (!m) return;
  const w = Number(m[1]);
  const h = Number(m[2]);
  document.documentElement.style.setProperty('--palette-w', '292px');
  document.documentElement.style.setProperty('--inspector-w', '324px');
  const app = document.getElementById('app');
  app.style.width = w + 'px';
  app.style.height = h + 'px';
  app.style.position = 'fixed';
  app.style.left = '0';
  app.style.top = '0';
  app.style.transformOrigin = 'top left';
  const scale = Math.min(window.innerWidth / w, window.innerHeight / h);
  app.style.transform = `scale(${scale})`;
  window.__SHOT_SCALE__ = scale;
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#080b0f';
}

async function applyDebugParams() {
  try {
    applyViewportShot();
    if (params.get('demo') === '1') await loadDemo();
    const mode = params.get('mode');
    if (mode && ['select', 'move', 'preview'].includes(mode)) store.setMode(mode);
    const select = params.get('select');
    if (select === 'all') store.selectAll();
    if (select === 'first') {
      const first = store.state.controls[0];
      if (first) store.select([first.id]);
    }
    if (params.get('selftest') === '1') {
      await loadDemo();
      const { runSelfTest } = await import('./selftest.js');
      await runSelfTest();
    }
    const drawer = params.get('drawer');
    if (drawer === 'left' || drawer === 'right') openDrawer(drawer);
    if (params.get('modal') === 'preset') openPresetDialog();
    if (params.get('modal') === 'export') openExportModal();
    if (params.get('modal') === 'resolution') openResolutionModal();
    requestAnimationFrame(() => {
      updateScale();
      window.scrollTo(0, 0);
    });
  } catch (err) {
    console.warn('演示参数应用失败', err);
  }
}
applyDebugParams();
window.addEventListener('beforeunload', () => store.flushSave());
window.addEventListener('load', () => requestAnimationFrame(() => updateScale()));

// 方便调试 / 自动化测试
window.__fclApp = { store, renderStage, updateScale };
