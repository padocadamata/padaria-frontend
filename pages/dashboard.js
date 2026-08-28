import { useState, useEffect } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';
import NavegacaoPrincipal from '../components/NavegacaoPrincipal';
import RequireAuth from '../components/RequireAuth';
import LembretesRapidos from '../components/dashboard/LembretesRapidos';
import AtencaoProducao from '../components/dashboard/AtencaoProducao';
import RecebimentosPrevistos from '../components/dashboard/RecebimentosPrevistos';
import ProximosPedidos from '../components/dashboard/ProximosPedidos';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { useAuth } from '../hooks/useAuth';
import { dataLocalHoje, diaDaSemanaExibicao } from '../lib/data/dataLocal';

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarDataExibicao(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function DashboardConteudo() {
  const { permissoes } = useAuth();
  const hoje = dataLocalHoje();
  const podeVerProducao = hasPermissao(permissoes, PERMISSOES.PRODUCAO_VISUALIZAR);
  const podeVerFornecedores = hasPermissao(permissoes, PERMISSOES.FORNECEDORES_VISUALIZAR);
  const podeVerPedidos = hasPermissao(permissoes, PERMISSOES.PEDIDOS_VISUALIZAR);
  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

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
      const config = localStorage.getItem('aparenciaConfig');
      if (config) {
        try {
          setAparencia(JSON.parse(config));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {aparencia.logoBase64 && (
              <img 
                src={aparencia.logoBase64} 
                style={{ height: '50px', maxWidth: '150px', borderRadius: '5px' }}
                alt="Logo"
              />
            )}
            <h1 style={{ margin: 0 }}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          </div>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <NavegacaoPrincipal corPrimaria={aparencia.corPrimaria} />

        <h2 style={{ color: aparencia.corPrimaria, margin: '0 0 20px 0' }}>
          Dashboard — {capitalizar(diaDaSemanaExibicao(hoje))}, {formatarDataExibicao(hoje)}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {podeVerProducao && <AtencaoProducao corPrimaria={aparencia.corPrimaria} />}

          <LembretesRapidos corPrimaria={aparencia.corPrimaria} />

          {podeVerPedidos && <RecebimentosPrevistos corPrimaria={aparencia.corPrimaria} />}

          {podeVerFornecedores && <ProximosPedidos corPrimaria={aparencia.corPrimaria} />}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <RequireAuth permissao={PERMISSOES.DASHBOARD_VISUALIZAR}>
      <DashboardConteudo />
    </RequireAuth>
  );
}
