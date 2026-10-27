import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { cx } from '../../lib/design/cx';
import { LIMITES_CAMPOS, ROTULO_TIPO_CAMPO, TIPOS_CAMPO } from '../../lib/documentos/campos';
import { ROTULO_PAPEL_EDITOR, atualizarCampoFormulario, novoCampoFormulario, papeisDoTipo } from '../../lib/documentos/apresentacao';
import estilos from './documentos.module.css';

// Campos configuráveis do modelo (texto, texto longo, data, seleção,
// número). Nada é fixo de advertência: o modelo define o que a emissão
// pergunta. A chave técnica ({{chave}} no texto) é gerada do rótulo e NÃO
// é editável na tela: acompanha o rótulo só num campo novo cuja variável
// ainda não está no texto; num campo já salvo (chaveManual) ou já usado no
// texto ela nunca muda sozinha. Papel funcional (assunto / data da
// ocorrência) só nos tipos aceitos pelo banco.
export default function EditorCampos({ campos, onMudar, errosPorCampo, usadas, onInserir, mostrarErros }) {
  function atualizar(indice, mudanca) {
    onMudar(atualizarCampoFormulario(campos, indice, mudanca, usadas));
  }

  function mover(indice, delta) {
    const destino = indice + delta;
    if (destino < 0 || destino >= campos.length) return;
    const lista = [...campos];
    [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
    onMudar(lista);
  }

  // Papel já usado por OUTRO campo não aparece como opção (um de cada).
  const papeisUsados = (indice) => new Set(campos.filter((c, j) => j !== indice && c.papel).map((c) => c.papel));

  return (
    <div className={estilos.formulario}>
      {campos.length === 0 && <p className={estilos.secundario}>Nenhum campo. Um modelo pode não ter campos (ex.: comunicado de texto fixo).</p>}
      <ol className={estilos.listaCampos}>
        {campos.map((c, i) => {
          const erros = errosPorCampo.get(i) || [];
          const foraDoTexto = c.chave && !usadas.has(c.chave);
          const opcoesPapel = papeisDoTipo(c.tipo).filter((p) => p === c.papel || !papeisUsados(i).has(p));
          return (
            <li key={c.idLocal} className={cx(estilos.cartaoCampo, mostrarErros && erros.length > 0 && estilos.cartaoCampoErro)}>
              <div className={estilos.cabecalhoCampo}>
                <strong>Campo {i + 1}{c.rotulo ? ` — ${c.rotulo}` : ''}</strong>
                <div className={estilos.acoesDocumento}>
                  <Button tamanho="sm" variante="ghost" icone="arrowUp" aria-label="Subir campo" disabled={i === 0} onClick={() => mover(i, -1)} />
                  <Button tamanho="sm" variante="ghost" icone="arrowDown" aria-label="Descer campo" disabled={i === campos.length - 1} onClick={() => mover(i, 1)} />
                  <Button tamanho="sm" variante="dangerOutline" icone="trash" onClick={() => onMudar(campos.filter((_, j) => j !== i))}>Remover</Button>
                </div>
              </div>
              <div className={estilos.grade2}>
                <Field label="Pergunta na emissão">
                  <Input value={c.rotulo} maxLength={LIMITES_CAMPOS.rotulo} onChange={(e) => atualizar(i, { rotulo: e.target.value })} />
                </Field>
                <Field label="Tipo de resposta">
                  <Select value={c.tipo} onChange={(e) => atualizar(i, { tipo: e.target.value })}>
                    {TIPOS_CAMPO.map((t) => (
                      <option key={t} value={t}>{ROTULO_TIPO_CAMPO[t]}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {c.tipo === 'selecao' && (
                <Field label="Opções (uma por linha)" dica={`De 1 a ${LIMITES_CAMPOS.opcoes} opções, sem repetir.`}>
                  <Textarea rows={4} value={c.opcoesTexto} onChange={(e) => atualizar(i, { opcoesTexto: e.target.value })} />
                </Field>
              )}
              <div className={estilos.grade2}>
                <Field label="Dica (opcional)" dica="Aparece abaixo da pergunta na emissão.">
                  <Input value={c.dica} maxLength={LIMITES_CAMPOS.dica} onChange={(e) => atualizar(i, { dica: e.target.value })} />
                </Field>
                <Field
                  label="Usar também como (opcional)"
                  dica={papeisDoTipo(c.tipo).length === 0 ? 'Disponível para texto curto, seleção ou data.' : 'Aparece no histórico de documentos. A data da ocorrência não pode ser futura.'}
                >
                  <Select value={c.papel} disabled={papeisDoTipo(c.tipo).length === 0} onChange={(e) => atualizar(i, { papel: e.target.value })}>
                    <option value="">Nenhuma função especial</option>
                    {opcoesPapel.map((p) => (
                      <option key={p} value={p}>{ROTULO_PAPEL_EDITOR[p]}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className={estilos.cabecalhoCampo}>
                <Checkbox rotulo="Preenchimento obrigatório" checked={c.obrigatorio} onChange={(e) => atualizar(i, { obrigatorio: e.target.checked })} />
                {c.chave && <code className={estilos.variavelTecnica} title="Variável usada no texto do documento">Variável: {`{{${c.chave}}}`}</code>}
                {foraDoTexto && (
                  <span className={estilos.secundario}>
                    {c.papel ? 'Fora do texto (permitido: alimenta o histórico). ' : 'Ainda não aparece no texto. '}
                    <Button tamanho="sm" variante="secondary" onClick={() => onInserir(c.chave)}>Inserir no texto</Button>
                  </span>
                )}
              </div>
              {mostrarErros && erros.length > 0 && (
                <ul className={estilos.listaErros} role="alert">
                  {erros.map((e, k) => (
                    <li key={`${e.codigo}-${k}`}>{e.mensagem}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <div>
        <Button variante="secondary" icone="plus" disabled={campos.length >= LIMITES_CAMPOS.campos} onClick={() => onMudar([...campos, novoCampoFormulario()])}>
          Adicionar campo
        </Button>
      </div>
    </div>
  );
}
