// bot.js
const puppeteer = require("puppeteer");
const http = require("http"); // Para enviar notificaciones HTTP/HTTPS
const https = require("https"); // Para enviar notificaciones HTTPS

// Función para obtener la fecha y hora actual formateada [DDMMMYY HH:MM:SS]
function getCurrentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-US', { month: 'short' }); // Ej: Oct
  const year = String(now.getFullYear()).slice(-2); // Últimos 2 dígitos del año
  const timeStr = now.toLocaleTimeString('es-ES', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return `[${day}${month}${year} ${timeStr}]`;
}

// Función para extraer segundos del texto del temporizador
function parseCountdownText(countdownText) {
  // Ejemplo: "06 hours 23 min 28 sec" -> { hours: 6, minutes: 23, seconds: 28 }
  // También puede ser "21 hours 15 min 42 sec"
  const regex = /(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/;
  const match = countdownText.match(regex);

  if (match && match.length === 4) {
    return {
      hours: parseInt(match[1], 10),
      minutes: parseInt(match[2], 10),
      seconds: parseInt(match[3], 10)
    };
  }

  // Si no coincide el formato, asumir 0 segundos para evitar errores
  console.warn(`${getCurrentTimestamp()} ⚠️ No se pudo parsear el texto del temporizador: "${countdownText}". Usando 0 segundos.`);
  return { hours: 0, minutes: 0, seconds: 0 };
}

// Función para convertir tiempo a milisegundos
function timeToMilliseconds(timeObj) {
  return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
}

// Función para calcular la hora futura
function getFutureDateTime(milliseconds) {
  const now = new Date();
  const future = new Date(now.getTime() + milliseconds);
  // Formatear la fecha como "DD MMM YYYY"
  const dateStr = future.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  // Formatear la hora como "HH:MM:SS"
  const timeStr = future.toLocaleTimeString('es-ES', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return { dateStr, timeStr };
}

// Función para enviar una notificación POST condicional
async function sendNotification(message) { // 'message' se mantiene por si se desea en el futuro
    const notificationUrl = process.env.NOTIFICATION;

    // Solo enviar si la variable NOTIFICATION está definida y no está vacía
    if (!notificationUrl) {
        console.log(`${getCurrentTimestamp()} ℹ️ Variable NOTIFICATION no definida. Omitiendo notificación.`);
        return;
    }

    console.log(`${getCurrentTimestamp()} 📢 Enviando notificación a: ${notificationUrl}`);

    return new Promise((resolve) => {
        const postData = ''; // Sin datos en el cuerpo del POST

        // Usar 'new URL()' para parsear correctamente el protocolo (http o https), hostname, puerto y path
        let url;
        try {
           url = new URL(notificationUrl);
        } catch (err) {
            console.error(`${getCurrentTimestamp()} ⚠️ Error al parsear la URL de notificación '${notificationUrl}': ${err.message}. Omitiendo notificación.`);
            resolve(); // Resolver para no romper el flujo principal
            return;
        }

        // Determinar si usar 'http' o 'https' basado en el protocolo de la URL
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http; // Usar módulos específicos

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80), // Puerto por defecto si no se especifica
            path: url.pathname + url.search, // Incluye ruta y parámetros de consulta
            method: 'POST',
            headers: {
                // 'Content-Type': 'application/json', // Opcional: Puedes eliminarlo si no es requerido por el endpoint
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        // Crear la solicitud usando el módulo apropiado (http o https)
        const req = httpModule.request(options, (res) => {
            console.log(`${getCurrentTimestamp()} ✅ Notificación enviada. Código de estado: ${res.statusCode}`);
            resolve(); // Resolvemos la promesa independientemente del código de estado
        });

        req.on('error', (e) => {
            console.error(`${getCurrentTimestamp()} ⚠️ Error al enviar notificación a '${notificationUrl}': ${e.message}`);
            // No resolvemos con error para no romper el flujo principal
            resolve();
        });

        // Escribir datos al cuerpo de la solicitud (vacío en este caso)
        req.write(postData);
        req.end();
    });
}


let browser;
let page;
let isFirstRun = true;

// Variables para recordar el último nth-child exitoso
let lastBalanceNth = 2; // Inicializamos con el valor que sabemos que funcionó
let lastPotNth = 5;     // Inicializamos con el valor que sabemos que funcionó

// Función para login con reintentos
async function login() {
  for (let attempt = 1; attempt < 4; ++attempt) {
    try {
      const email = process.env.PACKET_EMAIL;
      const password = process.env.PACKET_PASSWORD;

      console.log(`${getCurrentTimestamp()} ✍️ Escribiendo credenciales (intento ${attempt})...`);
      await page.type("#email", email, { delay: 50 });
      await page.type("#password", password, { delay: 50 });

      console.log(`${getCurrentTimestamp()} 🔑 Enviando login...`);
      await page.click(".sc-kLhKbu.dEXYZj.hg-login-with-email");
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
      return true;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Silently attempt to log in ${attempt} times failed.`);
      }
      console.log(`${getCurrentTimestamp()} ⚠️ Intento ${attempt} fallido. Reintentando en 30 segundos...`);
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
}

// Función para encontrar un selector probando diferentes valores de nth-child
async function findElementByNthChild(baseSelector, nthValues, description) {
  // Primero intentar con el último valor que funcionó
  const lastNth = description === 'balance' ? lastBalanceNth : lastPotNth;
  const lastNthSelector = baseSelector.replace('NTH', lastNth.toString());
  console.log(`${getCurrentTimestamp()} 🔍 Intentando ${description} con último nth-child exitoso (${lastNth})...`);
  try {
    await page.waitForSelector(lastNthSelector, { timeout: 5000 });
    console.log(`${getCurrentTimestamp()} ✅ ${description} encontrado con nth-child(${lastNth}).`);
    return lastNthSelector;
  } catch (e) {
    console.log(`${getCurrentTimestamp()} ⚠️ ${description} no encontrado con nth-child(${lastNth}). Probando otros valores...`);
  }

  // Si el último no funciona, recorrer la lista
  for (const n of nthValues) {
    if (n === lastNth) continue; // Ya probamos este
    const tentativeSelector = baseSelector.replace('NTH', n.toString());
    console.log(`${getCurrentTimestamp()} 🔍 Probando ${description} con nth-child(${n})...`);
    try {
      await page.waitForSelector(tentativeSelector, { timeout: 5000 });
      console.log(`${getCurrentTimestamp()} ✅ ${description} encontrado con nth-child(${n}).`);
      // Actualizar la variable global con el nuevo valor exitoso
      if (description === 'balance') {
        lastBalanceNth = n;
      } else {
        lastPotNth = n;
      }
      return tentativeSelector;
    } catch (e) {
      continue; // Intentar con el siguiente valor
    }
  }
  // Si ninguno funciona
  console.log(`${getCurrentTimestamp()} ⚠️ No se encontró el selector de ${description} con ninguno de los valores de nth-child probados.`);
  return null;
}

// Función para extraer el balance numérico de un contenedor ya encontrado
async function extractBalanceFromContainer(containerElement) {
    if (!containerElement) {
        console.log(`${getCurrentTimestamp()} ⚠️ Contenedor de balance no proporcionado para extracción.`);
        return null;
    }
    try {
        // 1. Obtener todo el texto del contenedor
        const fullText = await page.evaluate(element => element.textContent, containerElement);
        console.log(`${getCurrentTimestamp()} ℹ️ Texto completo del contenedor de balance: "${fullText}"`);

        // 2. Buscar la posición de "Current balance"
        const balanceLabelIndex = fullText.toLowerCase().indexOf('current balance');
        if (balanceLabelIndex === -1) {
            console.log(`${getCurrentTimestamp()} ⚠️ No se encontró la etiqueta 'Current balance' en el contenedor.`);
            return null;
        }

        // 3. Extraer el texto que viene después de "Current balance"
        const textAfterLabel = fullText.substring(balanceLabelIndex + 'current balance'.length).trim();
        console.log(`${getCurrentTimestamp()} ℹ️ Texto después de 'Current balance': "${textAfterLabel}"`);

        // 4. Buscar un patrón numérico que coincida con formatos comunes de balance en ese fragmento
        //    Busca dígitos, posiblemente separados por comas o puntos, incluyendo puntos/comas decimales
        //    y que esté al principio del texto extraído (o después de espacios)
        const balanceRegex = /^\s*([\d.,]+\d)/; // ^ indica inicio del string, \s* espacios iniciales
        const match = textAfterLabel.match(balanceRegex);

        if (match && match[1]) {
            const potentialBalance = match[1];
            console.log(`${getCurrentTimestamp()} ℹ️ Valor numérico potencial encontrado después de 'Current balance': "${potentialBalance}"`);
            // Validar que el match tenga sentido como balance (no es solo un número suelto)
            // Una simple validación: que tenga al menos un separador (, o .) o sea mayor a 999
            if (potentialBalance.includes(',') || potentialBalance.includes('.') || parseInt(potentialBalance.replace(/,/g, '').replace(/\./g, ''), 10) > 999) {
                return potentialBalance;
            } else {
                console.log(`${getCurrentTimestamp()} ⚠️ El valor potencial "${potentialBalance}" no parece un balance válido.`);
            }
        } else {
            console.log(`${getCurrentTimestamp()} ⚠️ No se encontró un patrón numérico de balance después de 'Current balance'.`);
        }
    } catch (e) {
        console.log(`${getCurrentTimestamp()} ⚠️ Error al extraer balance del contenedor: ${e.message}`);
    }
    return null;
}

// *** Nueva función: Buscar conteo regresivo por selector CSS ***
async function findAndExtractCountdownBySelector() {
    console.log(`${getCurrentTimestamp()} 🔍 Intentando encontrar conteo regresivo por selector CSS...`);
    try {
        // Selector basado en el elemento HTML proporcionado
        // Selecciona el div contenedor principal con las clases específicas
        const countdownContainerSelector = 'div.sc-duWCru.dPYLJV';

        // Esperar a que el contenedor esté presente
        await page.waitForSelector(countdownContainerSelector, { timeout: 5000 });
        console.log(`${getCurrentTimestamp()} ✅ Contenedor del conteo regresivo encontrado por selector.`);

        // Verificar si contiene el texto "Time left to collect" O "Next pot available in"
        const container = await page.$(countdownContainerSelector);
        const containerText = await page.evaluate(el => el.textContent, container);

        // Buscar ambas opciones de texto
        const timeLeftToCollectFound = containerText && containerText.includes("Time left to collect");
        const nextPotAvailableInFound = containerText && containerText.includes("Next pot available in");

        if (timeLeftToCollectFound || nextPotAvailableInFound) {
            const foundText = timeLeftToCollectFound ? "Time left to collect" : "Next pot available in";
            console.log(`${getCurrentTimestamp()} ✅ Texto '${foundText}' encontrado en el contenedor.`);

            // Buscar el elemento <p> que contiene el temporizador
            // Este es el segundo <p> dentro del contenedor, o el que tiene la clase específica
            const timeParagraphSelector = `${countdownContainerSelector} > p.sc-etPtWW.hRiIai`;
            await page.waitForSelector(timeParagraphSelector, { timeout: 2000 }); // Corto timeout ya que el contenedor existe

            // Extraer el texto del temporizador del párrafo
            const timeText = await page.$eval(timeParagraphSelector, el => el.textContent);
            console.log(`${getCurrentTimestamp()} ✅ Texto del temporizador extraído: ${timeText}`);

            if (timeText) {
                // Parsear el tiempo y calcular espera
                const timeObj = parseCountdownText(timeText);
                const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos

                // Programar el próximo ciclo
                const { dateStr: futureDateTimeDate, timeStr: futureDateTimeTime } = getFutureDateTime(waitTimeMs);
                const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
                console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${futureDateTimeDate} a las ${futureDateTimeTime} que son aproximadamente en ${minutes} minutos...`);

                return { found: true, waitTimeMs };
            } else {
                console.log(`${getCurrentTimestamp()} ⚠️ No se pudo extraer el texto del temporizador del párrafo encontrado.`);
            }
        } else {
             console.log(`${getCurrentTimestamp()} ⚠️ El contenedor encontrado no contiene ninguno de los textos esperados ('Time left to collect' o 'Next pot available in').`);
        }
    } catch (e) {
        console.log(`${getCurrentTimestamp()} ℹ️ No se encontró conteo regresivo por selector CSS: ${e.message}`);
    }

    console.log(`${getCurrentTimestamp()} ℹ️ No se encontró conteo regresivo usando el selector CSS principal.`);
    return { found: false };
}

// *** Nueva función: Buscar conteo regresivo por texto en toda la página (fallback) ***
async function findAndExtractCountdownByText() {
    console.log(`${getCurrentTimestamp()} 🔍 Buscando conteo regresivo por texto en toda la página (fallback)...`);
    try {
        // Evaluar en toda la página buscando un elemento que contenga EXACTAMENTE el texto esperado
        const countdownInfo = await page.evaluate(() => {
            // Textos exactos que identifican el conteo regresivo
            const labelTimes = ["time left to collect", "next pot available in"];

            // Buscar todos los divs, ya que el contenedor principal suele ser un div
            const divElements = document.querySelectorAll('div');

            for (let divElement of divElements) {
                const divText = divElement.textContent?.toLowerCase().trim();
                // console.log(`Revisando div: ${divText.substring(0, 50)}...`); // Para debugging

                // Verificar si el texto del div contiene alguna de las etiquetas buscadas
                for (const labelTime of labelTimes) {
                    if (divText && divText.includes(labelTime)) {
                        console.log(`[${new Date().toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ℹ️ Posible contenedor de conteo encontrado. Texto: ${divText.substring(0, 100)}...`);

                        // Ahora, dentro de este div, buscar el elemento que contiene el temporizador.
                        // El temporizador está en un elemento hermano o hijo que contiene los spans.

                        // Estrategia: Buscar todos los elementos hijos o descendientes que puedan contener el tiempo
                        // y verificar si tienen la estructura de spans.
                        const potentialContainers = divElement.querySelectorAll('*'); // Todos los descendientes

                        for (let container of potentialContainers) {
                            const spans = container.querySelectorAll('span');
                            // console.log(`Revisando contenedor con ${spans.length} spans`); // Para debugging

                            // Un temporizador típico tiene al menos 4 spans: HH, hours, MM, min (y posiblemente SS, sec)
                            if (spans.length >= 4) {
                                // Intentar construir el texto del temporizador
                                let timeParts = [];
                                let isValidTimeStructure = true;

                                for (let i = 0; i < Math.min(spans.length, 6); i++) { // Limitar a 6 partes por si acaso
                                    const spanText = spans[i].textContent?.trim();
                                    if (spanText) {
                                        timeParts.push(spanText);
                                    } else {
                                        // Si un span está vacío, puede no ser el contenedor correcto
                                        isValidTimeStructure = false;
                                        break;
                                    }
                                }

                                if (isValidTimeStructure && timeParts.length >= 4) {
                                    const countdownText = timeParts.join(' ');
                                    console.log(`[${new Date().toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ℹ️ Posible texto de temporizador extraído: ${countdownText}`);

                                    // Validación básica: debe contener 'hours' y 'min'
                                    if (countdownText.toLowerCase().includes('hours') && countdownText.toLowerCase().includes('min')) {
                                        console.log(`[${new Date().toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ✅ Conteo regresivo encontrado y validado.`);
                                        return {
                                            text: countdownText,
                                            elementHtml: divElement.outerHTML.substring(0, 200) // Para debugging
                                        };
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Si llegamos aquí, no se encontró el conteo regresivo con la estrategia principal
            console.log(`[${new Date().toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ℹ️ No se encontró el contenedor principal del conteo regresivo con la estrategia de búsqueda de spans.`);
            return null;
        });

        if (countdownInfo && countdownInfo.text) {
            console.log(`${getCurrentTimestamp()} ✅ Conteo regresivo encontrado por texto: ${countdownInfo.text}`);
            // console.log(`${getCurrentTimestamp()} ℹ️ Fragmento HTML donde se encontró: ${countdownInfo.elementHtml}...`); // Opcional para debugging

            // Parsear el tiempo y calcular espera
            const timeObj = parseCountdownText(countdownInfo.text);
            const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos

            // Programar el próximo ciclo
            const { dateStr: futureDateTimeDate, timeStr: futureDateTimeTime } = getFutureDateTime(waitTimeMs);
            const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
            console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${futureDateTimeDate} a las ${futureDateTimeTime} que son aproximadamente en ${minutes} minutos...`);

            return { found: true, waitTimeMs };
        } else {
            console.log(`${getCurrentTimestamp()} ⚠️ No se encontró texto relacionado con conteo regresivo en la página usando la estrategia refinada.`);
        }
    } catch (e) {
        console.log(`${getCurrentTimestamp()} ⚠️ Error al buscar conteo regresivo por texto: ${e.message}`);
    }
    return { found: false };
}


// Función principal del ciclo
async function runCycle() {
  try {
    if (isFirstRun) {
      console.log(`${getCurrentTimestamp()} 🚀 Iniciando bot de PacketShare...`);
      browser = await puppeteer.launch({
        headless: "new", // Usar el nuevo modo headless
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-background-networking",
          "--disable-translate",
          "--disable-sync",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-breakpad",
          "--disable-component-extensions-with-background-pages",
          "--metrics-recording-only",
          "--mute-audio",
          "--no-first-run",
          "--no-zygote",
          // Añadir user agent para parecer más humano
          "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
        ],
      });

      page = await browser.newPage();

      console.log(`${getCurrentTimestamp()} 🌐 Abriendo página de login...`);
      const response = await page.goto("https://dashboard.packetshare.io/login/", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      console.log(`   Estado de carga: ${response.status()}`);

      // Verificar si hay mensaje de JavaScript no soportado
      const content = await page.content();
      if (content.includes("Your browser does not support JavaScript!")) {
        console.log(`${getCurrentTimestamp()} ⚠️ La página indica que el navegador no soporta JavaScript. Esto puede ser un problema para la automatización.`);
        // Opcional: Tomar un screenshot para debugging
        // await page.screenshot({ path: 'js_error.png', fullPage: true });
      }

      // Esperar y hacer clic en el botón inicial si aparece
      console.log(`${getCurrentTimestamp()} 🔍 Esperando botón inicial...`);
      try {
        await page.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 });
        console.log(`${getCurrentTimestamp()} 👆 Haciendo clic en botón inicial...`);
        await page.click(".sc-kLhKbu.cRDTkV");
      } catch (e) {
        console.log(`${getCurrentTimestamp()} ℹ️ No se encontró botón inicial, continuando...`);
      }

      // Esperar a que los campos de entrada estén disponibles
      console.log(`${getCurrentTimestamp()} 🔍 Esperando campos de login...`);
      await page.waitForSelector('#email', { timeout: 15000 });
      await page.waitForSelector('#password', { timeout: 15000 });
      await page.waitForSelector("div.btn.login", { timeout: 10000 });

      const email = process.env.PACKET_EMAIL;
      const password = process.env.PACKET_PASSWORD;

      if (!email || !password) {
        throw new Error("❌ Variables de entorno PACKET_EMAIL y PACKET_PASSWORD requeridas.");
      }

      // Realizar login
      if (await login()) {
        console.log(`${getCurrentTimestamp()} ✅ Login exitoso. Redirigido a dashboard.`);

        // Verificar que estamos en el dashboard
        const currentUrl = page.url();
        console.log(`📍 URL después del login: ${currentUrl}`);

        if (!currentUrl.includes("dashboard.packetshare.io/")) {
          throw new Error("No se pudo acceder al dashboard después del login");
        }
      } else {
        throw new Error("No se pudo realizar el login");
      }

      isFirstRun = false;
    } else {
      // En ciclos posteriores, solo refrescamos la página
      console.log(`${getCurrentTimestamp()} 🔄 Refrescando dashboard...`);
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForTimeout(5000); // Esperar un poco más después de refrescar
    }

    // --- LÓGICA MEJORADA: Verificar balance ANTES de reclamar ---
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance ANTES de intentar reclamar...`);
    // Esperar un poco más para que el contenido dinámico se cargue
    await page.waitForTimeout(5000);

    // Definir la base del selector para el contenedor del balance
    const balanceBaseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div';
    const possibleBalanceNths = [1, 2, 3, 4, 5]; // Rango de valores a probar para el balance

    let balanceBefore = "0";
    let balanceBeforeFound = false;

    // Usar la función para encontrar el contenedor del balance
    const balanceContainerSelector = await findElementByNthChild(balanceBaseSelector, possibleBalanceNths, 'balance');
    if (balanceContainerSelector) {
        try {
          const balanceContainer = await page.$(balanceContainerSelector);
          // Usar la nueva función para extraer el balance del contenedor
          const extractedBalance = await extractBalanceFromContainer(balanceContainer);
          if (extractedBalance) {
              balanceBefore = extractedBalance;
              balanceBeforeFound = true;
              console.log(`${getCurrentTimestamp()} ✅ Balance ANTES encontrado: ${balanceBefore}`);
          } else {
              console.log(`${getCurrentTimestamp()} ⚠️ No se pudo extraer un valor numérico válido del contenedor encontrado (ANTES).`);
          }
        } catch (e) {
          console.log(`${getCurrentTimestamp()} ⚠️ Error al extraer balance del contenedor encontrado (ANTES): ${e.message}`);
        }
    }

    if (!balanceBeforeFound) {
      throw new Error("No se pudo encontrar el elemento del balance ANTES de reclamar después de múltiples intentos.");
    }

    console.log(`${getCurrentTimestamp()} 💰 Balance ANTES: ${balanceBefore}`);

    // Verificar si aparece el conteo regresivo o el botón de reclamar
    console.log(`${getCurrentTimestamp()} 🔍 Verificando si hay conteo regresivo o botón de reclamar...`);

    // Esperar un poco para que se cargue el contenido del botón/conteo
    await page.waitForTimeout(3000);

    // *** Nueva lógica: Intentar primero por selector CSS ***
    let countdownResult = await findAndExtractCountdownBySelector();

    // *** Si falla el selector CSS, intentar por texto ***
    if (!countdownResult.found) {
        countdownResult = await findAndExtractCountdownByText();
    }

    // *** Evaluar el resultado de ambas estrategias ***
    if (countdownResult.found) {
        // Si se encontró el conteo regresivo, programar el próximo ciclo y salir
        setTimeout(runCycle, countdownResult.waitTimeMs);
        return; // Salir de la función para no continuar con la búsqueda del botón
    }

    // Si no se encontró conteo regresivo, verificar si hay botón de reclamar
    console.log(`${getCurrentTimestamp()} ℹ️ No se encontró conteo regresivo. Verificando si hay botón de reclamar...`);

    // Definir la base del selector para el contenedor del conteo/botón
    const potBaseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div';
    const possiblePotNths = [1, 2, 3, 4, 5]; // Rango de valores a probar para el conteo/botón

    let potContainerSelector = await findElementByNthChild(potBaseSelector, possiblePotNths, 'conteo/botón');
    if (potContainerSelector) {
        try {
          // El botón de reclamar debería estar dentro del mismo contenedor general
          // Buscar el botón directamente dentro del contenedor
          const claimButton = await page.$(`${potContainerSelector} button`);
          if (claimButton) {
              // Verificar el texto del botón para asegurarnos
              const buttonText = await page.evaluate(el => el.textContent, claimButton);
              console.log(`${getCurrentTimestamp()} ✅ Botón de reclamar encontrado (en contenedor encontrado). Texto del botón: "${buttonText}". Haciendo clic para reclamar el premio...`);

              // Hacer clic en el botón de reclamar
              await page.click(`${potContainerSelector} button`);

              // Esperar un momento después de reclamar
              console.log(`${getCurrentTimestamp()} ⏳ Esperando después de reclamar el premio...`);
              await page.waitForTimeout(5000);

              // --- LÓGICA MEJORADA: Verificar balance DESPUÉS de reclamar ---
              // Refrescar la página para obtener el balance actualizado
              console.log(`${getCurrentTimestamp()} 🔄 Refrescando página para obtener balance DESPUÉS de reclamar...`);
              await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
              await page.waitForTimeout(5000);

              console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance DESPUÉS de intentar reclamar...`);
              // Esperar un poco más para que el contenido dinámico se cargue
              await page.waitForTimeout(5000);

              let balanceAfter = "0";
              let balanceAfterFound = false;

              // Usar la función para encontrar el contenedor del balance (nuevamente después del refresh)
              const newBalanceContainerSelector = await findElementByNthChild(balanceBaseSelector, possibleBalanceNths, 'balance');
              if (newBalanceContainerSelector) {
                  try {
                    const newBalanceContainer = await page.$(newBalanceContainerSelector);
                    // Usar la nueva función para extraer el balance del contenedor
                    const extractedNewBalance = await extractBalanceFromContainer(newBalanceContainer);
                    if (extractedNewBalance) {
                        balanceAfter = extractedNewBalance;
                        balanceAfterFound = true;
                        console.log(`${getCurrentTimestamp()} ✅ Balance DESPUÉS encontrado: ${balanceAfter}`);
                    } else {
                        console.log(`${getCurrentTimestamp()} ⚠️ No se pudo extraer un valor numérico válido del contenedor del nuevo balance (DESPUÉS).`);
                    }
                  } catch (e) {
                    console.log(`${getCurrentTimestamp()} ⚠️ Error al extraer nuevo balance del contenedor encontrado (DESPUÉS): ${e.message}`);
                  }
              }

              if (!balanceAfterFound) {
                throw new Error("No se pudo encontrar el nuevo elemento del balance después de múltiples intentos.");
              }

              console.log(`${getCurrentTimestamp()} 💰 Balance DESPUÉS: ${balanceAfter}`);

              const balanceIncreased = parseFloat(balanceAfter.replace(/,/g, '')) > parseFloat(balanceBefore.replace(/,/g, ''));
              
              if (balanceIncreased) {
                  console.log(`${getCurrentTimestamp()} 🎉 Éxito: El balance aumentó. Premio reclamado.`);
                  // Enviar notificación de éxito SOLO SI EL BALANCE AUMENTÓ
                  await sendNotification("Premio Packetshare reclamado con aumento de balance");
              } else {
                  console.log(`${getCurrentTimestamp()} ⚠️ Advertencia: El balance NO aumentó después de reclamar. Puede que el premio haya sido $0 o haya un retraso en la actualización.`);
                  // NO se envía notificación si el balance no aumenta
              }
              
              // Esperar 5 minutos antes del próximo intento
              console.log(`${getCurrentTimestamp()} ⏰ Próximo intento en 5 minutos...`);
              setTimeout(runCycle, 300000); // 5 minutos

          } else {
              console.log(`${getCurrentTimestamp()} ⚠️ No se encontró un botón (<button>) dentro del contenedor encontrado.`);
              console.log(`${getCurrentTimestamp()} ⚠️ No se encontró ni conteo regresivo ni botón de reclamar. Reintentando en 5 minutos...`);
              setTimeout(runCycle, 300000); // 5 minutos
          }
        } catch (claimButtonError) {
          console.log(`${getCurrentTimestamp()} ⚠️ Error al buscar botón de reclamar en contenedor encontrado: ${claimButtonError.message}`);
          console.log(`${getCurrentTimestamp()} ⚠️ No se encontró ni conteo regresivo ni botón de reclamar. Reintentando en 5 minutos...`);
          setTimeout(runCycle, 300000); // 5 minutos
        }
    } else {
        console.log(`${getCurrentTimestamp()} ⚠️ No se encontró contenedor para conteo ni botón. Reintentando en 5 minutos...`);
        setTimeout(runCycle, 300000); // 5 minutos
    }

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en el ciclo:`, err.message);

    // Intentar reconectar en caso de error
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error(`${getCurrentTimestamp()} ⚠️ Error al cerrar el navegador:`, closeErr.message);
      }
    }

    // Reiniciar después de 60 segundos
    console.log(`${getCurrentTimestamp()} 🔄 Intentando reconectar en 60 segundos...`);
    setTimeout(() => {
      isFirstRun = true; // Forzar relogin
      runCycle();
    }, 60000);
  }
}

// Iniciar el primer ciclo
runCycle();

// Manejar señales de cierre limpiamente
process.on('SIGINT', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Recibida señal de interrupción. Cerrando...`);
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Recibida señal de terminación. Cerrando...`);
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
