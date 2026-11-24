// Gera dist/piphin-module-conversor-X.Y.Z.zip (o arquivo do Release que a Central instala).
// Só usa o Node: a aba Desenvolvedor da Central roda este script com o próprio Electron, sem node_modules.
// A versão vem do package.json e é copiada para o module.json.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "module"), DIST = path.join(ROOT, "dist");
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const manifestFile = path.join(SRC, "module.json");
const text = fs.readFileSync(manifestFile, "utf8"), manifest = JSON.parse(text);
if (manifest.version !== version) fs.writeFileSync(manifestFile, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`));

// arquivos do módulo + dicionários prontos (i18n/<idioma>.json)
const files = [];
const walk = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name), r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) walk(p, r); else files.push([r, p]);
  }
};
walk(SRC, "");
const I18N = path.join(ROOT, "i18n");
if (fs.existsSync(I18N)) for (const f of fs.readdirSync(I18N).sort()) if (/^[a-z]{2}\.json$/.test(f)) files.push(["i18n/" + f, path.join(I18N, f)]);
for (const need of [manifest.main, manifest.ui, manifest.icon, "web/vendor/mediabunny.js", "web/vendor/three.js"]) if (!files.some(([r]) => r === need)) throw new Error("Falta no módulo: " + need);

// ---------------------------------------------------------------- .zip
const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const parts = [], central = [];
let offset = 0;
for (const [name, file] of files) {
  const raw = fs.readFileSync(file), z = zlib.deflateRawSync(raw, { level: 9 }), n = Buffer.from(name, "utf8"), crc = crc32(raw);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
  h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0x21, 14);
  c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
  parts.push(h, n, z); central.push(c, n);
  offset += h.length + n.length + z.length;
}
const cd = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, `piphin-module-conversor-${version}.zip`);
fs.writeFileSync(out, Buffer.concat([...parts, cd, end]));
console.log(`${path.relative(ROOT, out)} · ${files.length} arquivos · ${(fs.statSync(out).size / 1048576).toFixed(2)} MB`);
