import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import SomenteAdmin from '../../components/importacoes/SomenteAdmin';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import styles from '../../components/importacoes/importacoes.module.css';
import { createClient } from '../../lib/supabase/client';
import { LAYOUTS, detectarLayout, mascararClientes, resumirRelatorio } from '../../lib/importacoes/layouts';
import { calcularSha256, enviarImportacao } from '../../lib/importacoes/envio';
import { formatarBytes, formatarData, listarImportacoes, mensagemDeErro, somarDias } from '../../lib/importacoes/consultas';

// Nova importação (migration 0081). O arquivo é lido e mascarado NO
// NAVEGADOR; só as linhas (sem nome/CPF de cliente) vão para o banco, em
// blocos, direto ao Supabase. Depois do envio, a prévia abre no lote.

const INSTRUCOES = {
  vendas_produto_cliente: 'Relatório "Vendas de Produtos por Cliente": período desejado, situação FINALIZADO, sem filtro de seção, categoria, produto ou cliente.',
  faturamento_geral: 'Relatório "Faturamento Geral": período desejado e a empresa PADOCA DA MATA, sem outros filtros.',
  vendas_periodo: 'Relatório "Vendas por Dia/Mês/Ano": período desejado, a empresa PADOCA DA MATA e agrupamento DIÁRIO.',
};

function Dado({ rotulo, children }) {
  return (
    <div className={styles.dado}>
      <span className={styles.dadoRotulo}>{rotulo}</span>
      <span className={styles.dadoValor}>{children}</span>
    </div>
  );
}

function NovaImportacao() {
  const router = useRouter();
  const supabase = createClient();
  const entrada = useRef(null);
  const [sugestoes, setSugestoes] = useState({});
  const [lendo, setLendo] = useState(false);
  const [preparado, setPreparado] = useState(null);
  const [erro, setErro] = useState('');
  const [progresso, setProgresso] = useState(null);

  // Sugestão de período incremental: desde o último dia completo de cada
  // relatório menos 7 dias (a sobreposição não duplica nada).
  useEffect(() => {
    listarImportacoes(supabase, { limite: 200, status: 'confirmado' })
      .then((lotes) => {
        const s = {};
        for (const l of lotes) {
          if (l.cobertura_completa_fim && (!s[l.layout] || l.cobertura_completa_fim > s[l.layout])) s[l.layout] = l.cobertura_completa_fim;
        }
        setSugestoes(s);
      })
      .catch(() => setSugestoes({}));
  }, [supabase]);

  async function escolher(evento) {
    const arquivo = evento.target.files?.[0];
    setErro('');
    setPreparado(null);
    if (!arquivo) return;
    setLendo(true);
    try {
      if (!/\.xlsx$/i.test(arquivo.name)) throw new Error('Escolha o arquivo .xlsx exportado do G3.');
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const { lerPlanilha } = await import('../../lib/importacoes/leitorXlsx');
      const { linhas, metadados } = await lerPlanilha(bytes);
      const layout = detectarLayout(linhas);
      if (!layout) throw new Error('Relatório não reconhecido. Os aceitos são: Vendas por Produto e Cliente, Faturamento Geral e Vendas por Dia/Mês/Ano.');
      const resumo = resumirRelatorio(layout, linhas);
      const { linhas: mascaradas, mascarados } = mascararClientes(layout, linhas);
      const sha256 = await calcularSha256(bytes);
      setPreparado({ arquivo: { nome: arquivo.name, tamanho: arquivo.size, sha256 }, layout, metadados, resumo, linhas: mascaradas, mascarados });
    } catch (e) {
      setErro(e.message || 'Não foi possível ler o arquivo.');
    } finally {
      setLendo(false);
    }
  }

  function trocarArquivo() {
    setPreparado(null);
    setErro('');
    if (entrada.current) entrada.current.value = '';
  }

  async function enviar() {
    if (!preparado) return;
    setErro('');
    setProgresso({ etapa: 'iniciando', enviadas: 0, total: preparado.linhas.length });
    try {
      const { id } = await enviarImportacao(supabase, { ...preparado, aoProgredir: setProgresso });
      router.push(`/importacoes/${id}`);
    } catch (e) {
      setErro(mensagemDeErro(e));
      setProgresso(null);
    }
  }

  const bloqueado = preparado && preparado.resumo.avisos.length > 0;
  const enviando = progresso !== null;
  const pct = progresso && progresso.total ? Math.round((progresso.enviadas / progresso.total) * 100) : 0;

  return (
    <PageShell titulo="Importações G3">
      <div className={styles.pilha}>
        <PageHeader
          titulo="Nova importação"
          subtitulo="Escolha um relatório exportado do G3, sem editar. Nada é gravado antes de você conferir a prévia e confirmar."
          acoes={<Button href="/importacoes" variante="secondary">Voltar</Button>}
        />

        <Card titulo="Relatórios aceitos">
          <div className={styles.relatorios}>
            {Object.values(LAYOUTS).map((l) => (
              <div key={l.chave} className={styles.relatorio}>
                <h3 className={styles.relatorioTitulo}>{l.nome}</h3>
                <p className={styles.textoPequeno}>{l.descricao}</p>
                <p className={styles.textoPequeno}>{INSTRUCOES[l.chave]}</p>
                {sugestoes[l.chave] && (
                  <p className={styles.textoPequeno}>
                    <strong>Sugestão de período:</strong> a partir de {formatarData(somarDias(sugestoes[l.chave], -7))} (último dia completo importado: {formatarData(sugestoes[l.chave])}).
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card titulo="Arquivo">
          <div className={styles.pilha}>
            <div className={styles.arquivo}>
              <label htmlFor="arquivo-g3" className={styles.dadoRotulo}>Relatório do G3 (.xlsx, até 30 MB)</label>
              <input
                id="arquivo-g3"
                ref={entrada}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={escolher}
                disabled={lendo || enviando}
              />
              <p className={styles.textoPequeno}>
                O arquivo é lido no seu navegador. Nomes e CPF/CNPJ de clientes são substituídos aqui mesmo, antes do envio, e nunca chegam ao sistema.
              </p>
            </div>
            {lendo && <p className={styles.texto}>Lendo e conferindo o arquivo…</p>}
            {erro && <Alert tom="danger">{erro}</Alert>}
          </div>
        </Card>

        {preparado && (
          <Card titulo={LAYOUTS[preparado.layout].nome} subtitulo="Confira antes de enviar. A validação completa acontece no servidor e aparece na prévia.">
            <div className={styles.pilha}>
              <div className={styles.grade}>
                <Dado rotulo="Arquivo">{preparado.arquivo.nome}</Dado>
                <Dado rotulo="Tamanho">{formatarBytes(preparado.arquivo.tamanho)}</Dado>
                <Dado rotulo="Período">{preparado.resumo.periodo || '—'}</Dado>
                <Dado rotulo="Gerado no G3">{preparado.resumo.geradoEm || '—'}</Dado>
                <Dado rotulo="Linhas da planilha">{preparado.linhas.length.toLocaleString('pt-BR')}</Dado>
                <Dado rotulo="Origem">
                  {preparado.metadados.original ? <Badge tom="success">Original do G3</Badge> : <Badge tom="warning">Regravado em outro programa</Badge>}
                </Dado>
                <Dado rotulo="Clientes mascarados">{preparado.mascarados}</Dado>
              </div>
              {!preparado.metadados.original && (
                <Alert tom="warning">O arquivo foi salvo de novo em outro programa. Ele só será aceito se passar em todas as validações de estrutura, conteúdo e totais.</Alert>
              )}
              {bloqueado && (
                <Alert tom="danger">
                  <ul className={styles.lista}>{preparado.resumo.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
                </Alert>
              )}
              {enviando && (
                <div className={styles.pilha}>
                  <div className={styles.barra} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso do envio">
                    <div className={styles.barraPreenchida} style={{ width: `${progresso.etapa === 'previa' ? 100 : pct}%` }} />
                  </div>
                  <p className={styles.texto} aria-live="polite">
                    {progresso.etapa === 'iniciando' && 'Iniciando o lote…'}
                    {progresso.etapa === 'enviando' && `Enviando linhas: ${progresso.enviadas.toLocaleString('pt-BR')} de ${progresso.total.toLocaleString('pt-BR')}…`}
                    {progresso.etapa === 'previa' && 'Validando e gerando a prévia no servidor…'}
                  </p>
                </div>
              )}
              <div className={styles.acoes}>
                <Button variante="primary" onClick={enviar} disabled={bloqueado || enviando}>Enviar e gerar prévia</Button>
                <Button variante="secondary" onClick={trocarArquivo} disabled={enviando}>Trocar arquivo</Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

export default function PaginaNovaImportacao() {
  return (
    <RequireAuth>
      <SomenteAdmin>
        <NovaImportacao />
      </SomenteAdmin>
    </RequireAuth>
  );
}
