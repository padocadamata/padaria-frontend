// Nomes COMPACTOS da Escala -- SOMENTE apresentação: nunca altera o
// cadastro, o nome no banco, IDs ou qualquer regra. O nome completo
// continua nos modais, nos tooltips, nos arquivos exportados e nos
// metadados do relatório; a forma compacta é para as grades e o filtro.

function palavras(nome) {
  return String(nome || '').trim().split(/\s+/).filter(Boolean);
}

// Grades (Semanal, Mensal, Cobertura): PRIMEIRO NOME + ÚLTIMO SOBRENOME,
// mantendo a grafia cadastrada. "LETICIA DANIELE RIBEIRO DE SOUZA" ->
// "LETICIA SOUZA"; uma palavra só -> ela mesma.
export function nomeCompactoEscala(nome) {
  const p = palavras(nome);
  if (p.length <= 1) return p[0] || '';
  return `${p[0]} ${p[p.length - 1]}`;
}

// "LETICIA" -> "Leticia" (pt-BR; cada palavra com inicial maiúscula).
export function capitalizarNome(texto) {
  return palavras(texto)
    .map((p) => {
      const minusculo = p.toLocaleLowerCase('pt-BR');
      return minusculo.charAt(0).toLocaleUpperCase('pt-BR') + minusculo.slice(1);
    })
    .join(' ');
}

function chave(texto) {
  return String(texto || '').toLocaleLowerCase('pt-BR');
}

// Rótulos do select "Funcionária" (o VALUE continua sendo o id): só o
// primeiro nome quando ele é único entre as funcionárias DISPONÍVEIS no
// filtro; havendo homônimos, primeiro nome + último sobrenome para essas
// pessoas; se mesmo assim colidirem, o nome completo (nunca ambíguo).
// Devolve Map<id, rotulo>.
export function rotulosFuncionariasFiltro(funcionarios) {
  const lista = funcionarios || [];
  const contarPor = (fn) => {
    const contagem = new Map();
    for (const f of lista) contagem.set(fn(f), (contagem.get(fn(f)) || 0) + 1);
    return contagem;
  };
  const primeiro = (f) => chave(palavras(f.nome)[0]);
  const compacto = (f) => chave(nomeCompactoEscala(f.nome));
  const porPrimeiro = contarPor(primeiro);
  const porCompacto = contarPor(compacto);

  const rotulos = new Map();
  for (const f of lista) {
    if (porPrimeiro.get(primeiro(f)) === 1) rotulos.set(f.id, capitalizarNome(palavras(f.nome)[0] || ''));
    else if (porCompacto.get(compacto(f)) === 1) rotulos.set(f.id, capitalizarNome(nomeCompactoEscala(f.nome)));
    else rotulos.set(f.id, capitalizarNome(f.nome));
  }
  return rotulos;
}
