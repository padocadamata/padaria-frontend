import { useState } from 'react';
import Button from '../ui/Button';
import Select from '../ui/Select';
import { funcionariasDisponiveisNoFiltro, normalizarFiltroEscala } from '../../lib/funcionarios/escalaFiltro';
import estilos from './escala.module.css';
import { ordenarOpcoes } from '../../lib/ordenacao/opcoes';

// Grupo compacto "Cargo | Funcionária | PDF | Excel" -- entra no MESMO
// cabeçalho de cada visão da Escala (no lugar do antigo select de cargo),
// sem uma segunda barra de controles. O filtro é o estado compartilhado da
// página (vale para tela e arquivo); PDF/Excel exportam SEMPRE a visão
// atual (`rotuloVisao`), sem modal perguntando qual relatório.
// agrupado: mesmo conteúdo em seções "Filtros" e "Exportar" (painel
// "Filtros e ações" da Semanal no celular) -- estado e handlers iguais.
export default function EscalaFiltrosExportacao({ cargos, funcionarios, filtro, onFiltroChange, rotuloVisao, onExportar, desabilitarExportacao, agrupado = false }) {
  const [exportando, setExportando] = useState(''); // '' | 'pdf' | 'xlsx'
  const [erro, setErro] = useState('');

  async function exportar(formato) {
    setErro('');
    setExportando(formato);
    try {
      await onExportar(formato);
    } catch (e) {
      console.error(`Erro ao exportar ${rotuloVisao} (${formato}):`, e);
      setErro('Não foi possível gerar o arquivo. Tente novamente.');
    } finally {
      setExportando('');
    }
  }

  // Funcionária depende do cargo: lista só as compatíveis e, ao trocar
  // para um cargo incompatível, a seleção é limpa (normalizarFiltroEscala).
  const funcionariasDisponiveis = ordenarOpcoes(funcionariasDisponiveisNoFiltro(funcionarios, filtro.cargoId));
  function mudarFiltro(parcial) {
    onFiltroChange(normalizarFiltroEscala({ ...filtro, ...parcial }, funcionarios));
  }

  const motivoDesabilitado = desabilitarExportacao ? 'Nada para exportar com este filtro' : '';

  const selects = (
    <>
      {cargos.length > 0 && (
        <Select value={filtro.cargoId} onChange={(e) => mudarFiltro({ cargoId: e.target.value })} aria-label="Filtrar por cargo">
          <option value="">Todos os cargos</option>
          {cargos.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </Select>
      )}
      <Select value={filtro.funcionarioId} onChange={(e) => mudarFiltro({ funcionarioId: e.target.value })} aria-label="Filtrar por funcionária">
        <option value="">Todas as funcionárias</option>
        {funcionariasDisponiveis.map((f) => (
          <option key={f.id} value={f.id}>{f.nome}</option>
        ))}
      </Select>
    </>
  );

  const botoes = (
      <div className={estilos.botoesExportacao}>
        <Button
          variante="secondary"
          tamanho="sm"
          icone="download"
          onClick={() => exportar('pdf')}
          disabled={!!exportando || desabilitarExportacao}
          title={motivoDesabilitado || `Exportar ${rotuloVisao} em PDF (respeita os filtros)`}
          aria-label={`Exportar ${rotuloVisao} em PDF`}
        >
          {exportando === 'pdf' ? 'Gerando…' : 'PDF'}
        </Button>
        <Button
          variante="secondary"
          tamanho="sm"
          icone="download"
          onClick={() => exportar('xlsx')}
          disabled={!!exportando || desabilitarExportacao}
          title={motivoDesabilitado || `Exportar ${rotuloVisao} em Excel (.xlsx, respeita os filtros)`}
          aria-label={`Exportar ${rotuloVisao} em Excel`}
        >
          {exportando === 'xlsx' ? 'Gerando…' : 'Excel'}
        </Button>
      </div>
  );
  const mensagemErro = erro && <span role="alert" className={estilos.erroExportacao}>{erro}</span>;

  if (agrupado) {
    return (
      <>
        <section className={estilos.secaoPainel}>
          <h4 className={estilos.tituloOcorrencia}>Filtros</h4>
          <div className={estilos.camposPainel}>{selects}</div>
        </section>
        <section className={estilos.secaoPainel}>
          <h4 className={estilos.tituloOcorrencia}>Exportar</h4>
          {botoes}
          {mensagemErro}
        </section>
      </>
    );
  }

  return (
    <div className={estilos.filtrosExportacao}>
      {selects}
      {/* PDF + Excel sempre juntos: quebram de linha como UM bloco. */}
      {botoes}
      {mensagemErro}
    </div>
  );
}
