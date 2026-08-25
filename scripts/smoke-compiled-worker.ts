import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

type Message = Record<string, unknown>;

const executable = resolve(process.cwd(), 'dist', 'TikTools.exe');
const token = randomBytes(24).toString('hex');
const manifest = {
  manifestVersion: 1,
  id: 'dev.tiktools.compiled-worker-smoke',
  name: 'Compiled worker protocol smoke test',
  version: '1.0.0',
  apiVersion: 1,
  executionMode: 'sandbox',
  permissions: { capabilities: ['http.request'], network: ['api.example.test'] },
};
const source = `
import { registerNode } from '@tiktools/sdk';
registerNode({
  definition: { type: 'compiled.worker.sync', version: 1, title: 'Sync', category: 'Tests', kind: 'transform', inputs: [], outputs: [], configSchema: {} },
  handler: 'return { outputs: { value: event.data.value + 1 }, next: ["flow"] };'
});
registerNode({
  definition: { type: 'compiled.worker.async', version: 1, title: 'Async', category: 'Tests', kind: 'action', inputs: [], outputs: [], configSchema: {}, requiredCapabilities: ['http.request'] },
  isAsync: true,
  handler: 'const response = await capability("http.request", { method: "GET", url: "https://api.example.test/data" }); return { outputs: { value: response.body.answer }, next: ["success"] };'
});
`;

const server = createServer();
await listen(server);
const port = (server.address() as { port: number }).port;
const child = Bun.spawn([executable, '--plugin-worker', '--port', String(port), '--token', token], {
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});

let socket: Socket | undefined;
try {
  socket = await waitForConnection(server);
  socket.setEncoding('utf8');
  const protocol = createProtocol(socket);
  const hello = await protocol.hello;
  if (hello.type !== 'hello' || hello.token !== token) throw new Error('Compiled worker handshake token was not returned.');

  const loaded = await protocol.request({
    type: 'request',
    id: 'load-1',
    method: 'load',
    manifest,
    source,
  });
  if (!loaded.ok || !Array.isArray((loaded.result as Message | undefined)?.nodes)
    || ((loaded.result as Message).nodes as unknown[]).length !== 2) {
    throw new Error('Compiled worker did not load both fixture nodes.');
  }

  const sync = await protocol.request(executeRequest('compiled.worker.sync', 'execute-1'));
  if (!sync.ok || ((sync.result as Message).outputs as Message).value !== 42) {
    throw new Error('Compiled worker sync node returned an unexpected result.');
  }

  const asyncResult = await protocol.request(executeRequest('compiled.worker.async', 'execute-2'));
  if (!asyncResult.ok || ((asyncResult.result as Message).outputs as Message).value !== 42) {
    throw new Error('Compiled worker capability node returned an unexpected result.');
  }

  const shutdown = await protocol.request({ type: 'request', id: 'shutdown-1', method: 'shutdown' });
  if (!shutdown.ok) throw new Error('Compiled worker did not acknowledge shutdown.');
  console.log('Compiled TikTools.exe worker protocol smoke test passed.');
} finally {
  socket?.destroy();
  server.close();
  if (child.exitCode === null) child.kill();
  await child.exited.catch(() => undefined);
}

function executeRequest(nodeType: string, executionId: string): Message {
  return {
    type: 'request',
    id: executionId,
    method: 'execute',
    nodeType,
    executionId,
    request: {
      runId: 'compiled-worker-smoke',
      workflowId: 'compiled-worker-smoke',
      node: { id: nodeType, type: nodeType, version: 1, position: { x: 0, y: 0 }, config: {} },
      event: { id: 'event-1', type: 'tiktok.chat', timestamp: Date.now(), data: { value: 41 } },
      inputs: {},
    },
  };
}

function createProtocol(socket: Socket): {
  hello: Promise<Message>;
  request: (message: Message) => Promise<Message>;
} {
  let buffer = '';
  let helloResolve: ((message: Message) => void) | undefined;
  let helloReject: ((error: Error) => void) | undefined;
  const hello = new Promise<Message>((resolveHello, rejectHello) => {
    helloResolve = resolveHello;
    helloReject = rejectHello;
  });
  const pending = new Map<string, { resolve: (message: Message) => void; reject: (error: Error) => void }>();

  socket.on('data', (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as Message;
      if (message.type === 'hello') {
        helloResolve?.(message);
        continue;
      }
      if (message.type === 'capability.request') {
        socket.write(`${JSON.stringify({
          type: 'capability.response',
          requestId: message.requestId,
          result: { status: 200, ok: true, body: { answer: 42 } },
        })}\n`);
        continue;
      }
      if (message.type === 'response' && typeof message.id === 'string') {
        const call = pending.get(message.id);
        if (!call) continue;
        pending.delete(message.id);
        call.resolve(message);
      }
    }
  });
  socket.on('error', (error) => {
    helloReject?.(error);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  });

  return {
    hello,
    request: (message) => new Promise<Message>((resolveRequest, rejectRequest) => {
      const id = String(message.id);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      socket.write(`${JSON.stringify(message)}\n`);
    }),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
}

function waitForConnection(server: Server): Promise<Socket> {
  return new Promise((resolveConnection, rejectConnection) => {
    server.once('connection', resolveConnection);
    server.once('error', rejectConnection);
  });
}
