// Stub: electron-store, used by loadDataIntoWorkspace, not by convertMidstFile.
const mem = new Map();
export default { set: (k, v) => mem.set(k, v), get: (k) => mem.get(k) };
