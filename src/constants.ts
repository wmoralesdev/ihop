export const COMMON_WEB_PORTS = new Set([
  1234,
  3000,
  3001,
  3333,
  4000,
  4173,
  4200,
  4321,
  5000,
  5173,
  5174,
  8000,
  8001,
  8080,
  8081,
  8787,
  8888,
  9000,
]);

export const WEB_PROCESS_PATTERN =
  /(?:^|[\s/\\._-])(node|bun|deno|python\d*|ruby|php|java|dotnet|vite|next|nuxt|astro|webpack|rails|docker-proxy|com\.docker\.backend)(?:$|[\s/\\._-])/i;

export const HISTORY_LIMIT = 50;
export const RECENT_DISPLAY_LIMIT = 20;
export const GRACEFUL_WAIT_MS = 2_000;
