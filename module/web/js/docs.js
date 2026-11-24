// Arasaka Faceplate · PDF, dados (JSON, CSV, YAML, XML, Markdown), legendas e fontes.
"use strict";
(() => {
  // ---------------------------------------------------------------- PDF -> imagens ou texto
  FP.openPdf = async (src) => {
    await FP.vendor("pdf");
    try {
      return await PdfJs.getDocument({ data: await src.bytes(), isEvalSupported: false, useSystemFonts: true, useWasm: false }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") throw new Error("Este PDF tem senha");
      throw new Error(`Não deu para abrir este PDF: ${(e && e.message) || e}`);
    }
  };
  FP.renderPdfPage = async (pdf, n, scale) => {
    const page = await pdf.getPage(n), vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
    // "print": desenha sem requestAnimationFrame, que para quando o módulo está escondido
    await page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp, background: "#ffffff", intent: "print" }).promise;
    page.cleanup();
    return c;
  };
  FP.converters.pdf = async (job) => {
    const { src, to, opts } = job, pdf = await FP.openPdf(src);
    try {
      const total = pdf.numPages;
      if (to === "txt") {
        const out = [];
        for (let n = 1; n <= total; n++) {
          job.check(); job.progress(n / total);
          const t = await (await pdf.getPage(n)).getTextContent();
          out.push(t.items.map((i) => (i.str || "") + (i.hasEOL ? "\n" : "")).join(""));
        }
        const text = out.join("\n\n").trim();
        if (!text) throw new Error("Este PDF não tem texto (as páginas são imagens)");
        await job.save("﻿" + text.replace(/\r?\n/g, "\r\n"), "txt");
        return {};
      }
      const pages = parsePages(opts.pages, total);
      if (pages.length > 1) await job.group(src.base);
      const digits = String(total).length;
      let w = 0, h = 0;
      for (let i = 0; i < pages.length; i++) {
        job.check(); job.progress(i / pages.length);
        const c = await FP.renderPdfPage(pdf, pages[i], Math.max(36, Math.min(600, Number(opts.dpi) || 150)) / 72);
        const o = new OffscreenCanvas(c.width, c.height);
        o.getContext("2d").drawImage(c, 0, 0);
        w = c.width; h = c.height;
        await job.save(await FP.encodeImage(o, to, opts), to, pages.length > 1 || total > 1 ? `${src.base} ${String(pages[i]).padStart(digits, "0")}` : src.base);
        c.width = c.height = 0;
      }
      return { width: w, height: h };
    } finally { await pdf.loadingTask.destroy().catch(() => {}); }
  };
  // "1-3, 5": páginas pedidas; vazio = todas
  function parsePages(text, total) {
    const all = Array.from({ length: total }, (_, i) => i + 1);
    if (!String(text || "").trim()) return all;
    const set = new Set();
    for (const part of String(text).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\d+)(?:\s*-\s*(\d+)?)?$/.exec(part);
      if (!m) throw new Error("Páginas inválidas. Use, por exemplo: 1-3, 5");
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : /-/.test(part) ? total : a;
      for (let n = Math.max(1, a); n <= Math.min(total, b); n++) set.add(n);
    }
    if (!set.size) throw new Error(`Essas páginas não existem: o PDF tem ${total}`);
    return [...set].sort((x, y) => x - y);
  }
  FP.parsePages = parsePages;

  // ---------------------------------------------------------------- CSV
  FP.parseCsv = (text, sep) => {
    text = text.replace(/^﻿/, "");
    if (!sep) { // o separador mais comum na primeira linha (o Excel em português usa ;)
      const line = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, "");
      sep = [";", "\t", ",", "|"].map((s) => [s, line.split(s).length]).sort((a, b) => b[1] - a[1])[0];
      sep = sep[1] > 1 ? sep[0] : ",";
    }
    const rows = [];
    let row = [], cell = "", quoted = false, i = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
      else if (c === '"' && cell === "") quoted = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
    return rows.filter((r) => r.length > 1 || r[0] !== "");
  };
  const typed = (s) => (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s) ? Number(s) : s === "true" ? true : s === "false" ? false : s);
  function csvToData(text, sep, types) {
    const rows = FP.parseCsv(text, sep);
    if (!rows.length) return [];
    const used = new Set();
    const head = rows[0].map((h, i) => { let n = h.trim() || "coluna" + (i + 1), k = n; for (let j = 2; used.has(k); j++) k = n + "_" + j; used.add(k); return k; });
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, types ? typed(r[i] ?? "") : r[i] ?? ""])));
  }
  // qualquer dado vira tabela: lista de objetos, lista de listas ou objeto com uma lista dentro
  function toTable(data) {
    if (data && typeof data === "object" && !Array.isArray(data)) {
      let d = data;
      for (let i = 0; i < 4 && d && typeof d === "object" && !Array.isArray(d); i++) {
        const lists = Object.values(d).filter(Array.isArray);
        if (lists.length === 1) { data = lists[0]; break; }
        const keys = Object.keys(d).filter((k) => d[k] && typeof d[k] === "object");
        if (keys.length !== 1 || Object.keys(d).length > 2) break;
        d = d[keys[0]];
      }
    }
    const list = Array.isArray(data) ? data : [data];
    if (list.length && list.every(Array.isArray)) return list;
    const flat = (o, pre, out) => {
      if (o === null || typeof o !== "object") { out[pre || "valor"] = o; return out; }
      for (const [k, v] of Object.entries(o)) {
        const key = pre ? pre + "." + k : k;
        if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
        else out[key] = Array.isArray(v) ? (v.every((x) => x === null || typeof x !== "object") ? v.join("; ") : JSON.stringify(v)) : v;
      }
      return out;
    };
    const objs = list.map((x) => flat(x, "", Object.create(null))), head = [...new Set(objs.flatMap(Object.keys))];
    return [head, ...objs.map((o) => head.map((h) => o[h] ?? ""))];
  }
  const csvOut = (rows, sep) => rows.map((r) => r.map((v) => { const s = v === null || v === undefined ? "" : String(v); return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(sep)).join("\r\n") + "\r\n";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const page = (title, body) => `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>
body { font: 16px/1.6 system-ui, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #1b1b1f; }
table { border-collapse: collapse; width: 100%; font-size: 14px; } th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; } th { background: #f2f2f4; }
pre { background: #f4f4f6; padding: 14px; overflow: auto; } code { font-family: Consolas, monospace; } img { max-width: 100%; } blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 16px; color: #555; }
</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

  FP.converters.data = async (job) => {
    const { src, to, opts } = job, from = FP.formats.normalize(src.ext), text = (await src.text()).replace(/^﻿/, "");
    await FP.vendor("text");
    const { yaml, XMLParser, XMLBuilder, XMLValidator, marked } = TextLibs;
    if (from === "md") { await job.save(page(src.base, marked.parse(text, { async: false })), "html"); return {}; }
    let data;
    try {
      if (from === "json") data = JSON.parse(text);
      else if (from === "yaml") data = yaml.load(text);
      else if (from === "csv" || from === "tsv") data = csvToData(text, from === "tsv" ? "\t" : null, opts.types !== false);
      else {
        const ok = XMLValidator.validate(text);
        if (ok !== true) throw new Error(`linha ${ok.err.line}: ${ok.err.msg}`);
        data = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", ignoreDeclaration: true, parseTagValue: opts.types !== false }).parse(text);
      }
    } catch (e) { throw new Error(`O arquivo ${from.toUpperCase()} tem um erro: ${e.message}`); }
    let out;
    switch (to) {
      case "json": out = JSON.stringify(data, null, 2) + "\n"; break;
      case "yaml": out = yaml.dump(data, { lineWidth: 120, noRefs: true }); break;
      case "csv": out = "﻿" + csvOut(toTable(data), opts.separator === "comma" ? "," : ";"); break; // com BOM o Excel acerta os acentos
      case "tsv": out = csvOut(toTable(data), "\t"); break;
      case "xml": {
        // nome de tag válido; o texto original fica igual
        const tag = (k) => (k.startsWith("@") ? "@" + tag(k.slice(1)) : k === "#text" ? k : k.replace(/[^\p{L}\p{N}_.-]/gu, "_").replace(/^([^\p{L}_])/u, "_$1") || "_");
        const clean = (v) => (Array.isArray(v) ? v.map(clean) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [tag(k), clean(x)])) : v instanceof Date ? v.toISOString() : v);
        const keys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [];
        const root = from === "xml" ? data : keys.length === 1 && !Array.isArray(data[keys[0]]) ? data : { dados: Array.isArray(data) ? { item: data } : data };
        out = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@", format: true, suppressBooleanAttributes: false }).build(clean(root));
        break;
      }
      case "html": {
        const [head, ...rows] = toTable(data);
        out = page(src.base, `<table>\n<thead><tr>${(head || []).map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>\n<tbody>\n${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("\n")}\n</tbody>\n</table>`);
        break;
      }
      default: throw new Error("Formato desconhecido: " + to);
    }
    await job.save(out, to);
    return {};
  };

  // ---------------------------------------------------------------- legendas
  const ms = (h, m, s, f) => (Number(h || 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Math.round(Number("0." + f) * 1000);
  const p2 = (n) => String(n).padStart(2, "0");
  const clock = (t, sep) => `${p2(Math.floor(t / 3600000))}:${p2(Math.floor(t / 60000) % 60)}:${p2(Math.floor(t / 1000) % 60)}${sep}${String(t % 1000).padStart(3, "0")}`;
  const assClock = (t) => { const c = Math.round(t / 10); return `${Math.floor(c / 360000)}:${p2(Math.floor(c / 6000) % 60)}:${p2(Math.floor(c / 100) % 60)}.${p2(c % 100)}`; };
  FP.parseSubtitles = (text, ext) => {
    text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const cues = [];
    if (ext === "ass" || ext === "ssa") {
      let fmt = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"], events = false;
      for (const line of text.split("\n")) {
        if (/^\[/.test(line)) events = /^\[events\]/i.test(line);
        else if (events && /^Format:/i.test(line)) fmt = line.slice(7).split(",").map((s) => s.trim());
        else if (events && /^Dialogue:/i.test(line)) {
          const parts = line.slice(9).trim().split(","), f = {};
          fmt.forEach((k, i) => { f[k.toLowerCase()] = i === fmt.length - 1 ? parts.slice(i).join(",") : parts[i]; });
          const a = /(\d+):(\d+):(\d+)[.](\d+)/.exec(f.start || ""), b = /(\d+):(\d+):(\d+)[.](\d+)/.exec(f.end || "");
          if (!a || !b) continue;
          const t = (f.text || "").replace(/\{\\i1\}/g, "<i>").replace(/\{\\i0\}/g, "</i>").replace(/\{\\b1\}/g, "<b>").replace(/\{\\b0\}/g, "</b>").replace(/\{[^}]*\}/g, "").replace(/\\N|\\n/g, "\n").replace(/\\h/g, " ").trim();
          if (t) cues.push({ start: ms(a[1], a[2], a[3], a[4]), end: ms(b[1], b[2], b[3], b[4]), text: t });
        }
      }
    } else {
      const re = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
      for (const block of text.split(/\n[ \t]*\n/)) {
        const lines = block.split("\n"), i = lines.findIndex((l) => re.test(l));
        if (i < 0) continue;
        const m = re.exec(lines[i]), t = lines.slice(i + 1).join("\n").replace(/<\/?(?:c|v|lang|ruby|rt)(?:[ .][^>]*)?>|<\d[\d:.]*>/g, "").trim();
        if (t) cues.push({ start: ms(m[1], m[2], m[3], m[4]), end: ms(m[5], m[6], m[7], m[8]), text: t });
      }
    }
    cues.sort((a, b) => a.start - b.start);
    if (!cues.length) throw new Error("Nenhuma legenda encontrada no arquivo");
    return cues;
  };
  FP.formatSubtitles = (cues, to) => {
    const plain = (s) => s.replace(/<[^>]+>/g, "");
    switch (to) {
      case "srt": return "﻿" + cues.map((c, i) => `${i + 1}\r\n${clock(c.start, ",")} --> ${clock(c.end, ",")}\r\n${c.text.replace(/\n/g, "\r\n")}\r\n`).join("\r\n");
      case "vtt": return "WEBVTT\n\n" + cues.map((c) => `${clock(c.start, ".")} --> ${clock(c.end, ".")}\n${c.text.replace(/<\/?font[^>]*>/g, "")}\n`).join("\n");
      case "txt": return "﻿" + cues.map((c) => plain(c.text)).join("\r\n") + "\r\n";
      case "ass": {
        const t = (s) => s.replace(/<i>/g, "{\\i1}").replace(/<\/i>/g, "{\\i0}").replace(/<b>/g, "{\\b1}").replace(/<\/b>/g, "{\\b0}").replace(/<[^>]+>/g, "").replace(/\n/g, "\\N");
        return "﻿[Script Info]\r\nScriptType: v4.00+\r\nPlayResX: 1920\r\nPlayResY: 1080\r\nWrapStyle: 0\r\nScaledBorderAndShadow: yes\r\n\r\n[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\r\n" +
          "Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,50,1\r\n\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n" +
          cues.map((c) => `Dialogue: 0,${assClock(c.start)},${assClock(c.end)},Default,,0,0,0,,${t(c.text)}`).join("\r\n") + "\r\n";
      }
    }
    throw new Error("Formato de legenda desconhecido: " + to);
  };
  FP.converters.subtitle = async (job) => {
    const shift = Math.round((Number(job.opts.shift) || 0) * 1000);
    const cues = FP.parseSubtitles(await job.src.text(), job.src.ext).map((c) => ({ ...c, start: Math.max(0, c.start + shift), end: Math.max(0, c.end + shift) })).filter((c) => c.end > c.start);
    await job.save(FP.formatSubtitles(cues, job.to), job.to);
    return {};
  };

  // ---------------------------------------------------------------- fontes: WOFF é o TTF/OTF com cada tabela comprimida (zlib)
  const pump = async (data, stream) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
  const pad4 = (n) => (n + 3) & ~3;
  FP.converters.font = async (job) => {
    const b = await job.src.bytes(), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 12) throw new Error("Arquivo de fonte inválido");
    const sig = v.getUint32(0);
    if (job.to === "woff") {
      if (sig === 0x74746366) throw new Error("Coleções de fontes (TTC) não são suportadas");
      if (![0x00010000, 0x4f54544f, 0x74727565].includes(sig)) throw new Error("Arquivo de fonte inválido");
      const n = v.getUint16(4), tables = [];
      for (let i = 0; i < n; i++) {
        const p = 12 + i * 16, off = v.getUint32(p + 8), len = v.getUint32(p + 12), raw = b.subarray(off, off + len), z = await pump(raw, new CompressionStream("deflate"));
        tables.push({ tag: v.getUint32(p), sum: v.getUint32(p + 4), len, data: z.length < len ? z : raw });
      }
      let off = 44 + n * 20;
      const total = off + tables.reduce((s, t) => s + pad4(t.data.length), 0), out = new Uint8Array(total), o = new DataView(out.buffer);
      o.setUint32(0, 0x774f4646); o.setUint32(4, sig); o.setUint32(8, total); o.setUint16(12, n); o.setUint32(16, 12 + n * 16 + tables.reduce((s, t) => s + pad4(t.len), 0)); o.setUint16(20, 1);
      tables.forEach((t, i) => {
        const p = 44 + i * 20;
        o.setUint32(p, t.tag); o.setUint32(p + 4, off); o.setUint32(p + 8, t.data.length); o.setUint32(p + 12, t.len); o.setUint32(p + 16, t.sum);
        out.set(t.data, off); off += pad4(t.data.length);
      });
      await job.save(out, "woff");
      return {};
    }
    if (sig !== 0x774f4646) throw new Error("Arquivo WOFF inválido (WOFF2 não é suportado)");
    const flavor = v.getUint32(4), n = v.getUint16(12), real = flavor === 0x4f54544f ? "otf" : "ttf";
    if (real !== job.to) job.note(real === "otf" ? "A fonte é do tipo OpenType: salva como .otf" : "A fonte é do tipo TrueType: salva como .ttf");
    const tables = [];
    for (let i = 0; i < n; i++) {
      const p = 44 + i * 20, off = v.getUint32(p + 4), comp = v.getUint32(p + 8), len = v.getUint32(p + 12), raw = b.subarray(off, off + comp);
      tables.push({ tag: v.getUint32(p), sum: v.getUint32(p + 16), data: comp < len ? await pump(raw, new DecompressionStream("deflate")) : raw });
    }
    const log = Math.floor(Math.log2(n));
    let off = 12 + n * 16;
    const out = new Uint8Array(off + tables.reduce((s, t) => s + pad4(t.data.length), 0)), o = new DataView(out.buffer);
    o.setUint32(0, flavor); o.setUint16(4, n); o.setUint16(6, 16 << log); o.setUint16(8, log); o.setUint16(10, n * 16 - (16 << log));
    tables.forEach((t, i) => {
      const p = 12 + i * 16;
      o.setUint32(p, t.tag); o.setUint32(p + 4, t.sum); o.setUint32(p + 8, off); o.setUint32(p + 12, t.data.length);
      out.set(t.data, off); off += pad4(t.data.length);
    });
    await job.save(out, real);
    return {};
  };
})();
