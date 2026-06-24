import wildcard from "./wildcard.js";

const reMimePartSplit = /[\/+\.]/;

export default function mimeMatch(target, pattern) {
  function test(candidatePattern) {
    const result = wildcard(candidatePattern, target, reMimePartSplit);
    return result && result.length >= 2;
  }

  return pattern ? test(String(pattern).split(";")[0]) : test;
}
