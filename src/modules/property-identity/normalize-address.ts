export function normalizeAddressForMatching(address: string): string {
  return address
    .trim()
    .toUpperCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ");
}
