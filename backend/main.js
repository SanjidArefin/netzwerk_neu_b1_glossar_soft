const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("node:path");
const { getGlossary, addEntry, deleteEntries, updateEntry } = require("./glossary-service");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: "#131f24",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "..", "frontend", "index.html"));

  // Electron installs no default right-click menu, so highlighted text would
  // have no way to copy. The renderer suppresses the menu for plain row
  // right-clicks (it copies the whole entry itself), which means this handler
  // only runs when the user actually selected text or is in a text field.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    if (params.isEditable) {
      Menu.buildFromTemplate([
        { label: "Cut", role: "cut" },
        { label: "Copy", role: "copy" },
        { label: "Paste", role: "paste" },
        { label: "Select All", role: "selectAll" },
      ]).popup({ window: mainWindow });
      return;
    }

    if (!params.selectionText || !params.selectionText.trim()) {
      return;
    }

    Menu.buildFromTemplate([
      { label: "Copy", role: "copy" },
      { label: "Select All", role: "selectAll" },
    ]).popup({ window: mainWindow });
  });
}

ipcMain.handle("glossary:load", () => getGlossary());

// Validation errors are surfaced to the renderer as rejected promises so the UI
// can show the message in the add-word form.
ipcMain.handle("glossary:add", (_event, { chapter, word, meaning } = {}) => (
  addEntry(chapter, word, meaning)
));

ipcMain.handle("glossary:update", (_event, { chapter, word, meaning } = {}) => (
  updateEntry(chapter, word, meaning)
));

ipcMain.handle("glossary:delete", (_event, { entryIds } = {}) => deleteEntries(entryIds));

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
