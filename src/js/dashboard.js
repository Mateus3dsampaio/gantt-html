/**
 * dashboard.js — Dashboard de desempenho das equipes.
 * Depende de: api.js
 * Requer Chart.js carregado globalmente (embutido no HTML).
 *
 * Dois temas visuais: "neon" (A) e "aurora" (B), escolhidos no próprio dashboard.
 */

import { API } from './api.js';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const CHAVE_TEMA = 'gantt_dash_tema';
const TEMAS = ['neon', 'aurora'];

let _charts   = [];       // instâncias Chart.js ativas
let _dados    = null;     // última resposta do dashboard (para re-render ao trocar tema/modo)
let _modoPizza = 'pct';   // 'pct' | 'valor'

// ── Inicialização dos filtros e do seletor de tema ────────────────
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

  // Tema (A · Neon / B · Aurora) — lembrado neste navegador
  let tema = 'neon';
  try { const t = localStorage.getItem(CHAVE_TEMA); if (TEMAS.includes(t)) tema = t; } catch { /* ignora */ }
  aplicarTema(tema);
  document.querySelectorAll('.dx-temas button').forEach(btn => {
    btn.addEventListener('click', () => {
      aplicarTema(btn.dataset.dxTema);
      try { localStorage.setItem(CHAVE_TEMA, btn.dataset.dxTema); } catch { /* ignora */ }
      if (_dados) renderTudo();
    });
  });

  // Alternância % / R$ da pizza
  document.querySelectorAll('#dx-toggle-pizza button').forEach(btn => {
    btn.addEventListener('click', () => {
      _modoPizza = btn.dataset.modo;
      marcarToggle();
      if (_dados) renderPizza(_dados);
    });
  });
}

function aplicarTema(tema) {
  document.getElementById('dx').dataset.tema = tema;
  document.querySelectorAll('.dx-temas button').forEach(b =>
    b.classList.toggle('on', b.dataset.dxTema === tema));
}

function marcarToggle() {
  document.querySelectorAll('#dx-toggle-pizza button').forEach(b =>
    b.classList.toggle('on', b.dataset.modo === _modoPizza));
}

// ── Atualizar dashboard com os filtros atuais ─────────────────────
export async function atualizarDashboard() {
  const ano    = parseInt(document.getElementById('dash-ano').value);
  const mesIni = parseInt(document.getElementById('dash-mes-ini').value);
  const mesFim = parseInt(document.getElementById('dash-mes-fim').value);

  _dados = await API.relatorios.dashboard(ano, mesIni, mesFim);
  renderTudo();
}

function renderTudo() {
  _charts.forEach(c => c.destroy());
  _charts = [];

  const dx = document.getElementById('dx');
  const estilo = getComputedStyle(dx);
  const ink = {
    texto: estilo.getPropertyValue('--dx-text').trim(),
    muted: estilo.getPropertyValue('--dx-muted').trim(),
    grid:  estilo.getPropertyValue('--dx-grid').trim(),
    anel:  estilo.getPropertyValue('--dx-ring').trim(),
  };
  Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
  Chart.defaults.color = ink.muted;

  renderKPIs(_dados.kpis);
  renderLegendas(_dados);
  renderChartMensal(_dados, ink);
  renderPizza(_dados);
  renderChartAcumulado(_dados, ink);
  renderTabela(_dados.acumulado);
  renderChartMediaDia(_dados, ink);
}

// ── Formatação e cores ────────────────────────────────────────────
function fmtBRL(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtPct(v) {
  return v.toFixed(1).replace('.', ',') + '%';
}

function hexToRgb(h) {
  const n = parseInt(h.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function misturar(h, alvo, p) {
  const a = hexToRgb(h);
  return '#' + a.map((c, i) => Math.round(c + (alvo[i] - c) * p).toString(16).padStart(2, '0')).join('');
}
function comAlpha(h, a) {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
/** Os temas são escuros: clareia cores de equipe muito escuras para manter contraste. */
function corTema(h) {
  const [r, g, b] = hexToRgb(h);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.42 ? misturar(h, [255, 255, 255], 0.45) : h;
}

function gradV(ctx, area, cor) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, misturar(cor, [255, 255, 255], 0.25));
  g.addColorStop(1, cor);
  return g;
}
function gradH(ctx, area, cor) {
  const g = ctx.createLinearGradient(area.left, 0, area.right, 0);
  g.addColorStop(0, comAlpha(cor, 0.55));
  g.addColorStop(1, misturar(cor, [255, 255, 255], 0.2));
  return g;
}

// ── KPI Cards ─────────────────────────────────────────────────────
function renderKPIs(kpis) {
  const el = document.getElementById('dash-kpis');
  const destaque = kpis.destaque;
  const maiorDia = kpis.maior_media_dia;

  el.innerHTML = `
    <div class="dx-kpi dx-kpi--1">
      <div class="dx-kpi-rot">Total Concluído no Período</div>
      <div class="dx-kpi-val">${fmtBRL(kpis.total_geral)}</div>
    </div>
    <div class="dx-kpi dx-kpi--2">
      <div class="dx-kpi-rot">🏆 Equipe Destaque</div>
      <div class="dx-kpi-val">${destaque ? destaque.nome : '—'}</div>
      <div class="dx-kpi-sub">${destaque ? fmtBRL(destaque.total) + ' acumulado' : ''}</div>
    </div>
    <div class="dx-kpi dx-kpi--3">
      <div class="dx-kpi-rot">⚡ Maior Média / Dia</div>
      <div class="dx-kpi-val">${maiorDia ? maiorDia.nome : '—'}</div>
      <div class="dx-kpi-sub">${maiorDia ? fmtBRL(maiorDia.media_dia) + ' / dia' : ''}</div>
    </div>
  `;
}

// ── Legendas (HTML) dos gráficos por equipe ───────────────────────
function renderLegendas(dados) {
  const html = dados.equipes.map(eq =>
    `<span><i style="background:${corTema(eq.cor)}"></i>${eq.nome}</span>`).join('');
  document.getElementById('dx-leg-mensal').innerHTML = html;
  document.getElementById('dx-leg-media').innerHTML  = html;
}

// ── Gráfico de barras por mês ─────────────────────────────────────
function renderChartMensal(dados, ink) {
  const ctx = document.getElementById('chart-mensal').getContext('2d');

  const labels   = dados.meses.map(m => m.label);
  const datasets = dados.equipes.map(eq => {
    const cor = corTema(eq.cor);
    return {
      label:           eq.nome,
      data:            dados.meses.map(m => m.dados[eq.id] || 0),
      backgroundColor: c => c.chart.chartArea ? gradV(c.chart.ctx, c.chart.chartArea, cor) : cor,
      borderRadius:    6,
      borderSkipped:   false,
      maxBarThickness: 16,
    };
  });

  _charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtBRL(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          border: { display: false },
          ticks: { callback: v => fmtBRL(v), font: { size: 11 } },
          grid:  { color: ink.grid },
        },
      },
    },
  }));
}

// ── Rosca: participação de cada equipe no total concluído ─────────
function renderPizza(dados) {
  const el = document.getElementById('chart-pizza');
  const existente = Chart.getChart(el);
  if (existente) { _charts = _charts.filter(c => c !== existente); existente.destroy(); }

  marcarToggle();
  const estilo = getComputedStyle(document.getElementById('dx'));
  const texto  = estilo.getPropertyValue('--dx-text').trim();
  const muted  = estilo.getPropertyValue('--dx-muted').trim();
  const anel   = estilo.getPropertyValue('--dx-ring').trim();

  const lista = dados.acumulado;
  const total = lista.reduce((s, a) => s + a.total, 0);
  const pct   = v => (total > 0 ? (v / total) * 100 : 0);
  const mostra = v => (_modoPizza === 'pct' ? fmtPct(pct(v)) : fmtBRL(v));

  const centro = {
    id: 'centro',
    afterDraw(ch) {
      const { ctx, chartArea: a } = ch;
      const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = muted;
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.fillText('Total concluído', x, y - 10);
      ctx.fillStyle = texto;
      ctx.font = '700 17px Segoe UI, sans-serif';
      ctx.fillText(fmtBRL(total), x, y + 13);
      ctx.restore();
    },
  };

  _charts.push(new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: lista.map(a => a.nome),
      datasets: [{
        data: lista.map(a => a.total),
        backgroundColor: lista.map(a => corTema(a.cor)),
        borderWidth: 3,
        borderColor: anel,
        spacing: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '70%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${mostra(ctx.raw)}` } },
      },
    },
    plugins: [centro],
  }));

  document.getElementById('dx-leg-pizza').innerHTML = lista.map(a => `
    <div>
      <span class="n"><i style="background:${corTema(a.cor)}"></i>${a.nome}</span>
      <b>${mostra(a.total)}</b>
    </div>`).join('');
}

// ── Gráfico de barras horizontais (acumulado) ─────────────────────
function renderChartAcumulado(dados, ink) {
  const ctx = document.getElementById('chart-acumulado').getContext('2d');

  const sorted   = [...dados.acumulado].sort((a, b) => b.total - a.total);
  const labels   = sorted.map(e => e.nome);
  const values   = sorted.map(e => e.total);
  const colors   = sorted.map(e => corTema(e.cor));

  const valorNaPonta = {
    id: 'valorNaPonta',
    afterDatasetsDraw(ch) {
      const { ctx: c } = ch;
      c.save();
      c.fillStyle = ink.texto;
      c.font = '600 11px Segoe UI, sans-serif';
      c.textBaseline = 'middle';
      ch.getDatasetMeta(0).data.forEach((barra, i) => c.fillText(fmtBRL(values[i]), barra.x + 8, barra.y));
      c.restore();
    },
  };

  _charts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           'Acumulado',
        data:            values,
        backgroundColor: c => c.chart.chartArea ? gradH(c.chart.ctx, c.chart.chartArea, colors[c.dataIndex]) : colors[c.dataIndex],
        borderRadius:    8,
        borderSkipped:   false,
        maxBarThickness: 20,
      }],
    },
    options: {
      indexAxis:           'y',
      responsive:          true,
      maintainAspectRatio: false,
      layout: { padding: { right: 72 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmtBRL(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: ink.texto, font: { size: 12 } } },
      },
    },
    plugins: [valorNaPonta],
  }));
}

// ── Gráfico de linha: média diária por mês ────────────────────────
function renderChartMediaDia(dados, ink) {
  const ctx = document.getElementById('chart-media-dia').getContext('2d');

  const labels   = dados.meses.map(m => m.label);
  const datasets = dados.equipes.map(eq => {
    const cor = corTema(eq.cor);
    return {
      label:           eq.nome,
      data:            dados.meses.map(m => m.media_dia[eq.id] ?? null),
      borderColor:     cor,
      pointBackgroundColor: cor,
      pointBorderColor: ink.anel,
      pointBorderWidth: 2,
      pointRadius:     4,
      pointHoverRadius: 7,
      borderWidth:     2.5,
      tension:         0.38,
      spanGaps:        false,  // quebra a linha onde não há dados
      fill:            true,
      backgroundColor: c => {
        const ch = c.chart;
        if (!ch.chartArea) return 'transparent';
        const g = ch.ctx.createLinearGradient(0, ch.chartArea.top, 0, ch.chartArea.bottom);
        g.addColorStop(0, comAlpha(cor, 0.22));
        g.addColorStop(1, comAlpha(cor, 0));
        return g;
      },
    };
  });

  _charts.push(new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.raw !== null
              ? ` ${ctx.dataset.label}: ${fmtBRL(ctx.raw)}/dia`
              : ` ${ctx.dataset.label}: sem dados`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          border: { display: false },
          ticks: { callback: v => fmtBRL(v), font: { size: 11 } },
          grid:  { color: ink.grid },
        },
      },
    },
  }));
}

// ── Tabela de desempenho ──────────────────────────────────────────
function renderTabela(acumulado) {
  const el = document.getElementById('dash-tabela');

  if (!acumulado.length) {
    el.innerHTML = '<p style="color:var(--dx-muted);font-size:13px">Nenhum dado no período.</p>';
    return;
  }

  const maior = Math.max(...acumulado.map(a => a.total), 1);
  const rows = acumulado.map(eq => {
    const cor = corTema(eq.cor);
    return `
    <tr>
      <td><span class="dx-dot" style="background:${cor}"></span>${eq.nome}</td>
      <td>${fmtBRL(eq.total)}
        <div class="dx-mini"><span style="width:${(eq.total / maior) * 100}%;background:linear-gradient(90deg,${comAlpha(cor, 0.5)},${cor})"></span></div>
      </td>
      <td>${fmtBRL(eq.media_mensal)}</td>
      <td>${fmtBRL(eq.media_dia)}</td>
      <td>${eq.mes_pico}</td>
    </tr>`;
  }).join('');

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
