import { useState } from 'react';
import { USUARIOS_HOMOLOGACAO, escolherUsuario } from '../lib/supabase/client';

// HOMOLOGAÇÃO LOCAL -- painel da cópia temporária do BI Gerencial: escolher
// o usuário fictício e recriar o banco em memória.
export default function Homologacao() {
  const [mensagem, setMensagem] = useState('');

  async function recriar() {
    setMensagem('Recriando…');
    const r = await fetch('/api/homologacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'recriar' }) });
    const j = await r.json();
    setMensagem(j.error ? `Erro: ${j.error.message}` : 'Banco fictício recriado.');
  }

  return (
    <main style={{ maxWidth: 760, margin: '32px auto', padding: 16, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1>Homologação local — BI Gerencial</h1>
      <p>
        Ambiente <strong>isolado</strong>: banco em memória nesta máquina com as migrations reais até a 0084 e cerca de
        4 meses de vendas <strong>fictícias</strong>, <strong>sem conexão com o Supabase</strong>. &quot;Hoje&quot; é 25/11/2026.
      </p>
      <h2>1. Entrar como</h2>
      <ul>
        {USUARIOS_HOMOLOGACAO.map((u) => (
          <li key={u.id} style={{ marginBottom: 8 }}>
            <a href="/bi" onClick={() => escolherUsuario(u.id)}><strong>{u.nome}</strong></a> — {u.descricao}
          </li>
        ))}
      </ul>
      <h2>2. Cenário fictício</h2>
      <ul>
        <li>Operação oficial desde 09/07/2026; dias completos até 24/11.</li>
        <li><strong>19/11</strong>: sem importação (lacuna, não zero).</li>
        <li><strong>25/11</strong>: parcial, relatórios gerados às 12:44.</li>
        <li><strong>24 e 25/07</strong>: cobertura não confirmada (fora das médias).</li>
        <li>Códigos <strong>311</strong> e <strong>341</strong> com a mesma descrição (&quot;OVO FICTICIO&quot;); código <strong>900</strong> com quantidade decimal.</li>
        <li>Cerca de 0,5% das vendas sem itens (não conciliadas: entram no faturamento, ficam fora de produtos).</li>
      </ul>
      <h2>3. Recomeçar</h2>
      <button type="button" onClick={recriar}>Recriar banco fictício</button> <span role="status">{mensagem}</span>
    </main>
  );
}
