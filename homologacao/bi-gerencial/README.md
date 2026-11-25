# Homologação local do BI Gerencial

Ambiente **isolado** para ver e testar a página real `/bi` (migrations 0083 +
0084) **sem Supabase e sem dados reais**:

- uma **cópia temporária** do sistema, fora do repositório (o repositório não é alterado);
- `lib/supabase/client.js` da cópia trocado por um cliente falso: login simulado
  e consultas/RPCs enviadas a `/api/homologacao`;
- `/api/homologacao` roda **as migrations reais até a 0084** num banco **PGlite em
  memória** (mesmas RPCs, RLS, grants e guardas da produção, inclusive o
  bloqueio 42501 para quem não é proprietário/administrador);
- cerca de **4 meses de vendas fictícias** (`dados-ficticios.mjs`, determinístico);
- faixa fixa "HOMOLOGAÇÃO LOCAL" em todas as telas.

A simulação existe **só nesta cópia**: a página `/bi` do sistema não tem
nenhum dado de exemplo nem *fallback*.

## Como usar

Na pasta da worktree:

```
node homologacao/bi-gerencial/preparar.mjs --iniciar
```

- Na primeira vez, instala as dependências **na cópia** (alguns minutos, precisa de internet para o npm).
- Abra **http://localhost:3919/homologacao**, escolha o usuário e entre no BI.
- Para parar: `Ctrl+C`. Para recomeçar do zero: botão "Recriar banco fictício".

Cada login em `/homologacao` abre uma **sessão simulada nova**: filtros,
Top N, registros por página e produtos selecionados ficam salvos entre
recargas da página (como em produção) e voltam ao padrão num novo login
(com a seleção automática dos 3 maiores produtos).

Usuários fictícios: **Admin Teste** (proprietario_admin: acesso total) e
**Gestão Teste** (perfil gestao: menu sem o BI, "Acesso negado" e RPCs recusadas).

## Cenário fictício

"Hoje" = 25/11/2026. Operação desde 09/07/2026; dias completos até 24/11;
**19/11 sem importação**; **25/11 parcial** (relatórios das 12:44); **24 e 25/07
cobertura não confirmada**; códigos **311/341** com a mesma descrição; código
**900** com quantidade decimal; ~0,5% das vendas sem itens (não conciliadas).

## Conferência automática (opcional)

Com o servidor no ar:

```
node homologacao/bi-gerencial/capturar.mjs --url=http://localhost:3919 --roteiro=todos --saida=<pasta>
```

Roda os 20 cenários de `roteiro.mjs` no Chrome instalado (sem dependências; cada cenário começa num login novo, salvo `manterSessao`),
grava as capturas e `relatorio.json` (falhas, erros de console, transbordo
horizontal, blocos com erro). Sai com código 1 se algum cenário falhar.

## Roteiro sugerido (manual)

1. Admin: conferir cabeçalho (dados completos até 24/11, parcial de 25/11), faixa de cobertura (19/11 sem importação), os 6 cartões com variação e os 3 produtos selecionados automaticamente.
2. Botão **Atualizar** (ao lado da última importação): recarrega tudo mantendo filtros e seleção.
3. Rolar a página: a barra de filtros vira uma linha compacta no topo.
4. Passar o mouse nos gráficos (19/11 = lacuna sem importação, sem variação; demais dias com diferença e variação) e no mapa de calor (Faturamento / Vendas / Ticket).
5. Trocar o período para **Hoje**: cartões com selo "parcial", sem variação, média diária "sem dados".
6. **Mês anterior** + agrupamento **Semana**/**Mês**: gráficos por média de dia completo.
7. Ranking Top 5/10/20; remover todos os selecionados e recarregar (a seleção automática não volta); marcar 3 produtos: aparecem com a mesma cor na evolução, nos horários e no comparativo.
8. Abrir o filtro (funil) de um bloco, aplicar um filtro próprio e restaurar.
9. Comparativo: Período anterior, Mês, Semana, Mesmo dia da semana e Livre A × B.
10. Tabela: 10/20/50/100 por página, busca (ex.: "ovo" mostra 311 e 341 separados), ordenação por coluna, paginação, exportação Excel/PDF.
11. Entrar como **Gestão Teste**: sem o item no menu e "Acesso negado" em `/bi`.
12. Repetir no celular (ou com a janela estreita).
