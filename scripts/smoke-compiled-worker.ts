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

const CONNECTION_TIMEOUT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CAPABILITY_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const server = createServer();
await listen(server);
const port = (server.address() as { port: number }).port;
const child = Bun.spawn([executable, '--plugin-worker', '--port', String(port), '--token', token], {
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});

let socket: Socket | undefined;
try {
  socket = await withChildTimeout(
    waitForConnection(server),
    CONNECTION_TIMEOUT_MS,
    'Compiled worker connection',
    child,
  );
  socket.setEncoding('utf8');
  const protocol = createProtocol(socket);
  const hello = await withChildTimeout(protocol.hello, HANDSHAKE_TIMEOUT_MS, 'Compiled worker handshake', child);
  if (hello.type !== 'hello' || hello.token !== token) throw new Error('Compiled worker handshake token was not returned.');

  const loaded = await withChildTimeout(protocol.request({
    type: 'request',
    id: 'load-1',
    method: 'load',
    manifest,
    source,
  }), REQUEST_TIMEOUT_MS, 'Compiled worker load request', child);
  if (!loaded.ok || !Array.isArray((loaded.result as Message | undefined)?.nodes)
    || ((loaded.result as Message).nodes as unknown[]).length !== 2) {
    throw new Error('Compiled worker did not load both fixture nodes.');
  }

  const sync = await withChildTimeout(
    protocol.request(executeRequest('compiled.worker.sync', 'execute-1')),
    REQUEST_TIMEOUT_MS,
    'Compiled worker sync execute request',
    child,
  );
  if (!sync.ok || ((sync.result as Message).outputs as Message).value !== 42) {
    throw new Error('Compiled worker sync node returned an unexpected result.');
  }

  const asyncResultPromise = withChildTimeout(
    protocol.request(executeRequest('compiled.worker.async', 'execute-2')),
    REQUEST_TIMEOUT_MS,
    'Compiled worker async execute request',
    child,
  );
  await withChildTimeout(protocol.capabilityRequest, CAPABILITY_TIMEOUT_MS, 'Compiled worker capability request', child);
  const asyncResult = await asyncResultPromise;
  if (!asyncResult.ok || ((asyncResult.result as Message).outputs as Message).value !== 42) {
    throw new Error('Compiled worker capability node returned an unexpected result.');
  }

  const shutdown = await withChildTimeout(
    protocol.request({ type: 'request', id: 'shutdown-1', method: 'shutdown' }),
    SHUTDOWN_TIMEOUT_MS,
    'Compiled worker shutdown request',
    child,
  );
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
  capabilityRequest: Promise<Message>;
  request: (message: Message) => Promise<Message>;
} {
  let buffer = '';
  let helloResolve: ((message: Message) => void) | undefined;
  let helloReject: ((error: Error) => void) | undefined;
  const hello = new Promise<Message>((resolveHello, rejectHello) => {
    helloResolve = resolveHello;
    helloReject = rejectHello;
  });
  let capabilityResolve: ((message: Message) => void) | undefined;
  let capabilityReject: ((error: Error) => void) | undefined;
  const capabilityRequest = new Promise<Message>((resolveCapability, rejectCapability) => {
    capabilityResolve = resolveCapability;
    capabilityReject = rejectCapability;
  });
  const pending = new Map<string, { resolve: (message: Message) => void; reject: (error: Error) => void }>();

  const fail = (error: Error): void => {
    helloReject?.(error);
    capabilityReject?.(error);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };

  socket.on('data', (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (message.type === 'hello') {
        helloResolve?.(message);
        continue;
      }
      if (message.type === 'capability.request') {
        capabilityResolve?.(message);
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
    fail(error);
  });
  socket.on('close', () => {
    fail(new Error('Compiled worker IPC connection closed.'));
  });

  return {
    hello,
    capabilityRequest,
    request: (message) => new Promise<Message>((resolveRequest, rejectRequest) => {
      const id = String(message.id);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      try {
        socket.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        pending.delete(id);
        rejectRequest(error instanceof Error ? error : new Error(String(error)));
      }
    }),
  };
}

async function withChildTimeout<T>(promise: Promise<T>, ms: number, label: string, child: Bun.Subprocess): Promise<T> {
  const childExit = child.exited.then((code): never => {
    throw new Error(`${label} aborted because TikTools.exe exited with code ${code}.`);
  });
  return withTimeout(Promise.race([promise, childExit]), ms, label);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
