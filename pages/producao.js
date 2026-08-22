import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';
import RequireAuth from '../components/RequireAuth';
import CardTurno from '../components/producao/CardTurno';
import BannerPendencias from '../components/producao/BannerPendencias';
import SeletorOutroProduto from '../components/producao/SeletorOutroProduto';
import { PERMISSOES } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';
import { dataLocalHoje, dataLocalExibicao } from '../lib/data/dataLocal';

const TURNOS = [
  { chave: 'manha', label: 'Manhã' },
  { chave: 'tarde', label: 'Tarde' },
];

const PRODUTO_PRINCIPAL = 'Francês';

function capitalizarPrimeiraLetra(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function ProducaoConteudo() {
  const router = useRouter();
  const { permissoes, perfilUsuario } = useAuth();

  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [hoje, setHoje] = useState(() => dataLocalHoje());
  const [registrosHoje, setRegistrosHoje] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [receitasAtivas, setReceitasAtivas] = useState([]);
  // receita_id adicionados via "+ Outro produto" nesta sessão do navegador.
  // Não é persistido em lugar nenhum — ao recarregar a página, só volta a
  // aparecer se já existir registro de hoje para aquele produto.
  const [produtosExtras, setProdutosExtras] = useState([]);

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');
    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }

    const handleAparenciaAlterada = () => {
      const novaConfig = localStorage.getItem('aparenciaConfig');
      if (novaConfig) {
        try {
          setAparencia(JSON.parse(novaConfig));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  const carregarDados = useCallback(async () => {
    setCarregando(true);
    setErro('');

    const hojeAtual = dataLocalHoje();
    setHoje(hojeAtual);

    const supabase = createClient();

    const [registrosResp, pendenciasResp, receitasResp] = await Promise.all([
      supabase.from('producao_registros').select('*').eq('data', hojeAtual),
      supabase
        .from('producao_registros')
        .select(
          'id, data, turno, receita_id, origem, status, quantidade_produzida, quantidade_vendida, sobra_total, sobra_aproveitavel, perda_descarte, observacoes'
        )
        .lt('data', hojeAtual)
        .in('status', ['aberto', 'reaberto'])
        .order('data', { ascending: true }),
      supabase
        .from('receitas')
        .select('id, nome')
        .eq('ativo', true)
        .eq('controlado_producao', true)
        .order('nome', { ascending: true }),
    ]);

    const primeiroErro = registrosResp.error || pendenciasResp.error || receitasResp.error;
    if (primeiroErro) {
      console.error('Erro ao carregar dados de produção:', primeiroErro);
      setErro('Não foi possível carregar os dados de produção.');
      setCarregando(false);
      return;
    }

    setRegistrosHoje(registrosResp.data || []);
    setPendencias(pendenciasResp.data || []);
    setReceitasAtivas(receitasResp.data || []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const receitaNomePorId = useMemo(() => {
    const mapa = {};
    for (const r of receitasAtivas) {
      mapa[r.id] = r.nome;
    }
    return mapa;
  }, [receitasAtivas]);

  const frances = useMemo(
    () => receitasAtivas.find((r) => r.nome === PRODUTO_PRINCIPAL),
    [receitasAtivas]
  );

  // Ordem de exibição: Francês sempre primeiro, depois qualquer produto
  // que já tenha registro hoje, depois os adicionados via "+ Outro
  // produto" nesta sessão.
  const blocosProduto = useMemo(() => {
    const blocos = [];
    const vistos = new Set();

    if (frances) {
      blocos.push({ receitaId: frances.id, receitaNome: frances.nome });
      vistos.add(frances.id);
    }

    for (const registro of registrosHoje) {
      if (!vistos.has(registro.receita_id)) {
        blocos.push({
          receitaId: registro.receita_id,
          receitaNome: receitaNomePorId[registro.receita_id] || registro.receita_id,
        });
        vistos.add(registro.receita_id);
      }
    }

    for (const receitaId of produtosExtras) {
      if (!vistos.has(receitaId)) {
        blocos.push({ receitaId, receitaNome: receitaNomePorId[receitaId] || receitaId });
        vistos.add(receitaId);
      }
    }

    return blocos;
  }, [frances, registrosHoje, produtosExtras, receitaNomePorId]);

  const receitasDisponiveisParaAdicionar = useMemo(() => {
    const jaExibidos = new Set(blocosProduto.map((b) => b.receitaId));
    return receitasAtivas.filter((r) => !jaExibidos.has(r.id));
  }, [receitasAtivas, blocosProduto]);

  function registroDoBloco(receitaId, turno) {
    return registrosHoje.find((r) => r.receita_id === receitaId && r.turno === turno) || null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {aparencia.logoBase64 && (
              <img src={aparencia.logoBase64} style={{ height: '50px', maxWidth: '150px', borderRadius: '5px' }} alt="Logo" />
            )}
            <h1 style={{ margin: 0 }}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          </div>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: aparencia.corPrimaria, border: '1px solid ' + aparencia.corPrimaria, cursor: 'pointer', borderRadius: '5px' }}
          >
            Dashboard
          </button>
          <button
            onClick={() => router.push('/fornecedores')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: aparencia.corPrimaria, border: '1px solid ' + aparencia.corPrimaria, cursor: 'pointer', borderRadius: '5px' }}
          >
            Fornecedores
          </button>
          <button
            onClick={() => router.push('/producao')}
            style={{ padding: '10px 20px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px' }}
          >
            Produção
          </button>
        </div>

        <h2 style={{ color: aparencia.corPrimaria, marginBottom: '20px' }}>
          Hoje — {capitalizarPrimeiraLetra(dataLocalExibicao())}
        </h2>

        {erro && <p style={{ color: '#f44336' }}>{erro}</p>}

        {carregando ? (
          <p>Carregando produção...</p>
        ) : (
          <>
            <BannerPendencias
              pendencias={pendencias}
              receitaNomePorId={receitaNomePorId}
              corPrimaria={aparencia.corPrimaria}
              permissoes={permissoes}
              onAtualizado={carregarDados}
            />

            {blocosProduto.map((bloco) => (
              <div key={bloco.receitaId} style={{ marginBottom: '30px' }}>
                <h3 style={{ color: aparencia.corPrimaria, marginBottom: '10px' }}>{bloco.receitaNome}</h3>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  {TURNOS.map((t) => (
                    <CardTurno
                      key={t.chave}
                      turno={t.chave}
                      label={t.label}
                      registro={registroDoBloco(bloco.receitaId, t.chave)}
                      receitaId={bloco.receitaId}
                      receitaNome={bloco.receitaNome}
                      data={hoje}
                      corPrimaria={aparencia.corPrimaria}
                      permissoes={permissoes}
                      perfilUsuario={perfilUsuario}
                      onAtualizado={carregarDados}
                    />
                  ))}
                </div>
              </div>
            ))}

            <SeletorOutroProduto
              receitasDisponiveis={receitasDisponiveisParaAdicionar}
              corPrimaria={aparencia.corPrimaria}
              onSelecionar={(receita) => setProdutosExtras((atual) => [...atual, receita.id])}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function Producao() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUCAO_VISUALIZAR}>
      <ProducaoConteudo />
    </RequireAuth>
  );
}
