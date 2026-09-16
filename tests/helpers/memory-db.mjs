// Deterministic transaction adapter for service unit tests. Not a replacement for Firebase Rules tests.
import { randomUUID } from 'node:crypto';
export function memoryDb() {
  let data = new Map(),
    queue = Promise.resolve();
  function snapshot(ref, store = data) {
    return {
      id: ref.id,
      ref,
      exists: store.has(ref.path),
      data: () => structuredClone(store.get(ref.path)),
    };
  }
  const patch = (old, changes) => {
    const result = structuredClone(old);
    for (const [path, value] of Object.entries(changes)) {
      const keys = path.split('.');
      let cursor = result;
      for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
      cursor[keys.at(-1)] = structuredClone(value);
    }
    return result;
  };
  function doc(path) {
    return {
      path,
      id: path.split('/').at(-1),
      collection: (name) => collection(`${path}/${name}`),
      get: async () => snapshot(doc(path)),
      set: async (value) => data.set(path, structuredClone(value)),
      update: async (value) => {
        if (!data.has(path)) throw new Error('Missing document');
        data.set(path, patch(data.get(path), value));
      },
    };
  }
  function collection(path, filters = [], max = Infinity) {
    return {
      doc: (id) => doc(`${path}/${id || randomUUID()}`),
      where: (field, op, value) => {
        if (op !== '==') throw new Error('Unsupported test query');
        return collection(path, [...filters, [field, value]], max);
      },
      limit: (n) => collection(path, filters, n),
      get: async () => ({
        docs: [...data.keys()]
          .filter(
            (k) =>
              k.startsWith(path + '/') &&
              k.split('/').length === path.split('/').length + 1 &&
              filters.every(([f, v]) => data.get(k)[f] === v),
          )
          .slice(0, max)
          .map((k) => snapshot(doc(k))),
      }),
    };
  }
  return {
    doc,
    collection,
    runTransaction: async (callback) => {
      const execute = async () => {
        const staged = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
        let wrote = false;
        const tx = {
          get: async (ref) => {
            if (wrote) throw new Error('Firestore forbids reads after writes');
            return snapshot(ref, staged);
          },
          getAll: async (...refs) => {
            if (wrote) throw new Error('Firestore forbids reads after writes');
            return refs.map((ref) => snapshot(ref, staged));
          },
          create: (ref, value) => {
            wrote = true;
            if (staged.has(ref.path)) throw new Error('Document exists');
            staged.set(ref.path, structuredClone(value));
          },
          set: (ref, value) => {
            wrote = true;
            staged.set(ref.path, structuredClone(value));
          },
          update: (ref, value) => {
            wrote = true;
            if (!staged.has(ref.path)) throw new Error('Missing document');
            staged.set(ref.path, patch(staged.get(ref.path), value));
          },
          delete: (ref) => {
            wrote = true;
            staged.delete(ref.path);
          },
        };
        const result = await callback(tx);
        data = staged;
        return result;
      };
      const pending = queue.then(execute);
      queue = pending.catch(() => {});
      return pending;
    },
  };
}
