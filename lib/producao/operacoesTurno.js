import { createClient } from '../supabase/client';
import { registrarAuditoria } from '../audit/registrarAuditoria';

// Operações de UM turno da Tela Hoje -- Iniciar, Adicionar e Fechar --
// em UM lugar só. Usadas pelos modais (IniciarProducaoForm,
// AdicionarProducaoForm, FechamentoTurnoForm) e pela tabela do desktop
// (TabelaHoje): mesmas validações, mesmas mensagens, mesmas escritas
// (insert / RPC adicionar_producao / update + auditoria). Nenhuma regra
// nova -- o conteúdo é exatamente o que vivia dentro de cada modal.

// ---------------- Iniciar / Adicionar: quantidade inteira > 0 ----------------

// Mesmo critério dos modais: parseInt e inteiro > 0.
export function validarQuantidadePositiva(texto) {
  const valor = parseInt(texto, 10);
  if (!Number.isInteger(valor) || valor <= 0) {
    return { valor: null, erro: 'Informe uma quantidade maior que zero.' };
  }
  return { valor, erro: '' };
}

export function mensagemErroIniciar(error) {
  if (!error) return '';
  if (error.code === '23505') {
    return 'Este turno já tem produção lançada. Atualize a página.';
  }
  return 'Não foi possível iniciar a produção. Tente novamente ou avise um administrador.';
}

// Cria o registro do turno (origem='manual', status='aberto'). Os campos de
// fechamento ficam NULL por default do schema -- não são tocados aqui.
export async function iniciarProducao({ data, turno, receitaId, quantidade }) {
  const supabase = createClient();
  const { error } = await supabase.from('producao_registros').insert({
    data,
    turno,
    receita_id: receitaId,
    origem: 'manual',
    status: 'aberto',
    quantidade_produzida: quantidade,
  });
  return { erro: error ? mensagemErroIniciar(error) : '' };
}

export function mensagemErroAdicionar(error) {
  if (!error) return '';
  const msg = error.message || '';
  if (msg.includes('deve ser maior que zero')) {
    return 'Informe uma quantidade maior que zero.';
  }
  if (msg.includes('nao encontrado') || msg.includes('nao esta status=aberto')) {
    return 'Este turno já foi fechado — atualize a página.';
  }
  return 'Não foi possível adicionar a produção. Tente novamente ou avise um administrador.';
}

// Segunda fornada: exclusivamente pela RPC public.adicionar_producao --
// nunca SELECT + soma no cliente + UPDATE (duas fornadas concorrentes se
// sobrescreveriam).
export async function adicionarProducao({ registroId, quantidade }) {
  const supabase = createClient();
  const { error } = await supabase.rpc('adicionar_producao', {
    p_registro_id: registroId,
    p_quantidade_adicional: quantidade,
  });
  return { erro: error ? mensagemErroAdicionar(error) : '' };
}

// ---------------- Fechar turno ----------------
//
// Regra de sobras (revisão 2026-08-23): sobra_total é digitável
// diretamente; se deixada em branco e houver classificação (aproveitável
// e/ou perda), sobra_total é derivada da soma. Aproveitável/perda em
// branco viram NULL (não classificado ainda) — só viram 0 quando o
// operador digita "0" explicitamente. Fechar exige, no mínimo, a sobra
// total (direta ou derivada); classificação completa não é obrigatória.
//
// Função PURA: recebe os textos digitados e devolve tudo o que o
// formulário mostra/valida (testada em lib/producao/__tests__).
export function calcularFechamento({ produzida, sobraTotal, aproveitavel, perda }) {
  const produzidaNum = parseInt(produzida, 10);

  const totalPreenchido = sobraTotal !== '';
  const aproveitavelPreenchido = aproveitavel !== '';
  const perdaPreenchido = perda !== '';

  const sobraTotalDigitado = totalPreenchido ? parseInt(sobraTotal, 10) : null;
  const aproveitavelNum = aproveitavelPreenchido ? parseInt(aproveitavel, 10) : null;
  const perdaNum = perdaPreenchido ? parseInt(perda, 10) : null;

  const somaClassificacao = (aproveitavelNum ?? 0) + (perdaNum ?? 0);

  // sobra_total: usa o que foi digitado diretamente; se vazio e houver
  // classificação, deriva da soma; se nada foi preenchido, fica null (e o
  // fechamento é bloqueado, ver faltaSobraTotal abaixo).
  const sobraTotalNum = totalPreenchido
    ? sobraTotalDigitado
    : aproveitavelPreenchido || perdaPreenchido
      ? somaClassificacao
      : null;

  const numerosValidos =
    Number.isInteger(produzidaNum) && produzidaNum > 0 &&
    (!totalPreenchido || (Number.isInteger(sobraTotalDigitado) && sobraTotalDigitado >= 0)) &&
    (!aproveitavelPreenchido || (Number.isInteger(aproveitavelNum) && aproveitavelNum >= 0)) &&
    (!perdaPreenchido || (Number.isInteger(perdaNum) && perdaNum >= 0));

  const faltaSobraTotal = numerosValidos && sobraTotalNum === null;
  const somaExcedeTotal = numerosValidos && sobraTotalNum != null && somaClassificacao > sobraTotalNum;
  const sobraMaiorQueProduzida = numerosValidos && sobraTotalNum != null && sobraTotalNum > produzidaNum;

  const bloqueado = !numerosValidos || faltaSobraTotal || somaExcedeTotal || sobraMaiorQueProduzida;

  const sobraNaoClassificada = numerosValidos && sobraTotalNum != null ? sobraTotalNum - somaClassificacao : null;
  const quantidadeVendida = numerosValidos && sobraTotalNum != null ? produzidaNum - sobraTotalNum : null;

  // Mesma ordem de verificação do botão "Fechar turno" do modal.
  let erro = '';
  if (!numerosValidos) erro = 'Preencha os valores com números válidos (0 ou maior).';
  else if (faltaSobraTotal) erro = 'Informe ao menos a sobra total.';
  else if (somaExcedeTotal) {
    erro = `Sobra aproveitável + perda/descarte (${somaClassificacao}) não pode ultrapassar a sobra total (${sobraTotalNum}).`;
  } else if (sobraMaiorQueProduzida) {
    erro = `A sobra total (${sobraTotalNum}) não pode ser maior que a quantidade produzida (${produzidaNum}).`;
  }

  return {
    totalPreenchido,
    aproveitavelPreenchido,
    perdaPreenchido,
    produzidaNum,
    sobraTotalNum,
    aproveitavelNum,
    perdaNum,
    somaClassificacao,
    numerosValidos,
    faltaSobraTotal,
    somaExcedeTotal,
    sobraMaiorQueProduzida,
    bloqueado,
    sobraNaoClassificada,
    quantidadeVendida,
    erro,
  };
}

export function mensagemErroFechar(error) {
  if (!error) return '';
  return 'Não foi possível fechar o turno. Confira os valores informados ou avise um administrador.';
}

// Grava o fechamento (status='fechado'). `incluirProduzida` só na correção
// de um turno reaberto (a contagem de produção também pode ser refeita).
// Auditoria best-effort: se falhar, o fechamento já feito não é desfeito.
export async function fecharTurno({ registroId, calculo, incluirProduzida = false }) {
  const supabase = createClient();
  const payload = {
    status: 'fechado',
    quantidade_vendida: calculo.quantidadeVendida,
    sobra_total: calculo.sobraTotalNum,
    sobra_aproveitavel: calculo.aproveitavelNum,
    perda_descarte: calculo.perdaNum,
  };
  if (incluirProduzida) {
    payload.quantidade_produzida = calculo.produzidaNum;
  }

  const { error } = await supabase.from('producao_registros').update(payload).eq('id', registroId);
  if (error) return { erro: mensagemErroFechar(error) };

  registrarAuditoria({
    entidade: 'producao',
    registroId,
    acao: 'fechou',
    valorNovo: `vendida=${calculo.quantidadeVendida}, sobra_total=${calculo.sobraTotalNum}, sobra_aproveitavel=${calculo.aproveitavelNum}, perda_descarte=${calculo.perdaNum}`,
  });
  return { erro: '' };
}
