import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';

// Mesmo componente para /catalogo/novo (produto=null) e para o Card
// "Dados do produto" de /catalogo/[id] (produto preenchido) — mesmo
// padrão de components/fornecedores/FornecedorForm.js. Sem modal: os
// dois contextos já são páginas próprias (rota dedicada / card
// empilhado), não precisam de overlay.
//
// validar/montarPayload/mensagemErro são exportadas (além de usadas
// aqui dentro) para a edição inline da tabela em pages/catalogo.js
// reutilizar exatamente a mesma validação/payload/tratamento de erro
// deste formulário — nunca duas implementações da mesma regra podendo
// divergir.
//
// Seção/Categoria (migration 0028): secao_id/categoria_id (FK para
// catalogo_secoes/catalogo_categorias) são a ÚNICA fonte que este
// formulário lê e escreve a partir de agora -- produtos.secao/categoria
// (texto livre) continuam existindo no banco só como legado transitório,
// nunca mais gravados por aqui. '' representa "nenhuma classificação"
// (equivalente a NULL) no <select> -- ver montarPayload.
function estadoInicial(produto) {
  return {
    nome: produto?.nome || '',
    codigo_g3: produto?.codigo_g3 || '',
    codigo_barras: produto?.codigo_barras || '',
    secao_id: produto?.secao_id || '',
    categoria_id: produto?.categoria_id || '',
    unidade_medida: produto?.unidade_medida || '',
    ativo: produto ? !!produto.ativo : true,
  };
}

export function validar(dados) {
  if (!dados.nome.trim()) {
    return 'Informe o nome do produto.';
  }
  return null;
}

// codigo_g3/codigo_barras vazios viram null explicitamente -- nunca
// string vazia (a CHECK do banco rejeitaria, e null é o valor correto
// para "produto sem esse código", não uma string vazia). secao_id/
// categoria_id: '' (nenhuma opção selecionada) também vira null --
// NUNCA envia secao/categoria (texto) no payload, mesmo que a coluna
// ainda exista no banco.
export function montarPayload(dados) {
  return {
    nome: dados.nome.trim(),
    codigo_g3: dados.codigo_g3.trim() || null,
    codigo_barras: dados.codigo_barras.trim() || null,
    secao_id: dados.secao_id || null,
    categoria_id: dados.categoria_id || null,
    unidade_medida: dados.unidade_medida.trim() || null,
    ativo: dados.ativo,
  };
}

export function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';

  if (error.code === '23505') {
    if (msg.includes('codigo_g3')) {
      return 'Já existe um produto com este código G3.';
    }
    if (msg.includes('codigo_barras')) {
      return 'Já existe um produto com este código de barras.';
    }
    return 'Já existe um produto com um dos códigos informados.';
  }

  if (error.code === '23514') {
    if (msg.includes('codigo_g3')) {
      return 'Código G3 não pode ser só espaços em branco.';
    }
    if (msg.includes('codigo_barras')) {
      return 'Código de barras não pode ser só espaços em branco.';
    }
    return 'Um dos campos não passou na validação do banco.';
  }

  // Auditoria manual de information_schema.columns em public.produtos
  // confirmou que só "nome" é NOT NULL (codigo_barras, codigo_g3, secao,
  // categoria, unidade_medida, preco_unitario, estoque_minimo são todos
  // nullable) -- então 23502 não deveria acontecer no uso normal deste
  // formulário. Mantido mesmo assim como proteção defensiva: extrai o
  // nome da coluna da própria mensagem do Postgres em vez de travar numa
  // mensagem genérica, caso o banco mude no futuro sem o frontend saber.
  if (error.code === '23502') {
    const coluna = msg.match(/column "(.+?)"/)?.[1];
    return coluna
      ? `O campo "${coluna}" é obrigatório no banco e não pode ficar em branco.`
      : 'Um campo obrigatório não foi informado.';
  }

  // Defensivo: só acontece se secao_id/categoria_id apontar para uma
  // classificação excluída entre o carregamento do <select> e o salvar
  // (concorrência rara -- outra aba/usuário excluiu a classificação
  // enquanto esta tela estava aberta). RESTRICT/NO ACTION nas FKs
  // (migration 0028) faz o Postgres rejeitar em vez de aceitar um valor
  // órfão.
  if (error.code === '23503') {
    return 'A Seção ou Categoria selecionada não existe mais -- atualize a página e tente novamente.';
  }

  console.error('Erro ao salvar produto:', error);
  return 'Não foi possível salvar o produto. Tente novamente ou avise um administrador.';
}

const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '14px' };

const campoEstilo = {
  width: '100%',
  padding: '8px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
};

export default function DadosProdutoForm({ produto, corPrimaria = '#8B4513', podeEditar, onCriado, onSalvo }) {
  const estaEditando = produto != null;
  const [dados, setDados] = useState(() => estadoInicial(produto));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Seção/Categoria estruturadas (migration 0028) -- carregado sempre
  // (não só quando podeEditar): o modo leitura (CampoLeitura) também
  // precisa dessas listas para resolver o nome a partir de
  // produto.secao_id/categoria_id. RLS de catalogo_secoes/categorias já
  // exige catalogo_produtos.visualizar, a mesma permissão que dá acesso
  // a esta tela -- buscar aqui nunca expõe nada que o usuário não
  // pudesse ver de outra forma.
  const [secoes, setSecoes] = useState([]);
  const [categorias, setCategorias] = useState([]);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarClassificacoes() {
      const supabase = createClient();
      const [{ data: secoesData }, { data: categoriasData }] = await Promise.all([
        supabase.from('catalogo_secoes').select('id, nome').order('nome'),
        supabase.from('catalogo_categorias').select('id, nome').order('nome'),
      ]);
      if (!efeitoAtivo) return;

      setSecoes(secoesData || []);
      setCategorias(categoriasData || []);
    }

    carregarClassificacoes();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  function atualizarCampo(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar() {
    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();
    const payload = montarPayload(dados);

    if (estaEditando) {
      const { error } = await supabase.from('produtos').update(payload).eq('id', produto.id);
      setSalvando(false);

      if (error) {
        setErro(mensagemErro(error));
        return;
      }

      onSalvo();
      return;
    }

    const { data, error } = await supabase.from('produtos').insert(payload).select('id').single();
    setSalvando(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    onCriado(data.id);
  }

  if (!podeEditar) {
    const secaoNome = secoes.find((s) => s.id === produto.secao_id)?.nome;
    const categoriaNome = categorias.find((c) => c.id === produto.categoria_id)?.nome;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
        <CampoLeitura rotulo="Nome" valor={produto.nome} />
        <CampoLeitura rotulo="Código G3" valor={produto.codigo_g3} />
        <CampoLeitura rotulo="Código de barras" valor={produto.codigo_barras} />
        <CampoLeitura rotulo="Seção" valor={secaoNome} />
        <CampoLeitura rotulo="Categoria" valor={categoriaNome} />
        <CampoLeitura rotulo="Unidade-base" valor={produto.unidade_medida} />
        <CampoLeitura rotulo="Status" valor={produto.ativo ? 'Ativo' : 'Inativo'} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '15px' }}>
        <div>
          <label style={rotuloEstilo}>Nome *</label>
          <input
            type="text"
            value={dados.nome}
            onChange={(e) => atualizarCampo('nome', e.target.value)}
            style={campoEstilo}
          />
        </div>

        <div>
          <label style={rotuloEstilo}>Código G3</label>
          <input
            type="text"
            value={dados.codigo_g3}
            onChange={(e) => atualizarCampo('codigo_g3', e.target.value)}
            placeholder="Opcional"
            style={campoEstilo}
          />
        </div>

        <div>
          <label style={rotuloEstilo}>Código de barras</label>
          <input
            type="text"
            value={dados.codigo_barras}
            onChange={(e) => atualizarCampo('codigo_barras', e.target.value)}
            placeholder="Opcional"
            style={campoEstilo}
          />
        </div>

        <div>
          <label style={rotuloEstilo}>Seção</label>
          <select
            value={dados.secao_id}
            onChange={(e) => atualizarCampo('secao_id', e.target.value)}
            style={campoEstilo}
          >
            <option value="">— Nenhuma —</option>
            {secoes.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={rotuloEstilo}>Categoria</label>
          <select
            value={dados.categoria_id}
            onChange={(e) => atualizarCampo('categoria_id', e.target.value)}
            style={campoEstilo}
          >
            <option value="">— Nenhuma —</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={rotuloEstilo}>Unidade-base</label>
          <input
            type="text"
            value={dados.unidade_medida}
            onChange={(e) => atualizarCampo('unidade_medida', e.target.value)}
            placeholder="kg, un, pacote..."
            style={campoEstilo}
          />
          <p style={{ fontSize: '12px', color: '#999', marginTop: '4px', marginBottom: 0 }}>
            Unidade usada para comparar preços deste produto — não precisa coincidir com a unidade de compra de
            nenhum fornecedor específico.
          </p>
        </div>
      </div>

      {estaEditando && (
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
            <input
              type="checkbox"
              checked={dados.ativo}
              onChange={(e) => atualizarCampo('ativo', e.target.checked)}
            />
            Produto ativo
          </label>
        </div>
      )}

      {erro && <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          style={{
            padding: '10px 20px',
            backgroundColor: corPrimaria,
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: salvando ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
          }}
        >
          {salvando ? 'Salvando...' : estaEditando ? 'Salvar alterações' : 'Criar produto'}
        </button>
      </div>
    </div>
  );
}

function CampoLeitura({ rotulo, valor }) {
  return (
    <div>
      <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#666', marginBottom: '2px' }}>{rotulo}</div>
      <div>{valor || '—'}</div>
    </div>
  );
}
