const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("glossaryApi", {
  loadGlossary: () => ipcRenderer.invoke("glossary:load"),
  addEntry: (chapter, word, meaning) => ipcRenderer.invoke("glossary:add", { chapter, word, meaning }),
  updateEntry: (chapter, word, meaning) => ipcRenderer.invoke("glossary:update", { chapter, word, meaning }),
  deleteEntries: (entryIds) => ipcRenderer.invoke("glossary:delete", { entryIds }),
});
