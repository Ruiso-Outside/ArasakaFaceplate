// Arasaka Faceplate · imagens: decodifica (Chromium, HEIC, TIFF, TGA, SVG, animações), redimensiona e codifica.
"use strict";
(() => {
  const MAX_SIDE = 16384, MAX_AREA = 16384 * 8192;
  const canvasOf = (w, h) => {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) throw new Error("A imagem é grande demais para este PC converter");
    return new OffscreenCanvas(w, h);
  };
  const fromData = (w, h, rgba) => {
    const c = canvasOf(w, h);
    c.getContext("2d").putImageData(new ImageData(rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
    return c;
  };
  const toCanvas = (img, w = img.width, h = img.height) => { const c = canvasOf(w, h); c.getContext("2d").drawImage(img, 0, 0, w, h); return c; };

  // ---------------------------------------------------------------- abrir
  async function heic(src) {
    await FP.vendor("heif");
    const list = new Libheif.HeifDecoder().decode(await src.bytes());
    if (!list || !list.length) throw new Error("Não deu para ler este HEIC");
    const img = list[0], w = img.get_width(), h = img.get_height();
    const data = new ImageData(w, h);
    await new Promise((ok, no) => img.display(data, (d) => (d ? ok() : no(new Error("Não deu para decodificar este HEIC")))));
    for (const i of list) i.free && i.free();
    return fromData(w, h, data.data);
  }

  async function tiff(src) {
    await FP.vendor("utif");
    const buf = (await src.bytes()).buffer;
    const pages = [];
    for (const ifd of UTIF.decode(buf)) {
      if (!ifd.t256) continue;
      UTIF.decodeImage(buf, ifd);
      if (!ifd.width || !ifd.data || !ifd.data.length) continue;
      pages.push(fromData(ifd.width, ifd.height, UTIF.toRGBA8(ifd)));
    }
    if (!pages.length) throw new Error("Não deu para ler este TIFF");
    return pages;
  }

  // TGA: 8 bits com paleta ou cinza, 16, 24 e 32 bits, com ou sem RLE
  async function tga(src) {
    const b = await src.bytes(), v = new DataView(b.buffer);
    const idLen = b[0], mapType = b[1], type = b[2], mapLen = v.getUint16(5, true), mapBits = b[7], w = v.getUint16(12, true), h = v.getUint16(14, true), bits = b[16], desc = b[17];
    const rle = type >= 9, kind = rle ? type - 8 : type;
    if (![1, 2, 3].includes(kind) || ![8, 15, 16, 24, 32].includes(bits) || !w || !h) throw new Error("Este tipo de TGA não é suportado");
    let p = 18 + idLen;
    const pal = p, palStep = Math.ceil(mapBits / 8);
    if (mapType === 1) p += mapLen * palStep;
    const step = Math.ceil(bits / 8), out = new Uint8ClampedArray(w * h * 4);
    const put = (at, off, n) => {
      if (n === 1) { out[at] = out[at + 1] = out[at + 2] = b[off]; out[at + 3] = 255; }
      else if (n === 2) { const c = b[off] | (b[off + 1] << 8); out[at] = ((c >> 10) & 31) * 255 / 31; out[at + 1] = ((c >> 5) & 31) * 255 / 31; out[at + 2] = (c & 31) * 255 / 31; out[at + 3] = 255; }
      else { out[at] = b[off + 2]; out[at + 1] = b[off + 1]; out[at + 2] = b[off]; out[at + 3] = n === 4 ? b[off + 3] : 255; }
    };
    const pixel = (i, off) => {
      const x = i % w, y = (i / w) | 0, at = ((desc & 32 ? y : h - 1 - y) * w + (desc & 16 ? w - 1 - x : x)) * 4;
      if (kind === 1) put(at, pal + (step === 2 ? b[off] | (b[off + 1] << 8) : b[off]) * palStep, palStep); else put(at, off, step);
    };
    for (let i = 0; i < w * h && p < b.length;) {
      if (!rle) { pixel(i++, p); p += step; continue; }
      const head = b[p++], n = (head & 127) + 1;
      if (head & 128) { for (let k = 0; k < n && i < w * h; k++) pixel(i++, p); p += step; }
      else for (let k = 0; k < n && i < w * h; k++) { pixel(i++, p); p += step; }
    }
    return fromData(w, h, out);
  }

  function loadImg(blob) {
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => { ok(img); setTimeout(() => URL.revokeObjectURL(url), 2000); };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error("Não deu para abrir esta imagem (arquivo corrompido ou formato desconhecido)")); };
      img.src = url;
    });
  }

  // SVG: desenha já no tamanho pedido, sem perder nitidez. Sem width/height, vale o viewBox.
  async function svg(src, maxSize) {
    const doc = new DOMParser().parseFromString(await src.text(), "image/svg+xml"), el = doc.documentElement;
    if (el.nodeName.toLowerCase() !== "svg") throw new Error("SVG inválido");
    const px = (s) => (s && !/%$/.test(s) ? parseFloat(s) : 0) || 0;
    const vb = (el.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    let w = px(el.getAttribute("width")), h = px(el.getAttribute("height"));
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      if (!w && !h) { w = vb[2]; h = vb[3]; } else if (!w) w = h * vb[2] / vb[3]; else if (!h) h = w * vb[3] / vb[2];
    }
    w = w || 1024; h = h || 1024;
    if (!el.getAttribute("viewBox")) el.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const k = maxSize > 0 ? maxSize / Math.max(w, h) : Math.max(w, h) < 512 ? 1024 / Math.max(w, h) : 1;
    el.setAttribute("width", w * k); el.setAttribute("height", h * k);
    const img = await loadImg(new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" }));
    return toCanvas(img, w * k, h * k);
  }

  // uma imagem parada (o primeiro quadro das animadas); TIFF pode ter várias páginas
  FP.decodeImage = async (src, opts = {}) => {
    const e = FP.formats.normalize(src.ext);
    if (e === "heic") return [await heic(src)];
    if (e === "tiff") return tiff(src);
    if (e === "tga") return [await tga(src)];
    if (e === "svg") return [await svg(src, opts.maxSize || 0)];
    const blob = await src.blob();
    let img;
    try { img = await createImageBitmap(blob); } catch { img = await loadImg(blob); }
    return [toCanvas(img, img.naturalWidth || img.width, img.naturalHeight || img.height)];
  };

  // quadros de GIF, WebP, AVIF e PNG animados: { count, decode(i) -> { canvas, ms } } ou null se for parada
  async function animation(src) {
    if (!["gif", "webp", "avif", "png"].includes(src.ext) || !window.ImageDecoder || !(await ImageDecoder.isTypeSupported(src.mime))) return null;
    const dec = new ImageDecoder({ data: (await src.blob()).stream(), type: src.mime });
    try {
      await dec.tracks.ready; await dec.completed;
      const tr = dec.tracks.selectedTrack;
      if (!tr || tr.frameCount < 2) { dec.close(); return null; }
      return { count: tr.frameCount, close: () => dec.close(), decode: async (i) => {
        const { image } = await dec.decode({ frameIndex: i });
        const ms = image.duration ? image.duration / 1000 : 100, canvas = toCanvas(image, image.displayWidth, image.displayHeight);
        image.close();
        return { canvas, ms: ms < 20 ? 100 : ms };
      } };
    } catch { dec.close(); return null; }
  }

  // ---------------------------------------------------------------- mudar
  // reduz pela metade em passos (evita serrilhado) e nunca aumenta
  function resize(c, maxSize) {
    const side = Math.max(c.width, c.height);
    if (!(maxSize > 0) || side <= maxSize) return c;
    const W = Math.max(1, Math.round(c.width * maxSize / side)), H = Math.max(1, Math.round(c.height * maxSize / side));
    return scaleTo(c, W, H);
  }
  function scaleTo(c, W, H) {
    const draw = (from, w, h) => { const o = canvasOf(w, h), x = o.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(from, 0, 0, w, h); return o; };
    while (c.width > W * 2 && c.height > H * 2) c = draw(c, c.width >> 1, c.height >> 1);
    return c.width === W && c.height === H ? c : draw(c, W, H);
  }
  function flatten(c, color) {
    const o = canvasOf(c.width, c.height), x = o.getContext("2d");
    x.fillStyle = color || "#ffffff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
    return o;
  }
  const pixels = (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  Object.assign(FP, { copyCanvas: (c) => toCanvas(c), resizeCanvas: resize, scaleCanvas: scaleTo, flattenCanvas: flatten });

  // ---------------------------------------------------------------- codificar
  function bmp(c) {
    const { width: w, height: h } = c, d = pixels(c), row = (w * 3 + 3) & ~3, out = new Uint8Array(54 + row * h), v = new DataView(out.buffer);
    out[0] = 66; out[1] = 77; v.setUint32(2, out.length, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
    v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
    for (let y = 0; y < h; y++) for (let x = 0, p = 54 + (h - 1 - y) * row, s = y * w * 4; x < w; x++, p += 3, s += 4) { out[p] = d[s + 2]; out[p + 1] = d[s + 1]; out[p + 2] = d[s]; }
    return out;
  }
  function tgaOut(c) {
    const { width: w, height: h } = c, d = pixels(c), out = new Uint8Array(18 + w * h * 4);
    out[2] = 2; out[12] = w & 255; out[13] = w >> 8; out[14] = h & 255; out[15] = h >> 8; out[16] = 32; out[17] = 0x28;
    for (let i = 0, p = 18; i < d.length; i += 4, p += 4) { out[p] = d[i + 2]; out[p + 1] = d[i + 1]; out[p + 2] = d[i]; out[p + 3] = d[i + 3]; }
    return out;
  }
  // ICO com vários tamanhos (cada um em PNG, como o Windows aceita desde o Vista)
  const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
  async function ico(c) {
    const side = Math.max(c.width, c.height), square = canvasOf(side, side);
    square.getContext("2d").drawImage(c, (side - c.width) / 2, (side - c.height) / 2);
    const sizes = ICO_SIZES.filter((s) => s <= Math.max(16, side));
    const pngs = [];
    for (const s of sizes) pngs.push(new Uint8Array(await (await scaleTo(square, s, s).convertToBlob({ type: "image/png" })).arrayBuffer()));
    const head = new Uint8Array(6 + 16 * sizes.length), v = new DataView(head.buffer);
    v.setUint16(2, 1, true); v.setUint16(4, sizes.length, true);
    let off = head.length;
    sizes.forEach((s, i) => {
      const p = 6 + i * 16;
      head[p] = head[p + 1] = s & 255; v.setUint16(p + 4, 1, true); v.setUint16(p + 6, 32, true); v.setUint32(p + 8, pngs[i].length, true); v.setUint32(p + 12, off, true);
      off += pngs[i].length;
    });
    return new Blob([head, ...pngs]);
  }

  // GIF quadro a quadro, com paleta própria em cada quadro; serve também para vídeo -> GIF
  FP.gifWriter = async () => {
    await FP.vendor("gifenc");
    const enc = Gifenc.GIFEncoder();
    return {
      add(c, ms) {
        const d = pixels(c);
        let clear = false;
        for (let i = 3; i < d.length; i += 4) if (d[i] < 128) { clear = true; break; }
        const format = clear ? "rgba4444" : "rgb565";
        if (clear) for (let i = 3; i < d.length; i += 4) { if (d[i] < 128) d[i] = d[i - 1] = d[i - 2] = d[i - 3] = 0; else d[i] = 255; }
        const palette = Gifenc.quantize(d, 256, { format, oneBitAlpha: clear });
        const index = Gifenc.applyPalette(d, palette, format);
        const ti = clear ? palette.findIndex((p) => p[3] === 0) : -1;
        enc.writeFrame(index, c.width, c.height, { palette, delay: ms, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: ti >= 0 ? 2 : -1 });
      },
      finish() { enc.finish(); return enc.bytes(); },
    };
  };

  // PDF simples: uma imagem JPEG por página. page: "image" (do tamanho da imagem) ou "a4" (centralizada, com margem)
  FP.pdfFromCanvases = async (list, { quality = 90, page = "image", background } = {}) => {
    const enc = new TextEncoder(), parts = [], offs = [];
    let size = 0;
    const put = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); size += b.length; };
    const obj = (n, body) => { offs[n] = size; put(`${n} 0 obj\n`); for (const b of [].concat(body)) put(b); put("\nendobj\n"); };
    put("%PDF-1.4\n"); put(new Uint8Array([37, 0xe2, 0xe3, 0xcf, 0xd3, 10]));
    const kids = [];
    let n = 3;
    for (const get of list) {
      const c = flatten(await get(), background);
      const jpg = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: quality / 100 })).arrayBuffer());
      let W = c.width * 0.75, H = c.height * 0.75, w = W, h = H, x = 0, y = 0;
      if (page === "a4") {
        [W, H] = c.width > c.height ? [841.89, 595.28] : [595.28, 841.89];
        const k = Math.min((W - 56) / c.width, (H - 56) / c.height, 0.75);
        w = c.width * k; h = c.height * k; x = (W - w) / 2; y = (H - h) / 2;
      } else if (Math.max(W, H) > 14400) { const k = 14400 / Math.max(W, H); W *= k; H *= k; w = W; h = H; } // limite do formato PDF
      const f = (v) => v.toFixed(2), draw = `q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(y)} cm /I Do Q`;
      const [P, C, I] = [n, n + 1, n + 2]; n += 3;
      kids.push(P);
      obj(P, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Contents ${C} 0 R /Resources << /XObject << /I ${I} 0 R >> >> >>`);
      obj(C, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
      obj(I, [`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"]);
    }
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => k + " 0 R").join(" ")}] >>`);
    const xref = size;
    put(`xref\n0 ${n}\n0000000000 65535 f \n` + Array.from({ length: n - 1 }, (_, i) => String(offs[i + 1]).padStart(10, "0") + " 00000 n \n").join(""));
    put(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: "application/pdf" });
  };

  // codifica um canvas no formato pedido (menos PDF, que junta páginas)
  FP.encodeImage = async (c, to, opts = {}) => {
    const q = Math.max(1, Math.min(100, opts.quality || 90)) / 100;
    switch (to) {
      case "png": return c.convertToBlob({ type: "image/png" });
      case "jpg": return flatten(c, opts.background).convertToBlob({ type: "image/jpeg", quality: q });
      case "webp": return c.convertToBlob({ type: "image/webp", quality: q });
      case "bmp": return bmp(flatten(c, opts.background));
      case "tga": return tgaOut(c);
      case "tiff": await FP.vendor("utif"); return new Uint8Array(UTIF.encodeImage(pixels(c), c.width, c.height));
      case "ico": return ico(c);
      case "gif": { const g = await FP.gifWriter(); g.add(c, 100); return g.finish(); }
    }
    throw new Error("Formato de imagem desconhecido: " + to);
  };

  // ---------------------------------------------------------------- conversor
  FP.converters.image = async (job) => {
    const { src, to, opts } = job;
    if (to === "pdf") {
      const pages = [];
      for (const s of job.sources) pages.push(...(await pagesOf(s, opts, job)));
      job.check();
      let i = 0;
      const pdf = await FP.pdfFromCanvases(pages.map((g) => async () => { job.check(); job.progress(i++ / pages.length); return g(); }), { quality: opts.quality, page: opts.page, background: opts.background });
      await job.save(pdf, "pdf", job.sources.length > 1 ? `${src.base} e outras` : src.base);
      return {};
    }
    if (["gif", "mp4", "webm"].includes(to)) {
      const anim = await animation(src);
      if (anim) return animated(job, anim);
      if (to !== "gif") throw new Error("Esta imagem não é animada: não dá para virar vídeo");
    }
    const pages = await FP.decodeImage(src, opts);
    if (pages.length > 1) await job.group(src.base);
    let w = 0, h = 0;
    for (let i = 0; i < pages.length; i++) {
      job.check(); job.progress((i + 0.5) / pages.length);
      const c = resize(pages[i], opts.maxSize);
      w = c.width; h = c.height;
      await job.save(await FP.encodeImage(c, to, opts), to, pages.length > 1 ? `${src.base} ${String(i + 1).padStart(3, "0")}` : src.base);
    }
    return { width: w, height: h };
  };
  // páginas preguiçosas: cada imagem só é aberta na hora de entrar no PDF
  async function pagesOf(s, opts, job) {
    if (FP.formats.normalize(s.ext) === "tiff") return (await FP.decodeImage(s, opts)).map((c) => async () => resize(c, opts.maxSize));
    return [async () => { job.check(); return resize((await FP.decodeImage(s, opts))[0], opts.maxSize); }];
  }

  async function animated(job, anim) {
    const { to, opts } = job;
    try {
      let W = 0, H = 0, t = 0;
      if (to === "gif") {
        const g = await FP.gifWriter();
        for (let i = 0; i < anim.count; i++) {
          job.check();
          const f = await anim.decode(i), c = resize(f.canvas, opts.maxSize);
          W = c.width; H = c.height;
          g.add(c, f.ms);
          job.progress((i + 1) / anim.count); await FP.breathe();
        }
        await job.save(g.finish(), "gif");
        return { width: W, height: H };
      }
      await FP.vendor("mediabunny");
      const MB = Mediabunny, first = resize((await anim.decode(0)).canvas, opts.height || opts.maxSize);
      W = Math.max(2, first.width & ~1); H = Math.max(2, first.height & ~1);
      const canvas = new OffscreenCanvas(W, H), x = canvas.getContext("2d");
      const out = await job.stream(to);
      const output = new MB.Output({ format: to === "mp4" ? new MB.Mp4OutputFormat({ fastStart: false }) : new MB.WebMOutputFormat(), target: new MB.StreamTarget(out.writable, { chunked: true }) });
      const cs = new MB.CanvasSource(canvas, { codec: to === "mp4" ? "avc" : "vp9", bitrate: MB.QUALITY_HIGH });
      output.addVideoTrack(cs);
      await output.start();
      try {
        for (let i = 0; i < anim.count; i++) {
          job.check();
          const f = await anim.decode(i);
          x.fillStyle = opts.background || "#ffffff"; x.fillRect(0, 0, W, H); x.drawImage(f.canvas, 0, 0, W, H);
          await cs.add(t, f.ms / 1000);
          t += f.ms / 1000;
          job.progress((i + 1) / anim.count);
        }
        await output.finalize();
      } catch (e) { await output.cancel().catch(() => {}); throw e; }
      await out.finish();
      return { width: W, height: H, duration: t };
    } finally { anim.close(); }
  }
})();
