import SectionHeader from '../ui/SectionHeader';
import estilos from './catalogo.module.css';

function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Preço-base sempre com a unidade-base do PRODUTO ao lado (nunca a
// unidade comercial da compra) -- é o que torna os três blocos
// comparáveis entre si. Sem unidadeBase (produtos.unidade_medida é
// nullable), mostra só o valor: não inventa unidade nenhuma.
function formatarPrecoBase(valor, unidadeBase) {
  const preco = formatarMoeda(valor);
  return unidadeBase ? `${preco} / ${unidadeBase}` : preco;
}

// Card "Resumo de preços" de /catalogo/[id], consumindo uma linha de
// public.produtos_resumo_compras (view da migration 0023) + a unidade-base
// do próprio produto (produto.unidade_medida, já carregado pela página --
// nenhuma query nova aqui). Três blocos deliberadamente separados --
// nomenclatura exata pedida: "Última compra" / "Último preço-base
// comparável" / "Menor preço-base registrado". Nunca usar "dado
// confiável"/"melhor compra"/"melhor preço já visto" -- nenhum desses
// conceitos existe na view (ela não julga qualidade do dado, só
// cronologia e valor).
export default function ResumoPrecos({ resumo, fornecedoresPorId, unidadeBase }) {
  if (!resumo) {
    return (
      <div>
        <SectionHeader titulo="Resumo de preços" />
        <p>Nenhuma compra registrada ainda para este produto.</p>
      </div>
    );
  }

  const nomeFornecedor = (id) => fornecedoresPorId[id] || '—';

  const ultimoPrecoBaseAnteriorAUltimaCompra =
    resumo.ultimo_preco_base_data != null &&
    resumo.ultimo_preco_base_data !== resumo.ultima_compra_data &&
    resumo.ultimo_preco_base_data < resumo.ultima_compra_data;

  return (
    <div>
      <SectionHeader titulo="Resumo de preços" />

      <div className={estilos.blocosPreco}>
        <div className={estilos.blocoPreco}>
          <div className={estilos.blocoPrecoRotulo}>Última compra</div>
          <div>{formatarData(resumo.ultima_compra_data)} — {nomeFornecedor(resumo.ultima_compra_fornecedor_id)}</div>
          <div className={estilos.blocoPrecoDetalhe}>
            {formatarMoeda(resumo.ultima_compra_preco_comercial)} / {resumo.ultima_compra_unidade_comercial}
          </div>
          <div className={estilos.blocoPrecoDetalhe}>
            {resumo.ultima_compra_preco_base != null ? (
              <>
                <span>Preço-base: </span>
                <span className={estilos.blocoPrecoValor}>{formatarPrecoBase(resumo.ultima_compra_preco_base, unidadeBase)}</span>
              </>
            ) : (
              <span className={estilos.blocoPrecoVazio}>Preço-base não disponível — conversão não informada.</span>
            )}
          </div>
        </div>

        <div className={estilos.blocoPreco}>
          <div className={estilos.blocoPrecoRotulo}>Último preço-base comparável</div>
          {resumo.ultimo_preco_base_valor != null ? (
            <>
              <div className={estilos.blocoPrecoValor}>{formatarPrecoBase(resumo.ultimo_preco_base_valor, unidadeBase)}</div>
              <div className={estilos.blocoPrecoDetalhe}>
                {formatarData(resumo.ultimo_preco_base_data)} — {nomeFornecedor(resumo.ultimo_preco_base_fornecedor_id)}
              </div>
              {ultimoPrecoBaseAnteriorAUltimaCompra && (
                <div className={estilos.blocoPrecoDetalhe}>Anterior à última compra registrada.</div>
              )}
            </>
          ) : (
            <div className={estilos.blocoPrecoVazio}>Nenhum registro comparável ainda.</div>
          )}
        </div>

        <div className={estilos.blocoPreco}>
          <div className={estilos.blocoPrecoRotulo}>Menor preço-base registrado</div>
          {resumo.menor_preco_base_valor != null ? (
            <>
              <div className={estilos.blocoPrecoValor}>{formatarPrecoBase(resumo.menor_preco_base_valor, unidadeBase)}</div>
              <div className={estilos.blocoPrecoDetalhe}>
                {formatarData(resumo.menor_preco_base_data)} — {nomeFornecedor(resumo.menor_preco_base_fornecedor_id)}
              </div>
            </>
          ) : (
            <div className={estilos.blocoPrecoVazio}>Nenhum registro comparável ainda.</div>
          )}
        </div>
      </div>
    </div>
  );
}
