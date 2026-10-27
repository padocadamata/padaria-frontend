import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { LIMITE_CARACTERES_VALOR } from '../../lib/documentos/apresentacao';

// Uma pergunta do formulário de emissão, pelo TIPO do campo do modelo.
// Só entrada: a validação é a do núcleo (validarValores) e, na emissão, a
// do banco. Data com papel "data da ocorrência" não aceita futuro (max).
export default function CampoValor({ campo, valor, onMudar, erro, hoje }) {
  const rotulo = `${campo.rotulo}${campo.obrigatorio ? ' *' : ''}`;
  const comum = { value: valor ?? '', onChange: (e) => onMudar(e.target.value), 'aria-invalid': erro ? true : undefined };
  let controle;
  if (campo.tipo === 'texto_longo') {
    controle = <Textarea rows={5} maxLength={LIMITE_CARACTERES_VALOR.texto_longo} {...comum} />;
  } else if (campo.tipo === 'data') {
    controle = <Input type="date" max={campo.papel === 'data_ocorrencia' ? hoje : undefined} {...comum} />;
  } else if (campo.tipo === 'selecao') {
    controle = (
      <Select {...comum}>
        <option value="">Selecione…</option>
        {campo.opcoes.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Select>
    );
  } else if (campo.tipo === 'numero') {
    controle = <Input inputMode="decimal" {...comum} />;
  } else {
    controle = <Input maxLength={LIMITE_CARACTERES_VALOR.texto} {...comum} />;
  }
  return (
    <Field label={rotulo} dica={campo.dica} erro={erro}>
      {controle}
    </Field>
  );
}
