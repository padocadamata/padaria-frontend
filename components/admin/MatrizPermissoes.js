import { useEffect, useRef } from 'react';
import { ACAO_LABEL, CODIGOS_ADMINISTRATIVOS, MODULOS_MATRIZ, GRUPO_LABEL, codigosDoGrupo, estaExpirado } from '../../lib/auth/matrizPermissoes';
import Badge from '../ui/Badge';
import DataTable from '../ui/DataTable';
import Select from '../ui/Select';
import checkboxEstilos from '../ui/Checkbox.module.css';
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

// Mesma fórmula que a coluna "Efetivo" de TabelaModulo sempre usou --
// extraída aqui só para ser reaproveitada também pelo cálculo de
// checked/indeterminate do "Acesso total" (AcessoTotalGrupo) abaixo.
// Comportamento idêntico a antes, sem nenhuma mudança de cálculo.
function calcularEfetivo(herdado, linhaEstado) {
  if (linhaEstado.estado === 'permitir') return true;
  if (linhaEstado.estado === 'bloquear') return false;
  return herdado;
}

// Checkbox "Acesso total a <grupo>" (ex.: Produção) -- reaproveita
// EXATAMENTE os mesmos códigos já listados nos módulos daquele grupo em
// MODULOS_MATRIZ (via codigosDoGrupo) -- nunca uma permissão nova no
// banco, só um atalho de UX que mexe nos controles individuais
// (estadoEditado) daquela área de uma vez.
//
// Semântica (correção de dívida identificada ao generalizar este controle
// de Produção para as demais áreas -- auditoria "Gerenciar Acessos"):
//
// MARCAR: o objetivo é deixar TODAS as permissões da área EFETIVAS, com o
// MENOR número de overrides possível --
//   - permissão já herdada do perfil -> fica/volta "Herdar do perfil"
//     (nunca cria nem mantém um override "Permitir" redundante; se havia
//     um override "Bloquear" sobre ela, também é removido aqui);
//   - permissão não herdada -> "Permitir". Se já estava "Permitir" (com ou
//     sem expiração), NADA é tocado -- preserva a expiração existente tal
//     como está, nunca apaga uma data válida sem necessidade.
//
// DESMARCAR: semântica é "voltar esta área ao perfil base" -- TODAS as
// permissões da área voltam para "Herdar do perfil", removendo qualquer
// override individual da área (inclusive um com expiração futura -- ação
// intencional do bulk, documentada no title/aria do controle).
//
// checked/indeterminate/unchecked são calculados sobre o EFETIVO atual
// (herdado + estadoEditado na tela, via calcularEfetivo), não sobre os
// overrides originais -- por isso um perfil que já herda 100% de uma área
// aparece "checked" mesmo sem nenhum override, e marcar não cria overrides
// nesse caso (a condição de cada código já é "herdado -> não mexe").
//
// `indeterminate` é propriedade DOM (não existe como atributo JSX) --
// setada via ref, igual a qualquer checkbox HTML nativo com esse estado.
function AcessoTotalGrupo({ grupo, permissoesHerdadas, estado, onAlterarLinha }) {
  const codigos = codigosDoGrupo(grupo);
  const efetivas = codigos.map((codigo) => calcularEfetivo(permissoesHerdadas.has(codigo), obterEstadoLinha(estado, codigo)));
  const todasEfetivas = codigos.length > 0 && efetivas.every(Boolean);
  const algumaEfetiva = efetivas.some(Boolean);
  const indeterminado = !todasEfetivas && algumaEfetiva;

  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminado;
  }, [indeterminado]);

  function marcar() {
    for (const codigo of codigos) {
      const herdado = permissoesHerdadas.has(codigo);
      const linhaAtual = obterEstadoLinha(estado, codigo);

      if (herdado) {
        if (linhaAtual.estado !== 'herdar') {
          onAlterarLinha(codigo, { estado: 'herdar', expiraEm: '' });
        }
      } else if (linhaAtual.estado !== 'permitir') {
        onAlterarLinha(codigo, { estado: 'permitir', expiraEm: '' });
      }
      // já "permitir" numa permissão não herdada: não mexe -- preserva a
      // expiração (se houver) exatamente como está.
    }
  }

  function desmarcar() {
    for (const codigo of codigos) {
      onAlterarLinha(codigo, { estado: 'herdar', expiraEm: '' });
    }
  }

  function alternar() {
    if (todasEfetivas) {
      desmarcar();
    } else {
      marcar();
    }
  }

  return (
    <label className={checkboxEstilos.linha}>
      <input
        ref={inputRef}
        type="checkbox"
        className={checkboxEstilos.caixa}
        checked={todasEfetivas}
        onChange={alternar}
        title="Ao desmarcar, os acessos individuais desta área voltam às permissões do perfil base."
      />
      <span>{`Acesso total à ${GRUPO_LABEL[grupo] || grupo}`}</span>
    </label>
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
        const efetivo = calcularEfetivo(l.herdado, l.linhaEstado);
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
            <AcessoTotalGrupo grupo={grupo} permissoesHerdadas={permissoesHerdadas} estado={estado} onAlterarLinha={onAlterarLinha} />
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
