import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { PERMISSOES, hasPermissao } from '../../lib/auth/permissoes';
import FornecedorRegraForm from './FornecedorRegraForm';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import EmptyState from '../ui/EmptyState';
import estilos from './fornecedores.module.css';

const DIAS_SEMANA_LABEL = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
  7: 'Domingo',
};

function descreverPedido(diaPedido) {
  return diaPedido ? DIAS_SEMANA_LABEL[diaPedido] : 'Diário';
}

function descreverEntrega(regra) {
  if (regra.tipo_entrega === 'prazo_dias') {
    return `D+${regra.dias_prazo}`;
  }

  return `Entrega ${DIAS_SEMANA_LABEL[regra.dia_entrega]}`;
}

function formatarHorario(horarioLimite) {
  if (!horarioLimite) {
    return null;
  }

  return horarioLimite.slice(0, 5);
}

export default function FornecedorRegras({ fornecedorId, permissoes }) {
  const [regras, setRegras] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mostrarInativas, setMostrarInativas] = useState(false);

  const [modalRegraAberto, setModalRegraAberto] = useState(false);
  const [regraEmEdicao, setRegraEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarRegras() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      const { data, error } = await supabase
        .from('fornecedor_regras_pedido')
        .select(
          'id, dia_pedido, horario_limite, tipo_entrega, dias_prazo, dia_entrega, observacao, ativo'
        )
        .eq('fornecedor_id', fornecedorId)
        .order('dia_pedido', { ascending: true, nullsFirst: true });

      if (!efeitoAtivo) {
        return;
      }

      if (error) {
        console.error('Erro ao carregar regras:', error);
        setErro('Não foi possível carregar as regras de pedido e entrega.');
        setRegras([]);
      } else {
        setRegras(data || []);
      }

      setCarregando(false);
    }

    carregarRegras();

    return () => {
      efeitoAtivo = false;
    };
  }, [fornecedorId, recarregarTick]);

  useEffect(() => {
    if (!mensagemSucesso) {
      return undefined;
    }

    const timer = setTimeout(() => setMensagemSucesso(''), 4000);

    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  function abrirNovaRegra() {
    setRegraEmEdicao(null);
    setModalRegraAberto(true);
  }

  function abrirEdicaoRegra(regra) {
    setRegraEmEdicao(regra);
    setModalRegraAberto(true);
  }

  function fecharModalRegra() {
    setModalRegraAberto(false);
    setRegraEmEdicao(null);
  }

  function aoSalvarRegra() {
    const estaEditando = regraEmEdicao != null;

    fecharModalRegra();

    setMensagemSucesso(
      estaEditando ? 'Regra atualizada com sucesso.' : 'Regra cadastrada com sucesso.'
    );

    setRecarregarTick((tick) => tick + 1);
  }

  if (!hasPermissao(permissoes, PERMISSOES.FORNECEDORES_VISUALIZAR)) {
    return null;
  }

  const regrasVisiveis = mostrarInativas ? regras : regras.filter((regra) => regra.ativo);

  return (
    <section className={estilos.regras} aria-label="Regras de pedido e entrega">
      <div className={estilos.cabecalhoRegras}>
        <h3>Regras de pedido e entrega</h3>

        {hasPermissao(permissoes, PERMISSOES.FORNECEDORES_INSERIR) && (
          <Button tamanho="sm" icone="plus" onClick={abrirNovaRegra}>
            Nova regra
          </Button>
        )}
      </div>

      <Checkbox
        rotulo="Mostrar regras inativas"
        checked={mostrarInativas}
        onChange={(e) => setMostrarInativas(e.target.checked)}
      />

      {mensagemSucesso && <Alert tom="success" className={estilos.mensagem}>{mensagemSucesso}</Alert>}

      {carregando ? (
        <p role="status">Carregando regras...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : regrasVisiveis.length === 0 ? (
        <EmptyState>Nenhuma regra ativa cadastrada.</EmptyState>
      ) : (
        <ul className={estilos.listaRegras}>
          {regrasVisiveis.map((regra) => (
            <li key={regra.id} className={estilos.regra}>
              <div>
                <div className={estilos.regraTitulo}>
                  <span>
                    {descreverPedido(regra.dia_pedido)} → {descreverEntrega(regra)}
                  </span>
                  {!regra.ativo && <Badge tom="neutral">Inativa</Badge>}
                </div>

                {formatarHorario(regra.horario_limite) && (
                  <p className={estilos.regraDetalhe}>Pedido até {formatarHorario(regra.horario_limite)}</p>
                )}

                {regra.observacao && <p className={estilos.regraObservacao}>{regra.observacao}</p>}
              </div>

              {hasPermissao(permissoes, PERMISSOES.FORNECEDORES_EDITAR) && (
                <Button variante="secondary" tamanho="sm" icone="pencil" onClick={() => abrirEdicaoRegra(regra)}>
                  Editar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {modalRegraAberto && (
        <FornecedorRegraForm
          fornecedorId={fornecedorId}
          regra={regraEmEdicao}
          permissoes={permissoes}
          onFechar={fecharModalRegra}
          onSalvo={aoSalvarRegra}
        />
      )}
    </section>
  );
}
