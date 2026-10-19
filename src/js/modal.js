/**
 * modal.js — Controle genérico do modal único da aplicação.
 * Qualquer módulo pode abrir/fechar/alertar sem depender dos outros.
 */

export function abrirModal() {
  document.getElementById('modal-overlay').classList.add('open');
}

export function fecharModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

export function alertaModal(msg) {
  const el = document.getElementById('modal-alert');
  if (el) el.innerHTML = `<div class="alert alert-error">${msg}</div>`;
}

// Expõe para os botões "Cancelar" gerados dinamicamente no HTML
window._modal = { fechar: fecharModal };
