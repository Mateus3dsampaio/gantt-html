/**
 * api.js — Todas as chamadas ao servidor (fetch).
 *
 * Centralizar aqui significa que se a URL de uma rota mudar,
 * você altera em um único lugar.
 */

import { jsonReq } from './utils.js';

// ── Equipes ───────────────────────────────────────────────────────
export const API = {

  equipes: {
    listar:     ()           => fetch('/api/equipes/').then(r => r.json()),
    criar:      (dados)      => fetch('/api/equipes/',    jsonReq('POST', dados)),
    atualizar:  (id, dados)  => fetch(`/api/equipes/${id}`, jsonReq('PUT', dados)),
    excluir:    (id)         => fetch(`/api/equipes/${id}`, { method: 'DELETE' }),
    resumoMes:  (ano, mes)   => fetch(`/api/equipes/resumo-mes?ano=${ano}&mes=${mes}`).then(r => r.json()),
  },

  clientes: {
    listar:    ()        => fetch('/api/clientes/').then(r => r.json()),
    criar:     (dados)   => fetch('/api/clientes/',    jsonReq('POST',   dados)),
    atualizar: (id, dados) => fetch(`/api/clientes/${id}`, jsonReq('PUT', dados)),
    excluir:   (id)      => fetch(`/api/clientes/${id}`,   { method: 'DELETE' }),
  },

  agendamentos: {
    listar:          ()           => fetch('/api/agendamentos/').then(r => r.json()),
    criar:           (dados)      => fetch('/api/agendamentos/',    jsonReq('POST',   dados)),
    atualizar:       (id, dados)  => fetch(`/api/agendamentos/${id}`, jsonReq('PUT', dados)),
    excluir:         (id)         => fetch(`/api/agendamentos/${id}`,   { method: 'DELETE' }),
    deslocarFuturos: (dados)      => fetch('/api/agendamentos/deslocar-futuros', jsonReq('POST', dados)),
  },

  relatorios: {
    dashboard: (ano, mesIni, mesFim) =>
      fetch(`/api/relatorios/dashboard?ano=${ano}&mes_ini=${mesIni}&mes_fim=${mesFim}`).then(r => r.json()),
  },

  feriados: {
    listar:    ()           => fetch('/api/feriados/').then(r => r.json()),
    criar:     (dados)      => fetch('/api/feriados/',      jsonReq('POST', dados)),
    atualizar: (id, dados)  => fetch(`/api/feriados/${id}`, jsonReq('PUT',  dados)),
    excluir:   (id)         => fetch(`/api/feriados/${id}`, { method: 'DELETE' }),
  },

  ambientes: {
    listar:        ()          => fetch('/api/ambientes/').then(r => r.json()),
    pendentes:     ()          => fetch('/api/ambientes/pendentes').then(r => r.json()),
    criar:         (dados)     => fetch('/api/ambientes/', jsonReq('POST', dados)),
    criarLote:     (dados)     => fetch('/api/ambientes/lote', jsonReq('POST', dados)),
    atualizar:     (id, dados) => fetch(`/api/ambientes/${id}`, jsonReq('PUT', dados)),
    excluir:       (id)        => fetch(`/api/ambientes/${id}`, { method: 'DELETE' }),
  },
};
