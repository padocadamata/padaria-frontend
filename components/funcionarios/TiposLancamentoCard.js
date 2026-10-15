import { useEffect, useState } from 'react';
import Card from '../ui/Card';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { buscarTiposLancamento, salvarTipoLancamento } from '../../lib/funcionarios/lancamentos';
import { NATUREZAS_LANCAMENTO, rotuloNatureza, sinalNatureza } from '../../lib/funcionarios/lancamentosCalculo';
import { cx } from '../../lib/design/cx';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

// Tipos de LANÇAMENTO (migration 0076) -- catálogo parametrizável usado no
// "Novo lançamento" de A Pagar. Natureza = sugestão ao lançar (o lançamento
// guarda a sua). Sem exclusão: tipo em desuso é inativado -- some dos novos
// lançamentos; histórico e pendentes já criados continuam como estão.
// Escrita somente por RPC (folha_pagamentos.regras).
export default function TiposLancamentoCard({ podeRegras }) {
  const [tipos, setTipos] = useState([]);
  const [disponivel, setDisponivel] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [novaNatureza, setNovaNatureza] = useState('desconto');
  const [edicao, setEdicao] = useState(null); // { id, nome, natureza }
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true);
    const r = await buscarTiposLancamento();
    setTipos(r.tipos);
    setDisponivel(r.disponivel);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar(dados) {
    setErro('');
    setSalvando(true);
    const { erro: erroRpc } = await salvarTipoLancamento(dados);
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return false;
    }
    await carregar();
    return true;
  }

  async function adicionar() {
    if (!novoNome.trim()) {
      setErro('Informe o nome do tipo.');
      return;
    }
    if (await salvar({ nome: novoNome.trim(), natureza: novaNatureza, ativo: true })) {
      setNovoNome('');
      setNovaNatureza('desconto');
    }
  }

  async function salvarEdicao(tipo) {
    if (!edicao.nome.trim()) {
      setErro('Informe o nome do tipo.');
      return;
    }
    if (await salvar({ id: tipo.id, nome: edicao.nome.trim(), natureza: edicao.natureza, ativo: tipo.ativo })) setEdicao(null);
  }

  if (!disponivel && !carregando) return null;

  return (
    <Card titulo="Tipos de lançamento" subtitulo="Usados para registrar descontos e acréscimos pendentes (ex.: compra na Padoca). A natureza é só a sugestão ao lançar.">
      {carregando ? (
        <p role="status">Carregando...</p>
      ) : (
        <>
          {tipos.length === 0 && <p className={estilosPagamentos.prevista}>Nenhum tipo cadastrado ainda.</p>}
          {tipos.length > 0 && (
            <ul className={estilosPagamentos.listaTiposLancamento}>
              {tipos.map((t) => (
                <li key={t.id} className={cx(estilosPagamentos.itemTipoLancamento, !t.ativo && estilosPagamentos.itemTipoInativo)}>
                  {edicao?.id === t.id ? (
                    <div className={estilosEscala.linhaOcorrencia}>
                      <Input value={edicao.nome} maxLength={60} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} aria-label="Nome do tipo" />
                      <Select value={edicao.natureza} onChange={(e) => setEdicao({ ...edicao, natureza: e.target.value })} aria-label="Natureza padrão">
                        {NATUREZAS_LANCAMENTO.map((n) => (
                          <option key={n.valor} value={n.valor}>
                            {n.sinal} {n.rotulo}
                          </option>
                        ))}
                      </Select>
                      <Button type="button" tamanho="sm" onClick={() => salvarEdicao(t)} disabled={salvando}>
                        Salvar
                      </Button>
                      <Button type="button" variante="secondary" tamanho="sm" onClick={() => setEdicao(null)} disabled={salvando}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className={estilosPagamentos.tipoLancamentoInfo}>
                        <strong>{t.nome}</strong>
                        <Badge tom={t.natureza === 'acrescimo' ? 'info' : 'warning'}>
                          {sinalNatureza(t.natureza)} {rotuloNatureza(t.natureza)}
                        </Badge>
                        <Badge tom={t.ativo ? 'success' : 'neutral'}>{t.ativo ? 'Ativo' : 'Inativo'}</Badge>
                      </span>
                      {podeRegras && (
                        <span className={estilosPagamentos.lancamentoAcoes}>
                          <Button type="button" variante="secondary" tamanho="sm" onClick={() => setEdicao({ id: t.id, nome: t.nome, natureza: t.natureza })} disabled={salvando}>
                            Editar
                          </Button>
                          <Button type="button" variante="secondary" tamanho="sm" onClick={() => salvar({ id: t.id, nome: t.nome, natureza: t.natureza, ativo: !t.ativo })} disabled={salvando}>
                            {t.ativo ? 'Inativar' : 'Ativar'}
                          </Button>
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {podeRegras && (
            <div className={estilosEscala.linhaOcorrencia}>
              <Input placeholder="Nome do tipo (ex.: Compra na Padoca)" value={novoNome} maxLength={60} onChange={(e) => setNovoNome(e.target.value)} aria-label="Nome do novo tipo" />
              <Select value={novaNatureza} onChange={(e) => setNovaNatureza(e.target.value)} aria-label="Natureza padrão do novo tipo">
                {NATUREZAS_LANCAMENTO.map((n) => (
                  <option key={n.valor} value={n.valor}>
                    {n.sinal} {n.rotulo}
                  </option>
                ))}
              </Select>
              <Button type="button" variante="secondary" tamanho="sm" onClick={adicionar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Adicionar tipo'}
              </Button>
            </div>
          )}
          {erro && <Alert tom="danger">{erro}</Alert>}
        </>
      )}
    </Card>
  );
}
