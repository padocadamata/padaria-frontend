import AcoesLinha from '../ui/AcoesLinha';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import Input from '../ui/Input';
import {
  diaEditavel, horas, leituraDoSaldo, rotuloDia, seloSituacao, textoPendencias, textoPeriodos, textoPrevisto,
} from '../../lib/ponto/apresentacao';
import { cx } from '../../lib/design/cx';
import estilos from './ponto.module.css';

export const CARTOES_ATE = 1180;

const CAMPOS = [
  ['entrada', 'Entrada'],
  ['saida_intervalo', 'Saída int.'],
  ['retorno_intervalo', 'Retorno'],
  ['saida', 'Saída'],
];

// Grade diária do cartão: UMA definição de colunas para a tabela (desktop)
// e os cartões (celular) -- DataTable. Mostra a apuração da base COM os
// rascunhos (o efeito aparece antes de salvar). Horários editáveis só em
// cartão aberto, dia passado, dentro do vínculo, de trabalho e sem
// atestado integral; o resto vai pelo modal do dia. `dias` já vem filtrado
// (Todos / Somente pendências): "selecionar todos" vale para o que está visível.
export default function GradeDias({
  dias, // [{ base (dia com o rascunho aplicado), apurado, rascunho }]
  atestados,
  aberto,
  podeLancar,
  alterados,
  erros,
  selecionados,
  onAlternarSelecao,
  onAlternarTodos,
  onCampo,
  onIgualAoPrevisto,
  onAbrirDia,
}) {
  const editavelDe = (d) => (podeLancar ? diaEditavel(d.apurado, { aberto, atestados }) : { horarios: false, ajuste: false });
  const editaHorarios = (d) => editavelDe(d).horarios && d.apurado.situacao === 'trabalho';
  const selecionaveis = dias.filter(editaHorarios);
  const algumEditavel = dias.some((d) => editavelDe(d).ajuste);
  const algumHorario = selecionaveis.length > 0;
  // Layout fixo: tudo cabe na largura útil do desktop (1366px com o menu
  // aberto) sem rolagem lateral; abaixo de CARTOES_ATE a tela vira cartões.
  // A coluna Dia quebra linha (feriados de nome longo aumentam a altura da
  // linha, nunca invadem a coluna ao lado).
  const L = algumHorario
    ? { dia: '11%', previsto: '11%', situacao: '11%', horarios: '32%', trabalhado: '7%', atestado: '7%', saldo: '11%', acoes: '10%' }
    : { dia: '12%', previsto: '15%', situacao: '15%', horarios: '18%', trabalhado: '8%', atestado: '8%', saldo: '14%', acoes: algumEditavel ? '10%' : '7%' };
  const estadoTodos = selecionados.size === 0 ? 'nenhum' : selecionaveis.every((d) => selecionados.has(d.base.data)) ? 'todos' : 'parcial';

  const colunas = [
    {
      chave: 'dia',
      rotulo: 'Dia',
      largura: L.dia,
      mobile: 'titulo',
      render: (d) => (
        <span className={estilos.dia}>
          <span className={estilos.diaData}>{rotuloDia(d.apurado)}</span>
          {d.apurado.feriado && <span className={estilos.feriado} title={`Feriado: ${d.apurado.feriado}`}>Feriado: {d.apurado.feriado}</span>}
          {d.apurado.futuro && <span className={estilos.aux}>Ainda não chegou</span>}
          {d.apurado.fora_vinculo && <span className={estilos.aux}>Fora do vínculo</span>}
          {alterados.has(d.base.data) && <Badge tom="warning">Não salvo</Badge>}
        </span>
      ),
    },
    {
      chave: 'previsto',
      rotulo: 'Previsto (Escala)',
      largura: L.previsto,
      // Um período por linha (dois turnos não cortam na coluna estreita).
      render: (d) => (d.apurado.fora_vinculo ? '—' : (
        <span className={estilos.previsto}>{textoPrevisto(d.base.escala).split(' · ').map((p) => <span key={p}>{p}</span>)}</span>
      )),
    },
    {
      chave: 'situacao',
      rotulo: 'Situação',
      largura: L.situacao,
      render: (d) => {
        const s = seloSituacao(d.apurado);
        return (
          <span className={estilos.situacao}>
            <Badge tom={s.tom}>{s.rotulo}</Badge>
            {s.origem && <span className={estilos.aux}>{s.origem}</span>}
            {s.ajustado && <span className={estilos.aux} title={d.base.lancamento?.motivo || ''}>Ajustado{d.base.lancamento?.motivo ? `: ${d.base.lancamento.motivo}` : ''}</span>}
            {d.apurado.atestado_cobertura === 'parcial' && <span className={estilos.aux}>Atestado parcial</span>}
          </span>
        );
      },
    },
    {
      chave: 'horarios',
      rotulo: 'Entrada · Saída int. · Retorno · Saída',
      cartaoLargo: true,
      largura: L.horarios,
      render: (d) => {
        const r = d.rascunho;
        if (!editaHorarios(d)) {
          const texto = textoPeriodos(d.base.lancamento?.periodos || [], ['entrada', 'saida']);
          return <span className={estilos.horariosTexto}>{texto || '—'}</span>;
        }
        return (
          <span>
            <span className={estilos.horarios}>
              {CAMPOS.map(([campo, rotulo]) => (
                <label key={campo} className={estilos.horarioCampo}>
                  {/* Rótulo visível só nos cartões (no desktop o cabeçalho da coluna nomeia). */}
                  <span className={estilos.rotuloCampo}>{rotulo}</span>
                  <Input
                    type="time"
                    step="60"
                    aria-label={`${rotulo} — ${rotuloDia(d.apurado)}`}
                    value={r[campo] || ''}
                    onChange={(e) => onCampo(d.base.data, campo, e.target.value)}
                  />
                </label>
              ))}
            </span>
            {r.extras?.length > 0 && <span className={estilos.aux}>+ {textoPeriodos(r.extras, ['entrada', 'saida'])} (no detalhe do dia)</span>}
          </span>
        );
      },
    },
    { chave: 'trabalhado', rotulo: 'Trabalhado', largura: L.trabalhado, alinhar: 'direita', semQuebra: true, render: (d) => <span className={estilos.numero}>{horas(d.apurado.trabalhado_min)}</span> },
    {
      chave: 'atestado',
      rotulo: 'Atestado',
      largura: L.atestado,
      alinhar: 'direita',
      semQuebra: true,
      render: (d) => <span className={estilos.numero}>{d.apurado.atestado_min ? horas(d.apurado.atestado_min) : d.apurado.atestado_min === null ? '—' : '00:00'}</span>,
    },
    {
      chave: 'saldo',
      rotulo: 'Saldo do dia',
      alinhar: 'direita',
      largura: L.saldo,
      ajuda: 'Fora do previsto − previsto não coberto, no próprio dia. "A lançar" = dia de trabalho ainda sem horário (pendência, não falta).',
      render: (d) => {
        const s = leituraDoSaldo(d.apurado);
        return (
          <span className={estilos.saldo}>
            <span className={cx(estilos.numero, estilos[`saldo${s.tom}`], s.estado === 'nao_lancado' && estilos.saldoALancar)}>{s.texto}</span>
            {s.nota && <span className={cx(estilos.aux, estilos.desvios, s.estado === 'falta' && estilos.notaFalta)}>{s.nota}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      rotulo="Dias da competência"
      colunas={colunas}
      linhas={dias}
      chaveLinha={(d) => d.base.data}
      denso
      layoutFixo
      larguraAcoes={L.acoes}
      cartoesAte={CARTOES_ATE}
      destaque={(d) => (d.apurado.pendencias.length > 0 || erros[d.base.data] ? 'aviso' : d.apurado.fora_vinculo || d.apurado.futuro ? 'inativo' : null)}
      // Pendências e erros do dia numa faixa logo abaixo da linha (tabela e cartões).
      linhaExtra={(d) => {
        const erro = erros[d.base.data];
        // "Sem horário" já aparece como "A lançar" no saldo: a faixa só
        // repete pendências de outro tipo (Escala, ajuste incoerente...).
        const pendencias = textoPendencias({ pendencias: d.apurado.pendencias.filter((p) => p !== 'sem_lancamento') });
        if (!erro && pendencias.length === 0) return null;
        return (
          <div className={estilos.extraDia}>
            {erro && <p className={estilos.erroLinha} role="alert">{erro.mensagem}</p>}
            {pendencias.length > 0 && <p className={estilos.pendenteLinha}>Pendente: {pendencias.join(' ')}</p>}
          </div>
        );
      }}
      selecao={podeLancar && aberto && selecionaveis.length > 0 ? {
        selecionados,
        podeSelecionar: editaHorarios,
        onAlternar: (d) => onAlternarSelecao(d.base.data),
        rotuloLinha: (d) => `Selecionar ${rotuloDia(d.apurado)}`,
        estadoTodos,
        onAlternarTodos: () => onAlternarTodos(selecionaveis.map((d) => d.base.data)),
      } : undefined}
      // Ações com TEXTO (não só ícone): "Ajustar"/"Ver" abre o dia;
      // "Previsto" só preenche o rascunho -- quem grava é "Salvar alterações".
      renderAcoes={(d, { cartao }) => {
        const ed = editavelDe(d);
        const previsto = editaHorarios(d) && d.base.escala?.tipo === 'trabalho';
        const dica = `${rotuloDia(d.apurado)}: preencher com o horário previsto da Escala (fica como rascunho até salvar)`;
        if (cartao) {
          return (
            <AcoesLinha
              cartao
              acoes={[
                { chave: 'dia', rotulo: ed.ajuste ? 'Ajustar dia' : 'Ver dia', icone: ed.ajuste ? 'pencil' : 'eye', onClick: () => onAbrirDia(d.base.data), primaria: !previsto },
                previsto && { chave: 'previsto', rotulo: 'Preencher previsto', icone: 'clipboard', onClick: () => onIgualAoPrevisto(d.base.data) },
              ]}
            />
          );
        }
        return (
          <div className={estilos.acoesDia}>
            <Button tamanho="sm" variante="secondary" className={estilos.botaoDia} onClick={() => onAbrirDia(d.base.data)} aria-label={`${ed.ajuste ? 'Ajustar' : 'Ver'} ${rotuloDia(d.apurado)}`}>
              {ed.ajuste ? 'Ajustar' : 'Ver'}
            </Button>
            {previsto && (
              <Button tamanho="sm" variante="secondary" className={estilos.botaoDia} onClick={() => onIgualAoPrevisto(d.base.data)} title={dica} aria-label={dica}>
                Previsto
              </Button>
            )}
          </div>
        );
      }}
    />
  );
}
