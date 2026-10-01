import Button from '../ui/Button';
import Input from '../ui/Input';
import estilosPagamentos from './pagamentos.module.css';

// Editor de 0..N descontos (tipo + valor) -- reutilizado por
// PagamentoPorHoraModal e PagamentoMensalModal (migrations 0065/0066).
// Controlado: quem usa é dono do array `descontos`, este componente só
// avisa `onAlterar`. "tipo" é texto livre nesta v1 (sem cadastro
// administrável de tipos de desconto) -- mesma decisão já registrada no
// schema (folha_pagamentos_descontos, migration 0065).
export default function EditorDescontos({ descontos, onAlterar }) {
  function atualizar(indice, campo, valor) {
    onAlterar(descontos.map((d, i) => (i === indice ? { ...d, [campo]: valor } : d)));
  }

  function adicionar() {
    onAlterar([...descontos, { tipo: '', valor: '', observacao: '' }]);
  }

  function remover(indice) {
    onAlterar(descontos.filter((_, i) => i !== indice));
  }

  return (
    <div className={estilosPagamentos.listaDescontos}>
      {descontos.map((desconto, indice) => (
        <div key={indice} className={estilosPagamentos.linhaDesconto}>
          <Input
            placeholder="Tipo do desconto"
            aria-label="Tipo do desconto"
            value={desconto.tipo}
            onChange={(e) => atualizar(indice, 'tipo', e.target.value)}
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="Valor"
            aria-label="Valor do desconto"
            value={desconto.valor}
            onChange={(e) => atualizar(indice, 'valor', e.target.value)}
          />
          <Input
            placeholder="Observação (opcional)"
            aria-label="Observação do desconto"
            value={desconto.observacao || ''}
            onChange={(e) => atualizar(indice, 'observacao', e.target.value)}
          />
          <Button type="button" variante="secondary" tamanho="sm" onClick={() => remover(indice)}>
            Remover
          </Button>
        </div>
      ))}
      <Button type="button" variante="secondary" tamanho="sm" icone="plus" onClick={adicionar}>
        Adicionar desconto
      </Button>
    </div>
  );
}
