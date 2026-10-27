import FuncionariosSubNav from '../funcionarios/FuncionariosSubNav';
import PageHeader from '../ui/PageHeader';
import Button from '../ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { permissoesComunicacao } from '../../lib/documentos/apresentacao';
import estilos from './documentos.module.css';

export const ROTA_DOCUMENTOS = '/funcionarios/comunicacao';
export const ROTA_MODELOS = '/funcionarios/comunicacao/modelos';
export const ROTA_GERAR = '/funcionarios/comunicacao/gerar';
export const ROTA_EMPRESA = '/funcionarios/comunicacao/empresa';
export const rotaDocumento = (id) => `/funcionarios/comunicacao/documentos/${id}`;
export const rotaModelo = (id) => `/funcionarios/comunicacao/modelos/${id}`;

// Cabeçalho comum da área Folha > Comunicação: abas da Folha, título e a
// alternância Documentos | Modelos (rotas próprias -- cada visão pela sua
// permissão: Documentos exige visualizar; Modelos, qualquer uma das três da
// área). Ações específicas da visão chegam em `acoes`.
export default function ComunicacaoCabecalho({ visao, acoes }) {
  const { permissoes } = useAuth();
  const p = permissoesComunicacao(permissoes);
  return (
    <>
      <FuncionariosSubNav ativo="comunicacao" />
      <PageHeader
        titulo="Comunicação"
        subtitulo="Documentos de RH emitidos a partir de modelos — advertências, comunicados, termos e avisos."
        acoes={acoes}
      />
      <nav className={estilos.visoes} aria-label="Visões da Comunicação">
        {p.visualizar && (
          <Button href={ROTA_DOCUMENTOS} tamanho="sm" variante={visao === 'documentos' ? 'primary' : 'secondary'} aria-current={visao === 'documentos' ? 'page' : undefined}>
            Documentos
          </Button>
        )}
        <Button href={ROTA_MODELOS} tamanho="sm" variante={visao === 'modelos' ? 'primary' : 'secondary'} aria-current={visao === 'modelos' ? 'page' : undefined}>
          Modelos
        </Button>
      </nav>
    </>
  );
}

// Protege as telas da área: precisa de QUALQUER uma das permissões de
// entrada (RequireAuth cuida de sessão/perfil; a RLS protege os dados).
export function AreaComunicacao({ exigir = 'area', children }) {
  const { permissoes } = useAuth();
  const p = permissoesComunicacao(permissoes);
  if (!p[exigir]) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <h1 style={{ color: '#8B4513' }}>Acesso negado</h1>
        <p style={{ color: '#666' }}>Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }
  return children;
}
