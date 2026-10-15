import { useEffect, useRef, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Textarea from '../ui/Textarea';
import EditorTemplateMensagemModal from './EditorTemplateMensagemModal';
import { TEMPLATE_PADRAO, gerarMensagemPedido } from '../../lib/pedidos/mensagemPedido';
import { carregarTemplateMensagem } from '../../lib/pedidos/templateMensagemDados';
import styles from './MensagemPedido.module.css';

// Copia texto para a área de transferência: API moderna quando disponível;
// senão, a seleção do próprio campo + execCommand (navegadores antigos ou
// página fora de contexto seguro). Retorna true/false.
async function copiarTexto(texto, campo) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // cai no método antigo abaixo
  }
  try {
    if (!campo) return false;
    campo.focus();
    campo.select();
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

// "Gerar mensagem" de um pedido (migration 0075): monta o texto a partir do
// MODELO GLOBAL com os dados reais do pedido, num preview editável. Editar o
// preview NÃO salva nada -- vale só para o que for copiado agora. Quem é
// proprietario_admin vê também "Editar modelo global", que é outra coisa
// (muda o modelo de todos os pedidos) e abre um editor separado.
export default function GerarMensagemPedidoModal({ pedido, itens, fornecedorNome, podeEditarModelo = false, onFechar }) {
  const [carregando, setCarregando] = useState(true);
  const [modelo, setModelo] = useState({ template: null, disponivel: false });
  const [texto, setTexto] = useState('');
  const [desconhecidos, setDesconhecidos] = useState([]);
  const [copia, setCopia] = useState(''); // '' | 'ok' | 'erro'
  const [editorAberto, setEditorAberto] = useState(false);
  const campoRef = useRef(null);

  function gerar(template) {
    const r = gerarMensagemPedido(template, { pedido, itens, fornecedorNome });
    setTexto(r.texto);
    setDesconhecidos(r.desconhecidos);
    setCopia('');
  }

  useEffect(() => {
    let ativo = true;
    carregarTemplateMensagem().then((r) => {
      if (!ativo) return;
      setModelo(r);
      gerar(r.disponivel ? r.template : TEMPLATE_PADRAO);
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (copia !== 'ok') return undefined;
    const t = setTimeout(() => setCopia(''), 3000);
    return () => clearTimeout(t);
  }, [copia]);

  async function copiar() {
    setCopia((await copiarTexto(texto, campoRef.current)) ? 'ok' : 'erro');
  }

  return (
    <Modal titulo={`Mensagem do pedido — ${fornecedorNome}`} onFechar={onFechar} largura="md" fecharComEsc={!editorAberto}>
      {carregando ? (
        <p role="status">Montando a mensagem...</p>
      ) : (
        <div className={styles.corpo}>
          {!modelo.disponivel && (
            <Alert tom="warning">O modelo global de mensagem ainda não está disponível. A mensagem abaixo usa o modelo padrão do sistema.</Alert>
          )}
          {desconhecidos.length > 0 && (
            <Alert tom="warning">
              O modelo tem campo(s) que o sistema não reconhece e que ficaram como estão no texto: {desconhecidos.map((d) => `{{${d}}}`).join(', ')}.
            </Alert>
          )}

          <label className={styles.rotulo} htmlFor="mensagem-pedido-preview">
            Mensagem
          </label>
          <Textarea
            id="mensagem-pedido-preview"
            ref={campoRef}
            className={styles.preview}
            rows={12}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setCopia('');
            }}
          />
          <p className={styles.nota}>Pode ajustar o texto antes de copiar. Essas alterações valem só para esta mensagem e não são salvas.</p>

          {copia === 'erro' && <Alert tom="danger">Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.</Alert>}

          <div className={styles.rodape}>
            <div className={styles.rodapeSecundario}>
              <Button variante="ghost" tamanho="sm" onClick={() => gerar(modelo.disponivel ? modelo.template : TEMPLATE_PADRAO)}>
                Refazer a partir do modelo
              </Button>
              {podeEditarModelo && modelo.disponivel && (
                <Button variante="ghost" tamanho="sm" icone="pencil" onClick={() => setEditorAberto(true)}>
                  Editar modelo global
                </Button>
              )}
            </div>
            <div className={styles.rodapePrincipal}>
              {copia === 'ok' && (
                <span className={styles.copiado} role="status">
                  Copiado!
                </span>
              )}
              <Button variante="secondary" onClick={onFechar}>
                Fechar
              </Button>
              <Button icone="clipboard" onClick={copiar} disabled={!texto.trim()}>
                Copiar
              </Button>
            </div>
          </div>
        </div>
      )}

      {editorAberto && (
        <EditorTemplateMensagemModal
          onFechar={() => setEditorAberto(false)}
          onSalvo={(registro) => {
            setEditorAberto(false);
            setModelo({ ...modelo, template: registro.template, disponivel: true });
            gerar(registro.template);
          }}
        />
      )}
    </Modal>
  );
}
