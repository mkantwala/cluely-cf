import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject {
    webSockets: Set<WebSocket>;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.webSockets = new Set();
    }

    async fetch(request: Request) {
        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
            return new Response('Expected Upgrade: WebSocket', { status: 426 });
        }

        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        // Handle the WebSocket connection
        server.accept();
        this.webSockets.add(server);

        server.addEventListener('message', (event) => {
            // Echo back the received message
            server.send(`Echo: ${event.data}`);
        });

        server.addEventListener('close', () => {
            this.webSockets.delete(server);
        });

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        
        // Route WebSocket connections to the Durable Object
        if (url.pathname === '/ws') {
            const id = env.MY_DURABLE_OBJECT.idFromName("websocket");
            const stub = env.MY_DURABLE_OBJECT.get(id);
            return stub.fetch(request);
        }

        return new Response('Use WebSocket client to connect to /ws', { status: 200 });
    }
} satisfies ExportedHandler<Env>;