/**
 * utils.js — Funções auxiliares reutilizadas por todo o frontend.
 * Não faz chamadas de API nem manipula o DOM de seções específicas.
 */

// ── Constantes de status ──────────────────────────────────────────
export const STATUS_COR = {
  'Agendado':                '#378ADD',
  'Em andamento':            '#EF9F27',
  'Concluído':               '#1D9E75',
  'Aguardando Assistência':  '#E55050',
};

export const STATUS_BADGE = {
  'Agendado':                'badge-agendado',
  'Em andamento':            'badge-em-andamento',
  'Concluído':               'badge-concluido',
  'Aguardando Assistência':  'badge-assistencia',
};

// ── Segurança: escapa HTML para evitar XSS ────────────────────────
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Helpers de data ───────────────────────────────────────────────

/**
 * Converte 'YYYY-MM-DD' em objeto Date sem desvio de fuso horário.
 */
export function parseData(str) {
  if (!str || typeof str !== 'string') return new Date(NaN);
  const parts = str.split('-');
  if (parts.length !== 3) return new Date(NaN);
  const [y, m, d] = parts.map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/**
 * Converte data_fim (exclusiva) para exibição no formato DD/MM/AAAA.
 * Subtrai 1 dia para mostrar o último dia inclusivo.
 */
export function formataBR(str) {
  const d = parseData(str);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('pt-BR');
}

/**
 * Converte 'YYYY-MM-DD' para 'DD/MM/AAAA' sem ajuste de exclusividade.
 */
export function inicioBR(str) {
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Retorna o nome do mês e ano no formato "março de 2026".
 */
export function nomeMes(ano, mes) {
  const s = new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Retorna o número de dias de um determinado mês.
 */
export function diasNoMes(ano, mes) {
  return new Date(ano, mes + 1, 0).getDate();
}

/**
 * Retorna o dia da semana (0 = domingo, 6 = sábado).
 */
export function diaDaSemana(ano, mes, dia) {
  return new Date(ano, mes, dia).getDay();
}

// ── Helper para requisições JSON ──────────────────────────────────
export function jsonReq(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
