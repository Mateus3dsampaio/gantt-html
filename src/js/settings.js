/**
 * settings.js — Exportar e importar backup dos dados.
 * Depende de: app.js
 */

import { recarregar } from './app.js';

export function initSettings() {
  document.getElementById('btn-export').addEventListener('click', _exportar);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', _importar);
}

async function _exportar() {
  const btn = document.getElementById('btn-export');
  btn.disabled = true;
  btn.textContent = 'Exportando...';
  try {
    const res = await fetch('/api/settings/export');
    if (!res.ok) { alert('Erro ao exportar.'); return; }
    const blob = await res.blob();
    const cd   = res.headers.get('Content-Disposition') || '';
    const m    = cd.match(/filename=(.+)/);
    const nome = m ? m[1] : 'backup_gantt.json';
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = nome; a.click();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Exportar backup';
  }
}

async function _importar(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  if (!confirm('Isso vai substituir TODOS os dados atuais pelo conteúdo do backup.\n\nContinuar?')) return;

  const status = document.getElementById('import-status');
  status.textContent = 'Importando...';
  status.className = 'settings-status';

  try {
    const data = JSON.parse(await file.text());
    const res  = await fetch('/api/settings/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) {
      status.textContent = result.error || 'Erro ao importar.';
      status.className = 'settings-status settings-status--error';
      return;
    }
    status.textContent = 'Backup restaurado com sucesso!';
    status.className = 'settings-status settings-status--ok';
    await recarregar();
  } catch {
    status.textContent = 'Arquivo inválido ou corrompido.';
    status.className = 'settings-status settings-status--error';
  }
}
