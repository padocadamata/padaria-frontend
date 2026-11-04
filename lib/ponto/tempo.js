// Tempo do Cartão-Ponto (migration 0078) -- SOMENTE minutos, nunca R$.
// Horários são 'HH:MM' do mesmo dia (sem virada de meia-noite, mesma
// regra da Escala: fim > início). Intervalos são semiabertos [início, fim):
// 06:00–09:00 cobre os minutos 360..539 (180 minutos). As mesmas contas
// existem no SQL (folha_ponto_apurar) -- paridade testada no PGlite.

export const MINUTOS_DIA = 1440;

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function horaValida(texto) {
  return typeof texto === 'string' && HORA.test(texto);
}

// 'HH:MM' (ou 'HH:MM:SS' vindo do banco) -> minutos desde 00:00. Segundos
// são descartados (a Escala e o ponto trabalham por minuto).
export function paraMinutos(texto) {
  const m = /^(\d{2}):(\d{2})/.exec(String(texto ?? ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Minutos -> 'HH:MM' (duração, pode passar de 24h nos totais). null -> ''.
export function formatarMinutos(minutos) {
  if (minutos === null || minutos === undefined) return '';
  const total = Math.max(0, Math.round(minutos));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Mapa de cobertura do dia: Uint8Array(1440) com 1 nos minutos cobertos
// por qualquer intervalo da lista ({inicio, fim} ou {entrada, saida}).
export function cobertura(intervalos, campos = ['inicio', 'fim']) {
  const mapa = new Uint8Array(MINUTOS_DIA);
  for (const intervalo of intervalos || []) {
    const ini = paraMinutos(intervalo[campos[0]]);
    const fim = paraMinutos(intervalo[campos[1]]);
    if (ini === null || fim === null) continue;
    for (let m = ini; m < fim; m += 1) mapa[m] = 1;
  }
  return mapa;
}

export function contar(mapa) {
  let total = 0;
  for (let m = 0; m < MINUTOS_DIA; m += 1) total += mapa[m];
  return total;
}

// Duração somada (sem contar duas vezes o que se sobrepõe).
export function duracao(intervalos, campos) {
  return contar(cobertura(intervalos, campos));
}

// Lacunas entre o primeiro início e o último fim (intervalo realizado).
export function lacunas(intervalos, campos = ['inicio', 'fim']) {
  const validos = (intervalos || [])
    .map((i) => [paraMinutos(i[campos[0]]), paraMinutos(i[campos[1]])])
    .filter(([a, b]) => a !== null && b !== null);
  if (validos.length === 0) return 0;
  const inicio = Math.min(...validos.map(([a]) => a));
  const fim = Math.max(...validos.map(([, b]) => b));
  return fim - inicio - duracao(intervalos, campos);
}

// Dois intervalos se sobrepõem (encostar -- 09:00 fim / 09:00 início -- não
// é sobreposição).
export function sobrepoe(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}
