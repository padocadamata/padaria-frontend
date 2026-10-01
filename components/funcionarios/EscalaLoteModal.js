import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { construirAplicacaoEmLote, detectarSobrescritas, rotuloDiaSemana } from '../../lib/funcionarios/escala';
import Modal from '../ui/Modal';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Field from '../ui/Field';
import Select from '../ui/Select';
import PeriodosEditor from './PeriodosEditor';
import IndicadorVinculo from './IndicadorVinculo';
import estilos from './escala.module.css';


function formatarDataCurta(dataYYYYMMDD) {
  const [, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}`;
}

// "Aplicar horário a vários dias selecionados" + "aplicar horário a vários
// funcionários" (seção 10/11 da arquitetura aprovada) -- UM único modal
// cobre as duas, já que são o mesmo produto cartesiano funcionário×data
// sobre o mesmo primitivo aplicar_escala_em_lote. Sempre exige uma etapa
// de revisão explícita antes de escrever -- se houver combinação já
// definida no destino, avisa quantas serão sobrescritas antes de permitir
// confirmar.
export default function EscalaLoteModal({ funcionarios, dias, mapaEscala, onFechar, onSalvo }) {
  const [funcionarioIds, setFuncionarioIds] = useState([]);
  const [datas, setDatas] = useState([]);
  const [tipoDia, setTipoDia] = useState('trabalho');
  const [periodos, setPeriodos] = useState([{ hora_inicio: '', hora_fim: '' }]);

  const [conflitos, setConflitos] = useState(null); // null = ainda não revisado
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function alternarFuncionario(id) {
    setConflitos(null);
    setFuncionarioIds((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  function alternarData(data) {
    setConflitos(null);
    setDatas((atual) => (atual.includes(data) ? atual.filter((x) => x !== data) : [...atual, data]));
  }

  function revisar() {
    setErro('');
    if (funcionarioIds.length === 0 || datas.length === 0) {
      setErro('Selecione pelo menos um funcionário e uma data.');
      return;
    }
    if (tipoDia === 'trabalho' && periodos.filter((p) => p.hora_inicio && p.hora_fim).length === 0) {
      setErro('Informe pelo menos um período de trabalho.');
      return;
    }
    setConflitos(detectarSobrescritas({ funcionarioIds, datas, mapaEscala }));
  }

  async function confirmar() {
    setSalvando(true);
    setErro('');
    const atribuicoes = construirAplicacaoEmLote({
      funcionarioIds,
      datas,
      tipoDia,
      periodos: periodos.filter((p) => p.hora_inicio && p.hora_fim),
    });
    const supabase = createClient();
    const { error } = await supabase.rpc('aplicar_escala_em_lote', { p_atribuicoes: atribuicoes });
    setSalvando(false);
    if (error) {
      // Protecao K (migration 0066) -- a RPC ja devolve a mensagem exata,
      // pronta para o usuario. Repassa verbatim em vez do fallback
      // generico abaixo (mesmo tratamento de EscalaDiaModal.js).
      if (error.message?.includes('já possui pagamento confirmado')) {
        setErro(error.message);
        return;
      }
      console.error('Erro ao aplicar escala em lote:', error);
      setErro('Não foi possível aplicar. Verifique se algum dia selecionado já tem falta/atestado registrado e tente novamente.');
      return;
    }
    onSalvo();
  }

  return (
    <Modal titulo="Aplicar em lote" onFechar={onFechar} largura="md">
      <div className={estilos.modalCorpo}>
        <Field label="Funcionários">
          <div className={estilos.selecaoFuncionarios}>
            {funcionarios.map((f) => (
              <Checkbox
                key={f.id}
                rotulo={<>{f.nome}<IndicadorVinculo tipoVinculo={f.tipo_vinculo} /></>}
                checked={funcionarioIds.includes(f.id)}
                onChange={() => alternarFuncionario(f.id)}
              />
            ))}
          </div>
        </Field>

        <Field label="Dias (semana em exibição)">
          <div className={estilos.selecaoFuncionarios}>
            {dias.map((data) => (
              <Checkbox
                key={data}
                rotulo={`${rotuloDiaSemana(data)} ${formatarDataCurta(data)}`}
                checked={datas.includes(data)}
                onChange={() => alternarData(data)}
              />
            ))}
          </div>
        </Field>

        <Field label="Planejamento">
          <Select
            value={tipoDia}
            onChange={(e) => {
              setTipoDia(e.target.value);
              setConflitos(null);
            }}
          >
            <option value="trabalho">Trabalho</option>
            <option value="folga">Folga</option>
          </Select>
        </Field>

        {tipoDia === 'trabalho' && (
          <PeriodosEditor
            periodos={periodos}
            onAlterar={(p) => {
              setPeriodos(p);
              setConflitos(null);
            }}
            podeEditar
          />
        )}

        {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

        {conflitos && conflitos.length > 0 && (
          <Alert tom="warning" className={estilos.mensagem}>
            Isto vai SOBRESCREVER a escala já existente em {conflitos.length} combinação(ões) de funcionário/dia. Confirma?
          </Alert>
        )}

        <div className={estilos.rodapePlanejamento}>
          {conflitos === null ? (
            <Button type="button" onClick={revisar}>Revisar</Button>
          ) : (
            <Button type="button" onClick={confirmar} disabled={salvando}>
              {salvando ? 'Aplicando...' : conflitos.length > 0 ? 'Confirmar e sobrescrever' : 'Aplicar'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
