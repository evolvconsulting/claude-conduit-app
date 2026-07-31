'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { CHANNELS } = require('../main/ipc-channels');

function invoke(channel) {
  return (...args) => ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const nimProxy = {};
for (const [domain, spec] of Object.entries(CHANNELS)) {
  nimProxy[domain] = {};
  for (const [method, channel] of Object.entries(spec.invoke || {})) {
    nimProxy[domain][method] = invoke(channel);
  }
  for (const [method, channel] of Object.entries(spec.events || {})) {
    // Event getters are named `on<Method>`, e.g. proxy.onStatusChanged(cb).
    const name = `on${method[0].toUpperCase()}${method.slice(1)}`;
    nimProxy[domain][name] = subscribe(channel);
  }
}

contextBridge.exposeInMainWorld('nimProxy', nimProxy);
