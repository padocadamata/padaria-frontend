import { useEffect, useState } from 'react';
import Card from '../ui/Card';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import IndicadorVinculo from './IndicadorVinculo';
import ConfiguracaoFuncionarioModal from './ConfiguracaoFuncionarioModal';
import FeriadosCard from './FeriadosCard';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import {
  buscarValorHoraVigente,
  buscarHistoricoValorHora,
  inserirValorHoraGlobal,
  buscarFormaRemuneracaoAtualEmLote,
  formatarMoeda,
} from '../../lib/funcionarios/pagamentos';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Valor/hora GLOBAL (não por funcionário, decisão explícita de 0065) --
// mostra o vigente, histórico de vigências, e um formulário para nova
// vigência. NUNCA edita/apaga uma vigência existente -- sempre insere uma
// linha nova (histórico imutável, migration 0065).
function ValorHoraCard({ podeRegras }) {
  const [vigente, setVigente] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [novoValor, setNovoValor] = useState('');
  const [vigenciaNova, setVigenciaNova] = useState(dataLocalHoje());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true);
    const [v, h] = await Promise.all([buscarValorHoraVigente(), buscarHistoricoValorHora()]);
    setVigente(v);
    setHistorico(h);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar() {
    setErro('');
    const valorNumerico = Number(novoValor);
    if (!novoValor || valorNumerico <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    if (!vigenciaNova) {
      setErro('Informe a data de vigência.');
      return;
    }
    setSalvando(true);
    const { erro: erroRpc } = await inserirValorHoraGlobal(valorNumerico, vigenciaNova);
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    setNovoValor('');
    await carregar();
  }

  return (
    <Card titulo="Valor/hora global" subtitulo="Usado em toda jornada por_hora e em todo extra remunerado de pessoa mensal.">
      {carregando ? (
        <p role="status">Carregando...</p>
      ) : (
        <>
          <div className={estilosPagamentos.resumoLinha}>
            <span>Vigente hoje</span>
            {vigente ? (
              <strong>
                {formatarMoeda(vigente.valor)} (desde {formatarDataExibicao(vigente.vigente_desde)})
              </strong>
            ) : (
              <span className={estilosPagamentos.naoConfigurado}>Não configurado</span>
            )}
          </div>

          {historico
            .filter((h) => h.vigente_desde > dataLocalHoje())
            .map((h) => (
              <div key={h.vigente_desde} className={estilosPagamentos.resumoLinha}>
                <span>Próxima vigência</span>
                <strong>
                  {formatarMoeda(h.valor)} (a partir de {formatarDataExibicao(h.vigente_desde)})
                </strong>
              </div>
            ))}
          <p className={estilosPagamentos.vazio}>
            Cálculo por minuto: duração ÷ 60 × valor/hora vigente na data da jornada. Nova vigência nunca altera jornadas já pagas.
          </p>

          {podeRegras && (
            <div className={estilosEscala.linhaOcorrencia}>
              <Input type="number" step="0.01" min="0" placeholder="Novo valor/hora" value={novoValor} onChange={(e) => setNovoValor(e.target.value)} />
              <Input type="date" value={vigenciaNova} onChange={(e) => setVigenciaNova(e.target.value)} aria-label="Vigente desde" />
              <Button type="button" variante="secondary" tamanho="sm" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar nova vigência'}
              </Button>
            </div>
          )}
          {erro && <Alert tom="danger">{erro}</Alert>}

          <Button type="button" variante="secondary" tamanho="sm" onClick={() => setMostrarHistorico((v) => !v)}>
            {mostrarHistorico ? 'Ocultar histórico' : 'Ver histórico'}
          </Button>
          {mostrarHistorico && (
            <ul className={estilosPagamentos.listaJornadas}>
              {historico.map((h) => (
                <li key={h.vigente_desde}>
                  {formatarMoeda(h.valor)} — desde {formatarDataExibicao(h.vigente_desde)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export default function PagamentosConfiguracoesVisao({ funcionarios, podeRegras, podeEditar }) {
  const [formaPorFuncionario, setFormaPorFuncionario] = useState(new Map());
  const [carregando, setCarregando] = useState(true);
  const [funcionarioEditando, setFuncionarioEditando] = useState(null);

  async function carregarFormas() {
    const mapa = await buscarFormaRemuneracaoAtualEmLote(funcionarios.map((f) => f.id));
    setFormaPorFuncionario(mapa);
    setCarregando(false);
  }

  useEffect(() => {
    carregarFormas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funcionarios]);

  return (
    <div className={estilosPagamentos.colunaSecoes}>
      <ValorHoraCard podeRegras={podeRegras} />
      <FeriadosCard podeRegras={podeRegras} />

      <section>
        <h3 className={estilosPagamentos.tituloSecao}>Configuração por funcionário</h3>
        {carregando ? (
          <p role="status">Carregando...</p>
        ) : (
          <div className={estilosPagamentos.listaConfiguracoes}>
            {funcionarios.map((f) => {
              const forma = formaPorFuncionario.get(f.id);
              return (
                <div key={f.id} className={estilosPagamentos.linhaConfiguracao}>
                  <div className={estilosPagamentos.infoConfiguracao}>
                    <strong>{f.nome}</strong>
                    <IndicadorVinculo tipoVinculo={f.tipo_vinculo} />
                    {forma ? (
                      <Badge tom="info">{forma === 'mensal' ? 'Mensal' : 'Por hora'}</Badge>
                    ) : (
                      <span className={estilosPagamentos.naoConfigurado}>Não configurado</span>
                    )}
                  </div>
                  <Button variante="secondary" tamanho="sm" onClick={() => setFuncionarioEditando(f)}>
                    Configurar
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {funcionarioEditando && (
        <ConfiguracaoFuncionarioModal
          funcionario={funcionarioEditando}
          podeRegras={podeRegras}
          podeEditar={podeEditar}
          onFechar={() => setFuncionarioEditando(null)}
          onSalvo={carregarFormas}
        />
      )}
    </div>
  );
}
