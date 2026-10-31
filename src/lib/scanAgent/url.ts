// A headline URL comes from a third-party feed. Only http(s) may become a link:
// a javascript: or data: URL in an href would run in the owner's browser.

/** The URL normalised as a string if it is http: or https:, otherwise null. */
export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
