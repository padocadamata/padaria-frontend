// Detector estático de UPDATE/DELETE sem WHERE (o que a extensão
// pg_safeupdate do Supabase recusa nas conexões da API -- inclusive dentro
// de funções -- com "UPDATE requires a WHERE clause"). O PGlite dos testes não
// tem a extensão, então esta checagem é a guarda contra o defeito da 0081.
//
// Regras (as mesmas da extensão: só importa haver WHERE no nível do próprio
// comando):
//   * comentários e literais '...' (também E'...') são ignorados;
//   * blocos $tag$...$tag$ com tag não vazia são texto (format/execute);
//     "$$" é código (corpo de função/DO numa migration inteira);
//   * UPDATE = "update [only] <tabela> [[as] alias] set" -- isso exclui
//     "for update", "on conflict do update set" (INSERT, que a extensão não
//     confere), gatilhos "before update on", grants e policies;
//   * DELETE = "delete from";
//   * o comando termina no ";" (ou ")" que fecha um CTE) no nível 0 de
//     parênteses; WHERE dentro de subconsulta NÃO conta.

function neutralizar(sql) {
  // troca comentários e literais por espaços, preservando quebras de linha
  // (para os números de linha continuarem certos)
  let out = '';
  let i = 0;
  const branco = (t) => t.replace(/[^\n]/g, ' ');
  while (i < sql.length) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      const fim = sql.indexOf('\n', i);
      const j = fim === -1 ? sql.length : fim;
      out += branco(sql.slice(i, j));
      i = j;
    } else if (c === '/' && d === '*') {
      const fim = sql.indexOf('*/', i + 2);
      const j = fim === -1 ? sql.length : fim + 2;
      out += branco(sql.slice(i, j));
      i = j;
    } else if (c === "'") {
      const escape = /[eE]/.test(sql[i - 1] || '') && !/\w/.test(sql[i - 2] || '');
      let j = i + 1;
      while (j < sql.length) {
        if (escape && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      out += `'${branco(sql.slice(i + 1, j))}'`;
      i = j + 1;
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)\$/.exec(sql.slice(i));
      if (m) {
        const fim = sql.indexOf(m[0], i + m[0].length);
        const j = fim === -1 ? sql.length : fim + m[0].length;
        out += branco(sql.slice(i, j));
        i = j;
      } else {
        out += c;
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const INICIO = /\b(?:update\s+(?:only\s+)?(?!set\b)[A-Za-z_"][\w."]*(?:\s+(?:as\s+)?(?!set\b)[A-Za-z_]\w*)?\s+set\b|delete\s+from\b)/gi;

// Devolve [{ linha, comando, trecho }] para cada UPDATE/DELETE sem WHERE.
export function comandosSemWhere(sql) {
  const limpo = neutralizar(String(sql));
  const achados = [];
  for (const m of limpo.matchAll(INICIO)) {
    let prof = 0;
    let temWhere = false;
    let j = m.index + m[0].length;
    for (; j < limpo.length; j += 1) {
      const c = limpo[j];
      if (c === '(') prof += 1;
      else if (c === ')') {
        if (prof === 0) break; // fim de um CTE "( update ... )"
        prof -= 1;
      } else if (c === ';' && prof === 0) break;
      else if (prof === 0 && /[wW]/.test(c) && /^where\b/i.test(limpo.slice(j, j + 6)) && !/\w/.test(limpo[j - 1])) {
        temWhere = true;
      }
    }
    if (!temWhere) {
      achados.push({
        linha: limpo.slice(0, m.index).split('\n').length,
        comando: /^update/i.test(m[0]) ? 'UPDATE' : 'DELETE',
        trecho: limpo.slice(m.index, Math.min(j, m.index + 120)).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return achados;
}
