/**
 * theme.js — Alternância dark/light com persistência em localStorage.
 */

const STORAGE_KEY = 'agenda-tema';

function aplicarTema(dark) {
  document.body.classList.toggle('dark', dark);
  document.getElementById('theme-icon').textContent  = dark ? '☀️' : '🌙';
  document.getElementById('theme-label').textContent = dark ? 'Modo claro' : 'Modo escuro';
}

export function initTheme() {
  const dark = localStorage.getItem(STORAGE_KEY) === 'dark';
  aplicarTema(dark);
}

function toggle() {
  const dark = !document.body.classList.contains('dark');
  localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  aplicarTema(dark);
}

window._theme = { toggle };
