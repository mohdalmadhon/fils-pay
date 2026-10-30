/**
 * Opens `url` in a new tab and returns false only when the browser really
 * blocked it. `window.open(url, "_blank", "noopener")` always returns null
 * (that is what "noopener" means), so it can't tell a blocked popup from an
 * opened one. Open without the feature string instead, then cut the new
 * tab's link back to this one by hand.
 */
export function openInNewTab(url: string, open: (url: string, target: string) => Window | null = window.open.bind(window)): boolean {
  const opened = open(url, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}
