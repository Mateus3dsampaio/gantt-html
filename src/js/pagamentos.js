/**
 * pagamentos.js — Aba Pagamentos (comissões por equipe e funcionárias).
 *
 * O que foi finalizado em um mês é pago no mês seguinte. Os cálculos ficam em
 * backend/rotas.js (/api/pagamentos); aqui só desenhamos e gravamos os ajustes.
 * Não interfere no Dashboard (que é baseado no mês de finalização).
 */

import { esc } from './utils.js';
import { jsonReq } from './utils.js';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const brl = (n) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pctTxt = (n) => String(n).replace('.', ',');

export function initPagamentos() {
  const hoje = new Date();
  const selMes = document.getElementById('pg-mes');
  const selAno = document.getElementById('pg-ano');
  selMes.innerHTML = MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  selMes.value = hoje.getMonth() + 1;
  const a0 = hoje.getFullYear();
  selAno.innerHTML = [a0 - 2, a0 - 1, a0, a0 + 1].map(a => `<option value="${a}">${a}</option>`).join('');
  selAno.value = a0;
  selMes.addEventListener('change', atualizarPagamentos);
  selAno.addEventListener('change', atualizarPagamentos);
}

export async function atualizarPagamentos() {
  const ano = document.getElementById('pg-ano').value;
  const mes = document.getElementById('pg-mes').value;
  const d = await fetch(`/api/pagamentos?ano=${ano}&mes=${mes}`).then(r => r.json());
  render(d);
}

function render(d) {
  const ref = d.referencia;
  document.getElementById('pg-ref').textContent =
    `Base: finalizados em ${MESES[ref.mes - 1]} de ${ref.ano}`;

  document.getElementById('pg-recordes').innerHTML = d.recordes.map(r => `
    <div class="pg-recorde" style="--cor:${esc(r.cor || '#8b5cf6')}">
      <div class="pg-recorde-nome">🏆 ${esc(r.nome)}</div>
      <div class="pg-recorde-val">${r.recorde ? brl(r.recorde.valor) : '—'}</div>
      <div class="pg-recorde-mes">${r.recorde ? esc(r.recorde.label) : 'sem recebimentos'}</div>
    </div>`).join('');

  const cartoes = d.equipes.map(e => cartaoEquipe(d, e)).join('');
  const func = cartaoFuncionarias(d);
  document.getElementById('pg-conteudo').innerHTML = `
    <div class="pg-total">Total a pagar em ${MESES[d.mes - 1]}/${d.ano}: <strong>${brl(d.total_geral)}</strong></div>
    ${cartoes || '<div class="empty-state">Nenhuma equipe de montagem com finalizações neste período.</div>'}
    ${func}`;
}

function campoPct(valor, padrao, ajustado, attrs, titulo) {
  return `<input type="text" inputmode="decimal" class="pg-pct${ajustado ? ' pg-pct--aj' : ''}"
            value="${pctTxt(valor)}" title="${esc(titulo)}" ${attrs}> <span class="pg-pct-sinal">%</span>`;
}

function cartaoEquipe(d, e) {
  const linhas = e.ambientes.map(a => `
    <tr>
      <td>${esc(a.cliente)}</td>
      <td>${esc(a.ambiente)}</td>
      <td>${esc(a.finalizado_em.split('-').reverse().join('/'))}</td>
      <td class="pg-num">${brl(a.valor)}</td>
      <td class="pg-num">${campoPct(a.pct_usado, e.pct, a.pct_ambiente != null,
          `onchange="window._pagamentos.ambiente(${a.agendamento_id}, this.value)"`,
          'Percentual só deste ambiente. Apague para voltar ao % da equipe.')}</td>
      <td class="pg-num">${brl(a.comissao)}</td>
    </tr>`).join('');
  return `
    <div class="pg-card">
      <div class="pg-card-topo">
        <span class="equipe-cor-dot" style="background:${esc(e.cor || '#3B82F6')}"></span>
        <span class="pg-card-nome">${esc(e.nome)}</span>
        <span class="pg-card-pct">Comissão:
          ${campoPct(e.pct, e.pct_padrao, e.pct_ajustado,
            `onchange="window._pagamentos.comissao('${e.equipe_id}', this.value)"`,
            `Padrão: ${pctTxt(e.pct_padrao)}%. Vale só para este mês de pagamento. Apague para voltar ao padrão.`)}
        </span>
        <span class="pg-card-total">${brl(e.total_pagar)}</span>
      </div>
      ${e.ambientes.length ? `
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Ambiente</th><th>Finalizado</th>
          <th class="pg-num">Valor</th><th class="pg-num">%</th><th class="pg-num">Comissão</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>` : '<div class="empty-state">Nada finalizado por esta equipe no período.</div>'}
    </div>`;
}

function cartaoFuncionarias(d) {
  const linhas = d.funcionarias.map(f => `
    <tr>
      <td>${esc(f.nome)}</td>
      <td class="pg-num">${brl(f.base)}</td>
      <td class="pg-num">${campoPct(f.pct, f.pct_padrao, f.pct_ajustado,
          `onchange="window._pagamentos.comissao('${f.chave}', this.value)"`,
          `Padrão: ${pctTxt(f.pct_padrao)}%. Vale só para este mês de pagamento. Apague para voltar ao padrão.`)}</td>
      <td class="pg-num">${brl(f.total_pagar)}</td>
    </tr>`).join('');
  return `
    <div class="pg-card">
      <div class="pg-card-topo">
        <span class="pg-card-nome">Funcionárias — sobre o total montado por todas as equipes</span>
      </div>
      <table class="data-table">
        <thead><tr><th>Nome</th><th class="pg-num">Total montado (todas as equipes)</th>
          <th class="pg-num">%</th><th class="pg-num">Comissão</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

async function salvar(url, corpo) {
  const res = await fetch(url, jsonReq('PUT', corpo));
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    alert(e.error || 'Não foi possível salvar.');
  }
  await atualizarPagamentos();
}

window._pagamentos = {
  comissao: (quem, pct) => salvar('/api/pagamentos/comissao', {
    ano: document.getElementById('pg-ano').value, mes: document.getElementById('pg-mes').value, quem, pct,
  }),
  ambiente: (agendamento_id, pct) => salvar('/api/pagamentos/ambiente', { agendamento_id, pct }),
};
