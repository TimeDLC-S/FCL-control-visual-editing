#!/usr/bin/env node
/* 构建单文件版：把 HTML/CSS/JS/示例数据打包成一个可直接双击打开的 html */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  if (process.env.ESBUILD_PATH) {
    try {
      esbuild = require(process.env.ESBUILD_PATH);
    } catch {
      esbuild = null;
    }
  }
  if (!esbuild) {
    console.error('缺少 esbuild：请先在 web/ 目录执行 `npm install --no-save esbuild`，'
      + '或设置 ESBUILD_PATH 指向已安装的 esbuild。');
    process.exit(1);
  }
}
const { build } = esbuild;

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, 'dist');

const [html, css, mainJs, demoJson] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'css/app.css'), 'utf8'),
  readFile(path.join(root, 'js/main.js'), 'utf8'),
  readFile(path.join(root, 'data/demo0001.json'), 'utf8'),
]);

// 单文件版不带自检模块（selftest 只在源码版通过服务器访问时使用）
const mainForBundle = mainJs.replace(
  /\n    if \(params\.get\('selftest'\) === '1'\) \{[\s\S]*?\n    \}/,
  '\n    // 单文件版不包含 selftest',
);
if (mainForBundle === mainJs) {
  console.warn('警告：未找到 selftest 代码块，构建产物可能包含动态导入');
}

const result = await build({
  stdin: {
    contents: mainForBundle,
    resolveDir: path.join(root, 'js'),
    sourcefile: 'main.js',
    loader: 'js',
  },
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  target: ['chrome90'],
  legalComments: 'none',
});

const bundle = result.outputFiles[0].text;
const demoText = JSON.stringify(JSON.parse(demoJson));
const cssMin = (await esbuild.transform(css, { loader: 'css', minify: true })).code;

const outHtml = html
  .replace('<link rel="stylesheet" href="css/app.css">', `<style>${cssMin}</style>`)
  .replace(
    '<script type="module" src="js/main.js"></script>',
    `<script type="application/json" id="demoData">${demoText}</script>\n  <script>\n${bundle}\n  </script>`,
  );

await mkdir(distDir, { recursive: true });
const outFile = path.join(distDir, 'fcl-key-workbench.html');
await writeFile(outFile, outHtml, 'utf8');
// GitHub Pages / 静态托管：dist 目录本身可直接作为网站根目录
const indexFile = path.join(distDir, 'index.html');
await writeFile(indexFile, outHtml, 'utf8');
await writeFile(path.join(distDir, '.nojekyll'), '', 'utf8');
const size = Buffer.byteLength(outHtml, 'utf8');
console.log(`已生成 ${path.relative(process.cwd(), outFile)}（${(size / 1024).toFixed(1)} KB）`);
console.log(`已生成 ${path.relative(process.cwd(), indexFile)}（可直接作为 GitHub Pages 根目录/index.html）`);
