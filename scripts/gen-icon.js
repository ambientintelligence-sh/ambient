// Renders icon-source.html via Electron and saves a 1024×1024 PNG.
// Run with: ./node_modules/.bin/electron scripts/gen-icon.js

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    webPreferences: { nodeIntegration: false },
  });

  await new Promise((resolve) => {
    win.webContents.on("did-finish-load", async () => {
      // Wait for Google Fonts to finish loading
      await win.webContents.executeJavaScript("document.fonts.ready");
      await new Promise((r) => setTimeout(r, 600));
      resolve();
    });
    win.loadFile(path.join(__dirname, "..", "icon-source.html"));
  });

  const image = await win.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });

  const outPath = path.join(__dirname, "..", "assets", "icon-1024.png");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, image.toPNG());

  console.log("✓ Saved assets/icon-1024.png");
  app.quit();
});
