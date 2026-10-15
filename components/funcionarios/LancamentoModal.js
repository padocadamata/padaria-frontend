import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { criarLancamento, editarLancamento } from '../../lib/funcionarios/lancamentos';
import { NATUREZAS_LANCAMENTO, tiposParaSelecao, validarLancamento } from '../../lib/funcionarios/lancamentosCalculo';
import { formatarValorEditavel } from '../../lib/funcionarios/pagamentosCalculo';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { cx } from '../../lib/design/cx';
import estilosEscala from './escala.module.css';
import estilosPagamentos from './pagamentos.module.css';

// Novo/editar LANÇAMENTO (migration 0076): desconto ou acréscimo de uma
// funcionária, registrado SEM pagamento -- fica pendente até ser incluído
// num pagamento. Editar só existe enquanto pendente (o banco garante).
// A natureza vem sugerida pelo tipo, mas pode ser trocada.
export default function LancamentoModal({ lancamento = null, funcionarios, tipos, funcionarioInicialId = '', onFechar, onSalvo }) {
  const edicao = !!lancamento;
  const [funcionarioId, setFuncionarioId] = useState(lancamento?.funcionario_id || funcionarioInicialId || '');
  const [tipoId, setTipoId] = useState(lancamento?.tipo_id || '');
  const [natureza, setNatureza] = useState(lancamento?.natureza || 'desconto');
  const [valor, setValor] = useState(lancamento ? formatarValorEditavel(lancamento.valor) : '');
  const [data, setData] = useState(lancamento?.data_lancamento || dataLocalHoje());
  const [observacao, setObservacao] = useState(lancamento?.observacao || '');
  const [errosCampo, setErrosCampo] = useState({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const opcoesTipo = tiposParaSelecao(tipos, lancamento?.tipo_id);
  const funcionariaFixa = edicao ? funcionarios.find((f) => f.id === lancamento.funcionario_id) : null;

  function escolherTipo(id) {
    setTipoId(id);
    const tipo = tipos.find((t) => t.id === id);
    if (tipo) setNatureza(tipo.natureza);
  }

  async function salvar() {
    setErro('');
    const { payload, erros } = validarLancamento({ funcionarioId, tipoId, natureza, valor, data, observacao, hoje: dataLocalHoje() });
    setErrosCampo(erros);
    if (!payload) return;
    setSalvando(true);
    const { erro: erroRpc } = edicao ? await editarLancamento(lancamento.id, payload) : await criarLancamento(payload);
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onSalvo();
  }

  return (
    <Modal titulo={edicao ? 'Editar lançamento' : 'Novo lançamento'} onFechar={salvando ? undefined : onFechar} largura="md">
      <div className={estilosEscala.modalCorpo}>
        <p className={estilosPagamentos.prevista}>Fica pendente até ser incluído num pagamento desta funcionária.</p>

        {edicao ? (
          <Field label="Funcionária">
            <Input value={funcionariaFixa?.nome || lancamento.funcionario_nome || ''} disabled readOnly />
          </Field>
        ) : (
          <Field label="Funcionária" erro={errosCampo.funcionarioId}>
            <Select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
              <option value="">Escolha…</option>
              {funcionarios.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Tipo" erro={errosCampo.tipoId} dica={opcoesTipo.length === 0 ? 'Nenhum tipo ativo. Cadastre em Pagamentos > Configurações > Tipos de lançamento.' : undefined}>
          <Select value={tipoId} onChange={(e) => escolherTipo(e.target.value)}>
            <option value="">Escolha…</option>
            {opcoesTipo.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
                {!t.ativo ? ' (inativo)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className={estilosPagamentos.grupoNatureza}>
          <legend>Natureza</legend>
          <div className={estilosPagamentos.opcoesNatureza}>
            {NATUREZAS_LANCAMENTO.map((n) => (
              <label key={n.valor} className={cx(estilosPagamentos.opcaoNatureza, natureza === n.valor && estilosPagamentos.opcaoNaturezaAtiva)}>
                <input type="radio" name="natureza-lancamento" value={n.valor} checked={natureza === n.valor} onChange={() => setNatureza(n.valor)} />
                <span>
                  {n.sinal} {n.rotulo}
                </span>
              </label>
            ))}
          </div>
          <p className={estilosPagamentos.prevista}>{natureza === 'acrescimo' ? 'Acréscimo aumenta o valor a pagar.' : 'Desconto reduz o valor a pagar.'}</p>
          {errosCampo.natureza && <p className={estilosPagamentos.erroCampo}>{errosCampo.natureza}</p>}
        </fieldset>

        <div className={estilosPagamentos.camposLado}>
          <Field label="Valor (R$)" erro={errosCampo.valor}>
            <Input inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          </Field>
          <Field label="Data" erro={errosCampo.data}>
            <Input type="date" value={data} max={dataLocalHoje()} onChange={(e) => setData(e.target.value)} />
          </Field>
        </div>

        <Field label="Observação (opcional)">
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        </Field>

        {erro && <Alert tom="danger">{erro}</Alert>}

        <div className={estilosEscala.rodapePlanejamento}>
          <Button type="button" variante="secondary" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : edicao ? 'Salvar' : 'Registrar lançamento'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
