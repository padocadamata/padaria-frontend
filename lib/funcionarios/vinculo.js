// Tipo de vinculo do funcionario (funcionarios.tipo_vinculo, migration
// 0055 + 0063). Valores internos preservados por decisao explicita (nao
// reinterpretar cadastros existentes): 'funcionario' continua significando
// CLT no banco, so o ROTULO na UI mudou. Unica fonte de rotulo/cor/letra
// -- nunca duplicar este mapeamento em outro arquivo.
export const OPCOES_VINCULO = [
  { valor: 'funcionario', rotulo: 'CLT', letra: 'C', tom: 'neutral' },
  { valor: 'freelancer', rotulo: 'Freelancer', letra: 'F', tom: 'info' },
  { valor: 'pj', rotulo: 'PJ', letra: 'PJ', tom: 'primary' },
];

function obterOpcao(tipoVinculo) {
  return OPCOES_VINCULO.find((o) => o.valor === tipoVinculo) || null;
}

export function rotuloVinculo(tipoVinculo) {
  return obterOpcao(tipoVinculo)?.rotulo || tipoVinculo || '—';
}

export function tomVinculo(tipoVinculo) {
  return obterOpcao(tipoVinculo)?.tom || 'neutral';
}

export function letraVinculo(tipoVinculo) {
  return obterOpcao(tipoVinculo)?.letra || '?';
}

// Descricao por extenso para title/aria-label do indicador compacto (nunca
// depender só da letra/cor -- sempre acompanhada de texto acessível).
export function descricaoVinculo(tipoVinculo) {
  const opcao = obterOpcao(tipoVinculo);
  if (!opcao) return tipoVinculo ? `Vínculo: ${tipoVinculo}` : 'Vínculo não definido';
  return `${opcao.letra} = ${opcao.rotulo === 'PJ' ? 'Pessoa Jurídica' : opcao.rotulo}`;
}
