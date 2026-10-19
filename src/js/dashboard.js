/**
 * dashboard.js — Dashboard de desempenho das equipes.
 * Depende de: api.js
 * Requer Chart.js carregado globalmente (CDN no HTML).
 */

import { API } from './api.js';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let _chartMensal    = null;
let _chartAcumulado = null;
let _chartMediaDia  = null;

// ── Inicialização dos filtros ─────────────────────────────────────
export function initDashboard() {
  const anoEl    = document.getElementById('dash-ano');
  const mesIniEl = document.getElementById('dash-mes-ini');
  const mesFimEl = document.getElementById('dash-mes-fim');

  const anoAtual = new Date().getFullYear();
  for (let a = anoAtual - 2; a <= anoAtual + 1; a++) {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    if (a === anoAtual) opt.selected = true;
    anoEl.appendChild(opt);
  }

  MESES.forEach((nome, i) => {
    const ini = document.createElement('option');
    ini.value = i + 1;
    ini.textContent = nome;
    if (i === 0) ini.selected = true;
    mesIniEl.appendChild(ini);

    const fim = document.createElement('option');
    fim.value = i + 1;
    fim.textContent = nome;
    if (i === 11) fim.selected = true;
    mesFimEl.appendChild(fim);
  });
}

// ── Atualizar dashboard com os filtros atuais ─────────────────────
export async function atualizarDashboard() {
  const ano    = parseInt(document.getElementById('dash-ano').value);
  const mesIni = parseInt(document.getElementById('dash-mes-ini').value);
  const mesFim = parseInt(document.getElementById('dash-mes-fim').value);

  const dados = await API.relatorios.dashboard(ano, mesIni, mesFim);

  renderKPIs(dados.kpis);
  renderChartMensal(dados);
  renderChartAcumulado(dados);
  renderTabela(dados.acumulado);
  renderChartMediaDia(dados);
}

// ── Formatação ────────────────────────────────────────────────────
function fmtBRL(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// ── KPI Cards ─────────────────────────────────────────────────────
function renderKPIs(kpis) {
  const el = document.getElementById('dash-kpis');
  const destaque = kpis.destaque;
  const maiorDia = kpis.maior_media_dia;

  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Total Concluído no Período</div>
      <div class="kpi-valor">${fmtBRL(kpis.total_geral)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">🏆 Equipe Destaque</div>
      <div class="kpi-valor" style="color:${destaque?.cor || '#1a1a18'}">
        ${destaque ? destaque.nome : '—'}
      </div>
      <div class="kpi-sub">${destaque ? fmtBRL(destaque.total) + ' acumulado' : ''}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">⚡ Maior Média / Dia</div>
      <div class="kpi-valor" style="color:${maiorDia?.cor || '#1a1a18'}">
        ${maiorDia ? maiorDia.nome : '—'}
      </div>
      <div class="kpi-sub">${maiorDia ? fmtBRL(maiorDia.media_dia) + ' / dia' : ''}</div>
    </div>
  `;
}

// ── Gráfico de barras por mês ─────────────────────────────────────
function renderChartMensal(dados) {
  const ctx = document.getElementById('chart-mensal').getContext('2d');
  if (_chartMensal) _chartMensal.destroy();

  const labels   = dados.meses.map(m => m.label);
  const datasets = dados.equipes.map(eq => ({
    label:           eq.nome,
    data:            dados.meses.map(m => m.dados[eq.id] || 0),
    backgroundColor: eq.cor,
    borderRadius:    4,
    borderSkipped:   false,
  }));

  _chartMensal = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtBRL(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          ticks: {
            callback: v => fmtBRL(v),
            font: { size: 11 },
          },
          grid: { color: '#f0efe9' },
        },
      },
    },
  });
}

// ── Gráfico de barras horizontais (acumulado) ─────────────────────
function renderChartAcumulado(dados) {
  const ctx = document.getElementById('chart-acumulado').getContext('2d');
  if (_chartAcumulado) _chartAcumulado.destroy();

  const sorted   = [...dados.acumulado].sort((a, b) => b.total - a.total);
  const labels   = sorted.map(e => e.nome);
  const values   = sorted.map(e => e.total);
  const colors   = sorted.map(e => e.cor);

  _chartAcumulado = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           'Acumulado',
        data:            values,
        backgroundColor: colors,
        borderRadius:    4,
        borderSkipped:   false,
      }],
    },
    options: {
      indexAxis:           'y',
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmtBRL(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { callback: v => fmtBRL(v), font: { size: 11 } },
          grid:  { color: '#f0efe9' },
        },
        y: { grid: { display: false } },
      },
    },
  });
}

// ── Gráfico de linha: média diária por mês ────────────────────────
function renderChartMediaDia(dados) {
  const ctx = document.getElementById('chart-media-dia').getContext('2d');
  if (_chartMediaDia) _chartMediaDia.destroy();

  const labels   = dados.meses.map(m => m.label);
  const datasets = dados.equipes.map(eq => ({
    label:           eq.nome,
    data:            dados.meses.map(m => m.media_dia[eq.id] ?? null),
    borderColor:     eq.cor,
    backgroundColor: eq.cor + '22',
    pointBackgroundColor: eq.cor,
    pointRadius:     5,
    pointHoverRadius: 7,
    borderWidth:     2.5,
    tension:         0.35,
    spanGaps:        false,  // quebra a linha onde não há dados
  }));

  _chartMediaDia = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.raw !== null
              ? ` ${ctx.dataset.label}: ${fmtBRL(ctx.raw)}/dia`
              : ` ${ctx.dataset.label}: sem dados`,
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          ticks: {
            callback: v => fmtBRL(v),
            font: { size: 11 },
          },
          grid: { color: '#f0efe9' },
        },
      },
    },
  });
}

// ── Tabela de desempenho ──────────────────────────────────────────
function renderTabela(acumulado) {
  const el = document.getElementById('dash-tabela');

  if (!acumulado.length) {
    el.innerHTML = '<p style="color:#aaa;font-size:13px">Nenhum dado no período.</p>';
    return;
  }

  const rows = acumulado.map((eq, i) => `
    <tr>
      <td>
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${eq.cor};margin-right:6px;vertical-align:middle"></span>
        ${eq.nome}
      </td>
      <td>${fmtBRL(eq.total)}</td>
      <td>${fmtBRL(eq.media_mensal)}</td>
      <td>${fmtBRL(eq.media_dia)}</td>
      <td>${eq.mes_pico}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Equipe</th>
          <th>Total</th>
          <th>Média/mês</th>
          <th>Média/dia</th>
          <th>Mês de pico</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Expõe para o botão "Aplicar"
window._dashboard = {
  atualizar: atualizarDashboard,
};
