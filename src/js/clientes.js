/**
 * clientes.js — CRUD de clientes (lista + modal).
 * Depende de: utils.js, api.js, app.js
 */

import { esc }        from './utils.js';
import { API }        from './api.js';
import { recarregar } from './app.js';
import { abrirModal, fecharModal, alertaModal } from './modal.js';

let editandoId = null;

// ── Lista ─────────────────────────────────────────────────────────
export function renderClientes(clientes) {
  const tbody = document.getElementById('clientes-tbody');
  if (!clientes.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">Nenhum cliente cadastrado.</div></td></tr>';
    return;
  }
  tbody.innerHTML = clientes.map(c => {
    const total = c.total_ambientes || 0;
    const pend  = c.pendentes_ambientes || 0;
    const ambBadge = total > 0
      ? ` <span style="font-size:11px;color:var(--text-muted)">(${pend}/${total} amb.)</span>`
      : '';
    return `
    <tr>
      <td>${esc(c.nome)}${ambBadge}</td>
      <td>
        ${c.telefone
          ? `${esc(c.telefone)} <a href="https://wa.me/55${c.telefone.replace(/\D/g,'')}" target="_blank" title="Abrir WhatsApp" style="color:#25D366;text-decoration:none;font-size:15px">&#128233;</a>`
          : '<span style="color:var(--text-ghost)">—</span>'}
      </td>
      <td>
        ${c.endereco
          ? `<a href="https://maps.google.com/?q=${encodeURIComponent(c.endereco)}" target="_blank" title="Abrir no Google Maps" style="color:inherit;text-decoration:none">${esc(c.endereco)} &#128205;</a>`
          : '<span style="color:var(--text-ghost)">—</span>'}
      </td>
      <td>
        <button class="btn btn-sm" onclick="window._clientes.abrirModal(${c.id})">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="window._clientes.excluir(${c.id})">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Modal ─────────────────────────────────────────────────────────
export function abrirModalCliente(id, clientes) {
  editandoId = id || null;
  const cl   = id ? clientes.find(c => c.id === id) : null;

  document.getElementById('modal-titulo').textContent = id ? 'Editar Cliente' : 'Novo Cliente';
  document.getElementById('modal-corpo').innerHTML = `
    <div id="modal-alert"></div>
    <div class="form-group">
      <label>Nome do cliente</label>
      <input type="text" id="f-cl-nome" value="${cl ? esc(cl.nome) : ''}" placeholder="Ex: João Silva">
    </div>
    <div class="form-group">
      <label>Telefone <span style="font-weight:400;color:var(--text-faint)">(opcional)</span></label>
      <input type="text" id="f-cl-tel" value="${cl ? esc(cl.telefone || '') : ''}" placeholder="(88) 99999-9999">
    </div>
    <div class="form-group">
      <label>Endereço <span style="font-weight:400;color:var(--text-faint)">(opcional)</span></label>
      <input type="text" id="f-cl-end" value="${cl ? esc(cl.endereco || '') : ''}" placeholder="Rua, número, bairro...">
    </div>
    <div class="form-group">
      <label>Observações <span style="font-weight:400;color:var(--text-faint)">(opcional)</span></label>
      <textarea id="f-cl-obs" rows="2" style="width:100%;padding:8px 11px;border:1px solid var(--border-input);border-radius:10px;background:var(--field);color:var(--text);font-size:13px;font-family:inherit;resize:vertical">${cl ? esc(cl.observacoes || '') : ''}</textarea>
    </div>`;
  document.getElementById('modal-rodape').innerHTML = `
    <button class="btn" onclick="window._modal.fechar()">Cancelar</button>
    <button class="btn btn-primary" onclick="window._clientes.salvar()">Salvar</button>`;

  abrirModal();
  setTimeout(() => document.getElementById('f-cl-nome').focus(), 80);
}

export async function salvarCliente() {
  const nome        = document.getElementById('f-cl-nome').value.trim();
  const telefone    = document.getElementById('f-cl-tel').value.trim();
  const endereco    = document.getElementById('f-cl-end').value.trim();
  const observacoes = document.getElementById('f-cl-obs').value.trim();
  if (!nome) return alertaModal('Informe o nome do cliente.');

  const res  = editandoId
    ? await API.clientes.atualizar(editandoId, { nome, telefone, endereco, observacoes })
    : await API.clientes.criar({ nome, telefone, endereco, observacoes });
  const data = await res.json();
  if (!res.ok) return alertaModal(data.error);

  fecharModal();
  await recarregar();
}

export async function excluirCliente(id) {
  if (!confirm('Excluir este cliente?')) return;
  const res  = await API.clientes.excluir(id);
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  await recarregar();
}

// Expõe funções para os handlers inline do HTML gerado dinamicamente
window._clientes = {
  abrirModal: (id) => {
    const { clientes } = window._getEstado();
    abrirModalCliente(id, clientes);
  },
  salvar:  salvarCliente,
  excluir: excluirCliente,
};
