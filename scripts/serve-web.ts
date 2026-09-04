import index from '../src/web/index.html';

const port = Number(process.env.TIKTOOLS_WEB_PORT ?? 3000);
const server = Bun.serve({
  port,
  routes: {
    '/': index,
  },
});
console.log(`TikTools development frontend: ${server.url.href}`);
await new Promise<void>(() => {
  // Keep the development server alive until the terminal sends a signal.
});
