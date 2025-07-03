import { DurableObject } from "cloudflare:workers";
import { OpenAI } from "openai";
import { Ai } from '@cloudflare/ai';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

interface Env {
    MY_DURABLE_OBJECT: DurableObjectNamespace;
    OPENAI_API_KEY: string;
    OPENAI_API_BASE: string;
    AI: any;
}

export class MyDurableObject extends DurableObject {
    webSockets: Set<WebSocket>;
    messages: ChatMessage[];
    state: DurableObjectState;
    env: Env;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.webSockets = new Set();
        this.messages = [];
        
        
        // Load messages from storage if available
        state.blockConcurrencyWhile(async () => {
            const stored = await state.storage.get<ChatMessage[]>('messages');
            if (stored) this.messages = stored;
        });
    }
    

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        
        if (url.pathname.endsWith('/messages')) {
            return new Response(JSON.stringify({
                messages: this.messages
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        server.accept();
        this.webSockets.add(server);

        server.addEventListener('message', async (event) => {
            if (event.data instanceof ArrayBuffer) {
                try {
                    console.log("Received audio data, size:", event.data.byteLength, "bytes");
                    const audioData = new Uint8Array(event.data);
                    
                    // Send acknowledgment to client
                    server.send(JSON.stringify({
                        type: 'status',
                        message: 'Processing audio...',
                        status: 'processing'
                    }));
                    
                    // Initialize AI binding
                    const ai = new Ai(this.env.AI);
                    
                    // Process audio in chunks if it's too large (e.g., > 1MB)
                    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
                    let transcription = "";
                    
                    for (let i = 0; i < audioData.length; i += CHUNK_SIZE) {
                        const chunk = audioData.slice(i, i + CHUNK_SIZE);
                        
                        try {
                            const response = await ai.run('@cf/openai/whisper', {
                                audio: [...chunk],
                            });


                            
                            if (response.text) {
                                const chunkText = response.text.trim();
                                if (chunkText) {
                                    console.log(`Processed chunk ${Math.floor(i/CHUNK_SIZE) + 1}`);
                                    transcription += chunkText + " ";
                                    
                                    // Send partial transcription
                                    server.send(JSON.stringify({
                                        type: 'transcription_partial',
                                        text: chunkText,
                                        isFinal: (i + CHUNK_SIZE) >= audioData.length
                                    }));
                                }
                            }
                        } catch (chunkError) {
                            console.error('Error processing audio chunk:', chunkError);
                            // Continue with next chunk even if one fails
                        }
                    }
                    
                    transcription = transcription.trim();
                    if (!transcription) {
                        console.log('No speech was detected in any audio chunk');
                        transcription = "No speech detected or could not process audio";
                    } else {
                        console.log('Transcription completed successfully');
                    }
                    
                    console.log('Transcription complete');
                    console.log('Transcription:', transcription);
                    server.send(JSON.stringify({
                        type: 'transcription',
                        text: transcription,
                        status: 'completed'
                    }));


                    

                } catch (error) {
                    console.error('Error processing audio:', error);
                    try {
                        server.send(JSON.stringify({
                            type: 'error',
                            message: error instanceof Error ? error.message : 'Failed to process audio',
                            status: 'error'
                        }));
                    } catch (sendError) {
                        console.error('Failed to send error to client:', sendError);
                    }
                }
                return;
            }

            else {
                server.send(JSON.stringify({
                    type: 'error',
                    message: 'Unsupported message type',
                    status: 'error'
                }));
            }
            
            
            
            // const startTime = performance.now();
            
            // try {
            //     const userMessage = event.data.toString();
            //     console.log(`Received message: ${userMessage}`);
                
            //     // Store user message
            //     // const userMsg: ChatMessage = {
            //     //     role: 'user',
            //     //     content: userMessage,
            //     //     timestamp: new Date().toISOString()
            //     // };
            //     // this.messages.push(userMsg);
            //     // await this.saveMessages();
                
            //     const openai = new OpenAI({
            //         baseURL: this.env.OPENAI_API_BASE,
            //         apiKey: this.env.OPENAI_API_KEY,
            //     });

            //     console.log('Starting streaming response...');
            //     const stream = await openai.chat.completions.create({
            //         model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            //         messages: [{ role: 'user', content: event.data.toString() }],
            //         stream: true,
            //     });

            //     let fullResponse = '';
            //     let firstChunkTime: number | null = null;
            //     let lastChunkTime = performance.now();
            //     let chunkCount = 0;
					
            //     for await (const chunk of stream) {
            //         const content = chunk.choices[0]?.delta?.content || '';
            //         if (content) {
            //             if (firstChunkTime === null) {
            //                 firstChunkTime = performance.now();
            //                 const timeToFirstChunk = firstChunkTime - startTime;
            //                 console.log(`Time to first chunk: ${timeToFirstChunk.toFixed(2)}ms`);
            //             }
                        
            //             fullResponse += content;
            //             server.send(JSON.stringify({
            //                 type: 'chunk',
            //                 content: content
            //             }));
                        
                        
            //             const now = performance.now();
            //             const timeSinceLastChunk = now - lastChunkTime;
            //             lastChunkTime = now;
            //             chunkCount++;
                        
            //             console.log(`Chunk ${chunkCount} received after ${timeSinceLastChunk.toFixed(2)}ms`);
            //         }
            //     }

            //     // // Store the complete assistant response as a single message
            //     // this.messages.push({
            //     //     role: 'assistant',
            //     //     content: fullResponse,
            //     //     timestamp: new Date().toISOString()
            //     // });
            //     // await this.saveMessages();
                
            //     const endTime = performance.now();
            //     const totalLatency = endTime - startTime;
            //     const avgChunkTime = chunkCount > 0 ? (endTime - startTime) / chunkCount : 0;
                
            //     console.log(`[Streaming Complete]`);
            //     console.log(`- Total processing time: ${totalLatency.toFixed(2)}ms`);
            //     console.log(`- Total chunks: ${chunkCount}`);
            //     console.log(`- Average time per chunk: ${avgChunkTime.toFixed(2)}ms`);
            //     console.log(`- Response length: ${fullResponse.length} characters`);
                
            //     // Send completion message
            //     server.send(JSON.stringify({
            //         type: 'complete',
            //         totalTime: totalLatency.toFixed(2)
            //     }));
                
            // } catch (error) {
            //     const errorTime = performance.now();
            //     console.error(`Error after ${(errorTime - startTime).toFixed(2)}ms:`, error);
            //     server.send('Error processing your request');
            // }
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
        
        // Handle WebSocket connections
        if (url.pathname === '/ws') {
            const id = env.MY_DURABLE_OBJECT.idFromName("websocket");
            const stub = env.MY_DURABLE_OBJECT.get(id);
            return stub.fetch(request);
        }
        
        if (url.pathname === '/messages') {
            const id = env.MY_DURABLE_OBJECT.idFromName("websocket");
            const stub = env.MY_DURABLE_OBJECT.get(id);
            
            try {
                // Forward the request to the Durable Object
                const response = await stub.fetch(new Request(url, {
                    method: 'GET',
                    headers: request.headers
                }));
                
                // Return the messages from the Durable Object's response
                const messages = await response.json();
                return new Response(JSON.stringify(messages), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                return new Response(JSON.stringify({
                    error: 'Failed to fetch messages',
                    details: error instanceof Error ? error.message : String(error)
                }), { 
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
        
    }
}