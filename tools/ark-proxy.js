const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 8787;

function proxyRequest(clientReq, clientRes) {
  if (clientReq.method === "OPTIONS") {
    clientRes.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    });
    clientRes.end();
    return;
  }

  const decoded = decodeURIComponent(clientReq.url.slice(1));
  if (!decoded.startsWith("https://") && !decoded.startsWith("http://")) {
    clientRes.writeHead(400);
    clientRes.end(JSON.stringify({ error: "invalid target URL" }));
    return;
  }

  const targetUrl = new URL(decoded);
  const headers = { ...clientReq.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;

  const proxyReq = https.request(
    targetUrl,
    { method: clientReq.method, headers },
    (proxyRes) => {
      const respHeaders = {
        ...proxyRes.headers,
        "access-control-allow-origin": "*",
      };
      clientRes.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(clientRes);
    }
  );

  proxyReq.on("error", () => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
      clientRes.end('{"error":"proxy error"}');
    }
  });

  clientReq.on("error", () => proxyReq.destroy());
  clientReq.pipe(proxyReq);
}

const server = http.createServer(proxyRequest);
server.listen(PORT, () => {
  console.log(`ARK proxy running on :${PORT}`);
  console.log(`Use in chat: http://YOUR_IP:${PORT}/`);
});
