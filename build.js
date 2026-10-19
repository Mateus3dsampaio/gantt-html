/**
 * build.js — Gera o gantt.html (arquivo único) a partir da pasta src/.
 *
 * Uso:  node build.js
 * (ou dê duplo clique em build.bat)
 *
 * Junta: src/index.html + src/css/main.css + src/js/** (empacotado) + vendor/chart.umd.min.js
 *        + vendor/pdf.min.js e pdf.worker.min.js (leitura de contratos em PDF)
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = __dirname;
const ler  = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

// 1) Empacota os módulos ES em um único script (sem depender de servidor / file://)
const tmp = path.join(raiz, '.app.bundle.js');
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', 'esbuild@0.21.5', 'src/js/app.js', '--bundle', '--format=iife',
   '--target=es2020', '--outfile=.app.bundle.js', '--log-level=warning'],
  { cwd: raiz, stdio: 'inherit', shell: process.platform === 'win32' }
);
const app = fs.readFileSync(tmp, 'utf8');
fs.unlinkSync(tmp);

// 2) Monta o HTML (função em replace evita interpretar "$&" etc. dentro dos códigos)
const esc = (js) => js.replace(/<\/script/gi, '<\\/script');
let html = ler('src/index.html');
html = html.replace('/*__CSS__*/',     () => ler('src/css/main.css'));
html = html.replace('/*__CHARTJS__*/', () => esc(ler('vendor/chart.umd.min.js')));
html = html.replace('/*__PDFJS__*/',    () => esc(ler('vendor/pdf.min.js')));
html = html.replace('/*__PDFWORKER__*/', () => esc(ler('vendor/pdf.worker.min.js')));
html = html.replace('/*__APP__*/',      () => esc(app));

fs.writeFileSync(path.join(raiz, 'gantt.html'), html, 'utf8');
console.log(`gantt.html gerado (${(html.length / 1024).toFixed(0)} KB)`);
