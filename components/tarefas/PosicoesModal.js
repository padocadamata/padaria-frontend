import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Alert from '../ui/Alert';
import { cx } from '../../lib/design/cx';
import { dataCurta, nomeVigente } from '../../lib/tarefas/calendario';
import { definirNomePosicao } from '../../lib/tarefas/consultas';
import { mensagemErro } from '../../lib/tarefas/erros';
import { PreviaSincronizacao } from './ProgramarMesModal';
import estilos from './tarefas.module.css';

// Identificação OPCIONAL de F1/F2/F3 por nome livre, com vigência (sem
// vínculo com o cadastro de funcionários). Só vale de hoje em diante: o
// nome já materializado nas ocorrências anteriores nunca muda.
export default function PosicoesModal({ nomes, hoje, podeEditar, onFechar, onSalvo }) {
  const [posicao, setPosicao] = useState(1);
  const [nome, setNome] = useState(nomeVigente(nomes, 1, hoje) || '');
  const [aPartirDe, setAPartirDe] = useState(hoje);
  const [previa, setPrevia] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function trocarPosicao(p) {
    setPosicao(p);
    setNome(nomeVigente(nomes, p, aPartirDe) || '');
    setPrevia(null);
  }

  async function executar(simular) {
    setSalvando(true);
    setErro('');
    try {
      const r = await definirNomePosicao(posicao, nome.trim(), aPartirDe, simular);
      if (simular) {
        setPrevia(r);
      } else {
        onSalvo(r);
      }
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const historico = [1, 2, 3].map((p) => ({
    posicao: p,
    vigencias: nomes.filter((n) => n.posicao === p).sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde)),
  }));

  return (
    <Modal titulo="Identificar F1, F2 e F3" onFechar={onFechar} largura="md">
      <div className={estilos.pilha}>
        <p className={estilos.textoAuxiliar}>
          F1, F2 e F3 são posições de distribuição. O nome é opcional e livre (não depende do cadastro de funcionários). Sem nome, o
          calendário mostra F1/F2/F3.
        </p>

        {historico.map((h) => (
          <div key={h.posicao}>
            <span className={cx(estilos.chipPosicao, estilos[`pos${h.posicao}`])}>
              F{h.posicao} hoje: {nomeVigente(nomes, h.posicao, hoje) || 'sem nome'}
            </span>
            {h.vigencias.length > 0 && (
              <ul className={estilos.listaVigencias}>
                {h.vigencias.map((v) => (
                  <li key={v.id}>
                    desde {dataCurta(v.vigente_desde)}/{v.vigente_desde.slice(0, 4)}: {v.nome || 'sem nome'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {podeEditar && (
          <section className={estilos.secaoModal}>
            <h3 className={estilos.tituloSecaoModal}>Alterar identificação</h3>
            <div className={estilos.pilha}>
              <div className={estilos.linhaCampos}>
                <Field label="Posição">
                  <Select value={posicao} onChange={(e) => trocarPosicao(Number(e.target.value))} disabled={salvando}>
                    <option value={1}>F1</option>
                    <option value={2}>F2</option>
                    <option value={3}>F3</option>
                  </Select>
                </Field>
                <Field label="A partir de">
                  <Input
                    type="date"
                    min={hoje}
                    value={aPartirDe}
                    onChange={(e) => {
                      setAPartirDe(e.target.value);
                      setPrevia(null);
                    }}
                    disabled={salvando}
                  />
                </Field>
              </div>
              <Field label="Nome (deixe vazio para mostrar só a posição)">
                <Input
                  value={nome}
                  maxLength={60}
                  onChange={(e) => {
                    setNome(e.target.value);
                    setPrevia(null);
                  }}
                  disabled={salvando}
                />
              </Field>
              {erro && <Alert tom="danger">{erro}</Alert>}
              {previa && <PreviaSincronizacao resultado={previa} />}
              <p className={estilos.textoAuxiliar}>
                Dias anteriores continuam com o nome que já tinham. Ocorrências concluídas, ajustadas, canceladas ou avulsas não mudam.
              </p>
              <div className={estilos.rodapeModal}>
                <Button variante="secondary" onClick={onFechar} disabled={salvando}>Fechar</Button>
                {previa ? (
                  <Button onClick={() => executar(false)} disabled={salvando || !aPartirDe}>Confirmar</Button>
                ) : (
                  <Button onClick={() => executar(true)} disabled={salvando || !aPartirDe}>Ver prévia</Button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
