import { useEffect, useState } from 'react';
import Card from '../ui/Card';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { rotuloDiaSemana } from '../../lib/funcionarios/escala';
import { buscarFeriados, registrarFeriado, removerFeriado } from '../../lib/funcionarios/pagamentos';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Feriados usados para calcular DIAS ÚTEIS das datas previstas de
// pagamento (ex.: "5º dia útil") -- migration 0068. A fonte é
// public.feriados_nacionais, a mesma tabela de feriados já exibida no
// planejamento da Produção (nenhuma lista fixa no frontend). Sábado e
// domingo nunca são dias úteis; feriado só conta se estiver cadastrado aqui.
export default function FeriadosCard({ podeRegras }) {
  const anoAtual = dataLocalHoje().slice(0, 4);
  const inicio = `${anoAtual}-01-01`;
  const fim = `${Number(anoAtual) + 1}-12-31`;
  const [feriados, setFeriados] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novaData, setNovaData] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true);
    setFeriados(await buscarFeriados(inicio, fim));
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function adicionar() {
    setErro('');
    if (!novaData || !novoNome.trim()) {
      setErro('Informe a data e o nome do feriado.');
      return;
    }
    setSalvando(true);
    const { erro: erroRpc } = await registrarFeriado(novaData, novoNome.trim());
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    setNovaData('');
    setNovoNome('');
    carregar();
  }

  async function remover(data) {
    setErro('');
    const { erro: erroRpc } = await removerFeriado(data);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    carregar();
  }

  const doAnoAtual = feriados.filter((f) => f.data.startsWith(anoAtual)).length;

  return (
    <Card titulo="Feriados (dias úteis)" subtitulo="Usados só para calcular datas previstas, como o 5º dia útil. Sábado e domingo nunca são dias úteis.">
      {carregando ? (
        <p role="status">Carregando...</p>
      ) : (
        <>
          {doAnoAtual === 0 && (
            <p className={estilosPagamentos.prevista}>
              Nenhum feriado cadastrado para {anoAtual}: dias úteis estão sendo contados só de segunda a sexta.
            </p>
          )}
          {feriados.length > 0 && (
            <ul className={estilosPagamentos.listaJornadas}>
              {feriados.map((f) => (
                <li key={f.data} className={estilosPagamentos.resumoLinha}>
                  <span>
                    {rotuloDiaSemana(f.data)} {formatarData(f.data)} — {f.nome}
                  </span>
                  {podeRegras && (
                    <Button type="button" variante="secondary" tamanho="sm" onClick={() => remover(f.data)}>
                      Remover
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {podeRegras && (
            <div className={estilosEscala.linhaOcorrencia}>
              <Input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} aria-label="Data do feriado" />
              <Input placeholder="Nome do feriado" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} aria-label="Nome do feriado" />
              <Button type="button" variante="secondary" tamanho="sm" onClick={adicionar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Adicionar feriado'}
              </Button>
            </div>
          )}
          <p className={estilosPagamentos.vazio}>Esta lista também aparece no planejamento da Produção.</p>
          {erro && <Alert tom="danger">{erro}</Alert>}
        </>
      )}
    </Card>
  );
}
