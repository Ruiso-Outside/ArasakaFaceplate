// Arasaka Faceplate (conversor) como módulo da Arasaka Central. A conversão acontece na tela (web/), com os codecs do
// próprio Chromium, WebGL e bibliotecas em JavaScript: nenhum .exe. Aqui ficam:
//   - o servidor de arquivos local (127.0.0.1, endereço com token): a tela lê arquivos de vários GB por HTTP com "Range";
//   - a gravação do resultado em pedaços, num arquivo .parcial que só ganha o nome final quando termina;
//   - as janelas de arquivo, as preferências, a Mídia da Central e as ferramentas da IA.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const formats = require("./web/js/formats.js");

// Pastas do usuário: no Linux seguem o idioma do sistema pelo user-dirs.dirs
function userDir(name) {
  const en = path.join(os.homedir(), name);
  if (process.platform !== "linux" || fs.existsSync(en)) return en;
  try {
    const cfg = fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "user-dirs.dirs"), "utf8");
    const m = new RegExp(`^XDG_${name.toUpperCase()}_DIR="(.+)"`, "m").exec(cfg);
    const d = m && m[1].replace(/^\$HOME/, os.homedir());
    if (d && path.isAbsolute(d)) return d;
  } catch { /* sem user-dirs.dirs */ }
  return en;
}

const MIME = { ...formats.MIME, bin: "application/octet-stream", mtl: "text/plain" };
// arquivos que um objeto 3D pode pedir ao lado dele (texturas, materiais, buffers) e nada além disso
const ASSETS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tga", "tif", "tiff", "mtl", "bin"]);
const MAX_ADD = 2000;
const extOf = (f) => path.extname(String(f)).slice(1).toLowerCase();

exports.activate = (ctx) => {
  const PREFS = path.join(ctx.dataDir, "prefs.json");
  const DEFAULTS = { outMode: "fixed", outDir: path.join(userDir("Documents"), "Arasaka Faceplate"), addToLibrary: true, notify: true, options: {}, lastTarget: {} };
  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PREFS, "utf8")) }; } catch { /* primeira vez */ }
  const lib = ctx.host.library || null;

  // ---------------------------------------------------------------- servidor de arquivos
  const token = crypto.randomBytes(16).toString("hex");
  const files = new Map(), byPath = new Map();
  let seq = 0, base = "";

  // textura ou material citado por um objeto 3D: no caminho pedido ou, se não existir (modelos guardam caminhos de outro
  // PC), pelo nome na pasta do modelo e até dois níveis abaixo. Nunca sai dessa pasta.
  function findAsset(model, rel) {
    const dir = path.dirname(model);
    const clean = rel.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== ".." && !p.includes(":"));
    const name = clean[clean.length - 1];
    if (!name || !ASSETS.has(extOf(name))) return null;
    const direct = path.join(dir, ...clean);
    try { if (fs.statSync(direct).isFile()) return direct; } catch { /* procura pelo nome */ }
    let budget = 3000;
    const walk = (d, depth) => {
      let list = [];
      try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
      const hit = list.find((e) => e.isFile() && e.name.toLowerCase() === name.toLowerCase());
      if (hit) return path.join(d, hit.name);
      if (depth >= 2) return null;
      for (const e of list) {
        if (--budget < 0) return null;
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        const r = walk(path.join(d, e.name), depth + 1);
        if (r) return r;
      }
      return null;
    };
    return walk(dir, 0);
  }

  const server = http.createServer((req, res) => {
    let file = null;
    try {
      const u = new URL(req.url, "http://127.0.0.1");
      const m = /^\/([0-9a-f]+)\/(m|a)\/(\d+)\/(.*)$/.exec(u.pathname);
      const src = m && m[1] === token ? files.get(Number(m[3])) : null;
      if (src) file = m[2] === "m" ? src : findAsset(src, u.searchParams.get("p") || "");
    } catch { /* endereço inválido */ }
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let st = null;
    try { st = file && fs.statSync(file); } catch { /* sumiu */ }
    if (!st) { res.writeHead(404, cors); return res.end(); }
    const head = { ...cors, "Accept-Ranges": "bytes", "Content-Type": MIME[extOf(file)] || "application/octet-stream", "Cache-Control": "no-store" };
    const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    let start = 0, end = st.size - 1, code = 200;
    if (r && (r[1] || r[2])) {
      start = r[1] ? Number(r[1]) : Math.max(0, st.size - Number(r[2]));
      end = r[1] && r[2] ? Math.min(Number(r[2]), st.size - 1) : st.size - 1;
      if (start >= st.size) { res.writeHead(416, { ...head, "Content-Range": `bytes */${st.size}` }); return res.end(); }
      code = 206; head["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
    }
    head["Content-Length"] = Math.max(0, end - start + 1);
    res.writeHead(code, head);
    if (req.method === "HEAD" || st.size === 0) return res.end();
    const s = fs.createReadStream(file, { start, end });
    s.on("error", () => res.destroy());
    s.pipe(res);
    res.on("close", () => s.destroy());
  });
  const ready = new Promise((ok) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}/${token}`; ok(); }));
  ctx.onStop(() => { server.close(); server.closeAllConnections(); });

  async function describe(file) {
    await ready;
    file = path.resolve(String(file));
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error("Não é um arquivo: " + path.basename(file));
    let id = byPath.get(file);
    if (!id) { id = ++seq; byPath.set(file, id); files.set(id, file); }
    const name = path.basename(file);
    return { path: file, name, size: st.size, url: `${base}/m/${id}/${encodeURIComponent(name)}`, assetBase: `${base}/a/${id}/` };
  }

  // arquivos e pastas (com subpastas) viram uma lista; de pastas entram só os formatos conhecidos
  async function expand(paths) {
    const out = []; let skipped = 0;
    const visit = async (p, explicit, depth) => {
      if (out.length >= MAX_ADD) { skipped++; return; }
      let st;
      try { st = fs.statSync(p); } catch { skipped++; return; }
      if (st.isDirectory()) {
        if (depth > 6) return;
        let names = [];
        try { names = fs.readdirSync(p); } catch { return; }
        for (const n of names.sort()) if (!n.startsWith(".")) await visit(path.join(p, n), false, depth + 1);
      } else if (formats.kindOf(p)) out.push(await describe(p));
      else if (explicit) skipped++;
    };
    for (const p of paths || []) await visit(path.resolve(String(p)), true, 0);
    return { files: out, skipped };
  }

  ctx.handle("pick-files", async () => {
    const list = formats.KINDS.map((k) => ({ name: k.label, extensions: k.inputs }));
    return expand(await ctx.host.openDialog({ title: "Escolher arquivos para converter", properties: ["openFile", "multiSelections"],
      filters: [{ name: "Todos os formatos", extensions: list.flatMap((g) => g.extensions) }, ...list] }));
  });
  ctx.handle("pick-folder", async () => expand(await ctx.host.openDialog({ title: "Escolher uma pasta para converter", properties: ["openDirectory"] })));
  ctx.handle("pick-library", async () => {
    if (!lib) throw new Error("Atualize a Arasaka Central para usar a Mídia");
    const items = await lib.pick({ kinds: ["image", "video", "audio"], multi: true, title: "Converter da Mídia" });
    return expand((items || []).map((i) => i.path));
  });
  ctx.handle("pick-out-dir", async () => {
    const d = await ctx.host.openDialog({ title: "Onde salvar os arquivos convertidos", defaultPath: prefs.outDir, properties: ["openDirectory", "createDirectory"] });
    return d && d[0] ? setPrefs({ outDir: d[0], outMode: "fixed" }) : null;
  });

  // ---------------------------------------------------------------- preferências
  function setPrefs(patch) {
    for (const k of Object.keys(patch || {})) if (k in DEFAULTS) prefs[k] = patch[k];
    try { fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 1)); } catch (e) { ctx.log("prefs", e); }
    return prefs;
  }
  ctx.handle("prefs", (patch) => (patch ? setPrefs(patch) : prefs));

  // ---------------------------------------------------------------- saída
  const outs = new Map(); // id -> { fd, tmp, file }
  const groups = new Map(); // id -> pasta própria (várias páginas, texturas...)
  const taken = new Set(); // nomes reservados por conversões em andamento
  const safe = (s) => String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").slice(0, 150) || "arquivo";
  function freePath(dir, name, ext) {
    const suffix = ext ? "." + ext : "";
    let f = path.join(dir, name + suffix);
    for (let i = 2; fs.existsSync(f) || taken.has(f.toLowerCase()); i++) f = path.join(dir, `${name} (${i})${suffix}`);
    return f;
  }
  const outDirFor = (o) => (o.outDir ? path.resolve(String(o.outDir)) : prefs.outMode === "same" && o.srcPath ? path.dirname(path.resolve(o.srcPath)) : prefs.outDir);

  ctx.handle("group-begin", (o) => {
    const dir = outDirFor(o);
    fs.mkdirSync(dir, { recursive: true });
    const g = freePath(dir, safe(o.name), "");
    fs.mkdirSync(g);
    const id = crypto.randomBytes(6).toString("hex");
    groups.set(id, g);
    return { id, path: g };
  });
  ctx.handle("out-begin", (o) => {
    const dir = o.group ? groups.get(o.group) : outDirFor(o);
    if (!dir) throw new Error("Pasta de saída inválida");
    fs.mkdirSync(dir, { recursive: true });
    const file = freePath(dir, safe(o.name), safe(o.ext));
    const tmp = file + ".parcial", id = crypto.randomBytes(6).toString("hex");
    outs.set(id, { fd: fs.openSync(tmp, "w"), tmp, file });
    taken.add(file.toLowerCase());
    return { id, path: file };
  });
  ctx.handle("out-write", (id, data, position) => {
    const o = outs.get(id);
    if (!o) throw new Error("A gravação foi cancelada");
    const buf = ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data);
    for (let done = 0; done < buf.length;) done += fs.writeSync(o.fd, buf, done, buf.length - done, (position || 0) + done);
    return true;
  });
  ctx.handle("out-end", (id) => {
    const o = outs.get(id);
    if (!o) throw new Error("A gravação foi cancelada");
    outs.delete(id);
    fs.closeSync(o.fd);
    taken.delete(o.file.toLowerCase());
    fs.renameSync(o.tmp, o.file);
    return { path: o.file, name: path.basename(o.file), size: fs.statSync(o.file).size };
  });
  function abort(id) {
    const o = outs.get(id);
    if (!o) return false;
    outs.delete(id); taken.delete(o.file.toLowerCase());
    try { fs.closeSync(o.fd); } catch { /* já fechado */ }
    try { fs.rmSync(o.tmp, { force: true }); } catch { /* em uso */ }
    return true;
  }
  ctx.handle("out-abort", (id) => abort(id));
  // grupo cancelado no meio: apaga a pasta que esta conversão criou (sempre nova, veja group-begin)
  ctx.handle("group-abort", (id) => {
    const g = groups.get(id);
    groups.delete(id);
    if (!g) return false;
    for (const [oid, o] of [...outs]) if (path.dirname(o.file) === g) abort(oid);
    fs.rmSync(g, { recursive: true, force: true });
    return true;
  });
  ctx.handle("group-end", (id) => groups.delete(id));
  ctx.onStop(() => { for (const id of [...outs.keys()]) abort(id); });

  // conversão pronta: entra na Mídia da Central (imagem, vídeo e áudio)
  ctx.handle("done", async (item) => {
    const kind = item && item.path ? formats.mediaKind(item.path) : null;
    if (!lib || !prefs.addToLibrary || !kind) return false;
    await lib.add([{ path: item.path, kind, title: path.basename(item.path, path.extname(item.path)), sub: ctx.t("Convertido"),
      duration: item.duration, width: item.width, height: item.height, tags: ["conversor"] }]).catch((e) => ctx.log("mídia", e));
    return true;
  });
  ctx.handle("busy", async (on) => { await ctx.host.keepAlive(!!on, "convertendo arquivos").catch(() => {}); return true; });
  let viewVisible = false;
  ctx.host.on("view-shown", () => { viewVisible = true; });
  ctx.host.on("view-hidden", () => { viewVisible = false; });
  ctx.handle("finished", async ({ ok, failed }) => {
    if (!prefs.notify || viewVisible) return false;
    const a = ok === 1 ? ctx.t("1 arquivo convertido") : ctx.t("{0} arquivos convertidos", ok);
    const b = !failed ? "" : failed === 1 ? ctx.t("1 falhou") : ctx.t("{0} falharam", failed);
    await ctx.host.notify("Conversão terminada", b ? a + " · " + b : a).catch(() => {});
    return true;
  });

  ctx.handle("show-item", (p) => ctx.host.showItem(p));
  ctx.handle("open-dir", (p) => { const d = p || prefs.outDir; fs.mkdirSync(d, { recursive: true }); return ctx.host.openPath(d); });
  ctx.handle("openers", (kind) => (ctx.host.openers ? ctx.host.openers(kind) : []));
  ctx.handle("open-in", (id, p) => ctx.host.openIn(id, { path: p }));

  // ---------------------------------------------------------------- tela pronta, "Abrir no Arasaka Faceplate" e IA
  let uiReady = false, waiting = [];
  const inbox = [], jobs = new Map();
  ctx.handle("ui-ready", async () => {
    // tela recarregada (troca de idioma, por exemplo): o que estava pela metade não continua
    for (const id of [...outs.keys()]) abort(id);
    await ctx.host.keepAlive(false).catch(() => {});
    for (const j of jobs.values()) j.fail(new Error("A tela do conversor foi recarregada"));
    uiReady = true;
    const w = waiting; waiting = [];
    w.forEach((f) => f());
    return { prefs, library: !!lib, inbox: inbox.splice(0) };
  });
  async function ensureUi() {
    if (uiReady) return;
    const wait = new Promise((ok, no) => { waiting.push(ok); setTimeout(() => no(new Error("A tela do Arasaka Faceplate não abriu")), 20000); });
    await ctx.host.focus();
    await wait;
  }
  ctx.host.on("open-file", async (f) => {
    try {
      const d = await describe(f.path);
      if (uiReady) ctx.emit("add-files", { files: [d], from: f.fromName }); else inbox.push(d);
    } catch (e) { ctx.log("abrir arquivo", e); }
  });

  ctx.handle("job-result", (id, results) => { const j = jobs.get(id); if (j) j.done(results); return !!j; });
  ctx.handle("tool:list_formats", () => Object.fromEntries(formats.KINDS.map((k) => [k.id, { label: k.label, inputs: k.inputs, outputs: k.outputs }])));
  ctx.handle("tool:convert_files", async (a) => {
    const to = formats.normalize(String(a.to || "").replace(/^\./, "").toLowerCase());
    const list = await expand(Array.isArray(a.paths) ? a.paths : [a.paths].filter(Boolean));
    if (!list.files.length) throw new Error("Nenhum arquivo que o conversor saiba abrir foi encontrado");
    for (const f of list.files) {
      const t = formats.targetsFor(f.name);
      if (!t.includes(to)) throw new Error(`${f.name} não pode virar ${to}. Formatos possíveis: ${t.join(", ")}`);
    }
    await ensureUi();
    const id = crypto.randomBytes(6).toString("hex");
    const result = new Promise((ok, no) => jobs.set(id, { done: ok, fail: no }));
    ctx.emit("tool-convert", { id, files: list.files, to, outDir: a.output_dir || null,
      options: { quality: a.quality, maxSize: a.max_size, height: a.max_size, fps: a.fps, start: a.start, end: a.end } });
    // a Central espera no máximo 5 minutos por uma ferramenta
    let timer;
    const slow = new Promise((ok) => { timer = setTimeout(ok, 4.5 * 60000, null); });
    try {
      const r = await Promise.race([result, slow]);
      return r ? { results: r, skipped: list.skipped || undefined } : "A conversão continua na tela do Arasaka Faceplate. Pasta de saída: " + (a.output_dir || prefs.outDir);
    } finally { clearTimeout(timer); jobs.delete(id); }
  });
};
