// Local-only preview. All provider calls are replaced with deterministic fixtures.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=await readFile(resolve(root,'functions/api/order.js'),'utf8');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const receipts=[];
globalThis.fetch=async (url,options)=>{
  if(url!=='https://api.resend.com/emails') throw new Error('Unexpected request in local preview');
  receipts.push(JSON.parse(options.body));
  return Response.json({id:'local-fixture-only'});
};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1:8107').pathname;
  try {
    if(pathname==='/__fixture__/receipts') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(receipts));return;}
    if(req.method==='POST' && pathname==='/api/order') {
      const chunks=[];for await(const c of req)chunks.push(c);
      const request=new Request('http://127.0.0.1:8107/api/order',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)});
      const response=await onRequest({request,env:{RESEND_API_KEY:'local-fixture-key',NOTIFY_TO:'fixture@example.test',NOTIFY_FROM:'Fixture <fixture@example.test>'}});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    let path=decodeURIComponent(pathname);
    if(path==='/') path='/index.html';
    if(!extname(path))path+='.html';
    const file=resolve(root,'.'+path);
    if(!file.startsWith(root.endsWith(sep)?root:root+sep)) {res.writeHead(404);res.end();return;}
    const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  } catch {res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(resolve(root,'404.html')));}
});
server.listen(8107,'127.0.0.1',()=>console.log('Local preview http://127.0.0.1:8107/index.html — provider delivery is a fixture; no email is sent.'));
