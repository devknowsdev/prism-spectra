export default function createNamespaceEmitter() {
  const listeners = new Map();

  function getListeners(event) {
    const exact = listeners.get(event) || [];
    const wildcard = listeners.get("*") || [];
    return [...exact, ...wildcard];
  }

  function off(event, fn) {
    if (!listeners.has(event)) return;
    if (typeof fn !== "function") {
      listeners.delete(event);
      return;
    }
    const next = (listeners.get(event) || []).filter((listener) => listener !== fn);
    if (next.length > 0) {
      listeners.set(event, next);
    } else {
      listeners.delete(event);
    }
  }

  return {
    emit(event, ...args) {
      for (const listener of getListeners(event)) {
        listener.apply(this, args);
      }
    },
    on(event, fn) {
      const next = listeners.get(event) || [];
      next.push(fn);
      listeners.set(event, next);
    },
    once(event, fn) {
      const one = (...args) => {
        off(event, one);
        fn.apply(this, args);
      };
      this.on(event, one);
    },
    off,
    _fns: Object.create(null),
  };
}
