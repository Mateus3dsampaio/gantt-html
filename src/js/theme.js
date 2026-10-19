/**
 * theme.js — Alternância entre os temas visuais A · Neon e B · Aurora,
 * com persistência em localStorage. Os dois temas são escuros.
 */

const STORAGE_KEY = 'agenda-tema-visual';

const TEMAS = {
  neon:   { letra: 'A', nome: 'Neon',   proximo: 'aurora' },
  aurora: { letra: 'B', nome: 'Aurora', proximo: 'neon'   },
};

function aplicarTema(tema) {
  const t = TEMAS[tema];
  document.body.dataset.tema = tema;
  document.body.classList.add('dark');
  document.getElementById('theme-icon').textContent  = '🎨';
  document.getElementById('theme-label').textContent = `Tema ${t.letra} · ${t.nome}`;
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.title = `Clique para trocar para o tema ${TEMAS[t.proximo].letra} · ${TEMAS[t.proximo].nome}`;
  // Gráficos (canvas) precisam redesenhar para pegar as cores do novo tema
  window.dispatchEvent(new CustomEvent('gantt:tema-alterado', { detail: tema }));
}

export function initTheme() {
  let tema = 'neon';
  try {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (TEMAS[salvo]) tema = salvo;
  } catch { /* sem localStorage: usa o padrão */ }
  aplicarTema(tema);
}

function toggle() {
  const atual = TEMAS[document.body.dataset.tema] ? document.body.dataset.tema : 'neon';
  const novo  = TEMAS[atual].proximo;
  try { localStorage.setItem(STORAGE_KEY, novo); } catch { /* ignora */ }
  aplicarTema(novo);
}

window._theme = { toggle };
