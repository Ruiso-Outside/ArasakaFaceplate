// Arasaka Faceplate · vídeos e áudios: Mediabunny + WebCodecs (placa de vídeo quando dá). O que já é compatível com o
// formato de saída é copiado sem recodificar (rápido e sem perder qualidade).
"use strict";
(() => {
  const AUDIO_OUT = { mp3: "mp3", m4a: "aac", wav: "pcm-s16", ogg: "opus", flac: "flac" };
  const VCODEC = { h264: "avc", h265: "hevc", vp9: "vp9", av1: "av1" };

  async function openInput(src) {
    await FP.vendor("mediabunny");
    const MB = Mediabunny;
    const input = new MB.Input({ formats: MB.ALL_FORMATS, source: src.file ? new MB.BlobSource(src.file) : new MB.UrlSource(src.url) });
    try { await input.getFormat(); } catch { input.dispose(); throw new Error("Não deu para abrir este arquivo (corrompido ou formato desconhecido)"); }
    const audio = await input.getPrimaryAudioTrack().catch(() => null);
    if (audio && ["ac3", "eac3"].includes(audio.codec)) await FP.vendor("ac3"); // som de filmes em MKV
    return input;
  }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);

  // informações para a tela: duração, tamanho e codecs
  FP.probe = async (src) => {
    const input = await openInput(src);
    try {
      const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
      return { duration: await input.computeDuration(), width: v ? v.displayWidth : 0, height: v ? v.displayHeight : 0, vcodec: v && v.codec, acodec: a && a.codec };
    } finally { input.dispose(); }
  };

  function range(opts, duration) {
    const start = Math.max(0, Number(opts.start) || 0), end = Number(opts.end) > 0 ? Math.min(Number(opts.end), duration) : duration;
    if (start >= duration) throw new Error("O início do corte fica depois do fim do arquivo");
    if (end <= start) throw new Error("O fim do corte precisa ficar depois do início");
    return { start, end, cut: start > 0 || end < duration };
  }

  function outputFormat(to) {
    const MB = Mediabunny;
    switch (to) {
      case "mp4": case "m4a": return new MB.Mp4OutputFormat({ fastStart: false });
      case "mov": return new MB.MovOutputFormat({ fastStart: false });
      case "webm": return new MB.WebMOutputFormat();
      case "mkv": return new MB.MkvOutputFormat();
      case "mp3": return new MB.Mp3OutputFormat();
      case "wav": return new MB.WavOutputFormat();
      case "ogg": return new MB.OggOutputFormat();
      case "flac": return new MB.FlacOutputFormat();
    }
    throw new Error("Formato desconhecido: " + to);
  }

  // motivo de a Mediabunny não conseguir usar uma faixa, em português
  const REASON = {
    undecodable_source_codec: "este PC não consegue ler o codec dela",
    unknown_source_codec: "o codec dela é desconhecido",
    no_encodable_target_codec: "este PC não consegue gravar nesse formato",
    max_track_count_reached: "o formato não aceita mais faixas",
    max_track_count_of_type_reached: "o formato não aceita esse tipo de faixa",
  };
  const TRACK = { video: "A faixa de vídeo ficou de fora", audio: "A faixa de som ficou de fora", subtitle: "A legenda ficou de fora" };

  async function transcode(job, input) {
    const MB = Mediabunny, { to, opts, src } = job;
    const audioOnly = to in AUDIO_OUT;
    const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
    if (audioOnly && !a) throw new Error("Este arquivo não tem som");
    if (!audioOnly && !v) throw new Error("Este arquivo não tem vídeo");
    const duration = await input.computeDuration(), { start, end, cut } = range(opts, duration);

    if (to === "mp3" && !(await MB.canEncodeAudio("mp3"))) await FP.vendor("mp3");
    if (to === "flac" && !(await MB.canEncodeAudio("flac"))) await FP.vendor("flac");

    const audio = {};
    if (audioOnly) audio.codec = AUDIO_OUT[to];
    if (opts.mono) audio.numberOfChannels = 1;
    if (Number(opts.sampleRate) > 0) audio.sampleRate = Number(opts.sampleRate);
    if (audioOnly && Number(opts.bitrate) > 0 && to !== "wav" && to !== "flac") { audio.bitrate = Number(opts.bitrate) * 1000; audio.forceTranscode = true; }
    if (!audioOnly && opts.mute) audio.discard = true;

    const video = {};
    let meta = { duration: end - start };
    if (audioOnly) video.discard = true;
    else {
      let w = v.displayWidth, h = v.displayHeight;
      const H = Number(opts.height) || 0;
      if (H > 0 && H < h) { w = even(w * H / h); h = even(H); video.width = w; video.height = h; video.fit = "fill"; }
      if (Number(opts.fps) > 0) video.frameRate = Number(opts.fps);
      const codec = VCODEC[opts.codec];
      if (codec) {
        if (!outputFormat(to).getSupportedVideoCodecs().includes(codec)) throw new Error(`O formato ${to.toUpperCase()} não aceita o codec escolhido`);
        if (v.codec !== codec && !(await MB.canEncodeVideo(codec, { width: even(w), height: even(h) }))) throw new Error("Este PC não consegue gravar com o codec escolhido. Use Automático.");
        video.codec = codec;
      }
      if (opts.quality && opts.quality !== "auto") {
        video.bitrate = { low: MB.QUALITY_LOW, medium: MB.QUALITY_MEDIUM, high: MB.QUALITY_HIGH, max: MB.QUALITY_VERY_HIGH }[opts.quality] || MB.QUALITY_HIGH;
        video.forceTranscode = true;
      } else video.bitrate = MB.QUALITY_HIGH;
      meta = { ...meta, width: w, height: h };
    }

    const out = await job.stream(to);
    const output = new MB.Output({ format: outputFormat(to), target: new MB.StreamTarget(out.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
    // com bitrate só por garantia (automático) a cópia direta continua valendo quando nada mudou
    const autoCopy = !audioOnly && (!opts.quality || opts.quality === "auto");
    if (autoCopy && outputFormat(to).getSupportedVideoCodecs().includes(v.codec) && !video.codec && !video.width && !video.frameRate) delete video.bitrate;
    const conv = await MB.Conversion.init({ input, output, video, audio, tracks: audioOnly ? "primary" : "all", showWarnings: false,
      copy: { shiftTolerance: Infinity, boundaryTolerance: cut ? 0.05 : Infinity }, ...(cut ? { trim: { start, end } } : {}) });
    const lost = conv.discardedTracks.filter((d) => d.reason !== "discarded_by_user");
    const why = (d) => `${TRACK[d.track.type] || "Uma faixa ficou de fora"}: ${REASON[d.reason] || d.reason}`;
    if (!conv.isValid) throw new Error(lost.length ? why(lost[0]) : `Não dá para converter este arquivo para ${to.toUpperCase()}`);
    // sem a faixa principal não adianta terminar
    const main = lost.find((d) => d.track.type === (audioOnly ? "audio" : "video") && d.track.number === 1);
    if (main) throw new Error(why(main));
    for (const d of lost) job.note(why(d));

    const stop = () => conv.cancel().catch(() => {});
    job.cancelers.add(stop);
    conv.onProgress = (p) => job.progress(p);
    try { job.check(); await conv.execute(); }
    catch (e) { await conv.cancel().catch(() => {}); throw e; }
    finally { job.cancelers.delete(stop); }
    await out.finish();
    return meta;
  }

  // vídeo -> GIF
  const MAX_GIF_FRAMES = 1500;
  async function toGif(job, input) {
    const MB = Mediabunny, { opts } = job, v = await input.getPrimaryVideoTrack();
    if (!v) throw new Error("Este arquivo não tem vídeo");
    if (!(await v.canDecode())) throw new Error("Este PC não consegue ler o codec deste vídeo");
    const duration = await input.computeDuration(), { start, end } = range(opts, duration), fps = Math.max(1, Math.min(50, Number(opts.fps) || 12));
    const H = Math.min(v.displayHeight, Number(opts.height) || 360), W = Math.max(1, Math.round(v.displayWidth * H / v.displayHeight));
    const n = Math.max(1, Math.round((end - start) * fps));
    if (n > MAX_GIF_FRAMES) throw new Error(`GIF grande demais (${n} quadros, o limite é ${MAX_GIF_FRAMES}). Corte um trecho ou diminua os quadros por segundo.`);
    const t0 = await v.getFirstTimestamp();
    const sink = new MB.CanvasSink(v, { width: W, height: H, fit: "fill", poolSize: 2 });
    const times = Array.from({ length: n }, (_, i) => Math.max(t0, start + i / fps));
    const g = await FP.gifWriter();
    let i = 0, last = null, shown = 0;
    for await (const f of sink.canvasesAtTimestamps(times)) {
      job.check();
      if (f) last = f.canvas;
      i++;
      // o GIF conta em centésimos de segundo: acumula para não adiantar nem atrasar
      const until = Math.round((i / fps) * 100) * 10;
      if (last) { g.add(FP.scaleCanvas(last, W, H), until - shown); shown = until; }
      job.progress(i / n);
      await FP.breathe();
    }
    if (!last) throw new Error("Não deu para ler nenhum quadro deste vídeo");
    await job.save(g.finish(), "gif");
    return { width: W, height: H };
  }

  // vídeo -> imagem (um quadro)
  async function toFrame(job, input) {
    const MB = Mediabunny, { to, opts } = job, v = await input.getPrimaryVideoTrack();
    if (!v || !(await v.canDecode())) throw new Error("Este PC não consegue ler este vídeo");
    const duration = await input.computeDuration(), { start } = range({ start: opts.start }, duration), t0 = await v.getFirstTimestamp();
    const f = await new MB.CanvasSink(v).getCanvas(Math.max(t0, start));
    if (!f) throw new Error("Não deu para ler este quadro");
    const c = FP.resizeCanvas(FP.copyCanvas(f.canvas), opts.maxSize);
    await job.save(await FP.encodeImage(c, to, { quality: opts.quality > 0 ? opts.quality : 92 }), to);
    return { width: c.width, height: c.height };
  }

  FP.converters.video = FP.converters.audio = async (job) => {
    const input = await openInput(job.src);
    try {
      if (job.to === "gif") return await toGif(job, input);
      if (job.to === "jpg" || job.to === "png") return await toFrame(job, input);
      return await transcode(job, input);
    } finally { input.dispose(); }
  };
})();
