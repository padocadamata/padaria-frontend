import { useState } from 'react';
import { USUARIOS_HOMOLOGACAO, escolherUsuario } from '../lib/supabase/client';

// HOMOLOGAÇÃO LOCAL -- painel da cópia temporária: escolher o usuário
// fictício (permissões diferentes) e recriar o banco em memória.
export default function Homologacao() {
  const [mensagem, setMensagem] = useState('');

  async function recriar() {
    setMensagem('Recriando…');
    const r = await fetch('/api/homologacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'recriar' }) });
    const j = await r.json();
    setMensagem(j.error ? `Erro: ${j.error.message}` : 'Banco fictício recriado (tudo voltou ao estado inicial).');
  }

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: 16, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1>Homologação local — Cartão-Ponto</h1>
      <p>
        Ambiente <strong>isolado</strong>: banco em memória nesta máquina, dados fictícios, <strong>sem conexão com o Supabase</strong>.
        Tudo o que for gravado aqui some ao recriar o banco ou reiniciar o servidor.
      </p>
      <h2>1. Entrar como</h2>
      <ul>
        {USUARIOS_HOMOLOGACAO.map((u) => (
          <li key={u.id} style={{ marginBottom: 8 }}>
            <a href="/funcionarios/ponto" onClick={() => escolherUsuario(u.id)}><strong>{u.nome}</strong></a> — {u.descricao}
          </li>
        ))}
      </ul>
      <h2>2. Dados fictícios</h2>
      <ul>
        <li><strong>Ana Fictícia</strong> (ativa): Escala de 3 meses atrás até o mês que vem; mês passado com uma Falta e um dia sem Escala (dia 20); há 2 meses um cartão já <strong>fechado</strong> e um Atestado na Escala.</li>
        <li><strong>Bruna Fictícia</strong>: desligada no dia 15 do mês passado.</li>
        <li><strong>Carla Fictícia</strong>: freelancer — não deve aparecer no Cartão-Ponto.</li>
      </ul>
      <h2>3. Recomeçar do zero</h2>
      <button type="button" onClick={recriar}>Recriar banco fictício</button> <span role="status">{mensagem}</span>
    </main>
  );
}
