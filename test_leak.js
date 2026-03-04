require('dotenv').config({ path: '.env' });
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const EventSource = require('eventsource');
global.EventSource = EventSource;

async function run() {
    let tokenStr = "dummy";
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3001/mcp"), {
        requestInit: { headers: { 'x-api-key': tokenStr } }
    });

    const mcpClient = new Client({ name: "test", version: "1" });
    await mcpClient.connect(transport);
    
    console.log("Connected");
    let initialCount = 0;
    
    // Attempt 100 calls to see if listeners increase
    for(let i=0; i<100; i++) {
        try {
            await mcpClient.listTools();
        } catch(e) {}
    }
    
    console.log("Done 100 calls. Transport close signal listeners:", transport._abortController?.signal?.listenerCount('abort') || "unknown");
    process.exit(0);
}
run();
