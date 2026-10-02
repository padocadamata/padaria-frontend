import { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import SeletorProdutosInteresse from './SeletorProdutosInteresse';
import { salvarCliente, definirStatusCliente } from '../../lib/clientes/clientes';
import { formatarTelefone, mascararTelefoneDigitando, normalizarTelefone } from '../../lib/clientes/telefone';
import { normalizarNomeCliente } from '../../lib/clientes/filtros';
import estilosEscala from '../funcionarios/escala.module.css';
import estilos from './clientes.module.css';

// Criar/editar 1 cliente (migration 0069): nome, telefone, observação,
// produtos de interesse e ativar/inativar. Grava tudo de uma vez pela RPC
// salvar_cliente (nome em MAIÚSCULAS e telefone só dígitos no banco). O
// aviso de telefone repetido aparece antes de salvar (lista já carregada)
// e o banco garante de novo (índice único).
export default function ClienteModal({ cliente, clientes, podeEditar, onFechar, onSalvo }) {
  const novo = !cliente;
  const [nome, setNome] = useState(cliente?.nome || '');
  const [telefone, setTelefone] = useState(cliente ? formatarTelefone(cliente.telefone) : '');
  const [observacao, setObservacao] = useState(cliente?.observacao || '');
  const [produtos, setProdutos] = useState(cliente?.produtos || []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const telefoneNormalizado = normalizarTelefone(telefone);
  const telefoneIncompleto = telefone.trim() !== '' && !telefoneNormalizado;
  const duplicado = useMemo(() => {
    if (!telefoneNormalizado) return null;
    return (clientes || []).find((c) => c.telefone === telefoneNormalizado && c.id !== cliente?.id) || null;
  }, [telefoneNormalizado, clientes, cliente]);

  async function salvar() {
    setErro('');
    if (!normalizarNomeCliente(nome)) {
      setErro('Informe o nome do cliente.');
      return;
    }
    if (!telefoneNormalizado) {
      setErro('Telefone inválido. Informe DDD + número (celular com 9 dígitos ou fixo com 8).');
      return;
    }
    if (duplicado) {
      setErro(`Este telefone já está cadastrado para ${duplicado.nome}${duplicado.ativo ? '' : ' (cliente inativo — reative o cadastro existente)'}.`);
      return;
    }
    setSalvando(true);
    const { erro: erroRpc } = await salvarCliente({
      id: cliente?.id,
      nome: normalizarNomeCliente(nome),
      telefone: telefoneNormalizado,
      observacao,
      produtoIds: produtos.map((p) => p.produto_id),
    });
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onSalvo(novo ? 'Cliente cadastrado.' : 'Cliente atualizado.');
  }

  async function alternarStatus() {
    setErro('');
    setSalvando(true);
    const { erro: erroRpc } = await definirStatusCliente(cliente.id, !cliente.ativo);
    setSalvando(false);
    if (erroRpc) {
      setErro(erroRpc);
      return;
    }
    onSalvo(cliente.ativo ? 'Cliente inativado.' : 'Cliente reativado.');
  }

  return (
    <Modal titulo={novo ? 'Novo cliente' : podeEditar ? `Editar cliente` : 'Cliente'} onFechar={salvando ? undefined : onFechar} largura="md">
      <div className={estilosEscala.modalCorpo}>
        {!novo && (
          <div className={estilos.statusLinha}>
            <Badge tom={cliente.ativo ? 'success' : 'neutral'}>{cliente.ativo ? 'Ativo' : 'Inativo'}</Badge>
          </div>
        )}

        <Field label="Nome" dica={nome.trim() ? `Será salvo como: ${normalizarNomeCliente(nome)}` : undefined}>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} disabled={!podeEditar} autoFocus={novo} />
        </Field>

        <Field
          label="Telefone (com DDD)"
          erro={telefoneIncompleto ? 'Informe DDD + número: celular (11) 98765-4321 ou fixo (11) 3456-7890.' : undefined}
        >
          <Input
            type="tel"
            inputMode="tel"
            value={telefone}
            onChange={(e) => setTelefone(mascararTelefoneDigitando(e.target.value))}
            placeholder="(11) 98765-4321"
            disabled={!podeEditar}
          />
        </Field>
        {duplicado && (
          <Alert tom="warning">
            Este telefone já está cadastrado para <strong>{duplicado.nome}</strong>
            {duplicado.ativo ? '' : ' (inativo)'}. Edite o cadastro existente em vez de criar outro.
          </Alert>
        )}

        <div className={estilos.bloco} role="group" aria-labelledby="cliente-produtos-rotulo">
          <span id="cliente-produtos-rotulo" className={estilos.rotulo}>
            Produtos de interesse
          </span>
          <SeletorProdutosInteresse selecionados={produtos} onAlterar={setProdutos} podeEditar={podeEditar} />
        </div>

        <Field label="Observação (opcional)">
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={1000} disabled={!podeEditar} />
        </Field>

        {erro && <Alert tom="danger">{erro}</Alert>}

        <div className={estilos.rodape}>
          {!novo && podeEditar && (
            <Button type="button" variante={cliente.ativo ? 'danger' : 'secondary'} onClick={alternarStatus} disabled={salvando}>
              {cliente.ativo ? 'Inativar' : 'Reativar'}
            </Button>
          )}
          <span className={estilos.espaco} />
          <Button type="button" variante="secondary" onClick={onFechar} disabled={salvando}>
            {podeEditar ? 'Cancelar' : 'Fechar'}
          </Button>
          {podeEditar && (
            <Button type="button" onClick={salvar} disabled={salvando || !!duplicado}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
