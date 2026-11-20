const paths: Record<string, string> = {
  'books-library': 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3V4Z',
  audiobookshelf: 'M4 13v-1a8 8 0 0 1 16 0v1M4 12H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Z',
  jellyfin: 'm9 5 11 7-11 7V5Z',
  immich: 'M4 4h16v16H4V4Zm0 13 5-6 4 4 3-3 4 5M16 8h.01',
  grocy: 'M3 4h2l3 12h11l2-8H6M9 20h.01M18 20h.01',
  transmission: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  'system-metrics': 'M3 3v18h18M6 15l4-5 4 3 5-8',
};
export function ServiceIcon({ id, name }: { id: string; name: string }) {
  return paths[id] ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[id]} /></svg>
    : <span aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
}
