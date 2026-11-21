// HOMOLOGAÇÃO LOCAL -- roda NA CÓPIA temporária (chamado por preparar.mjs):
// monta o banco PGlite com as migrations REAIS até a 0081 (mesmo ambiente dos
// testes automatizados, supabase/tests/ambiente_pedidos.mjs) e grava o
// retrato em homologacao/importacoes-g3/banco.retrato, que a API local
// carrega. Usuários fictícios: ADMIN (proprietario_admin) e GESTAO (gestao).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { novoBanco } from '../../supabase/tests/ambiente_pedidos.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const db = await novoBanco({
  extras: ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql',
    '0080_central_notificacoes.sql', '0081_importacoes_g3.sql'],
});
await db.exec(`update public.usuarios set nome = 'Admin Teste' where perfil = 'proprietario_admin';
               update public.usuarios set nome = 'Gestão Teste' where id = '00000000-0000-0000-0000-00000000000c';
               select set_config('teste.uid', '', false);`);
const retrato = await db.dumpDataDir('none');
writeFileSync(path.join(aqui, 'banco.retrato'), Buffer.from(await retrato.arrayBuffer()));
await db.close();
console.log('[homologação] banco montado (migrations até a 0081).');
