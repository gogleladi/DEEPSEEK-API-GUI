const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ds", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (partial) => ipcRenderer.invoke("settings:set", partial),
  setThemeBackground: (theme) => ipcRenderer.invoke("window:setThemeBackground", theme),
  getChats: () => ipcRenderer.invoke("chats:get"),
  setChats: (payload) => ipcRenderer.invoke("chats:set", payload),
  startChat: (payload) => ipcRenderer.invoke("chat:start", payload),
  abortChat: () => ipcRenderer.invoke("chat:abort"),
  onChatChunk: (fn) => {
    const sub = (_e, data) => fn(data);
    ipcRenderer.on("chat:chunk", sub);
    return () => ipcRenderer.removeListener("chat:chunk", sub);
  },
  onChatReasoning: (fn) => {
    const sub = (_e, data) => fn(data);
    ipcRenderer.on("chat:reasoning", sub);
    return () => ipcRenderer.removeListener("chat:reasoning", sub);
  },
  onChatDone: (fn) => {
    const sub = (_e, data) => fn(data);
    ipcRenderer.on("chat:done", sub);
    return () => ipcRenderer.removeListener("chat:done", sub);
  },
  onChatAborted: (fn) => {
    const sub = (_e, data) => fn(data);
    ipcRenderer.on("chat:aborted", sub);
    return () => ipcRenderer.removeListener("chat:aborted", sub);
  },
  onChatError: (fn) => {
    const sub = (_e, data) => fn(data);
    ipcRenderer.on("chat:error", sub);
    return () => ipcRenderer.removeListener("chat:error", sub);
  },
});
