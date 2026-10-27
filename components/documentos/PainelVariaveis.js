import { variaveisDoEscopo } from '../../lib/documentos/placeholders';
import { ROTULO_TIPO_CAMPO } from '../../lib/documentos/campos';
import { cx } from '../../lib/design/cx';
import { rotuloVariavel } from '../../lib/documentos/apresentacao';
import estilos from './documentos.module.css';

// Variáveis disponíveis para o corpo, em dois grupos: AUTOMÁTICAS (catálogo
// fixo do núcleo, filtrado pela abrangência -- geral não vê funcionário) e
// CAMPOS DO MODELO (as chaves configuradas abaixo). O chip mostra o nome
// humano; a chave técnica fica discreta embaixo. Clique insere {{chave}}
// no ponto do cursor -- o usuário nunca precisa decorar chaves. ✓ = a
// variável já aparece no texto.
const CHAVE_VALIDA = /^[a-z][a-z0-9_]{0,39}$/;

export default function PainelVariaveis({ abrangencia, campos, usadas, onInserir }) {
  const automaticas = variaveisDoEscopo(abrangencia);
  const doModelo = campos.filter((c) => CHAVE_VALIDA.test(c.chave));
  return (
    <div className={estilos.paineisVariaveis}>
      <section className={estilos.painel} aria-label="Variáveis automáticas">
        <h3 className={estilos.painelTitulo}>Automáticas (o sistema preenche)</h3>
        <ul className={estilos.listaVariaveis}>
          {automaticas.map((v) => (
            <li key={v.chave}>
              <Chip rotulo={rotuloVariavel(v)} chave={v.chave} ajuda={v.descricao} usada={usadas.has(v.chave)} onInserir={onInserir} />
            </li>
          ))}
        </ul>
        {abrangencia === 'geral' && <p className={estilos.secundario}>Documento geral: sem variáveis de funcionário.</p>}
      </section>
      <section className={estilos.painel} aria-label="Campos do modelo">
        <h3 className={estilos.painelTitulo}>Campos deste modelo (preenchidos na emissão)</h3>
        {doModelo.length === 0 ? (
          <p className={estilos.secundario}>Nenhum campo ainda. Adicione em “Informações pedidas na emissão”.</p>
        ) : (
          <ul className={estilos.listaVariaveis}>
            {doModelo.map((c) => (
              <li key={c.idLocal}>
                <Chip
                  rotulo={c.rotulo.trim() || c.chave}
                  chave={c.chave}
                  ajuda={`${c.rotulo.trim() || c.chave} (${ROTULO_TIPO_CAMPO[c.tipo] || c.tipo})`}
                  usada={usadas.has(c.chave)}
                  onInserir={onInserir}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Chip({ rotulo, chave, ajuda, usada, onInserir }) {
  const variavel = `{{${chave}}}`;
  return (
    <button
      type="button"
      className={cx(estilos.variavel, usada && estilos.variavelUsada)}
      title={`${ajuda} — insere ${variavel}`}
      aria-label={`Inserir ${rotulo}${usada ? ' (já está no texto)' : ''}`}
      onClick={() => onInserir(chave)}
    >
      <span className={estilos.variavelRotulo}>
        {rotulo}
        {usada && <span className={estilos.variavelMarca} aria-hidden="true"> ✓</span>}
      </span>
      <code className={estilos.variavelChave}>{variavel}</code>
    </button>
  );
}
