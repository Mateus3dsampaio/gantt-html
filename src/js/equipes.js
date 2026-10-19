/**
 * equipes.js — CRUD de equipes (lista + modal).
 * Depende de: utils.js, api.js, app.js
 */

import { esc }         from './utils.js';
import { API }         from './api.js';
import { recarregar }  from './app.js';
import { abrirModal, fecharModal, alertaModal } from './modal.js';

let editandoId = null;

// ── Lista ─────────────────────────────────────────────────────────
export function renderEquipes(equipes) {
  const tbody = document.getElementById('equipes-tbody');
  if (!equipes.length) {
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state">Nenhuma equipe cadastrada.</div></td></tr>';
    return;
  }
  tbody.innerHTML = equipes.map(e => `
    <tr>
      <td>
        <span class="equipe-cor-dot" style="background:${esc(e.cor || '#3B82F6')}"></span>
        ${esc(e.nome)}
        ${e.ativa === 0 ? '<span style="color:#bbb;font-size:11px"> (inativa)</span>' : ''}
      </td>
      <td>${esc(e.cor || '#3B82F6')}</td>
      <td>
        <button class="btn btn-sm" onclick="window._equipes.abrirModal(${e.id})">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="window._equipes.excluir(${e.id})">Excluir</button>
      </td>
    </tr>`).join('');
}

// ── Modal ─────────────────────────────────────────────────────────
export function abrirModalEquipe(id, equipes) {
  editandoId = id || null;
  const eq   = id ? equipes.find(e => e.id === id) : null;

  document.getElementById('modal-titulo').textContent = id ? 'Editar Equipe' : 'Nova Equipe';
  document.getElementById('modal-corpo').innerHTML = `
    <div id="modal-alert"></div>
    <div class="form-group">
      <label>Nome da equipe</label>
      <input type="text" id="f-eq-nome" value="${eq ? esc(eq.nome) : ''}" placeholder="Ex: Equipe A">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Cor</label>
        <input type="color" id="f-eq-cor" value="${eq ? (eq.cor || '#3B82F6') : '#3B82F6'}" style="width:100%;height:38px;padding:2px;cursor:pointer">
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:22px">
        <input type="checkbox" id="f-eq-ativa" ${(!eq || eq.ativa !== 0) ? 'checked' : ''} style="width:auto">
        <label for="f-eq-ativa" style="margin:0;cursor:pointer">Ativa</label>
      </div>
    </div>`;
  document.getElementById('modal-rodape').innerHTML = `
    <button class="btn" onclick="window._modal.fechar()">Cancelar</button>
    <button class="btn btn-primary" onclick="window._equipes.salvar()">Salvar</button>`;

  abrirModal();
  setTimeout(() => document.getElementById('f-eq-nome').focus(), 80);
}

export async function salvarEquipe() {
  const nome  = document.getElementById('f-eq-nome').value.trim();
  const cor   = document.getElementById('f-eq-cor').value;
  const ativa = document.getElementById('f-eq-ativa').checked ? 1 : 0;
  if (!nome) return alertaModal('Informe o nome da equipe.');

  const res  = editandoId
    ? await API.equipes.atualizar(editandoId, { nome, cor, ativa })
    : await API.equipes.criar({ nome, cor, ativa });
  const data = await res.json();
  if (!res.ok) return alertaModal(data.error);

  fecharModal();
  await recarregar();
}

export async function excluirEquipe(id) {
  if (!confirm('Excluir esta equipe?')) return;
  const res  = await API.equipes.excluir(id);
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  await recarregar();
}

// Expõe funções para os handlers inline do HTML gerado dinamicamente
window._equipes = {
  abrirModal: (id) => {
    const { equipes } = window._getEstado();
    abrirModalEquipe(id, equipes);
  },
  salvar:  salvarEquipe,
  excluir: excluirEquipe,
};
