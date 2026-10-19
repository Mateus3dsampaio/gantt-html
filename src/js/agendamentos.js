/**
 * agendamentos.js — CRUD de agendamentos (lista + modal).
 * Depende de: utils.js, api.js, app.js, modal.js
 */

import { esc, formataBR, inicioBR, STATUS_BADGE } from './utils.js';
import { API }         from './api.js';
import { recarregar }  from './app.js';
import { abrirModal, fecharModal, alertaModal } from './modal.js';

let editandoId  = null;
let editandoFim = null; // último dia inclusivo do agendamento (YYYY-MM-DD)

// ── Ordenação ─────────────────────────────────────────────────────
let sortCol = 'data_inicio';
let sortDir = 1; // 1 = crescente, -1 = decrescente

const COLUNAS = [
  { key: 'cliente_nome',  label: 'Cliente',  sort: true  },
  { key: 'ambiente_nome', label: 'Ambiente', sort: true  },
  { key: 'equipe_nome',   label: 'Equipe',   sort: true  },
  { key: 'data_inicio',   label: 'Início',   sort: true  },
  { key: 'data_fim',      label: 'Término',  sort: true  },
  { key: 'status',        label: 'Status',   sort: true  },
];

function _renderThead() {
  const thead = document.querySelector('#agendamentos-tbody')?.closest('table')?.querySelector('thead');
  if (!thead) return;
  const ths = COLUNAS.map(c => {
    if (!c.sort) return `<th>${c.label}</th>`;
    const ativo = sortCol === c.key;
    const seta  = ativo ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    return `<th class="th-sort${ativo ? ' th-sort-ativo' : ''}" onclick="window._agendamentos.ordenar('${c.key}')">${c.label}${seta}</th>`;
  }).join('');
  thead.innerHTML = `<tr>${ths}<th style="width:130px">Ações</th></tr>`;
}

function _aplicarOrdem(lista) {
  return [...lista].sort((a, b) => {
    const va = (a[sortCol] || '').toString().toLowerCase();
    const vb = (b[sortCol] || '').toString().toLowerCase();
    if (va < vb) return -1 * sortDir;
    if (va > vb) return  1 * sortDir;
    return 0;
  });
}

// ── Lista ─────────────────────────────────────────────────────────
export function renderAgendamentos(agendamentos, equipes) {
  const tbody = document.getElementById('agendamentos-tbody');
  const fEq   = document.getElementById('fil-equipe').value;
  const fSt   = document.getElementById('fil-status').value;
  const fMes  = document.getElementById('fil-mes').value;

  let lista = [...agendamentos];
  if (fEq)  lista = lista.filter(a => a.equipe_id == fEq);
  if (fSt)  lista = lista.filter(a => a.status === fSt);
  if (fMes) lista = lista.filter(a =>
    a.data_inicio.slice(0, 7) <= fMes && a.data_fim.slice(0, 7) >= fMes
  );

  lista = _aplicarOrdem(lista);
  _renderThead();

  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Nenhum agendamento encontrado.</div></td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(a => `
    <tr>
      <td>${esc(a.cliente_nome)}</td>
      <td>${esc(a.ambiente_nome)}${a.tipo === 'assistencia' ? ' <span class="badge-assistencia">assist.</span>' : ''}</td>
      <td>${esc(a.equipe_nome)}</td>
      <td>${inicioBR(a.data_inicio)}</td>
      <td>${formataBR(a.data_fim)}</td>
      <td><span class="badge ${STATUS_BADGE[a.status] || 'badge-agendado'}">${esc(a.status)}</span></td>
      <td>
        <button class="btn btn-sm" onclick="window._agendamentos.abrirModal(${a.id})">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="window._agendamentos.excluir(${a.id})">Excluir</button>
      </td>
    </tr>`).join('');
}

export function popularFiltroEquipe(equipes) {
  const sel  = document.getElementById('fil-equipe');
  const curr = sel.value;
  sel.innerHTML =
    '<option value="">Todas as equipes</option>' +
    equipes.map(e => `<option value="${e.id}" ${curr == e.id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('');
}

// ── Modal de Novo Agendamento ─────────────────────────────────────
export function abrirModalAgendamento(clientes, equipes) {
  editandoId = null;
  _construirModalNovo(clientes, equipes);
  abrirModal();
}

function _construirModalNovo(clientes, equipes) {
  document.getElementById('modal-titulo').textContent = 'Novo Agendamento';

  // Buscar ambientes pendentes para seleção
  API.ambientes.listar().then(ambientes => {
    const ambPendentes = ambientes.filter(a => a.status === 'pendente' || a.status === 'aguardando_assistencia');

    const optAmb = ambPendentes.length
      ? ambPendentes.map(a => `<option value="${a.id}" data-tipo="${a.status === 'aguardando_assistencia' ? 'assistencia' : 'montagem'}">${esc(a.cliente_nome)} — ${esc(a.nome)} (${a.duracao_dias}d)</option>`).join('')
      : '<option value="">— Nenhum ambiente pendente —</option>';

    const optEq = equipes.length
      ? equipes.map(e => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')
      : '<option value="">— Cadastre equipes primeiro —</option>';

    document.getElementById('modal-corpo').innerHTML = `
      <div id="modal-alert"></div>
      <div class="form-group">
        <label>Ambiente (cliente — ambiente)</label>
        <select id="f-ag-amb">${optAmb}</select>
      </div>
      <div class="form-group">
        <label>Equipe</label>
        <select id="f-ag-eq">${optEq}</select>
      </div>
      <div class="form-group">
        <label>Data de início</label>
        <input type="date" id="f-ag-ini">
      </div>`;
  });

  document.getElementById('modal-corpo').innerHTML = `
    <div id="modal-alert"></div>
    <div class="empty-state">Carregando ambientes...</div>`;

  document.getElementById('modal-rodape').innerHTML = `
    <button class="btn" onclick="window._modal.fechar()">Cancelar</button>
    <button class="btn btn-primary" onclick="window._agendamentos.salvar()">Salvar</button>`;
}

// ── Modal de Edição ───────────────────────────────────────────────
export function abrirModalEditarAgendamento(id) {
  editandoId = id;
  const { agendamentos, equipes } = window._getEstado();
  const ag = agendamentos.find(a => a.id === id);
  if (!ag) return;
  // data_fim é exclusiva → último dia inclusivo = data_fim - 1 dia
  const [y, m, d] = ag.data_fim.split('-').map(Number);
  const lastDay = new Date(y, m - 1, d - 1);
  editandoFim = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
  _construirModalEditar(ag, equipes);
  abrirModal();
}

function _construirModalEditar(ag, equipes) {
  document.getElementById('modal-titulo').textContent = 'Editar Agendamento';

  const optEq = equipes.map(e =>
    `<option value="${e.id}" ${ag.equipe_id === e.id ? 'selected' : ''}>${esc(e.nome)}</option>`
  ).join('');

  const statusList = ['Agendado', 'Em andamento', 'Concluído', 'Aguardando Assistência'];
  const optSt = statusList.map(s =>
    `<option ${ag.status === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  document.getElementById('modal-corpo').innerHTML = `
    <div id="modal-alert"></div>
    <div class="form-group">
      <label>Cliente</label>
      <div style="padding:8px 0;font-size:13px;color:var(--text);font-weight:500">${esc(ag.cliente_nome)}</div>
    </div>
    <div class="form-group">
      <label>Ambiente</label>
      <div style="padding:8px 0;font-size:13px;color:var(--text);font-weight:500">${esc(ag.ambiente_nome)} (${ag.duracao_dias} dia${ag.duracao_dias > 1 ? 's' : ''})${ag.tipo === 'assistencia' ? ' — 🔧 Assistência' : ''}</div>
    </div>
    <div class="form-group">
      <label>Equipe</label>
      <select id="f-ag-eq">${optEq}</select>
    </div>
    <div class="form-group">
      <label>Data de início</label>
      <input type="date" id="f-ag-ini" value="${ag.data_inicio}">
    </div>
    <div class="form-group">
      <label>Status</label>
      <select id="f-ag-st" onchange="window._agendamentos.onStatusChange()">${optSt}</select>
    </div>
    <div class="form-group" id="f-ag-conclusao-group" style="display:none">
      <label>Data real de conclusão</label>
      <input type="date" id="f-ag-conclusao">
    </div>
    <div class="form-group" id="f-ag-obs-group">
      <label>Observações</label>
      <textarea id="f-ag-obs" rows="2" style="width:100%;padding:8px 11px;border:1px solid var(--border-input);border-radius:10px;background:var(--field);color:var(--text);font-size:13px;font-family:inherit;resize:vertical">${esc(ag.observacoes || '')}</textarea>
    </div>`;

  document.getElementById('modal-rodape').innerHTML = `
    <button class="btn btn-danger" onclick="window._agendamentos.excluirDoModal()">Excluir</button>
    <div style="flex:1"></div>
    <button class="btn" onclick="window._modal.fechar()">Cancelar</button>
    <button class="btn btn-primary" onclick="window._agendamentos.salvar()">Salvar</button>`;
}

function onStatusChange() {
  const st = document.getElementById('f-ag-st')?.value;

  const conclusaoGroup = document.getElementById('f-ag-conclusao-group');
  if (conclusaoGroup) {
    if (st === 'Concluído') {
      conclusaoGroup.style.display = '';
      const input = document.getElementById('f-ag-conclusao');
      if (input && !input.value) {
        input.value = editandoFim || new Date().toISOString().slice(0, 10);
      }
    } else {
      conclusaoGroup.style.display = 'none';
    }
  }

  const obsGroup = document.getElementById('f-ag-obs-group');
  if (obsGroup) {
    if (st === 'Aguardando Assistência') {
      obsGroup.querySelector('label').textContent = 'Observações (descreva o problema)';
      obsGroup.querySelector('label').style.color = '#ff9a9a';
    } else {
      obsGroup.querySelector('label').textContent = 'Observações';
      obsGroup.querySelector('label').style.color = '';
    }
  }
}

// ── Salvar ────────────────────────────────────────────────────────
export async function salvarAgendamento() {
  if (editandoId) {
    // Edição
    const eq  = document.getElementById('f-ag-eq')?.value;
    const ini = document.getElementById('f-ag-ini')?.value;
    const st  = document.getElementById('f-ag-st')?.value || 'Agendado';
    const obs = document.getElementById('f-ag-obs')?.value || '';

    if (!eq || !ini) return alertaModal('Preencha equipe e data.');

    if (st === 'Concluído') {
      const conclusao = document.getElementById('f-ag-conclusao')?.value;
      if (!conclusao) return alertaModal('Informe a data real de conclusão.');
    }

    const payload = {
      equipe_id:   parseInt(eq),
      data_inicio: ini,
      status:      st,
      observacoes: obs,
    };

    if (st === 'Concluído') {
      payload.data_conclusao = document.getElementById('f-ag-conclusao')?.value;
    }

    const res  = await API.agendamentos.atualizar(editandoId, payload);
    const data = await res.json();
    if (!res.ok) return alertaModal(data.error);
  } else {
    // Criação
    const ambId = document.getElementById('f-ag-amb')?.value;
    const eq    = document.getElementById('f-ag-eq')?.value;
    const ini   = document.getElementById('f-ag-ini')?.value;

    if (!ambId || !eq || !ini) return alertaModal('Preencha todos os campos obrigatórios.');

    // Detectar tipo pelo option selecionado
    const ambSelect = document.getElementById('f-ag-amb');
    const selectedOpt = ambSelect?.options[ambSelect.selectedIndex];
    const tipo = selectedOpt?.dataset?.tipo || 'montagem';

    const payload = {
      ambiente_id: parseInt(ambId),
      equipe_id:   parseInt(eq),
      data_inicio: ini,
      tipo:        tipo,
    };

    const res  = await API.agendamentos.criar(payload);
    const data = await res.json();
    if (!res.ok) return alertaModal(data.error);
  }

  fecharModal();
  await recarregar();
}

export async function excluirAgendamento(id) {
  if (!confirm('Excluir este agendamento?')) return;
  const res = await API.agendamentos.excluir(id);
  if (!res.ok) return alert('Erro ao excluir.');
  await recarregar();
}

async function excluirDoModal() {
  if (!editandoId) return;
  if (!confirm('Excluir este agendamento? O ambiente voltará para a fila de não agendados.')) return;
  const res = await API.agendamentos.excluir(editandoId);
  if (!res.ok) return alert('Erro ao excluir.');
  fecharModal();
  await recarregar();
}

// Expõe funções para handlers inline gerados dinamicamente
window._agendamentos = {
  abrirModal:     abrirModalEditarAgendamento,
  salvar:         salvarAgendamento,
  excluir:        excluirAgendamento,
  excluirDoModal,
  onStatusChange,
  ordenar(col) {
    if (sortCol === col) {
      sortDir *= -1;
    } else {
      sortCol = col;
      sortDir = 1;
    }
    window._renderAgendamentos();
  },
};
