import { ACAO_LABEL, CODIGOS_ADMINISTRATIVOS, MODULOS_MATRIZ, GRUPO_LABEL, codigosDoGrupo, estaExpirado } from '../../lib/auth/matrizPermissoes';

// Grade de permissões da tela Admin → Usuários e Acessos. Componente
// controlado: não fala com o Supabase diretamente — só apresenta
// `permissoesHerdadas`/`overridesOriginais` (verdade atual do banco) e
// `estado` (edição local em andamento, dona de pages/admin/usuarios/[id].js),
// e avisa `onAlterarLinha` quando o admin mexe em algum controle. Quem
// monta o diff e chama a RPC é a página, não este componente.
function Badge({ cor, texto }) {
  const cores = {
    verde: { bg: '#e8f5e9', fg: '#2e7d32' },
    vermelho: { bg: '#ffebee', fg: '#c62828' },
    cinza: { bg: '#f0f0f0', fg: '#666' },
    azul: { bg: '#e3f2fd', fg: '#1565c0' },
  };
  const c = cores[cor] || cores.cinza;

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 9px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: c.fg,
        backgroundColor: c.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {texto}
    </span>
  );
}

function obterEstadoLinha(estado, codigo) {
  return estado.get(codigo) || { estado: 'herdar', expiraEm: '' };
}

function LinhaPermissao({ codigo, acaoLabel, corPrimaria, herdado, overrideOriginal, linhaEstado, onAlterar }) {
  const expirado = overrideOriginal && estaExpirado(overrideOriginal.expira_em);

  const efetivo = linhaEstado.estado === 'permitir'
    ? true
    : linhaEstado.estado === 'bloquear'
      ? false
      : herdado;

  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td style={{ padding: '10px 12px' }}>{acaoLabel}</td>

      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
        {herdado ? <Badge cor="azul" texto="Herdado" /> : <span style={{ color: '#bbb' }}>—</span>}
      </td>

      <td style={{ padding: '10px 12px' }}>
        <select
          value={linhaEstado.estado}
          onChange={(e) => onAlterar(codigo, { estado: e.target.value })}
          style={{ padding: '6px', border: '1px solid #ddd', borderRadius: '5px', minWidth: '160px' }}
        >
          <option value="herdar">Herdar do perfil</option>
          <option value="permitir">Permitir</option>
          <option value="bloquear">Bloquear</option>
        </select>
      </td>

      <td style={{ padding: '10px 12px' }}>
        {linhaEstado.estado !== 'herdar' && (
          <input
            type="datetime-local"
            value={linhaEstado.expiraEm}
            onChange={(e) => onAlterar(codigo, { expiraEm: e.target.value })}
            title="Expira em — vazio = permanente"
            style={{ padding: '6px', border: '1px solid #ddd', borderRadius: '5px' }}
          />
        )}
      </td>

      <td style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {overrideOriginal?.efeito === 'concede' && <Badge cor="verde" texto="Permitido individualmente" />}
          {overrideOriginal?.efeito === 'nega' && <Badge cor="vermelho" texto="Bloqueado individualmente" />}
          {expirado && <Badge cor="cinza" texto="Expirado" />}
        </div>
      </td>

      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
        <Badge cor={efetivo ? 'verde' : 'cinza'} texto={efetivo ? 'Sim' : 'Não'} />
      </td>
    </tr>
  );
}

function Cabecalho({ corPrimaria }) {
  const colunas = ['Ação', 'Herdado do perfil', 'Controle', 'Expira em', 'Estado individual', 'Efetivo'];
  return (
    <tr style={{ borderBottom: `2px solid ${corPrimaria}` }}>
      {colunas.map((c) => (
        <th
          key={c}
          style={{ padding: '10px 12px', textAlign: c === 'Herdado do perfil' || c === 'Efetivo' ? 'center' : 'left', color: corPrimaria, fontSize: '13px' }}
        >
          {c}
        </th>
      ))}
    </tr>
  );
}

// Checkbox "Acesso total a <grupo>" (ex.: Produção) -- reaproveita
// EXATAMENTE os mesmos códigos já listados nos módulos daquele grupo em
// MODULOS_MATRIZ (via codigosDoGrupo) -- nunca uma permissão nova no
// banco, só um atalho de UX que marca "Permitir" em todas de uma vez, ou
// devolve todas para "Herdar do perfil" (controle individual) quando
// desmarcado. Marcado só quando TODAS já estão como "Permitir" no estado
// local (evita indicar "total" quando só parte foi concedida).
function AcessoTotalGrupo({ grupo, corPrimaria, estado, onAlterarLinha }) {
  const codigos = codigosDoGrupo(grupo);
  const todasPermitir = codigos.length > 0 && codigos.every((codigo) => obterEstadoLinha(estado, codigo).estado === 'permitir');

  function alternar() {
    const novoEstado = todasPermitir ? 'herdar' : 'permitir';
    for (const codigo of codigos) {
      onAlterarLinha(codigo, { estado: novoEstado, expiraEm: '' });
    }
  }

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: corPrimaria, cursor: 'pointer', fontSize: '14px' }}>
      <input type="checkbox" checked={todasPermitir} onChange={alternar} style={{ width: '16px', height: '16px' }} />
      Acesso total à {GRUPO_LABEL[grupo] || grupo}
    </label>
  );
}

function TabelaModulo({ modulo, corPrimaria, permissoesHerdadas, overridesOriginais, estado, onAlterarLinha }) {
  return (
    <div style={{ marginBottom: '25px' }}>
      <h4 style={{ color: corPrimaria, marginBottom: '8px' }}>{modulo.label}</h4>
      <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: '5px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <Cabecalho corPrimaria={corPrimaria} />
          </thead>
          <tbody>
            {modulo.itens.map(({ codigo, acao }) => (
              <LinhaPermissao
                key={codigo}
                codigo={codigo}
                acaoLabel={ACAO_LABEL[acao] || acao}
                corPrimaria={corPrimaria}
                herdado={permissoesHerdadas.has(codigo)}
                overrideOriginal={overridesOriginais.get(codigo)}
                linhaEstado={obterEstadoLinha(estado, codigo)}
                onAlterar={onAlterarLinha}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MatrizPermissoes({ corPrimaria, permissoesHerdadas, overridesOriginais, estado, onAlterarLinha }) {
  // Módulos sem `grupo` renderizam individualmente, exatamente como antes
  // (Dashboard/Fornecedores). Módulos COM `grupo` (hoje só 'producao')
  // ganham um cabeçalho de seção com o checkbox "Acesso total" acima de
  // todas as suas tabelas -- nenhuma lista adicional para manter: um
  // módulo novo só precisa marcar `grupo: 'producao'` em
  // lib/auth/matrizPermissoes.js para entrar automaticamente aqui.
  const modulosSemGrupo = MODULOS_MATRIZ.filter((modulo) => !modulo.grupo);
  const gruposUnicos = [...new Set(MODULOS_MATRIZ.filter((modulo) => modulo.grupo).map((modulo) => modulo.grupo))];

  const propsComuns = { corPrimaria, permissoesHerdadas, overridesOriginais, estado, onAlterarLinha };

  return (
    <div>
      {modulosSemGrupo.map((modulo) => (
        <TabelaModulo key={modulo.chave} modulo={modulo} {...propsComuns} />
      ))}

      {gruposUnicos.map((grupo) => (
        <div key={grupo} style={{ marginBottom: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '15px',
              paddingBottom: '10px',
              borderBottom: `2px solid ${corPrimaria}`,
            }}
          >
            <h3 style={{ color: corPrimaria, margin: 0 }}>{GRUPO_LABEL[grupo] || grupo}</h3>
            <AcessoTotalGrupo grupo={grupo} corPrimaria={corPrimaria} estado={estado} onAlterarLinha={onAlterarLinha} />
          </div>

          {MODULOS_MATRIZ.filter((modulo) => modulo.grupo === grupo).map((modulo) => (
            <TabelaModulo key={modulo.chave} modulo={modulo} {...propsComuns} />
          ))}
        </div>
      ))}

      <div style={{ marginBottom: '10px' }}>
        <h4 style={{ color: corPrimaria, marginBottom: '8px' }}>Administração</h4>
        <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: '5px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${corPrimaria}` }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: corPrimaria, fontSize: '13px' }}>Ação</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', color: corPrimaria, fontSize: '13px' }}>Herdado do perfil</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: corPrimaria, fontSize: '13px' }} colSpan={3}>Controle</th>
              </tr>
            </thead>
            <tbody>
              {CODIGOS_ADMINISTRATIVOS.map(({ codigo, label }) => (
                <tr key={codigo} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px 12px' }}>{label}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {permissoesHerdadas.has(codigo) ? <Badge cor="azul" texto="Herdado" /> : <span style={{ color: '#bbb' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#999', fontStyle: 'italic', fontSize: '13px' }} colSpan={3}>
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
