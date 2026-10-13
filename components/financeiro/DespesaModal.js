import { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import SecaoPagamento from './SecaoPagamento';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { lerValorMonetario } from '../../lib/funcionarios/pagamentosCalculo';
import { competenciaDe, estadoPagamentoInicial, montarPagamento, normalizarNomeCurto } from '../../lib/financeiro/contasPagarRegras';
import { criarDespesaManual, editarConta } from '../../lib/financeiro/contasPagar';
import estilos from './financeiro.module.css';

// Nova despesa manual (aluguel, energia, contador...) ou edição do
// cabeçalho de uma despesa existente (migration 0073). Fornecedor
// cadastrado é OPCIONAL: sem ele, credor livre. Descrição e credor são
// gravados em MAIÚSCULAS (o banco normaliza de novo). Na edição só o
// cabeçalho muda -- parcelas/valores mudam pelo Replanejar.
export default function DespesaModal({ conta = null, categorias, fornecedores, podePagar, onFechar, onSalvo }) {
  const editando = !!conta;
  const hoje = dataLocalHoje();
  const [descricao, setDescricao] = useState(conta?.descricao || '');
  const [categoriaId, setCategoriaId] = useState(conta?.categoria_id || '');
  const [tipoCredor, setTipoCredor] = useState(conta?.origem === 'manual' && conta?.credor_nome === null && conta?.fornecedor_id ? 'fornecedor' : 'livre');
  const [fornecedorId, setFornecedorId] = useState(conta?.credor_nome ? '' : conta?.fornecedor_id || '');
  const [credorNome, setCredorNome] = useState(conta?.credor_nome || '');
  const [competencia, setCompetencia] = useState((conta?.competencia || competenciaDe(hoje)).slice(0, 7));
  const [observacao, setObservacao] = useState(conta?.observacao || '');
  const [pagamento, setPagamento] = useState(() => ({ ...estadoPagamentoInicial({ dataBase: hoje }), modo: 'a_prazo', forma: 'boleto', primeiroVencimento: hoje, totalTexto: '' }));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Categoria inativa só aparece se já for a da conta em edição.
  const opcoesCategoria = useMemo(() => categorias.filter((c) => c.ativo || c.id === conta?.categoria_id), [categorias, conta]);
  const opcoesFornecedor = useMemo(() => fornecedores.filter((f) => f.ativo || f.id === conta?.fornecedor_id), [fornecedores, conta]);

  async function salvar() {
    setErro('');
    const dados = {
      descricao: descricao.trim(),
      categoriaId,
      fornecedorId: tipoCredor === 'fornecedor' ? fornecedorId : null,
      credorNome: tipoCredor === 'livre' ? credorNome.trim() : null,
      competencia: competencia ? `${competencia}-01` : '',
      observacao: observacao.trim() || null,
    };
    if (!dados.descricao) return setErro('Informe a descrição.');
    if (!dados.categoriaId) return setErro('Escolha a categoria.');
    if (tipoCredor === 'fornecedor' && !dados.fornecedorId) return setErro('Escolha o fornecedor.');
    if (tipoCredor === 'livre' && !dados.credorNome) return setErro('Informe o credor.');
    if (!dados.competencia) return setErro('Informe a competência.');

    if (editando) {
      setSalvando(true);
      const { erro: erroRpc } = await editarConta(conta.id, dados);
      setSalvando(false);
      if (erroRpc) return setErro(erroRpc);
      return onSalvo();
    }

    const total = lerValorMonetario(pagamento.totalTexto);
    if (!(total > 0)) return setErro('Informe o valor total maior que zero.');
    const r = montarPagamento({ ...pagamento, observacao: '' }, { total, hoje, exigeLancamento: true });
    if (r.erro) return setErro(r.erro);
    const pag = { ...r.payload, observacao: dados.observacao };
    if (pag.condicao === 'no_ato') pag.parcelas = [{ valor: total }];
    setSalvando(true);
    const { erro: erroRpc } = await criarDespesaManual(dados, pag);
    setSalvando(false);
    if (erroRpc) return setErro(erroRpc);
    onSalvo();
  }

  return (
    <Modal titulo={editando ? 'Editar despesa' : 'Nova despesa'} onFechar={salvando ? undefined : onFechar} largura="lg" fecharComEsc={false}>
      <div className={estilos.modalCorpo}>
        <Field label="Descrição *" dica={descricao ? `Será gravada como: ${normalizarNomeCurto(descricao)}` : 'Ex.: Aluguel da loja, Conta de energia'}>
          <Input value={descricao} maxLength={120} onChange={(e) => setDescricao(e.target.value)} />
        </Field>
        <div className={estilos.linhaCampos}>
          <Field label="Categoria *">
            <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">Selecione...</option>
              {opcoesCategoria.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.ativo ? '' : ' (inativa)'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Competência (mês) *">
            <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </Field>
        </div>
        <div className={estilos.opcoes} role="group" aria-label="Credor">
          <Button tamanho="sm" variante={tipoCredor === 'livre' ? 'primary' : 'secondary'} aria-pressed={tipoCredor === 'livre'} onClick={() => setTipoCredor('livre')}>Credor livre</Button>
          <Button tamanho="sm" variante={tipoCredor === 'fornecedor' ? 'primary' : 'secondary'} aria-pressed={tipoCredor === 'fornecedor'} onClick={() => setTipoCredor('fornecedor')}>Fornecedor cadastrado</Button>
        </div>
        {tipoCredor === 'livre' ? (
          <Field label="Credor *" dica="Ex.: imobiliária, concessionária de energia, contador.">
            <Input value={credorNome} maxLength={120} onChange={(e) => setCredorNome(e.target.value)} />
          </Field>
        ) : (
          <Field label="Fornecedor *">
            <Select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="">Selecione...</option>
              {opcoesFornecedor.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}{f.ativo ? '' : ' (inativo)'}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Observação">
          <Textarea rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </Field>

        {!editando && (
          <SecaoPagamento
            estado={pagamento}
            onChange={setPagamento}
            totalEditavel
            dataBase={hoje}
            hoje={hoje}
            permitirNaoLancar={false}
            podePagar={podePagar}
            titulo="Valor e pagamento"
            mostrarObservacao={false}
            desabilitado={salvando}
          />
        )}
        {editando && <p className={estilos.dica}>Valores, vencimentos e forma prevista mudam pelo “Replanejar”.</p>}

        {erro && <Alert tom="danger">{erro}</Alert>}
        <div className={estilos.rodape}>
          <Button variante="secondary" onClick={onFechar} disabled={salvando}>Voltar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : editando ? 'Salvar' : 'Criar despesa'}</Button>
        </div>
      </div>
    </Modal>
  );
}
