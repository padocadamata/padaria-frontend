import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { formatarHora, construirCopiaDia } from '../../lib/funcionarios/escala';
import { buscarFormaRemuneracaoAtual } from '../../lib/funcionarios/pagamentos';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import PeriodosEditor from './PeriodosEditor';
import estilos from './escala.module.css';

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function mensagemErroPlanejamento(error) {
  const msg = error?.message || '';
  if (msg.includes('ja existe falta/atestado registrado')) {
    return 'Já existe falta/atestado registrado neste dia — remova a ocorrência (abaixo) antes de marcar folga ou limpar o planejamento.';
  }
  if (msg.includes('trabalho precisa de pelo menos 1 periodo')) {
    return 'Informe pelo menos um período de trabalho.';
  }
  if (msg.includes('periodos sobrepostos')) {
    return 'Os períodos informados se sobrepõem — ajuste os horários.';
  }
  if (msg.includes('hora_fim <= hora_inicio') || msg.includes('hora_inicio/hora_fim validos')) {
    return 'Informe horários válidos (saída sempre depois da entrada).';
  }
  // Protecao K (migration 0066) -- a RPC ja devolve a mensagem exata,
  // pronta para o usuario (ver aplicar_escala_em_lote). Repassa verbatim em
  // vez de cair no fallback generico abaixo.
  if (msg.includes('já possui pagamento confirmado')) {
    return msg;
  }
  console.error('Erro ao salvar escala do dia:', error);
  return 'Não foi possível salvar. Tente novamente ou avise um administrador.';
}

// Edição do planejamento (Trabalho/Folga/Não definido, com múltiplos
// períodos) + ocorrência (Falta/Atestado) de UM funcionário numa data --
// dois conceitos deliberadamente distintos na UI, mesma separação da
// arquitetura aprovada: o planejamento nunca é apagado ao registrar uma
// ocorrência, e vice-versa (registrar_ocorrencia_escala/remover_ocorrencia_
// escala são chamadas SEPARADAS de aplicar_escala_em_lote).
export default function EscalaDiaModal({ funcionario, data, estadoAtual, podeEditar, onFechar, onSalvo }) {
  const [tipoSelecionado, setTipoSelecionado] = useState(() => {
    if (!estadoAtual) return 'nao_definido';
    return estadoAtual.tipo;
  });
  const [periodos, setPeriodos] = useState(() => {
    if (estadoAtual?.tipo === 'trabalho' && estadoAtual.periodos.length > 0) {
      return estadoAtual.periodos.map((p) => ({
        hora_inicio: formatarHora(p.hora_inicio),
        hora_fim: formatarHora(p.hora_fim),
        // Preserva a classificação já existente (migrations 0065/0066) --
        // NUNCA reseta silenciosamente para 'normal' ao reabrir/resalvar o
        // dia, mesmo quando o toggle não está visível no momento (forma de
        // remuneração atual != mensal).
        natureza_financeira: p.natureza_financeira || 'normal',
      }));
    }
    return [{ hora_inicio: '', hora_fim: '' }];
  });

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Toggle "Extra remunerado" (migrations 0065/0066, frente Pagamentos):
  // escondido só quando a forma de remuneração ATUAL é por_hora (para quem
  // é por hora todo período já é pago -- o campo seria inerte). Para mensal
  // ou ainda não configurado, a marcação fica disponível (o pagamento de
  // extra exige forma mensal NA DATA, validado no banco).
  const [formaRemuneracao, setFormaRemuneracao] = useState(null);

  useEffect(() => {
    let ativo = true;
    buscarFormaRemuneracaoAtual(funcionario.id).then((forma) => {
      if (ativo) setFormaRemuneracao(forma);
    });
    return () => {
      ativo = false;
    };
  }, [funcionario.id]);

  const [salvandoOcorrencia, setSalvandoOcorrencia] = useState(false);
  const [erroOcorrencia, setErroOcorrencia] = useState('');
  const [tipoOcorrenciaNova, setTipoOcorrenciaNova] = useState('falta');

  const [dataDestinoCopia, setDataDestinoCopia] = useState('');
  const [copiando, setCopiando] = useState(false);
  const [erroCopia, setErroCopia] = useState('');
  const [copiaOk, setCopiaOk] = useState(false);
  // Uma cópia bem-sucedida altera OUTRA data, não a que está aberta aqui --
  // a grade só precisa recarregar ao fechar (não a cada cópia, permitindo
  // copiar para vários destinos em sequência sem fechar o modal).
  const [houveCopiaBemSucedida, setHouveCopiaBemSucedida] = useState(false);

  const existiaPlanejamento = estadoAtual != null;
  const ocorrenciaAtual = estadoAtual?.ocorrencia || null;

  async function salvar() {
    setErro('');

    if (tipoSelecionado === 'nao_definido' && !existiaPlanejamento) {
      onFechar();
      return;
    }

    if (tipoSelecionado === 'trabalho') {
      const periodosPreenchidos = periodos.filter((p) => p.hora_inicio && p.hora_fim);
      if (periodosPreenchidos.length === 0) {
        setErro('Informe pelo menos um período de trabalho.');
        return;
      }
    }

    setSalvando(true);
    const supabase = createClient();
    const item = {
      funcionario_id: funcionario.id,
      data,
      tipo_dia: tipoSelecionado === 'nao_definido' ? 'remover' : tipoSelecionado,
      periodos: tipoSelecionado === 'trabalho' ? periodos.filter((p) => p.hora_inicio && p.hora_fim) : [],
    };

    const { error } = await supabase.rpc('aplicar_escala_em_lote', { p_atribuicoes: [item] });
    setSalvando(false);

    if (error) {
      setErro(mensagemErroPlanejamento(error));
      return;
    }

    onSalvo();
  }

  async function registrarOcorrencia() {
    setErroOcorrencia('');
    setSalvandoOcorrencia(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('registrar_ocorrencia_escala', {
      p_funcionario_id: funcionario.id,
      p_data: data,
      p_tipo: tipoOcorrenciaNova,
      p_observacao: null,
    });
    setSalvandoOcorrencia(false);
    if (error) {
      // Migration 0068 -- dia com jornada em pagamento ativo nao aceita
      // falta/atestado; a mensagem do banco ja vem pronta para o usuario.
      if (error.message?.includes('já possui jornada com pagamento confirmado')) {
        setErroOcorrencia(error.message);
        return;
      }
      console.error('Erro ao registrar ocorrência:', error);
      setErroOcorrencia('Não foi possível registrar. Tente novamente.');
      return;
    }
    onSalvo();
  }

  // "Copiar dia" (seção 10/11 da arquitetura aprovada) -- copia o estado
  // JÁ SALVO deste dia (estadoAtual, não o rascunho em edição na tela)
  // para outra data do MESMO funcionário. Não verifica sobrescrita aqui
  // (ação pontual de 1 dia); se o destino já tiver falta/atestado, a
  // própria RPC rejeita e o erro aparece normalmente.
  async function copiarParaOutraData() {
    setErroCopia('');
    setCopiaOk(false);
    if (!dataDestinoCopia) {
      setErroCopia('Escolha a data de destino.');
      return;
    }
    const item = construirCopiaDia({ funcionarioId: funcionario.id, estadoOrigem: estadoAtual, dataDestino: dataDestinoCopia });
    if (!item) return;

    setCopiando(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('aplicar_escala_em_lote', { p_atribuicoes: [item] });
    setCopiando(false);

    if (error) {
      setErroCopia(mensagemErroPlanejamento(error));
      return;
    }
    setCopiaOk(true);
    setHouveCopiaBemSucedida(true);
  }

  // Fecha o modal -- se alguma cópia para outra data foi feita nesta
  // sessão do modal, reaproveita onSalvo (fecha + recarrega a grade) em
  // vez de onFechar (só fecha), para a célula de destino aparecer
  // atualizada sem precisar trocar de semana e voltar.
  function fecharModal() {
    if (houveCopiaBemSucedida) {
      onSalvo();
    } else {
      onFechar();
    }
  }

  async function removerOcorrencia() {
    setErroOcorrencia('');
    setSalvandoOcorrencia(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('remover_ocorrencia_escala', {
      p_funcionario_id: funcionario.id,
      p_data: data,
    });
    setSalvandoOcorrencia(false);
    if (error) {
      console.error('Erro ao remover ocorrência:', error);
      setErroOcorrencia('Não foi possível remover. Tente novamente.');
      return;
    }
    onSalvo();
  }

  return (
    <Modal titulo={`${funcionario.nome} — ${formatarDataExibicao(data)}`} onFechar={fecharModal} largura="sm">
      <div className={estilos.modalCorpo}>
        <Field label="Planejamento">
          <Select value={tipoSelecionado} disabled={!podeEditar} onChange={(e) => setTipoSelecionado(e.target.value)}>
            <option value="nao_definido">Não definido</option>
            <option value="trabalho">Trabalho</option>
            <option value="folga">Folga</option>
          </Select>
        </Field>

        {tipoSelecionado === 'trabalho' && (
          <PeriodosEditor periodos={periodos} onAlterar={setPeriodos} podeEditar={podeEditar} mostrarNaturezaFinanceira={formaRemuneracao !== 'por_hora'} />
        )}

        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

        {podeEditar && (
          <div className={estilos.rodapePlanejamento}>
            <Button type="button" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar planejamento'}
            </Button>
          </div>
        )}

        <div className={estilos.secaoOcorrencia}>
          <h4 className={estilos.tituloOcorrencia}>Ocorrência</h4>
          {ocorrenciaAtual ? (
            <div className={estilos.linhaOcorrencia}>
              <Badge tom={ocorrenciaAtual.tipo === 'falta' ? 'danger' : 'warning'}>
                {ocorrenciaAtual.tipo === 'falta' ? 'Falta registrada' : 'Atestado registrado'}
              </Badge>
              {podeEditar && (
                <Button type="button" variante="secondary" tamanho="sm" onClick={removerOcorrencia} disabled={salvandoOcorrencia}>
                  {salvandoOcorrencia ? 'Removendo...' : 'Remover ocorrência'}
                </Button>
              )}
            </div>
          ) : estadoAtual?.tipo === 'trabalho' ? (
            podeEditar && (
              <div className={estilos.linhaOcorrencia}>
                <Select value={tipoOcorrenciaNova} onChange={(e) => setTipoOcorrenciaNova(e.target.value)}>
                  <option value="falta">Falta</option>
                  <option value="atestado">Atestado</option>
                </Select>
                <Button type="button" variante="secondary" tamanho="sm" onClick={registrarOcorrencia} disabled={salvandoOcorrencia}>
                  {salvandoOcorrencia ? 'Registrando...' : 'Registrar'}
                </Button>
              </div>
            )
          ) : (
            <p className={estilos.notaOcorrencia}>Só é possível registrar falta/atestado num dia de trabalho já salvo.</p>
          )}
          {erroOcorrencia && <Alert tom="danger" className={estilos.mensagem}>{erroOcorrencia}</Alert>}
        </div>

        {podeEditar && existiaPlanejamento && (
          <div className={estilos.secaoOcorrencia}>
            <h4 className={estilos.tituloOcorrencia}>Copiar este dia para outra data</h4>
            <div className={estilos.linhaOcorrencia}>
              <Input type="date" value={dataDestinoCopia} onChange={(e) => { setDataDestinoCopia(e.target.value); setCopiaOk(false); }} />
              <Button type="button" variante="secondary" tamanho="sm" onClick={copiarParaOutraData} disabled={copiando}>
                {copiando ? 'Copiando...' : 'Copiar'}
              </Button>
            </div>
            {copiaOk && <Alert tom="success" className={estilos.mensagem}>Copiado com sucesso.</Alert>}
            {erroCopia && <Alert tom="danger" className={estilos.mensagem}>{erroCopia}</Alert>}
          </div>
        )}
      </div>
    </Modal>
  );
}
