import { DurableObject } from "cloudflare:workers";
import { z } from 'zod';
import { Buffer } from 'buffer';

const messageSchema = z.object({
    text: z.string().optional(),
    image: z.any().optional(),
    audio: z.any().optional(), 
    search: z.boolean().default(false),
});

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
    
    audioTranscription: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
    }>;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.webSockets = new Set();
        this.ai = this.env.AI;
        this.audioTranscription = [
            { role: 'system', content: 'You are a helpful assistant.' }
        ];
    }

    addMessage(content: string, role: 'user' | 'assistant' | 'system' = 'user') {
        const message = { role, content };
        this.audioTranscription.push(message);
        return message;
    }

    getMessages() {
        return [...this.audioTranscription];
    }

    async handleMessage(websocket: WebSocket, message: any) {
        if (message.audio) {
            const startTime = Date.now();
            console.log("Received audio data");
            const audioBase64 = message.audio;
            
            try {
                // Transcription phase
                console.time('Whisper Transcription');
                const response = await this.ai.run("@cf/openai/whisper-large-v3-turbo", {
                    audio: audioBase64,
                });
                console.timeEnd('Whisper Transcription');
                
                console.log("Transcription: Completed:", response.text);
                
                // Summary generation phase
                console.time('LLaMA Summary Generation');
                console.log("Generating Summary...");
                const stream = await this.ai.run("@cf/meta/llama-3.2-11b-vision-instruct", {
                    messages: [
                        {role: "system", content: "You are a helpful assistant. You need to output the transcript prefixing the USER SAYS:"},
                        {role: 'user', content: response.text}
                    ],
                    stream: false,
                });
                console.timeEnd('LLaMA Summary Generation');

                // Calculate and log total time
                const totalTime = Date.now() - startTime;
                console.log(`\n=== Processing Summary ===`);
                console.log(`- Transcription: ${response.text.length} characters`);
                console.log(`- Total Processing Time: ${totalTime}ms`);
                console.log(`=== End Summary ===\n`);

                console.log("Summary: Completed:", stream);
                // for await (const chunk of stream) {
                //     const content = chunk.choices[0]?.delta?.content || '';
                //     if (content) {
                        
                //     }
                // }              


                
                websocket.send(JSON.stringify({
                    type: 'transcription',
                    text: response.text,
                    status: 'completed'
                }));
                
            } catch (error) {
                console.error("Error processing audio data:", error);
                websocket.send(JSON.stringify({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Failed to process audio',
                    status: 'error'
                }));
            }
            
        }

        else if (message.text) {
            console.log("Received text message");

            try {
                const response = await this.ai.run("@cf/meta/llama-3.2-11b-vision-instruct", {
                    messages: this.getMessages(),
                });
                
                console.log("Response:", response);
                
            } catch (error) {
                console.error("Error processing text message:", error);
                websocket.send(JSON.stringify({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Failed to process text message',
                    status: 'error'
                }));
            }
        }

    }
    
    async fetch(request: Request): Promise<Response> {
        // const url = new URL(request.url);

        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        server.accept();
        this.webSockets.add(server);

        server.addEventListener('message', async (event) => {

            // console.log("Received message:", event.data);
        
            const messageData = typeof event.data === 'string' 
            ? JSON.parse(event.data) 
            : event.data;
         

            // const message = messageSchema.safeParse(messageData);
            // console.log("Parsed message:", message.success);
            // console.log("Parsed message data:", message.data);

            this.handleMessage(server, messageData);
            // if (message.success) {
            //     this.handleMessage(server, message.data);                
            // }

            // else {
            //     server.send(JSON.stringify({
            //         type: 'error',
            //         message: 'Invalid message format',
            //         status: 'error'
            //     }));
            // }
            
            // if (message.type === 'text') {
            //     console.log("Received text message:");
            // }

            // else if (message.type === 'image') {
            //     console.log("Received image data, size:");
            // }

            // else if (message.type === 'audio') {
            //     console.log("Received audio data, size:");
            // }
            // else {
            //     console.log("Received unknown message type:");
            // }


            // if (event.data instanceof ArrayBuffer) {
            //     try {
            //         console.log("Received audio data, size:", event.data.byteLength, "bytes");
            //         const audioData = new Uint8Array(event.data);
                    
            //         // Send acknowledgment to client
            //         server.send(JSON.stringify({
            //             type: 'status',
            //             message: 'Processing audio...',
            //             status: 'processing'
            //         }));
                    
            //         // Initialize AI binding
            //         const ai = new Ai(this.env.AI);
                    
            //         // Process audio in chunks if it's too large (e.g., > 1MB)
            //         const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
            //         let transcription = "";
                    
            //         for (let i = 0; i < audioData.length; i += CHUNK_SIZE) {
            //             const chunk = audioData.slice(i, i + CHUNK_SIZE);
                        
            //             try {
            //                 const response = await ai.run('@cf/openai/whisper', {
            //                     audio: [...chunk],
            //                 });


                            
            //                 if (response.text) {
            //                     const chunkText = response.text.trim();
            //                     if (chunkText) {
            //                         console.log(`Processed chunk ${Math.floor(i/CHUNK_SIZE) + 1}`);
            //                         transcription += chunkText + " ";
                                    
            //                         // Send partial transcription
            //                         server.send(JSON.stringify({
            //                             type: 'transcription_partial',
            //                             text: chunkText,
            //                             isFinal: (i + CHUNK_SIZE) >= audioData.length
            //                         }));
            //                     }
            //                 }
            //             } catch (chunkError) {
            //                 console.error('Error processing audio chunk:', chunkError);
            //                 // Continue with next chunk even if one fails
            //             }
            //         }
                    
            //         transcription = transcription.trim();
            //         if (!transcription) {
            //             console.log('No speech was detected in any audio chunk');
            //             transcription = "No speech detected or could not process audio";
            //         } else {
            //             console.log('Transcription completed successfully');
            //         }
                    
            //         console.log('Transcription complete');
            //         console.log('Transcription:', transcription);
            //         server.send(JSON.stringify({
            //             type: 'transcription',
            //             text: transcription,
            //             status: 'completed'
            //         }));



                    

            //     } catch (error) {
            //         console.error('Error processing audio:', error);
            //         try {
            //             server.send(JSON.stringify({
            //                 type: 'error',
            //                 message: error instanceof Error ? error.message : 'Failed to process audio',
            //                 status: 'error'
            //             }));
            //         } catch (sendError) {
            //             console.error('Failed to send error to client:', sendError);
            //         }
            //     }
            //     return;
            // }

            // else {
            //     server.send(JSON.stringify({
            //         type: 'error',
            //         message: 'Unsupported message type',
            //         status: 'error'
            //     }));
            // }
            
            
            
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
