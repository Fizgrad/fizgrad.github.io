const http = require("http");

const PORT = 8787;
const TARGET = "https://ark.cn-beijing.volces.com";

const server = http.createServer((clientReq, clientRes) => {
  const url = new URL(clientReq.url, TARGET);

  const headers = { ...clientReq.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;

  const proxyReq = https.request(url, {
    method: clientReq.method,
    headers,
  }, (proxyRes) => {
    const respHeaders = { ...proxyRes.headers };
    respHeaders["access-control-allow-origin"] = "*";
    respHeaders["access-control-allow-headers"] = "*";
    respHeaders["access-control-allow-methods"] = "*";
    clientRes.writeHead(proxyRes.statusCode, respHeaders);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on("error", (e) => {
    clientRes.writeHead(502);
    clientRes.end(JSON.stringify({ error: e.message }));
  });

  clientReq.pipe(proxyReq);
});

const https = require("https");

server.listen(PORT, () => {
  console.log(`ARK proxy running on http://localhost:${PORT}`);
  console.log(`Base URL to use in chat: http://YOUR_SERVER:8787/api/plan/v3`);
});
