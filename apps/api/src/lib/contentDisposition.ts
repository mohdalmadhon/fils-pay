/**
 * Content-Disposition with a user-supplied filename. The name is the
 * merchant's own (from the upload), so it can contain quotes, semicolons,
 * CR/LF or non-Latin-1 characters (an Arabic filename, say). Interpolating it
 * raw broke the header (a quote ends the filename) and made Node throw on
 * non-Latin-1, a 500.
 *
 * Emits an ASCII-only fallback `filename="..."` plus the RFC 5987/6266
 * `filename*=UTF-8''...` form that browsers prefer.
 */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
