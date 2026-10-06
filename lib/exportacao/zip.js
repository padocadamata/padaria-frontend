// ZIP mínimo (método STORE, sem compressão) -- só o necessário para
// empacotar um .xlsx (que é um zip de XMLs). Sem dependência: os arquivos
// gerados pelo sistema são pequenos (dezenas de KB), compressão não faz
// diferença prática, e evitar uma biblioteca de zip mantém o bundle leve.
// Formato: PKWARE APPNOTE (local headers + central directory + EOCD).

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Data/hora DOS fixa (01/01/2026 00:00) -- conteúdo determinístico (mesmos
// dados = mesmo arquivo), e o .xlsx não depende dela.
const DOS_HORA = 0;
const DOS_DATA = ((2026 - 1980) << 9) | (1 << 5) | 1;

// arquivos: [{ caminho: 'xl/workbook.xml', conteudo: string | Uint8Array }]
export function criarZip(arquivos) {
  const encoder = new TextEncoder();
  const partes = [];
  const central = [];
  let deslocamento = 0;

  for (const arquivo of arquivos) {
    const nome = encoder.encode(arquivo.caminho);
    const dados = typeof arquivo.conteudo === 'string' ? encoder.encode(arquivo.conteudo) : arquivo.conteudo;
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versão necessária
    local.setUint16(6, 0x0800, true); // bit 11: nomes em UTF-8
    local.setUint16(8, 0, true); // STORE
    local.setUint16(10, DOS_HORA, true);
    local.setUint16(12, DOS_DATA, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, dados);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, DOS_HORA, true);
    cd.setUint16(14, DOS_DATA, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, dados.length, true);
    cd.setUint32(24, dados.length, true);
    cd.setUint16(28, nome.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(cd.buffer), nome);

    deslocamento += 30 + nome.length + dados.length;
  }

  const tamanhoCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);

  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const total = todas.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of todas) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}
