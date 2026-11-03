import { Worker as NodeWorker } from "node:worker_threads";
// Browser-worker contract exercised with real worker threads and local immutable assets.
export class BrowserWorker {
  constructor(url) {
    const wrapper = `const {parentPort}=require('node:worker_threads');const fs=require('node:fs');const path=require('node:path');globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);globalThis.fetch=async (url,options={})=>{if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');const name=new URL(String(url),'http://localhost').pathname;const file=path.join(process.cwd(),name);return fs.existsSync(file)?new Response(fs.readFileSync(file)):new Response('Missing',{status:404});};import(${JSON.stringify(url.href)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`;
    this.worker = new NodeWorker(wrapper, { eval: true });
    this.worker.on("message", (data) => this.onmessage?.({ data }));
    this.worker.on("error", (error) => this.onerror?.(error));
  }
  postMessage(m) {
    this.worker.postMessage(m);
  }
  terminate() {
    return this.worker.terminate();
  }
}
