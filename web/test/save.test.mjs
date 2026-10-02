import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';
const source = readFileSync(new URL('../src/save.js', import.meta.url),'utf8');
const {createSave, deniedImports, crc32, readMetadata, MAX_SAVE, ERR, decode} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
Object.defineProperty(globalThis, 'crypto', {value:webcrypto, configurable:true});
const records = new Map();
let failWrite = false;
globalThis.localStorage = {
    getItem:k=>records.get(k) ?? null,
    setItem(k,v) { if (failWrite) throw new Error('quota'); records.set(k,v); },
    removeItem:k=>records.delete(k),
};
const held = new Set();
const locks = { async request(key, options, fn) {
    if (held.has(key)) return fn(null);
    held.add(key);
    try { return await fn({name:key}); } finally { held.delete(key); }
}};
Object.defineProperty(globalThis,'navigator',{value:{locks},configurable:true});
const blank = new WebAssembly.Module(Uint8Array.from([0,97,115,109,1,0,0,0]));
const memory = () => new WebAssembly.Memory({initial:4,maximum:4});
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('browser save replacement, reload, isolation, failure, bounds, locks and corruption', async () => {
    const mem = memory(), bytes = new Uint8Array(mem.buffer);
    bytes.set([1,2,3],81920);
    let save = await createSave(mem,blank,new Uint8Array([1]),{saveId:'web.test'});
    assert.equal(save.imports.saveSize(),ERR.NOT_FOUND);
    assert.equal(save.imports.saveWrite(81920,3),0);
    const committed = [...records.values()][0];
    assert.deepEqual([...decode(committed).data],[1,2,3]);
    const contender = await createSave(mem,blank,new Uint8Array([1]),{saveId:'web.test'});
    assert.equal(contender.imports.saveSize(),3);
    assert.equal(contender.imports.saveWrite(81920,3),ERR.CONFLICT);
    assert.equal(contender.imports.saveDelete(),ERR.CONFLICT);
    contender.close();
    for (const options of [{saveId:'web.other'},{saveId:'web.test',profile:'alice'}]) {
        const other = await createSave(mem,blank,new Uint8Array([1]),options);
        assert.equal(other.imports.saveSize(),ERR.NOT_FOUND); other.close();
    }
    assert.equal(save.imports.saveRead(82000,2),ERR.BUFFER_SMALL);
    assert.equal(bytes[82000],0);
    assert.equal(save.imports.saveRead(-1,3),ERR.INVALID);
    assert.equal(save.imports.saveWrite(262143,3),ERR.INVALID);
    assert.equal(save.imports.saveWrite(81920,-1),ERR.INVALID);
    assert.equal(save.imports.saveWrite(81920,MAX_SAVE+1),ERR.TOO_LARGE);
    failWrite = true;
    assert.equal(save.imports.saveWrite(81920,2),ERR.IO);
    assert.equal([...records.values()][0],committed);
    failWrite = false;
    save.close(); await tick();
    save = await createSave(mem,blank,new Uint8Array([99]),{saveId:'web.test'});
    assert.equal(save.imports.saveRead(82000,3),3);
    assert.deepEqual([...bytes.slice(82000,82003)],[1,2,3]);
    assert.equal(save.imports.saveWrite(81920,MAX_SAVE),0);
    assert.equal(save.imports.saveSize(),MAX_SAVE);
    const key = [...records.keys()][0]; records.set(key,'broken');
    assert.equal(save.imports.saveSize(),ERR.CORRUPT);
    assert.equal(save.imports.saveWrite(81920,3),ERR.CORRUPT);
    assert.equal(records.get(key),'broken');
    assert.equal(save.imports.saveDelete(),0);
    assert.equal(save.imports.saveDelete(),0);
    save.close(); await tick();
    assert.equal(save.imports.saveSize(),ERR.DENIED);
    navigator.locks = undefined;
    save = await createSave(mem,blank,new Uint8Array([1]),{saveId:'web.test'});
    assert.equal(save.imports.saveWrite(81920,3),ERR.CONFLICT);
    save.close(); navigator.locks = locks;
    const storage = globalThis.localStorage;
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('denied');}});
    save = await createSave(mem,blank,new Uint8Array([1]));
    assert.equal(save.imports.saveSize(),ERR.UNAVAILABLE);
    save.close(); Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage,writable:true});
    assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});

test('real WASM imports and current loader work with all cartridge encodings', async () => {
    const root = new URL('../../',import.meta.url);
    for (const file of ['save.wasm','save-uncompressed.uw8','save-compressed.uw8']) {
        const cart = readFileSync(new URL('target/save-test/'+file,root));
        const mem = memory();
        const {instance:loader} = await WebAssembly.instantiate(readFileSync(new URL('platform/bin/loader.wasm',root)),{env:{memory:mem}});
        new Uint8Array(mem.buffer).set(cart);
        const len = loader.exports.load_uw8(cart.length);
        const module = await WebAssembly.compile(new Uint8Array(mem.buffer,0,len).slice());
        assert.equal(readMetadata(module).saveId,'test.persistence');
        const save = await createSave(mem,module,cart);
        const instance = await WebAssembly.instantiate(module,{env:{memory:mem,...save.imports}});
        assert.equal(instance.exports.initial(),ERR.NOT_FOUND);
        assert.equal(instance.exports.write(81920,5),0);
        assert.equal(instance.exports.read(82000,5),5);
        assert.equal(new TextDecoder().decode(new Uint8Array(mem.buffer,82000,5)),'hello');
        assert.equal(instance.exports.delete(),0);
        save.close(); await tick();
        const audio = await WebAssembly.instantiate(module,{env:{memory:memory(),...deniedImports()}});
        assert.equal(audio.exports.initial(),ERR.DENIED);
        assert.equal(audio.exports.write(81920,5),ERR.DENIED);
        await assert.rejects(WebAssembly.instantiate(module,{env:{memory:memory()}}),WebAssembly.LinkError);
    }
});
