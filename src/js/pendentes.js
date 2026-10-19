/**
 * pendentes.js — Painel de ambientes não agendados.
 * Depende de: api.js, utils.js, app.js, modal.js
 */

import { esc }        from './utils.js';
import { API }        from './api.js';
import { getEstado, recarregar } from './app.js';

let collapsed = false;

export async function carregarPendentes() {
  try {
    const grupos = await API.ambientes.pendentes();
    renderPendentes(grupos);
    return grupos;
  } catch (e) {
    console.error('Erro ao carregar pendentes:', e);
    return [];
  }
}

function renderPendentes(grupos) {
  const corpo = document.getElementById('pendentes-corpo');
  const badge = document.getElementById('pendentes-badge');
  if (!corpo || !badge) return;

  let total = 0;
  let totalValor = 0;
  for (const g of grupos) {
    total += g.ambientes.length;
    for (const amb of g.ambientes) {
      if (amb.valor) totalValor += amb.valor;
    }
  }

  badge.textContent = total;

  const valorEl = document.getElementById('pendentes-valor');
  if (valorEl) {
    if (totalValor > 0) {
      valorEl.textContent = totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      valorEl.style.display = '';
    } else {
      valorEl.style.display = 'none';
    }
  }

  if (total === 0) {
    corpo.innerHTML = '<div class="pendentes-vazio">Todos os ambientes estão agendados ✓</div>';
    return;
  }

  let html = '';
  for (const g of grupos) {
    const pendentes = g.ambientes.filter(a => a.status === 'pendente');
    const assistencia = g.ambientes.filter(a => a.status === 'aguardando_assistencia');
    const totalGrupo = g.ambientes.length;

    let label = `${totalGrupo} ambiente${totalGrupo > 1 ? 's' : ''}`;
    if (assistencia.length > 0 && pendentes.length > 0) {
      label += ' pendente' + (pendentes.length > 1 ? 's' : '');
    } else if (assistencia.length > 0) {
      label = `${assistencia.length} - assistência`;
    } else {
      label += ' pendente' + (totalGrupo > 1 ? 's' : '');
    }

    const valorGrupo = g.ambientes.reduce((acc, a) => acc + (a.valor || 0), 0);
    const valorGrupoHtml = valorGrupo > 0
      ? ` <span class="pendentes-grupo-valor">${valorGrupo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`
      : '';

    const ambientesJson = esc(JSON.stringify(g.ambientes));
    html += `<div class="pendentes-grupo">
      <div class="pendentes-grupo-header">
        ${esc(g.cliente_nome)} <span style="color:var(--text-muted);font-weight:400">(${label})</span>${valorGrupoHtml}
        <button class="btn btn-sm pendentes-editar-btn" onclick="window._cadastroRapido.editarCliente(${g.cliente_id}, JSON.parse(this.dataset.ambientes))" data-ambientes="${ambientesJson}" title="Editar ambientes">&#9998;</button>
      </div>`;

    for (const amb of g.ambientes) {
      const isAssist = amb.status === 'aguardando_assistencia';
      const icon = isAssist ? '🔧' : '🔹';
      const badgeHtml = isAssist ? ' <span class="badge-assistencia">assistência</span>' : '';
      const tipoAgendar = isAssist ? 'assistencia' : 'montagem';
      html += `
        <div class="pendentes-item">
          <span>${icon} ${esc(amb.nome)} — ${amb.duracao_dias} dia${amb.duracao_dias > 1 ? 's' : ''}${amb.valor ? ` <span class="pendentes-item-valor">${Number(amb.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>` : ''}${badgeHtml}</span>
          <button class="btn btn-sm btn-primary" onclick="window._pendentes.agendar(${amb.id}, '${tipoAgendar}')">Agendar</button>
        </div>`;
    }
    html += '</div>';
  }
  corpo.innerHTML = html;
}

function toggle() {
  collapsed = !collapsed;
  const corpo = document.getElementById('pendentes-corpo');
  if (corpo) corpo.style.display = collapsed ? 'none' : '';
  const panel = document.getElementById('pendentes-panel');
  if (panel) panel.classList.toggle('collapsed', collapsed);
}

// ── Modo seleção: aguardar clique no Gantt ──────────────────────
window._modoAgendar = null;

function iniciarModoAgendar(ambienteId, tipo) {
  // Buscar nome do ambiente na lista de pendentes
  const itens = document.querySelectorAll('#pendentes-corpo .pendentes-item');
  let nomeAmb = 'Ambiente';
  itens.forEach(it => {
    const btn = it.querySelector('button');
    if (btn && btn.getAttribute('onclick').includes(`${ambienteId}`)) {
      nomeAmb = it.querySelector('span')?.textContent?.split('—')[0].replace(/[🔹🔧]/g, '').trim() || nomeAmb;
    }
  });

  window._modoAgendar = { ambienteId, tipo, nome: nomeAmb };

  // Mostrar banner
  const banner = document.getElementById('modo-agendar-banner');
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span>📍 Clique no dia e equipe desejados para agendar: <strong>${esc(nomeAmb)}</strong></span>
    <button class="banner-esc" onclick="window._pendentes.cancelarModo()">✕ Cancelar (ESC)</button>
  `;

  // Ativa cursor crosshair no Gantt
  document.getElementById('gantt-tbody').classList.add('gantt-modo-selecao');

  // ESC cancela
  document.addEventListener('keydown', _escListener);
}

function _escListener(e) {
  if (e.key === 'Escape') cancelarModoAgendar();
}

export function cancelarModoAgendar() {
  window._modoAgendar = null;
  const banner = document.getElementById('modo-agendar-banner');
  if (banner) banner.style.display = 'none';
  document.getElementById('gantt-tbody')?.classList.remove('gantt-modo-selecao');
  document.removeEventListener('keydown', _escListener);
}

export async function confirmarAgendamento(equipeId, dataInicio) {
  const modo = window._modoAgendar;
  if (!modo) return;

  cancelarModoAgendar();

  const res = await API.agendamentos.criar({
    ambiente_id: parseInt(modo.ambienteId),
    equipe_id:   parseInt(equipeId),
    data_inicio: dataInicio,
    tipo:        modo.tipo,
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erro ao criar agendamento.');
    return;
  }
  await recarregar();
}

// Expõe para handlers inline
window._pendentes = {
  toggle,
  agendar:      iniciarModoAgendar,
  cancelarModo: cancelarModoAgendar,
};
