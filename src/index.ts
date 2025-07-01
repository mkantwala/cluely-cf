import { DurableObject } from "cloudflare:workers";
import { OpenAI } from 'openai';

export class MyDurableObject extends DurableObject<Env> {
	state: DurableObjectState;
	webSockets: Set<WebSocket>;
	
	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.state = state;
		this.webSockets = new Set();
	}

	async handleWebSocket(webSocket: WebSocket) {
		// Accept the WebSocket connection
		webSocket.accept();
		this.webSockets.add(webSocket);

		// Set up event handlers
		webSocket.addEventListener('message', async (event) => {
			try {
				const data = event.data;
				console.log('Received message:', data);
				
				// Echo the message back
				webSocket.send(JSON.stringify({
					type: 'echo',
					message: `Received: ${data}`
				}));

				// You can add more message handling here
			} catch (err) {
				console.error('Error handling message:', err);
			}
		});

		webSocket.addEventListener('close', () => {
			console.log('WebSocket connection closed');
			this.webSockets.delete(webSocket);
		});

		// Send a welcome message
		webSocket.send(JSON.stringify({
			type: 'welcome',
			message: 'Connected to Durable Object WebSocket'
		}));
	}

	async fetch(request: Request) {
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return new Response('Expected Upgrade: WebSocket', { status: 426 });
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Handle the WebSocket connection in the background
		this.handleWebSocket(server);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}

	async generateText(prompt: string): Promise<{content: string, latency: number}> {
		const startTime = performance.now();
		let msg: string;
		
		try {
			const openai = new OpenAI({
				baseURL: 'https://hello-langchain.tme15b014.workers.dev/v1',
				apiKey: "xyz",
			});
			
			const completion = await openai.chat.completions.create({
				model: 'gpt-4.1-nano',
				messages: [{ role: 'user', content: prompt }],
			});
			
			msg = completion.choices[0]?.message?.content || 'No response from AI';
			await this.state.storage.put("lastMessage", msg);

			const latency = Math.round(performance.now() - startTime);
			
			// Broadcast to all connected WebSockets with latency info
			const broadcastMessage = JSON.stringify({
				type: 'ai_response',
				content: msg,
				latency: latency
			});

			this.webSockets.forEach(ws => {
				try {
					ws.send(broadcastMessage);
				} catch (err) {
					console.error('Error broadcasting message:', err);
				}
			});

			console.log(`generateText completed in ${latency}ms`);
			
			return { content: msg, latency };
		} catch (error) {
			const errorLatency = Math.round(performance.now() - startTime);
			console.error(`Error in generateText after ${errorLatency}ms:`, error);
			throw error; // Re-throw to let the caller handle the error
		}
	}
}

export default {
	
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Route WebSocket connections to the Durable Object
		if (url.pathname === '/open') {
			// Use a consistent ID for the WebSocket connection
			const id = env.MY_DURABLE_OBJECT.idFromName("websocket");
			const stub = env.MY_DURABLE_OBJECT.get(id);
			
			// Forward the request to the Durable Object
			return stub.fetch(request);
		}

		// Default route for non-WebSocket requests
		const id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName("default");
		const stub = env.MY_DURABLE_OBJECT.get(id);
		const { content, latency } = await stub.generateText("Hello, which model are you?");
		return new Response(JSON.stringify({
			content,
			latency_ms: latency
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	},

} satisfies ExportedHandler<Env>;
