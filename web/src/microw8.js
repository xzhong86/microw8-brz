import {createSave} from './save.js';
import loaderUrl from "data-url:../../platform/bin/loader.wasm";
import platformUrl from "data-url:../../platform/bin/platform.uw8";
import audioWorkletUrl from "data-url:./audiolet.js";

class AudioNode extends AudioWorkletNode {
    constructor(context) {
        super(context, 'apu', {outputChannelCount: [2]});
    }
}

let U8 = (...a) => new Uint8Array(...a);
let U32 = (...a) => new Uint32Array(...a);

export default function MicroW8(screen, config = {}) {
    if(!config.setMessage) {
        config.setMessage = (s, e) => {
            if(e) {
                console.log('error: ' + e);
            }
        }
    }
    let canvasCtx = screen.getContext('2d');
    let imageData = canvasCtx.createImageData(320, 240);
    
    let devkitMode = config.devkitMode;
    
    let cancelFunction;
    
    let currentData;
    let currentOptions = {};
    
    let pad = 0;
    let keyboardElement = config.keyboardElement == undefined ? screen : config.keyboardElement;
    if(keyboardElement) {
        let keyHandler = (e) => {
            let isKeyDown = e.type == 'keydown';
            let mask;
            switch (e.code) {
                case 'ArrowUp':
                    mask = 1;
                    break;
                case 'ArrowDown':
                    mask = 2;
                    break;
                case 'ArrowLeft':
                    mask = 4;
                    break;
                case 'ArrowRight':
                    mask = 8;
                    break;
                case 'KeyZ':
                    mask = 16;
                    break;
                case 'KeyX':
                    mask = 32;
                    break;
                case 'KeyA':
                    mask = 64;
                    break;
                case 'KeyS':
                    mask = 128;
                    break;
                case 'KeyR':
                    if (isKeyDown) {
                        runModule(currentData, true, currentOptions);
                    }
                    break;
                case 'F9':
                    if(isKeyDown) {
                        screen.toBlob(blob => {
                            downloadBlob(blob, '.png');
                        });
                    }
                    e.preventDefault();
                    break;
                case 'F10':
                    if(isKeyDown) {
                        recordVideo();
                    }
                    e.preventDefault();
                    break;
            }
        
            if (isKeyDown) {
                pad |= mask;
            } else {
                pad &= ~mask;
            }
        };

        keyboardElement.onkeydown = keyHandler;
        keyboardElement.onkeyup = keyHandler;
    }

    let audioContext;
    let audioNode;
    
    async function runModule(data, keepUrl, options = {}) {
        if (cancelFunction) {
            cancelFunction();
            cancelFunction = null;
        }
    
        const sessionAudioContext = new AudioContext({sampleRate: 44100});
        const context = sessionAudioContext;
        audioContext = context;
        let node;
        let save;
        const originalCart = data;
        currentOptions = {...options};
        let keepRunning = true;
        let abortController = new AbortController();
        cancelFunction = () => {
            if (sessionAudioContext.state !== "closed") sessionAudioContext.close().catch(() => {});
            if (save) save.close();
            keepRunning = false;
            abortController.abort();
        };

        let cartridgeSize = data.byteLength;
    
        config.setMessage(cartridgeSize);
        if (cartridgeSize == 0) {
            cancelFunction();
            return;
        }
    
        await context.audioWorklet.addModule(audioWorkletUrl);
        if (!keepRunning) return;
        node = new AudioNode(context);
        audioNode = node;

        let audioReadyFlags = 0;
        let audioReadyResolve;
        let audioReadyPromise = new Promise(resolve => audioReadyResolve = resolve);
        let updateAudioReady = (f) => {
            audioReadyFlags |= f;
            if(audioReadyFlags == 3 && audioReadyResolve) {
                audioReadyResolve(true);
                audioReadyResolve = null;
            }
        };
        let audioStateChange = () => {
            if(context.state == 'suspended') {
                if(config.startButton) {
                    config.startButton.style = '';
                    screen.style = 'display:none';
                }
                (config.startButton || screen).onclick = () => {
                    context.resume();
                };
            } else {
                if(config.startButton) {
                    config.startButton.style = 'display:none';
                    screen.style = '';
                }
                updateAudioReady(1);
            }
        };
        context.onstatechange = audioStateChange;
        audioStateChange();

        if (!keepRunning) return;
        currentData = data;
    
        let newURL = window.location.pathname;
        if (cartridgeSize <= 1024 && !keepUrl) {
            let dataString = '';
            for (let byte of U8(data)) {
                dataString += String.fromCharCode(byte);
            }
            newURL += '#' + btoa(dataString);
    
            if (newURL != window.location.pathname + window.location.hash) {
                history.pushState(null, null, newURL);
            }
        }
    
        screen.width = screen.width;
    
        try {
            let memSize = { initial: 4 };
            if(!devkitMode) {
                memSize.maximum = 4;
            }
            let memory = new WebAssembly.Memory(memSize);
            let memU8 = U8(memory.buffer);
    
            let importObject = {
                env: {
                    memory
                },
            };
    
            let loader;
    
            let loadModuleData = (data) => {
                if (loader && (!devkitMode || U8(data)[0] != 0)) {
                    memU8.set(U8(data));
                    let length = loader.exports.load_uw8(data.byteLength);
                    data = new ArrayBuffer(length);
                    U8(data).set(memU8.slice(0, length));
                }
                return data;
            }
    
            let instantiate = async (data) => (await WebAssembly.instantiate(data, importObject)).instance;
    
            let loadModuleURL = async (url) => loadModuleData(await (await fetch(url)).arrayBuffer());
    
            loader = await instantiate(await loadModuleURL(loaderUrl));
    
            for (let n of ['acos', 'asin', 'atan', 'atan2', 'cos', 'exp', 'log', 'sin', 'tan', 'pow']) {
                importObject.env[n] = Math[n];
            }
    
            for (let i = 9; i < 64; ++i) {
                importObject.env['reserved' + i] = () => { };
            }
    
            let logLine = '';
            importObject.env['logChar'] = (c) => {
                if(c == 10) {
                    console.log(logLine);
                    logLine = '';
                } else {
                    logLine += String.fromCharCode(c);
                }
            };
    
            for (let i = 0; i < 16; ++i) {
                importObject.env['g_reserved' + i] = 0;
            }
    
            data = loadModuleData(data);
    
            const gameModule = await WebAssembly.compile(data);
            save = await createSave(memory, gameModule, originalCart, {
                saveId: options.saveId ?? config.saveId,
                profile: options.profile ?? config.profile,
            });
            if (!keepRunning) { save.close(); return; }
            Object.assign(importObject.env, save.imports);
            let platform_data = await loadModuleURL(platformUrl);
            if (!keepRunning) { save.close(); return; }

            node.port.onmessage = (e) => updateAudioReady(e.data);
            node.port.postMessage([platform_data, data]);

            let platform_instance = await instantiate(platform_data);
    
            for (let name in platform_instance.exports) {
                importObject.env[name] = platform_instance.exports[name]
            }
    
            let instance = await WebAssembly.instantiate(gameModule, importObject);
    
            let buffer = U32(imageData.data.buffer);

            await audioReadyPromise;
            if (!keepRunning) return;
    
            let startTime = Date.now();
            let frameCounter = 0;
    
            const timePerFrame = 1000 / 60;

            node.connect(context.destination);

            let isPaused = false;
            let pauseTime = startTime;
            let updateVisibility = isVisible => {
                let now = Date.now();
                if(isVisible) {
                    isPaused = false;
                    context.resume();
                    startTime += now - pauseTime;
                } else {
                    isPaused = true;
                    context.suspend();
                    pauseTime = now;
                }
            };
            window.addEventListener('focus', () => updateVisibility(true), { signal: abortController.signal });
            window.addEventListener('blur', () => updateVisibility(false), { signal: abortController.signal });
            updateVisibility(document.hasFocus());

            if (instance.exports.start) {
                instance.exports.start();
            }

            function mainloop() {
                if (!keepRunning) {
                    return;
                }
    
                try {
                    let restart = false;
                    let thisFrame;
                    if (!isPaused) {
                        let gamepads = navigator.getGamepads();
                        let gamepad = 0;
                        for (let i = 0; i < 4; ++i) {
                            let pad = gamepads[i];
                            if (!pad) {
                                continue;
                            }
                            for (let j = 0; j < 8; ++j) {
                                let buttonIdx = (j + 12) % 16;
                                if (pad.buttons.length > buttonIdx && pad.buttons[buttonIdx].pressed) {
                                    gamepad |= 1 << (i * 8 + j);
                                }
                            }
                            if (pad.axes.length > 1) {
                                for (let j = 0; j < 4; ++j) {
                                    let v = pad.axes[1 - (j >> 1)];
                                    if (((j & 1) ? v : -v) > 0.5) {
                                        gamepad |= 1 << (i * 8 + j);
                                    }
                                }
                            }
                            if (pad.buttons.length > 9 && pad.buttons[9].pressed) {
                                restart = true;
                            }
                        }
    
                        let u32Mem = U32(memory.buffer);
                        let time = Date.now() - startTime;
                        u32Mem[16] = time;
                        u32Mem[17] = pad | gamepad;
                        u32Mem[18] = frameCounter++;
                        if(instance.exports.upd) {
                            instance.exports.upd();
                        }
                        platform_instance.exports.endFrame();

                        let soundRegisters = new ArrayBuffer(32);
                        U8(soundRegisters).set(U8(memory.buffer, 80, 32));
                        node.port.postMessage({t: time, r: soundRegisters}, [soundRegisters]);
    
                        let palette = U32(memory.buffer, 0x13000, 1024);
                        for (let i = 0; i < 320 * 240; ++i) {
                            buffer[i] = palette[memU8[i + 120]] | 0xff000000;
                        }
                        canvasCtx.putImageData(imageData, 0, 0);

                        let timeOffset = ((time * 6) % 100 - 50) / 6;
                        thisFrame = startTime + time - timeOffset / 8;
                    } else {
                        thisFrame = Date.now();
                    }
                    let now = Date.now();
                    let nextFrame = Math.max(thisFrame + timePerFrame, now);
    
                    if (restart) {
                        runModule(currentData, true, currentOptions);
                    } else {
                        window.setTimeout(mainloop, nextFrame - now)
                    }
                } catch (err) {
                    if (save) save.close();
                    config.setMessage(cartridgeSize, err.toString());
                }
            }
    
            mainloop();
        } catch (err) {
            if (save) save.close();
            config.setMessage(cartridgeSize, err.toString());
        }
    }
    
    function downloadBlob(blob, ext) {
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'microw8_' + new Date().toISOString() + ext;
        a.click();
        URL.revokeObjectURL(a.href);
    }
    
    let videoRecorder;
    let videoStartTime;
    let videoAudioSourceNode;
    let videoAudioStreamNode;
    function recordVideo() {
        if(videoRecorder) {
            videoRecorder.stop();
            videoRecorder = null;
            videoAudioSourceNode.disconnect(videoAudioStreamNode);
            videoAudioSourceNode = null;
            videoAudioStreamNode = null;
            return;
        }

        let stream = screen.captureStream();
        videoAudioStreamNode = audioContext.createMediaStreamDestination();
        videoAudioSourceNode = audioNode;
        audioNode.connect(videoAudioStreamNode);
        stream.addTrack(videoAudioStreamNode.stream.getAudioTracks()[0]);
    
        videoRecorder = new MediaRecorder(stream, {
            mimeType: 'video/webm',
            videoBitsPerSecond: 25000000
        });
    
        let chunks = [];
        videoRecorder.ondataavailable = e => {
            chunks.push(e.data);
        };
    
        let timer = config.timerElement;
        if(timer) {
            timer.hidden = false;
            timer.innerText = "00:00";
        }
    
        videoRecorder.onstop = () => {
            if(timer) {
                timer.hidden = true;
            }
            downloadBlob(new Blob(chunks, {type: 'video/webm'}), '.webm');
        };
    
        videoRecorder.start();
        videoStartTime = Date.now();
    
        function updateTimer() {
            if(!videoStartTime) {
                return;
            }
    
            if(timer) {
                let duration = Math.floor((Date.now() - videoStartTime) / 1000);
                timer.innerText = Math.floor(duration / 60).toString().padStart(2, '0') + ':' + (duration % 60).toString().padStart(2, '0');
            }
    
            setTimeout(updateTimer, 1000);
        }
    
        setTimeout(updateTimer, 1000);
    }
    
    async function runModuleFromURL(url, keepUrl) {
        let response = await fetch(url);
        let type = response.headers.get('Content-Type');
        if((type && type.includes('html')) || response.status != 200) {
            return false;
        }
        // Only the local dev-server integration opts into identity response headers.
        const options = config.useSaveHeaders ? {
            saveId: response.headers.get('X-UW8-Save-Id') || undefined,
            profile: response.headers.get('X-UW8-Profile') || undefined,
        } : {};
        await runModule(await response.arrayBuffer(), keepUrl || devkitMode, options);
        return true;
    }

    return {
        runModule,
        runModuleFromURL,
        setDevkitMode: (m) => devkitMode = m,
    };
}
