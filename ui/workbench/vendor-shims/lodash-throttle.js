export default function throttle(func, wait = 0, options = {}) {
  if (typeof func !== "function") {
    throw new TypeError("Expected a function");
  }

  let timeoutId = null;
  let lastArgs = null;
  let lastThis = null;
  let result;
  let lastCallTime = 0;
  const leading = options.leading !== false;
  const trailing = options.trailing !== false;

  const invoke = (time) => {
    lastCallTime = time;
    const args = lastArgs;
    const context = lastThis;
    lastArgs = null;
    lastThis = null;
    result = func.apply(context, args || []);
    return result;
  };

  const startTimer = (remainingWait) => {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (trailing && lastArgs) {
        invoke(Date.now());
      }
    }, remainingWait);
  };

  function throttled(...args) {
    const now = Date.now();
    if (!lastCallTime && !leading) {
      lastCallTime = now;
    }

    const remaining = wait - (now - lastCallTime);
    lastArgs = args;
    lastThis = this;

    if (remaining <= 0 || remaining > wait) {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      return invoke(now);
    }

    if (timeoutId == null && trailing) {
      startTimer(remaining);
    }

    return result;
  }

  throttled.cancel = () => {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
    timeoutId = null;
    lastArgs = null;
    lastThis = null;
    lastCallTime = 0;
  };

  throttled.flush = () => {
    if (timeoutId == null) {
      return result;
    }
    clearTimeout(timeoutId);
    timeoutId = null;
    return lastArgs ? invoke(Date.now()) : result;
  };

  return throttled;
}
