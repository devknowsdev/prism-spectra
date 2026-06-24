export default function wildcard(pattern, input, separator = /\//) {
  const wildcardPattern = String(pattern ?? "");
  const text = String(input ?? "");
  const hasWild = wildcardPattern.includes("*");
  const parts = wildcardPattern.split(separator);

  function matchString(value) {
    if (!hasWild && wildcardPattern !== value) {
      return false;
    }

    const testParts = value.split(separator);
    for (let index = 0; index < parts.length; index += 1) {
      if (parts[index] === "*") {
        continue;
      }
      if (index >= testParts.length || parts[index] !== testParts[index]) {
        return false;
      }
    }
    return testParts;
  }

  if (typeof input === "string" || input instanceof String) {
    return matchString(text);
  }

  if (Array.isArray(input)) {
    return input.filter((item) => matchString(String(item)));
  }

  if (input && typeof input === "object") {
    const result = {};
    for (const [key, value] of Object.entries(input)) {
      if (matchString(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  return false;
}
