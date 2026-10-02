import { useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import useBuscaSobDemanda from './useBuscaSobDemanda';
import { buscarClientesEncomenda, LIMITE_BUSCA_CLIENTES } from '../../lib/encomendas/encomendas';
import { salvarCliente } from '../../lib/clientes/clientes';
import { normalizarNomeCliente } from '../../lib/clientes/filtros';
import { formatarTelefone, mascararTelefoneDigitando, normalizarTelefone } from '../../lib/clientes/telefone';
import estilosClientes from '../clientes/clientes.module.css';
import estilos from './encomendas.module.css';

// Cliente da encomenda: busca de cliente ATIVO por nome ou telefone
// (buscar_clientes_encomenda) OU cadastro rápido sem sair da encomenda.
// O cadastro rápido chama a MESMA RPC de Clientes (salvar_cliente): nome em
// MAIÚSCULAS, telefone só dígitos e duplicidade de telefone com as regras
// já publicadas -- nenhuma regra paralela aqui. Só aparece para quem tem
// clientes.editar (`podeCadastrar`).
// `cliente` = { id, nome, telefone } | null.
export default function SeletorClienteEncomenda({ cliente, onEscolher, podeEditar, podeCadastrar }) {
  const busca = useBuscaSobDemanda(buscarClientesEncomenda, LIMITE_BUSCA_CLIENTES);
  const [cadastrando, setCadastrando] = useState(false);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function escolher(c) {
    onEscolher({ id: c.id, nome: c.nome, telefone: c.telefone });
    busca.setTermo('');
  }

  function abrirCadastro() {
    // Aproveita o que já foi digitado na busca (nome ou telefone).
    const digitado = busca.termo.trim();
    if (normalizarTelefone(digitado)) setTelefone(formatarTelefone(normalizarTelefone(digitado)));
    else setNome(digitado);
    setErro('');
    setCadastrando(true);
  }

  async function cadastrar() {
    setErro('');
    const nomeFinal = normalizarNomeCliente(nome);
    const telefoneFinal = normalizarTelefone(telefone);
    if (!nomeFinal) return setErro('Informe o nome do cliente.');
    if (!telefoneFinal) return setErro('Telefone inválido. Informe DDD + número (celular com 9 dígitos ou fixo com 8).');
    setSalvando(true);
    const r = await salvarCliente({ id: null, nome: nomeFinal, telefone: telefoneFinal, observacao: '', produtoIds: [] });
    setSalvando(false);
    if (r.erro) return setErro(r.erro);
    onEscolher({ id: r.id, nome: nomeFinal, telefone: telefoneFinal });
    setCadastrando(false);
    setNome('');
    setTelefone('');
    busca.setTermo('');
  }

  if (cliente) {
    return (
      <div className={estilos.clienteEscolhido}>
        <span>
          <strong>{cliente.nome}</strong> · <span className={estilosClientes.telefone}>{formatarTelefone(cliente.telefone)}</span>
          {cliente.inativo && <span className={estilos.aviso}> (cliente inativo)</span>}
        </span>
        {podeEditar && (
          <Button type="button" variante="ghost" tamanho="sm" onClick={() => onEscolher(null)}>
            Trocar
          </Button>
        )}
      </div>
    );
  }

  if (cadastrando) {
    return (
      <div className={estilos.cadastroRapido}>
        <p className={estilos.dica}>Cadastre os dados do cliente para continuar com a encomenda.</p>
        <Field label="Nome" dica={nome.trim() ? `Será salvo como: ${normalizarNomeCliente(nome)}` : undefined}>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <Field label="Telefone (com DDD)">
          <Input type="tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(mascararTelefoneDigitando(e.target.value))} placeholder="(11) 98765-4321" />
        </Field>
        {erro && <Alert tom="danger">{erro}</Alert>}
        <div className={estilosClientes.rodape}>
          <span className={estilosClientes.espaco} />
          <Button type="button" variante="secondary" onClick={() => setCadastrando(false)} disabled={salvando}>
            Voltar à busca
          </Button>
          <Button type="button" onClick={cadastrar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Cadastrar e usar'}
          </Button>
        </div>
      </div>
    );
  }

  const { estado } = busca;
  return (
    <div className={estilosClientes.seletor}>
      <Input
        type="search"
        value={busca.termo}
        onChange={(e) => busca.setTermo(e.target.value)}
        placeholder="Buscar cliente por nome ou telefone..."
        aria-label="Buscar cliente"
        disabled={!podeEditar}
      />
      {estado.tipo !== 'oculto' && (
        <div className={estilosClientes.resultados} role="listbox" aria-label="Clientes encontrados">
          {estado.tipo === 'buscando' ? (
            <p className={estilosClientes.mensagemBusca}>Buscando...</p>
          ) : estado.tipo === 'erro' ? (
            <p className={estilosClientes.mensagemBusca}>{busca.erro}</p>
          ) : estado.tipo === 'vazio' ? (
            <p className={estilosClientes.mensagemBusca}>Nenhum cliente ativo encontrado.</p>
          ) : (
            <>
              {estado.avisoLimite && <p className={estilosClientes.mensagemBusca}>Mostrando os primeiros {LIMITE_BUSCA_CLIENTES}. Digite mais para refinar.</p>}
              {busca.resultados.map((c) => (
                <div key={c.id} className={estilosClientes.resultado}>
                  <span>
                    {c.nome} · <span className={estilosClientes.telefone}>{formatarTelefone(c.telefone)}</span>
                  </span>
                  <Button type="button" variante="secondary" tamanho="sm" onClick={() => escolher(c)}>
                    Escolher
                  </Button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {podeEditar &&
        (podeCadastrar ? (
          <Button type="button" variante="ghost" tamanho="sm" icone="plus" onClick={abrirCadastro}>
            Cadastrar novo cliente
          </Button>
        ) : (
          <p className={estilos.dica}>Cliente novo? Peça a quem tem acesso a Clientes para cadastrá-lo.</p>
        ))}
    </div>
  );
}
