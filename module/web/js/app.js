// Arasaka Faceplate · tela: lista de arquivos, opções de cada formato, prévia e fila de conversão.
"use strict";
(() => {
  const F = FP.formats, $ = (s) => document.querySelector(s);
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v);
    }
    el.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
    return el;
  };
  const icon = (n) => h("i", { class: "i i-" + n });
  const LOCALE = (piphin.info && piphin.info.locale) || "pt-BR";
  const bytes = (n) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toLocaleString(LOCALE, { maximumFractionDigits: i && n < 100 ? 1 : 0 }) + " " + u[i]; };
  const time = (s) => { s = Math.round(s); const p = (n) => String(n).padStart(2, "0"); return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`; };
  const toast = (text, kind = "") => { const t = h("div", { class: "toast " + kind }, text); $("#toasts").append(t); setTimeout(() => t.remove(), kind === "err" ? 7000 : 4000); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, "err"); } };

  const S = { items: [], sel: null, prefs: { options: {}, lastTarget: {} }, running: null, stop: false, seq: 0, view: null, library: false };
  const byId = (id) => S.items.find((i) => i.id === id);

  // ---------------------------------------------------------------- opções de cada conversão
  const SIZES = [["0", "Original"], ["3840", "3840 px"], ["2560", "2560 px"], ["1920", "1920 px"], ["1280", "1280 px"], ["1024", "1024 px"], ["512", "512 px"], ["256", "256 px"], ["128", "128 px"]];
  const HEIGHTS = [["0", "Original"], ["2160", "2160p (4K)"], ["1440", "1440p"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"], ["240", "240p"]];
  const O = {
    quality: { id: "quality", label: "Qualidade", type: "range", min: 1, max: 100, def: 90 },
    maxSize: { id: "maxSize", label: "Lado maior", type: "select", list: SIZES, def: "0" },
    background: { id: "background", label: "Fundo (no lugar do transparente)", type: "color", def: "#ffffff" },
    trim: { id: "trim", label: "Trecho (início e fim)", type: "trim", own: true },
  };
  const VIDEO = [
    { id: "quality", label: "Qualidade", type: "select", def: "auto", list: [["auto", "Automática"], ["low", "Baixa"], ["medium", "Média"], ["high", "Alta"], ["max", "Máxima"]] },
    { id: "height", label: "Resolução", type: "select", list: HEIGHTS, def: "0" },
    { id: "fps", label: "Quadros por segundo", type: "select", def: "0", list: [["0", "Original"], ["60", "60"], ["30", "30"], ["24", "24"], ["15", "15"]] },
    { id: "codec", label: "Codec", type: "select", def: "auto", list: (to) => [["auto", "Automático"], ...(to === "webm" ? [] : [["h264", "H.264"], ["h265", "H.265 (HEVC)"]]), ["vp9", "VP9"], ["av1", "AV1"]] },
    { id: "mute", label: "Sem som", type: "switch", def: false }, O.trim,
  ];
  const AUDIO = [
    { id: "sampleRate", label: "Frequência", type: "select", def: "0", list: [["0", "Original"], ["48000", "48 kHz"], ["44100", "44,1 kHz"], ["22050", "22 kHz"]], not: ["ogg"] },
    { id: "bitrate", label: "Taxa de bits", type: "select", def: "192", list: [["320", "320 kbps"], ["256", "256 kbps"], ["192", "192 kbps"], ["128", "128 kbps"], ["96", "96 kbps"]], not: ["wav", "flac"] },
    { id: "mono", label: "Mono", type: "switch", def: false }, O.trim,
  ];
  function schema(kind, to) {
    const isAudio = F.kind("audio").outputs.includes(to);
    if (kind === "image") {
      if (to === "mp4" || to === "webm") return [{ ...O.maxSize, def: "0" }, O.background];
      if (to === "ico") return [];
      if (to === "pdf") return [{ id: "merge", label: "Juntar tudo num PDF só", type: "switch", def: true }, { id: "page", label: "Página", type: "select", def: "image", list: [["image", "Tamanho da imagem"], ["a4", "A4"]] }, O.quality, O.maxSize, O.background];
      return [...(to === "jpg" || to === "webp" ? [O.quality] : []), O.maxSize, ...(to === "jpg" || to === "bmp" ? [O.background] : [])];
    }
    if (kind === "video" && to === "gif") return [{ id: "height", label: "Altura", type: "select", list: HEIGHTS.slice(4).concat([["160", "160p"]]), def: "360" }, { id: "fps", label: "Quadros por segundo", type: "select", def: "12", list: [["8", "8"], ["10", "10"], ["12", "12"], ["15", "15"], ["20", "20"], ["25", "25"]] }, O.trim];
    if (kind === "video" && (to === "jpg" || to === "png")) return [{ id: "at", label: "Momento (segundos)", type: "at", own: true }, O.maxSize, ...(to === "jpg" ? [O.quality] : [])];
    if (isAudio && (kind === "video" || kind === "audio")) return AUDIO.filter((o) => !(o.not || []).includes(to));
    if (kind === "video") return VIDEO;
    if (kind === "model") {
      if (to === "png") return [{ ...O.maxSize, label: "Tamanho da imagem", list: SIZES.slice(1, 8), def: "1024" }];
      return [
        { id: "scale", label: "Escala", type: "select", def: "1", list: [["0.001", "0,001× (mm → m)"], ["0.01", "0,01× (cm → m)"], ["0.1", "0,1×"], ["1", "1× (igual)"], ["10", "10×"], ["100", "100× (m → cm)"], ["1000", "1000× (m → mm)"]] },
        ...(to === "usdz" ? [] : [{ id: "axis", label: "Eixo para cima", type: "select", def: "auto", list: [["auto", "Automático"], ["y", "Y (jogos)"], ["z", "Z (impressão 3D, CAD)"]] }]),
        ...(to === "stl" || to === "ply" ? [{ id: "ascii", label: "Gravar como texto (ASCII)", type: "switch", def: false }] : []),
      ];
    }
    if (kind === "pdf") return to === "txt" ? [] : [{ id: "dpi", label: "Resolução", type: "select", def: "150", list: [["72", "72 dpi (tela)"], ["150", "150 dpi"], ["300", "300 dpi (impressão)"], ["600", "600 dpi"]] }, { id: "pages", label: "Páginas", type: "text", own: true, placeholder: "todas · ex.: 1-3, 5" }, ...(to === "png" ? [] : [O.quality])];
    if (kind === "data") return [...(to === "csv" ? [{ id: "separator", label: "Separador", type: "select", def: "semicolon", list: [["semicolon", "Ponto e vírgula (Excel)"], ["comma", "Vírgula"]] }] : []), { id: "types", label: "Reconhecer números", type: "switch", def: true }];
    if (kind === "subtitle") return [{ id: "shift", label: "Adiantar ou atrasar (segundos)", type: "number", def: 0, step: 0.1 }];
    return [];
  }
  const optKey = (it) => it.src.kind + ":" + it.to;
  function optionsOf(it) {
    const saved = S.prefs.options[optKey(it)] || {}, o = {};
    for (const s of schema(it.src.kind, it.to)) if (!s.own) o[s.id] = saved[s.id] ?? s.def;
    Object.assign(o, it.own, it.forced);
    if (it.own.at !== undefined && ["jpg", "png"].includes(it.to)) o.start = it.own.at;
    for (const k of ["maxSize", "height"]) if (o[k] !== undefined) o[k] = Number(o[k]) || 0;
    return o;
  }
  let saveTimer = 0;
  const savePrefs = (patch) => { Object.assign(S.prefs, patch); clearTimeout(saveTimer); saveTimer = setTimeout(() => FP.call("prefs", { options: S.prefs.options, lastTarget: S.prefs.lastTarget }).catch(() => {}), 300); };

  // ---------------------------------------------------------------- lista
  function addSources(list, extra = {}) {
    const added = [];
    for (const d of list) {
      const src = d instanceof FP.Source ? d : new FP.Source(d);
      if (!src.kind) continue;
      if (src.path && !extra.forced && S.items.some((i) => i.src.path === src.path && i.state === "idle")) continue; // já está na lista
      const it = { id: ++S.seq, src, to: extra.to || F.suggest(src.name, S.prefs.lastTarget[src.kind]), state: "idle", progress: 0, own: {}, forced: extra.forced || null, outDir: extra.outDir || null };
      S.items.push(it); added.push(it);
    }
    if (added.length) {
      if (!S.sel || !byId(S.sel)) S.sel = added[0].id;
      renderAll();
    }
    return added;
  }
  const receive = (r) => {
    if (!r) return;
    const n = addSources(r.files || []).length;
    if (r.skipped) toast(r.skipped === 1 ? "1 arquivo ficou de fora: formato não suportado" : `${r.skipped} arquivos ficaram de fora: formato não suportado`, "err");
    return n;
  };
  function setTarget(it, to) {
    it.to = to;
    if (["done", "error", "canceled"].includes(it.state)) reset(it);
    savePrefs({ lastTarget: { ...S.prefs.lastTarget, [it.src.kind]: to } });
  }
  const reset = (it) => Object.assign(it, { state: "idle", progress: 0, result: null, error: null });
  function remove(it) {
    if (it.state === "running") { it.job.cancel(); }
    it.src.release();
    S.items = S.items.filter((x) => x !== it);
    if (S.sel === it.id) S.sel = S.items.length ? S.items[0].id : null;
    renderAll();
  }

  const THUMB_IMG = ["png", "jpg", "jpeg", "jfif", "webp", "gif", "bmp", "avif", "svg", "ico"];
  function thumb(src) {
    const t = h("div", { class: "thumb" }), fallback = () => t.replaceChildren(icon(F.kind(src.kind).icon));
    if (THUMB_IMG.includes(src.ext) && src.size < 40e6) t.append(h("img", { src: src.address(), loading: "lazy", decoding: "async", alt: "", onerror: fallback }));
    else if (src.kind === "video" && ["mp4", "m4v", "webm", "mov"].includes(src.ext)) { const v = h("video", { src: src.address() + "#t=0.5", preload: "metadata", muted: true, onerror: fallback }); t.append(v); }
    else fallback();
    return t;
  }
  function row(it) {
    const el = h("div", { class: "item", "data-id": it.id, onclick: () => select(it.id) }, thumb(it.src),
      h("div", { class: "who" }, h("b", { class: "notranslate", title: it.src.path || it.src.name }, it.src.name), h("div", { class: "sub" }), h("div", { class: "progress", hidden: true }, h("i"))),
      h("div", { class: "turn" }, h("span", { class: "from notranslate" }, it.src.ext), icon("arrow-right"),
        h("select", { class: "notranslate", title: "Formato de saída", onclick: (e) => e.stopPropagation(), onchange: (e) => { setTarget(it, e.target.value); renderAll(false); } }, F.targetsFor(it.src.name).map((t) => h("option", { value: t }, t.toUpperCase())))),
      h("div", { class: "acts" }));
    it.el = el;
    updateRow(it);
    return el;
  }
  function updateRow(it) {
    const el = it.el;
    if (!el) return;
    el.classList.toggle("sel", S.sel === it.id);
    const sel = el.querySelector("select"), busy = it.state === "running" || it.state === "queued";
    sel.value = it.to; sel.disabled = busy;
    const bar = el.querySelector(".progress");
    bar.hidden = it.state !== "running";
    bar.firstChild.style.width = Math.round(it.progress * 100) + "%";
    const sub = [];
    if (it.state === "running") sub.push(h("span", { class: "num" }, `${Math.round(it.progress * 100)}%`));
    else if (it.state === "queued") sub.push(h("span", {}, "Na fila"));
    else if (it.state === "error") sub.push(h("span", { class: "msg err", title: it.error }, it.error));
    else if (it.state === "canceled") sub.push(h("span", {}, "Cancelado"));
    else if (it.state === "done") {
      const f = it.result.files, size = f.reduce((s, x) => s + x.size, 0);
      sub.push(h("span", { class: "ok" }, f.length > 1 ? `${f.length} arquivos` : "Pronto"), h("span", { class: "num" }, `${bytes(it.src.size)} → ${bytes(size)}`));
      if (it.result.notes.length) sub.push(h("span", { class: "msg warn", title: it.result.notes.join("\n") }, it.result.notes[0]));
    } else sub.push(h("span", { class: "num" }, bytes(it.src.size)));
    el.querySelector(".sub").replaceChildren(...sub);
    const acts = [];
    const act = (ic, title, fn) => h("button", { class: "btn sm icon ghost", title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic));
    if (it.state === "done") acts.push(act("folder-open", "Mostrar na pasta", () => FP.call("show-item", it.result.files[0].path)));
    if (["done", "error", "canceled"].includes(it.state)) acts.push(act("rotate-ccw", "Converter de novo", () => { reset(it); renderAll(false); }));
    acts.push(it.state === "running" ? act("square", "Parar", () => it.job.cancel()) : act("x", "Tirar da lista", () => remove(it)));
    el.querySelector(".acts").replaceChildren(...acts);
  }
  function renderList() {
    const list = $("#list");
    if (!S.items.length) {
      list.replaceChildren(h("div", { class: "hello" }, h("div", { class: "box", onclick: () => pick("pick-files") }, h("i", { class: "i i-repeat big" }), h("h2", {}, "Troque a cara de qualquer arquivo"),
        h("p", {}, "Solte arquivos ou pastas aqui, cole uma imagem com Ctrl+V ou clique para escolher."),
        h("div", { class: "kinds" }, F.KINDS.map((k) => h("span", { class: "badge" }, icon(k.icon), h("span", {}, k.label)))))));
      return;
    }
    list.replaceChildren(...S.items.map((it) => (it.el ? (updateRow(it), it.el) : row(it))));
  }
  function renderBulk() {
    const groups = F.KINDS.map((k) => ({ k, items: S.items.filter((i) => i.src.kind === k.id && ["idle", "error", "canceled"].includes(i.state)) })).filter((g) => g.items.length > 1);
    $("#bulk").hidden = !groups.length;
    $("#bulk").replaceChildren(...groups.map(({ k, items }) => {
      const common = items.map((i) => F.targetsFor(i.src.name)).reduce((a, b) => a.filter((x) => b.includes(x))), same = items.every((i) => i.to === items[0].to) ? items[0].to : "";
      const sel = h("select", { class: "notranslate", title: "Trocar o formato de todos", onchange: (e) => { if (!e.target.value) return; for (const i of items) setTarget(i, e.target.value); renderAll(false); } }, h("option", { value: "" }, "—"), common.map((t) => h("option", { value: t }, t.toUpperCase())));
      sel.value = same;
      return h("div", { class: "pack" }, icon(k.icon), h("span", {}, k.label), h("b", { class: "num" }, String(items.length)), sel);
    }));
  }
  function renderFoot() {
    const p = S.prefs, waiting = S.items.filter((i) => i.state === "idle").length, busy = !!S.running;
    $("#destBtn").textContent = p.outMode === "same" ? "" : "‎" + (p.outDir || "");
    if (p.outMode === "same") { $("#destBtn").classList.remove("notranslate"); $("#destBtn").textContent = "Junto do original"; } else $("#destBtn").classList.add("notranslate");
    $("#convert").disabled = busy || !waiting;
    $("#convertText").textContent = waiting > 1 ? `Converter ${waiting} arquivos` : "Converter";
    $("#convert").hidden = busy; $("#cancelAll").hidden = !busy;
    $("#clearAll").hidden = !S.items.length || busy;
    $("#clearDone").hidden = !S.items.some((i) => i.state === "done") || busy;
    $("#totalBar").hidden = !busy;
    if (busy) {
      const b = S.running.batch, done = b.reduce((s, i) => s + (["done", "error", "canceled"].includes(i.state) ? 1 : i.state === "running" ? i.progress : 0), 0);
      $("#totalBar").firstElementChild.style.width = (100 * done / b.length) + "%";
      $("#totalText").textContent = `${b.filter((i) => i.state === "done").length} de ${b.length}`;
    } else $("#totalText").textContent = "";
  }
  function renderAll(side = true) { renderList(); renderBulk(); renderFoot(); renderSide(side); }

  // ---------------------------------------------------------------- painel do arquivo escolhido
  function select(id) { if (S.sel === id) return; S.sel = id; for (const i of S.items) if (i.el) i.el.classList.toggle("sel", i.id === id); renderSide(true); }
  let previewOf = null;
  function renderSide(refreshPreview) {
    const it = byId(S.sel), side = $("#side");
    if (!it) { dropPreview(); side.replaceChildren(h("div", { class: "side-empty" }, "Escolha um arquivo para ver a prévia e as opções.")); return; }
    if (previewOf !== it.id || !side.querySelector(".prev")) {
      dropPreview();
      side.replaceChildren(h("div", { class: "prev" }), h("div", { class: "body" }));
      previewOf = it.id;
      preview(it, side.querySelector(".prev")).catch((e) => { if (previewOf === it.id) side.querySelector(".prev").replaceChildren(h("p", { class: "hint", style: "padding:20px;text-align:center" }, e.message)); });
    }
    const body = side.querySelector(".body"), parts = [h("div", {}, h("div", { class: "name notranslate" }, it.src.name), h("div", { class: "facts" }, it.facts || ""))];
    if (it.state === "done") {
      parts.push(h("div", { class: "p-section" }, "Resultado"), h("div", { class: "notranslate facts" }, it.result.group || it.result.files[0].path),
        h("div", { class: "openers" }, h("button", { class: "btn sm", onclick: () => FP.call("show-item", it.result.files[0].path) }, icon("folder-open"), "Mostrar na pasta"), ...(it.openers || []).map((o) => h("button", { class: "btn sm ghost", onclick: guard(() => FP.call("open-in", o.id, it.result.files[0].path)) }, icon("square-arrow-out-up-right"), o.name))));
      for (const n of it.result.notes) parts.push(h("div", { class: "p-banner" }, icon("triangle-alert"), h("div", { class: "grow" }, n)));
    }
    if (it.state === "error") parts.push(h("div", { class: "error-box" }, it.error));
    const list = schema(it.src.kind, it.to), shared = list.filter((s) => !s.own), own = list.filter((s) => s.own), locked = it.state === "running" || it.state === "queued";
    if (shared.length) parts.push(h("div", { class: "p-section" }, "Opções"), ...shared.map((s) => field(it, s, locked)), S.items.some((x) => x !== it && optKey(x) === optKey(it)) ? h("p", { class: "hint" }, "Valem para todos os arquivos com a mesma conversão.") : null);
    if (own.length) parts.push(h("div", { class: "p-section" }, "Só este arquivo"), ...own.map((s) => field(it, s, locked)));
    if (it.src.kind === "video" && F.kind("video").outputs.slice(0, 4).includes(it.to) && (optionsOf(it).quality || "auto") === "auto") parts.push(h("p", { class: "hint" }, "Automática: quando dá, só troca o formato sem recodificar. É rápido e não perde qualidade."));
    body.replaceChildren(...parts.filter(Boolean));
  }
  function field(it, s, locked) {
    const key = optKey(it), cur = s.own ? it.own[s.id] : (S.prefs.options[key] || {})[s.id] ?? s.def;
    const set = (v) => {
      if (s.own) { if (v === undefined || v === "") delete it.own[s.id]; else it.own[s.id] = v; }
      else savePrefs({ options: { ...S.prefs.options, [key]: { ...(S.prefs.options[key] || {}), [s.id]: v } } });
      for (const x of S.items) if (x.state === "done" && (s.own ? x === it : optKey(x) === key)) { reset(x); updateRow(x); } // mudou: pode converter de novo
      renderFoot();
    };
    const id = "o-" + s.id, wrap = (...c) => h("div", { class: "opt" }, h("label", { for: id }, s.label), ...c);
    switch (s.type) {
      case "select": { const list = typeof s.list === "function" ? s.list(it.to) : s.list, el = h("select", { id, disabled: locked, onchange: (e) => { set(e.target.value); if (s.id === "quality") renderSide(false); } }, list.map(([v, t]) => h("option", { value: v }, t))); el.value = list.some(([v]) => v === String(cur)) ? String(cur) : s.def; return wrap(el); }
      case "range": { const out = h("output", {}, String(cur)); return wrap(h("div", { class: "rng" }, h("input", { id, type: "range", min: s.min, max: s.max, value: cur, disabled: locked, oninput: (e) => { out.textContent = e.target.value; }, onchange: (e) => set(Number(e.target.value)) }), out)); }
      case "color": return wrap(h("input", { id, type: "color", value: cur, disabled: locked, onchange: (e) => set(e.target.value) }));
      case "switch": return h("div", { class: "opt" }, h("span", {}, s.label), h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !!cur, disabled: locked, "aria-label": s.label, onchange: (e) => set(e.target.checked) }), h("span")));
      case "number": return wrap(h("input", { id, type: "number", step: s.step || 1, value: cur, disabled: locked, onchange: (e) => set(Number(e.target.value) || 0) }));
      case "text": return wrap(h("input", { id, type: "text", value: cur || "", placeholder: s.placeholder, disabled: locked, onchange: (e) => set(e.target.value.trim()) }));
      case "at": return wrap(h("input", { id, type: "number", min: 0, step: 0.1, value: cur ?? 0, disabled: locked, onchange: (e) => set(Math.max(0, Number(e.target.value) || 0)) }));
      case "trim": {
        const put = (k) => (e) => { const v = parseTime(e.target.value); if (v === null) { e.target.value = ""; delete it.own[k]; } else it.own[k] = v; set(undefined); };
        const show = (v) => (v === undefined ? "" : String(v));
        return wrap(h("div", { class: "pair" }, h("input", { id, type: "text", placeholder: "0:00", title: "Início (segundos ou m:s)", value: show(it.own.start), disabled: locked, onchange: put("start") }), h("input", { type: "text", placeholder: it.duration ? time(it.duration) : "0:00", title: "Fim (segundos ou m:s)", value: show(it.own.end), disabled: locked, onchange: put("end") })));
      }
    }
    return null;
  }
  // "90", "1:30" ou "1:02:03,5" em segundos
  function parseTime(s) {
    s = String(s).trim().replace(",", ".");
    if (!/^(\d+:){0,2}\d+(\.\d+)?$/.test(s)) return null;
    return s.split(":").reduce((a, b) => a * 60 + Number(b), 0);
  }
  FP.parseTime = parseTime;

  // ---------------------------------------------------------------- prévia
  function dropPreview() { if (S.view) S.view.dispose(); S.view = null; previewOf = null; }
  const facts = (it, ...f) => { it.facts = f.filter(Boolean).join(" · "); const el = $("#side .facts"); if (el && S.sel === it.id) el.textContent = it.facts; };
  async function preview(it, host) {
    const src = it.src, still = () => previewOf === it.id;
    facts(it, bytes(src.size));
    host.append(h("i", { class: "big i i-" + F.kind(src.kind).icon }));
    if (src.kind === "image") {
      if (src.size > 150e6) return;
      host.classList.add("checker");
      const list = THUMB_IMG.includes(src.ext) ? null : await FP.decodeImage(src, { maxSize: 1024 });
      if (!still()) return;
      if (list) { const c = FP.resizeCanvas(list[0], 680), o = h("canvas", { width: c.width, height: c.height }); o.getContext("2d").drawImage(c, 0, 0); host.replaceChildren(o); facts(it, `${list[0].width} × ${list[0].height}`, bytes(src.size)); return; }
      const img = h("img", { src: src.address(), alt: "" });
      img.onload = () => { if (still() && img.naturalWidth) facts(it, `${img.naturalWidth} × ${img.naturalHeight}`, bytes(src.size)); };
      img.onerror = () => host.replaceChildren(h("i", { class: "big i i-image" }));
      host.replaceChildren(img);
    } else if (src.kind === "video" || src.kind === "audio") {
      const el = h(src.kind, { src: src.address(), controls: true, preload: "metadata" });
      el.onerror = () => { if (still()) host.replaceChildren(h("i", { class: "big i i-" + F.kind(src.kind).icon })); };
      host.replaceChildren(el);
      const p = await FP.probe(src);
      it.duration = p.duration;
      if (still()) { facts(it, p.width ? `${p.width} × ${p.height}` : "", time(p.duration), [p.vcodec, p.acodec].filter(Boolean).join(" + ").toUpperCase(), bytes(src.size)); renderSide(false); }
    } else if (src.kind === "model") {
      if (src.size > 300e6) return;
      host.replaceChildren(h("span", { class: "spin" }));
      const view = new FP.ModelView(host);
      S.view = view;
      const r = await view.show(src);
      if (!r || !still()) return;
      const n = (v) => v.toLocaleString(LOCALE), d = (v) => v.toLocaleString(LOCALE, { maximumFractionDigits: 2 });
      facts(it, `${n(r.tris)} triângulos`, `${d(r.size.x)} × ${d(r.size.y)} × ${d(r.size.z)}`, bytes(src.size));
    } else if (src.kind === "pdf") {
      const pdf = await FP.openPdf(src);
      const c = await FP.renderPdfPage(pdf, 1, 1);
      if (still()) { host.replaceChildren(c); facts(it, pdf.numPages === 1 ? "1 página" : `${pdf.numPages} páginas`, bytes(src.size)); }
      await pdf.loadingTask.destroy().catch(() => {});
    } else if (src.kind === "font") {
      const face = new FontFace("fp-preview-" + it.id, await (await src.blob()).arrayBuffer());
      await face.load();
      document.fonts.add(face);
      if (still()) host.replaceChildren(h("div", { class: "sample notranslate", style: `font-family:"fp-preview-${it.id}"` }, "AaBbÇç 0123 Arasaka"));
    } else {
      const t = src.size > 5e6 ? "" : (await src.text()).slice(0, 4000);
      if (still() && t) host.replaceChildren(h("pre", { class: "notranslate" }, t));
    }
  }

  // ---------------------------------------------------------------- fila
  async function convert(only) {
    if (S.running) { // a IA pode pedir no meio: entra no fim da fila
      for (const i of only || []) { i.state = "queued"; S.running.batch.push(i); }
      renderAll(false);
      return S.running.promise;
    }
    const batch = (only || S.items).filter((i) => i.state === "idle");
    if (!batch.length) return;
    let finish;
    S.running = { batch, promise: new Promise((r) => { finish = r; }) };
    S.stop = false;
    for (const i of batch) i.state = "queued";
    FP.call("busy", true).catch(() => {});
    renderAll(false);
    for (let n = 0; n < batch.length; n++) {
      const it = batch[n];
      if (it.state !== "queued") continue;
      if (S.stop || !S.items.includes(it)) { it.state = S.stop ? "idle" : "canceled"; if (it.el) updateRow(it); continue; }
      // imagens -> um PDF só
      const merged = it.to === "pdf" && it.src.kind === "image" && optionsOf(it).merge ? batch.slice(n).filter((x) => x.state === "queued" && x.to === "pdf" && x.src.kind === "image" && x.outDir === it.outDir && S.items.includes(x)) : [it];
      await run(merged);
    }
    const ok = batch.filter((i) => i.state === "done").length, failed = batch.filter((i) => i.state === "error").length;
    S.running = null;
    FP.call("busy", false).catch(() => {});
    renderAll(false);
    if (ok || failed) FP.call("finished", { ok, failed }).catch(() => {});
    finish();
  }
  async function run(list) {
    const it = list[0];
    const job = new FP.Job({ sources: list.map((x) => x.src), to: it.to, opts: optionsOf(it), outDir: it.outDir, onProgress: (p) => tick(list, p) });
    for (const x of list) { x.state = "running"; x.job = job; x.progress = 0; updateRow(x); }
    renderFoot(); renderSide(false);
    try {
      const r = await job.run();
      for (const x of list) Object.assign(x, { state: "done", progress: 1, result: r });
      for (const f of r.files) FP.call("done", { path: f.path, ...r.meta }).catch(() => {});
      const kind = F.mediaKind(r.files[0].path);
      if (kind) { const o = await FP.call("openers", kind).catch(() => []); for (const x of list) x.openers = o; }
    } catch (e) {
      const canceled = e instanceof FP.Canceled;
      if (!canceled) console.error(e);
      for (const x of list) Object.assign(x, { state: canceled ? "canceled" : "error", error: canceled ? null : (e && e.message) || "Erro desconhecido" });
    }
    for (const x of list) { x.job = null; if (x.el) updateRow(x); }
    renderFoot();
    if (list.some((x) => x.id === S.sel)) renderSide(false);
  }
  let lastTick = 0;
  function tick(list, p) {
    for (const x of list) x.progress = p;
    const now = performance.now();
    if (now - lastTick < 80 && p < 1) return;
    lastTick = now;
    for (const x of list) if (x.el && x.state === "running") {
      x.el.querySelector(".progress > i").style.width = Math.round(p * 100) + "%";
      const t = x.el.querySelector(".sub .num");
      if (t) t.textContent = Math.round(p * 100) + "%";
    }
    renderFoot();
  }
  function stopAll() {
    S.stop = true;
    for (const i of S.items) { if (i.state === "running" && i.job) i.job.cancel(); }
  }

  // ---------------------------------------------------------------- formatos e ajustes
  function renderFormats() {
    $("#fmtGrid").replaceChildren(...F.KINDS.map((k) => h("div", { class: "card flat" }, h("div", { class: "card-title" }, icon(k.icon), h("span", {}, k.label)),
      h("span", { class: "hint" }, "Abre"), h("div", { class: "tags notranslate" }, k.inputs.map((e) => h("span", { class: "tag" }, e))),
      h("span", { class: "hint" }, "Converte para"), h("div", { class: "tags notranslate" }, (k.id === "image" ? [...k.outputs, "mp4", "webm"] : k.outputs).map((e) => h("span", { class: "tag out" }, e))),
      k.id === "image" ? h("p", { class: "hint" }, "MP4 e WebM: só de imagens animadas (GIF).") : null)));
  }
  function renderSettings() {
    for (const b of document.querySelectorAll("#outMode button")) b.classList.toggle("on", b.dataset.v === S.prefs.outMode);
    $("#outDirText").textContent = S.prefs.outDir;
    $("#optLib").checked = S.prefs.addToLibrary; $("#optNotify").checked = S.prefs.notify;
  }
  const setPref = guard(async (patch) => { S.prefs = { ...S.prefs, ...(await FP.call("prefs", patch)) }; renderSettings(); renderFoot(); });

  // ---------------------------------------------------------------- comandos
  const pick = guard(async (ch) => receive(await FP.call(ch)));
  $("#addFiles").onclick = () => pick("pick-files");
  $("#addFolder").onclick = () => pick("pick-folder");
  $("#addLibrary").onclick = () => pick("pick-library");
  $("#convert").onclick = () => convert();
  $("#cancelAll").onclick = stopAll;
  $("#clearAll").onclick = () => { for (const i of S.items) i.src.release(); S.items = []; S.sel = null; renderAll(); };
  $("#clearDone").onclick = () => { for (const i of S.items) if (i.state === "done") i.src.release(); S.items = S.items.filter((i) => i.state !== "done"); if (!byId(S.sel)) S.sel = S.items.length ? S.items[0].id : null; renderAll(); };
  const pickOut = guard(async () => { const p = await FP.call("pick-out-dir"); if (p) { S.prefs = { ...S.prefs, ...p }; renderSettings(); renderFoot(); } });
  $("#destBtn").onclick = pickOut; $("#pickOut").onclick = pickOut;
  $("#openDest").onclick = guard(() => FP.call("open-dir"));
  $("#outMode").onclick = (e) => { const b = e.target.closest("button"); if (b) setPref({ outMode: b.dataset.v }); };
  $("#optLib").onchange = (e) => setPref({ addToLibrary: e.target.checked });
  $("#optNotify").onchange = (e) => setPref({ notify: e.target.checked });
  $("#resetOpts").onclick = () => { savePrefs({ options: {} }); renderSide(false); toast("Opções restauradas", "ok"); };
  $("#tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    for (const t of document.querySelectorAll("#tabs .tab")) t.classList.toggle("active", t === b);
    for (const t of ["convert", "formats", "settings"]) $("#tab-" + t).hidden = t !== b.dataset.tab;
  };
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.ctrlKey && e.key.toLowerCase() === "o") { e.preventDefault(); pick("pick-files"); }
    else if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); convert(); }
    else if (!typing && e.key === "Delete") { const it = byId(S.sel); if (it && it.state !== "running") remove(it); }
    else if (!typing && (e.key === "ArrowDown" || e.key === "ArrowUp") && S.items.length) {
      e.preventDefault();
      const n = S.items.findIndex((i) => i.id === S.sel) + (e.key === "ArrowDown" ? 1 : -1), it = S.items[Math.max(0, Math.min(S.items.length - 1, n))];
      select(it.id); it.el.scrollIntoView({ block: "nearest" });
    }
  });

  // soltar arquivos e pastas (a página não recebe o caminho: lê o conteúdo e salva na pasta fixa)
  async function filesFrom(dt) {
    const out = [], entries = [...dt.items].filter((i) => i.kind === "file").map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)), direct = [...dt.files];
    const walk = async (en, depth) => {
      if (!en || out.length >= 4000 || depth > 8) return;
      if (en.isFile) out.push(await new Promise((ok, no) => en.file(ok, no)));
      else { const rd = en.createReader(); for (;;) { const l = await new Promise((ok, no) => rd.readEntries(ok, no)); if (!l.length) break; for (const x of l) await walk(x, depth + 1); } }
    };
    if (entries.some(Boolean)) for (const en of entries) await walk(en, 0); else out.push(...direct);
    return out;
  }
  function addFiles(files) {
    const siblings = new Map(files.map((f) => [f.name.toLowerCase(), f])); // texturas e .mtl soltos junto do modelo
    const hasModel = files.some((f) => F.kindOf(f.name) === "model");
    const MODEL_ONLY = new Set(["mtl", "bin"]);
    const good = files.filter((f) => F.kindOf(f.name)), bad = files.filter((f) => !F.kindOf(f.name) && !(hasModel && MODEL_ONLY.has(F.ext(f.name))));
    receive({ files: good.map((f) => new FP.Source({ name: f.name, size: f.size, file: f, siblings })), skipped: good.length ? (files.length > 50 ? 0 : bad.length) : files.length });
  }
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer ? e.dataTransfer.types : [])].includes("Files");
  addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $("#drop").hidden = false; });
  addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; $("#drop").hidden = true; } });
  addEventListener("dragover", (e) => { e.preventDefault(); if (hasFiles(e)) e.dataTransfer.dropEffect = "copy"; });
  addEventListener("drop", guard(async (e) => { e.preventDefault(); depth = 0; $("#drop").hidden = true; if (hasFiles(e)) { showConvert(); addFiles(await filesFrom(e.dataTransfer)); } }));
  addEventListener("paste", (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (!files.length) return;
    e.preventDefault(); showConvert();
    addFiles(files.map((f) => (f.name === "image.png" ? new File([f], "Imagem colada.png", { type: f.type }) : f)));
  });
  const showConvert = () => document.querySelector('[data-tab="convert"]').click();

  // ---------------------------------------------------------------- eventos do motor
  piphin.on("add-files", ({ files, from }) => { showConvert(); const a = addSources(files); if (a.length) { select(a[0].id); if (from) toast(`Arquivo recebido do ${from}`, "ok"); } });
  piphin.on("tool-convert", async ({ id, files, to, outDir, options }) => {
    showConvert();
    const forced = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== null));
    const items = addSources(files, { to, forced: { ...forced, merge: to === "pdf" && files.length > 1 }, outDir });
    await convert(items);
    FP.call("job-result", id, items.map((i) => ({ source: i.src.path, status: i.state, output: i.result ? i.result.group || i.result.files[0].path : undefined, notes: i.result && i.result.notes.length ? i.result.notes : undefined, error: i.error || undefined }))).catch(() => {});
  });

  // usados nos testes automáticos
  FP.app = { S, addSources, addFiles, convert, stopAll, select, schema, optionsOf, renderAll };

  guard(async () => {
    const r = await FP.call("ui-ready");
    S.prefs = { ...S.prefs, ...r.prefs }; S.library = r.library;
    $("#addLibrary").hidden = !r.library;
    renderFormats(); renderSettings(); renderAll();
    if (r.inbox.length) addSources(r.inbox);
    FP.ready = true;
  })();
})();
