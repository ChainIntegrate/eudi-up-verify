// Test-only: the check character of an Italian tax code, used to make sure test codes are INVALID (UCL-29),
// so they can never belong to a real person.
const ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
const even = (c) => (c >= "0" && c <= "9" ? Number(c) : c.charCodeAt(0) - 65);

export function checkChar(first15) {
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += i % 2 === 0 ? ODD[first15[i]] : even(first15[i]);
  return String.fromCharCode(65 + (sum % 26));
}

/** A syntactically plausible tax code with a WRONG check character. */
export function invalidTaxCode(first15) {
  const right = checkChar(first15);
  return first15 + (right === "X" ? "Y" : "X");
}
