// Arasaka Faceplate · base dos conversores: ler o arquivo de origem, gravar o resultado em pedaços e cancelar no meio.
"use strict";
(() => {
  const FP = (window.FP = window.FP || {});

  FP.call = async (ch, ...args) => {
    const r = await piphin.invoke(ch, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };

  // bibliotecas de terceiros: só carregam quando um conversor precisa
  const loaded = new Map();
  FP.vendor = (...names) => names.reduce((p, name) => p.then(() => {
    if (!loaded.has(name)) loaded.set(name, new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = `vendor/${name}.js`;
      s.onload = ok;
      s.onerror = () => { loaded.delete(name); no(new Error("Não deu para carregar " + name)); };
      document.head.append(s);
    }));
    return loaded.get(name);
  }), Promise.resolve());

  FP.Canceled = class extends Error { constructor() { super("Cancelado"); this.name = "Canceled"; } };
  // deixa a tela respirar sem setTimeout (que o Chromium segura quando o módulo não está à vista)
  const ch = new MessageChannel(), queue = [];
  ch.port1.onmessage = () => queue.shift()();
  FP.breathe = () => new Promise((r) => { queue.push(r); ch.port2.postMessage(0); });

  // ---------------------------------------------------------------- origem: arquivo do disco (url) ou solto na tela (File)
  FP.Source = class {
    constructor({ name, size, url = null, assetBase = null, path = null, file = null, siblings = null }) {
      Object.assign(this, { name, size, url, assetBase, path, file, siblings });
      this.ext = FP.formats.ext(name);
      this.base = name.replace(/\.[^.]+$/, "");
      this.kind = FP.formats.kindOf(name);
      this.mime = FP.formats.MIME[this.ext] || "application/octet-stream";
    }
    async blob() {
      if (this.file) return this.file.slice(0, this.file.size, this.mime);
      const r = await fetch(this.url);
      if (!r.ok) throw new Error("O arquivo não existe mais ou não pode ser lido");
      return (await r.blob()).slice(0, undefined, this.mime);
    }
    async bytes() { return new Uint8Array(await (await this.blob()).arrayBuffer()); }
    async text() {
      const b = await this.bytes();
      if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
      if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
      try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } // já tira o BOM
      catch { return new TextDecoder("windows-1252").decode(b); } // texto antigo do Windows (acentos)
    }
    // endereço para tocar ou ver; com File é preciso liberar depois
    address() { return this.url || (this._obj = this._obj || URL.createObjectURL(this.file)); }
    release() { if (this._obj) URL.revokeObjectURL(this._obj); this._obj = null; }
    // textura, material ou buffer citado por um objeto 3D
    asset(rel) {
      const clean = decodeURIComponentSafe(String(rel)).replace(/\\/g, "/");
      if (this.assetBase) return this.assetBase + "?p=" + encodeURIComponent(clean);
      const f = this.siblings && this.siblings.get(clean.split("/").pop().toLowerCase());
      return f ? (f._fpUrl = f._fpUrl || URL.createObjectURL(f)) : null;
    }
  };
  const decodeURIComponentSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  // ---------------------------------------------------------------- um trabalho: origem(ns) -> destino
  const SLICE = 8 * 1024 * 1024;
  FP.Job = class {
    constructor({ src, sources, to, opts, outDir, onProgress }) {
      Object.assign(this, { src: src || sources[0], sources: sources || [src], to, opts: opts || {}, outDir });
      this.onProgress = onProgress || (() => {});
      this.canceled = false; this.cancelers = new Set(); this.open = new Set(); this.files = []; this.groupId = null; this.groupPath = null; this.notes = [];
    }
    check() { if (this.canceled) throw new FP.Canceled(); }
    cancel() { this.canceled = true; for (const f of this.cancelers) try { f(); } catch { /* já terminou */ } }
    progress(v) { this.onProgress(Math.max(0, Math.min(1, v || 0))); }
    note(text) { if (!this.notes.includes(text)) this.notes.push(text); }

    // várias saídas (páginas, texturas): vão para uma pasta própria com o nome do arquivo
    async group(name) {
      const g = await FP.call("group-begin", { name: name || this.src.base, srcPath: this.src.path, outDir: this.outDir });
      this.groupId = g.id; this.groupPath = g.path;
    }
    async begin(ext, name) {
      this.check();
      const o = await FP.call("out-begin", { name: name || this.src.base, ext: ext || this.to, srcPath: this.src.path, outDir: this.outDir, group: this.groupId });
      this.open.add(o.id);
      return o.id;
    }
    async end(id) {
      const f = await FP.call("out-end", id);
      this.open.delete(id);
      this.files.push(f);
      return f;
    }
    // grava bytes, Blob ou texto de uma vez
    async save(data, ext, name) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const id = await this.begin(ext, name);
      for (let p = 0; p < blob.size; p += SLICE) {
        this.check();
        await FP.call("out-write", id, new Uint8Array(await blob.slice(p, p + SLICE).arrayBuffer()), p);
      }
      return this.end(id);
    }
    // gravação contínua para a Mediabunny (vídeos de vários GB sem ficar na memória)
    async stream(ext, name) {
      const id = await this.begin(ext, name);
      return { finish: () => this.end(id), writable: new WritableStream({ write: async (c) => { await FP.call("out-write", id, c.data, c.position); } }) };
    }
    async run() {
      try {
        const meta = await FP.converters[this.src.kind](this);
        this.check();
        if (this.groupId) await FP.call("group-end", this.groupId);
        return { files: this.files, group: this.groupPath, meta: meta || {}, notes: this.notes };
      } catch (e) {
        for (const id of this.open) await FP.call("out-abort", id).catch(() => {});
        if (this.groupId) await FP.call("group-abort", this.groupId).catch(() => {});
        throw this.canceled ? new FP.Canceled() : e;
      }
    }
  };
  FP.converters = {};
})();
