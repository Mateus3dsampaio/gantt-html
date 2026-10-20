/**
 * store.js — "Banco de dados" em memória + persistência.
 *
 * Substitui o PostgreSQL do sistema original.
 *  - Fonte principal: arquivo dados.json (File System Access API — Chrome/Edge),
 *    que fica na pasta do OneDrive e é compartilhado entre os computadores.
 *  - Cópia de segurança: localStorage do navegador (a cada gravação).
 *  - Nunca sobrescreve o arquivo se ele foi alterado por outra pessoa:
 *    nesse caso recarrega os dados do arquivo e avisa.
 */

export const TABELAS = ['equipes', 'clientes', 'ambientes', 'feriados', 'feriados_equipes', 'agendamentos'];
const COM_ID = ['equipes', 'clientes', 'ambientes', 'feriados', 'agendamentos'];

const CHAVE_CACHE = 'gantt_dados_cache';
const IDB_NOME    = 'gantt_html';
const IDB_STORE   = 'handles';

export const db   = { equipes: [], clientes: [], ambientes: [], feriados: [], feriados_equipes: [], agendamentos: [] };
export const meta = { ultimo_backup: null };
// Ajustes de pagamento: comissões por mês/pessoa e % por ambiente (agendamento)
export const pagamentos = { comissoes: {}, ambientes: {} };
let seq = {};

let handle        = null;   // FileSystemFileHandle do dados.json
let ultimaMod     = 0;      // lastModified do arquivo na última leitura/gravação nossa
let ultimoTexto   = '';     // conteúdo da última leitura/gravação nossa
let fila          = Promise.resolve();
let nomeArquivo   = '';

export class ErroConflito extends Error {}

// ── Ids autoincrementais ──────────────────────────────────────────
export function proximoId(tabela) {
  const id = seq[tabela] || 1;
  seq[tabela] = id + 1;
  return id;
}

function recalcularSeq(seqSalvo = {}) {
  for (const t of COM_ID) {
    const maxId = db[t].reduce((m, r) => Math.max(m, r.id), 0);
    seq[t] = Math.max(maxId + 1, Number(seqSalvo[t]) || 1);
  }
}

// ── Serialização ──────────────────────────────────────────────────
export function serializar() {
  const obj = { version: 1, exported_at: new Date().toISOString(), meta, seq };
  for (const t of TABELAS) obj[t] = db[t];
  obj.pagamentos = pagamentos;
  return obj;
}

/** Substitui todo o conteúdo do banco por um objeto no formato de backup (version 1). */
export function carregarObjeto(obj) {
  if (!obj || obj.version !== 1) throw new Error('Arquivo inválido ou versão de backup incompatível.');
  for (const t of TABELAS) db[t] = Array.isArray(obj[t]) ? obj[t] : [];
  for (const r of db.equipes) { r.loja_id = r.loja_id ?? 1; r.ativa = r.ativa ?? 1; }
  meta.ultimo_backup = obj.meta?.ultimo_backup ?? null;
  pagamentos.comissoes = obj.pagamentos?.comissoes ?? {};
  pagamentos.ambientes = obj.pagamentos?.ambientes ?? {};
  recalcularSeq(obj.seq);
}

function dadosVazios() {
  return { version: 1, meta: { ultimo_backup: null }, equipes: [], clientes: [], ambientes: [],
           feriados: [], feriados_equipes: [], agendamentos: [],
           pagamentos: { comissoes: {}, ambientes: {} } };
}

// ── Indicador de status (barra lateral) ───────────────────────────
function elStatus() {
  let el = document.getElementById('save-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-status';
    const nav = document.getElementById('sidebar');
    const toggle = nav && nav.querySelector('.theme-toggle');
    if (nav) nav.insertBefore(el, toggle || null);
  }
  return el;
}

function textoBackup() {
  if (!meta.ultimo_backup) return { txt: 'Backup: nunca feito', alerta: true };
  const dias = Math.floor((Date.now() - new Date(meta.ultimo_backup).getTime()) / 86400000);
  if (dias <= 0) return { txt: 'Backup: hoje', alerta: false };
  return { txt: `Backup: há ${dias} dia${dias > 1 ? 's' : ''}`, alerta: dias > 7 };
}

export function mostrarStatus(estado, detalhe = '') {
  const el = elStatus();
  const b  = textoBackup();
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  let linha1;
  if (estado === 'salvando')      linha1 = '⏳ Salvando…';
  else if (estado === 'erro')     linha1 = `⚠️ ${detalhe || 'Erro ao salvar'}`;
  else if (handle)                linha1 = `✓ Salvo em ${nomeArquivo} às ${hora}`;
  else                            linha1 = `✓ Salvo só neste navegador às ${hora}`;
  el.className = estado === 'erro' ? 'save-status save-status--erro' : 'save-status';
  el.innerHTML = `<div>${linha1}</div><div class="${b.alerta ? 'save-status-alerta' : ''}">${b.txt}</div>`;
}

// ── IndexedDB: guarda o handle do arquivo entre sessões ───────────
function abrirIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NOME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function idbGet(chave) {
  try {
    const idb = await abrirIDB();
    return await new Promise((res, rej) => {
      const r = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(chave);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  } catch { return undefined; }
}
async function idbSet(chave, valor) {
  try {
    const idb = await abrirIDB();
    await new Promise((res, rej) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(valor, chave);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { /* sem persistência do handle: pedirá o arquivo de novo */ }
}

// ── Leitura / gravação do arquivo ─────────────────────────────────
async function lerArquivo() {
  const f = await handle.getFile();
  const texto = await f.text();
  ultimaMod = f.lastModified;
  ultimoTexto = texto;
  nomeArquivo = handle.name;
  if (!texto.trim()) {
    carregarObjeto(dadosVazios());
    await gravarArquivo(true);
  } else {
    carregarObjeto(JSON.parse(texto));
  }
}

async function gravarArquivo(ignorarConflito = false) {
  const f = await handle.getFile();
  if (!ignorarConflito && f.lastModified !== ultimaMod) {
    const textoAtual = await f.text();
    if (textoAtual !== ultimoTexto) throw new ErroConflito();
    ultimaMod = f.lastModified;
  }
  const texto = JSON.stringify(serializar());
  const w = await handle.createWritable();
  await w.write(texto);
  await w.close();
  ultimaMod   = (await handle.getFile()).lastModified;
  ultimoTexto = texto;
}

function gravarCache() {
  try { localStorage.setItem(CHAVE_CACHE, JSON.stringify(serializar())); } catch { /* ignora */ }
}

/** Persiste o estado atual. Chamado após cada alteração. */
export function commit() {
  fila = fila.then(async () => {
    mostrarStatus('salvando');
    gravarCache();
    if (handle) {
      try {
        await gravarArquivo();
      } catch (e) {
        if (e instanceof ErroConflito) {
          await recarregarDoArquivo();
          mostrarStatus('ok');
          throw new ErroConflito('O arquivo de dados foi alterado em outro lugar (outra pessoa ou computador). ' +
            'Os dados foram recarregados do arquivo e a sua última alteração NÃO foi salva. Refaça a alteração.');
        }
        mostrarStatus('erro', 'Não foi possível salvar no arquivo');
        throw new Error('Não foi possível gravar no arquivo de dados: ' + e.message);
      }
    }
    mostrarStatus('ok');
  });
  const resultado = fila;
  fila = fila.catch(() => {});
  return resultado;
}

async function recarregarDoArquivo() {
  await lerArquivo();
  gravarCache();
  window.dispatchEvent(new CustomEvent('gantt:dados-recarregados'));
}

/** Ao voltar para a aba, confere se outra pessoa alterou o arquivo. */
function observarMudancasExternas() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !handle) return;
    await fila;
    try {
      const f = await handle.getFile();
      if (f.lastModified === ultimaMod) return;
      const texto = await f.text();
      if (texto === ultimoTexto) { ultimaMod = f.lastModified; return; }
      await recarregarDoArquivo();
      mostrarStatus('ok');
    } catch { /* ignora: tenta de novo no próximo foco */ }
  });
}

// ── Tela de abertura (escolha do arquivo) ─────────────────────────
function telaAbertura({ titulo, texto, botoes }) {
  let ov = document.getElementById('boot-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'boot-overlay';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `
    <div class="boot-card">
      <h2>${titulo}</h2>
      <p>${texto}</p>
      <div class="boot-botoes"></div>
      <div class="boot-erro" id="boot-erro"></div>
    </div>`;
  const cont = ov.querySelector('.boot-botoes');
  botoes.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.primario ? 'btn-primary' : '');
    btn.textContent = b.rotulo;
    btn.onclick = async () => {
      try { await b.acao(); }
      catch (e) {
        if (e && e.name === 'AbortError') return;   // usuário cancelou o seletor
        document.getElementById('boot-erro').textContent = 'Erro: ' + (e.message || e);
      }
    };
    cont.appendChild(btn);
  });
}
function fecharAbertura() {
  const ov = document.getElementById('boot-overlay');
  if (ov) ov.remove();
}

const TIPOS_JSON = [{ description: 'Dados do Gantt (JSON)', accept: { 'application/json': ['.json'] } }];
const suportaArquivo = () => 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

/**
 * Inicializa o armazenamento. Só resolve quando os dados estiverem carregados.
 */
export function iniciar() {
  return new Promise(async (resolve) => {
    const concluir = () => { fecharAbertura(); observarMudancasExternas(); mostrarStatus('ok'); resolve(); };

    async function usarHandle(h) {
      handle = h;
      await idbSet('dados', h);
      await lerArquivo();
      gravarCache();
      concluir();
    }

    function usarSoNavegador() {
      handle = null;
      let obj = null;
      try { obj = JSON.parse(localStorage.getItem(CHAVE_CACHE) || 'null'); } catch { /* ignora */ }
      carregarObjeto(obj || dadosVazios());
      concluir();
    }

    function opcoesEscolha(textoExtra = '') {
      const botoes = [];
      if (suportaArquivo()) {
        botoes.push({ rotulo: '📂 Abrir o arquivo dados.json', primario: true, acao: async () => {
          const [h] = await window.showOpenFilePicker({ types: TIPOS_JSON, multiple: false });
          await usarHandle(h);
        }});
        botoes.push({ rotulo: '🆕 Criar um novo arquivo de dados', acao: async () => {
          const h = await window.showSaveFilePicker({ suggestedName: 'dados.json', types: TIPOS_JSON });
          await usarHandle(h);
        }});
      }
      botoes.push({ rotulo: 'Usar só neste navegador (sem arquivo)', acao: async () => usarSoNavegador() });
      telaAbertura({
        titulo: 'Agenda de Montagem',
        texto: (suportaArquivo()
          ? 'Escolha o arquivo <strong>dados.json</strong> (na pasta do OneDrive). Todas as alterações serão salvas nele automaticamente.'
          : 'Este navegador não permite salvar em arquivo. Use o <strong>Chrome</strong> ou o <strong>Edge</strong> para salvar no dados.json. ' +
            'Você pode continuar usando só neste navegador, mas os dados não serão compartilhados.') + textoExtra,
        botoes,
      });
    }

    // Já tem um arquivo lembrado de outra sessão?
    const salvo = suportaArquivo() ? await idbGet('dados') : undefined;
    if (salvo) {
      let perm = 'prompt';
      try { perm = await salvo.queryPermission({ mode: 'readwrite' }); } catch { /* ignora */ }
      if (perm === 'granted') {
        try { await usarHandle(salvo); return; } catch { /* cai para a tela */ }
      }
      telaAbertura({
        titulo: 'Agenda de Montagem',
        texto: `Clique para continuar usando o arquivo <strong>${salvo.name}</strong>.`,
        botoes: [
          { rotulo: '▶ Continuar', primario: true, acao: async () => {
            const p = await salvo.requestPermission({ mode: 'readwrite' });
            if (p !== 'granted') throw new Error('Permissão negada. Clique novamente e escolha "Permitir".');
            await usarHandle(salvo);
          }},
          { rotulo: 'Escolher outro arquivo', acao: async () => opcoesEscolha() },
        ],
      });
      return;
    }
    opcoesEscolha();
  });
}
