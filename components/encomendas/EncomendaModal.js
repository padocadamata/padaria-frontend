import { useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import SeletorClienteEncomenda from './SeletorClienteEncomenda';
import ItensEncomenda, { novaChaveItem } from './ItensEncomenda';
import { salvarEncomenda } from '../../lib/encomendas/encomendas';
import { montarItensPayload, STATUS_ENCOMENDA, validarEncomenda } from '../../lib/encomendas/regras';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import estilosEscala from '../funcionarios/escala.module.css';
import estilosClientes from '../clientes/clientes.module.css';
import estilos from './encomendas.module.css';

function itensIniciais(encomenda) {
  return (encomenda?.itens || []).map((i) => ({
    chave: novaChaveItem(),
    produto_id: i.produto_id,
    nome: i.produto_nome,
    quantidade: String(i.quantidade).replace('.', ','),
    comentario: i.comentario || '',
    ativo: i.produto_ativo,
    disponivel: i.produto_disponivel,
  }));
}

// Criar/editar 1 encomenda (migration 0071): cliente, retirada (data e
// horário), data do pedido (padrão hoje; editável para lançar um pedido
// recebido antes) e itens. Grava tudo de uma vez pela RPC
// salvar_encomenda (cabeçalho + itens na mesma transação). Só encomenda
// PENDENTE é editável; concluída/cancelada abre só para leitura.
export default function EncomendaModal({ encomenda, podeEditar, podeCadastrarCliente, onFechar, onSalvo }) {
  const nova = !encomenda;
  const hoje = dataLocalHoje();
  const editavel = podeEditar && (nova || encomenda.status === 'pendente');
  const [cliente, setCliente] = useState(
    encomenda ? { id: encomenda.cliente_id, nome: encomenda.cliente_nome, telefone: encomenda.cliente_telefone, inativo: !encomenda.cliente_ativo } : null
  );
  const [dataRetirada, setDataRetirada] = useState(encomenda?.data_retirada || '');
  const [horaRetirada, setHoraRetirada] = useState(encomenda?.hora_retirada?.slice(0, 5) || '');
  const [dataPedido, setDataPedido] = useState(encomenda?.data_pedido || hoje);
  const [itens, setItens] = useState(() => itensIniciais(encomenda));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar() {
    setErro('');
    const problema = validarEncomenda({
      clienteId: cliente?.id,
      dataRetirada,
      horaRetirada,
      dataPedido,
      itens,
      hoje,
      retiradaOriginal: encomenda?.data_retirada || null,
    });
    if (problema) {
      setErro(problema);
      return;
    }
    setSalvando(true);
    const { erro: erroRpc } = await salvarEncomenda({
      id: encomenda?.id,
      clienteId: cliente.id,
      dataRetirada,
      horaRetirada,
      dataPedido,
      itens: montarItensPayload(itens),
    });
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onSalvo(nova ? 'Encomenda registrada.' : 'Encomenda atualizada.');
  }

  const titulo = nova ? 'Nova encomenda' : editavel ? 'Editar encomenda' : 'Encomenda';

  return (
    <Modal titulo={titulo} onFechar={salvando ? undefined : onFechar} largura="lg">
      <div className={estilosEscala.modalCorpo}>
        {!nova && (
          <div className={estilosClientes.statusLinha}>
            <Badge tom={STATUS_ENCOMENDA[encomenda.status].tom}>{STATUS_ENCOMENDA[encomenda.status].rotulo}</Badge>
            {podeEditar && !editavel && <span className={estilos.dica}>Reabra a encomenda para editar.</span>}
          </div>
        )}

        <div className={estilosClientes.bloco} role="group" aria-labelledby="encomenda-cliente-rotulo">
          <span id="encomenda-cliente-rotulo" className={estilosClientes.rotulo}>
            Cliente
          </span>
          <SeletorClienteEncomenda cliente={cliente} onEscolher={setCliente} podeEditar={editavel} podeCadastrar={podeCadastrarCliente} />
        </div>

        <div className={estilos.linhaCampos}>
          <Field label="Data da retirada">
            <Input type="date" value={dataRetirada} min={nova ? hoje : undefined} onChange={(e) => setDataRetirada(e.target.value)} disabled={!editavel} />
          </Field>
          <Field label="Horário da retirada">
            <Input type="time" value={horaRetirada} onChange={(e) => setHoraRetirada(e.target.value)} disabled={!editavel} />
          </Field>
          <Field label="Data do pedido" dica="Quando o cliente fez o pedido (padrão: hoje).">
            <Input type="date" value={dataPedido} max={hoje} onChange={(e) => setDataPedido(e.target.value)} disabled={!editavel} />
          </Field>
        </div>

        <div className={estilosClientes.bloco} role="group" aria-labelledby="encomenda-itens-rotulo">
          <span id="encomenda-itens-rotulo" className={estilosClientes.rotulo}>
            Produtos
          </span>
          <ItensEncomenda itens={itens} onAlterar={setItens} podeEditar={editavel} />
        </div>

        <p className={estilos.dica}>Você receberá um lembrete no dia anterior à retirada.</p>

        {erro && <Alert tom="danger">{erro}</Alert>}

        <div className={estilosClientes.rodape}>
          <span className={estilosClientes.espaco} />
          <Button type="button" variante="secondary" onClick={onFechar} disabled={salvando}>
            {editavel ? 'Cancelar' : 'Fechar'}
          </Button>
          {editavel && (
            <Button type="button" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
