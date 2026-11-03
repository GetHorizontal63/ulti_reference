// Feature flags (build-time). USAU is hidden until there's a reliable
// cross-source player/team ID; build with VITE_ENABLE_USAU=true to restore it.
// Pair with ENABLE_USAU=true on the API, which 404s USAU endpoints otherwise.

export const USAU_ENABLED = import.meta.env.VITE_ENABLE_USAU === 'true';

const HIDDEN_PREFIXES = USAU_ENABLED ? [] : ['/usau'];

export function isRouteEnabled(to) {
  if (typeof to !== 'string') return true;
  return !HIDDEN_PREFIXES.some(p => to === p || to.startsWith(`${p}/`));
}

export function isLeagueEnabled(id) {
  return USAU_ENABLED || String(id).toLowerCase() !== 'usau';
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
