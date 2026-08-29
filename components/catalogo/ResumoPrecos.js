function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const blocoEstilo = {
  backgroundColor: '#f9f9f9',
  borderRadius: '5px',
  padding: '12px 15px',
  flex: '1 1 220px',
};

const rotuloBlocoEstilo = { fontWeight: 'bold', fontSize: '13px', color: '#555', marginBottom: '6px' };

// Card "Resumo de preços" de /catalogo/[id], consumindo uma linha de
// public.produtos_resumo_compras (view da migration 0023). Três blocos
// deliberadamente separados -- nomenclatura exata pedida:
// "Última compra" / "Último preço-base comparável" / "Menor preço-base
// registrado". Nunca usar "dado confiável"/"melhor compra"/"melhor preço
// já visto" -- nenhum desses conceitos existe na view (ela não julga
// qualidade do dado, só cronologia e valor).
export default function ResumoPrecos({ resumo, fornecedoresPorId }) {
  if (!resumo) {
    return (
      <div>
        <h3 style={{ margin: '0 0 10px 0' }}>Resumo de preços</h3>
        <p style={{ color: '#666' }}>Nenhuma compra registrada ainda para este produto.</p>
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
      <h3 style={{ margin: '0 0 10px 0' }}>Resumo de preços</h3>

      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
        <div style={blocoEstilo}>
          <div style={rotuloBlocoEstilo}>Última compra</div>
          <div>{formatarData(resumo.ultima_compra_data)} — {nomeFornecedor(resumo.ultima_compra_fornecedor_id)}</div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            {formatarMoeda(resumo.ultima_compra_preco_comercial)} / {resumo.ultima_compra_unidade_comercial}
          </div>
          <div style={{ marginTop: '6px', fontWeight: 'bold' }}>
            {resumo.ultima_compra_preco_base != null ? (
              formatarMoeda(resumo.ultima_compra_preco_base)
            ) : (
              <span style={{ fontWeight: 'normal', color: '#999', fontStyle: 'italic' }}>
                Preço-base não disponível — conversão não informada.
              </span>
            )}
          </div>
        </div>

        <div style={blocoEstilo}>
          <div style={rotuloBlocoEstilo}>Último preço-base comparável</div>
          {resumo.ultimo_preco_base_valor != null ? (
            <>
              <div style={{ fontWeight: 'bold' }}>{formatarMoeda(resumo.ultimo_preco_base_valor)}</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                {formatarData(resumo.ultimo_preco_base_data)} — {nomeFornecedor(resumo.ultimo_preco_base_fornecedor_id)}
              </div>
              {ultimoPrecoBaseAnteriorAUltimaCompra && (
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                  Anterior à última compra registrada.
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#999', fontStyle: 'italic' }}>Nenhum registro comparável ainda.</div>
          )}
        </div>

        <div style={blocoEstilo}>
          <div style={rotuloBlocoEstilo}>Menor preço-base registrado</div>
          {resumo.menor_preco_base_valor != null ? (
            <>
              <div style={{ fontWeight: 'bold' }}>{formatarMoeda(resumo.menor_preco_base_valor)}</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                {formatarData(resumo.menor_preco_base_data)} — {nomeFornecedor(resumo.menor_preco_base_fornecedor_id)}
              </div>
            </>
          ) : (
            <div style={{ color: '#999', fontStyle: 'italic' }}>Nenhum registro comparável ainda.</div>
          )}
        </div>
      </div>
    </div>
  );
}
