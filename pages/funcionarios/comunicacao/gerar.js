import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../../components/RequireAuth';
import PageShell from '../../../components/shell/PageShell';
import FuncionariosSubNav from '../../../components/funcionarios/FuncionariosSubNav';
import { ROTA_DOCUMENTOS, ROTA_MODELOS, rotaDocumento } from '../../../components/documentos/ComunicacaoCabecalho';
import CampoValor from '../../../components/documentos/CampoValor';
import DocumentoA4 from '../../../components/documentos/DocumentoA4';
import PageHeader from '../../../components/ui/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Field from '../../../components/ui/Field';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import estilos from '../../../components/documentos/documentos.module.css';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSOES } from '../../../lib/auth/permissoes';
import { dataLocalHoje } from '../../../lib/data/dataLocal';
import { carregarConfig, emitirDocumento, listarFuncionarios, listarModelos } from '../../../lib/documentos/consultas';
import { montarEmissao } from '../../../lib/documentos/emissao';
import { montarDocumento } from '../../../lib/documentos/documento';
import { codigoDoErro } from '../../../lib/documentos/erros';
import { formatarData } from '../../../lib/documentos/formatacao';
import { mensagemErroDocumento, permissoesComunicacao, prepararPrevia, valoresIniciais } from '../../../lib/documentos/apresentacao';
import { ROTULO_ABRANGENCIA } from '../../../lib/documentos/modelo';
import { ordenarOpcoes } from '../../../lib/ordenacao/opcoes';

// Folha > Comunicação > Gerar documento (migration 0077):
// modelo -> (funcionário, se individual) -> respostas -> prévia -> emitir.
// A prévia usa o MESMO cálculo da emissão (montarEmissao, Etapa 1), com a
// data de hoje; a emissão definitiva é da RPC folha_documento_emitir, que
// relê tudo no banco, usa a data real do servidor (folha_hoje), numera e
// grava -- e recusa se o modelo mudou depois da prévia.
// ?modelo=<id> e ?funcionario=<id> pré-selecionam (Modelos / ficha).
function GerarConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const p = permissoesComunicacao(permissoes);
  const hoje = dataLocalHoje();

  const [modelos, setModelos] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [erroFuncionarios, setErroFuncionarios] = useState('');
  const [config, setConfig] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');

  const [modeloId, setModeloId] = useState('');
  const [funcionarioId, setFuncionarioId] = useState('');
  const [valores, setValores] = useState({});
  const [mostrarErros, setMostrarErros] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [emitindo, setEmitindo] = useState(false);
  const [erroEmissao, setErroEmissao] = useState(null);
  const [emitidoSemAcesso, setEmitidoSemAcesso] = useState(false);

  async function carregarModelosEConfig() {
    const [m, c] = await Promise.all([listarModelos(), carregarConfig()]);
    setModelos(m.filter((x) => x.ativo));
    setConfig(c);
    return m;
  }

  useEffect(() => {
    if (!router.isReady) return undefined;
    let ativo = true;
    (async () => {
      try {
        await carregarModelosEConfig();
      } catch (e) {
        if (ativo) setErroCarga(mensagemErroDocumento(e));
      }
      try {
        const f = await listarFuncionarios();
        if (ativo) setFuncionarios(f);
      } catch (e) {
        console.error('Erro ao carregar funcionários:', e);
        if (ativo) setErroFuncionarios('Não foi possível carregar os funcionários (é preciso ter acesso ao cadastro de funcionários).');
      }
      if (!ativo) return;
      if (typeof router.query.modelo === 'string') setModeloId(router.query.modelo);
      if (typeof router.query.funcionario === 'string') setFuncionarioId(router.query.funcionario);
      setCarregando(false);
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const modelo = modelos.find((m) => m.id === modeloId) || null;
  const individual = modelo?.abrangencia === 'individual';
  const funcionario = individual ? funcionarios.find((f) => f.id === funcionarioId) || null : null;

  // Respostas: as chaves são as do modelo (o banco recusa chave a mais).
  // Recarregar o MESMO modelo numa versão nova mantém o que já foi digitado
  // nos campos que continuam existindo.
  const ultimoModelo = useRef(null);
  useEffect(() => {
    const mesmoModelo = modelo && ultimoModelo.current === modelo.id;
    ultimoModelo.current = modelo ? modelo.id : null;
    setValores((atual) => {
      if (!modelo) return {};
      const iniciais = valoresIniciais(modelo.campos);
      if (mesmoModelo) for (const chave of Object.keys(iniciais)) if (typeof atual[chave] === 'string') iniciais[chave] = atual[chave];
      return iniciais;
    });
    setMostrarErros(false);
    setErroEmissao(null);
  }, [modelo?.id, modelo?.versao]); // eslint-disable-line react-hooks/exhaustive-deps

  const entrada = modelo && { modelo, funcionario, empresa: config, valores, dataEmissao: hoje };
  // Emissão real (sem número) -- o que o banco faria agora.
  const real = useMemo(() => (entrada ? montarEmissao(entrada) : null), [modelo, funcionario, config, valores, hoje]); // eslint-disable-line react-hooks/exhaustive-deps
  // Validação das respostas (mesma do banco) + prévia com "[Rótulo]" onde
  // falta resposta válida.
  const prep = useMemo(() => (modelo ? prepararPrevia(modelo.campos, valores, { hoje }) : null), [modelo, valores, hoje]);
  const previa = useMemo(() => {
    if (!prep || (individual && !funcionario)) return null;
    const r = montarEmissao({ ...entrada, modelo: { ...modelo, campos: prep.campos }, valores: prep.valores }, { previa: true });
    return { resultado: r, documento: r.snapshot ? montarDocumento(r) : null };
  }, [prep, funcionario, config]); // eslint-disable-line react-hooks/exhaustive-deps

  const errosPorChave = new Map((prep?.erros || []).map((e) => [e.chave, e.mensagem]));
  // Dados cadastrados que faltam (empresa, CPF usado no texto...) -- da
  // prévia, para aparecerem mesmo antes de o formulário estar completo.
  const pendencias = (previa?.resultado.erros || []).filter((e) => e.codigo.startsWith('config_') || e.codigo.startsWith('dado_'));
  const podeEmitir = Boolean(modelo && (!individual || funcionario) && real && real.erros.length === 0);

  function tentarEmitir() {
    setMostrarErros(true);
    if (podeEmitir) setConfirmando(true);
  }

  async function emitir() {
    setEmitindo(true);
    setErroEmissao(null);
    try {
      const id = await emitirDocumento({ modeloId: modelo.id, modeloVersao: modelo.versao, funcionarioId: individual ? funcionario.id : null, valores });
      setConfirmando(false);
      if (p.visualizar) {
        router.push(`${rotaDocumento(id)}?emitido=1`);
        return;
      }
      setEmitidoSemAcesso(true);
    } catch (e) {
      console.error('Erro ao emitir documento:', e);
      setConfirmando(false);
      setErroEmissao({ codigo: codigoDoErro(e?.message), mensagem: mensagemErroDocumento(e) });
    }
    setEmitindo(false);
  }

  async function recarregarModelo() {
    setErroEmissao(null);
    try {
      await carregarModelosEConfig();
    } catch (e) {
      setErroEmissao({ codigo: null, mensagem: mensagemErroDocumento(e) });
    }
  }

  const opcoesFuncionarios = ordenarOpcoes(funcionarios);

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="comunicacao" />
      <PageHeader
        titulo="Gerar documento"
        subtitulo="Escolha o modelo, preencha as informações, confira a prévia e emita."
        acoes={<Button variante="secondary" href={p.visualizar ? ROTA_DOCUMENTOS : ROTA_MODELOS}>← Voltar</Button>}
      />

      {emitidoSemAcesso && <Alert tom="success" className={estilos.mensagem}>Documento emitido. (Seu acesso não inclui ver os documentos emitidos.)</Alert>}
      {erroCarga && <Alert tom="danger" className={estilos.mensagem}>{erroCarga}</Alert>}

      {carregando ? (
        <p role="status">Carregando...</p>
      ) : (
        <div className={estilos.duasColunas}>
          <div className={estilos.formulario}>
            <Card titulo="1. Modelo">
              {modelos.length === 0 ? (
                <p className={estilos.secundario}>Nenhum modelo ativo. Crie ou reative um modelo em Modelos.</p>
              ) : (
                <Field label="Modelo de documento" dica={modelo ? `${ROTULO_ABRANGENCIA[modelo.abrangencia]} · v${modelo.versao}${modelo.descricao ? ` · ${modelo.descricao}` : ''}` : undefined}>
                  <Select value={modeloId} onChange={(e) => setModeloId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {modelos.map((m) => (
                      <option key={m.id} value={m.id}>{m.nome} ({ROTULO_ABRANGENCIA[m.abrangencia]})</option>
                    ))}
                  </Select>
                </Field>
              )}
            </Card>

            {modelo && individual && (
              <Card titulo="2. Funcionário">
                {erroFuncionarios ? (
                  <Alert tom="danger">{erroFuncionarios}</Alert>
                ) : (
                  <Field label="Funcionário *" dica="Ativos e inativos (documentos de desligamento ou histórico)." erro={mostrarErros && !funcionario ? 'Escolha o funcionário.' : undefined}>
                    <Select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
                      <option value="">Selecione…</option>
                      {opcoesFuncionarios.map((f) => (
                        <option key={f.id} value={f.id}>{f.nome}{f.ativo === false ? ' (inativo)' : ''}</option>
                      ))}
                    </Select>
                  </Field>
                )}
              </Card>
            )}

            {modelo && (
              <Card titulo={individual ? '3. Informações' : '2. Informações'}>
                <div className={estilos.formulario}>
                  {modelo.campos.length === 0 && <p className={estilos.secundario}>Este modelo não pede informações — o texto é fixo.</p>}
                  {modelo.campos.map((c) => (
                    <CampoValor
                      key={c.chave}
                      campo={c}
                      valor={valores[c.chave]}
                      hoje={hoje}
                      erro={mostrarErros ? errosPorChave.get(c.chave) : undefined}
                      onMudar={(v) => setValores((atual) => ({ ...atual, [c.chave]: v }))}
                    />
                  ))}
                  <p className={estilos.secundario}>
                    Data de emissão: {formatarData(hoje)} (automática)
                  </p>
                </div>
              </Card>
            )}

            {modelo && pendencias.length > 0 && (
              <Alert tom="warning">
                <strong>Antes de emitir:</strong>
                <ul className={estilos.listaErros}>
                  {pendencias.map((e, i) => (
                    <li key={`${e.codigo}-${i}`}>{e.mensagem}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {erroEmissao && (
              <Alert tom="danger">
                {erroEmissao.mensagem}
                {erroEmissao.codigo === 'emissao_modelo_alterado' && (
                  <>
                    {' '}
                    <Button tamanho="sm" variante="secondary" onClick={recarregarModelo}>Recarregar modelo</Button>
                  </>
                )}
              </Alert>
            )}

            {modelo && (
              <div className={estilos.rodapeAcoes}>
                <Button onClick={tentarEmitir} disabled={emitindo}>Emitir documento</Button>
              </div>
            )}
          </div>

          <div className={estilos.colunaPrevia}>
            <strong>Prévia</strong>
            <div className={estilos.areaFolha}>
              {!modelo ? (
                <p className={estilos.secundario}>Escolha um modelo para ver a prévia.</p>
              ) : individual && !funcionario ? (
                <p className={estilos.secundario}>Escolha o funcionário para ver a prévia.</p>
              ) : previa?.documento ? (
                <DocumentoA4 documento={previa.documento} previa />
              ) : (
                <p className={estilos.secundario}>{previa?.resultado.erros[0]?.mensagem || 'Prévia indisponível.'}</p>
              )}
            </div>
            <p className={estilos.secundario}>Campos com problema aparecem como [Rótulo]. O número é gerado na emissão.</p>
          </div>
        </div>
      )}

      {confirmando && (
        <Modal titulo="Emitir documento?" onFechar={() => !emitindo && setConfirmando(false)} largura="sm">
          <p>
            {modelo.titulo_impresso}
            {funcionario ? ` — ${funcionario.nome}` : ' — documento geral'}
          </p>
          <p className={estilos.secundario}>
            O documento recebe um número e fica registrado com a data de hoje. Depois de emitido não pode ser editado nem excluído — só cancelado (com motivo) e emitido de novo.
          </p>
          <div className={estilos.rodapeAcoes}>
            <Button variante="secondary" onClick={() => setConfirmando(false)} disabled={emitindo}>Voltar</Button>
            <Button onClick={emitir} disabled={emitindo}>{emitindo ? 'Emitindo…' : 'Emitir'}</Button>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

export default function GerarDocumentoPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_DOCUMENTOS_EMITIR}>
      <GerarConteudo />
    </RequireAuth>
  );
}
