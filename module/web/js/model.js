// Arasaka Faceplate · objetos 3D: abre com o three.js (materiais e texturas ao lado do arquivo) e exporta.
// OBJ + MTL e 3MF são escritos aqui; GLB, glTF, STL, PLY e USDZ usam os exportadores do three.js.
"use strict";
(() => {
  // ---------------------------------------------------------------- abrir
  // as texturas passam por aqui: cada endereço pedido pelo modelo vira um arquivo da pasta dele
  function manager(src) {
    const T = Three, m = new T.LoadingManager(), missing = new Set();
    m.setURLModifier((url) => {
      if (/^(blob:|data:)/.test(url)) return url;
      const rel = url.replace(/^fp:\/\//, "").replace(/^\.\//, "");
      const at = src.asset(rel);
      if (!at) missing.add(rel.split(/[\/]/).pop());
      return at || "data:,";
    });
    m.addHandler(/\.tga$/i, new T.TGALoader(m));
    // "tudo carregado": os leitores não esperam as imagens, então conta o que começou e o que terminou
    let pending = 0, wake = [];
    const s = m.itemStart.bind(m), e = m.itemEnd.bind(m), er = m.itemError.bind(m);
    m.itemStart = (u) => { pending++; s(u); };
    m.itemEnd = (u) => { pending--; e(u); if (!pending) wake.splice(0).forEach((f) => f()); };
    m.itemError = (u) => { if (!/^(blob:|data:)/.test(u)) missing.add(assetName(u)); er(u); };
    m.settled = () => (pending ? new Promise((r) => wake.push(r)) : Promise.resolve());
    m.missing = missing;
    return m;
  }
  const assetName = (u) => { try { const p = new URL(u, "fp://x/").searchParams.get("p"); return (p || u).split(/[\\/]/).pop().split("?")[0]; } catch { return u; } };

  async function parse(src, mgr) {
    const T = Three, e = src.ext, path = "fp://";
    const mesh = (g) => {
      if (!g.attributes.normal) g.computeVertexNormals();
      const mat = new T.MeshStandardMaterial({ color: 0xb8b8bc, roughness: 0.65, metalness: 0.05, side: T.DoubleSide });
      if (g.attributes.color) { mat.vertexColors = true; mat.color.set(0xffffff); }
      return e === "ply" && !g.index ? new T.Points(g, new T.PointsMaterial({ size: 0.01, vertexColors: !!g.attributes.color })) : new T.Mesh(g, mat);
    };
    switch (e) {
      case "glb": case "gltf": {
        const l = new T.GLTFLoader(mgr).setMeshoptDecoder(T.MeshoptDecoder);
        const data = e === "glb" ? (await src.bytes()).buffer : await src.text();
        const g = await new Promise((ok, no) => l.parse(data, path, ok, no)).catch((err) => {
          if (/DRACO/i.test(err.message)) throw new Error("Este modelo usa compressão Draco, que ainda não é suportada");
          if (/KTX2/i.test(err.message)) throw new Error("Este modelo usa texturas KTX2, que ainda não são suportadas");
          throw err;
        });
        g.scene.userData.clips = g.animations || [];
        return g.scene;
      }
      case "obj": {
        const text = await src.text(), loader = new T.OBJLoader(mgr), libs = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
        for (const name of libs) {
          const url = src.asset(name), r = url && (await fetch(url).catch(() => null));
          if (!r || !r.ok) { mgr.missing.add(name.split(/[\\/]/).pop()); continue; }
          const mtl = new T.MTLLoader(mgr).parse(await r.text(), path);
          mtl.preload();
          loader.setMaterials(mtl);
        }
        return loader.parse(text);
      }
      case "fbx": { const g = new T.FBXLoader(mgr).parse((await src.bytes()).buffer, path); g.userData.clips = g.animations || []; return g; }
      case "stl": return mesh(new T.STLLoader(mgr).parse((await src.bytes()).buffer));
      case "ply": return mesh(new T.PLYLoader(mgr).parse((await src.bytes()).buffer));
      case "dae": { const r = new T.ColladaLoader(mgr).parse(await src.text(), path); if (!r) throw new Error("Não deu para ler este DAE"); return r.scene; }
      case "3ds": return new T.TDSLoader(mgr).parse((await src.bytes()).buffer, path);
      case "3mf": return new T.ThreeMFLoader(mgr).parse((await src.bytes()).buffer);
      case "amf": return new T.AMFLoader(mgr).parse((await src.bytes()).buffer);
      case "wrl": return new T.VRMLLoader(mgr).parse(await src.text(), path);
      case "usdz": return new T.USDLoader(mgr).parse((await src.bytes()).buffer, path);
    }
    throw new Error("Formato 3D desconhecido: " + e);
  }

  // formatos de impressão 3D e CAD usam Z para cima; o three.js usa Y
  const Z_UP = new Set(["stl", "3mf", "amf", "3ds"]);

  FP.loadModel = async (src) => {
    await FP.vendor("three");
    const T = Three, mgr = manager(src);
    mgr.itemStart("modelo");
    let obj;
    try { obj = await parse(src, mgr); }
    catch (e) { throw new Error(`Não deu para abrir este modelo 3D: ${(e && e.message) || e}`); }
    finally { mgr.itemEnd("modelo"); }
    await mgr.settled();
    await imagesReady(obj);
    const root = new T.Group();
    root.name = src.base;
    root.userData.clips = obj.userData.clips || [];
    delete obj.userData.clips;
    if (Z_UP.has(src.ext)) obj.rotation.x -= Math.PI / 2;
    root.add(obj);
    root.updateMatrixWorld(true);
    let meshes = 0, tris = 0;
    root.traverse((o) => {
      if (o.isPoints) meshes++;
      if (!o.isMesh || !o.geometry.attributes.position) return;
      meshes++;
      tris += Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    if (!meshes) throw new Error("Este arquivo não tem nenhuma malha 3D");
    return { root, meshes, tris, missing: [...mgr.missing].filter((n) => n && n !== "modelo") };
  };
  const eachTexture = (root, fn) => root.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) fn(m[k], m, k); });
  async function imagesReady(root) {
    // nada de img.decode(): ele só termina quando o navegador desenha a tela, e o módulo pode estar escondido
    const imgs = new Set();
    eachTexture(root, (t) => { if (t.image instanceof HTMLImageElement && !t.image.complete) imgs.add(t.image); });
    await Promise.all([...imgs].map((i) => new Promise((ok) => { i.addEventListener("load", ok, { once: true }); i.addEventListener("error", ok, { once: true }); })));
    // textura que não existe: sai do material para não travar a exportação
    eachTexture(root, (t, m, k) => { const i = t.image; if (!i || (i instanceof HTMLImageElement && !i.naturalWidth)) { m[k] = null; m.needsUpdate = true; } });
  }
  FP.disposeModel = (root) => root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of o.material ? [].concat(o.material) : []) { for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
  });

  // ---------------------------------------------------------------- preparar para exportar
  // materiais antigos (Phong, Lambert...) viram PBR, que é o que glTF e USDZ guardam
  function toStandard(m, cache) {
    if (m.isMeshStandardMaterial) return m;
    if (cache.has(m)) return cache.get(m);
    const T = Three, s = new T.MeshStandardMaterial({ name: m.name, side: m.side, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, vertexColors: m.vertexColors, flatShading: !!m.flatShading });
    if (m.color) s.color.copy(m.color);
    if (m.emissive) { s.emissive.copy(m.emissive); s.emissiveIntensity = m.emissiveIntensity ?? 1; }
    for (const k of ["map", "normalMap", "emissiveMap", "aoMap", "alphaMap"]) if (m[k]) s[k] = m[k];
    if (m.normalScale && m.normalMap) s.normalScale.copy(m.normalScale);
    s.metalness = 0;
    s.roughness = m.shininess === undefined ? 0.9 : Math.max(0.15, Math.min(1, Math.sqrt(2 / (m.shininess + 2))));
    cache.set(m, s);
    return s;
  }

  // malhas soltas, já no lugar certo do mundo (com a pose dos ossos), divididas por material
  function flatten(root, scale, zUp) {
    const T = Three, list = [], M = new T.Matrix4().makeScale(scale, scale, scale);
    if (zUp) M.premultiply(new T.Matrix4().makeRotationX(Math.PI / 2));
    const v = new T.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      const matrices = [];
      if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { const x = new T.Matrix4(); o.getMatrixAt(i, x); matrices.push(x.premultiply(o.matrixWorld)); }
      else matrices.push(o.matrixWorld);
      for (const mw of matrices) {
        const g = new T.BufferGeometry(), src = o.geometry, mat = new T.Matrix4().multiplyMatrices(M, mw);
        const n = src.attributes.position.count, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); v.applyMatrix4(mat); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
        g.setAttribute("position", new T.BufferAttribute(pos, 3));
        const index = src.index ? Uint32Array.from(src.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
        // escala negativa (espelho): inverte os triângulos para a frente continuar sendo a frente
        if (mat.determinant() < 0) for (let i = 0; i + 2 < index.length; i += 3) { const t = index[i]; index[i] = index[i + 2]; index[i + 2] = t; }
        if (src.attributes.normal && !o.isSkinnedMesh) {
          const nm = new T.Matrix3().getNormalMatrix(mat), a = src.attributes.normal, out = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { v.fromBufferAttribute(a, i).applyMatrix3(nm).normalize(); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
          g.setAttribute("normal", new T.BufferAttribute(out, 3));
        }
        const copy = (name, size) => {
          const a = src.attributes[name];
          if (!a) return;
          const out = new Float32Array(n * size), get = ["getX", "getY", "getZ"];
          for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = a[get[k]](i);
          g.setAttribute(name, new T.BufferAttribute(out, size));
        };
        copy("uv", 2); copy("color", 3);
        g.setIndex(new T.BufferAttribute(index, 1));
        if (!g.attributes.normal) g.computeVertexNormals();
        const mats = [].concat(o.material), groups = mats.length > 1 && src.groups.length ? src.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
        list.push({ name: o.name || "malha", geometry: g, parts: groups.map((p) => ({ start: p.start, count: Math.min(p.count, index.length - p.start), material: mats[p.materialIndex] || mats[0] })).filter((p) => p.count > 2) });
      }
    });
    if (!list.length) throw new Error("Este modelo só tem pontos ou linhas: converta para PLY ou GLB");
    return list;
  }
  const sceneOf = (list) => {
    const T = Three, s = new T.Group();
    for (const { name, geometry, parts } of list) {
      if (parts.length > 1) parts.forEach((p, i) => geometry.addGroup(p.start, p.count, i));
      const m = new T.Mesh(geometry, parts.length > 1 ? parts.map((p) => p.material) : parts[0] ? parts[0].material : new T.MeshStandardMaterial());
      m.name = name;
      s.add(m);
    }
    s.updateMatrixWorld(true);
    return s;
  };
  const num = (x) => String(Math.round(x * 1e6) / 1e6);
  const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0").toUpperCase();

  async function texturePng(t) {
    const T = Three, img = t.image;
    let c;
    if (img && img.data && img.width) { // DataTexture (TGA)
      const d = new Uint8ClampedArray(img.width * img.height * 4);
      const n = img.data.length / (img.width * img.height);
      for (let i = 0; i < img.width * img.height; i++) for (let k = 0; k < 4; k++) d[i * 4 + k] = k < n ? img.data[i * n + k] : 255;
      c = new OffscreenCanvas(img.width, img.height);
      c.getContext("2d").putImageData(new ImageData(d, img.width, img.height), 0, 0);
    } else {
      c = new OffscreenCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
      c.getContext("2d").drawImage(img, 0, 0);
    }
    if (!t.flipY) { // OBJ conta o V de baixo para cima; texturas de glTF vêm ao contrário
      const f = new OffscreenCanvas(c.width, c.height), x = f.getContext("2d");
      x.translate(0, c.height); x.scale(1, -1); x.drawImage(c, 0, 0);
      c = f;
    }
    return c.convertToBlob({ type: "image/png" });
  }

  // ---------------------------------------------------------------- OBJ + MTL + texturas
  async function saveObj(job, list) {
    const { src } = job, mats = new Map(), names = new Set(), texNames = new Set(), tex = new Map();
    const unique = (used, s, fb) => { s = (s || fb).replace(/[^\w.-]+/g, "_") || fb; let n = s; for (let i = 2; used.has(n); i++) n = s + "_" + i; used.add(n); return n; };
    for (const { parts } of list) for (const { material } of parts) if (!mats.has(material)) mats.set(material, unique(names, material.name, "material"));
    for (const m of mats.keys()) if (m.map && !tex.has(m.map.source || m.map)) tex.set(m.map.source || m.map, { t: m.map, name: unique(texNames, m.name, "textura") + "_cor" });
    const base = src.base.replace(/\s+/g, "_");
    if (tex.size) await job.group(src.base);

    const objParts = [`# Arasaka Faceplate\nmtllib ${base}.mtl\n`];
    let vo = 1, to = 1, no = 1;
    for (const { name, geometry: g, parts } of list) {
      job.check();
      const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal, ix = g.index, lines = [`o ${name.replace(/\s+/g, "_")}`];
      for (let i = 0; i < p.count; i++) lines.push(`v ${num(p.getX(i))} ${num(p.getY(i))} ${num(p.getZ(i))}`);
      if (uv) for (let i = 0; i < uv.count; i++) lines.push(`vt ${num(uv.getX(i))} ${num(uv.getY(i))}`);
      if (n) for (let i = 0; i < n.count; i++) lines.push(`vn ${num(n.getX(i))} ${num(n.getY(i))} ${num(n.getZ(i))}`);
      const c = (k) => { const i = ix.getX(k); return uv && n ? `${i + vo}/${i + to}/${i + no}` : uv ? `${i + vo}/${i + to}` : n ? `${i + vo}//${i + no}` : `${i + vo}`; };
      for (const part of parts) {
        lines.push("usemtl " + mats.get(part.material));
        for (let k = part.start; k + 2 < part.start + part.count; k += 3) lines.push(`f ${c(k)} ${c(k + 1)} ${c(k + 2)}`);
      }
      vo += p.count; if (uv) to += uv.count; if (n) no += n.count;
      objParts.push(lines.join("\n") + "\n");
      await FP.breathe();
    }
    // o nome que o arquivo ganhou de verdade pode ter "(2)": o OBJ aponta para o MTL certo porque ele é gravado antes
    let mtl = "# Arasaka Faceplate\n";
    const files = new Map();
    for (const [key, { t, name }] of tex) { job.check(); files.set(key, (await job.save(await texturePng(t), "png", name)).name); }
    for (const [m, name] of mats) {
      const col = m.color ? m.color.clone().convertLinearToSRGB() : { r: 0.8, g: 0.8, b: 0.8 };
      mtl += `\nnewmtl ${name}\nKd ${num(col.r)} ${num(col.g)} ${num(col.b)}\nKa 0 0 0\nKs ${m.metalness > 0.5 ? "0.5 0.5 0.5" : "0.04 0.04 0.04"}\nNs ${num(m.roughness === undefined ? 30 : Math.min(900, 2 / Math.max(0.0025, m.roughness ** 2) - 2 + 1))}\nd ${num(m.opacity ?? 1)}\nillum 2\n`;
      if (m.map) mtl += `map_Kd ${files.get(m.map.source || m.map)}\n`;
    }
    const mtlFile = await job.save(mtl, "mtl", base);
    objParts[0] = `# Arasaka Faceplate\nmtllib ${mtlFile.name}\n`;
    const main = await job.save(new Blob(objParts), "obj", base);
    job.files = [main, ...job.files.filter((f) => f !== main)];
  }

  // ---------------------------------------------------------------- 3MF (impressão 3D)
  function make3mf(list, unitScale) {
    const T = Three, esc = (s) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
    const mats = new Map();
    for (const { parts } of list) for (const { material } of parts) if (!mats.has(material)) mats.set(material, mats.size);
    const colors = [...mats.keys()].map((m) => { const c = m.color ? m.color.clone().convertLinearToSRGB() : { r: 0.7, g: 0.7, b: 0.7 }; return `<base name="${esc(m.name || "material")}" displaycolor="#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}FF"/>`; });
    let objects = "", items = "";
    list.forEach(({ name, geometry, parts }, i) => {
      // 3MF exige malha fechada por vértices compartilhados: junta os iguais
      const only = new T.BufferGeometry();
      only.setAttribute("position", geometry.attributes.position); only.setIndex(geometry.index);
      const map = new Map(), remap = new Uint32Array(only.attributes.position.count), verts = [], p = only.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const key = [p.getX(k), p.getY(k), p.getZ(k)].map((x) => Math.round(x * unitScale * 1e4)).join(",");
        let id = map.get(key);
        if (id === undefined) { id = map.size; map.set(key, id); verts.push(`<vertex x="${num(p.getX(k) * unitScale)}" y="${num(p.getY(k) * unitScale)}" z="${num(p.getZ(k) * unitScale)}"/>`); }
        remap[k] = id;
      }
      const tris = [];
      for (const part of parts) for (let k = part.start; k + 2 < part.start + part.count; k += 3) {
        const a = remap[only.index.getX(k)], b = remap[only.index.getX(k + 1)], c = remap[only.index.getX(k + 2)];
        if (a !== b && b !== c && a !== c) tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${mats.get(part.material)}"/>`);
      }
      if (!tris.length) return;
      objects += `<object id="${i + 2}" name="${esc(name)}" type="model" pid="1" pindex="${mats.get(parts[0].material)}"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`;
      items += `<item objectid="${i + 2}"/>`;
    });
    const U = Fflate.strToU8, xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    return Fflate.zipSync({
      "[Content_Types].xml": U(xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
      "_rels/.rels": U(xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
      "3D/3dmodel.model": U(xml + `<model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Arasaka Faceplate</metadata><resources><basematerials id="1">${colors.join("")}</basematerials>${objects}</resources><build>${items}</build></model>`),
    }, { level: 6 });
  }

  // ---------------------------------------------------------------- imagem do modelo
  FP.frameCamera = (camera, root) => {
    const T = Three, box = new T.Box3().setFromObject(root), c = box.getCenter(new T.Vector3()), r = Math.max(1e-6, box.getSize(new T.Vector3()).length() / 2);
    const d = r / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.05 * (camera.aspect < 1 ? 1 / camera.aspect : 1);
    camera.near = d / 100; camera.far = d * 20;
    camera.position.copy(c).add(new T.Vector3(0.75, 0.5, 1).normalize().multiplyScalar(d));
    camera.lookAt(c);
    camera.updateProjectionMatrix();
    return { center: c, radius: r };
  };
  FP.lightScene = (scene, renderer) => {
    const T = Three, pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const key = new T.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 2.5);
    scene.add(key);
  };
  async function renderPng(job, root) {
    const T = Three, side = Math.max(64, Math.min(4096, Number(job.opts.maxSize) || 1024));
    const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    try {
      r.setSize(side, side, false);
      r.toneMapping = T.ACESFilmicToneMapping;
      const scene = new T.Scene(), cam = new T.PerspectiveCamera(40, 1, 0.1, 100);
      scene.add(root);
      FP.lightScene(scene, r);
      FP.frameCamera(cam, root);
      r.render(scene, cam);
      const blob = await new Promise((ok) => r.domElement.toBlob(ok, "image/png"));
      if (!blob) throw new Error("A placa de vídeo não conseguiu desenhar o modelo");
      await job.save(blob, "png");
      scene.remove(root);
      return { width: side, height: side };
    } finally { r.dispose(); r.forceContextLoss(); }
  }

  // ---------------------------------------------------------------- conversor
  FP.converters.model = async (job) => {
    const { src, to, opts } = job;
    job.progress(0.05);
    const { root, missing } = await FP.loadModel(src);
    const T = Three;
    try {
      job.check(); job.progress(0.5);
      if (missing.length) job.note(`Texturas ou materiais não encontrados: ${missing.slice(0, 6).join(", ") + (missing.length > 6 ? "..." : "")}`);
      const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1, zUp = opts.axis === "z" || (opts.axis !== "y" && ["stl", "3mf"].includes(to));
      switch (to) {
        case "png": return await renderPng(job, root);
        case "glb": case "gltf": {
          const cache = new Map();
          root.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => toStandard(m, cache)) : toStandard(o.material, cache); });
          const clips = root.userData.clips || []; root.userData = {};
          if (scale !== 1) root.scale.multiplyScalar(scale);
          if (opts.axis === "z") root.rotation.x += Math.PI / 2;
          root.updateMatrixWorld(true);
          const r = await new Promise((ok, no) => new T.GLTFExporter().parse(root, ok, no, { binary: to === "glb", animations: clips, onlyVisible: false }));
          job.check();
          await job.save(to === "glb" ? r : JSON.stringify(r), to);
          break;
        }
        case "stl": {
          const r = new T.STLExporter().parse(sceneOf(flatten(root, scale, zUp)), { binary: opts.ascii !== true });
          await job.save(r, "stl");
          break;
        }
        case "ply": {
          let target;
          try { target = sceneOf(flatten(root, scale, zUp)); } catch (e) { // nuvem de pontos
            root.traverse((o) => { if (o.isPoints) target = root; });
            if (!target) throw e;
          }
          let points = false;
          target.traverse((o) => { if (o.isPoints) points = true; });
          if (points) await job.save(pointsPly(target, scale), "ply");
          else {
            const r = new T.PLYExporter().parse(target, null, { binary: opts.ascii !== true, littleEndian: true });
            if (!r) throw new Error("Não deu para gravar este PLY");
            await job.save(r, "ply");
          }
          break;
        }
        case "obj": await saveObj(job, flatten(root, scale, zUp)); break;
        case "3mf": await job.save(make3mf(flatten(root, scale, zUp), 1), "3mf"); break;
        case "usdz": {
          const cache = new Map(), scene = sceneOf(flatten(root, scale, false));
          scene.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => toStandard(m, cache)) : toStandard(o.material, cache); });
          await job.save(await new T.USDZExporter().parseAsync(splitGroups(scene)), "usdz");
          break;
        }
        default: throw new Error("Formato 3D desconhecido: " + to);
      }
      return {};
    } finally { FP.disposeModel(root); }
  };

  // USDZ não aceita vários materiais numa malha só
  function splitGroups(scene) {
    const T = Three;
    for (const o of [...scene.children]) {
      if (!o.isMesh || !Array.isArray(o.material)) continue;
      scene.remove(o);
      o.geometry.groups.forEach((g, i) => {
        const geo = new T.BufferGeometry();
        for (const k of Object.keys(o.geometry.attributes)) geo.setAttribute(k, o.geometry.attributes[k]);
        geo.setIndex(new T.BufferAttribute(o.geometry.index.array.slice(g.start, g.start + g.count), 1));
        const m = new T.Mesh(geo, o.material[g.materialIndex]);
        m.name = `${o.name}_${i + 1}`;
        scene.add(m);
      });
    }
    return scene;
  }
  function pointsPly(root, scale) {
    const T = Three, rows = [], v = new T.Vector3();
    let color = false;
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isPoints && o.geometry.attributes.color) color = true; });
    root.traverse((o) => {
      if (!o.isPoints) return;
      const p = o.geometry.attributes.position, c = o.geometry.attributes.color;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).multiplyScalar(scale);
        let line = `${num(v.x)} ${num(v.y)} ${num(v.z)}`;
        if (color) { const k = c ? new T.Color(c.getX(i), c.getY(i), c.getZ(i)).convertLinearToSRGB() : { r: 1, g: 1, b: 1 }; line += ` ${Math.round(k.r * 255)} ${Math.round(k.g * 255)} ${Math.round(k.b * 255)}`; }
        rows.push(line);
      }
    });
    return `ply\nformat ascii 1.0\nelement vertex ${rows.length}\nproperty float x\nproperty float y\nproperty float z\n${color ? "property uchar red\nproperty uchar green\nproperty uchar blue\n" : ""}end_header\n${rows.join("\n")}\n`;
  }

  // ---------------------------------------------------------------- visualizador (prévia)
  FP.ModelView = class {
    constructor(host) { this.host = host; this.dead = false; }
    async show(src) {
      const r = await FP.loadModel(src);
      if (this.dead) { FP.disposeModel(r.root); return null; }
      const T = Three, w = this.host.clientWidth || 300, h = this.host.clientHeight || 220;
      this.root = r.root;
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      this.renderer.setSize(w, h);
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.scene = new T.Scene(); this.camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      this.scene.add(r.root);
      FP.lightScene(this.scene, this.renderer);
      const { center, radius } = FP.frameCamera(this.camera, r.root);
      const grid = new T.GridHelper(radius * 4, 20, 0xff2a2a, 0x4a1212);
      grid.position.copy(center); grid.position.y = new T.Box3().setFromObject(r.root).min.y;
      this.scene.add(grid);
      this.controls = new T.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.copy(center); this.controls.enableDamping = true; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 1.2;
      this.controls.addEventListener("start", () => { this.controls.autoRotate = false; });
      this.host.replaceChildren(this.renderer.domElement);
      const size = new T.Box3().setFromObject(r.root).getSize(new T.Vector3());
      const loop = () => { if (this.dead) return; this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
      loop();
      this.ro = new ResizeObserver(() => {
        const W = this.host.clientWidth, H = this.host.clientHeight;
        if (!W || !H) return;
        this.renderer.setSize(W, H); this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
      });
      this.ro.observe(this.host);
      return { meshes: r.meshes, tris: r.tris, missing: r.missing, size };
    }
    dispose() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      if (this.ro) this.ro.disconnect();
      if (this.controls) this.controls.dispose();
      if (this.root) FP.disposeModel(this.root);
      if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove(); }
    }
  };
})();
