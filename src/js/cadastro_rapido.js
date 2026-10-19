/**
 * cadastro_rapido.js — Modal de cadastro rápido de cliente + ambientes.
 * Depende de: api.js, modal.js, app.js, utils.js
 */

import { API } from './api.js';
import { recarregar } from './app.js';
import { abrirModal, alertaModal, fecharModal } from './modal.js';
import { esc, ratearProporcional } from './utils.js';

let ambienteCount = 0;
let _clienteExistenteId = null; // preenchido quando o contrato importado é de cliente já cadastrado

function formatBRL(n) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseBRL(s) {
  if (!s || !s.trim()) return null;
  // Remove R$, pontos de milhar e troca vírgula decimal por ponto
  const num = parseFloat(s.replace(/[R$\s.]/g, '').replace(',', '.'));
  return isNaN(num) ? null : num;
}

function _addAmbienteLine(container) {
  ambienteCount++;
  const idx = ambienteCount;
  const row = document.createElement('div');
  row.className = 'ambiente-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <input type="text" class="amb-nome" placeholder="Ex: Cozinha, Quarto..." style="flex:2">
    <input type="text" class="amb-valor" placeholder="Valor (R$)" style="flex:1;min-width:110px">
    <input type="number" class="amb-dur" min="1" value="1" placeholder="Dias" style="flex:0 0 60px">
    <button class="btn btn-sm btn-danger amb-remove" type="button">&times;</button>
  `;
  container.appendChild(row);

  row.querySelector('.amb-remove').addEventListener('click', () => {
    if (row.dataset.ambId) {
      _ambientesToDelete.push(parseInt(row.dataset.ambId));
    }
    row.remove();
  });

  const durInput = row.querySelector('.amb-dur');
  const valorInput = row.querySelector('.amb-valor');

  // Ao sair do Valor: formatar + calcular dias automaticamente
  valorInput.addEventListener('blur', () => {
    const n = parseBRL(valorInput.value);
    valorInput.value = n !== null ? formatBRL(n) : '';
    if (n !== null) {
      durInput.value = Math.ceil(n / 3000);
    }
  });

  // Limpar formatação ao entrar para facilitar edição
  valorInput.addEventListener('focus', () => {
    const n = parseBRL(valorInput.value);
    valorInput.value = n !== null ? String(n).replace('.', ',') : '';
  });

  // Enter em Valor move foco para Dias (para confirmar/ajustar)
  valorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      valorInput.dispatchEvent(new Event('blur'));
      durInput.focus();
    }
  });

  // Enter em Dias adiciona nova linha
  durInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      _addAmbienteLine(container);
      const rows = container.querySelectorAll('.ambiente-row');
      const last = rows[rows.length - 1];
      last.querySelector('.amb-nome').focus();
    }
  });

  return row;
}

// Redistribui os valores dos ambientes para a soma fechar no valor líquido digitado
function _aplicarLiquido() {
  const campo = document.getElementById('cr-liquido');
  const info  = document.getElementById('cr-liquido-info');
  const liquido = parseBRL(campo.value);
  if (liquido === null) { info.textContent = ''; return; }
  campo.value = formatBRL(liquido);

  const inputs  = [...document.querySelectorAll('#cr-ambientes .amb-valor')];
  const valores = inputs.map(i => parseBRL(i.value));
  const novos   = ratearProporcional(valores, liquido);
  if (!novos) return alertaModal('Preencha os valores dos ambientes antes de informar o líquido.');

  const bruto = valores.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  inputs.forEach((input, i) => { if (valores[i] > 0) input.value = formatBRL(novos[i]); });
  const pct = ((1 - liquido / bruto) * 100).toFixed(1).replace('.', ',');
  info.textContent = `Bruto ${formatBRL(bruto)} → ajuste de ${pct}% nos ambientes`;
  document.getElementById('modal-alert').innerHTML = '';
}

async function _importarContrato(arquivo) {
  const alerta = document.getElementById('modal-alert');
  alerta.innerHTML = '<div class="alert alert-success">Lendo contrato...</div>';

  let dados;
  try {
    dados = await API.contratos.importar(arquivo);
  } catch (e) {
    return alertaModal(esc(e.message || 'Erro ao ler o contrato.'));
  }

  document.getElementById('cr-nome').value = dados.cliente.nome;
  document.getElementById('cr-tel').value  = dados.cliente.telefone;
  document.getElementById('cr-end').value  = dados.cliente.endereco;

  // Cliente já cadastrado? Pergunta se os ambientes entram nele
  _clienteExistenteId = null;
  const nomeNorm = dados.cliente.nome.trim().toLowerCase();
  const existente = (window._getEstado().clientes || [])
    .find(c => (c.nome || '').trim().toLowerCase() === nomeNorm);
  if (existente && confirm(`Já existe o cliente "${existente.nome}". Adicionar os ambientes do contrato a ele?`)) {
    _clienteExistenteId = existente.id;
  }

  // Recria as linhas de ambiente com o que veio do contrato
  const container = document.getElementById('cr-ambientes');
  container.innerHTML = '';
  ambienteCount = 0;
  document.getElementById('cr-liquido').value = '';
  document.getElementById('cr-liquido-info').textContent = '';
  // Bruto do contrato (para conferir com o PDF), mesmo que o líquido seja aplicado depois
  document.getElementById('cr-bruto').textContent =
    `Valor bruto do contrato: ${formatBRL(dados.total ?? dados.soma)}`;
  for (const amb of dados.ambientes) {
    const row = _addAmbienteLine(container);
    row.querySelector('.amb-nome').value = amb.nome;
    const valorInput = row.querySelector('.amb-valor');
    valorInput.value = formatBRL(amb.valor);
    valorInput.dispatchEvent(new Event('blur')); // calcula os dias
  }

  alerta.innerHTML = dados.soma_confere
    ? `<div class="alert alert-success">Contrato lido: ${dados.ambientes.length} ambiente(s), total ${formatBRL(dados.total)}. Confira antes de salvar.</div>`
    : `<div class="alert alert-error">Atenção: a soma dos ambientes (${formatBRL(dados.soma)}) não bate com o total do contrato (${dados.total != null ? formatBRL(dados.total) : 'não encontrado'}). Confira os valores.</div>`;
}

export function abrirCadastroRapido() {
  ambienteCount = 0;
  _clienteExistenteId = null;

  document.getElementById('modal-titulo').textContent = 'Cadastro Rápido';
  document.getElementById('modal-corpo').innerHTML = `
    <div id="modal-alert"></div>
    <div style="margin-bottom:12px">
      <button class="btn btn-sm" id="cr-importar" type="button">📄 Importar contrato (PDF)</button>
      <input type="file" id="cr-arquivo" accept="application/pdf,.pdf" style="display:none">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Nome do cliente</label>
        <input type="text" id="cr-nome" placeholder="Ex: João Silva">
      </div>
      <div class="form-group">
        <label>Telefone</label>
        <input type="text" id="cr-tel" placeholder="(88) 99999-9999">
      </div>
    </div>
    <div class="form-group">
      <label>Endereço</label>
      <input type="text" id="cr-end" placeholder="Rua, número, bairro...">
    </div>
    <hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <label style="font-size:13px;font-weight:600;color:var(--text);margin:0">Ambientes</label>
      <button class="btn btn-sm" id="cr-add-amb" type="button">+ Adicionar ambiente</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="flex:2;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Ambiente</span>
      <span style="flex:1;min-width:110px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-left:-230px">Valor (R$)</span>
      <span style="flex:0 0 90px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-left:-70px">Dias</span>
      <span style="flex:0 0 auto;visibility:hidden;padding:4px 10px;font-size:12px">&times;</span>
    </div>
    <div id="cr-ambientes"></div>
  `;

  document.getElementById('modal-rodape').innerHTML = `
    <button class="btn" onclick="window._modal.fechar()">Cancelar</button>
    <button class="btn btn-primary" onclick="window._cadastroRapido.salvar()">Salvar</button>
  `;

  const container = document.getElementById('cr-ambientes');
  // Campo do valor líquido (acima dos títulos das colunas de ambientes)
  container.previousElementSibling.insertAdjacentHTML('beforebegin', `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <label style="font-size:12px;font-weight:600;color:var(--text);margin:0">Valor líquido total (R$)</label>
      <input type="text" id="cr-liquido" placeholder="Ex: 240.138,12" style="width:150px">
      <span id="cr-liquido-info" style="font-size:11px;color:var(--text-muted)"></span>
    </div>
    <div id="cr-bruto" style="font-size:12px;font-weight:600;color:var(--text);margin:-4px 0 10px"></div>
  `);
  const campoLiquido = document.getElementById('cr-liquido');
  campoLiquido.addEventListener('blur', _aplicarLiquido);
  campoLiquido.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _aplicarLiquido(); }
  });

  // Começar com 1 linha vazia
  _addAmbienteLine(container);

  document.getElementById('cr-add-amb').addEventListener('click', () => {
    const row = _addAmbienteLine(container);
    row.querySelector('.amb-nome').focus();
  });

  const inputArquivo = document.getElementById('cr-arquivo');
  document.getElementById('cr-importar').addEventListener('click', () => inputArquivo.click());
  inputArquivo.addEventListener('change', () => {
    if (inputArquivo.files[0]) _importarContrato(inputArquivo.files[0]);
    inputArquivo.value = '';
  });
  // Se o usuário trocar o nome depois de importar, deixa de ser o cliente existente
  document.getElementById('cr-nome').addEventListener('input', () => { _clienteExistenteId = null; });

  abrirModal();
  setTimeout(() => document.getElementById('cr-nome').focus(), 80);
}

async function salvarCadastroRapido() {
  const nome = document.getElementById('cr-nome').value.trim();
  const tel = document.getElementById('cr-tel').value.trim();
  const end = document.getElementById('cr-end').value.trim();

  if (!nome) return alertaModal('Informe o nome do cliente.');

  // Coletar ambientes
  const rows = document.querySelectorAll('#cr-ambientes .ambiente-row');
  const ambientes = [];
  for (const row of rows) {
    const ambNome = row.querySelector('.amb-nome').value.trim();
    const ambDur = parseInt(row.querySelector('.amb-dur').value) || 0;
    const ambValor = parseBRL(row.querySelector('.amb-valor').value);
    if (ambNome && ambDur >= 1) {
      ambientes.push({ nome: ambNome, duracao_dias: ambDur, valor: ambValor });
    }
  }

  if (!ambientes.length) return alertaModal('Adicione ao menos um ambiente.');

  // 1. Criar cliente (ou reaproveitar o existente escolhido na importação)
  let clienteId = _clienteExistenteId;
  if (!clienteId) {
    const resCli = await API.clientes.criar({ nome, telefone: tel, endereco: end });
    const dataCli = await resCli.json();
    if (!resCli.ok) return alertaModal(dataCli.error);
    clienteId = dataCli.id;
  }

  // 2. Criar ambientes em lote
  const resAmb = await API.ambientes.criarLote({ cliente_id: clienteId, ambientes });
  const dataAmb = await resAmb.json();
  if (!resAmb.ok) return alertaModal(dataAmb.error);

  fecharModal();
  await recarregar();
}

// ── Modo edição ───────────────────────────────────────────────────

let _editClienteId = null;
let _ambientesToDelete = [];

export function abrirEdicaoCliente(clienteId, ambientes) {
  _editClienteId = clienteId;
  ambienteCount = 0;
  _ambientesToDelete = [];

  const cliente = (window._getEstado().clientes || []).find(c => c.id === clienteId) || {};

  document.getElementById('modal-titulo').textContent = 'Editar Cliente';
  document.getElementById('modal-corpo').innerHTML = `
    <div id="modal-alert"></div>
    <div class="form-row">
      <div class="form-group">
        <label>Nome do cliente</label>
        <input type="text" id="cr-nome" placeholder="Ex: João Silva" value="${esc(cliente.nome || '')}">
      </div>
      <div class="form-group">
        <label>Telefone</label>
        <input type="text" id="cr-tel" placeholder="(88) 99999-9999" value="${esc(cliente.telefone || '')}">
      </div>
    </div>
    <div class="form-group">
      <label>Endereço</label>
      <input type="text" id="cr-end" placeholder="Rua, número, bairro..." value="${esc(cliente.endereco || '')}">
    </div>
    <hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <label style="font-size:13px;font-weight:600;color:var(--text);margin:0">Ambientes</label>
      <button class="btn btn-sm" id="cr-add-amb" type="button">+ Adicionar ambiente</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="flex:2;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Ambiente</span>
      <span style="flex:1;min-width:110px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-left:-230px">Valor (R$)</span>
      <span style="flex:0 0 90px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-left:-70px">Dias</span>
      <span style="flex:0 0 auto;visibility:hidden;padding:4px 10px;font-size:12px">&times;</span>
    </div>
    <div id="cr-ambientes"></div>
  `;

  document.getElementById('modal-rodape').innerHTML = `
    <button class="btn" onclick="window._modal.fechar()">Cancelar</button>
    <button class="btn btn-primary" onclick="window._cadastroRapido.salvarEdicao()">Salvar</button>
  `;

  const container = document.getElementById('cr-ambientes');
  for (const amb of ambientes) {
    const row = _addAmbienteLine(container);
    row.dataset.ambId = amb.id;
    row.querySelector('.amb-nome').value = amb.nome || '';
    row.querySelector('.amb-dur').value  = amb.duracao_dias || 1;
    if (amb.valor != null) {
      row.querySelector('.amb-valor').value = formatBRL(amb.valor);
    }
  }

  document.getElementById('cr-add-amb').addEventListener('click', () => {
    const row = _addAmbienteLine(container);
    row.querySelector('.amb-nome').focus();
  });

  abrirModal();
}

async function salvarEdicaoCliente() {
  const nome = document.getElementById('cr-nome').value.trim();
  const tel  = document.getElementById('cr-tel').value.trim();
  const end  = document.getElementById('cr-end').value.trim();

  if (!nome) return alertaModal('Informe o nome do cliente.');

  const promises = [
    API.clientes.atualizar(_editClienteId, { nome, telefone: tel, endereco: end }),
  ];

  const rows = document.querySelectorAll('#cr-ambientes .ambiente-row');
  for (const row of rows) {
    const ambNome  = row.querySelector('.amb-nome').value.trim();
    const ambDur   = parseInt(row.querySelector('.amb-dur').value) || 0;
    const ambValor = parseBRL(row.querySelector('.amb-valor').value);
    if (!ambNome || ambDur < 1) continue;

    const ambId = row.dataset.ambId;
    if (ambId) {
      promises.push(API.ambientes.atualizar(parseInt(ambId), { nome: ambNome, duracao_dias: ambDur, valor: ambValor }));
    } else {
      promises.push(API.ambientes.criar({ cliente_id: _editClienteId, nome: ambNome, duracao_dias: ambDur, valor: ambValor }));
    }
  }

  for (const ambId of _ambientesToDelete) {
    promises.push(API.ambientes.excluir(ambId));
  }

  const results = await Promise.all(promises);
  for (const res of results) {
    if (!res.ok) {
      const data = await res.json();
      return alertaModal(data.error || 'Erro ao salvar.');
    }
  }

  fecharModal();
  await recarregar();
}

// Expõe para handlers inline
window._cadastroRapido = {
  abrir:       abrirCadastroRapido,
  salvar:      salvarCadastroRapido,
  editarCliente: abrirEdicaoCliente,
  salvarEdicao:  salvarEdicaoCliente,
};
