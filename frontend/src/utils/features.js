// Feature flags (build-time). USAU is hidden until there's a reliable
// cross-source player/team ID; build with VITE_ENABLE_USAU=true to restore it.
// Pair with ENABLE_USAU=true on the API, which 404s USAU endpoints otherwise.

export const USAU_ENABLED = import.meta.env.VITE_ENABLE_USAU === 'true';

// Always hidden for now: WFDF has no pages yet, and accounts/billing aren't
// launched. Remove an entry to bring its links and routes back.
const ALWAYS_HIDDEN = ['/wfdf', '/subscribe', '/account'];

const HIDDEN_PREFIXES = USAU_ENABLED ? ALWAYS_HIDDEN : [...ALWAYS_HIDDEN, '/usau'];

export function isRouteEnabled(to) {
  if (typeof to !== 'string') return true;
  return !HIDDEN_PREFIXES.some(p => to === p || to.startsWith(`${p}/`));
}

export function isLeagueEnabled(id) {
  return isRouteEnabled(`/${String(id).toLowerCase()}`);
}

// Drop nav entries that point at hidden routes, recursing into
// { sections: [...] } / { links: [...] } groups and removing groups left empty.
export function pruneNav(items) {
  return items
    .filter(it => isRouteEnabled(it.to))
    .map(it => {
      if (Array.isArray(it.sections)) return { ...it, sections: pruneNav(it.sections) };
      if (Array.isArray(it.links))    return { ...it, links: pruneNav(it.links) };
      return it;
    })
    .filter(it => !(Array.isArray(it.sections) && it.sections.length === 0)
               && !(Array.isArray(it.links) && it.links.length === 0 && !it.to));
}
