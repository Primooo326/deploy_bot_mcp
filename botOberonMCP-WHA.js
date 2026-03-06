require('dotenv').config();
const { io } = require("socket.io-client");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { default: axios } = require('axios');

const EventSource = require('eventsource');
global.EventSource = EventSource;
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const systemPrompt = `Eres Luna, la IA experta del ecosistema Oberon 360.
Tu misión principal es traducir las preguntas de los usuarios en consultas de datos precisas, construir filtros avanzados y ejecutar un plan de acción de forma confiable.

🚨 REGLAS GLOBALES DE COMPORTAMIENTO:
1. Siempre responde de manera concisa, amable y profesional.
2. Utiliza negritas (*texto*) y emojis acordes al contexto.
3. El número/identificador del usuario activo y el ID del mensaje te serán proporcionados. Úsalos exactamente igual para responder con la herramienta de Enviar_Mensaje_WhatsApp si necesitas adjuntar datos (o deja que el sistema devuelva tu respuesta en texto natural).

🎯 1. DOMINIO DE FUNCIONALIDADES
Asume que TODA consulta sobre registros (activos, rondas, inspecciones, etc.) se refiere a una Funcionalidad de la plataforma, salvo que el usuario especifique otro módulo.

🎯 2. PROTOCOLO DE BÚSQUEDA DE REGISTROS (CRÍTICO)
Paso 1: Para buscar información, invoca SIEMPRE primero 'Buscar_Funcionalidad_Por_Nombre' para obtener la estructura real y confirmar los Títulos de las columnas.
Paso 2: Invoca 'Buscar_Registros_De_Funcionalidad' aplicando los siguientes principios para los filtros:

[REGLA ESTRICTA DE FILTROS]
- Usa EXACTAMENTE LOS TÍTULOS VISIBLES obtenidos en el Paso 1 como claves (keys) del diccionario de búsqueda.
- Pasa los filtros como un diccionario PLANO. La herramienta ya se encarga de empaquetarlo.
- Para campos estáticos de relación (tipo lista desplegable, usuarios, módulos), utiliza el operador lógico 'equals'.

❌ EJEMPLO DE FILTRO INCORRECTO (NO ENVUELVAS EN COLUMNS NI FILTERS):
{"filters": {"columns": [{"Nombre": "Juan"}]}}

✅ EJEMPLO DE FILTRO CORRECTO (ENVÍO PLANO Y DIRECTO):
{"Nombre": "Juan", "Estado": "Activo", "operador_logico": "equals"}

🎯 3. MANEJO INTELIGENTE DE CERO RESULTADOS
Si 'Buscar_Registros_De_Funcionalidad' devuelve 0 resultados, ¡NO te rindas de inmediato! Haz lo siguiente internamente:
1. Vuelve a llamar a 'Buscar_Registros_De_Funcionalidad' SIN usar filtros (solo enviando idFuncionalidad y cantidad: 5), para descargar una muestra de los datos reales.
2. Compara tu filtro fallido con los datos reales asumiendo posibles errores (sensible a mayúsculas, campos anidados diferentes).
3. Reintenta la búsqueda principal con los parámetros corregidos.
4. Si aún así no hay resultados, informa al usuario cordialmente o haz una pregunta aclaratoria por si el término fue muy ambiguo (ej: hay varios "Juan").

🎯 4. REGLA ESPECIAL: VEHÍCULOS (GPS Y TEMPERATURA)
Para consultas exclusivas de ubicación, coordenadas o temperatura de placas/vehículos, IGNORA las funcionalidades de arriba y usa directamente las herramientas: 'Verificar_Estado_GPS_Placa' y 'Verificar_Estado_Temperatura_Placa'.

Estructura OBLIGATORIAMENTE tu respuesta final con esta plantilla:
🚗 *Placa:* [NÚMERO_DE_PLACA]
🚜 *Vehículo:* [vehiculo.tipo.label] - *Flota:* [vehiculo.flota.label]
📡 *Sensor:* [sensores.tipo.label (si existe)]
📊 *Estado GPS:* [gps.estado] a [gps.velocidad] km/h
🕒 *Último Reporte:* [Fecha y hora legible]
📍 *Dirección:* [gps.ubicacion.address]
🗺️ *Ubicación en Mapa:* https://www.google.com/maps/search/?api=1&query=[gps.ubicacion.lat],[gps.ubicacion.lng]
🌡️ *Temperatura:* [Solo si consultaste temperatura, incluye aquí su valor y fecha. Si no lo consultaste, ignora esta línea por completo]

(Si estas herramientas devuelven éxito = falso o sin datos, di: "La placa [número] no se encuentra integrada o registrada en Oberon").

🎯 5. EXPORTACIONES MASIVAS (EXCEL)
Las herramientas de obtención tienen bandera de exportación (ej: exportToExcel). Activa esa bandera como verdadera de forma proactiva si ves que el resultado será muy masivo (> 20 resultados) o el usuario pide gráficamente un archivo Excel, devolviéndole en tu respuesta las URLs descargables que el sistema te retorne.`;


const modelText = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite-preview",
    systemInstruction: systemPrompt
});

let mcpClient = null;
let mcpTools = [];
let geminiTools = [];

let tokenStr = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJERkYyN0Q1Ri03MkQwLTQxNzMtOUZDQS03MDhENjE4NUQ5MUIiLCJjbGllbnRJZCI6IkZDOUNFQ0VGLTkzQjktRUYxMS04OEQwLTYwNDVCRDc5OTBFMSIsImlhdCI6MTc3MjIyMzUzOCwiZXhwIjoxNzcyMzA5OTM4fQ.ML9rtJmzBsOqLv1gT0XitITaIRGNdhmvme6-Fdo7zrw";

async function loginOberon() {
    console.log("🔄 Autenticando en Oberon para obtener nuevo token...");
    try {
        const loginUrl = process.env.OBERON_LOGIN_URL || "https://api.oberon360.com/api/core/auth/login";
        const res = await axios.post(loginUrl, {
            "user": process.env.OBERON_USER || "JAndrés",
            "password": process.env.OBERON_PASSWORD || "00006"
        });
        if (res.data && res.data.data && res.data.data.token) {
            tokenStr = res.data.data.token;
            console.log("✅ Nuevo token de Oberon obtenido exitosamente.");
        } else {
            console.error("❌ Falló la obtención del token, la respuesta no contenía el token esperado.", res.data);
        }
    } catch (err) {
        console.error("❌ Error en el proceso de login:", err.message);
    }
}

async function initMCP() {
    try {
        // API key used by oberon server verification (constants.js format / checkToken)

        const mcpUrl = process.env.MCP_SERVER_URL || "https://mcp.oberon360.com/mcp";
        const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
            requestInit: { headers: { 'x-api-key': tokenStr } },
            fetch: async (url, init) => {
                // Eliminar el AbortSignal para evitar el memory leak en Node.js de listeners
                // Esto asegura que la cantidad de listeners sea cero, sin requerir aumento global de limites
                if (init && init.signal) {
                    delete init.signal;
                }
                return fetch(url, init);
            }
        });

        mcpClient = new Client({
            name: "bot-placas-client",
            version: "1.0.0",
        });

        await mcpClient.connect(transport);
        console.log("✅ Conectado al servidor MCP local (http://localhost:3001/mcp)");

        const toolsResponse = await mcpClient.listTools();
        mcpTools = toolsResponse.tools;

        // Gemini no soporta $schema ni additionalProperties en el formato FunctionDeclaration
        function cleanSchema(schema) {
            if (!schema || typeof schema !== 'object') return schema;
            if (Array.isArray(schema)) {
                return schema.map(cleanSchema);
            }
            const newSchema = { ...schema };
            delete newSchema['$schema'];
            delete newSchema['additionalProperties'];

            for (const key in newSchema) {
                if (typeof newSchema[key] === 'object') {
                    newSchema[key] = cleanSchema(newSchema[key]);
                }
            }
            return newSchema;
        }

        geminiTools = mcpTools.map(tool => {
            return {
                name: tool.name,
                description: tool.description || `Herramienta ${tool.name}`,
                parameters: cleanSchema(tool.inputSchema)
            };
        });
        console.log(`✅ ${geminiTools.length} herramientas MCP cargadas en Gemini format.`);
    } catch (err) {
        console.error("❌ Error al conectar al MCP server:", err.message);
        if (err.message.includes("Token") || err.message.includes("400") || err.message.includes("401")) {
            console.log("⚠️ Token inválido o expirado. Intentando renovar...");
            await loginOberon();
            console.log("🔄 Reintentando conexión MCP tras obtener token...");
            setTimeout(initMCP, 2000); // Wait bit before retry
        } else if (err.message.includes("320") || err.message.toLowerCase().includes("timeout") || err.message.toLowerCase().includes("econnrefused")) {
            console.log("⏳ Servidor MCP no responde o Timeout. Reintentando de nuevo en 5 segundos...");
            setTimeout(initMCP, 5000); // Esperar más tiempo y reintentar
        }
    }
}

initMCP();

const wsUrl = process.env.WHA_WEBSOCKET_URL || "https://wha.oberon360.com/";
const socket = io(wsUrl, {
    reconnection: true,             // Habilitar reconexión automática
    reconnectionDelay: 1000,        // Esperar 1 segundo antes del primer intento
    reconnectionDelayMax: 5000,     // Tiempo máximo de espera entre intentos (5s)
    reconnectionAttempts: Infinity  // Reintentar de forma indefinida
});

console.log("🔌 Iniciando conexión con el WebSocket...");

socket.on("connect", () => {
    console.log("✅ Conectado exitosamente al WebSocket con ID:", socket.id);
});


socket.on("whatsapp_message", async (data) => {
    if (!data || !data.body || data.type !== "chat") return;

    const bodyText = data.body.trim();
    // Considerar que empieza con "/luna " o que es exactamente "/luna"
    const isLunaCommand = bodyText.toLowerCase().startsWith("/luna ") || bodyText.toLowerCase() === "/luna";

    if (isLunaCommand) {
        // Extraer lo que está después de "/luna"
        let userPrompt = "";
        if (bodyText.toLowerCase() !== "/luna") {
            userPrompt = bodyText.substring(6).trim();
        }

        console.log("🤖 Comando /luna detectado. Prompt:", userPrompt || "(vacío)");

        // Si solo dicen /luna sin texto y sin citar un mensaje
        if (!userPrompt && !data.hasQuotedMsg) {
            enviarRespuesta("¿En qué te puedo servir?", [data.from]);
            return;
        }

        try {
            if (geminiTools.length === 0) {
                enviarRespuesta("⚠️ Estoy inicializando mis herramientas o perdí la conexión con el servidor. Por favor, intenta de nuevo en unos segundos.", [data.from]);
                return;
            }

            const chatSession = modelText.startChat({
                tools: geminiTools.length > 0 ? [{ functionDeclarations: geminiTools }] : undefined
            });

            let extraContext = "";
            if (data.hasQuotedMsg && data.quotedMessage) {
                extraContext = `\nMensaje_Citado_Contexto: "${data.quotedMessage.body}" (Enviado por: ${data.quotedMessage.name || data.quotedMessage.from})`;
            }

            let result = await chatSession.sendMessage(`Usuario_Destino (to): ${data.from}\nMensaje_Usuario: ${userPrompt}${extraContext}\nID_Mensaje (replyMessageId): ${data.id}\n\nRECUERDA: Responde mediante la herramienta Enviar_Mensaje_WhatsApp. En el argumento 'to' debes poner un array de string con ÚNICAMENTE este valor: "${data.from}". En 'replyMessageId' debes usar el ID_Mensaje (${data.id}).`);

            let isDone = false;
            while (!isDone) {
                const fcs = result.response.functionCalls();
                if (fcs && fcs.length > 0) {
                    const call = fcs[0]; // Gemini suele enviar 1 tool call a la vez aquí
                    console.log(`⚙️ Gemini solicita ejecutar la herramienta: ${call.name}`);
                    console.dir(call.args, { depth: null, colors: true });

                    try {
                        const toolResult = await mcpClient.callTool({
                            name: call.name,
                            arguments: call.args
                        });

                        console.log(`✅ Resultado de herramienta ${call.name}:`, JSON.stringify(toolResult.content[0]).substring(0, 100) + "...");

                        result = await chatSession.sendMessage([{
                            functionResponse: {
                                name: call.name,
                                response: { result: toolResult.content }
                            }
                        }]);

                    } catch (toolErr) {
                        console.error("❌ Error al ejecutar tool MCP:", toolErr);
                        result = await chatSession.sendMessage([{
                            functionResponse: {
                                name: call.name,
                                response: { error: toolErr.message }
                            }
                        }]);
                    }
                } else {
                    isDone = true;
                    console.log("💬 Ejecución de herramientas por Gemini finalizada.");
                    try {
                        let fallbackText = result.response.text();
                        if (fallbackText && fallbackText.trim().length > 0) {
                            console.log("💬 Gemini finalizó devolviendo solo texto plano:", fallbackText.substring(0, 100));
                            enviarRespuesta(fallbackText, [data.from]);
                        }
                    } catch (e) {
                        // ignore if text() throws
                    }
                }
            }

        } catch (err) {
            console.error("❌ Error al procesar comando /luna con Gemini:", err);
            enviarRespuesta("Hubo un error al procesar tu solicitud con /luna.", [data.from]);
        }
        return;
    }

});

socket.on("disconnect", () => {
    console.log("❌ Desconectado del WebSocket");
});

socket.on("connect_error", (err) => {
    console.log(`⚠️ Error de conexión con el WebSocket: ${err.message}`);
});


function enviarRespuesta(mensaje, to) {
    const sendUrl = process.env.WHA_API_SEND_URL || "https://wha.oberon360.com/api/wha/send";
    axios.post(sendUrl, {
        "to": to,
        "message": mensaje
    }, {
        headers: {
            'bearer': tokenStr
        }
    })

}