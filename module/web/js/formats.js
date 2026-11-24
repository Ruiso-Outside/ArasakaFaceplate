// Formatos do Arasaka Faceplate: o que abre e para o que converte. Usado pela tela (FP.formats) e pelo motor (require).
"use strict";
(function (root) {
  const KINDS = [
    { id: "image", label: "Imagens", icon: "image",
      inputs: ["png", "jpg", "jpeg", "jfif", "webp", "gif", "bmp", "avif", "svg", "ico", "heic", "heif", "tif", "tiff", "tga"],
      outputs: ["png", "jpg", "webp", "gif", "bmp", "tiff", "tga", "ico", "pdf"] },
    { id: "video", label: "Vídeos", icon: "film",
      inputs: ["mp4", "m4v", "mov", "webm", "mkv", "ts", "mts", "m2ts"],
      outputs: ["mp4", "webm", "mov", "mkv", "gif", "mp3", "m4a", "wav", "ogg", "flac", "jpg", "png"] },
    { id: "audio", label: "Áudios", icon: "music",
      inputs: ["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a", "aac", "weba"],
      outputs: ["mp3", "m4a", "wav", "ogg", "flac"] },
    { id: "model", label: "Objetos 3D", icon: "package",
      inputs: ["glb", "gltf", "obj", "fbx", "stl", "ply", "dae", "3ds", "3mf", "amf", "wrl", "usdz"],
      outputs: ["glb", "gltf", "obj", "stl", "ply", "3mf", "usdz", "png"] },
    { id: "pdf", label: "PDF", icon: "file-text", inputs: ["pdf"], outputs: ["png", "jpg", "webp", "txt"] },
    { id: "data", label: "Dados e textos", icon: "database",
      inputs: ["json", "csv", "tsv", "yaml", "yml", "xml", "md"], outputs: ["json", "csv", "tsv", "yaml", "xml", "html"] },
    { id: "subtitle", label: "Legendas", icon: "list", inputs: ["srt", "vtt", "ass", "ssa"], outputs: ["srt", "vtt", "ass", "txt"] },
    { id: "font", label: "Fontes", icon: "type", inputs: ["ttf", "otf", "woff"], outputs: ["ttf", "otf", "woff"] },
  ];
  const ALIAS = { jpeg: "jpg", jfif: "jpg", tif: "tiff", yml: "yaml", heif: "heic", oga: "ogg", opus: "ogg", ssa: "ass", m4v: "mp4", mts: "ts", m2ts: "ts", weba: "webm" };
  const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif",
    svg: "image/svg+xml", ico: "image/x-icon", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", tga: "image/x-tga",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", ts: "video/mp2t", mts: "video/mp2t", m2ts: "video/mp2t",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", weba: "audio/webm",
    pdf: "application/pdf", json: "application/json", txt: "text/plain", html: "text/html", csv: "text/csv" };

  const ext = (name) => { const m = /\.([^.\\/]+)$/.exec(String(name)); return m ? m[1].toLowerCase() : ""; };
  const normalize = (e) => ALIAS[e] || e;
  const kindOf = (name) => { const e = ext(name); const k = KINDS.find((x) => x.inputs.includes(e)); return k ? k.id : null; };
  const kind = (id) => KINDS.find((k) => k.id === id);

  // saídas possíveis para um arquivo. O mesmo formato fica na lista quando há o que mudar (tamanho, qualidade, corte)
  const REDO = new Set(["jpg", "webp", "png", "gif", "pdf", "mp4", "webm", "mov", "mkv", "mp3", "m4a", "ogg", "wav", "flac", "stl", "obj", "glb"]);
  function targetsFor(name) {
    const id = kindOf(name);
    if (!id) return [];
    const e = normalize(ext(name));
    let outs = kind(id).outputs.slice();
    if (id === "image" && e === "gif") outs.push("mp4", "webm");
    if (id === "data" && e === "md") outs = ["html"];
    if (id === "font") outs = e === "woff" ? ["ttf", "otf"] : ["woff"];
    return outs.filter((o) => o !== e || REDO.has(o));
  }

  // formato sugerido quando a pessoa ainda não escolheu nenhum
  const SUGGEST = { image: ["png", "jpg"], video: ["mp4", "webm"], audio: ["mp3", "wav"], model: ["glb", "stl"], pdf: ["png"],
    data: ["json", "csv", "html"], subtitle: ["srt", "vtt"], font: ["woff", "ttf"] };
  function suggest(name, last) {
    const t = targetsFor(name), e = normalize(ext(name));
    if (last && t.includes(last)) return last;
    return (SUGGEST[kindOf(name)] || []).find((x) => t.includes(x) && x !== e) || t.find((x) => x !== e) || t[0];
  }

  // o que entra na Mídia da Central
  const MEDIA = { audio: ["mp3", "m4a", "wav", "ogg", "flac"], video: ["mp4", "mov", "webm", "mkv"], image: ["png", "jpg", "webp", "gif", "bmp"] };
  const mediaKind = (name) => Object.keys(MEDIA).find((k) => MEDIA[k].includes(ext(name))) || null;

  const api = { KINDS, MIME, ext, normalize, kindOf, kind, targetsFor, suggest, mediaKind };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.FP = root.FP || {}).formats = api;
})(typeof window === "undefined" ? globalThis : window);
