# Homologação local da Central de Importações G3

Ambiente **isolado** para ver e testar as telas reais da Central de
Importações (migration 0081) antes de publicar, **sem Supabase e sem dados
reais**:

- uma **cópia temporária** do sistema, fora do repositório (o repositório não é alterado);
- `lib/supabase/client.js` da cópia trocado por um cliente falso: login simulado
  e consultas/RPCs enviadas a `/api/homologacao`;
- `/api/homologacao` roda **as migrations reais até a 0081** num banco **PGlite em
  memória** (mesmas RPCs, RLS, grants e guardas da produção), com usuários fictícios;
- relatórios `.xlsx` **fictícios**, no formato do G3, gerados na pasta
  `homologacao-arquivos` da cópia;
- faixa fixa "HOMOLOGAÇÃO LOCAL" em todas as telas.

## Como usar

Na pasta da worktree:

```
node homologacao/importacoes-g3/preparar.mjs --iniciar
```

- Na primeira vez, instala as dependências **na cópia** (alguns minutos, precisa de internet para o npm).
- Abra **http://localhost:3918/homologacao**, escolha o usuário e entre na Central.
- Para parar: `Ctrl+C`. Para recomeçar do zero: botão "Recriar banco fictício".

Usuários fictícios: **Admin Teste** (proprietario_admin: acesso total) e
**Gestão Teste** (perfil gestao: menu escondido e "Acesso negado").

## Roteiro sugerido

1. Admin: importar `1_diario_junho`, `2_faturamento_junho` e `3_itens_junho` (prévia → confirmar). No painel, junho fica conciliado.
2. `4_itens_junho_reexportado`: prévia com alterada, ausente (exige o reconhecimento) e bloqueada; confirmar; ver a pendência e o dia "com pendências".
3. Reverter o lote 4 (motivo obrigatório) e conferir que tudo volta.
4. `5_itens_filtrado_salgado`: recusado já no navegador (filtro de seção).
5. `6_faturamento_com_cliente`: o resumo mostra 1 cliente mascarado; o nome nunca é enviado.
6. `7_faturamento_regravado`: aceito com o alerta de arquivo regravado; tudo "igual".
7. Entrar como Gestão Teste: o menu não mostra "Importações G3" e `/importacoes` mostra "Acesso negado".
