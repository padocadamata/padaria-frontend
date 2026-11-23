// Simula o SQL Editor do Supabase executando um script INSTRUÇÃO POR
// INSTRUÇÃO, cada uma na sua própria requisição (autocommit): um BEGIN
// solto não segura as instruções seguintes, e uma tabela temporária
// "on commit drop" some no fim da própria instrução. É o pior caso de como
// um editor pode mandar o script; uma migration precisa ser correta nele.

// Divide o script em instruções, respeitando comentários, literais '...' e
// blocos $tag$...$tag$ (corpos de função/DO).
export function dividirInstrucoes(sql) {
  const instrucoes = [];
  let atual = '';
  let i = 0;
  const s = String(sql);
  while (i < s.length) {
    const c = s[i];
    const d = s[i + 1];
    if (c === '-' && d === '-') {
      const fim = s.indexOf('\n', i);
      const j = fim === -1 ? s.length : fim;
      atual += s.slice(i, j);
      i = j;
    } else if (c === '/' && d === '*') {
      const fim = s.indexOf('*/', i + 2);
      const j = fim === -1 ? s.length : fim + 2;
      atual += s.slice(i, j);
      i = j;
    } else if (c === "'") {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; }
        if (s[j] === "'") break;
        j += 1;
      }
      atual += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i));
      if (m) {
        const fim = s.indexOf(m[0], i + m[0].length);
        const j = fim === -1 ? s.length : fim + m[0].length;
        atual += s.slice(i, j);
        i = j;
      } else {
        atual += c;
        i += 1;
      }
    } else if (c === ';') {
      instrucoes.push(atual);
      atual = '';
      i += 1;
    } else {
      atual += c;
      i += 1;
    }
  }
  instrucoes.push(atual);
  // só o que tem código (fora comentários)
  return instrucoes.map((t) => t.trim()).filter((t) => t.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim() !== '');
}

// Executa instrução por instrução, cada uma em autocommit. BEGIN/COMMIT do
// script viram no-op (como quando o editor não mantém a transação entre
// requisições). Para no primeiro erro, que é devolvido.
export async function executarComoEditorPorInstrucao(db, sql) {
  const executadas = [];
  for (const instr of dividirInstrucoes(sql)) {
    const cabeca = instr.replace(/--[^\n]*/g, '').trim().toUpperCase();
    if (/^(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|END)\b/.test(cabeca)) {
      executadas.push(cabeca.split(/\s/)[0]);
      continue;
    }
    try {
      await db.exec(instr);
      executadas.push('ok');
    } catch (erro) {
      try { await db.exec('rollback'); } catch { /* sem transação aberta */ }
      return { erro, executadas, instrucao: instr };
    }
  }
  return { erro: null, executadas };
}
