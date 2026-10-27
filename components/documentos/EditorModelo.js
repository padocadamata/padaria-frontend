import { useMemo, useRef, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import EditorCampos from './EditorCampos';
import PainelVariaveis from './PainelVariaveis';
import estilos from './documentos.module.css';
import { chaveNomeModelo, LIMITES_MODELO, normalizarModelo, ROTULO_ABRANGENCIA, validarModelo } from '../../lib/documentos/modelo';
import { analisarPlaceholders } from '../../lib/documentos/placeholders';
import { AJUDA_ABRANGENCIA, agruparErrosModelo, errosParaEditor, inserirTrecho, mensagemErroDocumento, modeloDoFormulario } from '../../lib/documentos/apresentacao';

// Editor de modelo (criar/editar) -- página própria, não modal. Valida AO
// VIVO com as mesmas regras do banco (validarModelo, Etapa 1) e só envia
// quando não há erro; o banco revalida tudo (folha_documento_modelo_salvar)
// e é quem decide. Corpo em texto simples com variáveis {{chave}} inseridas
// por clique (sintaxe estrita: nada de {{ chave }}).
//
// formInicial: formulário (formularioDoModelo / MODELO_VAZIO).
// modelo: linha do banco na edição (id, versao) ou null na criação.
// outrosNomes: chaves de nome (chaveNomeModelo) dos OUTROS modelos -- só
// para avisar antes; a unicidade de verdade é o índice do banco.
export default function EditorModelo({ formInicial, modelo, outrosNomes, onSalvar, onCancelar }) {
  const [form, setForm] = useState(formInicial);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroServidor, setErroServidor] = useState('');
  const corpoRef = useRef(null);

  const definir = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const modeloAtual = useMemo(() => modeloDoFormulario(form), [form]);
  // Mesmos erros de validarModelo; só o texto vem no vocabulário do editor.
  const erros = useMemo(() => errosParaEditor(validarModelo(modeloAtual)), [modeloAtual]);
  const { porCampo, gerais } = agruparErrosModelo(erros);
  const nomeRepetido = form.nome.trim() !== '' && outrosNomes.has(chaveNomeModelo(form.nome));
  const usadas = useMemo(() => new Set(analisarPlaceholders(form.corpo).nomes), [form.corpo]);
  const podeSalvar = erros.length === 0 && !nomeRepetido;

  function inserirVariavel(chave) {
    const el = corpoRef.current;
    const trecho = `{{${chave}}}`;
    const { texto, cursor } = inserirTrecho(form.corpo, el ? el.selectionStart : undefined, el ? el.selectionEnd : undefined, trecho);
    definir('corpo', texto);
    // Devolve o foco ao texto com o cursor logo depois da variável.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function mudarAbrangencia(valor) {
    setForm((f) => ({ ...f, abrangencia: valor, assinatura_funcionario: valor === 'individual' ? f.assinatura_funcionario : false }));
  }

  async function salvar(e) {
    e.preventDefault();
    setTentouSalvar(true);
    setErroServidor('');
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      await onSalvar(normalizarModelo(modeloAtual), form.ativo);
    } catch (erro) {
      console.error('Erro ao salvar modelo:', erro);
      setErroServidor(mensagemErroDocumento(erro));
      setSalvando(false);
    }
  }

  return (
    <form className={estilos.formulario} onSubmit={salvar} noValidate>
      {modelo && (
        <Alert tom="info">
          Versão atual: v{modelo.versao}. Salvar uma alteração de conteúdo cria a versão v{modelo.versao + 1}; documentos já emitidos não mudam.
        </Alert>
      )}

      <Card titulo="Identificação">
        <div className={estilos.formulario}>
          <div className={estilos.grade2}>
            <Field label="Nome do modelo" erro={nomeRepetido ? 'Já existe um modelo com este nome (maiúsculas e acentos não diferenciam).' : undefined} dica="Como aparece na lista de modelos (ex.: Advertência).">
              <Input value={form.nome} maxLength={LIMITES_MODELO.nome} onChange={(e) => definir('nome', e.target.value)} />
            </Field>
            <Field label="Título do documento" dica="Título que sai no papel (ex.: ADVERTÊNCIA DISCIPLINAR).">
              <Input value={form.titulo_impresso} maxLength={LIMITES_MODELO.titulo} onChange={(e) => definir('titulo_impresso', e.target.value)} />
            </Field>
          </div>
          <Field label="Descrição (opcional)" dica="Para quem escolhe o modelo — não sai no documento.">
            <Input value={form.descricao} maxLength={LIMITES_MODELO.descricao} onChange={(e) => definir('descricao', e.target.value)} />
          </Field>
          <fieldset className={estilos.grupoOpcoes} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={estilos.legenda}>Aplicação</legend>
            {['individual', 'geral'].map((a) => (
              <label key={a} className={estilos.grupoOpcoes}>
                <input type="radio" name="abrangencia" value={a} checked={form.abrangencia === a} onChange={() => mudarAbrangencia(a)} />
                <span>
                  {ROTULO_ABRANGENCIA[a]}
                  <span className={estilos.secundario}> — {AJUDA_ABRANGENCIA[a]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Checkbox rotulo="Modelo ativo (aparece em “Gerar documento”)" checked={form.ativo} onChange={(e) => definir('ativo', e.target.checked)} />
        </div>
      </Card>

      <Card titulo="Texto do documento" subtitulo="Texto simples. Linha em branco separa parágrafos. Clique numa variável para inseri-la no ponto do cursor.">
        <div className={estilos.formulario}>
          <PainelVariaveis abrangencia={form.abrangencia} campos={form.campos} usadas={usadas} onInserir={inserirVariavel} />
          <Field label="Corpo" dica={`${[...form.corpo].length} / ${LIMITES_MODELO.corpo} caracteres. Variáveis: {{nome}} — sem espaços dentro das chaves.`}>
            <Textarea ref={corpoRef} className={estilos.corpoTexto} value={form.corpo} onChange={(e) => definir('corpo', e.target.value)} spellCheck />
          </Field>
        </div>
      </Card>

      <Card titulo="Informações pedidas na emissão" subtitulo="Cada campo vira uma pergunta no formulário de emissão e uma variável que pode ser inserida no texto.">
        <EditorCampos
          campos={form.campos}
          onMudar={(campos) => definir('campos', campos)}
          errosPorCampo={porCampo}
          usadas={usadas}
          onInserir={inserirVariavel}
          mostrarErros={tentouSalvar}
        />
      </Card>

      <Card titulo="Assinaturas e fechamento" subtitulo="Assinaturas manuais, no papel.">
        <div className={estilos.formulario}>
          <div className={estilos.grupoOpcoes}>
            <Checkbox rotulo="Assinatura da empresa (responsável e cargo)" checked={form.assinatura_empresa} onChange={(e) => definir('assinatura_empresa', e.target.checked)} />
            <Checkbox
              rotulo="Assinatura do funcionário (nome)"
              checked={form.abrangencia === 'individual' && form.assinatura_funcionario}
              disabled={form.abrangencia !== 'individual'}
              onChange={(e) => definir('assinatura_funcionario', e.target.checked)}
            />
            <Checkbox rotulo="Local e data no fim" checked={form.local_data} onChange={(e) => definir('local_data', e.target.checked)} />
          </div>
          <Field label="Testemunhas" dica="Linhas em branco com Nome e CPF, preenchidas à mão.">
            <Select value={String(form.testemunhas)} onChange={(e) => definir('testemunhas', Number(e.target.value))}>
              <option value="0">Nenhuma</option>
              <option value="1">1 testemunha</option>
              <option value="2">2 testemunhas</option>
            </Select>
          </Field>
        </div>
      </Card>

      {(tentouSalvar || gerais.length > 0) && erros.length > 0 && (
        <Alert tom={tentouSalvar ? 'danger' : 'warning'}>
          <strong>{tentouSalvar ? 'Corrija antes de salvar:' : 'Pendências do modelo:'}</strong>
          <ul className={estilos.listaErros}>
            {erros.map((e, i) => (
              <li key={`${e.codigo}-${i}`}>{e.mensagem}</li>
            ))}
          </ul>
        </Alert>
      )}
      {erroServidor && <Alert tom="danger">{erroServidor}</Alert>}

      <div className={estilos.rodapeAcoes}>
        <Button variante="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
        <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : modelo ? 'Salvar alterações' : 'Criar modelo'}</Button>
      </div>
    </form>
  );
}
