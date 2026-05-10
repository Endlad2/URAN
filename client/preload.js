const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendRequest: async (url, options) => {
    return await ipcRenderer.invoke('http-request', url, options);
  },
  saveAvatar: async (chatId, imageUrl) => {
    return await ipcRenderer.invoke('save-avatar', chatId, imageUrl);
  },
  saveMedia: async (assetId, imageUrl, type) => {
    return await ipcRenderer.invoke('save-media', assetId, imageUrl, type);
  },
  getLocalPhoto: async (identifier) => {
    return await ipcRenderer.invoke('get-local-photo', identifier);
  }
});