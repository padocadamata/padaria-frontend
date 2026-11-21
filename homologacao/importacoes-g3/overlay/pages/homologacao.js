import { useState } from 'react';
import { USUARIOS_HOMOLOGACAO, escolherUsuario } from '../lib/supabase/client';

// HOMOLOGAÇÃO LOCAL -- painel da cópia temporária da Central de Importações
// G3: escolher o usuário fictício e recriar o banco em memória.
export default function Homologacao() {
  const [mensagem, setMensagem] = useState('');

  async function recriar() {
    setMensagem('Recriando…');
    const r = await fetch('/api/homologacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'recriar' }) });
    const j = await r.json();
    setMensagem(j.error ? `Erro: ${j.error.message}` : 'Banco fictício recriado (nenhuma importação).');
  }

  return (
    <main style={{ maxWidth: 760, margin: '32px auto', padding: 16, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1>Homologação local — Central de Importações G3</h1>
      <p>
        Ambiente <strong>isolado</strong>: banco em memória nesta máquina com as migrations reais até a 0081, dados fictícios,
        <strong> sem conexão com o Supabase</strong>. Tudo some ao recriar o banco ou reiniciar o servidor.
      </p>
      <h2>1. Entrar como</h2>
      <ul>
        {USUARIOS_HOMOLOGACAO.map((u) => (
          <li key={u.id} style={{ marginBottom: 8 }}>
            <a href="/importacoes" onClick={() => escolherUsuario(u.id)}><strong>{u.nome}</strong></a> — {u.descricao}
          </li>
        ))}
      </ul>
      <h2>2. Arquivos fictícios para testar</h2>
      <p>Na pasta <code>homologacao-arquivos</code> desta cópia (escolha-os em &quot;Nova importação&quot;):</p>
      <ol>
        <li><code>1_diario_junho.xlsx</code>, <code>2_faturamento_junho.xlsx</code>, <code>3_itens_junho.xlsx</code>: junho completo, os 3 relatórios coerentes (o resultado esperado é tudo conciliado).</li>
        <li><code>4_itens_junho_reexportado.xlsx</code>: exportação posterior com uma venda corrigida, uma sumida (ausente) e uma com valor zero (bloqueada).</li>
        <li><code>5_itens_filtrado_salgado.xlsx</code>: relatório filtrado por seção — deve ser recusado.</li>
        <li><code>6_faturamento_com_cliente.xlsx</code>: cliente identificado com nome — o nome é mascarado no navegador antes do envio.</li>
        <li><code>7_faturamento_regravado.xlsx</code>: o mesmo faturamento salvo de novo (textos compartilhados) — aceito com alerta, tudo &quot;igual&quot;.</li>
      </ol>
      <h2>3. Recomeçar do zero</h2>
      <button type="button" onClick={recriar}>Recriar banco fictício</button> <span role="status">{mensagem}</span>
    </main>
  );
}
