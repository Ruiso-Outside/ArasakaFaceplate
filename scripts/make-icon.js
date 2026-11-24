// Desenha module/icons/conversor.png (256 px) no estilo dos módulos da Central: duas máscaras trocando de lugar.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const R = "#ff0000", W = "#f4f0f0";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <path d="M10 10H210L246 46V246H46L10 210Z" fill="#070707" stroke="${R}" stroke-width="7"/>
  <path d="M24 24H204" stroke="${R}" stroke-opacity=".35" stroke-width="2"/>
  <path d="M120 66H72V142L120 186Z" fill="${R}"/>
  <path d="M136 66H184V142L136 186Z" fill="none" stroke="${W}" stroke-width="11"/>
  <path d="M86 108H110V120H86Z" fill="#070707"/>
  <path d="M150 108H172V120H150Z" fill="${W}"/>
  <path d="M76 208H176M162 196L178 208L162 220" fill="none" stroke="${R}" stroke-width="9"/>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("about:blank");
  const src = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  const url = await win.webContents.executeJavaScript(`(async () => { const m = new Image(); m.src = ${JSON.stringify(src)}; await m.decode();
    const c = document.createElement("canvas"); c.width = c.height = 256; c.getContext("2d").drawImage(m, 0, 0); return c.toDataURL("image/png"); })()`);
  const out = path.join(__dirname, "..", "module", "icons", "conversor.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log(out);
  app.quit();
});
