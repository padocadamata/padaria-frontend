import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';

export default function Producao() {
  const router = useRouter();
  const [abaAtiva, setAbaAtiva] = useState('vendas');
  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  // FORM
  const [formData, setFormData] = useState({
    data: '',
    produto: '',
    periodo: 'manha',
    tipo: 'producao',
    quantidade: '',
    observacao: '',
  });

  // DADOS REGISTRADOS
  const [registros, setRegistros] = useState([]);
  
  // FILTROS
  const [filtros, setFiltros] = useState({
    mes: '',
    produto: '',
    periodo: '',
  });

  // EDIÇÃO
  const [editandoId, setEditandoId] = useState(null);
  const [editData, setEditData] = useState({});
  const [hoverObs, setHoverObs] = useState(null);

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');
    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }

    const registrosSalvos = localStorage.getItem('vendasSobrasRegistros');
    if (registrosSalvos) {
      try {
        setRegistros(JSON.parse(registrosSalvos));
      } catch (e) {
        console.error('Erro ao carregar registros:', e);
      }
    }

    const handleAparenciaAlterada = () => {
      const config = localStorage.getItem('aparenciaConfig');
      if (config) {
        try {
          setAparencia(JSON.parse(config));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  const salvarRegistros = (novoRegistros) => {
    localStorage.setItem('vendasSobrasRegistros', JSON.stringify(novoRegistros));
  };

  const adicionarRegistro = () => {
    if (!formData.data || !formData.produto || !formData.quantidade) {
      alert('Preencha os campos obrigatórios: Data, Produto e Quantidade');
      return;
    }

    const novoRegistro = {
      id: Date.now(),
      data: formData.data,
      produto: formData.produto,
      periodo: formData.periodo,
      tipo: formData.tipo,
      quantidade: parseInt(formData.quantidade),
      observacao: formData.observacao,
    };

    const novosRegistros = [...registros, novoRegistro];
    setRegistros(novosRegistros);
    salvarRegistros(novosRegistros);

    setFormData({
      data: '',
      produto: '',
      periodo: 'manha',
      tipo: 'producao',
      quantidade: '',
      observacao: '',
    });
  };

  const iniciarEdicao = (registro) => {
    setEditandoId(registro.id);
    setEditData({ ...registro });
  };

  const salvarEdicao = () => {
    const novosRegistros = registros.map(r => 
      r.id === editandoId ? editData : r
    );
    setRegistros(novosRegistros);
    salvarRegistros(novosRegistros);
    setEditandoId(null);
  };

  const deletarRegistro = (id) => {
    if (confirm('Tem certeza que deseja deletar este registro?')) {
      const novosRegistros = registros.filter(r => r.id !== id);
      setRegistros(novosRegistros);
      salvarRegistros(novosRegistros);
    }
  };

  const agruparRegistros = () => {
    const agrupado = {};

    registros.forEach(reg => {
      const chave = `${reg.data}-${reg.produto}`;
      if (!agrupado[chave]) {
        agrupado[chave] = {
          data: reg.data,
          produto: reg.produto,
          manha: { producao: null, vendas: null, sobras: null },
          tarde: { producao: null, vendas: null, sobras: null },
          observacao: '',
        };
      }

      const periodo = reg.periodo === 'manha' ? agrupado[chave].manha : agrupado[chave].tarde;
      if (reg.tipo === 'producao') periodo.producao = reg.quantidade;
      if (reg.tipo === 'vendas') periodo.vendas = reg.quantidade;
      if (reg.tipo === 'sobras') periodo.sobras = reg.quantidade;
      if (reg.observacao) agrupado[chave].observacao = reg.observacao;
    });

    return Object.values(agrupado);
  };

  const calcularVendas = (producao, sobras) => {
    if (producao && sobras) {
      return producao - sobras;
    }
    return null;
  };

  const obterDiaSemana = (data) => {
    const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const [ano, mes, dia] = data.split('-');
    const date = new Date(ano, mes - 1, dia);
    return dias[date.getDay()];
  };

  const dadosFiltrados = agruparRegistros().filter(linha => {
    if (filtros.mes) {
      const mes = linha.data.split('-')[1];
      if (mes !== filtros.mes) return false;
    }
    if (filtros.produto && linha.produto !== filtros.produto) return false;
    return true;
  });

  const produtosUnicos = [...new Set(registros.map(r => r.produto))];

  const abas = [
    { id: 'vendas', nome: '📊 Vendas e Sobras', icone: '📊' },
    { id: 'fluxo', nome: '📦 Fluxo de Mercadorias', icone: '📦' },
    { id: 'estoque', nome: '🧊 Controle de Estoque', icone: '🧊' },
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {aparencia.logoBase64 && (
              <img 
                src={aparencia.logoBase64} 
                style={{ height: '50px', maxWidth: '150px', borderRadius: '5px' }}
                alt="Logo"
              />
            )}
            <h1 style={{ margin: 0 }}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          </div>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '30px auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: aparencia.corPrimaria, border: '1px solid ' + aparencia.corPrimaria, cursor: 'pointer', borderRadius: '5px' }}
          >
            Dashboard
          </button>
          <button
            onClick={() => router.push('/fornecedores')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: aparencia.corPrimaria, border: '1px solid ' + aparencia.corPrimaria, cursor: 'pointer', borderRadius: '5px' }}
          >
            Fornecedores
          </button>
          <button
            onClick={() => router.push('/producao')}
            style={{ padding: '10px 20px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px' }}
          >
            Produção
          </button>
        </div>

        <div style={{ backgroundColor: 'white', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: `2px solid ${aparencia.corPrimaria}` }}>
            {abas.map((aba) => (
              <button
                key={aba.id}
                onClick={() => setAbaAtiva(aba.id)}
                style={{
                  flex: 1,
                  padding: '15px 20px',
                  backgroundColor: abaAtiva === aba.id ? aparencia.corPrimaria : 'white',
                  color: abaAtiva === aba.id ? 'white' : aparencia.corPrimaria,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease',
                }}
                onMouseOver={(e) => {
                  if (abaAtiva !== aba.id) {
                    e.target.style.backgroundColor = '#f9f9f9';
                  }
                }}
                onMouseOut={(e) => {
                  if (abaAtiva !== aba.id) {
                    e.target.style.backgroundColor = 'white';
                  }
                }}
              >
                {aba.nome}
              </button>
            ))}
          </div>

          <div style={{ padding: '20px' }}>
            {abaAtiva === 'vendas' && (
              <div>
                <h3 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>➕ Novo Registro</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginBottom: '15px' }}>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Data *</label>
                    <input
                      type="date"
                      value={formData.data}
                      onChange={(e) => setFormData({ ...formData, data: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Produto *</label>
                    <select
                      value={formData.produto}
                      onChange={(e) => setFormData({ ...formData, produto: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                    >
                      <option value="">Selecione</option>
                      <option value="Pão Francês">Pão Francês</option>
                      <option value="Baguete">Baguete</option>
                      <option value="Pão de Forma">Pão de Forma</option>
                      <option value="Pão Doce">Pão Doce</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Período *</label>
                    <select
                      value={formData.periodo}
                      onChange={(e) => setFormData({ ...formData, periodo: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                    >
                      <option value="manha">Manhã (06h-12h)</option>
                      <option value="tarde">Tarde (15h-19h30)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Tipo *</label>
                    <select
                      value={formData.tipo}
                      onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                    >
                      <option value="producao">Produção</option>
                      <option value="vendas">Vendas</option>
                      <option value="sobras">Sobras</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Quantidade *</label>
                    <input
                      type="number"
                      value={formData.quantidade}
                      onChange={(e) => setFormData({ ...formData, quantidade: e.target.value })}
                      placeholder="0"
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '15px' }}>
                  <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Observação</label>
                  <textarea
                    value={formData.observacao}
                    onChange={(e) => setFormData({ ...formData, observacao: e.target.value })}
                    placeholder="Digite qualquer observação..."
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box', minHeight: '60px', fontFamily: 'Arial' }}
                  />
                </div>

                <button
                  onClick={adicionarRegistro}
                  style={{
                    padding: '10px 25px',
                    backgroundColor: aparencia.corPrimaria,
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '16px',
                    marginBottom: '30px',
                  }}
                >
                  ➕ Adicionar Registro
                </button>

                <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
                  <h4 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>🔍 Filtros</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
                    <div>
                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Mês</label>
                      <select
                        value={filtros.mes}
                        onChange={(e) => setFiltros({ ...filtros, mes: e.target.value })}
                        style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                      >
                        <option value="">Todos</option>
                        <option value="01">Janeiro</option>
                        <option value="02">Fevereiro</option>
                        <option value="03">Março</option>
                        <option value="04">Abril</option>
                        <option value="05">Maio</option>
                        <option value="06">Junho</option>
                        <option value="07">Julho</option>
                        <option value="08">Agosto</option>
                        <option value="09">Setembro</option>
                        <option value="10">Outubro</option>
                        <option value="11">Novembro</option>
                        <option value="12">Dezembro</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Produto</label>
                      <select
                        value={filtros.produto}
                        onChange={(e) => setFiltros({ ...filtros, produto: e.target.value })}
                        style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                      >
                        <option value="">Todos</option>
                        {produtosUnicos.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={() => setFiltros({ mes: '', produto: '', periodo: '' })}
                      style={{
                        padding: '8px 15px',
                        backgroundColor: '#999',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        alignSelf: 'flex-end',
                      }}
                    >
                      Limpar Filtros
                    </button>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ backgroundColor: aparencia.corPrimaria, color: 'white' }}>
                        <th style={{ padding: '10px', textAlign: 'left', borderRight: '1px solid #ddd' }}>Data</th>
                        <th style={{ padding: '10px', textAlign: 'left', borderRight: '1px solid #ddd' }}>Dia</th>
                        <th style={{ padding: '10px', textAlign: 'left', borderRight: '1px solid #ddd' }}>Produto</th>
                        <th colSpan="3" style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #ddd', backgroundColor: '#6B3410' }}>Manhã</th>
                        <th colSpan="3" style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #ddd', backgroundColor: '#6B3410' }}>Tarde</th>
                        <th style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #ddd' }}>Sobra Final</th>
                        <th style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #ddd' }}>Total Prod</th>
                        <th style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #ddd' }}>Total Vend</th>
                        <th style={{ padding: '10px', textAlign: 'center' }}>Ações</th>
                      </tr>
                      <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}></th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}></th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}></th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}>Prod</th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}>Vend</th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}>Sobra</th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}>Prod</th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}>Vend</th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}>Sobra</th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}></th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}></th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px', borderRight: '1px solid #ddd' }}></th>
                        <th style={{ padding: '8px', textAlign: 'center', fontSize: '11px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dadosFiltrados.length === 0 ? (
                        <tr>
                          <td colSpan="13" style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                            Nenhum registro encontrado
                          </td>
                        </tr>
                      ) : (
                        dadosFiltrados.map((linha, idx) => {
                          const vendasManha = calcularVendas(linha.manha.producao, linha.manha.sobras);
                          const vendasTarde = calcularVendas(linha.tarde.producao, linha.tarde.sobras);
                          const sobraFinal = (linha.manha.sobras || 0) + (linha.tarde.sobras || 0);
                          const totalProd = (linha.manha.producao || 0) + (linha.tarde.producao || 0);
                          const totalVend = (vendasManha || 0) + (vendasTarde || 0);

                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                              <td style={{ padding: '10px', borderRight: '1px solid #eee' }}>{linha.data}</td>
                              <td style={{ padding: '10px', borderRight: '1px solid #eee' }}>{obterDiaSemana(linha.data)}</td>
                              <td style={{ padding: '10px', borderRight: '1px solid #eee', fontWeight: 'bold' }}>{linha.produto}</td>
                              
                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee', backgroundColor: '#fffbf0' }}>{linha.manha.producao !== null ? linha.manha.producao : '-'}</td>
                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee', backgroundColor: '#fffbf0' }}>{vendasManha !== null ? vendasManha : (linha.manha.vendas !== null ? linha.manha.vendas : '-')}</td>
                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee', backgroundColor: '#fffbf0' }}>{linha.manha.sobras !== null ? linha.manha.sobras : '-'}</td>

                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee', backgroundColor: '#fff8f0' }}>{linha.tarde.producao !== null ? linha.tarde.producao : '-'}</td>
                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee', backgroundColor: '#fff8f0' }}>{vendasTarde !== null ? vendasTarde : (linha.tarde.vendas !== null ? linha.tarde.vendas : '-')}</td>
                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee', backgroundColor: '#fff8f0' }}>{linha.tarde.sobras !== null ? linha.tarde.sobras : '-'}</td>

                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee' }}>{sobraFinal > 0 ? sobraFinal : '-'}</td>
                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee' }}>{totalProd > 0 ? totalProd : '-'}</td>
                              <td style={{ padding: '10px', textAlign: 'center', borderRight: '1px solid #eee' }}>{totalVend > 0 ? totalVend : '-'}</td>

                              <td style={{ padding: '10px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', alignItems: 'center' }}>
                                  {linha.observacao && (
                                    <div 
                                      style={{ position: 'relative', display: 'inline-block' }}
                                      onMouseEnter={() => setHoverObs(idx)}
                                      onMouseLeave={() => setHoverObs(null)}
                                    >
                                      <span style={{ cursor: 'pointer', fontSize: '16px' }}>💬</span>
                                      {hoverObs === idx && (
                                        <div style={{
                                          position: 'absolute',
                                          bottom: '100%',
                                          left: '-100px',
                                          backgroundColor: aparencia.corPrimaria,
                                          color: 'white',
                                          padding: '10px',
                                          borderRadius: '5px',
                                          whiteSpace: 'normal',
                                          width: '250px',
                                          marginBottom: '10px',
                                          zIndex: 100,
                                          fontSize: '12px',
                                          lineHeight: '1.4',
                                          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                        }}>
                                          {linha.observacao}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <button
                                    onClick={() => iniciarEdicao(registros.find(r => r.data === linha.data && r.produto === linha.produto))}
                                    style={{
                                      padding: '5px 10px',
                                      backgroundColor: '#4CAF50',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer',
                                      fontSize: '12px',
                                    }}
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => deletarRegistro(registros.find(r => r.data === linha.data && r.produto === linha.produto).id)}
                                    style={{
                                      padding: '5px 10px',
                                      backgroundColor: '#f44336',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer',
                                      fontSize: '12px',
                                    }}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {editandoId !== null && (
                  <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                  }}>
                    <div style={{
                      backgroundColor: 'white',
                      padding: '30px',
                      borderRadius: '10px',
                      maxWidth: '500px',
                      width: '90%',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                    }}>
                      <h3 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>Editar Registro</h3>
                      
                      <div style={{ marginBottom: '15px' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Data</label>
                        <input
                          type="date"
                          value={editData.data}
                          onChange={(e) => setEditData({ ...editData, data: e.target.value })}
                          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                        />
                      </div>

                      <div style={{ marginBottom: '15px' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Tipo</label>
                        <select
                          value={editData.tipo}
                          onChange={(e) => setEditData({ ...editData, tipo: e.target.value })}
                          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                        >
                          <option value="producao">Produção</option>
                          <option value="vendas">Vendas</option>
                          <option value="sobras">Sobras</option>
                        </select>
                      </div>

                      <div style={{ marginBottom: '15px' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Quantidade</label>
                        <input
                          type="number"
                          value={editData.quantidade}
                          onChange={(e) => setEditData({ ...editData, quantidade: parseInt(e.target.value) })}
                          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
                        />
                      </div>

                      <div style={{ marginBottom: '15px' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Observação</label>
                        <textarea
                          value={editData.observacao}
                          onChange={(e) => setEditData({ ...editData, observacao: e.target.value })}
                          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box', minHeight: '60px', fontFamily: 'Arial' }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setEditandoId(null)}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: '#999',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                          }}
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={salvarEdicao}
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
                          Salvar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {abaAtiva === 'fluxo' && (
              <div>
                <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>📦 Fluxo de Mercadorias</h2>
                <div style={{
                  backgroundColor: '#f9f9f9',
                  padding: '40px',
                  borderRadius: '5px',
                  border: `2px dashed ${aparencia.corPrimaria}`,
                  textAlign: 'center',
                  color: '#999',
                }}>
                  <p style={{ fontSize: '18px', marginBottom: '10px' }}>🏗️ Em desenvolvimento</p>
                  <p>Campos para controle de fluxo de mercadorias serão adicionados em breve</p>
                </div>
              </div>
            )}

            {abaAtiva === 'estoque' && (
              <div>
                <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>🧊 Controle de Estoque</h2>
                <div style={{
                  backgroundColor: '#f9f9f9',
                  padding: '40px',
                  borderRadius: '5px',
                  border: `2px dashed ${aparencia.corPrimaria}`,
                  textAlign: 'center',
                  color: '#999',
                }}>
                  <p style={{ fontSize: '18px', marginBottom: '10px' }}>🏗️ Em desenvolvimento</p>
                  <p>Campos para controle de estoque serão adicionados em breve</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
