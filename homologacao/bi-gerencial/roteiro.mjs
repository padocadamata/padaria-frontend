// HOMOLOGAÇÃO LOCAL DO BI -- roteiro de cenários do capturar.mjs.
// Cada cenário: rota, tamanho da janela, ação executada na página (JS no
// navegador, simulando o usuário) e conferências (JS que devolve uma lista
// de falhas; vazia = aprovado). Dados fictícios de dados-ficticios.mjs.

const setSelect = (sel, valor) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, ${JSON.stringify(valor)}); el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
const clicar = (sel, i = 0) => `(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!el) throw new Error('não achei ' + ${JSON.stringify(sel)}); el.click(); })()`;
const texto = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText || '')`;
const bloco = (nome) => `[data-bloco="${nome}"]`;
const esperar = (ms) => `await new Promise((r) => setTimeout(r, ${ms}))`;
const marcados = (nome) => `document.querySelectorAll('${bloco(nome)} input[type=checkbox]:checked').length`;
// Passa o mouse sobre o ponto i de um gráfico de linhas (eixo X numérico,
// YAxis de 78px e margem direita de 12px, como em components/bi/Graficos.js).
const passarMouseNoPonto = (nome, i, n) => `(() => {
  const w = document.querySelector('${bloco(nome)} .recharts-wrapper');
  const r = w.getBoundingClientRect();
  const x = r.left + 78 + ((${i} + 0.5) / ${n}) * (r.width - 78 - 12);
  const y = r.top + r.height / 2;
  w.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
})()`;

// Exportação geral: clica no botão e espera a geração terminar (botão volta
// a ficar habilitado). Guarda tempo e memória JS (Chrome) da geração.
const exportarGeral = (formato) => `await (async () => {
  const rotulo = 'Exportar o BI Gerencial completo em ${formato === 'pdf' ? 'PDF' : 'Excel'}';
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === rotulo);
  if (!b) throw new Error('botão de exportação geral ausente');
  const memAntes = performance.memory ? performance.memory.usedJSHeapSize : null;
  const outro = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') && x.getAttribute('aria-label').startsWith('Exportar o BI Gerencial') && x !== b);
  b.click();
  await Promise.resolve();
  window.__biOcupadoDurante = window.__biOcupadoDurante || b.disabled || /Gerando|Coletando|Montando/.test(b.closest('[class*="exportacaoGeral"]').innerText);
  window.__biOutroBloqueado = window.__biOutroBloqueado || (outro && outro.disabled);
  b.click(); // clique repetido durante a geração deve ser ignorado (sem segunda geração)
  for (let i = 0; i < 480 && b.disabled; i += 1) await new Promise((r) => setTimeout(r, 250));
  const memDepois = performance.memory ? performance.memory.usedJSHeapSize : null;
  window.__biExportacoes = [...(window.__biExportacoes || []), { formato: '${formato}', ...(window.__biUltimaExportacao || {}), memoriaAntesMB: memAntes && Math.round(memAntes / 1048576), memoriaDepoisMB: memDepois && Math.round(memDepois / 1048576) }];
  await new Promise((r) => setTimeout(r, 1500));
})()`;
const medirExportacoes = `(window.__biExportacoes || []).map((e) => ({ formato: e.formato, ms: e.ms, completo: e.completo, memoriaAntesMB: e.memoriaAntesMB, memoriaDepoisMB: e.memoriaDepoisMB }))`;
const conferirExportacoes = (esperaCompleto = true) => `(() => { const f = []; const ex = window.__biExportacoes || [];
  if (ex.length < 2) f.push('esperava 2 exportações, houve ' + ex.length);
  if (!window.__biOcupadoDurante) f.push('sem indicação de processamento');
  if (!window.__biOutroBloqueado) f.push('o outro formato não ficou bloqueado durante a geração');
  ${esperaCompleto ? "if (ex.some((e) => e.completo === false)) f.push('exportação marcada como incompleta: ' + JSON.stringify(ex.map((e) => (e.situacoes || []).filter((s) => s.estado === 'erro' || s.estado === 'parcial'))));" : ''}
  if (document.body.innerText.includes('Não foi possível gerar')) f.push('erro na geração');
  return f; })()`;
const definirData = (rotulo, valor) => `(() => { const el = document.querySelector('[aria-label="Filtros gerais"] input[aria-label="${rotulo}"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '${valor}'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`;

export const ROTEIRO = [
  {
    nome: '01_desktop_padrao',
    rota: '/bi',
    largura: 1440,
    altura: 4500,
    conferir: `(() => { const f = []; const t = document.body.innerText;
      if (${texto('#bi-atalho option:checked')} !== 'Últimos 7 dias') f.push('atalho padrão "Últimos 7 dias"');
      if (!t.includes('o último dia com importação completa')) f.push('explicação do critério do atalho');
      if (${marcados('ranking')} !== 3) f.push('seleção automática inicial: esperava 3 marcados no ranking, há ' + ${marcados('ranking')});
      if ([0, 1, 2].some((i) => !document.querySelectorAll('${bloco('ranking')} input[type=checkbox]')[i].checked)) f.push('seleção inicial deveria ser os 3 maiores');
      if (document.querySelectorAll('${bloco('evoprod')} .recharts-line').length !== 3) f.push('evolução com os 3 selecionados');
      if (document.querySelectorAll('${bloco('ranking')} tbody tr').length !== 10) f.push('ranking Top 10 padrão');
      if (!document.querySelector('${bloco('participacao')} .recharts-pie')) f.push('gráfico de rosca');
      if (!${texto(bloco('participacao'))}.includes('Total do período')) f.push('total no centro da rosca');
      if (!document.querySelector('button[title^="Consultar novamente"]')) f.push('botão Atualizar');
      if (${texto(`${bloco('tabela')} [class*="porPagina"] select option:checked`)} !== '20') f.push('20 por página padrão');
      if (!/Dados completos até\\s*24\\/11\\/2026/.test(t)) f.push('data dos dados completos');
      if (!t.includes('Parcial de 25/11 até 12:44')) f.push('aviso do parcial no cabeçalho');
      if (!t.includes('19/11 sem importação')) f.push('19/11 sem importação na cobertura');
      if (/bi_[a-z_]+/.test(t)) f.push('nome técnico de RPC visível');
      if (!/R\\$\\s?[\\d.]+,\\d{2}/.test(${texto('[class*="kpiValor"]')})) f.push('KPI sem centavos');
      if (!${texto(bloco('comparativo'))}.includes('pareado')) f.push('critério do comparativo');
      if (document.querySelectorAll('${bloco('tabela')} tbody tr').length !== 20) f.push('tabela paginada em 20');
      const menu = [...document.querySelectorAll('aside a')].map((a) => a.textContent.trim());
      if (menu.indexOf('BI Gerencial') < 0 || menu.indexOf('BI Gerencial') > menu.indexOf('Importações G3')) f.push('item do menu');
      return f; })()`,
  },
  {
    nome: '02_hoje_parcial',
    rota: '/bi',
    largura: 1440,
    altura: 1400,
    acao: setSelect('#bi-atalho', 'hoje'),
    conferir: `(() => { const f = []; const k = ${texto('[class*="kpis"]')};
      if (!k.includes('parcial')) f.push('selo parcial nos cartões');
      if (!k.includes('sem variação (dia parcial)')) f.push('sem variação no parcial');
      if (!k.includes('sem dados')) f.push('média diária sem dados');
      if (/R\\$\\s?0,00/.test(k)) f.push('zero exibido como valor');
      return f; })()`,
  },
  {
    nome: '03a_remover_todos',
    rota: '/bi',
    largura: 1440,
    altura: 2600,
    manterSessao: true,
    acao: `${clicar(`${bloco('ranking')} input[type=checkbox]:checked`, 0)}; ${esperar(300)}; ${clicar(`${bloco('ranking')} input[type=checkbox]:checked`, 0)}; ${esperar(300)}; ${clicar(`${bloco('ranking')} input[type=checkbox]:checked`, 0)}`,
    conferir: `(() => { const f = [];
      if (${marcados('ranking')} !== 0) f.push('remover todos deveria deixar 0 marcados');
      if (!${texto(bloco('evoprod'))}.includes('Selecione ao menos um produto')) f.push('evolução sem seleção');
      return f; })()`,
  },
  {
    nome: '03b_produtos_selecionados',
    rota: '/bi',
    largura: 1440,
    altura: 4900,
    // Mesma sessão: a remoção manual de todos foi respeitada (sem reativar a
    // seleção automática); depois o usuário marca 3 do ranking.
    acao: `if (${marcados('ranking')} !== 0) window.__reativou = true; ${clicar(`${bloco('ranking')} input[type=checkbox]`, 1)}; ${esperar(300)}; ${clicar(`${bloco('ranking')} input[type=checkbox]`, 3)}; ${esperar(300)}; ${clicar(`${bloco('ranking')} input[type=checkbox]`, 5)}`,
    conferir: `(() => { const f = [];
      if (window.__reativou) f.push('seleção automática reativada depois de remover todos');
      if (${marcados('ranking')} !== 3) f.push('3 marcados manualmente');
      if (document.querySelectorAll('${bloco('evoprod')} .recharts-line').length < 3) f.push('evolução com 3 linhas');
      if (!${texto(bloco('prodhora'))}.includes('comparar')) f.push('comparação horária do produto');
      if (document.querySelectorAll('${bloco('comparativo')} table').length < 2) f.push('tabela de produtos no comparativo');
      const tabProd = [...document.querySelectorAll('${bloco('comparativo')} table')].find((t) => t.innerText.trim().startsWith('Produto'));
      if (!tabProd) f.push('tabela de produtos ausente');
      else if (/desconto/i.test(tabProd.querySelector('thead').innerText)) f.push('desconto atribuído a produto');
      if (!${texto(bloco('participacao'))}.includes('selecionado')) f.push('participação identifica selecionados');
      return f; })()`,
  },
  {
    nome: '04_filtro_proprio_bloco',
    rota: '/bi',
    largura: 1440,
    altura: 1400,
    acao: `${clicar(`${bloco('evolucao')} button[aria-label^="Filtros do bloco"]`)}; await new Promise((r) => setTimeout(r, 300)); ${clicar(`${bloco('evolucao')} [role=dialog] button`, 8)}; await new Promise((r) => setTimeout(r, 300)); ${clicar(`${bloco('evolucao')} [role=dialog] button[class*="btnPrim"]`)}`,
    conferir: `(() => { const f = []; const t = ${texto(bloco('evolucao'))};
      if (!t.includes('Filtro próprio')) f.push('selo de filtro próprio');
      if (!t.includes('restaurar')) f.push('botão restaurar');
      if (${texto(bloco('semana'))}.includes('Filtro próprio')) f.push('filtro vazou para outro bloco');
      if (!${texto('#bi-atalho')}.length) f.push('filtro geral alterado');
      return f; })()`,
  },
  {
    nome: '05_comparativo_livre_e_mes',
    rota: '/bi',
    largura: 1440,
    altura: 4500,
    acao: `${clicar(`${bloco('comparativo')} [aria-label="Modo de comparação"] button`, 4)}`,
    conferir: `(() => { const f = []; const t = ${texto(bloco('comparativo'))};
      if (!t.includes('Período A (analisado)')) f.push('campos do modo livre');
      if (!t.includes('média por dia válido') && !t.includes('pareado')) f.push('critério informado');
      return f; })()`,
  },
  {
    nome: '06_periodo_longo_agrupamento',
    rota: '/bi',
    largura: 1440,
    altura: 1400,
    acao: `${setSelect('#bi-atalho', 'mes_anterior')}; await new Promise((r) => setTimeout(r, 400)); ${clicar('[aria-label="Filtros gerais"] [class*="seg"] button', 1)}`,
    conferir: `(() => { const f = []; const t = ${texto(bloco('evolucao'))};
      if (!t.includes('média por dia completo')) f.push('nota de média por agrupamento');
      return f; })()`,
  },
  {
    nome: '07_gestao_acesso_negado',
    rota: '/bi',
    largura: 1440,
    altura: 900,
    antes: `localStorage.setItem('homologacao.usuario', '00000000-0000-0000-0000-00000000000c')`,
    depois: `localStorage.setItem('homologacao.usuario', '00000000-0000-0000-0000-00000000000a')`,
    conferir: `(() => { const f = []; const t = document.body.innerText;
      if (!t.includes('Acesso negado')) f.push('acesso negado para gestão');
      if (t.includes('Faturamento bruto')) f.push('dados visíveis para gestão');
      if ([...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'BI Gerencial')) f.push('menu mostra BI para gestão');
      return f; })()`,
  },
  {
    nome: '08_celular_padrao',
    rota: '/bi',
    largura: 390,
    altura: 11500,
    movel: true,
    conferir: `(() => { const f = []; if (document.documentElement.scrollWidth > 391) f.push('rolagem horizontal da página: ' + document.documentElement.scrollWidth); return f; })()`,
  },
  {
    nome: '09_celular_filtros_abertos',
    rota: '/bi',
    largura: 390,
    altura: 1700,
    movel: true,
    acao: clicar('[aria-label="Filtros gerais"] button[aria-expanded]'),
    conferir: `(() => { const f = []; if (!document.querySelector('#bi-atalho') || document.querySelector('#bi-atalho').offsetParent === null) f.push('filtros não abriram'); if (document.documentElement.scrollWidth > 391) f.push('transborda'); return f; })()`,
  },
  {
    nome: '10_busca_e_exportacao',
    rota: '/bi',
    largura: 1440,
    altura: 4500,
    acao: `(() => { const el = document.querySelector('${bloco('tabela')} input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'ovo'); el.dispatchEvent(new Event('input', { bubbles: true })); })();
      await new Promise((r) => setTimeout(r, 2500));
      ${clicar(`${bloco('tabela')} button[aria-expanded]`)}; await new Promise((r) => setTimeout(r, 300)); ${clicar(`${bloco('tabela')} [role=menuitem]`, 0)};
      await new Promise((r) => setTimeout(r, 2500));
      ${clicar(`${bloco('tabela')} button[aria-expanded]`)}; await new Promise((r) => setTimeout(r, 300)); ${clicar(`${bloco('tabela')} [role=menuitem]`, 1)};
      await new Promise((r) => setTimeout(r, 4000));`,
    conferir: `(() => { const f = []; const linhas = [...document.querySelectorAll('${bloco('tabela')} tbody tr')].map((tr) => tr.innerText);
      if (linhas.length !== 2) f.push('busca "ovo" deveria trazer 2 códigos, trouxe ' + linhas.length);
      if (!linhas.some((l) => l.includes('311')) || !linhas.some((l) => l.includes('341'))) f.push('311 e 341 separados');
      if (${texto(bloco('tabela'))}.includes('Não foi possível exportar')) f.push('erro na exportação');
      return f; })()`,
    downloads: ['bi-produtos_2026-11-18_a_2026-11-24.xlsx', 'bi-produtos_2026-11-18_a_2026-11-24.pdf'],
  },
  {
    nome: '11_atualizar_dados',
    rota: '/bi',
    largura: 1440,
    altura: 1400,
    acao: `${setSelect('#bi-atalho', '30')}; ${esperar(1500)}; window.__antes = ${marcados('ranking')}; ${clicar('button[title^="Consultar novamente"]')}; ${esperar(200)}; window.__ocupado = document.querySelector('button[title^="Consultar novamente"]').disabled; ${esperar(4000)}`,
    conferir: `(() => { const f = [];
      if (document.querySelector('#bi-atalho').value !== '30') f.push('filtro geral perdido ao atualizar');
      if (${marcados('ranking')} !== window.__antes) f.push('seleção de produtos perdida ao atualizar');
      if (!window.__ocupado) f.push('sem indicação de carregamento durante a atualização');
      if (!/atualizado às \\d{2}:\\d{2}/.test(document.body.innerText)) f.push('horário da atualização');
      if (document.querySelector('button[title^="Consultar novamente"]').disabled) f.push('botão continuou bloqueado');
      return f; })()`,
  },
  {
    nome: '12_top20_e_50_por_pagina',
    rota: '/bi',
    largura: 1440,
    altura: 4200,
    acao: `${setSelect(`${bloco('ranking')} select[aria-label^="Quantidade de produtos"]`, '20')}; ${esperar(1200)}; ${setSelect(`${bloco('tabela')} [class*="porPagina"] select`, '50')}; ${esperar(1500)}`,
    conferir: `(() => { const f = [];
      if (document.querySelectorAll('${bloco('ranking')} tbody tr').length !== 20) f.push('ranking Top 20');
      const total = Number((${texto(bloco('tabela'))}.match(/de (\\d+) código/) || [])[1]);
      const linhas = document.querySelectorAll('${bloco('tabela')} tbody tr').length;
      if (!total || linhas !== Math.min(50, total)) f.push('50 por página: ' + linhas + ' linhas de ' + total);
      return f; })()`,
  },
  {
    nome: '13_mapa_calor_ticket',
    rota: '/bi',
    largura: 1440,
    altura: 4800,
    acao: `${clicar(`${bloco('calor')} [aria-label="Indicador do mapa de calor"] button`, 2)}; ${esperar(400)}; (() => { const r = document.querySelectorAll('${bloco('calor')} svg g')[5].querySelectorAll('rect')[8]; r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })(); ${esperar(300)}`,
    conferir: `(() => { const f = []; const t = ${texto(bloco('calor'))};
      if (!t.includes('ticket médio')) f.push('legenda do ticket médio');
      if (!t.includes('líquido ÷ vendas')) f.push('descrição do ticket (líquido ÷ vendas)');
      if (!t.includes('sem dados (dia da semana sem dia completo')) f.push('legenda de célula sem dados');
      if (!document.querySelector('${bloco('calor')} [role=tooltip]')) f.push('tooltip do mapa de calor');
      else if (!/Ticket médio/.test(document.querySelector('${bloco('calor')} [role=tooltip]').innerText)) f.push('tooltip sem os indicadores');
      return f; })()`,
  },
  {
    nome: '14_tooltip_lacuna_e_comparacao',
    rota: '/bi',
    largura: 1440,
    altura: 1400,
    acao: `${passarMouseNoPonto('evolucao', 1, 7)}; ${esperar(400)}`,
    conferir: `(() => { const f = []; const tt = ${texto(`${bloco('evolucao')} .recharts-tooltip-wrapper`)};
      if (!tt.includes('qui, 19/11/2026')) f.push('tooltip com data e dia da semana: ' + tt.slice(0, 80));
      if (!tt.includes('sem importação: lacuna, não é zero')) f.push('situação "sem importação" no tooltip');
      if (!tt.includes('Comparação indisponível')) f.push('lacuna não pode virar variação');
      if (/Variação/.test(tt)) f.push('variação exibida com lado inválido');
      return f; })()`,
  },
  {
    nome: '15_tooltip_dia_valido',
    rota: '/bi',
    largura: 1440,
    altura: 1400,
    acao: `${passarMouseNoPonto('evolucao', 2, 7)}; ${esperar(400)}`,
    conferir: `(() => { const f = []; const tt = ${texto(`${bloco('evolucao')} .recharts-tooltip-wrapper`)};
      if (!tt.includes('sex, 20/11/2026')) f.push('data do ponto');
      if (!tt.includes('Diferença (A − B)')) f.push('diferença absoluta');
      if (!/Variação\\s*[▲▼■]/.test(tt)) f.push('variação percentual');
      if (!/R\\$\\s?[\\d.]+,\\d{2}/.test(tt)) f.push('valor exato com centavos');
      return f; })()`,
  },
  {
    nome: '16_filtros_fixos_compactos',
    rota: '/bi',
    largura: 1440,
    altura: 900,
    acao: `window.scrollTo(0, 1500); ${esperar(800)}`,
    conferir: `(() => { const f = []; const b = document.querySelector('[aria-label="Filtros gerais"]'); const r = b.getBoundingClientRect();
      if (!/filtrosFixos/.test(b.className)) f.push('modo compacto não ativou');
      if (r.height > 50) f.push('barra fixa alta demais: ' + Math.round(r.height) + 'px');
      const topo = parseFloat(getComputedStyle(b).top);
      if (Math.abs(r.top - topo) > 1) f.push('barra não está logo abaixo do topo');
      if (b.querySelectorAll('[aria-label="Dias da semana"] button').length !== 7) f.push('dias da semana');
      for (const sel of ['#bi-atalho', '#bi-referencia', 'input[aria-label="Data inicial"]', 'input[aria-label="Data final"]', '[aria-label="Agrupamento"]', 'button[aria-label="Restaurar filtros"]']) {
        const el = b.querySelector(sel); if (!el || el.offsetParent === null) f.push('controle ausente: ' + sel);
      }
      const ultimo = [...b.children].filter((e) => e.offsetParent !== null).pop();
      if (ultimo && ultimo.getBoundingClientRect().top > r.top + 20) f.push('barra fixa quebrou em mais de uma linha');
      return f; })()`,
  },
  {
    nome: '18_participacao_e_comparativo_desktop',
    rota: '/bi',
    largura: 1440,
    altura: 5600,
    recortes: { participacao: '[data-bloco="participacao"]', ranking_e_participacao: '[data-bloco="ranking"]', comparativo: '[data-bloco="comparativo"]' },
    conferir: `(() => { const f = [];
      const part = document.querySelector('${bloco('participacao')}');
      const rosca = part.querySelector('[class*="rosca"]').getBoundingClientRect();
      const leg = part.querySelector('table').getBoundingClientRect();
      if (leg.top < rosca.bottom - 1) f.push('legenda deveria ficar abaixo da rosca');
      const corpo = part.querySelector('[class*="cardB"]').getBoundingClientRect();
      if (Math.abs((rosca.left + rosca.width / 2) - (corpo.left + corpo.width / 2)) > 4) f.push('rosca não centralizada');
      if (leg.width < corpo.width - 40) f.push('legenda sem largura total');
      const linhas = [...part.querySelectorAll('tbody tr')];
      if (linhas.some((tr) => tr.getBoundingClientRect().height > 36)) f.push('legenda com linha quebrada');
      if (!/R\\$\\s?[\\d.]+,\\d{2}/.test(part.innerText)) f.push('valores com centavos na legenda');
      const tabs = [...document.querySelectorAll('${bloco('comparativo')} table')];
      if (tabs.length !== 2) f.push('esperava 2 tabelas no comparativo');
      else {
        const [g, p] = tabs.map((x) => x.getBoundingClientRect());
        if (p.top < g.bottom) f.push('produtos deveriam ficar abaixo do geral');
        if (Math.abs(g.width - p.width) > 4) f.push('tabelas com larguras diferentes');
        const corpoC = document.querySelector('${bloco('comparativo')} [class*="cardB"]').getBoundingClientRect();
        if (g.width < corpoC.width - 40) f.push('geral sem largura total');
        const nomes = [...tabs[1].querySelectorAll('tbody td:first-child')];
        if (nomes.some((td) => td.getBoundingClientRect().height > 40)) f.push('nome de produto quebrando no comparativo');
        if (!/cód\\. \\d+/.test(tabs[1].innerText)) f.push('código G3 no comparativo');
      }
      return f; })()`,
  },
  {
    nome: '19_participacao_e_comparativo_celular',
    rota: '/bi',
    largura: 390,
    altura: 13500,
    movel: true,
    recortes: { participacao: '[data-bloco="participacao"]', comparativo: '[data-bloco="comparativo"]' },
    conferir: `(() => { const f = []; if (document.documentElement.scrollWidth > 391) f.push('rolagem horizontal: ' + document.documentElement.scrollWidth);
      const part = document.querySelector('${bloco('participacao')}');
      if (part.querySelector('[class*="rosca"]').getBoundingClientRect().width > 360) f.push('rosca maior que a tela');
      if (part.querySelector('table').getBoundingClientRect().right > 390) f.push('legenda transborda');
      const modos = [...document.querySelectorAll('${bloco('comparativo')} [aria-label="Modo de comparação"] button')];
      if (modos.some((b) => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1)) f.push('texto cortado nos modos do comparativo');
      return f; })()`,
  },
  {
    nome: '20_exportacao_geral_padrao',
    rota: '/bi',
    largura: 1440,
    altura: 1100,
    recortes: { cabecalho: '[class*="_cab__"]' },
    // Blocos fora da tela ainda não carregaram: a exportação consulta o que falta.
    acao: `window.scrollTo(0, 0); ${exportarGeral('xlsx')}; ${exportarGeral('pdf')}`,
    medir: medirExportacoes,
    conferir: conferirExportacoes(true),
    downloads: ['bi-gerencial_2026-11-18_a_2026-11-24.xlsx', 'bi-gerencial_2026-11-18_a_2026-11-24.pdf'],
  },
  {
    nome: '21_exportacao_filtros_proprios_produtos_livre',
    rota: '/bi',
    largura: 1440,
    altura: 4800,
    acao: `${setSelect('#bi-atalho', '30')}; ${esperar(1500)};
      ${clicar(`${bloco('evolucao')} button[aria-label^="Filtros do bloco"]`)}; ${esperar(300)}; ${clicar(`${bloco('evolucao')} [role=dialog] button`, 8)}; ${esperar(300)}; ${clicar(`${bloco('evolucao')} [role=dialog] button[class*="btnPrim"]`)}; ${esperar(800)};
      ${setSelect(`${bloco('ranking')} select[aria-label^="Quantidade de produtos"]`, '20')}; ${esperar(800)};
      ${clicar(`${bloco('ranking')} input[type=checkbox]`, 4)}; ${esperar(500)};
      ${clicar(`${bloco('calor')} [aria-label="Indicador do mapa de calor"] button`, 1)}; ${esperar(300)};
      ${clicar(`${bloco('comparativo')} [aria-label="Modo de comparação"] button`, 4)}; ${esperar(1500)};
      ${exportarGeral('xlsx')}; ${exportarGeral('pdf')}`,
    medir: medirExportacoes,
    conferir: conferirExportacoes(true),
    downloads: ['bi-gerencial_2026-10-26_a_2026-11-24.xlsx', 'bi-gerencial_2026-10-26_a_2026-11-24.pdf'],
  },
  {
    nome: '22_exportacao_todo_o_periodo',
    rota: '/bi',
    largura: 1440,
    altura: 1100,
    acao: `${definirData('Data inicial', '2026-07-01')}; ${esperar(400)}; ${definirData('Data final', '2026-11-25')}; ${esperar(2500)}; ${exportarGeral('xlsx')}; ${exportarGeral('pdf')}`,
    medir: medirExportacoes,
    conferir: conferirExportacoes(true),
    downloads: ['bi-gerencial_2026-07-01_a_2026-11-25.xlsx', 'bi-gerencial_2026-07-01_a_2026-11-25.pdf'],
  },
  {
    nome: '23_exportacao_periodo_sem_dados',
    rota: '/bi',
    largura: 1440,
    altura: 1100,
    acao: `${definirData('Data inicial', '2026-06-01')}; ${esperar(400)}; ${definirData('Data final', '2026-06-30')}; ${esperar(2500)}; ${exportarGeral('xlsx')}; ${exportarGeral('pdf')}`,
    medir: medirExportacoes,
    conferir: conferirExportacoes(true),
    downloads: ['bi-gerencial_2026-06-01_a_2026-06-30.xlsx', 'bi-gerencial_2026-06-01_a_2026-06-30.pdf'],
  },
  {
    nome: '24_exportacao_hoje_parcial',
    rota: '/bi',
    largura: 1440,
    altura: 1100,
    acao: `${setSelect('#bi-atalho', 'hoje')}; ${esperar(2000)}; ${exportarGeral('xlsx')}; ${exportarGeral('pdf')}`,
    medir: medirExportacoes,
    conferir: conferirExportacoes(true),
    downloads: ['bi-gerencial_2026-11-25_a_2026-11-25.xlsx', 'bi-gerencial_2026-11-25_a_2026-11-25.pdf'],
  },
  {
    nome: '25_cabecalho_celular',
    rota: '/bi',
    largura: 390,
    altura: 1200,
    movel: true,
    recortes: { cabecalho: '[class*="_cab__"]' },
    conferir: `(() => { const f = []; if (document.documentElement.scrollWidth > 391) f.push('rolagem horizontal: ' + document.documentElement.scrollWidth);
      const bs = [...document.querySelectorAll('button')].filter((x) => (x.getAttribute('aria-label') || '').startsWith('Exportar o BI Gerencial'));
      if (bs.length !== 2) f.push('botões de exportação no celular');
      if (bs.some((b) => b.getBoundingClientRect().right > 390)) f.push('botão fora da tela');
      return f; })()`,
  },
  {
    nome: '26_dashboard_acesso_rapido_admin',
    rota: '/dashboard',
    esperar: '#atalhos-titulo',
    largura: 1440,
    altura: 1200,
    recortes: { acesso_rapido: 'section[aria-labelledby="atalhos-titulo"]' },
    conferir: `(() => { const f = []; const sec = document.querySelector('section[aria-labelledby="atalhos-titulo"]');
      if (!sec) return ['seção Acesso rápido ausente'];
      const links = [...sec.querySelectorAll('a')];
      const bi = links.find((a) => a.textContent.trim() === 'BI Gerencial');
      if (!bi) f.push('atalho BI Gerencial ausente para admin');
      else {
        if (new URL(bi.href).pathname !== '/bi') f.push('atalho não aponta para /bi');
        const iFin = links.findIndex((a) => a.textContent.trim() === 'Financeiro');
        if (iFin >= 0 ? links[iFin + 1] !== bi : links[links.length - 1] !== bi) f.push('BI deveria ficar imediatamente após Financeiro');
        const ra = links[0].getBoundingClientRect(); const rb = bi.getBoundingClientRect();
        if (Math.abs(ra.width - rb.width) > 1 || Math.abs(ra.height - rb.height) > 1) f.push('dimensões diferentes dos demais atalhos');
        if (getComputedStyle(links[0]).fontSize !== getComputedStyle(bi).fontSize) f.push('tipografia diferente');
        const outro = links[0];
        if (outro && outro.className !== bi.className) f.push('padrão visual diferente dos demais atalhos');
        const iconeMenu = [...document.querySelectorAll('aside a')].find((a) => a.textContent.trim() === 'BI Gerencial');
        const svgBi = bi.querySelector('svg');
        if (!svgBi || !iconeMenu || iconeMenu.querySelector('svg').innerHTML !== svgBi.innerHTML) f.push('ícone diferente do menu lateral');
      }
      return f; })()`,
  },
  {
    nome: '27_dashboard_acesso_rapido_celular',
    rota: '/dashboard',
    esperar: '#atalhos-titulo',
    largura: 390,
    altura: 1600,
    movel: true,
    recortes: { acesso_rapido: 'section[aria-labelledby="atalhos-titulo"]' },
    conferir: `(() => { const f = []; if (document.documentElement.scrollWidth > 391) f.push('rolagem horizontal: ' + document.documentElement.scrollWidth);
      const sec = document.querySelector('section[aria-labelledby="atalhos-titulo"]');
      const bi = sec && [...sec.querySelectorAll('a')].find((a) => a.textContent.trim() === 'BI Gerencial');
      if (!bi) f.push('atalho BI ausente no celular');
      else if (bi.getBoundingClientRect().right > 390) f.push('atalho fora da tela');
      return f; })()`,
  },
  {
    nome: '28_dashboard_sem_bi_para_gestao',
    rota: '/dashboard',
    esperar: 'main',
    largura: 1440,
    altura: 1200,
    antes: `localStorage.setItem('homologacao.usuario', '00000000-0000-0000-0000-00000000000c')`,
    depois: `localStorage.setItem('homologacao.usuario', '00000000-0000-0000-0000-00000000000a')`,
    recortes: { pagina: 'main' },
    conferir: `(() => { const f = [];
      if ([...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'BI Gerencial')) f.push('BI Gerencial visível para o perfil gestão');
      if (!document.querySelector('section[aria-labelledby="atalhos-titulo"]')) f.push('acesso rápido do perfil gestão deveria existir (com os outros módulos)');
      return f; })()`,
  },
  {
    nome: '17_celular_rosca_e_tabela',
    rota: '/bi',
    largura: 390,
    altura: 11500,
    movel: true,
    conferir: `(() => { const f = []; if (document.documentElement.scrollWidth > 391) f.push('rolagem horizontal: ' + document.documentElement.scrollWidth);
      const busca = document.querySelector('${bloco('tabela')} input[type=search]');
      if (busca && busca.getBoundingClientRect().width < 200) f.push('busca estreita no celular');
      if (!document.querySelector('${bloco('participacao')} .recharts-pie')) f.push('rosca no celular');
      return f; })()`,
  },
];
