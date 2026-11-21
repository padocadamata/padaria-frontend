// node --test lib/importacoes/__tests__/vendor.test.mjs
// O SheetJS vem da fonte oficial, vendorizado e fixo: o build não depende
// de rede/registro, e qualquer troca do arquivo quebra este teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHA256 = '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8';

test('vendor/xlsx-0.20.3.tgz tem o hash conferido e o package.json aponta para ele', () => {
  const tgz = readFileSync(join(RAIZ, 'vendor', 'xlsx-0.20.3.tgz'));
  assert.equal(createHash('sha256').update(tgz).digest('hex'), SHA256);
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.xlsx, 'file:vendor/xlsx-0.20.3.tgz');
  assert.ok(readFileSync(join(RAIZ, 'vendor', 'README.md'), 'utf8').includes(SHA256), 'README registra o mesmo hash');
});

test('o pacote instalado é a 0.20.3, Apache-2.0, sem dependências', async () => {
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'node_modules', 'xlsx', 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.20.3');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.equal(pkg.scripts?.postinstall, undefined);
  assert.equal(pkg.scripts?.install, undefined);
});
