// `<img src="/api/...">`, `<video><source src=...>`, `<audio src=...>` and the
// download link point at API paths, which a file:// page can't load (they
// never pass through fetch). Watch the DOM and swap each one for a blob URL
// fetched through the in-page API. React leaves an attribute alone until its
// prop changes, and a changed prop is caught and swapped again.

const ATTRS: Record<string, string> = { IMG: "src", SOURCE: "src", VIDEO: "src", AUDIO: "src", A: "href" };
/** Posters never change under one URL; renders and narrations can. */
const CACHEABLE = /^\/api\/catalog\/(segment-)?poster\//;

const cache = new Map<string, Promise<string>>();

function blobUrl(apiPath: string): Promise<string> {
  const hit = cache.get(apiPath);
  if (hit) return hit;
  const p = fetch(apiPath).then(async (res) => {
    if (!res.ok) throw new Error(`${apiPath}: ${res.status}`);
    return URL.createObjectURL(await res.blob());
  });
  if (CACHEABLE.test(apiPath)) {
    cache.set(apiPath, p);
    p.catch(() => cache.delete(apiPath));
  }
  return p;
}

function swap(el: Element): void {
  const attr = ATTRS[el.tagName];
  if (!attr) return;
  const value = el.getAttribute(attr);
  if (!value || !value.startsWith("/api/")) return;
  el.setAttribute(`data-api-${attr}`, value);
  el.removeAttribute(attr);
  void blobUrl(value)
    .then((url) => {
      if (el.getAttribute(`data-api-${attr}`) !== value) return; // replaced meanwhile
      if (el.tagName === "A" && !el.hasAttribute("download")) {
        el.setAttribute("download", value.split("/").pop() ?? "download");
      }
      el.setAttribute(attr, url);
      if (el.tagName === "SOURCE") (el.parentElement as HTMLMediaElement | null)?.load();
    })
    .catch((err) => console.warn("[media]", err));
}

function scan(root: Element): void {
  swap(root);
  root.querySelectorAll("img, source, video, audio, a").forEach(swap);
}

export function installMediaUrls(): void {
  const start = () => {
    scan(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") swap(r.target as Element);
        r.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) scan(n as Element);
        });
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href"] });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
}
