/**
 * app.js — Ponto de entrada do frontend.
 *
 * Responsável por:
 *  - Manter o estado global (equipes, clientes, agendamentos)
 *  - Inicializar a navegação e as abas
 *  - Carregar dados da API e distribuir para os módulos de renderização
 */

import { API }                from './api.js';
import { renderGantt, renderResumoEquipes } from './gantt.js';
import { renderEquipes, abrirModalEquipe }       from './equipes.js';
import { renderClientes, abrirModalCliente }     from './clientes.js';
import {
  renderAgendamentos,
  popularFiltroEquipe,
  abrirModalAgendamento,
} from './agendamentos.js';
import { fecharModal } from './modal.js';
import { carregarPendentes } from './pendentes.js';
import './cadastro_rapido.js';
import { initDashboard, atualizarDashboard } from './dashboard.js';
import { initSettings } from './settings.js';
import { initPagamentos, atualizarPagamentos } from './pagamentos.js';
import { initTheme } from './theme.js';
import { renderFeriados, abrirModalFeriado } from './feriados.js';
import { instalarRotas } from './backend/rotas.js';
import { iniciar as iniciarArmazenamento } from './backend/store.js';

// Substitui o servidor Flask: intercepta fetch('/api/...') no próprio navegador
instalarRotas();

// ── Estado global ─────────────────────────────────────────────────
const estado = {
  equipes:      [],
  clientes:     [],
  agendamentos: [],
  feriados:     [],
};

export function getEstado() { return estado; }

// Expõe o estado para módulos que precisam acessar via window (handlers inline)
window._getEstado = getEstado;

// ── Inicialização ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initDashboard();
  initSettings();
  initPagamentos();
  setupNav();
  setupTabs();
  setupModalOverlay();
  await iniciarArmazenamento();   // escolhe/abre o dados.json e carrega os dados
  await recarregar();
});

// Outra pessoa alterou o dados.json (ou houve conflito): recarrega a tela
window.addEventListener('gantt:dados-recarregados', () => recarregar());

export async function recarregar() {
  [estado.equipes, estado.clientes, estado.agendamentos, estado.feriados] = await Promise.all([
    API.equipes.listar(),
    API.clientes.listar(),
    API.agendamentos.listar(),
    API.feriados.listar(),
  ]);
  renderTudo();
  // Carregar pendentes de forma assíncrona
  carregarPendentes();
}

function renderTudo() {
  popularFiltroEquipe(estado.equipes);
  renderGantt();
  renderResumoEquipes();
  renderEquipes(estado.equipes);
  renderClientes(estado.clientes);
  renderAgendamentos(estado.agendamentos, estado.equipes);
  renderFeriados(estado.feriados, estado.equipes);
}

// ── Navegação sidebar ─────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + el.dataset.view).classList.add('active');
      if (el.dataset.view === 'dashboard') atualizarDashboard();
      if (el.dataset.view === 'pagamentos') atualizarPagamentos();
    });
  });
}

// ── Abas (Cadastro) ───────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-equipes').style.display  = btn.dataset.tab === 'equipes'  ? '' : 'none';
      document.getElementById('tab-clientes').style.display = btn.dataset.tab === 'clientes' ? '' : 'none';
      document.getElementById('tab-feriados').style.display = btn.dataset.tab === 'feriados' ? '' : 'none';
    });
  });
}

// ── Fechar modal ao clicar no overlay ─────────────────────────────
function setupModalOverlay() {
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) fecharModal();
  });
}

// ── Expõe ações dos botões estáticos do HTML ──────────────────────
window._abrirModalAgendamento = () => abrirModalAgendamento(estado.clientes, estado.equipes);
window._abrirModalEquipe      = ()  => abrirModalEquipe(null, estado.equipes);
window._abrirModalCliente     = ()  => abrirModalCliente(null, estado.clientes);
window._renderAgendamentos    = ()  => renderAgendamentos(estado.agendamentos, estado.equipes);
window._abrirModalFeriado     = (id) => abrirModalFeriado(id ?? null, estado.feriados, estado.equipes);

// Expõe changeMonth para os botões do Gantt
export { renderGantt };
import { changeMonth } from './gantt.js';
window._changeMonth = changeMonth;
