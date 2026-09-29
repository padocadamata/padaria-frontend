import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { buscarEscalaPadrao, construirPayloadEscalaPadrao } from '../../lib/funcionarios/escala';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Select from '../ui/Select';
import PeriodosEditor from './PeriodosEditor';
import estilos from './escala.module.css';

// Nomes por extenso (só usados aqui -- a grade semanal/mensal usa as
// abreviações de ROTULO_DIA_SEMANA). Mesma convenção Domingo=0..Sábado=6.
const NOME_DIA_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function mensagemErroSalvar(error) {
  const msg = error?.message || '';
  if (msg.includes('trabalho precisa de pelo menos 1 periodo')) {
    return 'Informe pelo menos um período de trabalho para os dias marcados como Trabalho.';
  }
  if (msg.includes('periodos sobrepostos')) {
    return 'Os períodos informados se sobrepõem em algum dia — ajuste os horários.';
  }
  if (msg.includes('hora_fim <= hora_inicio') || msg.includes('hora_inicio/hora_fim validos')) {
    return 'Informe horários válidos (saída sempre depois da entrada).';
  }
  console.error('Erro ao salvar escala padrão:', error);
  const generica = 'Não foi possível salvar. Tente novamente ou avise um administrador.';
  if (process.env.NODE_ENV === 'production' || !msg) return generica;
  return `${generica} (dev: ${msg}${error.code ? ` | code=${error.code}` : ''}${error.hint ? ` | hint=${error.hint}` : ''})`;
}

// Converte o Map<dia_semana, EstadoPadraoDia> (vindo de buscarEscalaPadrao)
// nos 7 itens de rascunho local (índice = dia_semana) que esta aba edita --
// ausência de entrada vira `null` ("não configurado").
function construirRascunho(mapaEscalaPadrao, funcionarioId) {
  const porDia = mapaEscalaPadrao.get(funcionarioId) || new Map();
  return Array.from({ length: 7 }, (_, diaSemana) => {
    const estado = porDia.get(diaSemana);
    if (!estado) return null;
    return {
      tipo: estado.tipo,
      periodos: estado.periodos.map((p) => ({ hora_inicio: p.hora_inicio?.slice(0, 5) || '', hora_fim: p.hora_fim?.slice(0, 5) || '' })),
    };
  });
}

// Aba "Escala Padrão" do cadastro do funcionário (migration 0059) -- é um
// TEMPLATE, nunca a escala operacional em si: editar aqui não altera nada
// já lançado em funcionarios_escala_dias. Aplicar o padrão numa semana
// real é feito à parte, pelo botão "Preencher pela Escala Padrão" na Visão
// Semanal (via aplicar_escala_padrao), nunca a partir desta tela.
export default function EscalaPadraoTab({ funcionarioId, podeVer, podeEditar }) {
  const [estados, setEstados] = useState(() => Array(7).fill(null));
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  // "Copiar para outros dias" (seção 4 da arquitetura aprovada) -- SEMPRE
  // local (React state): nunca grava no banco fora do "Salvar" final. Só
  // um dia de origem pode estar com o painel de cópia aberto por vez.
  const [diaCopiaOrigem, setDiaCopiaOrigem] = useState(null);
  const [destinosCopia, setDestinosCopia] = useState([]);

  async function carregar() {
    if (!funcionarioId || !podeVer) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro('');
    const mapa = await buscarEscalaPadrao([funcionarioId]);
    setEstados(construirRascunho(mapa, funcionarioId));
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionarioId, podeVer]);

  useEffect(() => {
    if (!sucesso) return undefined;
    const timer = setTimeout(() => setSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [sucesso]);

  function alterarTipo(diaSemana, tipo) {
    setSucesso('');
    setEstados((atual) => {
      const novo = [...atual];
      novo[diaSemana] = tipo === 'nao_configurado' ? null : { tipo, periodos: tipo === 'trabalho' ? [{ hora_inicio: '', hora_fim: '' }] : [] };
      return novo;
    });
    if (diaCopiaOrigem === diaSemana) {
      setDiaCopiaOrigem(null);
      setDestinosCopia([]);
    }
  }

  function alterarPeriodos(diaSemana, periodos) {
    setSucesso('');
    setEstados((atual) => {
      const novo = [...atual];
      novo[diaSemana] = { ...novo[diaSemana], periodos };
      return novo;
    });
  }

  function abrirCopia(diaSemana) {
    setDiaCopiaOrigem((atual) => (atual === diaSemana ? null : diaSemana));
    setDestinosCopia([]);
  }

  function alternarDestinoCopia(diaSemana) {
    setDestinosCopia((atual) => (atual.includes(diaSemana) ? atual.filter((d) => d !== diaSemana) : [...atual, diaSemana]));
  }

  function aplicarCopia() {
    if (diaCopiaOrigem === null || destinosCopia.length === 0) return;
    setSucesso('');
    setEstados((atual) => {
      const origem = atual[diaCopiaOrigem];
      const novo = [...atual];
      for (const destino of destinosCopia) {
        novo[destino] = origem ? { tipo: origem.tipo, periodos: origem.periodos.map((p) => ({ ...p })) } : null;
      }
      return novo;
    });
    setDiaCopiaOrigem(null);
    setDestinosCopia([]);
  }

  async function salvar() {
    setErro('');
    for (let diaSemana = 0; diaSemana < 7; diaSemana++) {
      const estado = estados[diaSemana];
      if (estado?.tipo === 'trabalho' && estado.periodos.filter((p) => p.hora_inicio && p.hora_fim).length === 0) {
        setErro(`Informe pelo menos um período de trabalho para ${NOME_DIA_SEMANA[diaSemana]}.`);
        return;
      }
    }

    const payload = construirPayloadEscalaPadrao(
      estados.map((estado) => (estado?.tipo === 'trabalho' ? { tipo: 'trabalho', periodos: estado.periodos.filter((p) => p.hora_inicio && p.hora_fim) } : estado))
    );

    setSalvando(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('salvar_escala_padrao', { p_funcionario_id: funcionarioId, p_dias: payload });
    setSalvando(false);

    if (error) {
      setErro(mensagemErroSalvar(error));
      return;
    }

    setSucesso('Escala padrão salva com sucesso.');
    carregar();
  }

  if (!podeVer) {
    return <p className={estilos.notaOcorrencia}>Você não tem permissão para ver a escala padrão deste funcionário.</p>;
  }

  if (carregando) {
    return <p role="status">Carregando escala padrão...</p>;
  }

  return (
    <div className={estilos.modalCorpo}>
      <p className={estilos.notaOcorrencia}>
        Este é um modelo semanal — usado para preencher rapidamente dias sem escala definida (botão &quot;Preencher pela Escala Padrão&quot; na Visão Semanal).
        Alterar o modelo aqui nunca muda a escala já lançada.
      </p>

      {sucesso && <Alert tom="success" className={estilos.mensagem}>{sucesso}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      {estados.map((estado, diaSemana) => (
        <div key={diaSemana} className={estilos.secaoOcorrencia}>
          <h4 className={estilos.tituloOcorrencia}>{NOME_DIA_SEMANA[diaSemana]}</h4>

          <Field label="Modelo">
            <Select
              value={estado ? estado.tipo : 'nao_configurado'}
              disabled={!podeEditar}
              onChange={(e) => alterarTipo(diaSemana, e.target.value)}
            >
              <option value="nao_configurado">Não configurado</option>
              <option value="trabalho">Trabalho</option>
              <option value="folga">Folga</option>
            </Select>
          </Field>

          {estado?.tipo === 'trabalho' && (
            <PeriodosEditor periodos={estado.periodos} onAlterar={(p) => alterarPeriodos(diaSemana, p)} podeEditar={podeEditar} />
          )}

          {podeEditar && estado && (
            <div className={estilos.linhaOcorrencia}>
              <Button type="button" variante="secondary" tamanho="sm" onClick={() => abrirCopia(diaSemana)}>
                Copiar para outros dias
              </Button>
            </div>
          )}

          {diaCopiaOrigem === diaSemana && (
            <div className={estilos.selecaoFuncionarios}>
              {NOME_DIA_SEMANA.map((nome, destino) =>
                destino === diaSemana ? null : (
                  <Checkbox key={destino} rotulo={nome} checked={destinosCopia.includes(destino)} onChange={() => alternarDestinoCopia(destino)} />
                )
              )}
              <Button type="button" tamanho="sm" onClick={aplicarCopia} disabled={destinosCopia.length === 0}>
                Copiar
              </Button>
            </div>
          )}
        </div>
      ))}

      {podeEditar && (
        <div className={estilos.rodapePlanejamento}>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar escala padrão'}
          </Button>
        </div>
      )}
    </div>
  );
}
