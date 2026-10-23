// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/filtros/__tests__/*.test.mjs
//
// Hooks renderizados com react-dom/server: a PRIMEIRA renderização é o que
// importa para "sem flash / sem consulta duplicada" -- o valor que a tela
// vê no primeiro render é o que a primeira consulta usa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { criarPersistenciaFiltros, persistenciaFiltros } from '../persistenciaFiltros.js';
import { useFiltrosPersistidos, useSanearFiltros } from '../useFiltrosPersistidos.js';
import { useOrdenacao } from '../../ordenacao/useOrdenacao.js';
import { FILTROS_CATALOGO, regrasSaneamentoCatalogo } from '../telas.js';

class StorageFalso {
  constructor() {
    this.dados = new Map();
  }
  get length() {
    return this.dados.size;
  }
  key(i) {
    return Array.from(this.dados.keys())[i] ?? null;
  }
  getItem(k) {
    return this.dados.has(k) ? this.dados.get(k) : null;
  }
  setItem(k, v) {
    this.dados.set(k, String(v));
  }
  removeItem(k) {
    this.dados.delete(k);
  }
}

const U1 = '11111111-1111-4111-8111-111111111111';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function renderizar(Componente) {
  renderToString(createElement(Componente));
}

test('primeira renderização já vem com o filtro salvo (sem padrão -> restaura)', () => {
  const storage = new StorageFalso();
  const persistencia = criarPersistenciaFiltros({ obterStorage: () => storage });
  persistencia.definirSessao(U1, S1);
  persistencia.gravarTela(persistencia.obterNamespace(), 'catalogo', FILTROS_CATALOGO.versao, {
    busca: 'pão',
    status: 'inativos',
    secaoId: 'sec-1',
    categoriaId: 'todas',
  });

  const consultas = [];
  function Tela() {
    const filtros = useFiltrosPersistidos('catalogo', FILTROS_CATALOGO, { persistencia });
    consultas.push(filtros.valores.status); // o que a 1ª consulta usaria
    return null;
  }
  renderizar(Tela);
  assert.deepEqual(consultas, ['inativos']);
});

test('sem sessão de login (namespace null): padrão, sem gravar nada', () => {
  const storage = new StorageFalso();
  const persistencia = criarPersistenciaFiltros({ obterStorage: () => storage });
  let visto;
  function Tela() {
    visto = useFiltrosPersistidos('catalogo', FILTROS_CATALOGO, { persistencia }).valores;
    return null;
  }
  renderizar(Tela);
  assert.deepEqual(visto, FILTROS_CATALOGO.padrao);
  assert.equal(storage.length, 0);
});

test('useSanearFiltros: devolve o valor já saneado na mesma renderização (sem quadro com opção inexistente)', () => {
  const storage = new StorageFalso();
  const persistencia = criarPersistenciaFiltros({ obterStorage: () => storage });
  persistencia.definirSessao(U1, S1);
  persistencia.gravarTela(persistencia.obterNamespace(), 'catalogo', 1, {
    busca: 'pão',
    status: 'todos',
    secaoId: 'sec-removida',
    categoriaId: 'cat-1',
  });
  const resultados = [];
  function Tela({ prontas }) {
    const filtros = useFiltrosPersistidos('catalogo', FILTROS_CATALOGO, { persistencia });
    resultados.push(
      useSanearFiltros(
        filtros,
        regrasSaneamentoCatalogo({
          classificacoesProntas: prontas,
          secoesPorId: new Map([['sec-1', {}]]),
          categoriasPorId: new Map([['cat-1', {}]]),
        })
      )
    );
    return null;
  }
  renderToString(createElement(Tela, { prontas: false }));
  renderToString(createElement(Tela, { prontas: true }));
  assert.equal(resultados[0].secaoId, 'sec-removida'); // carregando: espera
  assert.deepEqual(resultados[1], { busca: 'pão', status: 'todos', secaoId: 'todas', categoriaId: 'cat-1' });
});

test('useOrdenacao SEM persistirEm: exatamente como antes (null / inicial), nada gravado', () => {
  const storage = new StorageFalso();
  globalThis.window = { localStorage: storage };
  persistenciaFiltros.definirSessao(U1, S1);
  storage.setItem(`${persistenciaFiltros.obterNamespace()}ordenacao:catalogo`, JSON.stringify({ v: 1, valores: { ordenacao: { chave: 'preco', direcao: 'desc' } } }));

  let semInicial;
  let comInicial;
  function Tela() {
    semInicial = useOrdenacao();
    comInicial = useOrdenacao({ inicial: { chave: 'nome', direcao: 'asc' } });
    return null;
  }
  renderizar(Tela);
  assert.equal(semInicial.ordenacao, null);
  assert.deepEqual(semInicial.props.chave, null);
  assert.deepEqual(comInicial.ordenacao, { chave: 'nome', direcao: 'asc' });
  assert.equal(typeof comInicial.props.onOrdenar, 'function');
  // ordenar continua aplicando vazios no fim etc. (lib/ordenacao/tabela)
  const linhas = comInicial.ordenar([{ nome: 'b' }, { nome: '' }, { nome: 'a' }], [{ chave: 'nome', ordenavel: true }]);
  assert.deepEqual(linhas.map((l) => l.nome), ['a', 'b', '']);
  persistenciaFiltros.encerrarSessao();
  delete globalThis.window;
});

test('useOrdenacao COM persistirEm: restaura a ordenação salva na 1ª renderização; inválida volta à inicial', () => {
  const storage = new StorageFalso();
  globalThis.window = { localStorage: storage };
  persistenciaFiltros.definirSessao(U1, S1);
  const ns = persistenciaFiltros.obterNamespace();
  storage.setItem(`${ns}ordenacao:catalogo`, JSON.stringify({ v: 1, valores: { ordenacao: { chave: 'menorPreco', direcao: 'desc' } } }));
  storage.setItem(`${ns}ordenacao:pedidos`, JSON.stringify({ v: 1, valores: { ordenacao: { chave: 'data', direcao: 'lado' } } }));
  storage.setItem(`${ns}ordenacao:escala.semanal`, JSON.stringify({ v: 1, valores: { ordenacao: null } }));

  let catalogo;
  let pedidos;
  let escala;
  function Tela() {
    catalogo = useOrdenacao({ inicial: { chave: 'nome', direcao: 'asc' }, persistirEm: 'catalogo' });
    pedidos = useOrdenacao({ persistirEm: 'pedidos' });
    escala = useOrdenacao({ inicial: { chave: 'nome', direcao: 'asc' }, persistirEm: 'escala.semanal' });
    return null;
  }
  renderizar(Tela);
  assert.deepEqual(catalogo.ordenacao, { chave: 'menorPreco', direcao: 'desc' });
  assert.deepEqual(catalogo.props, { chave: 'menorPreco', direcao: 'desc', onOrdenar: catalogo.props.onOrdenar });
  assert.equal(pedidos.ordenacao, null); // inválida -> padrão (sem ordenação)
  assert.equal(escala.ordenacao, null); // "sem ordenação" salvo explicitamente é respeitado
  persistenciaFiltros.encerrarSessao();
  delete globalThis.window;
});

test('useOrdenacao: clique alterna asc/desc, chama aoMudar (reset de página) e persiste quando pedido', () => {
  const storage = new StorageFalso();
  globalThis.window = { localStorage: storage };
  persistenciaFiltros.definirSessao(U1, S1);
  const ns = persistenciaFiltros.obterNamespace();

  let paginaResetada = 0;
  let cliques = 0;
  let ultimo;
  function Tela() {
    ultimo = useOrdenacao({ inicial: { chave: 'nome', direcao: 'asc' }, aoMudar: () => paginaResetada++, persistirEm: 'catalogo' });
    if (cliques === 0) {
      cliques++;
      ultimo.props.onOrdenar('nome'); // atualização durante o render: o servidor re-renderiza
    }
    return null;
  }
  renderizar(Tela);
  assert.deepEqual(ultimo.ordenacao, { chave: 'nome', direcao: 'desc' });
  assert.equal(paginaResetada, 1);
  // efeitos não rodam no servidor: a gravação acontece no navegador (useEffect)
  assert.equal(storage.getItem(`${ns}ordenacao:catalogo`), null);
  persistenciaFiltros.encerrarSessao();
  delete globalThis.window;
});
