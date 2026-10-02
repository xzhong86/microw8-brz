// A save belongs to a host-selected profile and game, never a guest-selected path.
export const MAX_SAVE = 65536;
export const ERR = Object.freeze({NOT_FOUND:-1, INVALID:-2, BUFFER_SMALL:-3, TOO_LARGE:-4,
    UNAVAILABLE:-5, IO:-6, CORRUPT:-7, CONFLICT:-8, DENIED:-9});
export function validateId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error('Invalid saveId/profile');
    return id;
}
export function readMetadata(module) {
    const sections = WebAssembly.Module.customSections(module, 'microw8.meta');
    if (!sections.length) return null;
    if (sections.length !== 1 || sections[0].byteLength > 4096) throw new Error('Duplicate or oversized microw8.meta');
    const meta = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(sections[0]));
    if (meta?.schemaVersion !== 1) throw new Error('Unsupported microw8.meta schemaVersion');
    validateId(meta.saveId);
    return meta;
}
export function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) {
        crc ^= byte;
        for (let i=0; i<8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (~crc) >>> 0;
}
export function encode(data, revision) {
    const bytes = new Uint8Array(20 + data.length);
    bytes.set(new TextEncoder().encode('UW8SAVE1'));
    const view = new DataView(bytes.buffer);
    view.setUint32(8, data.length, true);
    view.setUint32(12, revision, true);
    view.setUint32(16, crc32(data), true);
    bytes.set(data,20);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}
export function decode(text) {
    if (text.length > Math.ceil((MAX_SAVE + 20)/3)*4) throw ERR.CORRUPT;
    let bytes;
    try { bytes = Uint8Array.from(atob(text), c=>c.charCodeAt(0)); } catch { throw ERR.CORRUPT; }
    if (bytes.length < 20 || new TextDecoder().decode(bytes.subarray(0,8)) !== 'UW8SAVE1') throw ERR.CORRUPT;
    const view = new DataView(bytes.buffer);
    const len = view.getUint32(8,true), data = bytes.slice(20);
    if (!len || len > MAX_SAVE || len !== data.length || crc32(data) !== view.getUint32(16,true)) throw ERR.CORRUPT;
    return {data, revision:view.getUint32(12,true)};
}
export const deniedImports = () => Object.fromEntries(['saveSize','saveRead','saveWrite','saveDelete'].map(n=>[n,()=>ERR.DENIED]));

export async function createSave(memory, module, cart, options = {}) {
    const meta = readMetadata(module);
    const profile = validateId(options.profile ?? 'default');
    const id = options.saveId ?? meta?.saveId;
    if (id !== undefined) validateId(id);
    let storage, key, release, writable = false, closed = false, unavailable = false;
    try {
        const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b=>b.toString(16).padStart(2,'0')).join('');
        key = `microw8-brz:save:v1:${await digest(new TextEncoder().encode(profile))}:${await digest(id === undefined ? cart : new TextEncoder().encode(id))}`;
        storage = globalThis.localStorage;
        if (!storage) throw new Error('No storage');
    } catch { unavailable = true; }
    // Hold the lock for the whole game session; never wait indefinitely for another tab.
    if (!unavailable && globalThis.navigator?.locks) {
        await new Promise(resolve => {
            navigator.locks.request(key, {ifAvailable:true}, lock => {
                if (!lock) { resolve(); return; }
                writable = true;
                return new Promise(done => { release = done; resolve(); });
            }).catch(() => { resolve(); });
        });
    }
    const read = () => {
        if (closed) throw ERR.DENIED;
        if (unavailable) throw ERR.UNAVAILABLE;
        let text;
        try { text = storage.getItem(key); } catch { throw ERR.UNAVAILABLE; }
        if (text === null) throw ERR.NOT_FOUND;
        return decode(text);
    };
    const guard = fn => (...args) => {
        try { return fn(...args); } catch (e) { return typeof e === 'number' ? e : ERR.IO; }
    };
    const range = (ptr, len) => {
        if (len < 0) throw ERR.INVALID;
        const start = ptr >>> 0;
        if (start + len > memory.buffer.byteLength) throw ERR.INVALID;
        return start;
    };
    const writer = () => {
        if (closed) throw ERR.DENIED;
        if (unavailable) throw ERR.UNAVAILABLE;
        if (!writable) throw ERR.CONFLICT;
    };
    return {
        close() { closed = true; writable = false; if (release) { release(); release = null; } },
        imports: {
            saveSize: guard(() => read().data.length),
            saveRead: guard((ptr, capacity) => {
                const start = range(ptr, capacity), {data} = read();
                if (data.length > capacity) return ERR.BUFFER_SMALL;
                new Uint8Array(memory.buffer, start, data.length).set(data);
                return data.length;
            }),
            saveWrite: guard((ptr, len) => {
                if (len <= 0) return ERR.INVALID;
                if (len > MAX_SAVE) return ERR.TOO_LARGE;
                const start = range(ptr, len);
                const data = new Uint8Array(memory.buffer, start, len).slice();
                writer();
                let revision = 1;
                try { revision = (read().revision + 1) >>> 0; } catch (e) { if (e !== ERR.NOT_FOUND) throw e; }
                storage.setItem(key, encode(data, revision));
                return 0;
            }),
            saveDelete: guard(() => { writer(); storage.removeItem(key); return 0; }),
        },
    };
}
