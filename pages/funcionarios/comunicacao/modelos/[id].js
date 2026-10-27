import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../../../components/RequireAuth';
import PageShell from '../../../../components/shell/PageShell';
import FuncionariosSubNav from '../../../../components/funcionarios/FuncionariosSubNav';
import EditorModelo from '../../../../components/documentos/EditorModelo';
import { ROTA_MODELOS } from '../../../../components/documentos/ComunicacaoCabecalho';
import PageHeader from '../../../../components/ui/PageHeader';
import Alert from '../../../../components/ui/Alert';
import Button from '../../../../components/ui/Button';
import { PERMISSOES } from '../../../../lib/auth/permissoes';
import { listarModelos, salvarModelo } from '../../../../lib/documentos/consultas';
import { MODELO_VAZIO, formularioDoModelo, mensagemErroDocumento } from '../../../../lib/documentos/apresentacao';
import { chaveNomeModelo } from '../../../../lib/documentos/modelo';

// Folha > Comunicação > Modelos > Novo / Editar (migration 0077).
// /funcionarios/comunicacao/modelos/novo cria; /modelos/<id> edita (com a
// versão aberta -- se outra pessoa salvou antes, o banco recusa com
// modelo_alterado em vez de sobrescrever).
function EditorModeloConteudo() {
  const router = useRouter();
  const { id } = router.query;
  const novo = id === 'novo';
  const [modelo, setModelo] = useState(null);
  const [outrosNomes, setOutrosNomes] = useState(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!router.isReady) return undefined;
    let ativo = true;
    listarModelos()
      .then((lista) => {
        if (!ativo) return;
        const atual = novo ? null : lista.find((m) => m.id === id) || null;
        if (!novo && !atual) setErro('Modelo não encontrado.');
        setModelo(atual);
        setOutrosNomes(new Set(lista.filter((m) => m.id !== id).map((m) => chaveNomeModelo(m.nome))));
      })
      .catch((e) => ativo && setErro(mensagemErroDocumento(e)))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [router.isReady, id, novo]);

  async function salvar(payload, ativo) {
    await salvarModelo(payload, novo ? { ativo } : { id: modelo.id, versaoEsperada: modelo.versao, ativo });
    router.push(ROTA_MODELOS);
  }

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="comunicacao" />
      <PageHeader
        titulo={novo ? 'Novo modelo de documento' : `Editar modelo${modelo ? ` — ${modelo.nome}` : ''}`}
        acoes={<Button variante="secondary" href={ROTA_MODELOS}>← Voltar para modelos</Button>}
      />
      {carregando ? (
        <p role="status">Carregando...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : (
        <EditorModelo
          key={modelo ? `${modelo.id}-${modelo.versao}` : 'novo'}
          formInicial={modelo ? formularioDoModelo(modelo) : { ...MODELO_VAZIO, campos: [] }}
          modelo={modelo}
          outrosNomes={outrosNomes}
          onSalvar={salvar}
          onCancelar={() => router.push(ROTA_MODELOS)}
        />
      )}
    </PageShell>
  );
}

export default function EditorModeloPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_DOCUMENTOS_MODELOS}>
      <EditorModeloConteudo />
    </RequireAuth>
  );
}
