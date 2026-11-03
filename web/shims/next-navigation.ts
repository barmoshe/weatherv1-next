// `next/navigation` for the browser build: query-string state on the page URL
// (works on file:// — replaceState never reloads).
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};

function navigate(href: string, push: boolean) {
  const url = new URL(href, window.location.href);
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  listeners.forEach((fn) => fn());
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return new URLSearchParams(search);
}

export function useRouter() {
  return {
    replace: (href: string) => navigate(href, false),
    push: (href: string) => navigate(href, true),
    back: () => window.history.back(),
    refresh: () => undefined,
  };
}

export function usePathname(): string {
  return window.location.pathname;
}
