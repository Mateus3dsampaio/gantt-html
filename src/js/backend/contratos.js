/**
 * backend/contratos.js — Leitura de contrato em PDF (modelo Italínea / AMJ), no navegador.
 *
 * Só extrai: nome, telefone e endereço do cliente + ambientes (nome e valor).
 * CPF, RG, e-mail, nº do contrato, prazo e data são ignorados de propósito.
 * Usa a posição (x) das palavras no PDF, então não depende do nº de páginas.
 *
 * Depende do pdf.js (window.pdfjsLib, embutido pelo build.js).
 */

const MONEY = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;

// Limites (em pontos) das colunas da tabela PRODUTOS ITALÍNEA
const X_ITEM_MAX  = 70;
const X_DESC_MIN  = 90;
const X_DESC_MAX  = 345;
const X_VALOR_MIN = 480;

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const brl  = (s) => parseFloat(s.replace(/\./g, '').replace(',', '.'));

// ── pdf.js → palavras com posição ─────────────────────────────────

let _workerPronto = false;
function prepararWorker(pdfjsLib) {
  if (_workerPronto) return;
  // O worker vem embutido no HTML (<script type="text/plain" id="pdf-worker-src">),
  // para funcionar offline e via file://
  const el = typeof document !== 'undefined' && document.getElementById('pdf-worker-src');
  if (el) {
    const blob = new Blob([el.textContent], { type: 'text/javascript' });
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  }
  _workerPronto = true;
}

async function palavrasDaPagina(page) {
  const altura = page.view[3];
  const conteudo = await page.getTextContent();
  const words = [];
  for (const it of conteudo.items) {
    if (!it.str || !it.str.trim()) continue;
    const x0 = it.transform[4];
    const top = altura - it.transform[5];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(it.str))) {
      words.push({
        text: m[0],
        x0: x0 + it.width * (m.index / it.str.length),
        top,
      });
    }
  }
  return words;
}

/** Agrupa as palavras em linhas (tolerância vertical de 3pt). */
function linhasDe(words) {
  const ord = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const linhas = [];
  for (const w of ord) {
    const ult = linhas[linhas.length - 1];
    if (ult && Math.abs(ult.top - w.top) <= 3) ult.words.push(w);
    else linhas.push({ top: w.top, words: [w] });
  }
  for (const ln of linhas) ln.words.sort((a, b) => a.x0 - b.x0);
  return linhas;
}

// ── helpers de linha ──────────────────────────────────────────────

function achar(linhas, obrigatorias, inicio = 0) {
  for (let i = inicio; i < linhas.length; i++) {
    const textos = new Set(linhas[i].words.map(w => norm(w.text)));
    if (obrigatorias.every(o => textos.has(o))) return i;
  }
  return null;
}

function xDe(linha, palavra) {
  const w = linha.words.find(w => norm(w.text) === palavra);
  return w ? w.x0 : null;
}

function fatia(linha, xIni, xFim = null) {
  return linha.words
    .filter(w => w.x0 >= xIni - 3 && (xFim === null || w.x0 < xFim - 3))
    .map(w => w.text).join(' ').trim();
}

// ── extração ──────────────────────────────────────────────────────

function extrairCliente(linhas) {
  const cliente = { nome: '', telefone: '', endereco: '' };

  let i = achar(linhas, ['CLIENTE', 'TIPO']);
  if (i !== null && i + 1 < linhas.length) {
    cliente.nome = fatia(linhas[i + 1], xDe(linhas[i], 'CLIENTE'), xDe(linhas[i], 'TIPO'));
  }

  i = achar(linhas, ['TELEFONE', 'E-MAIL']);
  if (i !== null && i + 1 < linhas.length) {
    cliente.telefone = fatia(linhas[i + 1], xDe(linhas[i], 'TELEFONE'), xDe(linhas[i], 'E-MAIL'));
  }

  i = achar(linhas, ['ENDERECO', 'ATUAL']);
  if (i !== null && i + 1 < linhas.length) {
    let textos = linhas[i + 1].words.map(w => w.text);
    // 1ª coluna é o tipo (RUA/AVENIDA...); some se vier repetido no logradouro
    if (textos.length > 1 && textos[0].toLowerCase() === textos[1].toLowerCase()) textos = textos.slice(1);
    const rua = textos.join(' ');

    const j = achar(linhas, ['BAIRRO', 'CIDADE', 'UF', 'CEP'], i + 1);
    let bairro = '', cidade = '', uf = '';
    if (j !== null && j + 1 < linhas.length) {
      const h = linhas[j], v = linhas[j + 1];
      bairro = fatia(v, xDe(h, 'BAIRRO'), xDe(h, 'CIDADE'));
      cidade = fatia(v, xDe(h, 'CIDADE'), xDe(h, 'UF'));
      uf     = fatia(v, xDe(h, 'UF'),     xDe(h, 'CEP'));
    }

    let endereco = [rua, bairro, cidade].filter(Boolean).join(', ');
    if (uf) endereco += ` - ${uf}`;
    cliente.endereco = endereco;
  }

  return cliente;
}

/** `paginas` = linhas de cada página, na ordem. */
function extrairAmbientes(paginas) {
  const ambientes = [];
  let dentro = false;

  for (const linhas of paginas) {
    let ultimaTop = null;
    for (const ln of linhas) {
      const textos = new Set(ln.words.map(w => norm(w.text)));

      if (textos.has('CARACTERISTICAS')) return ambientes;
      if (textos.has('ITEM') && textos.has('QTD')) { dentro = true; continue; }
      if (!dentro) continue;

      const ws = ln.words;
      const primeira = ws[0], ultima = ws[ws.length - 1];
      const ehItem = primeira.x0 < X_ITEM_MAX && /^\d+$/.test(primeira.text)
        && ultima.x0 >= X_VALOR_MIN && MONEY.test(ultima.text);
      const descricao = ws.filter(w => w.x0 >= X_DESC_MIN && w.x0 < X_DESC_MAX)
        .map(w => w.text).join(' ');

      if (ehItem) {
        ambientes.push({ nome: descricao, valor: brl(ultima.text) });
        ultimaTop = ln.top;
      } else if (ambientes.length && ultimaTop !== null && ln.top - ultimaTop <= 25 && descricao) {
        // continuação do nome quebrado em 2 linhas
        ambientes[ambientes.length - 1].nome += ' ' + descricao;
        ultimaTop = ln.top;
      }
    }
  }
  return ambientes;
}

function extrairTotal(paginas) {
  for (const linhas of paginas) {
    for (const ln of linhas) {
      const texto = ln.words.map(w => w.text).join(' ');
      if (norm(texto).includes('VALOR TOTAL DOS AMBIENTES')) {
        const achados = texto.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
        if (achados) return brl(achados[achados.length - 1]);
      }
    }
  }
  return null;
}

/**
 * Lê o contrato (ArrayBuffer/Uint8Array) e devolve:
 * { cliente: {nome, telefone, endereco}, ambientes: [{nome, valor}],
 *   total, soma, soma_confere }
 * Lança Error (mensagem em português) se não for um contrato no modelo esperado.
 */
export async function lerContrato(dados, pdfjsLib = window.pdfjsLib) {
  if (!pdfjsLib) throw new Error('Leitor de PDF não carregado.');
  prepararWorker(pdfjsLib);

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(dados) }).promise;
  } catch {
    throw new Error('Não foi possível abrir o arquivo como PDF.');
  }

  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    paginas.push(linhasDe(await palavrasDaPagina(await pdf.getPage(n))));
  }

  const cliente   = extrairCliente(paginas[0] || []);
  const ambientes = extrairAmbientes(paginas);
  const total     = extrairTotal(paginas);

  if (!cliente.nome || !ambientes.length) {
    throw new Error('Não encontrei cliente e ambientes. Este PDF é um contrato no modelo esperado?');
  }

  const soma = Math.round(ambientes.reduce((s, a) => s + a.valor, 0) * 100) / 100;
  return {
    cliente, ambientes, total, soma,
    soma_confere: total !== null && Math.abs(soma - total) < 0.01,
  };
}
