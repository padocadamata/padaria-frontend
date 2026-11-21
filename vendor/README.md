# Dependências vendorizadas

## xlsx-0.20.3.tgz (SheetJS Community Edition 0.20.3)

Leitor de planilhas usado **somente no navegador** pela Central de Importações
do G3ERP (migration 0081), para ler os relatórios `.xlsx` exportados do G3.

- **Origem oficial:** https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  (a versão do registro npm, 0.18.5, está desatualizada e tem falhas de
  segurança conhecidas; a SheetJS distribui as versões corrigidas só pelo
  próprio CDN).
- **Licença:** Apache-2.0 (arquivo `package/LICENSE` dentro do pacote).
- **Dependências:** nenhuma; nenhum script de instalação.
- **SHA-256 do .tgz:** `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- **Integridade npm (sha512):** `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`
- **Conferência cruzada:** o MD5 de `package/dist/xlsx.full.min.js`
  (`6b3130af1ceadf07caa0ec08af7addff`) é o publicado na documentação da SheetJS.

O `package.json` aponta para este arquivo (`"xlsx": "file:vendor/xlsx-0.20.3.tgz"`),
então o build não depende da rede nem de registro externo, e o conteúdo é
sempre o mesmo. O teste `lib/importacoes/__tests__/vendor.test.mjs` falha se o
hash do arquivo mudar.

**Para atualizar:** baixe a nova versão do CDN oficial, confira a licença e as
dependências, atualize o hash aqui e no teste, e rode os testes de leitura com
os arquivos reais do G3 (localmente, nunca versionados).
