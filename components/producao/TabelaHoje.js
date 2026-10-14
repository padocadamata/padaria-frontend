import { useState } from 'react';
import DataTable from '../ui/DataTable';
import Badge from '../ui/Badge';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import MarcadorFalta from './MarcadorFalta';
import { permissoesTurno, acoesDoTurno, ModalTurno } from './turnoProducao';
import { validarQuantidadePositiva, iniciarProducao, adicionarProducao, calcularFechamento, fecharTurno } from '../../lib/producao/operacoesTurno';
import styles from './TabelaHoje.module.css';

// Tela Hoje no DESKTOP: tabela comum do sistema (DataTable) com UMA linha
// operacional por Produto × Turno (lib/producao/linhasHoje):
//   Produto | Turno | Situação | Produção | Fechamento | Ações
// O nome do produto aparece na primeira linha visível dele; as seguintes
// ficam subordinadas (o nome segue presente para leitores de tela), e uma
// divisória mais forte separa um produto do próximo.
//
// Operação ROTINEIRA direto na linha: Iniciar (quantidade), Adicionar
// (+ quantidade) e Fechar (sobra / aproveitável / perda). Operações
// excepcionais continuam no modal de sempre: Gerenciar sobras, Reabrir e
// Corrigir e fechar.
//
// Nenhuma regra nova: permissões/ações de ./turnoProducao (as do cartão);
// validação, mensagens e gravação de lib/producao/operacoesTurno (as dos
// modais).

const SITUACAO = {
  aberto: { tom: 'warning', rotulo: 'Em produção' },
  fechado: { tom: 'success', rotulo: 'Fechado' },
  reaberto: { tom: 'danger', rotulo: 'Em correção' },
};

const ICONE_MODAL = {
  sobras: { icone: 'clipboard', rotulo: 'Gerenciar sobras' },
  reabrir: { icone: 'undo', rotulo: 'Reabrir' },
  corrigir: { icone: 'pencil', rotulo: 'Corrigir e fechar' },
};

const VAZIO = { quantidade: '', sobraTotal: '', aproveitavel: '', perda: '', salvando: null, erro: '', erroOrigem: null };

export default function TabelaHoje({ linhas, data, corPrimaria, permissoes, perfilUsuario, onAtualizado }) {
  // Estado de digitação/gravação/erro por Produto × Turno (chave da linha):
  // digitar numa linha nunca afeta outra.
  const [estados, setEstados] = useState({});
  // Um modal por vez (operações excepcionais): { chave, acao }.
  const [modal, setModal] = useState(null);

  const estadoDe = (chave) => estados[chave] || VAZIO;
  const atualizar = (chave, patch) => setEstados((atual) => ({ ...atual, [chave]: { ...(atual[chave] || VAZIO), ...patch } }));

  function contexto(linha) {
    const perms = permissoesTurno({ registro: linha.registro, permissoes, perfilUsuario });
    const pode = new Set(acoesDoTurno(linha.registro, perms).map((a) => a.acao));
    return { perms, pode, nome: `${linha.receitaNome}, ${linha.turnoLabel}` };
  }

  async function executar(linha, acao, origem, gravar) {
    atualizar(linha.chave, { salvando: acao, erro: '', erroOrigem: null });
    const { erro } = await gravar();
    if (erro) {
      atualizar(linha.chave, { salvando: null, erro, erroOrigem: origem });
      return;
    }
    setEstados((atual) => {
      const { [linha.chave]: _limpo, ...resto } = atual;
      return resto;
    });
    onAtualizado();
  }

  function enviarQuantidade(e, linha, acao) {
    e.preventDefault();
    const est = estadoDe(linha.chave);
    if (est.salvando) return;
    const { valor, erro } = validarQuantidadePositiva(est.quantidade);
    if (erro) {
      atualizar(linha.chave, { erro, erroOrigem: 'producao' });
      return;
    }
    executar(linha, acao, 'producao', () =>
      acao === 'iniciar'
        ? iniciarProducao({ data, turno: linha.turno, receitaId: linha.receitaId, quantidade: valor })
        : adicionarProducao({ registroId: linha.registro.id, quantidade: valor })
    );
  }

  function calculoFechamento(linha) {
    const est = estadoDe(linha.chave);
    return calcularFechamento({
      produzida: String(linha.registro.quantidade_produzida),
      sobraTotal: est.sobraTotal,
      aproveitavel: est.aproveitavel,
      perda: est.perda,
    });
  }

  function enviarFechamento(e, linha) {
    e.preventDefault();
    if (estadoDe(linha.chave).salvando) return;
    const calculo = calculoFechamento(linha);
    if (calculo.erro) {
      atualizar(linha.chave, { erro: calculo.erro, erroOrigem: 'fechamento' });
      return;
    }
    executar(linha, 'fechar', 'fechamento', () => fecharTurno({ registroId: linha.registro.id, calculo }));
  }

  function campo(linha, nomeCampo, rotulo, placeholder, nome) {
    const est = estadoDe(linha.chave);
    return (
      <Input
        type="number"
        inputMode="numeric"
        min="0"
        className={styles.campo}
        value={est[nomeCampo]}
        placeholder={placeholder}
        title={rotulo}
        aria-label={`${rotulo} — ${nome}`}
        disabled={!!est.salvando}
        onChange={(e) => atualizar(linha.chave, { [nomeCampo]: e.target.value, ...(est.erro ? { erro: '', erroOrigem: null } : {}) })}
      />
    );
  }

  function erroDe(linha, origem) {
    const est = estadoDe(linha.chave);
    return est.erro && est.erroOrigem === origem ? (
      <p className={styles.erro} role="alert">
        {est.erro}
      </p>
    ) : null;
  }

  const colunas = [
    {
      chave: 'produto',
      rotulo: 'Produto',
      largura: '18%',
      render: (l) =>
        l.primeiraDoProduto ? (
          <span className={styles.produto}>{l.receitaNome}</span>
        ) : (
          <span className={styles.somenteLeitor}>{l.receitaNome}</span>
        ),
    },
    { chave: 'turno', rotulo: 'Turno', largura: '72px', render: (l) => <span className={styles.turno}>{l.turnoLabel}</span> },
    {
      chave: 'situacao',
      rotulo: 'Situação',
      largura: '33%',
      render: (l) => {
        const { perms } = contexto(l);
        const situacao = l.registro ? SITUACAO[l.registro.status] : null;
        return (
          <div className={styles.situacao}>
            <div className={styles.linha}>
              {situacao ? <Badge tom={situacao.tom}>{situacao.rotulo}</Badge> : <span className={styles.muted}>Sem produção</span>}
              {l.registro?.status === 'fechado' && (
                <span className={styles.falta}>
                  <MarcadorFalta registro={l.registro} podeEditar={perms.podeEditar} onAtualizado={onAtualizado} />
                  Falta
                </span>
              )}
            </div>
            <Resumo registro={l.registro} />
            {l.registro?.status === 'fechado' && l.registro.observacoes && (
              <p className={styles.obs} title={l.registro.observacoes}>
                {l.registro.observacoes}
              </p>
            )}
          </div>
        );
      },
    },
    {
      chave: 'producao',
      rotulo: 'Produção',
      largura: '16%',
      render: (l) => {
        const { pode, nome } = contexto(l);
        const est = estadoDe(l.chave);
        const acao = !l.registro && pode.has('iniciar') ? 'iniciar' : l.registro?.status === 'aberto' && pode.has('adicionar') ? 'adicionar' : null;
        if (!acao) return null;
        return (
          <>
            <form className={styles.form} onSubmit={(e) => enviarQuantidade(e, l, acao)}>
              {campo(l, 'quantidade', acao === 'iniciar' ? 'Quantidade produzida' : 'Quantidade adicional assada', acao === 'iniciar' ? 'Qtd' : '+ Qtd', nome)}
              <IconButton
                type="submit"
                icone={acao === 'iniciar' ? 'play' : 'plus'}
                tamanho="sm"
                rotulo={`${acao === 'iniciar' ? 'Iniciar produção' : 'Adicionar produção'} — ${nome}`}
                disabled={!!est.salvando}
              />
            </form>
            {erroDe(l, 'producao')}
          </>
        );
      },
    },
    {
      chave: 'fechamento',
      rotulo: 'Fechamento',
      largura: '23%',
      render: (l) => {
        const { pode, nome } = contexto(l);
        if (l.registro?.status !== 'aberto' || !pode.has('fechar')) return null;
        const est = estadoDe(l.chave);
        const calculo = calculoFechamento(l);
        const algoDigitado = est.sobraTotal !== '' || est.aproveitavel !== '' || est.perda !== '';
        return (
          <>
            <form className={styles.form} onSubmit={(e) => enviarFechamento(e, l)}>
              {campo(l, 'sobraTotal', 'Sobra total', 'Sobra', nome)}
              {campo(l, 'aproveitavel', 'Sobra aproveitável', 'Aprov', nome)}
              {campo(l, 'perda', 'Perda / descarte', 'Perda', nome)}
              <IconButton
                type="submit"
                icone="check"
                tamanho="sm"
                rotulo={`Fechar turno — ${nome}`}
                disabled={!!est.salvando || (algoDigitado && calculo.bloqueado)}
              />
            </form>
            {algoDigitado && !calculo.bloqueado && calculo.quantidadeVendida != null && (
              <p className={styles.muted} title="Quantidade vendida (calculada) = produzido − sobra total">
                vende {calculo.quantidadeVendida}
              </p>
            )}
            {algoDigitado && calculo.bloqueado && calculo.erro && est.erroOrigem !== 'fechamento' && (
              <p className={styles.erro} role="alert">
                {calculo.erro}
              </p>
            )}
            {erroDe(l, 'fechamento')}
          </>
        );
      },
    },
  ];

  function renderAcoes(l) {
    const { pode, nome } = contexto(l);
    const est = estadoDe(l.chave);
    const icones = Object.keys(ICONE_MODAL).filter((a) => pode.has(a));
    return (
      <span className={styles.icones}>
        {est.salvando && (
          <span className={styles.muted} role="status">
            Salvando...
          </span>
        )}
        {icones.map((a) => (
          <IconButton
            key={a}
            icone={ICONE_MODAL[a].icone}
            rotulo={`${ICONE_MODAL[a].rotulo} — ${nome}`}
            tamanho="sm"
            onClick={() => setModal({ chave: l.chave, acao: a })}
          />
        ))}
      </span>
    );
  }

  const linhaDoModal = modal ? linhas.find((l) => l.chave === modal.chave) : null;

  return (
    <div className={styles.superficie}>
      <DataTable
        rotulo="Produção de hoje por produto e turno"
        colunas={colunas}
        linhas={linhas}
        chaveLinha={(l) => l.chave}
        grupo={{ chave: (l) => l.receitaId, rotulo: (l) => l.receitaNome }}
        cartoesAte={0}
        layoutFixo
        larguraAcoes="96px"
        renderAcoes={renderAcoes}
      />
      {linhaDoModal && (
        <ModalTurno
          acaoAberta={modal.acao}
          registro={linhaDoModal.registro}
          data={data}
          turno={linhaDoModal.turno}
          receitaId={linhaDoModal.receitaId}
          receitaNome={linhaDoModal.receitaNome}
          label={linhaDoModal.turnoLabel}
          corPrimaria={corPrimaria}
          onConcluido={() => {
            setModal(null);
            onAtualizado();
          }}
          onFechar={() => setModal(null)}
        />
      )}
    </div>
  );
}

// Os mesmos valores que o cartão mostra em cada estado (nenhum novo), numa
// linha discreta: "Produzido 120 · Vendido 104 · Sobra 16 · Aprov. 10 · Perda 6".
function Resumo({ registro }) {
  if (!registro) return null;
  let itens = [];
  if (registro.status === 'aberto') {
    itens = [{ r: 'Produzido', v: registro.quantidade_produzida }];
  } else if (registro.status === 'fechado') {
    itens = [
      { r: 'Produzido', v: registro.quantidade_produzida },
      { r: 'Vendido', v: registro.quantidade_vendida },
      { r: 'Sobra', v: registro.sobra_total, t: 'Sobra total' },
      { r: 'Aprov.', v: registro.sobra_aproveitavel, t: 'Sobra aproveitável' },
      { r: 'Perda', v: registro.perda_descarte, t: 'Perda/descarte' },
    ];
  } else if (registro.status === 'reaberto') {
    itens = [
      { r: 'Produzido', v: registro.quantidade_produzida, t: 'Produzido (atual)' },
      { r: 'Aprov.', v: registro.sobra_aproveitavel, t: 'Sobra aproveitável (atual)' },
      { r: 'Perda', v: registro.perda_descarte, t: 'Perda/descarte (atual) — os valores antigos foram preservados' },
    ];
  }
  return (
    <span className={styles.resumo}>
      {itens.map((i, n) => (
        <span key={i.r} title={i.t || i.r}>
          {n > 0 && <span className={styles.sep}> · </span>}
          {i.r} <strong>{i.v ?? '—'}</strong>
        </span>
      ))}
    </span>
  );
}
