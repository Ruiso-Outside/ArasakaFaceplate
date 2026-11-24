// Monta module/web/vendor/*.js (bibliotecas de terceiros, cada uma carregada só quando um conversor precisa).
// Rode "npm install" e "npm run vendor" só ao atualizar uma biblioteca: os arquivos prontos ficam no repositório,
// porque scripts/make-module.js roda sem node_modules (é a Central que o executa ao publicar).
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "node_modules");
const OUT = path.join(ROOT, "module", "web", "vendor");

const BUNDLES = {
  mediabunny: `import * as MB from "mediabunny"; window.Mediabunny = MB;`,
  mp3: `import { registerMp3Encoder } from "@mediabunny/mp3-encoder"; registerMp3Encoder();`,
  flac: `import { registerFlacEncoder } from "@mediabunny/flac-encoder"; registerFlacEncoder();`,
  ac3: `import { registerAc3Decoder } from "@mediabunny/ac3"; registerAc3Decoder();`,
  gifenc: `import { GIFEncoder, quantize, applyPalette } from "gifenc"; window.Gifenc = { GIFEncoder, quantize, applyPalette };`,
  utif: `import UTIF from "utif2"; window.UTIF = UTIF;`,
  heif: `import libheif from "libheif-js/wasm-bundle"; window.Libheif = libheif;`,
  // o leitor de PDF roda na própria página: um Worker não abre a partir de file://
  pdf: `import * as worker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs"; import * as pdfjs from "pdfjs-dist/legacy/build/pdf.min.mjs";
    globalThis.pdfjsWorker = worker; window.PdfJs = pdfjs;`,
  text: `import * as yaml from "js-yaml"; import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser"; import { marked } from "marked";
    window.TextLibs = { yaml, XMLParser, XMLBuilder, XMLValidator, marked };`,
  three: `
    import * as THREE from "three";
    import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
    import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
    import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
    import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
    import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
    import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
    import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
    import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
    import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
    import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
    import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";
    import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
    import { AMFLoader } from "three/examples/jsm/loaders/AMFLoader.js";
    import { VRMLLoader } from "three/examples/jsm/loaders/VRMLLoader.js";
    import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
    import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
    import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
    import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
    import { PLYExporter } from "three/examples/jsm/exporters/PLYExporter.js";
    import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";
    import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
    import { zipSync, strToU8 } from "fflate";
    window.Three = { ...THREE, OrbitControls, RoomEnvironment, GLTFLoader, MeshoptDecoder, OBJLoader, MTLLoader, STLLoader, PLYLoader, FBXLoader,
      ColladaLoader, TDSLoader, ThreeMFLoader, AMFLoader, VRMLLoader, USDLoader, TGALoader, GLTFExporter, STLExporter, PLYExporter, USDZExporter, mergeVertices };
    window.Fflate = { zipSync, strToU8 };`,
};

// as extensões usam a mesma Mediabunny já carregada na página
const sharedMediabunny = { name: "shared-mediabunny", setup(b) {
  b.onResolve({ filter: /^mediabunny$/ }, () => ({ path: "mediabunny", namespace: "shared" }));
  b.onLoad({ filter: /.*/, namespace: "shared" }, () => ({ contents: "module.exports = window.Mediabunny;", loader: "js" }));
} };
// módulos do Node que algumas bibliotecas citam e o navegador nunca usa
const noNode = { name: "no-node", setup(b) {
  b.onResolve({ filter: /^(node:.*|fs|path|url|crypto|module|canvas|worker_threads|fs\/promises)$/ }, (a) => ({ path: a.path, namespace: "empty" }));
  b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "module.exports = {};", loader: "js" }));
} };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  for (const [name, code] of Object.entries(BUNDLES)) {
    if (only.length && !only.includes(name)) continue;
    const r = await esbuild.build({ stdin: { contents: code, resolveDir: ROOT }, bundle: true, minify: true, format: "iife", platform: "browser", target: "chrome130",
      outfile: path.join(OUT, name + ".js"), legalComments: "none", logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, supported: { "top-level-await": true },
      plugins: [noNode, ...(["mp3", "flac", "ac3"].includes(name) ? [sharedMediabunny] : [])] }).catch((e) => { console.error(name, e.message.slice(0, 600)); process.exitCode = 1; });
    if (r) console.log(name.padEnd(12), Math.round(fs.statSync(path.join(OUT, name + ".js")).size / 1024), "KB");
  }
  // licenças de tudo que vai junto
  const pkgs = ["mediabunny", "@mediabunny/mp3-encoder", "@mediabunny/flac-encoder", "@mediabunny/ac3", "gifenc", "utif2", "pako", "libheif-js", "pdfjs-dist", "js-yaml", "fast-xml-parser", "marked", "three", "fflate"];
  let txt = "Bibliotecas de terceiros usadas no Arasaka Faceplate\n";
  for (const p of pkgs) {
    const dir = path.join(NM, p);
    if (!fs.existsSync(dir)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const lic = fs.readdirSync(dir).find((f) => /^licen[sc]e/i.test(f));
    txt += `\n${"=".repeat(80)}\n${p} ${j.version} · ${typeof j.license === "string" ? j.license : ""} · https://www.npmjs.com/package/${p}\n${"=".repeat(80)}\n` + (lic ? fs.readFileSync(path.join(dir, lic), "utf8") : "");
  }
  fs.writeFileSync(path.join(OUT, "LICENSES.txt"), txt);
})();
