import { ACAO_LABEL, CODIGOS_ADMINISTRATIVOS, MODULOS_MATRIZ, GRUPO_LABEL, codigosDoGrupo, estaExpirado } from '../../lib/auth/matrizPermissoes';
import Badge from '../ui/Badge';
import Checkbox from '../ui/Checkbox';
import DataTable from '../ui/DataTable';
import Select from '../ui/Select';
import estilos from './usuarios.module.css';

// Grade de permissões da tela Admin → Usuários e Acessos. Componente
// controlado: não fala com o Supabase diretamente — só apresenta
// `permissoesHerdadas`/`overridesOriginais` (verdade atual do banco) e
// `estado` (edição local em andamento, dona de pages/admin/usuarios/[id].js),
// e avisa `onAlterarLinha` quando o admin mexe em algum controle. Quem
// monta o diff e chama a RPC é a página, não este componente.
function obterEstadoLinha(estado, codigo) {
  return estado.get(codigo) || { estado: 'herdar', expiraEm: '' };
}

// Checkbox "Acesso total a <grupo>" (ex.: Produção) -- reaproveita
// EXATAMENTE os mesmos códigos já listados nos módulos daquele grupo em
// MODULOS_MATRIZ (via codigosDoGrupo) -- nunca uma permissão nova no
// banco, só um atalho de UX que marca "Permitir" em todas de uma vez, ou
// devolve todas para "Herdar do perfil" (controle individual) quando
// desmarcado. Marcado só quando TODAS já estão como "Permitir" no estado
// local (evita indicar "total" quando só parte foi concedida).
function AcessoTotalGrupo({ grupo, estado, onAlterarLinha }) {
  const codigos = codigosDoGrupo(grupo);
  const todasPermitir = codigos.length > 0 && codigos.every((codigo) => obterEstadoLinha(estado, codigo).estado === 'permitir');

  function alternar() {
    const novoEstado = todasPermitir ? 'herdar' : 'permitir';
    for (const codigo of codigos) {
      onAlterarLinha(codigo, { estado: novoEstado, expiraEm: '' });
    }
  }

  return (
    <Checkbox
      rotulo={`Acesso total à ${GRUPO_LABEL[grupo] || grupo}`}
      checked={todasPermitir}
      onChange={alternar}
    />
  );
}

function TabelaModulo({ modulo, permissoesHerdadas, overridesOriginais, estado, onAlterarLinha }) {
  const linhas = modulo.itens.map(({ codigo, acao }) => ({
    codigo,
    acaoLabel: ACAO_LABEL[acao] || acao,
    herdado: permissoesHerdadas.has(codigo),
    overrideOriginal: overridesOriginais.get(codigo) || null,
    linhaEstado: obterEstadoLinha(estado, codigo),
  }));

  const colunas = [
    { chave: 'acao', rotulo: 'Ação', mobile: 'titulo', cartaoOrdem: 0, render: (l) => l.acaoLabel },
    {
      chave: 'herdado',
      rotulo: 'Herdado do perfil',
      render: (l) => (l.herdado ? <Badge tom="info">Herdado</Badge> : '—'),
    },
    {
      chave: 'controle',
      rotulo: 'Controle',
      render: (l) => (
        <Select
          value={l.linhaEstado.estado}
          onChange={(e) => onAlterarLinha(l.codigo, { estado: e.target.value })}
          aria-label={`Controle de ${l.acaoLabel}`}
        >
          <option value="herdar">Herdar do perfil</option>
          <option value="permitir">Permitir</option>
          <option value="bloquear">Bloquear</option>
        </Select>
      ),
    },
    {
      chave: 'expira',
      rotulo: 'Expira em',
      render: (l) =>
        l.linhaEstado.estado !== 'herdar' ? (
          <input
            type="datetime-local"
            value={l.linhaEstado.expiraEm}
            onChange={(e) => onAlterarLinha(l.codigo, { expiraEm: e.target.value })}
            title="Expira em — vazio = permanente"
            aria-label={`Expiração de ${l.acaoLabel}`}
          />
        ) : (
          '—'
        ),
    },
    {
      chave: 'individual',
      rotulo: 'Estado individual',
      render: (l) => {
        const expirado = l.overrideOriginal && estaExpirado(l.overrideOriginal.expira_em);
        return (
          <div className={estilos.badges}>
            {l.overrideOriginal?.efeito === 'concede' && <Badge tom="success">Permitido individualmente</Badge>}
            {l.overrideOriginal?.efeito === 'nega' && <Badge tom="danger">Bloqueado individualmente</Badge>}
            {expirado && <Badge tom="neutral">Expirado</Badge>}
            {!l.overrideOriginal && !expirado && '—'}
          </div>
        );
      },
    },
    {
      chave: 'efetivo',
      rotulo: 'Efetivo',
      mobile: 'titulo',
      cartaoOrdem: 1,
      render: (l) => {
        const efetivo = l.linhaEstado.estado === 'permitir' ? true : l.linhaEstado.estado === 'bloquear' ? false : l.herdado;
        return <Badge tom={efetivo ? 'success' : 'neutral'}>{efetivo ? 'Sim' : 'Não'}</Badge>;
      },
    },
  ];

  return (
    <div className={estilos.moduloBloco}>
      <h4 className={estilos.moduloTitulo}>{modulo.label}</h4>
      <DataTable rotulo={`Permissões — ${modulo.label}`} colunas={colunas} linhas={linhas} chaveLinha={(l) => l.codigo} cartoesAte={700} />
    </div>
  );
}

export default function MatrizPermissoes({ permissoesHerdadas, overridesOriginais, estado, onAlterarLinha }) {
  // Módulos sem `grupo` renderizam individualmente, exatamente como antes
  // (Dashboard/Fornecedores). Módulos COM `grupo` (hoje só 'producao')
  // ganham um cabeçalho de seção com o checkbox "Acesso total" acima de
  // todas as suas tabelas -- nenhuma lista adicional para manter: um
  // módulo novo só precisa marcar `grupo: 'producao'` em
  // lib/auth/matrizPermissoes.js para entrar automaticamente aqui.
  const modulosSemGrupo = MODULOS_MATRIZ.filter((modulo) => !modulo.grupo);
  const gruposUnicos = [...new Set(MODULOS_MATRIZ.filter((modulo) => modulo.grupo).map((modulo) => modulo.grupo))];

  const propsComuns = { permissoesHerdadas, overridesOriginais, estado, onAlterarLinha };

  return (
    <div>
      {modulosSemGrupo.map((modulo) => (
        <TabelaModulo key={modulo.chave} modulo={modulo} {...propsComuns} />
      ))}

      {gruposUnicos.map((grupo) => (
        <div key={grupo} className={estilos.moduloBloco}>
          <div className={estilos.grupoCabecalho}>
            <h3 className={estilos.grupoTitulo}>{GRUPO_LABEL[grupo] || grupo}</h3>
            <AcessoTotalGrupo grupo={grupo} estado={estado} onAlterarLinha={onAlterarLinha} />
          </div>

          {MODULOS_MATRIZ.filter((modulo) => modulo.grupo === grupo).map((modulo) => (
            <TabelaModulo key={modulo.chave} modulo={modulo} {...propsComuns} />
          ))}
        </div>
      ))}

      <div className={estilos.moduloBloco}>
        <h4 className={estilos.moduloTitulo}>Administração</h4>
        <div className={estilos.superficie} style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: '480px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ds-primary)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 'var(--ds-fs-th)' }}>Ação</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 'var(--ds-fs-th)' }}>Herdado do perfil</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 'var(--ds-fs-th)' }} colSpan={3}>Controle</th>
              </tr>
            </thead>
            <tbody>
              {CODIGOS_ADMINISTRATIVOS.map(({ codigo, label }) => (
                <tr key={codigo} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                  <td style={{ padding: '10px 12px' }}>{label}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {permissoesHerdadas.has(codigo) ? <Badge tom="info">Herdado</Badge> : '—'}
                  </td>
                  <td className={estilos.somenteAdmin} style={{ padding: '10px 12px' }} colSpan={3}>
                    🔒 Somente proprietário/admin
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
