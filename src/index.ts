import { DurableObject } from "cloudflare:workers";
import { z } from 'zod';
import { Buffer } from 'buffer';
import OpenAI from 'openai';



interface Env {
    MY_DURABLE_OBJECT: DurableObjectNamespace;
    OPENAI_API_KEY: string;
    OPENAI_API_BASE: string;
    AI: any;
}

export class MyDurableObject extends DurableObject {
    webSockets: Set<WebSocket>;
    state: DurableObjectState;
    env: Env;
    ai: any;
    audioTranscription: Array<{ role: string; content: string }> = [];
    sql: SqlStorage;

    
    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.webSockets = new Set();
        this.ai = this.env.AI;
        this.audioTranscription = [];
        this.sql = state.storage.sql;


    }

    async handleAudioMessage(websocket: WebSocket, message: any) {
        if (message) {
            console.log("Received audio data");
            const audioBase64 = message;
            
            try {
                // const response = await this.ai.run("@cf/openai/whisper-large-v3-turbo", {
                //     audio: audioBase64,
                // });
                
                console.log("Transcription: Completed");
                
                websocket.send(JSON.stringify({
                    type: 'transcription',
                    text: response.text,
                    status: 'completed'
                }));
                
                this.audioTranscription.push({
                    role: 'user',
                    content: response.text
                });

                console.log("Generating overview...");

                
                
                
            } catch (error) {
                console.error("Error processing audio data:", error);
                websocket.send(JSON.stringify({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Failed to process audio',
                    status: 'error'
                }));
            }
            
        }
    }
    
    async fetch(request: Request): Promise<Response> {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        server.accept();
        this.webSockets.add(server);

        server.addEventListener('message', async (event) => {
            this.handleAudioMessage(server, event.data);
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
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        
        if (url.pathname === '/ws') {
            const id = env.MY_DURABLE_OBJECT.idFromName("websocket");
            const stub = env.MY_DURABLE_OBJECT.get(id);
            return stub.fetch(request);
        }
               
        
    }
}
