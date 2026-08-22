import index from './web/index.html';

export function startWebServer() {
  return Bun.serve({
    port: 0,
    routes: {
      '/': index,
    },
  });
}
