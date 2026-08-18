import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';
import RequireAuth from '../components/RequireAuth';
import FornecedorForm from '../components/fornecedores/FornecedorForm';
import { PERMISSOES, hasPermissao } from '../lib/auth/permissoes';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../hooks/useAuth';

function apenasDigitos(valor) {
  return (valor || '').replace(/\D/g, '');
}

function formatarDocumento(documento, tipoDocumento) {
  if (!documento) return '—';

  const digitos = apenasDigitos(documento);

  if (tipoDocumento === 'CNPJ' && digitos.length === 14) {
    return digitos.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5'
    );
  }

  if (tipoDocumento === 'CPF' && digitos.length === 11) {
    return digitos.replace(
      /(\d{3})(\d{3})(\d{3})(\d{2})/,
      '$1.$2.$3-$4'
    );
  }

  return documento;
}

function formatarContato(telefone, whatsapp) {
  if (!telefone && !whatsapp) return '-';

  if (telefone && whatsapp && telefone === whatsapp) {
    return telefone;
  }

  if (telefone && whatsapp) {
    return `${telefone} / ${whatsapp}`;
  }

  return telefone || whatsapp;
}

function formatarModalidade(modalidade) {
  if (modalidade === 'compra_presencial') {
    return 'Compra presencial';
  }

  return 'Pedido com entrega';
}

function BadgeStatus({ ativo }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: ativo ? '#4CAF50' : '#9e9e9e',
        whiteSpace: 'nowrap',
      }}
    >
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function BadgeModalidade({ modalidade }) {
  const presencial = modalidade === 'compra_presencial';

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: presencial ? '#FF9800' : '#2196F3',
        whiteSpace: 'nowrap',
      }}
    >
      {formatarModalidade(modalidade)}
    </span>
  );
}

function FornecedoresConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();

  const [fornecedores, setFornecedores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [filtroModalidade, setFiltroModalidade] = useState('todas');
  const [busca, setBusca] = useState('');

  const [modalAberto, setModalAberto] = useState(false);
  const [fornecedorEmEdicao, setFornecedorEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [recarregarTick, setRecarregarTick] = useState(0);

  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');

    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }

    const handleAparenciaAlterada = () => {
      const novaConfig = localStorage.getItem('aparenciaConfig');

      if (novaConfig) {
        try {
          setAparencia(JSON.parse(novaConfig));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener(
      'aparenciaAlterada',
      handleAparenciaAlterada
    );

    return () =>
      window.removeEventListener(
        'aparenciaAlterada',
        handleAparenciaAlterada
      );
  }, []);

  useEffect(() => {
    let efeitoAtivo = true;

    async function carregarFornecedores() {
      setCarregando(true);
      setErro('');

      const supabase = createClient();

      let consulta = supabase
        .from('fornecedores')
        .select(
          'id, nome, nome_fantasia, razao_social, tipo_documento, documento, contato_nome, telefone, whatsapp, email, endereco, forma_pagamento, modalidade_compra, observacoes, ativo'
        )
        .order('nome_fantasia', {
          ascending: true,
          nullsFirst: false,
        });

      if (filtroStatus === 'ativos') {
        consulta = consulta.eq('ativo', true);
      } else if (filtroStatus === 'inativos') {
        consulta = consulta.eq('ativo', false);
      }

      const { data, error } = await consulta;

      if (!efeitoAtivo) {
        return;
      }

      if (error) {
        console.error(
          'Erro ao carregar fornecedores:',
          error
        );

        setErro(
          'Não foi possível carregar a lista de fornecedores.'
        );

        setFornecedores([]);
      } else {
        setFornecedores(data || []);
      }

      setCarregando(false);
    }

    carregarFornecedores();

    return () => {
      efeitoAtivo = false;
    };
  }, [filtroStatus, recarregarTick]);

  useEffect(() => {
    if (!mensagemSucesso) {
      return undefined;
    }

    const timer = setTimeout(() => setMensagemSucesso(''), 4000);

    return () => clearTimeout(timer);
  }, [mensagemSucesso]);

  const buscaNormalizada = busca
    .trim()
    .toLowerCase();

  const buscaDigitos = apenasDigitos(busca);

  const fornecedoresFiltrados = fornecedores.filter(
    (fornecedor) => {
      if (
        filtroModalidade !== 'todas' &&
        fornecedor.modalidade_compra !== filtroModalidade
      ) {
        return false;
      }

      if (!buscaNormalizada) {
        return true;
      }

      const nomeFantasia = (
        fornecedor.nome_fantasia || ''
      ).toLowerCase();

      const razaoSocial = (
        fornecedor.razao_social || ''
      ).toLowerCase();

      const nomeLegado = (
        fornecedor.nome || ''
      ).toLowerCase();

      const telefoneTexto = (
        fornecedor.telefone || ''
      ).toLowerCase();

      const whatsappTexto = (
        fornecedor.whatsapp || ''
      ).toLowerCase();

      const textoBate =
        nomeFantasia.includes(buscaNormalizada) ||
        razaoSocial.includes(buscaNormalizada) ||
        nomeLegado.includes(buscaNormalizada) ||
        telefoneTexto.includes(buscaNormalizada) ||
        whatsappTexto.includes(buscaNormalizada);

      if (textoBate) {
        return true;
      }

      if (buscaDigitos) {
        const documentoDigitos = apenasDigitos(
          fornecedor.documento
        );

        const telefoneDigitos = apenasDigitos(
          fornecedor.telefone
        );

        const whatsappDigitos = apenasDigitos(
          fornecedor.whatsapp
        );

        if (
          documentoDigitos.includes(buscaDigitos) ||
          telefoneDigitos.includes(buscaDigitos) ||
          whatsappDigitos.includes(buscaDigitos)
        ) {
          return true;
        }
      }

      return false;
    }
  );

  function abrirNovoFornecedor() {
    setFornecedorEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicao(fornecedor) {
    setFornecedorEmEdicao(fornecedor);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setFornecedorEmEdicao(null);
  }

  function aoSalvar() {
    const estaEditando = fornecedorEmEdicao != null;

    fecharModal();

    setMensagemSucesso(
      estaEditando
        ? 'Fornecedor atualizado com sucesso.'
        : 'Fornecedor cadastrado com sucesso.'
    );

    setRecarregarTick((tick) => tick + 1);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: aparencia.corFundo,
      }}
    >
      <div
        style={{
          backgroundColor: aparencia.corPrimaria,
          color: 'white',
          padding: '20px',
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '15px',
            }}
          >
            {aparencia.logoBase64 && (
              <img
                src={aparencia.logoBase64}
                style={{
                  height: '50px',
                  maxWidth: '150px',
                  borderRadius: '5px',
                }}
                alt="Logo"
              />
            )}

            <h1 style={{ margin: 0 }}>
              {aparencia.nomeEmpresa || 'Padaria Sistema'}
            </h1>
          </div>

          <MenuOpcoes
            corPrimaria={aparencia.corPrimaria}
          />
        </div>
      </div>

      <div
        style={{
          maxWidth: '1200px',
          margin: '30px auto',
          padding: '0 20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginBottom: '30px',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              padding: '10px 20px',
              backgroundColor: 'white',
              color: aparencia.corPrimaria,
              border:
                '1px solid ' +
                aparencia.corPrimaria,
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Dashboard
          </button>

          <button
            onClick={() => router.push('/fornecedores')}
            style={{
              padding: '10px 20px',
              backgroundColor: aparencia.corPrimaria,
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Fornecedores
          </button>

          <button
            onClick={() => router.push('/producao')}
            style={{
              padding: '10px 20px',
              backgroundColor: 'white',
              color: aparencia.corPrimaria,
              border:
                '1px solid ' +
                aparencia.corPrimaria,
              cursor: 'pointer',
              borderRadius: '5px',
            }}
          >
            Produção
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <h2
            style={{
              color: aparencia.corPrimaria,
              margin: 0,
            }}
          >
            Fornecedores
          </h2>

          {hasPermissao(permissoes, PERMISSOES.FORNECEDORES_INSERIR) && (
            <button
              onClick={abrirNovoFornecedor}
              style={{
                padding: '10px 20px',
                backgroundColor: aparencia.corPrimaria,
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              + Novo fornecedor
            </button>
          )}
        </div>

        {mensagemSucesso && (
          <p
            style={{
              color: '#4CAF50',
              fontWeight: 'bold',
              marginTop: '10px',
            }}
          >
            {mensagemSucesso}
          </p>
        )}

        <div
          style={{
            backgroundColor: '#f9f9f9',
            padding: '15px',
            borderRadius: '5px',
            marginBottom: '20px',
            marginTop: '15px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '15px',
            }}
          >
            <div>
              <label
                style={{
                  fontWeight: 'bold',
                  display: 'block',
                  marginBottom: '5px',
                }}
              >
                Status
              </label>

              <select
                value={filtroStatus}
                onChange={(e) =>
                  setFiltroStatus(e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="ativos">
                  Ativos
                </option>
                <option value="inativos">
                  Inativos
                </option>
                <option value="todos">
                  Todos
                </option>
              </select>
            </div>

            <div>
              <label
                style={{
                  fontWeight: 'bold',
                  display: 'block',
                  marginBottom: '5px',
                }}
              >
                Modalidade
              </label>

              <select
                value={filtroModalidade}
                onChange={(e) =>
                  setFiltroModalidade(e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="todas">
                  Todas
                </option>
                <option value="pedido_com_entrega">
                  Pedido com entrega
                </option>
                <option value="compra_presencial">
                  Compra presencial
                </option>
              </select>
            </div>

            <div>
              <label
                style={{
                  fontWeight: 'bold',
                  display: 'block',
                  marginBottom: '5px',
                }}
              >
                Buscar
              </label>

              <input
                type="text"
                value={busca}
                onChange={(e) =>
                  setBusca(e.target.value)
                }
                placeholder="Nome, razão social, documento, telefone..."
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>

        {carregando ? (
          <p>Carregando fornecedores...</p>
        ) : erro ? (
          <p style={{ color: '#f44336' }}>
            {erro}
          </p>
        ) : fornecedores.length === 0 ? (
          <p>Nenhum fornecedor encontrado.</p>
        ) : fornecedoresFiltrados.length === 0 ? (
          <p>
            Nenhum resultado para esta busca/filtro.
          </p>
        ) : (
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '5px',
              boxShadow:
                '0 2px 5px rgba(0,0,0,0.1)',
              overflowX: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom:
                      '2px solid #ddd',
                  }}
                >
                  <th
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      color:
                        aparencia.corPrimaria,
                      fontWeight: 'bold',
                    }}
                  >
                    Nome
                  </th>

                  <th
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      color:
                        aparencia.corPrimaria,
                      fontWeight: 'bold',
                    }}
                  >
                    Documento
                  </th>

                  <th
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      color:
                        aparencia.corPrimaria,
                      fontWeight: 'bold',
                    }}
                  >
                    Contato
                  </th>

                  <th
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      color:
                        aparencia.corPrimaria,
                      fontWeight: 'bold',
                    }}
                  >
                    Forma de pagamento
                  </th>

                  <th
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      color:
                        aparencia.corPrimaria,
                      fontWeight: 'bold',
                    }}
                  >
                    Modalidade
                  </th>

                  <th
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      color:
                        aparencia.corPrimaria,
                      fontWeight: 'bold',
                    }}
                  >
                    Status
                  </th>

                  <th
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      color:
                        aparencia.corPrimaria,
                      fontWeight: 'bold',
                    }}
                  >
                    Ações
                  </th>
                </tr>
              </thead>

              <tbody>
                {fornecedoresFiltrados.map(
                  (fornecedor) => (
                    <tr
                      key={fornecedor.id}
                      style={{
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      <td
                        style={{
                          padding: '12px',
                        }}
                      >
                        {fornecedor.nome_fantasia ||
                          fornecedor.razao_social ||
                          fornecedor.nome ||
                          '-'}
                      </td>

                      <td
                        style={{
                          padding: '12px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatarDocumento(
                          fornecedor.documento,
                          fornecedor.tipo_documento
                        )}
                      </td>

                      <td
                        style={{
                          padding: '12px',
                        }}
                      >
                        {formatarContato(
                          fornecedor.telefone,
                          fornecedor.whatsapp
                        )}
                      </td>

                      <td
                        style={{
                          padding: '12px',
                        }}
                      >
                        {fornecedor.forma_pagamento ||
                          '-'}
                      </td>

                      <td
                        style={{
                          padding: '12px',
                        }}
                      >
                        <BadgeModalidade
                          modalidade={
                            fornecedor.modalidade_compra
                          }
                        />
                      </td>

                      <td
                        style={{
                          padding: '12px',
                        }}
                      >
                        <BadgeStatus
                          ativo={fornecedor.ativo}
                        />
                      </td>

                      <td
                        style={{
                          padding: '12px',
                        }}
                      >
                        {hasPermissao(permissoes, PERMISSOES.FORNECEDORES_EDITAR) && (
                          <button
                            onClick={() => abrirEdicao(fornecedor)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#2196F3',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>

            <p
              style={{
                marginTop: '15px',
                color: '#666',
                fontSize: '14px',
              }}
            >
              Total de fornecedores:{' '}
              <strong>
                {fornecedoresFiltrados.length}
              </strong>
            </p>
          </div>
        )}
      </div>

      {modalAberto && (
        <FornecedorForm
          fornecedor={fornecedorEmEdicao}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
          permissoes={permissoes}
        />
      )}
    </div>
  );
}

export default function Fornecedores() {
  return (
    <RequireAuth
      permissao={
        PERMISSOES.FORNECEDORES_VISUALIZAR
      }
    >
      <FornecedoresConteudo />
    </RequireAuth>
  );
}
