/**
 * feriados.js — CRUD de feriados (lista + modal).
 */

import { esc }        from './utils.js';
import { API }        from './api.js';
import { recarregar } from './app.js';
import { abrirModal, fecharModal, alertaModal } from './modal.js';

let editandoId = null;

// ── Lista ─────────────────────────────────────────────────────────
export function renderFeriados(feriados, equipes) {
  const tbody = document.getElementById('feriados-tbody');
  if (!tbody) return;

  if (!feriados.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">Nenhum feriado cadastrado.</div></td></tr>';
    return;
  }

  tbody.innerHTML = feriados.map(f => {
    const equipesTrabalham = equipes
      .filter(e => f.equipes_trabalham.includes(e.id))
      .map(e => `<span class="feriado-equipe-badge" style="background:${esc(e.cor)}">${esc(e.nome)}</span>`)
      .join(' ');

    const partes = f.data.split('-');
    const dataFmt = `${partes[2]}/${partes[1]}/${partes[0]}`;

    return `<tr>
      <td>${dataFmt}</td>
      <td>${esc(f.nome)}</td>
      <td>${equipesTrabalham || '<span style="opacity:.5">Nenhuma</span>'}</td>
      <td>
        <button class="btn btn-sm" onclick="window._feriados.abrirModal(${f.id})">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="window._feriados.excluir(${f.id})">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Modal ─────────────────────────────────────────────────────────
export function abrirModalFeriado(id, feriados, equipes) {
  editandoId = id || null;
  const feriado = id ? feriados.find(f => f.id === id) : null;

  const dataVal = feriado ? feriado.data : '';
  const nomeVal = feriado ? feriado.nome : '';

  const checkboxes = equipes.length
    ? equipes.map(e => {
        const checked = feriado && feriado.equipes_trabalham.includes(e.id) ? 'checked' : '';
        return `<label class="feriado-equipe-check">
          <input type="checkbox" name="equipe" value="${e.id}" ${checked}>
          <span class="equipe-cor-dot" style="background:${esc(e.cor)}"></span>
          ${esc(e.nome)}
        </label>`;
      }).join('')
    : '<p style="opacity:.5;margin:0">Nenhuma equipe cadastrada.</p>';

  document.getElementById('modal-titulo').textContent = id ? 'Editar Feriado' : 'Novo Feriado';
  document.getElementById('modal-corpo').innerHTML = `
    <div id="modal-alert"></div>
    <div class="form-group">
      <label>Data</label>
      <input type="date" id="f-fer-data" value="${dataVal}">
    </div>
    <div class="form-group">
      <label>Nome</label>
      <input type="text" id="f-fer-nome" value="${esc(nomeVal)}" placeholder="Ex: Natal">
    </div>
    <div class="form-group">
      <label>Equipes que trabalham neste feriado</label>
      <div id="f-fer-equipes" style="display:flex;flex-direction:column;gap:6px;margin-top:6px">${checkboxes}</div>
    </div>`;
  document.getElementById('modal-rodape').innerHTML = `
    <button class="btn" onclick="window._modal.fechar()">Cancelar</button>
    <button class="btn btn-primary" onclick="window._feriados.salvar()">Salvar</button>`;

  abrirModal();
  setTimeout(() => document.getElementById('f-fer-data').focus(), 80);
}

// ── Salvar ────────────────────────────────────────────────────────
async function salvarFeriado() {
  const data = document.getElementById('f-fer-data').value;
  const nome = document.getElementById('f-fer-nome').value.trim();
  const checks = document.querySelectorAll('#f-fer-equipes input[name="equipe"]:checked');
  const equipes_trabalham = Array.from(checks).map(cb => parseInt(cb.value));

  if (!data) return alertaModal('Informe a data do feriado.');
  if (!nome) return alertaModal('Informe o nome do feriado.');

  const dados = { data, nome, equipes_trabalham };
  const res = editandoId
    ? await API.feriados.atualizar(editandoId, dados)
    : await API.feriados.criar(dados);
  const json = await res.json();
  if (!res.ok) return alertaModal(json.error || 'Erro ao salvar.');

  fecharModal();
  await recarregar();
}

// ── Excluir ───────────────────────────────────────────────────────
async function excluirFeriado(id) {
  if (!confirm('Excluir este feriado?')) return;
  await API.feriados.excluir(id);
  await recarregar();
}

// ── Expõe para handlers inline ────────────────────────────────────
window._feriados = {
  abrirModal: (id) => {
    const { feriados, equipes } = window._getEstado();
    abrirModalFeriado(id || null, feriados, equipes);
  },
  salvar:  salvarFeriado,
  excluir: excluirFeriado,
};
