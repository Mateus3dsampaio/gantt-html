/**
 * gantt.js — Renderização do gráfico de Gantt.
 * Depende de: utils.js
 * Acessa o estado global (equipes, agendamentos) via import do app.js.
 */

import {
  STATUS_COR, parseData, nomeMes, diasNoMes, diaDaSemana,
  formataBR, inicioBR,
} from './utils.js';
import { getEstado, recarregar } from './app.js';
import { abrirModalEditarAgendamento } from './agendamentos.js';
import { confirmarAgendamento } from './pendentes.js';
import { API } from './api.js';

// ── Estado do Gantt ───────────────────────────────────────────────
let ganttAno = new Date().getFullYear();
let ganttMes = new Date().getMonth();   // 0-indexed

export function getGanttMes() { return ganttMes; }
export function getGanttAno() { return ganttAno; }

// ── Clique no Gantt para agendar ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gantt-tbody').addEventListener('click', (e) => {
    if (!window._modoAgendar) return;

    // Ignorar cliques em blocos existentes (drag/resize)
    if (e.target.closest('.gantt-block')) return;

    const tr = _getTr(e.target);
    if (!tr || !tr.dataset.equipeId) return;

    const equipeId = parseInt(tr.dataset.equipeId);
    const dayIdx   = _getDayFromX(e.clientX, tr);
    if (dayIdx === null) return;

    const dataInicio = _buildDataInicio(dayIdx);
    confirmarAgendamento(equipeId, dataInicio);
  });
});

export function changeMonth(delta) {
  ganttMes += delta;
  if (ganttMes > 11) { ganttMes = 0; ganttAno++; }
  if (ganttMes <  0) { ganttMes = 11; ganttAno--; }
  renderGantt();
  renderResumoEquipes();
}

// ── Resumo de equipes na sidebar ──────────────────────────────────
function fmtBRL(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function renderResumoEquipes() {
  const el = document.getElementById('sidebar-resumo');
  if (!el) return;

  // mes é 0-indexed no gantt, backend espera 1-indexed
  const dados = await API.equipes.resumoMes(ganttAno, ganttMes + 1);

  if (!dados.length) {
    el.innerHTML = '<p class="resumo-vazio">Nenhuma equipe cadastrada.</p>';
    return;
  }

  el.innerHTML = dados.map(eq => `
    <div class="resumo-card">
      <div class="resumo-card-nome">
        <span class="resumo-dot" style="background:${eq.cor}"></span>
        ${eq.nome}
      </div>
      <div class="resumo-linha">
        <span class="resumo-label">Agendado</span>
        <span class="resumo-valor">${fmtBRL(eq.agendado)}</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-label">Em andamento</span>
        <span class="resumo-valor">${fmtBRL(eq.em_andamento)}</span>
      </div>
      <div class="resumo-linha">
        <span class="resumo-label">Concluído</span>
        <span class="resumo-valor">${fmtBRL(eq.concluido)}</span>
      </div>
    </div>
  `).join('');
}

// ── Renderização principal ────────────────────────────────────────
export function renderGantt() {
  const { equipes, agendamentos, feriados } = getEstado();
  const N        = diasNoMes(ganttAno, ganttMes);
  const hoje     = new Date();
  const ehHoje   = (d) => hoje.getFullYear() === ganttAno && hoje.getMonth() === ganttMes && hoje.getDate() === d;
  const mesAtual = hoje.getFullYear() === ganttAno && hoje.getMonth() === ganttMes;
  const todayPct = mesAtual ? ((hoje.getDate() - 1 + 0.5) / N * 100).toFixed(3) : null;

  // Set com todas as datas de feriados do mês atual
  const mes2  = String(ganttMes + 1).padStart(2, '0');
  const feriadosDatas = new Set((feriados || []).map(f => f.data));
  const dataStr = (d) => `${ganttAno}-${mes2}-${String(d).padStart(2, '0')}`;

  document.getElementById('gantt-month-label').textContent = nomeMes(ganttAno, ganttMes);

  // ── Cabeçalho de dias ──
  let thDias = '';
  for (let d = 1; d <= N; d++) {
    const dow    = diaDaSemana(ganttAno, ganttMes, d);
    const isSun  = dow === 0;
    const isFer  = feriadosDatas.has(dataStr(d));
    const cls    = isSun ? ' is-sunday' : (dow === 6 ? ' is-weekend' : '') + (isFer ? ' is-feriado' : '');
    const hoj    = ehHoje(d) ? ' is-today' : '';
    thDias += `<div class="day-num${cls}${hoj}" title="${isFer ? (feriados.find(f => f.data === dataStr(d))?.nome || 'Feriado') : ''}">${d}</div>`;
  }

  document.getElementById('gantt-thead').innerHTML = `
    <tr>
      <th class="gantt-label-cell">Equipe</th>
      <th class="gantt-days-cell">
        <div class="days-header-row" style="grid-template-columns:repeat(${N},1fr)">${thDias}</div>
      </th>
    </tr>`;

  // ── Linhas de equipes ──
  const mesInicio = new Date(ganttAno, ganttMes, 1);
  const mesFim    = new Date(ganttAno, ganttMes + 1, 1);

  let tbodyHtml = '';

  if (!equipes.length) {
    tbodyHtml = `<tr><td colspan="2">
      <div class="empty-state">Nenhuma equipe cadastrada. Vá em Cadastro para adicionar.</div>
    </td></tr>`;
  }

  for (const eq of equipes) {
    const blocos = agendamentos.filter(a => {
      if (a.equipe_id !== eq.id) return false;
      const ini = parseData(a.data_inicio);
      const fim = parseData(a.data_fim);
      return ini < mesFim && fim > mesInicio;
    });

    // Feriados em que esta equipe NÃO trabalha
    const feriadosEquipe = new Set(
      (feriados || [])
        .filter(f => !f.equipes_trabalham.includes(eq.id))
        .map(f => f.data)
    );

    let gridCells = '', sundayCells = '';
    for (let d = 1; d <= N; d++) {
      const dow   = diaDaSemana(ganttAno, ganttMes, d);
      const isSun = dow === 0;
      const isFer = feriadosEquipe.has(dataStr(d));
      const hoj   = ehHoje(d) ? ' is-today' : '';
      gridCells   += `<div class="bars-grid-cell${hoj}"></div>`;
      sundayCells += `<div class="sunday-overlay-cell${isSun ? ' is-sunday' : ''}${isFer ? ' is-feriado' : ''}"></div>`;
    }

    let blocosHtml = '';
    for (const ag of blocos) {
      const iniDate = parseData(ag.data_inicio);
      const fimDate = parseData(ag.data_fim);

      const fimNoMes  = fimDate.getMonth() === ganttMes && fimDate.getFullYear() === ganttAno;
      const iniNoMes  = iniDate.getMonth() === ganttMes && iniDate.getFullYear() === ganttAno;
      const sIdxFinal = iniNoMes  ? (iniDate.getDate() - 1) : 0;
      const eIdxFinal = fimNoMes  ? (fimDate.getDate() - 1) : N;

      if (isNaN(sIdxFinal) || isNaN(eIdxFinal) || eIdxFinal <= sIdxFinal) continue;

      const leftPct  = (sIdxFinal / N * 100).toFixed(4);
      const widthPct = ((eIdxFinal - sIdxFinal) / N * 100).toFixed(4);
      const cor      = STATUS_COR[ag.status] || '#378ADD';
      const cutLeft  = iniDate < mesInicio;
      const cutRight = fimDate > mesFim;
      const radius   = [
        cutLeft  ? '0' : '999px',
        cutRight ? '0' : '999px',
        cutRight ? '0' : '999px',
        cutLeft  ? '0' : '999px',
      ].join(' ');

      const tip = encodeURIComponent(JSON.stringify({
        cliente   : ag.cliente_nome,
        ambiente  : ag.ambiente_nome,
        equipe    : ag.equipe_nome,
        equipe_id : ag.equipe_id,
        inicio    : inicioBR(ag.data_inicio),
        fim       : formataBR(ag.data_fim),
        ini_raw   : ag.data_inicio,
        fim_raw   : ag.data_fim,
        status    : ag.status,
        tipo      : ag.tipo || 'montagem',
        obs       : ag.observacoes || '',
        valor     : ag.valor,
        id        : ag.id,
      }));

      const isAssist = ag.tipo === 'assistencia';
      const label = `${_iconeStatus(ag.status, isAssist)}<span class="gantt-block-txt">${ag.cliente_nome} — ${ag.ambiente_nome}</span>`;

      const assistStyle = isAssist ? 'border:2px dashed rgba(255,255,255,0.7);' : '';

      // Máscara para criar gap visual em domingos e feriados dentro da barra
      let maskStyle = '';
      const gapStops = [];
      for (let d = sIdxFinal; d < eIdxFinal; d++) {
        const day = d + 1;
        const dow = diaDaSemana(ganttAno, ganttMes, day);
        if (dow === 0 || feriadosEquipe.has(dataStr(day))) {
          const barLen = eIdxFinal - sIdxFinal;
          const p0 = ((d - sIdxFinal) / barLen * 100).toFixed(3);
          const p1 = ((d + 1 - sIdxFinal) / barLen * 100).toFixed(3);
          gapStops.push([p0, p1]);
        }
      }
      if (gapStops.length > 0) {
        const stops = ['white 0%'];
        for (const [p0, p1] of gapStops) {
          stops.push(`white ${p0}%`, `transparent ${p0}%`, `transparent ${p1}%`, `white ${p1}%`);
        }
        stops.push('white 100%');
        const grad = `linear-gradient(to right,${stops.join(',')})`;
        maskStyle = `-webkit-mask-image:${grad};mask-image:${grad};`;
      }

      blocosHtml += `
        <div class="gantt-block${isAssist ? ' gantt-block-assistencia' : ''}"
          style="left:${leftPct}%;width:${widthPct}%;background:${_degrade(cor)};box-shadow:0 4px 14px ${cor}66, inset 0 1px 0 rgba(255,255,255,.28);border-radius:${radius};${assistStyle}"
          data-tip="${tip}"
          data-ag-id="${ag.id}"
          onmouseenter="window._ganttTooltip.mostrar(event,this)"
          onmousemove="window._ganttTooltip.mover(event)"
          onmouseleave="window._ganttTooltip.esconder()"
          onmousedown="window._ganttDrag.iniciar(event,${ag.id})"
          title=""
        >
          <div class="gantt-resize-handle gantt-resize-left"
            onmousedown="window._ganttResize.iniciar(event,'left',${ag.id})"
          ></div>
          ${label}
          <div class="gantt-resize-handle gantt-resize-right"
            onmousedown="window._ganttResize.iniciar(event,'right',${ag.id})"
          ></div>
        </div>`;
    }

    const linhaHoje = todayPct !== null
      ? `<div class="today-line" style="left:${todayPct}%"></div>`
      : '';

    tbodyHtml += `
      <tr data-equipe-id="${eq.id}">
        <td class="equipe-label-cell" style="--cor:${eq.cor}"><div class="eq-inner"><span class="eq-av"><svg class="i"><use href="#i-user"/></svg></span>${eq.nome}</div></td>
        <td class="bars-cell">
          <div class="bars-wrapper">
            <div class="bars-grid" style="grid-template-columns:repeat(${N},1fr)">${gridCells}</div>
            ${blocosHtml}
            <div class="sunday-overlay" style="grid-template-columns:repeat(${N},1fr)">${sundayCells}</div>
            ${linhaHoje}
          </div>
        </td>
      </tr>`;
  }

  document.getElementById('gantt-tbody').innerHTML = tbodyHtml;

  // Expõe função de edição para os handlers inline dos blocos
  window._abrirEditarAgendamento = abrirModalEditarAgendamento;

  _posicionarLinhaHoje(mesAtual ? hoje.getDate() : null, N);
}

// ── Visual: degradê das barras, ícones de status e linha de hoje ──
function _mixHex(hex, alvo, p) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return '#' + c.map((v, i) => Math.round(v + (alvo[i] - v) * p).toString(16).padStart(2, '0')).join('');
}

/** Degradê horizontal leve: um tom mais escuro → um pouco mais claro, a partir da cor do status. */
function _degrade(cor) {
  if (!/^#[0-9a-fA-F]{6}$/.test(cor)) return cor;
  return `linear-gradient(90deg,${_mixHex(cor, [0, 0, 0], 0.16)},${_mixHex(cor, [255, 255, 255], 0.12)})`;
}

const _ICONE_STATUS = {
  'Agendado':               'i-cal',
  'Em andamento':           'i-hour',
  'Concluído':              'i-check',
  'Aguardando Assistência': 'i-wrench',
};
function _iconeStatus(status, isAssist) {
  const id = isAssist ? 'i-wrench' : (_ICONE_STATUS[status] || 'i-cal');
  return `<svg class="i gantt-block-ic"><use href="#${id}"/></svg>`;
}

let _hojeObs = null;
let _hojeDia = null;
let _hojeN   = 0;

/** Uma única linha vertical contínua para o dia de hoje, por cima das barras de todas as equipes. */
function _posicionarLinhaHoje(dia, N) {
  _hojeDia = dia;
  _hojeN   = N;

  const scroll = document.querySelector('.gantt-scroll');
  if (!scroll) return;
  let linha = document.getElementById('gantt-hoje-linha');

  if (dia === null) { if (linha) linha.remove(); return; }
  if (!linha) {
    linha = document.createElement('div');
    linha.id = 'gantt-hoje-linha';
    linha.className = 'gantt-hoje-linha';
    scroll.appendChild(linha);
  }

  const wrappers = scroll.querySelectorAll('.bars-wrapper');
  const header   = scroll.querySelector('.days-header-row');
  if (!wrappers.length || !header) { linha.style.display = 'none'; return; }

  const sr = scroll.getBoundingClientRect();
  const wr = wrappers[0].getBoundingClientRect();
  const hr = header.getBoundingClientRect();
  const ultimo = wrappers[wrappers.length - 1].getBoundingClientRect();
  if (!wr.width) { linha.style.display = 'none'; return; }   // aba oculta: reposiciona quando aparecer

  linha.style.display = '';
  linha.style.left   = (wr.left - sr.left + scroll.scrollLeft + wr.width * ((dia - 0.5) / N)) + 'px';
  linha.style.top    = (hr.bottom - sr.top + scroll.scrollTop + 4) + 'px';
  linha.style.height = Math.max(0, ultimo.bottom - hr.bottom - 4) + 'px';

  // Reposiciona ao redimensionar a janela ou quando a aba do Gantt voltar a ficar visível
  if (!_hojeObs && 'ResizeObserver' in window) {
    _hojeObs = new ResizeObserver(() => _posicionarLinhaHoje(_hojeDia, _hojeN));
    _hojeObs.observe(scroll);
  }
}

// ── Drag-and-drop ─────────────────────────────────────────────────
let _drag = null;

function _getTr(el) {
  while (el && el.tagName !== 'TR') el = el.parentElement;
  return el;
}

function _getDayFromX(x, tr) {
  const wrapper = tr.querySelector('.bars-wrapper');
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  const N = diasNoMes(ganttAno, ganttMes);
  const idx = Math.floor((x - rect.left) / rect.width * N);
  return Math.max(0, Math.min(N - 1, idx));
}

function _buildDataInicio(dayIdx) {
  const m = String(ganttMes + 1).padStart(2, '0');
  const d = String(dayIdx + 1).padStart(2, '0');
  return `${ganttAno}-${m}-${d}`;
}

function contarDiasUteisJS(iniStr, fimStr, feriadosSet) {
  // iniStr: 'YYYY-MM-DD' (inclusivo), fimStr: 'YYYY-MM-DD' (exclusivo)
  const [ay, am, ad] = iniStr.split('-').map(Number);
  const [by, bm, bd] = fimStr.split('-').map(Number);
  const cur = new Date(ay, am - 1, ad);
  const fim = new Date(by, bm - 1, bd);
  let count = 0;
  while (cur < fim) {
    if (cur.getDay() !== 0) {
      const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      if (!feriadosSet.has(ds)) count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(count, 1);
}

window._ganttDrag = {
  iniciar(e, agId) {
    if (e.button !== 0) return;
    e.preventDefault();
    _drag = {
      agId,
      startX: e.clientX,
      startY: e.clientY,
      ativo: false,
      blocoEl: e.currentTarget,
      ghost: null,
      trAlvo: null,
    };
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup',   _onDragEnd);
  },
};

function _onDragMove(e) {
  if (!_drag) return;

  if (!_drag.ativo) {
    const dx = Math.abs(e.clientX - _drag.startX);
    const dy = Math.abs(e.clientY - _drag.startY);
    if (dx < 5 && dy < 5) return;

    // Iniciar drag de fato
    _drag.ativo = true;
    window._ganttTooltip.esconder();
    _drag.blocoEl.classList.add('gantt-block-dragging');

    // Criar ghost
    const ghost = document.createElement('div');
    ghost.className = 'gantt-drag-ghost';
    ghost.textContent = _drag.blocoEl.textContent.trim();
    const bg = _drag.blocoEl.style.background;
    ghost.style.background = bg;
    document.body.appendChild(ghost);
    _drag.ghost = ghost;
  }

  // Mover ghost
  if (_drag.ghost) {
    _drag.ghost.style.left = (e.clientX + 14) + 'px';
    _drag.ghost.style.top  = (e.clientY - 17) + 'px';
  }

  // Highlight da linha alvo
  const elUnder = document.elementFromPoint(e.clientX, e.clientY);
  const tr = _getTr(elUnder);
  if (tr !== _drag.trAlvo) {
    if (_drag.trAlvo) _drag.trAlvo.classList.remove('gantt-row-drop-target');
    _drag.trAlvo = (tr && tr.dataset.equipeId) ? tr : null;
    if (_drag.trAlvo) _drag.trAlvo.classList.add('gantt-row-drop-target');
  }
}

async function _onDragEnd(e) {
  document.removeEventListener('mousemove', _onDragMove);
  document.removeEventListener('mouseup',   _onDragEnd);

  if (!_drag) return;
  const drag = _drag;
  _drag = null;

  // Limpar visuais
  drag.blocoEl.classList.remove('gantt-block-dragging');
  if (drag.ghost) drag.ghost.remove();
  if (drag.trAlvo) drag.trAlvo.classList.remove('gantt-row-drop-target');

  if (!drag.ativo) {
    // Em modo seleção, o clique no bloco é tratado pelo listener do tbody
    if (window._modoAgendar) return;
    abrirModalEditarAgendamento(drag.agId);
    return;
  }

  // Verificar se soltou sobre uma linha de equipe válida
  const elUnder = document.elementFromPoint(e.clientX, e.clientY);
  const tr = _getTr(elUnder);
  if (!tr || !tr.dataset.equipeId) return;

  const novaEquipeId = parseInt(tr.dataset.equipeId);
  const dayIdx = _getDayFromX(e.clientX, tr);
  if (dayIdx === null) return;

  const novaDataInicio = _buildDataInicio(dayIdx);

  const { agendamentos } = getEstado();
  const ag = agendamentos.find(a => a.id === drag.agId);
  if (!ag) return;

  try {
    const res  = await API.agendamentos.atualizar(drag.agId, {
      equipe_id:   novaEquipeId,
      data_inicio: novaDataInicio,
      status:      ag.status,
      observacoes: ag.observacoes || '',
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao mover agendamento.');
      return;
    }
    await recarregar();
  } catch {
    alert('Erro ao mover agendamento.');
  }
}

// ── Resize ────────────────────────────────────────────────────────
let _resize = null;

window._ganttResize = {
  iniciar(e, lado, agId) {
    e.preventDefault();
    e.stopPropagation(); // impede o drag de iniciar

    const { agendamentos } = getEstado();
    const ag = agendamentos.find(a => a.id === agId);
    if (!ag) return;

    const blocoEl = e.currentTarget.closest('.gantt-block');
    _resize = {
      agId, lado, ag,
      ativo: false,
      blocoEl,
      origLeft:  blocoEl.style.left,
      origWidth: blocoEl.style.width,
    };

    document.addEventListener('mousemove', _onResizeMove);
    document.addEventListener('mouseup',   _onResizeEnd);
  },
};

function _getAnyWrapper() {
  return document.querySelector('#gantt-tbody .bars-wrapper');
}

function _dayIdxFromX(x) {
  const wrapper = _getAnyWrapper();
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  const N = diasNoMes(ganttAno, ganttMes);
  return Math.max(0, Math.min(N - 1, Math.floor((x - rect.left) / rect.width * N)));
}

function _onResizeMove(e) {
  if (!_resize) return;
  _resize.ativo = true;
  document.body.style.cursor = _resize.lado === 'left' ? 'w-resize' : 'e-resize';

  const N = diasNoMes(ganttAno, ganttMes);
  const dayIdx = _dayIdxFromX(e.clientX);
  if (dayIdx === null) return;

  const bl = _resize.blocoEl;
  let iniStr, fimStr;

  if (_resize.lado === 'right') {
    const newRight = ((dayIdx + 1) / N * 100);
    const left = parseFloat(_resize.origLeft);
    const w = newRight - left;
    if (w > 0) bl.style.width = w.toFixed(4) + '%';
    iniStr = _resize.ag.data_inicio;
    const fim = new Date(ganttAno, ganttMes, dayIdx + 2);
    fimStr = `${fim.getFullYear()}-${String(fim.getMonth()+1).padStart(2,'0')}-${String(fim.getDate()).padStart(2,'0')}`;
  } else {
    const newLeft = (dayIdx / N * 100);
    const origRight = parseFloat(_resize.origLeft) + parseFloat(_resize.origWidth);
    const w = origRight - newLeft;
    if (w > 0) {
      bl.style.left  = newLeft.toFixed(4) + '%';
      bl.style.width = w.toFixed(4) + '%';
    }
    iniStr = _buildDataInicio(dayIdx);
    fimStr = _resize.ag.data_fim;
  }

  const { feriados } = getEstado();
  const ferSet = new Set(
    (feriados || [])
      .filter(f => !f.equipes_trabalham.includes(_resize.ag.equipe_id))
      .map(f => f.data)
  );
  const dias = contarDiasUteisJS(iniStr, fimStr, ferSet);
  const tipEl = document.getElementById('tooltip');
  tipEl.innerHTML = `<strong>${dias} dia${dias !== 1 ? 's' : ''}</strong>`;
  tipEl.style.display = 'block';
  let x = e.clientX + 16, y = e.clientY - 8;
  if (x + 240 > window.innerWidth)  x = e.clientX - 244;
  if (y + 140 > window.innerHeight) y = e.clientY - 144;
  tipEl.style.left = x + 'px';
  tipEl.style.top  = y + 'px';
}

async function _onResizeEnd(e) {
  document.removeEventListener('mousemove', _onResizeMove);
  document.removeEventListener('mouseup',   _onResizeEnd);
  document.body.style.cursor = '';

  if (!_resize) return;
  const resize = _resize;
  _resize = null;

  if (!resize.ativo) {
    // Clique na alça sem arrastar = clique no bloco (importante em ambientes de 1 dia)
    if (!window._modoAgendar) abrirModalEditarAgendamento(resize.agId);
    return;
  }

  const N = diasNoMes(ganttAno, ganttMes);
  const dayIdx = _dayIdxFromX(e.clientX);
  if (dayIdx === null) {
    resize.blocoEl.style.left  = resize.origLeft;
    resize.blocoEl.style.width = resize.origWidth;
    return;
  }

  const ag = resize.ag;
  let payload;

  if (resize.lado === 'right') {
    // Último dia inclusivo = dayIdx + 1 (base 1) → data_fim exclusiva = dayIdx + 2
    const fim = new Date(ganttAno, ganttMes, dayIdx + 2);
    const dataFimDireto = fim.toISOString().slice(0, 10);
    if (dataFimDireto <= ag.data_inicio) {
      resize.blocoEl.style.left  = resize.origLeft;
      resize.blocoEl.style.width = resize.origWidth;
      return;
    }
    payload = { equipe_id: ag.equipe_id, data_inicio: ag.data_inicio, data_fim_direto: dataFimDireto, status: ag.status, observacoes: ag.observacoes || '' };
  } else {
    // Borda esquerda: nova data_inicio = dayIdx
    const novaInicio = _buildDataInicio(dayIdx);
    if (novaInicio >= ag.data_fim) {
      resize.blocoEl.style.left  = resize.origLeft;
      resize.blocoEl.style.width = resize.origWidth;
      return;
    }
    payload = { equipe_id: ag.equipe_id, data_inicio: novaInicio, data_fim_direto: ag.data_fim, status: ag.status, observacoes: ag.observacoes || '' };
  }

  try {
    const res  = await API.agendamentos.atualizar(ag.id, payload);
    const data = await res.json();
    if (!res.ok) {
      resize.blocoEl.style.left  = resize.origLeft;
      resize.blocoEl.style.width = resize.origWidth;
      alert(data.error || 'Erro ao redimensionar.');
      return;
    }

    // Após resize da borda direita, perguntar se deseja cascatear agendamentos futuros
    if (resize.lado === 'right') {
      const oldFim  = ag.data_fim;
      const newFim  = payload.data_fim_direto;
      const deltaDias = _calcDeltaDias(newFim, oldFim);

      if (deltaDias !== 0) {
        const { equipes } = getEstado();
        const equipe   = equipes.find(e => e.id === ag.equipe_id);
        const nomeEq   = equipe ? equipe.nome : 'a equipe';
        const verbo    = deltaDias < 0 ? 'antecipar' : 'adiar';
        const diasAbs  = Math.abs(deltaDias);
        const plural   = diasAbs !== 1 ? 's' : '';
        const msg = `Deseja ${verbo} todos os agendamentos futuros de "${nomeEq}" em ${diasAbs} dia${plural}?`;

        if (confirm(msg)) {
          try {
            const res2  = await API.agendamentos.deslocarFuturos({
              equipe_id:       ag.equipe_id,
              data_referencia: oldFim,
              delta_dias:      deltaDias,
              excluir_id:      ag.id,
            });
            const data2 = await res2.json();
            if (!res2.ok) {
              alert(data2.error || 'Não foi possível deslocar os agendamentos futuros.');
            }
          } catch {
            alert('Erro ao deslocar agendamentos futuros.');
          }
        }
      }
    }

    await recarregar();
  } catch {
    resize.blocoEl.style.left  = resize.origLeft;
    resize.blocoEl.style.width = resize.origWidth;
    alert('Erro ao redimensionar.');
  }
}

function _calcDeltaDias(dataA, dataB) {
  // Retorna quantos dias corridos dataA está à frente de dataB (pode ser negativo)
  const [ya, ma, da] = dataA.split('-').map(Number);
  const [yb, mb, db] = dataB.split('-').map(Number);
  const msA = new Date(ya, ma - 1, da).getTime();
  const msB = new Date(yb, mb - 1, db).getTime();
  return Math.round((msA - msB) / 86400000);
}

// ── Tooltip ───────────────────────────────────────────────────────
window._ganttTooltip = {
  mostrar(e, el) {
    const d = JSON.parse(decodeURIComponent(el.dataset.tip));
    const { feriados } = getEstado();
    const ferSet = new Set(
      (feriados || [])
        .filter(f => !f.equipes_trabalham.includes(d.equipe_id))
        .map(f => f.data)
    );
    const dias = contarDiasUteisJS(d.ini_raw, d.fim_raw, ferSet);
    let html =
      `<strong>${d.cliente}</strong><br>` +
      `&#127968; ${d.ambiente} <span style="opacity:.6;font-size:11px">(${dias} dia${dias !== 1 ? 's' : ''})</span><br>` +
      `&#128119; ${d.equipe}<br>` +
      `&#128197; ${d.inicio} &rarr; ${d.fim}<br>` +
      `<span style="opacity:.75">${d.status}</span>`;
    if (d.tipo && d.tipo !== 'montagem') {
      html += `<br><span style="color:#faa">&#128295; Assistência</span>`;
    }
    if (d.valor != null) {
      html += `<br><span style="color:#4ade80;font-weight:600">${Number(d.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
    }
    if (d.obs) {
      html += `<br><span style="opacity:.6;font-size:11px">${d.obs}</span>`;
    }
    document.getElementById('tooltip').innerHTML = html;
    document.getElementById('tooltip').style.display = 'block';
    this.mover(e);
  },
  mover(e) {
    const tip = document.getElementById('tooltip');
    if (tip.style.display === 'none') return;
    let x = e.clientX + 16, y = e.clientY - 8;
    if (x + 240 > window.innerWidth)  x = e.clientX - 244;
    if (y + 140 > window.innerHeight) y = e.clientY - 144;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  },
  esconder() {
    document.getElementById('tooltip').style.display = 'none';
  },
};
