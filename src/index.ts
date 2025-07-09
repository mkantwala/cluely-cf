import { DurableObject } from "cloudflare:workers";
import { z } from 'zod';
import { Buffer } from 'buffer';
import {OpenAI} from 'openai';



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
    private audioBuffer: Int16Array[] = [];
    private transcriptionTimer: NodeJS.Timeout | null = null;
    
    
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






            try {
          
                // console.log("Received audio data", message);
                // console.log("Type of message", typeof message);
                
                const pcmData = new Int16Array(message);
                const wavBuffer = this.createWavBuffer(pcmData, {
                    sampleRate: 24000,  // Must match client's sample rate
                    numChannels: 1,     // Mono
                    bitDepth: 16        // 16-bit PCM
                });
                
                const audioArray = Array.from(new Uint8Array(wavBuffer));
                // const input = {
                //     audio: audioArray
                // };

                const base64Audio = Buffer.from(wavBuffer).toString('base64');
                const audioBuffer = Buffer.from(base64Audio, 'base64');
                const file = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });
                
                const input = {
                        audio: base64Audio
                    };                    
                    
                    const openai = new OpenAI({
                      apiKey: 'sk-f9562bde68623ce62099a850f1f339715a022bde7745b134',
                      baseURL: 'https://api.exomlapi.com/v1'
                    });
                    
                    
                    const transcription = await openai.audio.transcriptions.create({
                    file: file,
                    model: "gpt-4o-transcribe",
                    });
                    
                    console.log(transcription.text);
                    
                    
    
                const resp = await this.env.AI.run("@cf/openai/whisper-large-v3-turbo", input);
                
                console.log("Response received", resp.text);
                if (!resp || !resp.text) {
                    console.error("No transcription returned from Whisper");
                    websocket.send(JSON.stringify({ error: "No transcription returned" }));
                    return;
                }
    
                console.log("Transcription completed:", resp.text);
                websocket.send(JSON.stringify({ 
                    status: "success",
                    text: resp.text 
                }));
    

                // // console.log("Received audio data", message);
                // const audioBytes = new Uint8Array(message);
                // console.log("Audio bytes", audioBytes);
                // const input = {
                //     audio: [...audioBytes],  // Spread Uint8Array into a regular array
                // };
        
                // const response = await this.env.AI.run("@cf/openai/whisper", input);
                // console.log("Response", response);

        
                // console.log("Received audio data", message);
                // const audioBase64 = Buffer.from(message).toString('base64');
                // const response = await this.ai.run("@cf/openai/whisper-large-v3-turbo", {
                //     audio: audioBase64,
                // });

                // const transcriptionText = response;

                // console.log("Transcription: Completed", transcriptionText);
                
                // websocket.send(JSON.stringify({
                //     type: 'transcription',
                //     text: transcriptionText,
                //     status: 'completed'
                // }));
                
                // this.audioTranscription.push({
                //     role: 'user',
                //     content: response.text
                // });

                // console.log("Generating overview...");

                
                
                
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
    

    private createWavBuffer(pcmData: Int16Array, options: { sampleRate: number, numChannels: number, bitDepth: number }): ArrayBuffer {
        const { sampleRate, numChannels, bitDepth } = options;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        // Create buffer with WAV header
        const buffer = new ArrayBuffer(44 + pcmData.length * 2);
        const view = new DataView(buffer);
        
        // Helper function to write string to buffer
        const writeString = (view: DataView, offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        // RIFF identifier
        writeString(view, 0, 'RIFF');
        // File length
        view.setUint32(4, 36 + pcmData.length * 2, true);
        // RIFF type
        writeString(view, 8, 'WAVE');
        // Format chunk identifier
        writeString(view, 12, 'fmt ');
        // Format chunk length
        view.setUint32(16, 16, true);
        // Sample format (raw)
        view.setUint16(20, 1, true);
        // Channel count
        view.setUint16(22, numChannels, true);
        // Sample rate
        view.setUint32(24, sampleRate, true);
        // Byte rate (sample rate * block align)
        view.setUint32(28, sampleRate * blockAlign, true);
        // Block align (channel count * bytes per sample)
        view.setUint16(32, blockAlign, true);
        // Bits per sample
        view.setUint16(34, bitDepth, true);
        // Data chunk identifier
        writeString(view, 36, 'data');
        // Data chunk length
        view.setUint32(40, pcmData.length * 2, true);
        
        // Write the PCM data
        const dataView = new Int16Array(buffer, 44);
        for (let i = 0; i < pcmData.length; i++) {
            dataView[i] = pcmData[i];
        }
        
        return buffer;
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
