/**
 * servicos.js — Lógica de negócio de agendamentos.
 * Port direto de services/agendamentos.py do sistema original.
 *
 * Regras: domingos e feriados da equipe não contam como dia útil (sábado conta);
 * data_fim é EXCLUSIVA; agendamentos "Concluído" não geram conflito.
 */

import { db } from './store.js';

export const STATUS_VALIDOS = ['Agendado', 'Em andamento', 'Concluído', 'Aguardando Assistência'];

const MS_DIA = 86400000;

// Datas trabalhadas em UTC para não sofrer com horário de verão/fuso.
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmtISO(dt) { return dt.toISOString().slice(0, 10); }
export function somarDias(s, n) { return fmtISO(new Date(parseISO(s).getTime() + n * MS_DIA)); }

export function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fmtISO(parseISO(s)) === s;
}

const ehDomingo = (dt) => dt.getUTCDay() === 0;

export function calcularDataFim(dataInicio, duracaoDias, feriados = new Set()) {
  let current = parseISO(dataInicio);
  let contados = 0;
  while (contados < duracaoDias) {
    if (!ehDomingo(current) && !feriados.has(fmtISO(current))) contados++;
    if (contados < duracaoDias) current = new Date(current.getTime() + MS_DIA);
  }
  // current = último dia útil (inclusivo) → data_fim = +1 dia (exclusivo)
  return fmtISO(new Date(current.getTime() + MS_DIA));
}

export function contarDiasUteis(dataInicio, dataFim, feriados = new Set()) {
  let current = parseISO(dataInicio);
  const fim = parseISO(dataFim);
  let count = 0;
  while (current < fim) {
    if (!ehDomingo(current) && !feriados.has(fmtISO(current))) count++;
    current = new Date(current.getTime() + MS_DIA);
  }
  return Math.max(1, count);
}

/** Datas em que a equipe NÃO trabalha (feriados em que ela não está marcada como "trabalha"). */
export function carregarFeriadosEquipe(equipeId) {
  const trabalha = new Set(
    db.feriados_equipes.filter(fe => fe.equipe_id === equipeId).map(fe => fe.feriado_id)
  );
  return new Set(
    db.feriados.filter(f => f.loja_id === 1 && !trabalha.has(f.id)).map(f => f.data)
  );
}

export function verificarConflito(equipeId, dataInicio, dataFim, excluirId = null) {
  return db.agendamentos.some(a =>
    a.equipe_id === equipeId &&
    a.status !== 'Concluído' &&
    a.data_inicio < dataFim &&
    a.data_fim > dataInicio &&
    (excluirId === null || a.id !== excluirId)
  );
}

/** Retorna mensagem de erro (string) ou null se válido. */
export function validarDadosAgendamento(dados) {
  const ambienteId = dados.ambiente_id;
  const equipeId   = dados.equipe_id;
  const dataInicio = dados.data_inicio || '';
  const status     = dados.status ?? 'Agendado';

  if (!ambienteId || !equipeId || !dataInicio) {
    return 'Preencha todos os campos obrigatórios (ambiente, equipe, data).';
  }
  if (!dataValida(dataInicio)) {
    return `Data inválida: "${dataInicio}". Use o campo de data do formulário.`;
  }
  if (!STATUS_VALIDOS.includes(status)) {
    return `Status inválido: "${status}".`;
  }
  return null;
}
