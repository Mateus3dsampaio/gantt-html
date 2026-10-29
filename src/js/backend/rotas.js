/**
 * rotas.js — Substitui o servidor Flask.
 *
 * Intercepta window.fetch para URLs '/api/...' e responde com objetos Response
 * reais, no mesmo formato (JSON e códigos de status) das rotas originais em routes/*.py.
 * Assim o restante do frontend funciona sem alterações.
 */

import {
  db, meta, pagamentos, TABELAS, proximoId, commit, serializar, carregarObjeto, ErroConflito,
} from './store.js';
import {
  calcularDataFim, contarDiasUteis, carregarFeriadosEquipe, verificarConflito,
  validarDadosAgendamento, somarDias, dataValida,
} from './servicos.js';

const MESES_LABELS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const agora = () => new Date().toISOString().replace('T', ' ').replace('Z', '');
const cmp   = (a, b) => String(a).localeCompare(String(b), 'pt-BR');
const str   = (v) => (v == null ? '' : String(v)).trim();
const copia = (o) => ({ ...o });

/** Arredondamento do Python (metade para o par), igual ao round() do original. */
function pyRound(x) {
  const f = Math.floor(x), diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const ok    = (extra = {}, status = 200) => [status, { ok: true, ...extra }];
const erro  = (msg, status = 400)        => [status, { error: msg }];

// ── Equipes ───────────────────────────────────────────────────────
function equipesListar({ query }) {
  let rows = db.equipes;
  if (query.todas !== '1') rows = rows.filter(e => e.ativa === 1);
  return [200, rows.slice().sort((a, b) => cmp(a.nome, b.nome)).map(copia)];
}

function equipesCriar({ body }) {
  const nome = str(body.nome);
  const cor  = str(body.cor ?? '#3B82F6');
  const ativa = parseInt(body.ativa ?? 1, 10);
  if (!nome) return erro('Nome é obrigatório.');
  db.equipes.push({ id: proximoId('equipes'), loja_id: 1, nome, cor, ativa });
  return ok({}, 201);
}

function equipesAtualizar({ params, body }) {
  const nome = str(body.nome);
  const cor  = str(body.cor ?? '#3B82F6');
  const ativa = parseInt(body.ativa ?? 1, 10);
  if (!nome) return erro('Nome é obrigatório.');
  const e = db.equipes.find(x => x.id === params.id);
  if (e) { e.nome = nome; e.cor = cor; e.ativa = ativa; }
  return ok();
}

// ── Divisão de ambiente entre equipes ─────────────────────────────
// Cada equipe tem a sua própria linha em db.agendamentos; as cópias de um mesmo
// ambiente compartilham o mesmo grupo_id (sem grupo_id = agendamento só de uma equipe).
const grupoDe = (a) => a.grupo_id ?? a.id;
const membrosGrupo = (a) => db.agendamentos.filter(x => grupoDe(x) === grupoDe(a));

/** Parte do valor do ambiente que cabe a esta equipe (divisão igual entre as equipes do grupo). */
function valorDaEquipe(a, amb) {
  if (amb.valor == null) return amb.valor;
  return amb.valor / membrosGrupo(a).length;
}

function equipesResumoMes({ query }) {
  const hoje = new Date();
  const ano = parseInt(query.ano ?? hoje.getFullYear(), 10);
  const mes = parseInt(query.mes ?? (hoje.getMonth() + 1), 10);
  const mesInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const mesFim = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

  const equipes = db.equipes.filter(e => e.ativa === 1).sort((a, b) => cmp(a.nome, b.nome));
  const lookup = {};
  for (const ag of db.agendamentos) {
    if (!(ag.data_inicio < mesFim && ag.data_fim > mesInicio)) continue;
    if (!['Agendado', 'Em andamento', 'Concluído'].includes(ag.status)) continue;
    const amb = db.ambientes.find(a => a.id === ag.ambiente_id);
    if (!amb) continue;
    lookup[ag.equipe_id] ??= {};
    lookup[ag.equipe_id][ag.status] = (lookup[ag.equipe_id][ag.status] || 0) + (valorDaEquipe(ag, amb) || 0);
  }
  return [200, equipes.map(eq => {
    const t = lookup[eq.id] || {};
    return {
      id: eq.id, nome: eq.nome, cor: eq.cor,
      agendado: t['Agendado'] || 0,
      em_andamento: t['Em andamento'] || 0,
      concluido: t['Concluído'] || 0,
    };
  })];
}

function equipesExcluir({ params }) {
  const ativos = db.agendamentos.filter(a =>
    a.equipe_id === params.id && a.status !== 'Concluído' && db.ambientes.some(m => m.id === a.ambiente_id)
  ).length;
  if (ativos > 0) return erro('Equipe possui agendamentos ativos. Conclua-os antes de excluir.');
  if (db.agendamentos.some(a => a.equipe_id === params.id)) {
    return erro('Equipe possui agendamentos concluídos no histórico e não pode ser excluída. Desative-a em vez de excluir.');
  }
  db.equipes = db.equipes.filter(e => e.id !== params.id);
  db.feriados_equipes = db.feriados_equipes.filter(fe => fe.equipe_id !== params.id);
  return ok();
}

// ── Clientes ──────────────────────────────────────────────────────
function clientesListar() {
  const rows = db.clientes.slice().sort((a, b) => cmp(a.nome, b.nome)).map(c => {
    const ambs = db.ambientes.filter(a => a.cliente_id === c.id);
    return {
      ...c,
      total_ambientes: ambs.length,
      pendentes_ambientes: ambs.filter(a => ['pendente', 'aguardando_assistencia'].includes(a.status)).length,
    };
  });
  return [200, rows];
}

function clientesCriar({ body }) {
  const nome = str(body.nome);
  if (!nome) return erro('Nome é obrigatório.');
  const id = proximoId('clientes');
  db.clientes.push({
    id, loja_id: 1, nome, telefone: str(body.telefone), endereco: str(body.endereco),
    observacoes: str(body.observacoes), criado_em: agora(),
  });
  return ok({ id }, 201);
}

function clientesAtualizar({ params, body }) {
  const nome = str(body.nome);
  if (!nome) return erro('Nome é obrigatório.');
  const c = db.clientes.find(x => x.id === params.id);
  if (c) {
    c.nome = nome; c.telefone = str(body.telefone); c.endereco = str(body.endereco);
    c.observacoes = str(body.observacoes);
  }
  return ok();
}

function removerAmbientes(ids) {
  db.agendamentos = db.agendamentos.filter(a => !ids.has(a.ambiente_id));
  db.ambientes    = db.ambientes.filter(a => !ids.has(a.id));
}

function clientesExcluir({ params }) {
  const idsAmb = new Set(db.ambientes.filter(a => a.cliente_id === params.id).map(a => a.id));
  const ativos = db.agendamentos.filter(a => idsAmb.has(a.ambiente_id) && a.status !== 'Concluído').length;
  if (ativos > 0) return erro('Cliente possui agendamentos ativos.');
  removerAmbientes(idsAmb);                                   // ON DELETE CASCADE
  db.clientes = db.clientes.filter(c => c.id !== params.id);
  return ok();
}

// ── Ambientes ─────────────────────────────────────────────────────
function ambientesComCliente(filtro = () => true) {
  return db.ambientes
    .filter(filtro)
    .map(a => ({ ...a, cliente_nome: (db.clientes.find(c => c.id === a.cliente_id) || {}).nome }))
    .sort((a, b) => cmp(a.cliente_nome, b.cliente_nome) || cmp(a.nome, b.nome));
}

function ambientesListar({ query }) {
  const cid = query.cliente_id ? parseInt(query.cliente_id, 10) : null;
  const st  = query.status || null;
  return [200, ambientesComCliente(a => (cid === null || a.cliente_id === cid) && (!st || a.status === st))];
}

function ambientesPendentes() {
  const rows = ambientesComCliente(a => ['pendente', 'aguardando_assistencia'].includes(a.status));
  const grupos = new Map();
  for (const r of rows) {
    if (!grupos.has(r.cliente_id)) {
      grupos.set(r.cliente_id, { cliente_id: r.cliente_id, cliente_nome: r.cliente_nome, ambientes: [] });
    }
    grupos.get(r.cliente_id).ambientes.push(r);
  }
  return [200, [...grupos.values()]];
}

function ambientesCriar({ body }) {
  const clienteId = body.cliente_id;
  const nome = str(body.nome);
  let duracao = body.duracao_dias ?? 1;
  const observacoes = str(body.observacoes);
  let valor = body.valor ?? null;

  if (!clienteId || !nome) return erro('cliente_id e nome são obrigatórios.');
  duracao = parseInt(duracao, 10);
  if (!(duracao >= 1)) return erro('Duração deve ser ao menos 1 dia.');
  if (valor !== null) { valor = parseFloat(valor); if (isNaN(valor)) valor = null; }

  const id = proximoId('ambientes');
  db.ambientes.push({
    id, cliente_id: parseInt(clienteId, 10), nome, duracao_dias: duracao,
    status: 'pendente', observacoes, valor,
  });
  return ok({ id }, 201);
}

function ambientesCriarLote({ body }) {
  const clienteId = body.cliente_id;
  const lista = body.ambientes || [];
  if (!clienteId) return erro('cliente_id é obrigatório.');
  if (!lista.length) return erro('Informe ao menos um ambiente.');

  const ids = [];
  for (const amb of lista) {
    const nome = str(amb.nome);
    const dur  = parseInt(amb.duracao_dias ?? 1, 10);
    let valor  = amb.valor ?? null;
    if (!nome || !(dur >= 1)) continue;
    if (valor !== null) { valor = parseFloat(valor); if (isNaN(valor)) valor = null; }
    const id = proximoId('ambientes');
    db.ambientes.push({
      id, cliente_id: parseInt(clienteId, 10), nome, duracao_dias: dur,
      status: 'pendente', observacoes: '', valor,
    });
    ids.push(id);
  }
  return ok({ ids }, 201);
}

function ambientesAtualizar({ params, body }) {
  const campos = ['nome', 'duracao_dias', 'status', 'observacoes', 'valor'].filter(c => c in body);
  if (!campos.length) return erro('Nenhum campo para atualizar.');
  const a = db.ambientes.find(x => x.id === params.id);
  if (a) for (const c of campos) a[c] = body[c];
  return ok();
}

function ambientesExcluir({ params }) {
  const ativos = db.agendamentos.filter(a => a.ambiente_id === params.id && a.status !== 'Concluído').length;
  if (ativos > 0) return erro('Ambiente possui agendamento ativo. Conclua ou exclua o agendamento antes.');
  removerAmbientes(new Set([params.id]));
  return ok();
}

// ── Agendamentos ──────────────────────────────────────────────────
function agendamentosListar({ query }) {
  let rows = db.agendamentos;
  if (query.tipo) rows = rows.filter(a => a.tipo === query.tipo);
  const out = [];
  for (const a of rows) {
    const amb = db.ambientes.find(x => x.id === a.ambiente_id);
    const cli = amb && db.clientes.find(c => c.id === amb.cliente_id);
    const eq  = db.equipes.find(e => e.id === a.equipe_id);
    if (!amb || !cli || !eq) continue;                       // equivalente aos JOINs
    out.push({
      id: a.id, ambiente_id: a.ambiente_id, equipe_id: a.equipe_id, grupo_id: grupoDe(a),
      data_inicio: a.data_inicio, data_fim: a.data_fim, tipo: a.tipo, status: a.status,
      observacoes: a.observacoes, criado_em: a.criado_em,
      ambiente_nome: amb.nome, duracao_dias: amb.duracao_dias, valor: valorDaEquipe(a, amb), valor_total: amb.valor,
      cliente_id: amb.cliente_id, cliente_nome: cli.nome,
      equipe_nome: eq.nome, equipe_cor: eq.cor,
    });
  }
  out.sort((a, b) => cmp(a.data_inicio, b.data_inicio) || a.id - b.id);
  return [200, out];
}

function agendamentosCriar({ body }) {
  const err = validarDadosAgendamento(body);
  if (err) return erro(err);

  const ambienteId = parseInt(body.ambiente_id, 10);
  const equipeId   = parseInt(body.equipe_id, 10);
  const dataInicio = body.data_inicio;
  const tipo       = body.tipo ?? 'montagem';
  const observacoes = body.observacoes ?? '';

  const amb = db.ambientes.find(a => a.id === ambienteId);
  if (!amb) return erro('Ambiente não encontrado.', 404);

  const dataFim = calcularDataFim(dataInicio, amb.duracao_dias, carregarFeriadosEquipe(equipeId));
  if (verificarConflito(equipeId, dataInicio, dataFim)) {
    return erro('Esta equipe já possui agendamento nesse período.', 409);
  }

  const novoId = proximoId('agendamentos');
  db.agendamentos.push({
    id: novoId, grupo_id: novoId, ambiente_id: ambienteId, equipe_id: equipeId,
    data_inicio: dataInicio, data_fim: dataFim, tipo, status: 'Agendado',
    observacoes, criado_em: agora(),
  });
  amb.status = 'agendado';
  return ok({}, 201);
}

function agendamentosDeslocarFuturos({ body }) {
  const equipeId       = parseInt(body.equipe_id ?? 0, 10);
  const dataReferencia = body.data_referencia || '';
  const delta          = parseInt(body.delta_dias ?? 0, 10);
  const excluirId      = body.excluir_id ?? null;

  if (!equipeId || !dataReferencia || delta === 0) return erro('Parâmetros inválidos.');

  const rows = db.agendamentos.filter(a =>
    a.equipe_id === equipeId && a.data_inicio >= dataReferencia && a.status !== 'Concluído' &&
    (excluirId === null || a.id !== parseInt(excluirId, 10))
  );
  if (!rows.length) return ok({ deslocados: 0 });

  const idsGrupo = new Set(rows.map(r => r.id));
  if (excluirId !== null) idsGrupo.add(parseInt(excluirId, 10));

  const novos = [];
  for (const r of rows) {
    const novaIni = somarDias(r.data_inicio, delta);
    const novaFim = somarDias(r.data_fim, delta);
    if (novaIni >= novaFim) return erro(`Período inválido após deslocamento para agendamento #${r.id}.`);

    const conflitos = db.agendamentos.filter(a =>
      a.equipe_id === equipeId && a.status !== 'Concluído' &&
      a.data_inicio < novaFim && a.data_fim > novaIni && !idsGrupo.has(a.id)
    ).length;
    if (conflitos > 0) return erro('Não foi possível deslocar: haveria conflito de agendamentos.', 409);
    novos.push([r, novaIni, novaFim]);
  }
  for (const [r, ini, fim] of novos) { r.data_inicio = ini; r.data_fim = fim; }
  return ok({ deslocados: novos.length });
}

function agendamentosAtualizar({ params, body }) {
  const atual = db.agendamentos.find(a => a.id === params.id);
  if (!atual) return erro('Agendamento não encontrado.', 404);

  const equipeId      = parseInt(body.equipe_id ?? atual.equipe_id, 10);
  const dataInicio    = body.data_inicio ?? atual.data_inicio;
  const status        = body.status ?? atual.status;
  const tipo          = body.tipo ?? atual.tipo;
  const observacoes   = body.observacoes ?? atual.observacoes;
  const dataConclusao = body.data_conclusao || null;
  const dataFimDireto = body.data_fim_direto || null;
  const ambienteId    = atual.ambiente_id;
  let novaDuracao     = null;

  // Regra: apenas 1 "Em andamento" por equipe
  if (status === 'Em andamento') {
    const ja = db.agendamentos.filter(a =>
      a.equipe_id === equipeId && a.status === 'Em andamento' && a.id !== params.id).length;
    if (ja > 0) return erro('Esta equipe já possui um projeto Em andamento.');
  }

  // data_fim: 1) data_fim_direto (resize)  2) data_conclusao + 1 dia  3) recalcula pela duração
  const feriados = carregarFeriadosEquipe(equipeId);
  let dataFim;
  if (dataFimDireto) {
    if (dataFimDireto <= dataInicio) return erro('A data de término deve ser posterior à data de início.');
    dataFim = dataFimDireto;
    novaDuracao = contarDiasUteis(dataInicio, dataFim, feriados);
  } else if (status === 'Concluído' && dataConclusao) {
    if (dataConclusao < dataInicio) return erro('A data de conclusão não pode ser anterior à data de início.');
    dataFim = somarDias(dataConclusao, 1);
  } else {
    const amb = db.ambientes.find(a => a.id === ambienteId);
    dataFim = calcularDataFim(dataInicio, amb ? amb.duracao_dias : 1, feriados);
  }

  if (verificarConflito(equipeId, dataInicio, dataFim, params.id)) {
    return erro('Esta equipe já possui agendamento nesse período.', 409);
  }

  // Equipes que dividem o ambiente (cópias com o mesmo grupo_id)
  const outras = membrosGrupo(atual).filter(a => a.id !== atual.id);
  const extras = Array.isArray(body.equipes_extras)
    ? [...new Set(body.equipes_extras.map(n => parseInt(n, 10)))].filter(n => n && n !== equipeId)
    : outras.map(a => a.equipe_id);
  if (outras.some(a => a.equipe_id === equipeId) && !Array.isArray(body.equipes_extras)) {
    return erro('Esta equipe já faz parte deste ambiente.', 409);
  }
  const mantidas  = outras.filter(a => extras.includes(a.equipe_id));
  const removidas = outras.filter(a => !extras.includes(a.equipe_id));
  const novasEq   = extras.filter(id => !outras.some(a => a.equipe_id === id));

  const nomeEq = (id) => (db.equipes.find(e => e.id === id) || {}).nome || 'Equipe';
  const checarEquipe = (eqId, ignorarId) => {
    if (verificarConflito(eqId, dataInicio, dataFim, ignorarId)) {
      return erro(`A equipe ${nomeEq(eqId)} já possui agendamento nesse período.`, 409);
    }
    if (status === 'Em andamento' && db.agendamentos.some(a =>
      a.equipe_id === eqId && a.status === 'Em andamento' && a.id !== ignorarId)) {
      return erro(`A equipe ${nomeEq(eqId)} já possui um projeto Em andamento.`);
    }
    return null;
  };
  for (const m of mantidas) { const e = checarEquipe(m.equipe_id, m.id); if (e) return e; }
  for (const id of novasEq) {
    if (!db.equipes.some(e => e.id === id)) return erro('Equipe não encontrada.', 404);
    const e = checarEquipe(id, null); if (e) return e;
  }

  const grupoId = grupoDe(atual);
  Object.assign(atual, {
    equipe_id: equipeId, data_inicio: dataInicio, data_fim: dataFim,
    status, tipo, observacoes, grupo_id: grupoId,
  });
  // As cópias acompanham sempre o agendamento editado
  for (const m of mantidas) {
    Object.assign(m, { data_inicio: dataInicio, data_fim: dataFim, status, tipo, observacoes, grupo_id: grupoId });
  }
  const idsRemovidos = new Set(removidas.map(a => a.id));
  db.agendamentos = db.agendamentos.filter(a => !idsRemovidos.has(a.id));
  for (const id of novasEq) {
    db.agendamentos.push({
      id: proximoId('agendamentos'), grupo_id: grupoId, ambiente_id: ambienteId, equipe_id: id,
      data_inicio: dataInicio, data_fim: dataFim, tipo, status, observacoes, criado_em: agora(),
    });
  }

  const amb = db.ambientes.find(a => a.id === ambienteId);
  if (amb) {
    if (status === 'Concluído')                   amb.status = 'finalizado';
    else if (status === 'Aguardando Assistência') amb.status = 'aguardando_assistencia';
    else if (status === 'Em andamento')           amb.status = 'em_montagem';
    else if (status === 'Agendado')               amb.status = 'agendado';
    if (novaDuracao !== null) amb.duracao_dias = novaDuracao;
  }
  return ok();
}

function agendamentosExcluir({ params }) {
  const ag = db.agendamentos.find(a => a.id === params.id);
  if (ag) {
    const grupo = grupoDe(ag);
    db.agendamentos = db.agendamentos.filter(a => grupoDe(a) !== grupo);   // todas as equipes do ambiente
  }
  if (ag) {
    const amb = db.ambientes.find(a => a.id === ag.ambiente_id);
    if (amb) amb.status = 'pendente';
  }
  return ok();
}

// ── Feriados ──────────────────────────────────────────────────────
function feriadosListar() {
  const rows = db.feriados.filter(f => f.loja_id === 1).sort((a, b) => cmp(a.data, b.data));
  return [200, rows.map(f => ({
    id: f.id, data: f.data, nome: f.nome,
    equipes_trabalham: db.feriados_equipes.filter(fe => fe.feriado_id === f.id).map(fe => fe.equipe_id),
  }))];
}

function feriadosCriar({ body }) {
  const data = str(body.data), nome = str(body.nome);
  const equipes = body.equipes_trabalham || [];
  if (!data || !nome) return erro('Data e nome são obrigatórios.');
  if (db.feriados.some(f => f.loja_id === 1 && f.data === data)) return erro('Já existe um feriado nesta data.', 409);

  const id = proximoId('feriados');
  db.feriados.push({ id, loja_id: 1, data, nome });
  for (const eid of equipes) {
    const e = parseInt(eid, 10);
    if (!db.feriados_equipes.some(fe => fe.feriado_id === id && fe.equipe_id === e)) {
      db.feriados_equipes.push({ feriado_id: id, equipe_id: e });
    }
  }
  return ok({}, 201);
}

function feriadosAtualizar({ params, body }) {
  const data = str(body.data), nome = str(body.nome);
  const equipes = body.equipes_trabalham || [];
  if (!data || !nome) return erro('Data e nome são obrigatórios.');
  const f = db.feriados.find(x => x.id === params.id);
  if (!f) return erro('Feriado não encontrado.', 404);
  if (db.feriados.some(x => x.id !== f.id && x.loja_id === f.loja_id && x.data === data)) {
    return erro('Já existe um feriado nesta data.', 409);
  }
  f.data = data; f.nome = nome;
  db.feriados_equipes = db.feriados_equipes.filter(fe => fe.feriado_id !== params.id);
  for (const eid of equipes) {
    const e = parseInt(eid, 10);
    if (!db.feriados_equipes.some(fe => fe.feriado_id === params.id && fe.equipe_id === e)) {
      db.feriados_equipes.push({ feriado_id: params.id, equipe_id: e });
    }
  }
  return ok();
}

function feriadosExcluir({ params }) {
  db.feriados = db.feriados.filter(f => f.id !== params.id);
  db.feriados_equipes = db.feriados_equipes.filter(fe => fe.feriado_id !== params.id);
  return ok();
}

// ── Relatórios (dashboard) ────────────────────────────────────────
function relatoriosDashboard({ query }) {
  const hoje = new Date();
  const ano = parseInt(query.ano ?? hoje.getFullYear(), 10);
  let mesIni = parseInt(query.mes_ini ?? 1, 10);
  let mesFim = parseInt(query.mes_fim ?? 12, 10);
  if (mesIni > mesFim) [mesIni, mesFim] = [mesFim, mesIni];

  const equipes = db.equipes.filter(e => e.ativa === 1)
    .sort((a, b) => cmp(a.nome, b.nome)).map(e => ({ id: e.id, nome: e.nome, cor: e.cor }));

  // {equipe_id: {mes: {valor, dias}}} — mês de conclusão = data_fim - 1 dia
  const lookup = {};
  const concluidos = db.agendamentos.filter(a => a.status === 'Concluído').map(a => {
    const dia = somarDias(a.data_fim, -1);
    return { a, ano: parseInt(dia.slice(0, 4), 10), mes: parseInt(dia.slice(5, 7), 10) };
  }).sort((x, y) => x.mes - y.mes);
  for (const { a, ano: y, mes } of concluidos) {
    if (y !== ano || mes < mesIni || mes > mesFim) continue;
    const amb = db.ambientes.find(m => m.id === a.ambiente_id);
    if (!amb) continue;
    lookup[a.equipe_id] ??= {};
    const cel = (lookup[a.equipe_id][mes] ??= { valor: 0, dias: 0 });
    cel.valor += valorDaEquipe(a, amb) || 0;
    cel.dias  += amb.duracao_dias || 0;
  }

  const meses = [];
  for (let m = mesIni; m <= mesFim; m++) {
    const dados = {}, mediaDia = {};
    for (const eq of equipes) {
      const entry = (lookup[eq.id] || {})[m] || {};
      const valor = entry.valor || 0, dias = entry.dias || 0;
      dados[eq.id] = valor;
      mediaDia[eq.id] = dias > 0 ? pyRound(valor / dias) : null;
    }
    meses.push({ mes: m, label: MESES_LABELS[m - 1], dados, media_dia: mediaDia });
  }

  const numMeses = mesFim - mesIni + 1;
  const acumulado = equipes.map(eq => {
    const entradas = Object.entries(lookup[eq.id] || {}).map(([m, v]) => [parseInt(m, 10), v]);
    const total = entradas.reduce((s, [, v]) => s + v.valor, 0);
    const totalDias = entradas.reduce((s, [, v]) => s + v.dias, 0);
    let pico = null;
    for (const [m, v] of entradas) if (pico === null || v.valor > pico[1].valor) pico = [m, v];
    return {
      id: eq.id, nome: eq.nome, cor: eq.cor, total,
      media_mensal: numMeses ? pyRound(total / numMeses) : 0,
      media_dia: totalDias ? pyRound(total / totalDias) : 0,
      mes_pico: pico ? MESES_LABELS[pico[0] - 1] : '—',
    };
  }).sort((a, b) => b.total - a.total);

  let maior = null;
  for (const a of acumulado) if (maior === null || a.media_dia > maior.media_dia) maior = a;

  return [200, {
    equipes, meses, acumulado,
    kpis: {
      total_geral: acumulado.reduce((s, a) => s + a.total, 0),
      destaque: acumulado[0] || null,
      maior_media_dia: maior,
    },
  }];
}

// ── Pagamentos (comissões) ────────────────────────────────────────
// Regra: o que foi finalizado em um mês (último dia = data_fim - 1) é pago no mês seguinte.
// Não altera o dashboard, que continua baseado no mês de finalização.
const COMISSAO_PADRAO = 4;
const COMISSAO_RICARDO = 3;
const FUNCIONARIAS = [
  { chave: 'tayla', nome: 'Tayla', pct: 1.5 },
  { chave: 'bruna', nome: 'Bruna', pct: 1 },
];
const chaveMes = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}`;
const arred2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

function pctPadraoEquipe(eq) {
  return str(eq.nome).toLowerCase() === 'ricardo' ? COMISSAO_RICARDO : COMISSAO_PADRAO;
}

/** Concluídos de montagem agrupados pelo mês de PAGAMENTO ("AAAA-MM"). */
function concluidosPorMesPagamento() {
  const mapa = {};
  for (const a of db.agendamentos) {
    if (a.status !== 'Concluído' || (a.tipo && a.tipo !== 'montagem')) continue;
    const amb = db.ambientes.find(m => m.id === a.ambiente_id);
    if (!amb) continue;
    const dia = somarDias(a.data_fim, -1);
    let y = parseInt(dia.slice(0, 4), 10), m = parseInt(dia.slice(5, 7), 10) + 1;
    if (m > 12) { m = 1; y++; }
    const cli = db.clientes.find(c => c.id === amb.cliente_id);
    (mapa[chaveMes(y, m)] ??= []).push({
      agendamento_id: a.id, equipe_id: a.equipe_id, ambiente: amb.nome,
      cliente: cli ? cli.nome : '', valor: valorDaEquipe(a, amb) || 0, finalizado_em: dia,
    });
  }
  return mapa;
}

/** Comissão de cada equipe de montagem num mês de pagamento. */
function comissoesEquipes(chave, itens) {
  const ajustes = pagamentos.comissoes[chave] || {};
  return db.equipes.map(eq => {
    const padrao = pctPadraoEquipe(eq);
    const pct = ajustes[eq.id] ?? padrao;
    const ambientes = itens.filter(i => i.equipe_id === eq.id).map(i => {
      const pctAmb = pagamentos.ambientes[i.agendamento_id];
      const pctUsado = pctAmb ?? pct;
      return { ...i, pct_ambiente: pctAmb ?? null, pct_usado: pctUsado, comissao: arred2(i.valor * pctUsado / 100) };
    });
    return {
      equipe_id: eq.id, nome: eq.nome, cor: eq.cor, ativa: eq.ativa, pct, pct_padrao: padrao,
      pct_ajustado: ajustes[eq.id] != null,
      total_montado: arred2(ambientes.reduce((s, i) => s + i.valor, 0)),
      total_pagar: arred2(ambientes.reduce((s, i) => s + i.comissao, 0)),
      ambientes,
    };
  });
}

function pagamentosMes({ query }) {
  const hoje = new Date();
  const ano = parseInt(query.ano ?? hoje.getFullYear(), 10);
  const mes = parseInt(query.mes ?? hoje.getMonth() + 1, 10);
  const chave = chaveMes(ano, mes);
  const mapa = concluidosPorMesPagamento();

  const equipes = comissoesEquipes(chave, mapa[chave] || [])
    .filter(e => e.ativa === 1 || e.ambientes.length)
    .sort((a, b) => cmp(a.nome, b.nome));

  // Funcionárias: % sobre o total montado por todas as equipes (mesmo mês de referência)
  const baseTotal = arred2(equipes.reduce((s, e) => s + e.total_montado, 0));
  const ajustes = pagamentos.comissoes[chave] || {};
  const funcionarias = FUNCIONARIAS.map(f => {
    const pct = ajustes[f.chave] ?? f.pct;
    return {
      chave: f.chave, nome: f.nome, pct, pct_padrao: f.pct, pct_ajustado: ajustes[f.chave] != null,
      base: baseTotal, total_pagar: arred2(baseTotal * pct / 100),
    };
  });

  // Recorde de recebimento (só equipes de montagem), varrendo todos os meses
  const recordes = {};
  for (const [ch, itens] of Object.entries(mapa)) {
    for (const e of comissoesEquipes(ch, itens)) {
      if (!e.ambientes.length) continue;
      if (!recordes[e.equipe_id] || e.total_pagar > recordes[e.equipe_id].valor) {
        const [y, m] = ch.split('-').map(Number);
        recordes[e.equipe_id] = { valor: e.total_pagar, ano: y, mes: m, label: `${MESES_LABELS[m - 1]} ${y}` };
      }
    }
  }
  const referencia = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  return [200, {
    ano, mes, referencia, equipes, funcionarias, base_total: baseTotal,
    recordes: db.equipes.filter(e => e.ativa === 1).sort((a, b) => cmp(a.nome, b.nome))
      .map(e => ({ equipe_id: e.id, nome: e.nome, cor: e.cor, recorde: recordes[e.id] || null })),
    total_geral: arred2(equipes.reduce((s, e) => s + e.total_pagar, 0) + funcionarias.reduce((s, f) => s + f.total_pagar, 0)),
  }];
}

function lerPct(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return n;
}

/** Define (ou limpa, com pct vazio) a comissão de uma pessoa num mês de pagamento. */
function pagamentosComissao({ body }) {
  const chave = chaveMes(parseInt(body.ano, 10), parseInt(body.mes, 10));
  const quem = String(body.quem);
  const pct = lerPct(body.pct);
  if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) return erro('Percentual inválido.');
  const mesAj = (pagamentos.comissoes[chave] ??= {});
  if (pct === null) delete mesAj[quem]; else mesAj[quem] = pct;
  if (!Object.keys(mesAj).length) delete pagamentos.comissoes[chave];
  return ok();
}

/** Define (ou limpa) o % de um ambiente específico (agendamento). */
function pagamentosAmbiente({ body }) {
  const id = parseInt(body.agendamento_id, 10);
  const pct = lerPct(body.pct);
  if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) return erro('Percentual inválido.');
  if (pct === null) delete pagamentos.ambientes[id]; else pagamentos.ambientes[id] = pct;
  return ok();
}

// ── Configurações (backup) ────────────────────────────────────────
function settingsExport() {
  meta.ultimo_backup = new Date().toISOString();
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const nome = `backup_gantt_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
  return {
    resposta: new Response(JSON.stringify(serializar()), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename=${nome}` },
    }),
    gravar: true,
  };
}

function settingsImport({ body }) {
  if (body.version !== 1) return erro('Arquivo inválido ou versão de backup incompatível.');
  const antes = structuredClone({ db, meta, pagamentos });
  try {
    const novo = { ...body, meta: { ultimo_backup: meta.ultimo_backup } };   // restaurar não conta como backup
    carregarObjeto(novo);
  } catch (e) {
    for (const t of TABELAS) db[t] = antes.db[t];
    meta.ultimo_backup = antes.meta.ultimo_backup;
    pagamentos.comissoes = antes.pagamentos.comissoes;
    pagamentos.ambientes = antes.pagamentos.ambientes;
    return erro(`Erro ao importar dados: ${e.message}`, 500);
  }
  return ok();
}

// ── Tabela de rotas ───────────────────────────────────────────────
const ROTAS = [
  ['GET',    /^\/api\/equipes$/,                       equipesListar],
  ['POST',   /^\/api\/equipes$/,                       equipesCriar],
  ['GET',    /^\/api\/equipes\/resumo-mes$/,           equipesResumoMes],
  ['PUT',    /^\/api\/equipes\/(\d+)$/,                equipesAtualizar],
  ['DELETE', /^\/api\/equipes\/(\d+)$/,                equipesExcluir],

  ['GET',    /^\/api\/clientes$/,                      clientesListar],
  ['POST',   /^\/api\/clientes$/,                      clientesCriar],
  ['PUT',    /^\/api\/clientes\/(\d+)$/,               clientesAtualizar],
  ['DELETE', /^\/api\/clientes\/(\d+)$/,               clientesExcluir],

  ['GET',    /^\/api\/ambientes$/,                     ambientesListar],
  ['GET',    /^\/api\/ambientes\/pendentes$/,          ambientesPendentes],
  ['POST',   /^\/api\/ambientes$/,                     ambientesCriar],
  ['POST',   /^\/api\/ambientes\/lote$/,               ambientesCriarLote],
  ['PUT',    /^\/api\/ambientes\/(\d+)$/,              ambientesAtualizar],
  ['DELETE', /^\/api\/ambientes\/(\d+)$/,              ambientesExcluir],

  ['GET',    /^\/api\/agendamentos$/,                  agendamentosListar],
  ['POST',   /^\/api\/agendamentos$/,                  agendamentosCriar],
  ['POST',   /^\/api\/agendamentos\/deslocar-futuros$/, agendamentosDeslocarFuturos],
  ['PUT',    /^\/api\/agendamentos\/(\d+)$/,           agendamentosAtualizar],
  ['DELETE', /^\/api\/agendamentos\/(\d+)$/,           agendamentosExcluir],

  ['GET',    /^\/api\/feriados$/,                      feriadosListar],
  ['POST',   /^\/api\/feriados$/,                      feriadosCriar],
  ['PUT',    /^\/api\/feriados\/(\d+)$/,               feriadosAtualizar],
  ['DELETE', /^\/api\/feriados\/(\d+)$/,               feriadosExcluir],

  ['GET',    /^\/api\/relatorios\/dashboard$/,         relatoriosDashboard],

  ['GET',    /^\/api\/pagamentos$/,                    pagamentosMes],
  ['PUT',    /^\/api\/pagamentos\/comissao$/,          pagamentosComissao],
  ['PUT',    /^\/api\/pagamentos\/ambiente$/,          pagamentosAmbiente],

  ['GET',    /^\/api\/settings\/export$/,            settingsExport],
  ['POST',   /^\/api\/settings\/import$/,              settingsImport],
];

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

async function despachar(url, opts = {}) {
  const metodo = (opts.method || 'GET').toUpperCase();
  const u = new URL(url, 'http://local');
  const caminho = u.pathname.replace(/\/+$/, '');
  const query = Object.fromEntries(u.searchParams.entries());

  for (const [m, re, handler] of ROTAS) {
    if (m !== metodo) continue;
    const mt = caminho.match(re);
    if (!mt) continue;

    let body = {};
    if (opts.body) { try { body = JSON.parse(opts.body) || {}; } catch { body = {}; } }
    const params = { id: mt[1] !== undefined ? parseInt(mt[1], 10) : null };

    try {
      const r = handler({ params, query, body });
      if (r && r.resposta) {                                   // export: devolve Response pronta
        if (r.gravar) await commit();
        return r.resposta;
      }
      const [status, obj] = r;
      if (metodo !== 'GET' && status < 400) await commit();
      return jsonResponse(status, obj);
    } catch (e) {
      if (e instanceof ErroConflito) return jsonResponse(409, { error: e.message });
      console.error('Erro na rota', metodo, caminho, e);
      return jsonResponse(500, { error: e.message || 'Erro interno.' });
    }
  }
  return jsonResponse(404, { error: 'Rota não encontrada.' });
}

/** Instala o "servidor" local: intercepta fetch('/api/...'). */
export function instalarRotas() {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, opts) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('/api/')) return despachar(url, opts || {});
    return fetchOriginal(input, opts);
  };
}
