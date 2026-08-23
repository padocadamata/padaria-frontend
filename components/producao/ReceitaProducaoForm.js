import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { isAdmin } from '../../lib/auth/permissoes';

function estadoInicial(receita) {
  return {
    codigo_g3: receita?.codigo_g3 || '',
    nome: receita?.nome || '',
    tipo: receita?.tipo || '',
    grupo: receita?.grupo || '',
    descricao: receita?.descricao || '',
    temp_forno_celsius: receita?.temp_forno_celsius ?? '',
    tempo_coccao_minutos: receita?.tempo_coccao_minutos ?? '',
    tempo_fermentacao_natural_horas: receita?.tempo_fermentacao_natural_horas ?? '',
    tempo_fermentacao_climatica_horas: receita?.tempo_fermentacao_climatica_horas ?? '',
    rendimento_quantidade: receita?.rendimento_quantidade ?? '',
    unidade_medida_saida: receita?.unidade_medida_saida || '',
    ativo: receita ? !!receita.ativo : true,
    controlado_producao: receita ? !!receita.controlado_producao : false,
  };
}

function validar(dados) {
  if (!dados.nome.trim()) {
    return 'Informe o nome da receita.';
  }

  const temQuantidade = dados.rendimento_quantidade !== '';
  const temUnidade = dados.unidade_medida_saida !== '';

  if (temQuantidade !== temUnidade) {
    return 'Informe quantidade e unidade de rendimento juntas, ou deixe as duas em branco.';
  }

  if (temQuantidade && !(Number(dados.rendimento_quantidade) > 0)) {
    return 'Rendimento deve ser maior que zero.';
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

function montarPayload(dados, estaEditando) {
  const payload = {
    codigo_g3: dados.codigo_g3.trim() || null,
    nome: dados.nome.trim(),
    tipo: dados.tipo.trim() || null,
    grupo: dados.grupo.trim() || null,
    descricao: dados.descricao.trim() || null,
    temp_forno_celsius: paraNumeroOuNull(dados.temp_forno_celsius),
    tempo_coccao_minutos: paraNumeroOuNull(dados.tempo_coccao_minutos),
    tempo_fermentacao_natural_horas: paraNumeroOuNull(dados.tempo_fermentacao_natural_horas),
    tempo_fermentacao_climatica_horas: paraNumeroOuNull(dados.tempo_fermentacao_climatica_horas),
    rendimento_quantidade: paraNumeroOuNull(dados.rendimento_quantidade),
    unidade_medida_saida: dados.unidade_medida_saida || null,
    ativo: dados.ativo,
    // Receita inativa nunca fica marcada como participante do controle de
    // produção — reforçado aqui independente do que a UI já tiver feito no
    // onChange do checkbox "Receita ativa".
    controlado_producao: dados.ativo ? dados.controlado_producao : false,
  };

  // atualizado_em: não existe trigger de banco para isso (confirmado nas
  // migrations — 0010 registra explicitamente que é a aplicação que
  // mantém essa coluna a cada UPDATE). Só faz sentido em edição; uma
  // receita nova não precisa desse campo no insert.
  if (estaEditando) {
    payload.atualizado_em = new Date().toISOString();
  }

  return payload;
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
const GRUPOS_PRODUCAO = ['A', 'B', 'C', 'D'];

export default function ReceitaProducaoForm({ receita, perfilUsuario, onFechar, onSalvo }) {
  const estaEditando = receita != null;
  const [dados, setDados] = useState(() => estadoInicial(receita));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const podeEscrever = isAdmin(perfilUsuario);

  function atualizarCampo(campo, valor) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  function atualizarAtivo(valor) {
    setDados((atual) => ({
      ...atual,
      ativo: valor,
      // Desmarca "Exibir na Tela Hoje" no mesmo instante em que a receita
      // é desativada, para a UI nunca mostrar um estado que o salvar não
      // vai respeitar.
      controlado_producao: valor ? atual.controlado_producao : false,
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
    const payload = montarPayload(dados, estaEditando);

    const resultado = estaEditando
      ? await supabase.from('receitas').update(payload).eq('id', receita.id)
      : await supabase.from('receitas').insert(payload);

    setSalvando(false);

    if (resultado.error) {
      if (resultado.error.code === '23505') {
        setErro('Já existe uma receita com este Código G3.');
      } else if (resultado.error.code === '23514') {
        setErro(
          'Não foi possível salvar: verifique o rendimento (quantidade e unidade devem vir juntas) ou o Código G3.'
        );
      } else {
        console.error('Erro ao salvar receita:', resultado.error);
        setErro('Não foi possível salvar a receita.');
      }
      return;
    }

    onSalvo();
  }

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
        <h3 style={{ marginTop: 0 }}>{estaEditando ? 'Editar receita' : 'Nova receita'}</h3>

        <h4 style={{ ...tituloBlocoEstilo, borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
          Dados gerais
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
            <label style={rotuloEstilo}>Código G3</label>
            <input
              type="text"
              value={dados.codigo_g3}
              onChange={(e) => atualizarCampo('codigo_g3', e.target.value)}
              style={campoEstilo}
            />
          </div>

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
            <label style={rotuloEstilo}>Tipo</label>
            <select
              value={dados.tipo}
              onChange={(e) => atualizarCampo('tipo', e.target.value)}
              style={campoEstilo}
            >
              <option value="">Selecione</option>
              <option value="salgada">Salgada</option>
              <option value="doce">Doce</option>
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
              {GRUPOS_PRODUCAO.map((grupo) => (
                <option key={grupo} value={grupo}>
                  {grupo}
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

        <h4 style={tituloBlocoEstilo}>Status</h4>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={dados.ativo}
              onChange={(e) => atualizarAtivo(e.target.checked)}
            />
            Receita ativa
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold',
              color: dados.ativo ? '#000' : '#999',
            }}
          >
            <input
              type="checkbox"
              checked={dados.controlado_producao}
              disabled={!dados.ativo}
              onChange={(e) => atualizarCampo('controlado_producao', e.target.checked)}
            />
            Exibir na Tela Hoje
          </label>
          <p style={{ fontSize: '12px', color: '#666', margin: '5px 0 0 26px' }}>
            {dados.ativo
              ? 'Quando habilitado, o produto fica disponível no controle diário de Produção.'
              : 'Desabilitado porque a receita está inativa.'}
          </p>
        </div>

        {/* Etapa 3: bloco "Ficha técnica" entra aqui, condicionado a
            estaEditando (precisa de receita.id já existente). */}

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
