const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const APP_URL = process.env.FINDER_APP_URL || "https://finder-pos-frontend.vercel.app";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "Ascend",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  win.loadURL(`${APP_URL}/login`);

  // Open external links (anything not on the app's own domain) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Pick up new deploys (e.g. from the daily dev-cycle agents + CI auto-deploy
  // to production) without the user needing to quit/reopen the app.
  let lastFocusReload = Date.now();
  win.on("focus", () => {
    const now = Date.now();
    // Avoid reloading on every brief focus change; only refresh if the app
    // has been in the background for a while (so an active checkout isn't
    // interrupted by a reload moments after switching tabs).
    if (now - lastFocusReload > 10 * 60 * 1000) {
      lastFocusReload = now;
      win.webContents.reload();
    }
  });

  // Background safety-net: also reload every 6 hours regardless of focus,
  // so a long-running idle session doesn't drift too far behind production.
  setInterval(() => {
    if (!win.isDestroyed()) win.webContents.reload();
  }, 6 * 60 * 60 * 1000);
}

const menuTemplate = [
  {
    label: "Ascend",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
