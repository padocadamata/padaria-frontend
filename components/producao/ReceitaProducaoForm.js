import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../hooks/useAuth';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';

// Formulário SOMENTE da extensão operacional de Produção (public.receitas).
// Desde a unificação Catálogo x Produção (receitas.catalogo_produto_id,
// migration 0034), este componente NUNCA cria uma receita nova -- toda
// extensão nasce em marcar_produto_producao(), chamada a partir do
// Catálogo (components/catalogo/DadosProdutoForm.js). `receita` é sempre
// uma extensão JÁ existente e vinculada; `receita.produtos` traz o nome/
// código mestre (embed via a query de pages/producao/produtos.js).
//
// nome/codigo_g3 NÃO são mais editáveis aqui -- identidade cadastral
// pertence ao Catálogo. receitas.nome/receitas.codigo_g3 permanecem no
// banco como snapshot legado (não removidos, não escritos por este
// formulário) -- ver decisão da unificação. "Receita ativa" também saiu
// daqui: ativar/desativar a extensão é feito exclusivamente pelo checkbox
// "Produto de Produção" no Catálogo (marcar_produto_producao/
// desmarcar_produto_producao) -- nunca um UPDATE direto de receitas.ativo
// nesta tela, para não reabrir um segundo caminho de escrita que poderia
// dessincronizar do produto mestre.
function estadoInicial(receita) {
  return {
    tipo: receita?.tipo || '',
    grupo: receita?.grupo || '',
    descricao: receita?.descricao || '',
    temp_forno_celsius: receita?.temp_forno_celsius ?? '',
    tempo_coccao_minutos: receita?.tempo_coccao_minutos ?? '',
    tempo_fermentacao_natural_horas: receita?.tempo_fermentacao_natural_horas ?? '',
    tempo_fermentacao_climatica_horas: receita?.tempo_fermentacao_climatica_horas ?? '',
    rendimento_quantidade: receita?.rendimento_quantidade ?? '',
    unidade_medida_saida: receita?.unidade_medida_saida || '',
    controlado_producao: receita ? !!receita.controlado_producao : false,
    // Controle de Expositores (migration 0030).
    controlar_expositor: receita ? !!receita.controlar_expositor : false,
    prazo_expositor_dias: receita?.prazo_expositor_dias ?? '',
  };
}

function validar(dados) {
  const temQuantidade = dados.rendimento_quantidade !== '';
  const temUnidade = dados.unidade_medida_saida !== '';

  if (temQuantidade !== temUnidade) {
    return 'Informe quantidade e unidade de rendimento juntas, ou deixe as duas em branco.';
  }

  if (temQuantidade && !(Number(dados.rendimento_quantidade) > 0)) {
    return 'Rendimento deve ser maior que zero.';
  }

  if (dados.controlar_expositor) {
    const prazo = Number(dados.prazo_expositor_dias);
    if (dados.prazo_expositor_dias === '' || !Number.isInteger(prazo) || prazo <= 0) {
      return 'Informe o prazo no expositor (em dias, inteiro maior que zero).';
    }
  }

  return null;
}

// Converte o valor de um <input type="number"> controlado (sempre string
// no estado) para o que vai no payload: '' e valores não finitos (NaN,
// Infinity) viram null — nunca são enviados ao banco como estão.
function paraNumeroOuNull(valor) {
  if (valor === '' || valor == null) {
    return null;
  }

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

// Payload contém SOMENTE campos operacionais -- nunca nome, codigo_g3 ou
// ativo (essa é a exigência central desta rodada: o UPDATE afeta só a
// extensão operacional, identidade e estado de Produção ficam de fora).
function montarPayload(dados) {
  return {
    tipo: dados.tipo.trim() || null,
    grupo: dados.grupo.trim() || null,
    descricao: dados.descricao.trim() || null,
    temp_forno_celsius: paraNumeroOuNull(dados.temp_forno_celsius),
    tempo_coccao_minutos: paraNumeroOuNull(dados.tempo_coccao_minutos),
    tempo_fermentacao_natural_horas: paraNumeroOuNull(dados.tempo_fermentacao_natural_horas),
    tempo_fermentacao_climatica_horas: paraNumeroOuNull(dados.tempo_fermentacao_climatica_horas),
    rendimento_quantidade: paraNumeroOuNull(dados.rendimento_quantidade),
    unidade_medida_saida: dados.unidade_medida_saida || null,
    controlado_producao: dados.controlado_producao,
    // Controle de Expositores (0030): se desativado, prazo sempre null
    // (nunca confia só no onChange do checkbox); o CHECK
    // receitas_prazo_expositor_coerente_check garante isso também no banco.
    controlar_expositor: dados.controlar_expositor,
    prazo_expositor_dias: dados.controlar_expositor ? paraNumeroOuNull(dados.prazo_expositor_dias) : null,
    // atualizado_em: não existe trigger de banco para isso (confirmado nas
    // migrations — 0010 registra explicitamente que é a aplicação que
    // mantém essa coluna a cada UPDATE).
    atualizado_em: new Date().toISOString(),
  };
}

const rotuloEstilo = {
  fontWeight: 'bold',
  display: 'block',
  marginBottom: '5px',
  fontSize: '14px',
};

const campoEstilo = {
  width: '100%',
  padding: '8px',
  border: '1px solid #ddd',
  borderRadius: '5px',
  boxSizing: 'border-box',
};

const tituloBlocoEstilo = {
  margin: '20px 0 10px 0',
  paddingTop: '15px',
  borderTop: '1px solid #eee',
  fontSize: '15px',
};

const UNIDADES_SAIDA = ['g', 'kg', 'ml', 'L', 'un', 'dz'];

// Gerenciar Classificações (migration 0036): oferece só classificações
// ativas para escolhas novas -- mas se a receita já está com um valor que
// foi inativado depois, ele continua aparecendo (marcado "(inativo)"),
// nunca é trocado silenciosamente. NULL continua permitido nos dois casos
// (option vazia acima desta lista, no JSX).
function opcoesClassificacaoProducao(itens, valorAtual) {
  const ativos = itens.filter((item) => item.ativo);
  const atualInativo = valorAtual ? itens.find((item) => item.valor === valorAtual && !item.ativo) : null;
  const lista = atualInativo ? [...ativos, atualInativo] : ativos;
  return [...lista].sort((a, b) => a.valor.localeCompare(b.valor, 'pt-BR'));
}

export default function ReceitaProducaoForm({ receita, tiposProducao = [], gruposProducao = [], onFechar, onSalvo }) {
  const [dados, setDados] = useState(() => estadoInicial(receita));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Migration 0016: RLS de receitas passou de is_admin() puro para
  // has_permissao('produtos_producao.editar').
  const { permissoes } = useAuth();
  const podeEscrever = hasPermissao(permissoes, PERMISSOES.PRODUTOS_PRODUCAO_EDITAR);

  function atualizarCampo(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  function atualizarControlarExpositor(valor) {
    setDados((atual) => ({
      ...atual,
      controlar_expositor: valor,
      // Desmarcar já limpa o campo dependente na UI, para nunca mostrar
      // um prazo que o salvar não vai enviar (montarPayload já força
      // null de qualquer forma).
      prazo_expositor_dias: valor ? atual.prazo_expositor_dias : '',
    }));
  }

  async function salvar() {
    if (!podeEscrever) {
      setErro('Você não tem permissão para esta ação.');
      return;
    }

    const mensagemValidacao = validar(dados);
    if (mensagemValidacao) {
      setErro(mensagemValidacao);
      return;
    }

    setErro('');
    setSalvando(true);

    const supabase = createClient();
    const payload = montarPayload(dados);

    // Sempre UPDATE -- nunca INSERT. A extensão já existe (criada por
    // marcar_produto_producao a partir do Catálogo); este formulário só
    // edita os campos operacionais dela.
    const { error } = await supabase.from('receitas').update(payload).eq('id', receita.id);

    setSalvando(false);

    if (error) {
      if (error.code === '23514') {
        setErro('Não foi possível salvar: verifique o rendimento (quantidade e unidade devem vir juntas).');
      } else {
        console.error('Erro ao salvar receita:', error);
        setErro('Não foi possível salvar a receita.');
      }
      return;
    }

    onSalvo();
  }

  const nomeProduto = receita?.produtos?.nome || '—';
  const codigoG3Produto = receita?.produtos?.codigo_g3 || '—';
  const opcoesTipo = opcoesClassificacaoProducao(tiposProducao, dados.tipo);
  const opcoesGrupo = opcoesClassificacaoProducao(gruposProducao, dados.grupo);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '10px',
          maxWidth: '700px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Editar extensão de Produção</h3>

        <h4 style={{ ...tituloBlocoEstilo, borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
          Identidade (Catálogo)
        </h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '15px',
            marginBottom: '15px',
          }}
        >
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#666', marginBottom: '2px' }}>Nome</div>
            <div>{nomeProduto}</div>
          </div>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#666', marginBottom: '2px' }}>Código G3</div>
            <div>{codigoG3Produto}</div>
          </div>
        </div>
        <p style={{ fontSize: '12px', color: '#666', margin: '-10px 0 15px 0' }}>
          Nome e Código G3 pertencem ao cadastro mestre do Catálogo — edite-os em Catálogo de Produtos.
        </p>

        <h4 style={tituloBlocoEstilo}>Dados gerais</h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '15px',
            marginBottom: '15px',
          }}
        >
          <div>
            <label style={rotuloEstilo}>Tipo</label>
            <select
              value={dados.tipo}
              onChange={(e) => atualizarCampo('tipo', e.target.value)}
              style={campoEstilo}
            >
              <option value="">Selecione</option>
              {opcoesTipo.map((item) => (
                <option key={item.valor} value={item.valor}>
                  {item.valor}
                  {!item.ativo ? ' (inativo)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={rotuloEstilo}>Grupo</label>
            <select
              value={dados.grupo}
              onChange={(e) => atualizarCampo('grupo', e.target.value)}
              style={campoEstilo}
            >
              <option value="">Sem grupo</option>
              {opcoesGrupo.map((item) => (
                <option key={item.valor} value={item.valor}>
                  {item.valor}
                  {!item.ativo ? ' (inativo)' : ''}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '12px', color: '#666', margin: '5px 0 0 0' }}>
              Grupo de produção: receitas que podem compartilhar forno por terem parâmetros
              compatíveis.
            </p>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={rotuloEstilo}>Descrição</label>
            <textarea
              value={dados.descricao}
              onChange={(e) => atualizarCampo('descricao', e.target.value)}
              style={{ ...campoEstilo, minHeight: '70px', fontFamily: 'Arial' }}
            />
          </div>
        </div>

        <h4 style={tituloBlocoEstilo}>Parâmetros de produção</h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '15px',
            marginBottom: '15px',
          }}
        >
          <div>
            <label style={rotuloEstilo}>Temperatura do forno (°C)</label>
            <input
              type="number"
              value={dados.temp_forno_celsius}
              onChange={(e) => atualizarCampo('temp_forno_celsius', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Tempo de cocção (min)</label>
            <input
              type="number"
              value={dados.tempo_coccao_minutos}
              onChange={(e) => atualizarCampo('tempo_coccao_minutos', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Fermentação natural (h)</label>
            <input
              type="number"
              value={dados.tempo_fermentacao_natural_horas}
              onChange={(e) => atualizarCampo('tempo_fermentacao_natural_horas', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Fermentação climática (h)</label>
            <input
              type="number"
              value={dados.tempo_fermentacao_climatica_horas}
              onChange={(e) => atualizarCampo('tempo_fermentacao_climatica_horas', e.target.value)}
              style={campoEstilo}
            />
          </div>
        </div>

        <h4 style={tituloBlocoEstilo}>Rendimento</h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '15px',
            marginBottom: '15px',
          }}
        >
          <div>
            <label style={rotuloEstilo}>Quantidade</label>
            <input
              type="number"
              value={dados.rendimento_quantidade}
              onChange={(e) => atualizarCampo('rendimento_quantidade', e.target.value)}
              style={campoEstilo}
            />
          </div>

          <div>
            <label style={rotuloEstilo}>Unidade de saída</label>
            <select
              value={dados.unidade_medida_saida}
              onChange={(e) => atualizarCampo('unidade_medida_saida', e.target.value)}
              style={campoEstilo}
            >
              <option value="">Selecione</option>
              {UNIDADES_SAIDA.map((unidade) => (
                <option key={unidade} value={unidade}>
                  {unidade}
                </option>
              ))}
            </select>
          </div>
        </div>

        <h4 style={tituloBlocoEstilo}>Tela Hoje</h4>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={dados.controlado_producao}
              onChange={(e) => atualizarCampo('controlado_producao', e.target.checked)}
            />
            Exibir na Tela Hoje
          </label>
          <p style={{ fontSize: '12px', color: '#666', margin: '5px 0 0 26px' }}>
            Quando habilitado, o produto fica disponível no controle diário de Produção.
          </p>
        </div>

        <h4 style={tituloBlocoEstilo}>Controle de Expositores</h4>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={dados.controlar_expositor}
              onChange={(e) => atualizarControlarExpositor(e.target.checked)}
            />
            Controlar no expositor
          </label>

          {dados.controlar_expositor && (
            <div style={{ maxWidth: '220px' }}>
              <label style={rotuloEstilo}>Prazo no expositor (dias) *</label>
              <input
                type="number"
                min="1"
                step="1"
                value={dados.prazo_expositor_dias}
                onChange={(e) => atualizarCampo('prazo_expositor_dias', e.target.value)}
                style={campoEstilo}
              />
            </div>
          )}

          <p style={{ fontSize: '12px', color: '#666', margin: '5px 0 0 26px' }}>
            {dados.controlar_expositor
              ? 'Ao lançar produção deste produto, será possível registrar envio ao expositor e acompanhar a retirada em Produção > Expositores.'
              : 'Desabilitado -- este produto não aparece na tela de Expositores.'}
          </p>
        </div>

        {/* Etapa 3: bloco "Ficha técnica" entra aqui (usa receita.id, que
            este formulário sempre tem, já que nunca cria uma receita nova). */}

        {erro && (
          <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            style={{
              padding: '10px 20px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: salvando ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || !podeEscrever}
            style={{
              padding: '10px 20px',
              backgroundColor: '#8B4513',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: salvando || !podeEscrever ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
