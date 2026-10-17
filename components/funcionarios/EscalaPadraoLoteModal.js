import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { resumirResultadoAplicacaoPadrao } from '../../lib/funcionarios/escala';
import { dataLocalHoje, mesExibicao } from '../../lib/data/dataLocal';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { SelecaoFuncionariasPorCargo } from './EscalaGrupos';
import estilos from './escala.module.css';

const ROTULO_SITUACAO = {
  preenchido: 'Preenchidos',
  ignorado: 'Já tinham escala (ignorados)',
  sem_padrao: 'Sem escala padrão',
  funcionario_inativo: 'Inativos',
};

// Mensagem amigavel + (SOMENTE fora de producao) o erro real do Postgres/
// PostgREST anexado -- sem isso, qualquer erro inesperado da RPC (ex.:
// erro de sintaxe/ambiguidade, violacao de constraint nao mapeada) fica
// invisivel para quem esta depurando, so aparecendo no console.error. Em
// producao (NODE_ENV=production) o usuario final nunca ve detalhe tecnico.
function mensagemErroAplicar(error) {
  const generica = 'Não foi possível aplicar a escala padrão. Tente novamente ou avise um administrador.';
  if (process.env.NODE_ENV === 'production' || !error?.message) return generica;
  return `${generica} (dev: ${error.message}${error.code ? ` | code=${error.code}` : ''}${error.hint ? ` | hint=${error.hint}` : ''})`;
}

function dataCurta(dataYYYYMMDD) {
  const [, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}`;
}

// "Preencher pela Escala Padrão" (seção "AJUSTE ARQUITETURAL" aprovada) --
// chama SOMENTE a RPC aplicar_escala_padrao, que decide tudo (o que já
// existe, o que preencher) atomicamente no banco. O frontend nunca lê a
// grade antes para decidir o que mandar -- só informa funcionários e as
// datas do período em exibição; a corrida de concorrência é resolvida
// inteiramente do lado do Postgres (ver comentário no topo da migration
// 0059).
//
// periodo: 'semana' (Semanal -- os 7 dias da semana em exibição, texto e
// comportamento de sempre) ou 'mes' (Mensal -- SEMPRE o mês inteiro em
// exibição, 28 a 31 datas, sem seletor). No mês atual/passado o modal
// avisa, antes e depois, que dias vazios já passados também são
// preenchidos e passam a valer para a Folha de Pagamento.
export default function EscalaPadraoLoteModal({ funcionarios, dias, periodo = 'semana', onFechar, onAplicado }) {
  const [funcionarioIds, setFuncionarioIds] = useState([]);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null); // resumo por situação, após aplicar

  const ehMes = periodo === 'mes';
  const hoje = dataLocalHoje();
  const rotuloMes = ehMes ? mesExibicao(dias[0]) : '';
  const incluiDiasPassados = dias.length > 0 && dias[0] <= hoje;

  async function aplicar() {
    setErro('');
    if (funcionarioIds.length === 0) {
      setErro('Selecione pelo menos um funcionário.');
      return;
    }

    setAplicando(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('aplicar_escala_padrao', {
      p_funcionario_ids: funcionarioIds,
      p_datas: dias,
    });
    setAplicando(false);

    if (error) {
      console.error('Erro ao aplicar escala padrão:', error);
      setErro(mensagemErroAplicar(error));
      return;
    }

    setResultado(resumirResultadoAplicacaoPadrao(data, { hoje }));
  }

  function fechar() {
    if (resultado) {
      onAplicado();
    } else {
      onFechar();
    }
  }

  return (
    <Modal titulo="Preencher pela Escala Padrão" onFechar={fechar} largura="md">
      <div className={estilos.modalCorpo}>
        {!resultado ? (
          <>
            {ehMes ? (
              <p className={estilos.notaOcorrencia}>
                Preenche os dias de <strong>{rotuloMes.toLowerCase()}</strong> ({dataCurta(dias[0])} a {dataCurta(dias[dias.length - 1])}) que ainda
                não têm escala, usando a Escala Padrão de cada funcionária selecionada. Dias já planejados (trabalho ou folga) nunca são alterados.
              </p>
            ) : (
              <p className={estilos.notaOcorrencia}>
                Preenche, nesta semana em exibição, somente os dias que ainda não têm escala definida para os funcionários
                selecionados — nunca sobrescreve um dia já planejado.
              </p>
            )}

            {ehMes && incluiDiasPassados && (
              <Alert tom="warning" className={estilos.mensagem}>
                Este mês inclui dias que já passaram. Dias passados que ainda estão vazios também serão preenchidos, e as jornadas até hoje
                passam a ser consideradas pela Folha de Pagamento, podendo gerar pendências de pagamento conforme as regras normais.
              </Alert>
            )}

            <Field label="Funcionários">
              <SelecaoFuncionariasPorCargo funcionarios={funcionarios} selecionados={funcionarioIds} onAlterar={setFuncionarioIds} />
            </Field>

            {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

            <div className={estilos.rodapePlanejamento}>
              <Button type="button" onClick={aplicar} disabled={aplicando}>
                {aplicando ? 'Aplicando...' : ehMes ? `Preencher ${rotuloMes.toLowerCase()}` : 'Aplicar'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={estilos.resumoGrid}>
              {Object.entries(ROTULO_SITUACAO).map(([chave, rotulo]) => (
                <div key={chave} className={estilos.resumoItem}>
                  <strong>{resultado[chave] || 0}</strong>
                  <span>{rotulo}</span>
                </div>
              ))}
            </div>
            {ehMes && (
              <p className={estilos.notaOcorrencia}>
                Dias já planejados não foram alterados.
                {resultado.preenchidoAteHoje > 0 && (
                  <>
                    {' '}
                    Dos dias preenchidos, <strong>{resultado.preenchidoAteHoje}</strong> {resultado.preenchidoAteHoje === 1 ? 'é' : 'são'} de hoje ou
                    anteriores e já {resultado.preenchidoAteHoje === 1 ? 'conta' : 'contam'} como jornada para a Folha de Pagamento.
                  </>
                )}
              </p>
            )}
            <div className={estilos.rodapePlanejamento}>
              <Button type="button" onClick={fechar}>Fechar</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
