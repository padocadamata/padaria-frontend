import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { resumirResultadoAplicacaoPadrao } from '../../lib/funcionarios/escala';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import IndicadorVinculo from './IndicadorVinculo';
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

// "Preencher pela Escala Padrão" (seção "AJUSTE ARQUITETURAL" aprovada) --
// chama SOMENTE a RPC aplicar_escala_padrao, que decide tudo (o que já
// existe, o que preencher) atomicamente no banco. O frontend nunca lê a
// grade antes para decidir o que mandar -- só informa funcionários e a
// semana em exibição; a corrida de concorrência é resolvida inteiramente
// do lado do Postgres (ver comentário no topo da migration 0059).
export default function EscalaPadraoLoteModal({ funcionarios, dias, onFechar, onAplicado }) {
  const [funcionarioIds, setFuncionarioIds] = useState([]);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null); // resumo por situação, após aplicar

  function alternarFuncionario(id) {
    setFuncionarioIds((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

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

    setResultado(resumirResultadoAplicacaoPadrao(data));
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
            <p className={estilos.notaOcorrencia}>
              Preenche, nesta semana em exibição, somente os dias que ainda não têm escala definida para os funcionários
              selecionados — nunca sobrescreve um dia já planejado.
            </p>

            <Field label="Funcionários">
              <div className={estilos.selecaoFuncionarios}>
                {funcionarios.map((f) => (
                  <Checkbox
                    key={f.id}
                    rotulo={<>{f.nome}<IndicadorVinculo tipoVinculo={f.tipo_vinculo} /></>}
                    checked={funcionarioIds.includes(f.id)}
                    onChange={() => alternarFuncionario(f.id)}
                  />
                ))}
              </div>
            </Field>

            {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

            <div className={estilos.rodapePlanejamento}>
              <Button type="button" onClick={aplicar} disabled={aplicando}>
                {aplicando ? 'Aplicando...' : 'Aplicar'}
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
            <div className={estilos.rodapePlanejamento}>
              <Button type="button" onClick={fechar}>Fechar</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
