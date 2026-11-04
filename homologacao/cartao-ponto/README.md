# Homologação local do Cartão-Ponto

Ambiente **isolado** para ver e testar as telas reais do Cartão-Ponto antes de
publicar, **sem Supabase e sem dados reais**:

- uma **cópia temporária** do sistema, fora do repositório (o repositório não é alterado);
- `lib/supabase/client.js` da cópia trocado por um cliente falso: login simulado
  e consultas/RPCs enviadas a `/api/homologacao`;
- `/api/homologacao` roda **a migration 0078 real** num banco **PGlite em memória**
  (mesmas RPCs, permissões, RLS e guardas da produção), com dados fictícios (`seed.sql`);
- faixa fixa "HOMOLOGAÇÃO LOCAL" em todas as telas.

## Como usar

Na pasta da worktree (`.claude/worktrees/cartao-ponto`):

```
node homologacao/cartao-ponto/preparar.mjs --iniciar
```

- Na primeira vez, instala as dependências **na cópia** (alguns minutos, precisa de internet para o npm).
- Abra **http://localhost:3917/homologacao**, escolha o usuário e entre no Cartão-Ponto.
- Para parar: `Ctrl+C`. Para recomeçar do zero: botão "Recriar banco fictício" (ou reiniciar).

Usuários fictícios: **Admin** (tudo), **Lançadora** (ver e lançar) e **Leitora** (só ver).

## Roteiro sugerido

1. Lista da competência: mês atual, navegar para meses anteriores; Bruna aparece só até o mês do desligamento; Carla (freelancer) nunca aparece.
2. Prévia (Ana, mês passado): totais, Falta, dia sem Escala pendente, feriados, dias futuros no mês atual.
3. Abrir o cartão, lançar horários (Igual ao previsto, Repetir horários, modal do dia), salvar; tentar sair com alterações não salvas (menu, voltar, trocar mês, recarregar).
4. Atestado de vários dias sobre a Falta (ver a prévia do impacto); atestado parcial; data muito distante (alerta).
5. Resolver o dia sem Escala (Folga com motivo), conferir, fechar; exportar PDF/Excel (fechado x prévia); ZIP na lista.
6. Cartão já fechado (Ana, há 2 meses): só leitura, reabrir com motivo, histórico.
7. Repetir com a Lançadora e a Leitora (botões que somem/ficam bloqueados).
8. Conflito de versão: o mesmo cartão em duas abas; salvar numa e depois na outra.

Nada aqui substitui o teste final em produção, mas todos os fluxos de escrita
podem ser exercitados sem tocar no Supabase.
