import { useCallback, useEffect, useMemo, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import CardTurno from '../components/producao/CardTurno';
import TabelaHoje from '../components/producao/TabelaHoje';
import BannerPendencias from '../components/producao/BannerPendencias';
import SeletorOutroProduto from '../components/producao/SeletorOutroProduto';
import PaginaProducao from '../components/producao/PaginaProducao';
import Alert from '../components/ui/Alert';
import SectionHeader from '../components/ui/SectionHeader';
import EmptyState from '../components/ui/EmptyState';
import Field from '../components/ui/Field';
import FilterBar from '../components/ui/FilterBar';
import Select from '../components/ui/Select';
import styles from '../components/producao/producaoHoje.module.css';
import { PERMISSOES } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';
import { dataLocalHoje, dataLocalExibicao } from '../lib/data/dataLocal';
import { APARENCIA_FIXA } from '../lib/branding/tema';
import { useMediaQuery } from '../lib/design/useMediaQuery';
import { ordenarOpcoes } from '../lib/ordenacao/opcoes';
import {
  montarLinhasHoje,
  filtrarLinhasHoje,
  tiposDasLinhas,
  contarFiltrosHojeAtivos,
  SITUACOES_TURNO,
  FILTROS_HOJE_PADRAO,
} from '../lib/producao/linhasHoje';

// Desktop (>= 1280px): tabela (DataTable), uma linha operacional por
// Produto × Turno. Abaixo disso (tablet e celular) continuam os cartões de
// sempre. As duas apresentações usam as MESMAS ações/modais
// (turnoProducao.js) e os mesmos filtros (lib/producao/linhasHoje).
const CARTOES_ATE = 1279;

const TURNOS = [
  { chave: 'manha', label: 'Manhã' },
  { chave: 'tarde', label: 'Tarde' },
];

const PRODUTO_PRINCIPAL = 'Francês';

function capitalizarPrimeiraLetra(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function ProducaoConteudo() {
  const { permissoes, perfilUsuario } = useAuth();

  const aparencia = APARENCIA_FIXA;

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
  const modoCartoes = useMediaQuery(`(max-width: ${CARTOES_ATE}px)`);

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
      // Unificação Catálogo x Produção: nome vem de produtos (identidade
      // mestre), nunca mais de receitas.nome. Defesa em profundidade:
      // produtos.ativo=true E receitas.ativo=true juntos -- um produto
      // mestre inativado nunca aparece na Tela Hoje, mesmo que a extensão
      // em si ainda esteja com ativo=true. `produtos!inner` (mesmo
      // relacionamento forward já usado em pages/producao/expositores.js)
      // também exclui qualquer receita sem catalogo_produto_id.
      supabase
        .from('receitas')
        // tipo (receitas.tipo, migration 0036) alimenta o filtro "Tipo de
        // produto" -- mesma consulta de antes, só uma coluna a mais.
        .select('id, tipo, produtos!inner(nome)')
        .eq('ativo', true)
        .eq('controlado_producao', true)
        .eq('produtos.ativo', true),
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
    // Achata para {id, nome} -- mesma forma usada por todo o restante do
    // arquivo (receitaNomePorId, frances, SeletorOutroProduto) antes da
    // unificação, preservado para não precisar alterar essa lógica.
    const receitasAchatadas = ordenarOpcoes((receitasResp.data || []).map((r) => ({ id: r.id, nome: r.produtos?.nome || '', tipo: r.tipo || null })));
    setReceitasAtivas(receitasAchatadas);
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

  // Uma linha operacional por Produto × Turno, na ordem da tela (Francês
  // primeiro). Filtros: estado local desta tela (Todos/Todos/Todos ao abrir).
  const [filtros, setFiltros] = useState(FILTROS_HOJE_PADRAO);
  const tipoPorReceita = {};
  for (const r of receitasAtivas) tipoPorReceita[r.id] = r.tipo;
  const linhas = montarLinhasHoje({ blocos: blocosProduto, turnos: TURNOS, registroDoBloco, tipoPorReceita });
  const linhasFiltradas = filtrarLinhasHoje(linhas, filtros);
  const tiposDisponiveis = tiposDasLinhas(linhas);
  const visiveis = new Set(linhasFiltradas.map((l) => l.chave));
  const alterarFiltro = (campo) => (e) => setFiltros((atual) => ({ ...atual, [campo]: e.target.value }));

  return (
    <PaginaProducao ativo="hoje" titulo="Hoje" subtitulo={capitalizarPrimeiraLetra(dataLocalExibicao())}>
      {erro && <Alert tom="danger">{erro}</Alert>}

      {carregando ? (
        <p role="status">Carregando produção...</p>
      ) : (
        <>
          <BannerPendencias
            pendencias={pendencias}
            receitaNomePorId={receitaNomePorId}
            corPrimaria={aparencia.corPrimaria}
            permissoes={permissoes}
            onAtualizado={carregarDados}
          />

          <FilterBar ativos={contarFiltrosHojeAtivos(filtros)} onLimpar={() => setFiltros(FILTROS_HOJE_PADRAO)}>
            <Field label="Tipo de produto">
              <Select value={filtros.tipo} onChange={alterarFiltro('tipo')}>
                <option value="">Todos</option>
                {tiposDisponiveis.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Situação">
              <Select value={filtros.situacao} onChange={alterarFiltro('situacao')}>
                <option value="">Todas</option>
                {SITUACOES_TURNO.map((s) => (
                  <option key={s.valor} value={s.valor}>
                    {s.rotulo}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Turno">
              <Select value={filtros.turno} onChange={alterarFiltro('turno')}>
                <option value="">Todos</option>
                {TURNOS.map((t) => (
                  <option key={t.chave} value={t.chave}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FilterBar>

          {linhas.length > 0 && linhasFiltradas.length === 0 ? (
            <EmptyState>Nenhum produto/turno com estes filtros.</EmptyState>
          ) : !modoCartoes ? (
            <TabelaHoje
              linhas={linhasFiltradas}
              data={hoje}
              corPrimaria={aparencia.corPrimaria}
              permissoes={permissoes}
              perfilUsuario={perfilUsuario}
              onAtualizado={carregarDados}
            />
          ) : blocosProduto.filter((bloco) => TURNOS.some((t) => visiveis.has(`${bloco.receitaId}:${t.chave}`))).map((bloco) => (
            <section key={bloco.receitaId} className={styles.bloco} aria-label={bloco.receitaNome}>
              <SectionHeader titulo={bloco.receitaNome} />
              <div className={styles.turnos}>
                {TURNOS.filter((t) => visiveis.has(`${bloco.receitaId}:${t.chave}`)).map((t) => (
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
            </section>
          ))}

          <SeletorOutroProduto
            receitasDisponiveis={receitasDisponiveisParaAdicionar}
            corPrimaria={aparencia.corPrimaria}
            onSelecionar={(receita) => setProdutosExtras((atual) => [...atual, receita.id])}
          />
        </>
      )}
    </PaginaProducao>
  );
}

export default function Producao() {
  return (
    <RequireAuth permissao={PERMISSOES.PRODUCAO_VISUALIZAR}>
      <ProducaoConteudo />
    </RequireAuth>
  );
}
