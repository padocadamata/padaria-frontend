import { useEffect, useRef, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Textarea from '../ui/Textarea';
import { PLACEHOLDERS, TAMANHO_MAXIMO_TEMPLATE, TEMPLATE_PADRAO, validarTemplate } from '../../lib/pedidos/mensagemPedido';
import { carregarTemplateMensagem, salvarTemplateMensagem } from '../../lib/pedidos/templateMensagemDados';
import styles from './MensagemPedido.module.css';

function formatarDataHora(timestamptz) {
  if (!timestamptz) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamptz));
}

// Editor do MODELO GLOBAL de mensagem de pedido (migration 0075) -- só
// proprietario_admin chega aqui (e só ele consegue salvar: RLS com
// is_admin()). Vale para todos os pedidos e todos os usuários; nada é
// gravado até "Salvar". "Restaurar padrão" só preenche o campo com o modelo
// padrão do sistema.
export default function EditorTemplateMensagemModal({ onFechar, onSalvo }) {
  const [carregando, setCarregando] = useState(true);
  const [original, setOriginal] = useState(null);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const campoRef = useRef(null);

  useEffect(() => {
    let ativo = true;
    carregarTemplateMensagem().then((r) => {
      if (!ativo) return;
      setOriginal(r);
      setTexto(r.template || '');
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const problema = validarTemplate(texto);
  const alterado = original && texto !== original.template;

  function inserirCampo(chave) {
    const campo = campoRef.current;
    const marcador = `{{${chave}}}`;
    if (!campo) {
      setTexto((t) => t + marcador);
      return;
    }
    const inicio = campo.selectionStart ?? texto.length;
    const fim = campo.selectionEnd ?? texto.length;
    const novo = texto.slice(0, inicio) + marcador + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      campo.focus();
      campo.setSelectionRange(inicio + marcador.length, inicio + marcador.length);
    });
  }

  async function salvar() {
    if (problema || !alterado) return;
    setSalvando(true);
    setErro('');
    const r = await salvarTemplateMensagem(texto, original.template);
    setSalvando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    onSalvo(r.registro);
  }

  return (
    <Modal titulo="Modelo global de mensagem de pedido" onFechar={onFechar} largura="md" fecharComEsc={!salvando}>
      {carregando ? (
        <p role="status">Carregando o modelo...</p>
      ) : !original?.disponivel ? (
        <Alert tom="warning">O modelo global ainda não está disponível neste banco.</Alert>
      ) : (
        <div className={styles.corpo}>
          <Alert tom="info">Este modelo vale para TODOS os pedidos e todos os usuários. Alterações feitas na mensagem de um pedido não mudam este modelo.</Alert>

          <label className={styles.rotulo} htmlFor="modelo-mensagem-pedido">
            Modelo
          </label>
          <Textarea
            id="modelo-mensagem-pedido"
            ref={campoRef}
            className={styles.preview}
            rows={12}
            maxLength={TAMANHO_MAXIMO_TEMPLATE}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-describedby="modelo-mensagem-campos"
          />
          {problema ? <p className={styles.erroCampo} role="alert">{problema}</p> : null}

          <div id="modelo-mensagem-campos" className={styles.campos}>
            <p className={styles.nota}>Campos disponíveis (toque para inserir no cursor). Uma linha cujos campos ficarem todos vazios é removida da mensagem.</p>
            <ul className={styles.listaCampos}>
              {PLACEHOLDERS.map((p) => (
                <li key={p.chave}>
                  <button type="button" className={styles.campo} onClick={() => inserirCampo(p.chave)} aria-label={`Inserir {{${p.chave}}}: ${p.descricao}`}>
                    <code>{`{{${p.chave}}}`}</code>
                  </button>
                  <span className={styles.descricaoCampo}>{p.descricao}</span>
                </li>
              ))}
            </ul>
          </div>

          {original.atualizadoEm && (
            <p className={styles.nota}>
              Última alteração: {formatarDataHora(original.atualizadoEm)}
              {original.atualizadoPorNome ? ` por ${original.atualizadoPorNome}` : ''}
            </p>
          )}
          {erro && <Alert tom="danger">{erro}</Alert>}

          <div className={styles.rodape}>
            <div className={styles.rodapeSecundario}>
              <Button variante="ghost" tamanho="sm" onClick={() => setTexto(TEMPLATE_PADRAO)} disabled={salvando || texto === TEMPLATE_PADRAO}>
                Restaurar padrão
              </Button>
            </div>
            <div className={styles.rodapePrincipal}>
              <Button variante="secondary" onClick={onFechar} disabled={salvando}>
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={salvando || !!problema || !alterado}>
                {salvando ? 'Salvando…' : 'Salvar modelo'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
