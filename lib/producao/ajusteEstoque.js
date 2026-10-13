// Ajuste de Estoque de Sacos Fechados (migration 0074). A pessoa informa o
// ESTOQUE FÍSICO correto; a diferença é sempre calculada (aqui só para a
// prévia, e de novo no banco por registrar_ajuste_sacos, que é quem grava).
// Ninguém precisa decidir se digita +N ou -N.

export const LIMITE_MOTIVO_AJUSTE = 500; // mesmo limite da RPC

// fisicoTexto: valor cru do campo. Devolve a prévia completa ou o motivo de
// não ser válida (sem erro enquanto o campo está vazio).
export function calcularAjusteEstoque(saldoAtualSacos, fisicoTexto, pesoPorSacoKg) {
  const texto = String(fisicoTexto ?? '').trim();
  if (texto === '') return { valido: false, erro: '' };
  if (!/^\d+$/.test(texto)) {
    return { valido: false, erro: 'Informe uma quantidade inteira de sacos, maior ou igual a zero.' };
  }

  const fisico = Number(texto);
  const ajuste = fisico - saldoAtualSacos;
  const resultado = {
    fisico,
    ajuste,
    novoSaldo: fisico,
    ajusteKg: ajuste * pesoPorSacoKg,
    novoSaldoKg: fisico * pesoPorSacoKg,
  };

  if (ajuste === 0) {
    return { ...resultado, valido: false, erro: 'O estoque físico é igual ao saldo atual — nenhum ajuste necessário.' };
  }
  return { ...resultado, valido: true, erro: '' };
}

// "+3", "−18", "0" -- sinal sempre explícito na prévia e no histórico.
export function formatarComSinal(valor, formatar = (v) => String(v)) {
  if (valor > 0) return `+${formatar(valor)}`;
  if (valor < 0) return `−${formatar(Math.abs(valor))}`;
  return formatar(0);
}
