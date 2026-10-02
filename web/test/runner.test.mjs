// Execute the generated page, its embedded AudioWorklet, and real cart WASM.
// Browser surfaces are mocked; this detects bundling/initialization/reload regressions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {test} from 'node:test';

test('embedded runner saves, reloads and isolates its audio instance', async () => {
    const cart = readFileSync(new URL('../../target/save-test/counter.uw8',import.meta.url));
    const page = readFileSync(new URL('../../src/run-web.html',import.meta.url),'utf8');
    const script = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
    const records = new Map(), held = new Set(), timers = [];
    let Processor, frames = 0;
    const screen = {style:'', getContext() { return {
        createImageData:()=>({data:new Uint8ClampedArray(320*240*4)}),
        putImageData:()=>{frames++;},
    }; }};
    const message = {};
    class AudioContext {
        state = 'running';
        destination = {};
        audioWorklet = {addModule: async url => {
            const text = await (await fetch(url)).text();
            vm.runInNewContext(text, {
                AudioWorkletProcessor:class { constructor() { this.port = {postMessage:()=>{}}; } },
                registerProcessor(name, cls) { Processor = cls; },
                WebAssembly, Uint8Array, Uint32Array, ArrayBuffer, console,
            });
        }};
        async close() { this.state='closed'; }
        async resume() { this.state='running'; }
        async suspend() { this.state='suspended'; }
    }
    class AudioWorkletNode {
        constructor() {
            const processor = new Processor();
            this.port = {onmessage:null, postMessage:data => {
                processor.port.onmessage({data});
            }};
            processor.port.postMessage = data => queueMicrotask(()=>this.port.onmessage?.({data}));
        }
        connect() {}
    }
    const context = {
        console, WebAssembly, crypto:webcrypto, Uint8Array, Uint32Array, Uint8ClampedArray,
        ArrayBuffer, DataView, TextEncoder, TextDecoder, btoa, atob, AbortController,
        AudioContext, AudioWorkletNode,
        localStorage:{getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)},
        navigator:{getGamepads:()=>[],locks:{async request(key,options,fn) {
            if (held.has(key)) return fn(null);
            held.add(key); try { return await fn({}); } finally { held.delete(key); }
        }}},
        document:{getElementById:id=>id==='screen'?screen:message,hasFocus:()=>true},
        location:{pathname:'/',hash:''}, history:{pushState(){}}, addEventListener(){},
        setTimeout:fn=>{timers.push(fn);},
        EventSource:class {},
        fetch: async url => url === 'cart' ? new Response(cart,{headers:{'Content-Type':'application/octet-stream','X-UW8-Profile':'runner-test'}}) : fetch(url),
    };
    context.window = context;
    vm.runInNewContext(script,context);
    const until = async fn => {
        for(let n=0;n<500;n++) { if(fn()) return; await new Promise(r=>setTimeout(r,5)); }
        throw new Error('Runner timeout: '+JSON.stringify(message));
    };
    await until(()=>frames>0);
    screen.onkeydown({type:'keydown',code:'KeyZ'});
    timers.shift()();
    assert.equal(records.size,1);
    const payload = () => Buffer.from([...records.values()][0],'base64').readUInt32LE(20);
    assert.equal(payload(),1);
    screen.onkeyup({type:'keyup',code:'KeyZ'});
    const previousFrames = frames;
    screen.onkeydown({type:'keydown',code:'KeyR'});
    await until(()=>frames>previousFrames);
    screen.onkeydown({type:'keydown',code:'KeyZ'});
    while (timers.length && payload()===1) timers.shift()();
    assert.equal(payload(),2);
    assert.equal(message.innerText,undefined);
});
