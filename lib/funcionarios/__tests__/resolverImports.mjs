// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
//
// Os módulos de lib/funcionarios usam imports relativos SEM extensão
// (resolvidos pelo bundler do Next). Este hook só repete a resolução com
// ".js" quando o Node puro não encontra o arquivo -- nada muda no código
// de produção.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(especificador, contexto, proximo) {
    try {
      return proximo(especificador, contexto);
    } catch (erro) {
      if (especificador.startsWith('.') && !/\.[cm]?js$/.test(especificador)) {
        return proximo(`${especificador}.js`, contexto);
      }
      throw erro;
    }
  },
});
