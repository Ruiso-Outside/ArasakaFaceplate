// Teste de ponta a ponta: roda o módulo no ModuleHost de verdade da Arasaka Central (clone do repositório), com pastas
// temporárias, cria arquivos de exemplo na própria página e converte cada um para todos os formatos possíveis.
// Uso: npx electron --disable-gpu-sandbox test/run.js <pasta do clone da ArasakaCentral> [filtro, ex.: image/webp] [--shots pasta] [--show]
const { app, BrowserWindow, protocol, net } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const args = process.argv.slice(2).filter((a) => a !== "." && !/run\.js$/.test(a));
const CENTRAL = path.resolve(args.find((a) => !a.startsWith("--")) || "");
const FILTER = args.filter((a) => !a.startsWith("--")).slice(1).find((a) => a.includes("/") && !path.isAbsolute(a)) || "";
const SHOTS = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : null;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "faceplate-test-"));
app.setPath("userData", path.join(TMP, "userdata"));
protocol.registerSchemesAsPrivileged([{ scheme: "piphin", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const log = (...a) => console.log(...a);
let failed = 0, passed = 0;
const check = (name, ok, extra = "") => { if (ok) passed++; else failed++; log((ok ? "  ok    " : "  FALHA ") + name + (extra ? "  " + extra : "")); };

app.whenReady().then(async () => {
  const limit = setTimeout(() => { log("tempo esgotado"); app.exit(2); }, 8 * 60000);
  try { await main(); } catch (e) { log("ERRO", e); failed++; }
  clearTimeout(limit);
  log(`\n${passed} ok, ${failed} falhas`);
  if (failed) log("arquivos em", TMP); else try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* em uso */ }
  app.exit(failed ? 1 : 0);
});

async function main() {
  const { ModuleHost } = require(path.join(CENTRAL, "lib", "modules.js"));
  const { MediaLibrary } = require(path.join(CENTRAL, "lib", "library.js"));
  const { ToolsServer } = require(path.join(CENTRAL, "lib", "tools-server.js"));
  const { nativeImage } = require("electron");
  const version = require(path.join(CENTRAL, "package.json")).version;

  protocol.handle("piphin", (req) => {
    const u = new URL(req.url), f = path.join(CENTRAL, "web", "ui", path.normalize(u.pathname));
    return fs.existsSync(f) ? net.fetch(pathToFileURL(f).href) : new Response("", { status: 404 });
  });
  const win = new BrowserWindow({ width: 1280, height: 820, show: args.includes("--show") || !!SHOTS, backgroundColor: "#050505" });
  await win.loadURL("about:blank");
  const modulesDir = path.join(TMP, "modules");
  fs.cpSync(process.env.FP_MODULE || path.join(__dirname, "..", "module"), path.join(modulesDir, "conversor"), { recursive: true });
  const host = new ModuleHost({ dir: modulesDir, dataDir: path.join(TMP, "data"), logDir: path.join(TMP, "logs"), hubVersion: version, getWindow: () => win });
  if (process.env.FP_LANG) host.lang = process.env.FP_LANG;
  host.library = new MediaLibrary({ file: path.join(TMP, "midia.json"), nativeImage });
  host.insetLeft = 0;
  host.on("focus", (id) => host.show(id));
  const outDir = path.join(TMP, "saida"), samples = path.join(TMP, "exemplos");
  fs.mkdirSync(samples); fs.mkdirSync(path.join(TMP, "data", "conversor"), { recursive: true });
  fs.writeFileSync(path.join(TMP, "data", "conversor", "prefs.json"), JSON.stringify({ outDir }));

  await host.start("conversor");
  check("motor iniciou", host.status()[0].state === "running", host.status()[0].error || "");
  await host.show("conversor");
  const m = host.mods.get("conversor"), wc = m.view.webContents;
  const errors = [];
  wc.on("console-message", (e) => { if (e.level === "error" || e.level === "warning") errors.push(`${e.level}: ${e.message}`.slice(0, 300)); });
  const js = (code) => wc.executeJavaScript(code, true);
  await js(`new Promise((ok, no) => { const t = Date.now(); (function w() { window.FP && FP.ready ? ok() : Date.now() - t > 15000 ? no(new Error("tela não ficou pronta")) : setTimeout(w, 50); })(); })`);
  check("tela pronta", true);

  // ---------------------------------------------------------------- arquivos de exemplo, criados na própria página
  const put = (name, data) => fs.writeFileSync(path.join(samples, name), typeof data === "string" ? data : Buffer.from(data));
  const b64 = async (code) => Buffer.from(await js(`(async () => { const r = await (${code})(); const b = r instanceof Blob ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array(r); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); })()`), "base64");
  const CANVAS = `const c = new OffscreenCanvas(640, 400), x = c.getContext("2d"); const g = x.createLinearGradient(0,0,640,400); g.addColorStop(0,"#ff0000"); g.addColorStop(1,"#0040ff"); x.fillStyle = g; x.beginPath(); x.arc(320,200,190,0,7); x.fill(); x.fillStyle = "#fff"; x.font = "60px sans-serif"; x.fillText("Faceplate", 180, 220);`;
  for (const t of ["png", "jpg", "webp", "bmp", "tga", "tiff", "ico"]) put("foto." + t, await b64(`async () => { ${CANVAS} return FP.encodeImage(c, "${t}", { quality: 90, background: "#ffffff" }); }`));
  put("anim.gif", await b64(`async () => { const g = await FP.gifWriter(); for (let i = 0; i < 12; i++) { const c = new OffscreenCanvas(160, 120), x = c.getContext("2d"); x.fillStyle = "#101010"; x.fillRect(0,0,160,120); x.fillStyle = "#f00"; x.fillRect(i*10, 40, 40, 40); g.add(c, 80); } return g.finish(); }`));
  put("logo.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 2h48l6 6v48l-6 6H8l-6-6V8z" fill="#0a0a0c" stroke="#e3121f" stroke-width="2"/></svg>');
  const av = (fmt, vc, ac) => `async () => { await FP.vendor("mediabunny"); const MB = Mediabunny; const out = new MB.Output({ format: new MB.${fmt}(), target: new MB.BufferTarget() });
    const c = new OffscreenCanvas(640, 360), x = c.getContext("2d"); let vs, as;
    ${vc ? `vs = new MB.CanvasSource(c, { codec: "${vc}", bitrate: 1e6 }); out.addVideoTrack(vs, { frameRate: 30 });` : ""}
    ${ac ? `as = new MB.AudioBufferSource({ codec: "${ac}", bitrate: 128000 }); out.addAudioTrack(as);` : ""}
    await out.start();
    ${vc ? `for (let i = 0; i < 60; i++) { x.fillStyle = "#200"; x.fillRect(0,0,640,360); x.fillStyle = "#f33"; x.fillRect(i*8, 100, 120, 120); await vs.add(i/30, 1/30); }` : ""}
    ${ac ? `const b = new AudioBuffer({ length: 96000, sampleRate: 48000, numberOfChannels: 2 }); for (let k = 0; k < 2; k++) { const d = b.getChannelData(k); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 440 * 2 * Math.PI / 48000) * 0.3; } await as.add(b);` : ""}
    await out.finalize(); return out.target.buffer; }`;
  put("video.mp4", await b64(av("Mp4OutputFormat", "avc", "aac")));
  put("video.webm", await b64(av("WebMOutputFormat", "vp9", "opus")));
  put("video.mkv", await b64(av("MkvOutputFormat", "avc", "opus")));
  put("video.mov", await b64(av("MovOutputFormat", "avc", "aac")));
  put("video.ts", await b64(av("MpegTsOutputFormat", "avc", "aac")));
  put("mudo.mp4", await b64(av("Mp4OutputFormat", "avc", null)));
  put("som.wav", await b64(av("WavOutputFormat", null, "pcm-s16")));
  put("som.m4a", await b64(av("Mp4OutputFormat", null, "aac")));
  put("som.ogg", await b64(av("OggOutputFormat", null, "opus")));
  // cubo com textura: OBJ + MTL + PNG em subpasta, com o caminho de "outro PC" dentro do MTL
  const tex = await b64(`async () => { const c = new OffscreenCanvas(64, 64), x = c.getContext("2d"); x.fillStyle = "#f00"; x.fillRect(0,0,64,64); x.fillStyle = "#0f0"; x.fillRect(0,0,32,32); return c.convertToBlob({ type: "image/png" }); }`);
  fs.mkdirSync(path.join(samples, "texturas")); put("texturas/Parede.png", tex);
  put("cubo.mtl", "newmtl parede\nKd 1 1 1\nmap_Kd C:\\\\Users\\\\outro\\\\Parede.png\n\nnewmtl azul\nKd 0 0 1\n");
  const V = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0], [0, 0, 3], [2, 0, 3], [2, 1, 3], [0, 1, 3]], Q = [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [3, 4, 8, 7], [2, 3, 7, 6], [1, 5, 8, 4]];
  put("cubo.obj", `mtllib cubo.mtl\no cubo\n${V.map((v) => "v " + v.join(" ")).join("\n")}\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl parede\n${Q.slice(0, 3).map((q) => `f ${q.map((i, k) => i + "/" + (k + 1)).join(" ")}`).join("\n")}\nusemtl azul\n${Q.slice(3).map((q) => `f ${q.map((i, k) => i + "/" + (k + 1)).join(" ")}`).join("\n")}\n`);
  put("nuvem.ply", "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n");
  put("lista.csv", "nome;preço;ativo\r\n\"Silva; João\";10.5;true\r\nÇedilha;2;false\r\n");
  put("dados.json", JSON.stringify({ itens: [{ id: 1, nome: "A & B", tags: ["x", "y"] }, { id: 2, nome: "C", extra: { cor: "azul" } }] }));
  put("config.yaml", "titulo: Teste\nlista:\n  - a\n  - b\n");
  put("doc.xml", "<?xml version=\"1.0\"?><raiz><item id=\"1\">um</item><item id=\"2\">dois</item></raiz>");
  put("leia.md", "# Título\n\nTexto com **negrito** e `código`.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  put("fala.srt", "1\r\n00:00:01,000 --> 00:00:02,500\r\nOlá <i>mundo</i>\r\nsegunda linha\r\n\r\n2\r\n01:00:03,000 --> 01:00:04,000\r\nFim\r\n");
  const winFont = path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "arial.ttf");
  if (fs.existsSync(winFont)) fs.copyFileSync(winFont, path.join(samples, "fonte.ttf"));

  // amostras reais (HEIC, FBX, 3DS...): pasta em FP_EXTRA
  if (process.env.FP_EXTRA) for (const n of fs.readdirSync(process.env.FP_EXTRA)) fs.copyFileSync(path.join(process.env.FP_EXTRA, n), path.join(samples, n));

  // ---------------------------------------------------------------- converter tudo para tudo
  const F = require("../module/web/js/formats.js");
  const convert = async (file, to, options = {}) => {
    const r = await host.callTool("conversor", "convert_files", { paths: [].concat(file).map((f) => path.join(samples, f)), to, output_dir: path.join(outDir, to), ...options });
    if (typeof r === "string") throw new Error(r);
    return r.results;
  };
  const magic = { png: "89504e47", jpg: "ffd8ff", webp: "52494646", gif: "47494638", bmp: "424d", tiff: ["49492a00", "4d4d002a"], ico: "00000100", pdf: "25504446", mp4: ["", "66747970"], mov: ["", "66747970"], m4a: ["", "66747970"],
    webm: "1a45dfa3", mkv: "1a45dfa3", mp3: ["494433", "fff", "ff"], wav: "52494646", ogg: "4f676753", flac: "664c6143", glb: "676c5446", "3mf": "504b0304", usdz: "504b0304", woff: "774f4646", ply: "706c79", ttf: "00010000" };
  const looksRight = (f, to) => { const b = fs.readFileSync(f), hex = b.subarray(0, 16).toString("hex"); return b.length > 0 && (!magic[to] || [].concat(magic[to]).some((x) => (x ? hex.startsWith(x) || hex.slice(8).startsWith(x) : false))); };
  const main1 = (p, to) => (fs.statSync(p).isDirectory() ? path.join(p, fs.readdirSync(p).find((n) => n.endsWith("." + to))) : p);

  for (const name of fs.readdirSync(samples).filter((n) => F.kindOf(n)).sort()) {
    for (const to of F.targetsFor(name)) {
      if (FILTER && !`${F.kindOf(name)}/${to}`.includes(FILTER) && !`${name}/${to}`.includes(FILTER)) continue;
      const expectFail = (name === "mudo.mp4" && F.kind("audio").outputs.includes(to)) || (name === "nuvem.ply" && ["obj", "stl", "3mf", "usdz"].includes(to));
      try {
        const [r] = await convert(name, to, name.startsWith("video") && to === "gif" ? { max_size: 120, fps: 8 } : {});
        if (expectFail) { check(`${name} -> ${to} recusa com aviso`, r.status === "error" && !!r.error, r.error || r.status); continue; }
        const out = r.output && main1(r.output, to), ok = r.status === "done" && out && (to === "ttf" || to === "otf" || looksRight(out, to));
        check(`${name} -> ${to}`, ok, ok ? `${fs.statSync(out).size} B${r.notes ? "  aviso: " + r.notes.join("; ") : ""}` : r.error || JSON.stringify(r));
      } catch (e) { check(`${name} -> ${to}`, false, e.message); }
    }
  }
  if (!FILTER) await details({ host, js, wc, samples, outDir, convert, put, b64, ToolsServer, version, errors });
  // erros esperados (arquivo ruim, formato impossível) também vão para o console: aqui só interessa o que é defeito do código
  const bad = errors.filter((e) => /Content Security|Refused|Uncaught|Unhandled|TypeError|ReferenceError|RangeError/i.test(e));
  check("sem erros no console da página", !bad.length, [...new Set(bad)].slice(0, 8).join("\n        "));
  const leftovers = fs.existsSync(outDir) ? fs.readdirSync(outDir, { recursive: true }).filter((f) => String(f).endsWith(".parcial")) : [];
  check("nenhum arquivo .parcial sobrou", !leftovers.length, leftovers.join(", "));
  if (SHOTS) await shots({ host, js, wc, samples, convert });
  await host.stopAll();
}

// ---------------------------------------------------------------- o conteúdo está certo?
async function details({ host, js, samples, outDir, convert, put, ToolsServer, version }) {
  const read = (to, name) => fs.readFileSync(path.join(outDir, to, name), "utf8");
  const inPage = (p, code) => { const d = fs.readFileSync(p).toString("base64"); return js(`(async () => { const s = atob("${d}"), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); const f = new File([b], ${JSON.stringify(path.basename(p))}); const src = new FP.Source({ name: f.name, size: f.size, file: f }); return (${code})(src, b); })()`); };
  log("\nconteúdo");
  check("CSV -> JSON com tipos e aspas", JSON.stringify(JSON.parse(read("json", "lista.json"))[0]) === JSON.stringify({ nome: "Silva; João", "preço": 10.5, ativo: true }), read("json", "lista.json").slice(0, 80));
  check("JSON -> CSV achata e acha a lista", read("csv", "dados.csv").startsWith("\ufeffid;nome;tags;extra.cor"), read("csv", "dados.csv").slice(0, 60));
  check("JSON -> XML escapa &", /A &amp; B/.test(read("xml", "dados.xml")));
  check("XML -> JSON com atributos", JSON.parse(read("json", "doc.json")).raiz.item[1]["@id"] === "2");
  check("MD -> HTML", /<h1[^>]*>Título<\/h1>/.test(read("html", "leia.html")) && /<table>/.test(read("html", "leia.html")));
  check("SRT -> VTT", /00:00:01\.000 --> 00:00:02\.500\nOlá <i>mundo<\/i>/.test(read("vtt", "fala.vtt")));
  check("SRT -> ASS com hora e itálico", /Dialogue: 0,1:00:03\.00,1:00:04\.00/.test(read("ass", "fala.ass")) && /\{\\i1\}mundo\{\\i0\}\\Nsegunda/.test(read("ass", "fala.ass")));
  fs.copyFileSync(path.join(outDir, "ass", "fala.ass"), path.join(samples, "volta.ass"));
  check("ASS -> SRT ida e volta", (await convert("volta.ass", "srt"))[0].status === "done" && read("srt", "volta.srt").replace(/\s+/g, " ") === fs.readFileSync(path.join(samples, "fala.srt"), "utf8").replace(/^/, "\ufeff").replace(/\s+/g, " "));
  for (const t of ["jpg", "webp", "bmp", "tiff", "tga", "ico", "png"]) {
    const [one] = await convert("foto.png", t, { output_dir: path.join(outDir, "cores") });
    const px = await inPage(one.output, `async (src) => { const c = (await FP.decodeImage(src))[0]; const d = c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return [c.width, c.height, ...d]; }`).catch((e) => [e.message]);
    check(`imagem ${t} reabre com as cores certas`, t === "ico" ? px[0] > 0 && px.length === 6 : px[0] === 640 && px[1] === 400 && px[5] === 255, JSON.stringify(px));
  }
  const trans = await inPage(path.join(outDir, "jpg", "foto.jpg"), `async (src) => [...(await FP.decodeImage(src))[0].getContext("2d").getImageData(2, 2, 1, 1).data]`);
  check("transparência vira fundo branco no JPG", trans[0] > 245 && trans[1] > 245 && trans[2] > 245, JSON.stringify(trans));
  const [small] = await convert("foto.png", "webp", { max_size: 100, quality: 50 });
  check("redimensiona para 100 px", (await inPage(small.output, `async (src) => (await FP.decodeImage(src))[0].width`)) === 100);
  check("nome repetido não sobrescreve", /\(\d\)\.webp$/.test(small.output), path.basename(small.output));
  const pdf = await convert(["foto.png", "foto.jpg", "logo.svg"], "pdf");
  const pages = await inPage(pdf[0].output, `async (src) => { const p = await FP.openPdf(src); return p.numPages; }`);
  check("3 imagens viram um PDF de 3 páginas", pages === 3 && new Set(pdf.map((p) => p.output)).size === 1, String(pages));
  fs.copyFileSync(pdf[0].output, path.join(samples, "album.pdf"));
  const [pp] = await convert("album.pdf", "png");
  check("PDF -> PNG numa pasta, uma imagem por página", pp.status === "done" && fs.statSync(pp.output).isDirectory() && fs.readdirSync(pp.output).length === 3, pp.error || fs.readdirSync(pp.output).join(", "));
  const [noText] = await convert("album.pdf", "txt");
  check("PDF sem texto avisa", noText.status === "error", noText.error);
  put("texto.pdf", "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 40 100 Td (Ola Faceplate) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>");
  const [pt] = await convert("texto.pdf", "txt");
  check("PDF -> TXT", pt.status === "done" && /Ola Faceplate/.test(fs.readFileSync(pt.output, "utf8")), pt.error);

  const probe = (p) => inPage(p, `async (src) => FP.probe(src)`);
  const a = await probe(path.join(outDir, "webm", "video.webm"));
  check("MP4 -> WebM: duração, tamanho e codecs", Math.abs(a.duration - 2) < 0.15 && a.width === 640 && /vp|av1/.test(a.vcodec) && a.acodec === "opus", JSON.stringify(a));
  const [cut] = await convert("video.mp4", "mp4", { start: 0.5, end: 1.5, max_size: 180 }), c = await probe(cut.output);
  check("corte e resolução", Math.abs(c.duration - 1) < 0.15 && c.height === 180 && c.width === 320, JSON.stringify(c));
  const [badCut] = await convert("video.mp4", "mp4", { start: 99 });
  check("corte fora do vídeo avisa", badCut.status === "error", badCut.error);
  const [tr] = await convert("som.wav", "mp3", { start: 0.5, end: 1 }), ta = await probe(tr.output);
  check("corte de áudio", Math.abs(ta.duration - 0.5) < 0.12, JSON.stringify(ta));

  const model = (p) => inPage(p, `async (src) => { const r = await FP.loadModel(src); const s = new Three.Box3().setFromObject(r.root).getSize(new Three.Vector3()); let map = 0, mats = new Set(); r.root.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) { mats.add(m.name); if (m.map) map++; } }); return { tris: r.tris, size: [s.x, s.y, s.z].map((v) => Math.round(v * 1000) / 1000), map, mats: mats.size }; }`).catch((e) => ({ error: e.message }));
  const cubo = async (f) => model(path.join(outDir, f, "cubo." + f));
  for (const f of ["glb", "gltf", "stl", "ply", "3mf", "usdz"]) {
    const r = await cubo(f), want = f === "ply" ? [2, 1, 3] : [2, 1, 3];
    check(`cubo em ${f}: 12 triângulos e medidas`, r.tris === 12 && JSON.stringify(r.size) === JSON.stringify(want), JSON.stringify(r));
    if (["glb", "gltf", "usdz"].includes(f)) check(`cubo em ${f}: levou a textura`, r.map > 0, JSON.stringify(r));
  }
  const stl = fs.readFileSync(path.join(outDir, "stl", "cubo.stl")), box = [[1e9, -1e9], [1e9, -1e9], [1e9, -1e9]];
  for (let i = 0, p = 84; i < stl.readUInt32LE(80); i++, p += 50) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = stl.readFloatLE(p + 12 + v * 12 + k * 4); box[k][0] = Math.min(box[k][0], x); box[k][1] = Math.max(box[k][1], x); }
  check("STL sai com Z para cima (altura 1 no eixo Z)", Math.abs(box[2][1] - box[2][0] - 1) < 1e-4 && Math.abs(box[1][1] - box[1][0] - 3) < 1e-4, JSON.stringify(box));
  const objDir = path.join(outDir, "obj", "cubo"), objFiles = fs.readdirSync(objDir);
  check("OBJ sai com MTL e textura na pasta", objFiles.length === 3 && /map_Kd parede_cor\.png/.test(fs.readFileSync(path.join(objDir, "cubo.mtl"), "utf8")), objFiles.join(", "));
  fs.rmSync(path.join(samples, "volta"), { recursive: true, force: true }); fs.cpSync(objDir, path.join(samples, "volta"), { recursive: true });
  const [back] = await convert("volta/cubo.obj", "glb"), br = await model(back.output);
  check("OBJ -> GLB ida e volta com textura", br.tris === 12 && br.map > 0 && !back.notes, JSON.stringify(br) + (back.notes || ""));
  put("orfao.obj", fs.readFileSync(path.join(samples, "cubo.obj"), "utf8").replace("cubo.mtl", "sumiu.mtl"));
  const [orf] = await convert("orfao.obj", "glb");
  check("textura que falta vira aviso, não erro", orf.status === "done" && !!orf.notes, (orf.notes || []).join("; "));

  log("\nsegurança e falhas");
  put("ruim.png", "isto não é uma imagem"); put("ruim.mp4", "nem isto um vídeo"); put("ruim.glb", "nem isto um modelo"); put("ruim.pdf", "x"); put("ruim.json", "{ erro"); put("ruim.srt", "vazio");
  for (const [f, t] of [["ruim.png", "jpg"], ["ruim.mp4", "webm"], ["ruim.glb", "stl"], ["ruim.pdf", "png"], ["ruim.json", "csv"], ["ruim.srt", "vtt"]]) { const [r] = await convert(f, t); check(`${f} dá um erro claro`, r.status === "error" && r.error.length > 10, r.error); }
  const http = await js(`(async () => { const p = await FP.call("prefs"); const it = FP.app.S.items[0].src; const get = async (u) => { try { return (await fetch(u)).status; } catch (e) { return String(e.message); } };
    const root = it.url.split("/m/")[0]; return { ok: await get(it.url), semToken: await get(it.url.replace(/\\/[0-9a-f]{32}\\//, "/" + "0".repeat(32) + "/")), fora: await get(it.assetBase + "?p=" + encodeURIComponent("../../data/conversor/prefs.json")), forte: await get(it.assetBase + "?p=" + encodeURIComponent("..\\\\..\\\\midia.json")), naoExiste: await get(root + "/m/99999/x") }; })()`);
  check("servidor local só entrega o que foi adicionado", http.ok === 200 && http.semToken === 404 && http.fora === 404 && http.forte === 404 && http.naoExiste === 404, JSON.stringify(http));
  const cancel = await js(`(async () => { const f = new File([await (await fetch(FP.app.S.items.find((i) => i.src.name === "video.mp4").src.url)).blob()], "longo.mp4"); const [it] = FP.app.addSources([new FP.Source({ name: f.name, size: f.size, file: f })], { to: "webm" }); const p = FP.app.convert([it]); await new Promise((r) => setTimeout(r, 60)); FP.app.stopAll(); await p; return it.state; })()`);
  check("parar no meio", ["canceled", "idle"].includes(cancel), cancel);
  const dropped = await js(`(async () => { const g = async (n) => new File([await (await fetch(FP.app.S.items.find((i) => i.src.name === "cubo.obj").src.assetBase + "?p=" + n)).blob()], n); const obj = new File([await FP.app.S.items.find((i) => i.src.name === "cubo.obj").src.blob()], "solto.obj"); FP.app.addFiles([obj, await g("cubo.mtl"), await g("Parede.png")]); const it = FP.app.S.items.find((i) => i.src.name === "solto.obj"); it.to = "glb"; const png = FP.app.S.items.find((i) => i.src.name === "Parede.png" && i.state === "idle"); if (png) FP.app.S.items.splice(FP.app.S.items.indexOf(png), 1); await FP.app.convert([it]); return { state: it.state, notes: it.result && it.result.notes, error: it.error, path: it.result && it.result.files[0].path }; })()`);
  check("solto na tela com MTL e textura juntos", dropped.state === "done" && !dropped.notes.length && (await model(dropped.path)).map > 0, JSON.stringify(dropped));

  // a pessoa foi para outro módulo no meio: a tela some (document.hidden) e a conversão continua
  host.removeAllListeners("focus");
  host.hide();
  await new Promise((r) => setTimeout(r, 300));
  const hidden = await js("document.visibilityState");
  for (const [f, t] of [["video.mp4", "webm"], ["video.mp4", "gif"], ["album.pdf", "jpg"], ["cubo.obj", "glb"], ["cubo.obj", "png"], ["foto.png", "webp"], ["som.wav", "mp3"], ["anim.gif", "mp4"]]) {
    const r = await Promise.race([convert(f, t), new Promise((ok) => setTimeout(ok, 25000, [{ status: "travou" }]))]);
    check(`escondido (${hidden}): ${f} -> ${t}`, r[0].status === "done", r[0].status === "done" ? "" : r[0].error || r[0].status);
  }
  host.on("focus", (id) => host.show(id));
  await host.show("conversor");

  log("\nCentral");
  const lib = host.library.list({ limit: 5000 });
  check("convertidos entraram na Mídia", lib.some((x) => x.by === "conversor" && x.kind === "image") && lib.some((x) => x.kind === "video") && lib.some((x) => x.kind === "audio"), lib.length + " itens");
  check("aparece em Abrir no...", host.openers("image").some((o) => o.id === "conversor"));
  await host.openIn("conversor", { path: path.join(samples, "foto.jpg") });
  await new Promise((r) => setTimeout(r, 500));
  check("Abrir no Faceplate adiciona o arquivo", await js(`FP.app.S.items.some((i) => i.src.name === "foto.jpg" && i.state === "idle")`));
  const tools = new ToolsServer({ modules: host, hubVersion: version });
  check("ferramentas da IA registradas", tools.list().map((t) => t.def.name).join() === "conversor_list_formats,conversor_convert_files");
  const call = await tools.call("conversor_convert_files", { paths: [path.join(samples, "foto.png")], to: "mp3" });
  check("IA pede conversão impossível: explica", call.isError && /não pode virar/.test(call.content[0].text), call.content[0].text.slice(0, 90));
}

async function shots({ host, js, wc, samples, convert }) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const wait = (t) => new Promise((r) => setTimeout(r, t));
  const snap = async (name) => { await wait(1200); fs.writeFileSync(path.join(SHOTS, name + ".png"), (await wc.capturePage()).toPNG()); };
  // a janela de escolher arquivos responde sozinha
  const orig = host.hostCall.bind(host); let picked = [];
  host.hostCall = (m, fn, a) => (fn === "openDialog" ? Promise.resolve(picked) : orig(m, fn, a));
  const add = async (names) => { picked = names.map((n) => path.join(samples, n)); await js(`document.getElementById("addFiles").click()`); await wait(800); };
  await js(`document.getElementById("clearAll").click()`);
  await snap("1-vazio");
  await convert(["video.mp4"], "webm"); await convert(["foto.png"], "jpg");
  await add([process.env.FP_EXTRA ? "robo.glb" : "cubo.obj", "video.mov", "video.mkv", "som.wav", "foto.tga", "logo.svg", "lista.csv", "fonte.ttf"].filter((n) => fs.existsSync(path.join(samples, n))));
  check("botão Adicionar arquivos", await js(`FP.app.S.items.some((i) => i.src.name === "logo.svg")`));
  const sel = (n) => js(`FP.app.select(FP.app.S.items.find((i) => i.src.name === ${JSON.stringify(n)}).id)`);
  await sel(process.env.FP_EXTRA ? "robo.glb" : "cubo.obj"); await wait(2500); await snap("2-modelo");
  await sel("video.mov"); await snap("3-video");
  await sel("video.mp4"); await snap("4-pronto");
  await sel("foto.tga"); await js(`(() => { const it = FP.app.S.items.find((i) => i.src.name === "foto.tga"); it.to = "jpg"; FP.app.renderAll(false); })()`); await snap("5-imagem");
  await js(`document.querySelector('[data-tab="formats"]').click()`); await snap("6-formatos");
  await js(`document.querySelector('[data-tab="settings"]').click()`); await snap("7-ajustes");
}
