import { useEffect, useState } from 'react';
import RequireAuth from '../../../components/RequireAuth';
import PageShell from '../../../components/shell/PageShell';
import FuncionariosSubNav from '../../../components/funcionarios/FuncionariosSubNav';
import { ROTA_MODELOS } from '../../../components/documentos/ComunicacaoCabecalho';
import PageHeader from '../../../components/ui/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import estilos from '../../../components/documentos/documentos.module.css';
import { PERMISSOES } from '../../../lib/auth/permissoes';
import { carregarConfig, salvarConfig } from '../../../lib/documentos/consultas';
import { normalizarCnpjConfig } from '../../../lib/documentos/config';
import { formatarCnpj } from '../../../lib/documentos/formatacao';
import { formatarMomento, mensagemErroDocumento } from '../../../lib/documentos/apresentacao';

// Folha > Comunicação > Dados da empresa (linha única
// folha_documentos_config, migration 0077). Tudo opcional para salvar; a
// EMISSÃO exige a razão social (e cidade/UF ou responsável quando o modelo
// usa). CNPJ aceita máscara; a tela avisa antes (mesma regra), o banco
// confere os dígitos verificadores e grava só os 14 dígitos. Alterar aqui
// não muda documento já emitido (snapshot).
const CAMPOS = [
  { chave: 'nome_fantasia', rotulo: 'Nome fantasia', max: 120, dica: 'Aparece no cabeçalho do documento.' },
  { chave: 'razao_social', rotulo: 'Razão social', max: 160, dica: 'Obrigatória para emitir qualquer documento.' },
  { chave: 'cnpj', rotulo: 'CNPJ', max: 18, dica: 'Com ou sem pontuação.' },
  { chave: 'endereco', rotulo: 'Endereço', max: 300 },
  { chave: 'cidade_uf', rotulo: 'Cidade/UF', max: 120, dica: 'Usada no “local e data” (ex.: Belo Horizonte/MG).' },
  { chave: 'responsavel_nome', rotulo: 'Responsável', max: 120, dica: 'Assina pela empresa.' },
  { chave: 'responsavel_cargo', rotulo: 'Cargo do responsável', max: 120 },
];

const VAZIO = Object.fromEntries(CAMPOS.map((c) => [c.chave, '']));

function paraFormulario(config) {
  const f = { ...VAZIO };
  for (const c of CAMPOS) f[c.chave] = config?.[c.chave] || '';
  if (f.cnpj) f.cnpj = formatarCnpj(f.cnpj);
  return f;
}

function EmpresaConteudo() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  async function carregar() {
    setCarregando(true);
    try {
      const c = await carregarConfig();
      setConfig(c);
      setForm(paraFormulario(c));
    } catch (e) {
      setErro(mensagemErroDocumento(e));
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  const cnpj = normalizarCnpjConfig(form.cnpj);
  const erroCnpj = cnpj.erros[0]?.mensagem;

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    setAviso('');
    if (erroCnpj) return;
    setSalvando(true);
    try {
      await salvarConfig({ ...form, cnpj: cnpj.cnpj });
      setAviso('Dados da empresa salvos. Valem para os próximos documentos — os já emitidos não mudam.');
      await carregar();
    } catch (err) {
      setErro(mensagemErroDocumento(err));
    }
    setSalvando(false);
  }

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="comunicacao" />
      <PageHeader
        titulo="Dados da empresa"
        subtitulo="Cabeçalho e assinatura institucional dos documentos de RH."
        acoes={<Button variante="secondary" href={ROTA_MODELOS}>← Voltar para modelos</Button>}
      />
      {carregando ? (
        <p role="status">Carregando...</p>
      ) : (
        <form className={estilos.formulario} onSubmit={salvar} noValidate>
          {!config?.razao_social && <Alert tom="warning">Sem razão social nenhum documento pode ser emitido.</Alert>}
          <Card>
            <div className={estilos.grade2}>
              {CAMPOS.map((c) => (
                <Field key={c.chave} label={c.rotulo} dica={c.chave === 'cnpj' && erroCnpj ? undefined : c.dica} erro={c.chave === 'cnpj' ? erroCnpj : undefined}>
                  <Input
                    value={form[c.chave]}
                    maxLength={c.max}
                    inputMode={c.chave === 'cnpj' ? 'numeric' : undefined}
                    onChange={(ev) => setForm((f) => ({ ...f, [c.chave]: ev.target.value }))}
                    onBlur={c.chave === 'cnpj' && cnpj.cnpj ? () => setForm((f) => ({ ...f, cnpj: formatarCnpj(cnpj.cnpj) })) : undefined}
                  />
                </Field>
              ))}
            </div>
            {(aviso || erro) && (
              <div className={estilos.mensagensCard}>
                {aviso && <Alert tom="success">{aviso}</Alert>}
                {erro && <Alert tom="danger">{erro}</Alert>}
              </div>
            )}
            {/* Rodapé do card, no fluxo do formulário (padrão dos formulários da Folha). */}
            <div className={estilos.rodapeCard}>
              {config?.atualizado_em && (
                <p className={estilos.secundario}>
                  Última alteração: {formatarMomento(config.atualizado_em)}{config.atualizado_por_nome ? ` por ${config.atualizado_por_nome}` : ''}.
                </p>
              )}
              <Button type="submit" disabled={salvando || Boolean(erroCnpj)}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </Card>
        </form>
      )}
    </PageShell>
  );
}

export default function EmpresaPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_DOCUMENTOS_MODELOS}>
      <EmpresaConteudo />
    </RequireAuth>
  );
}
