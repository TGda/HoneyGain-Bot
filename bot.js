// bot.js
const puppeteer = require("puppeteer");

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
  const dateStr = future.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const timeStr = future.toLocaleTimeString('es-ES', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return { dateStr, timeStr };
}

let browser;
let page;
let isFirstRun = true;

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

// *** Nueva función: Buscar conteo regresivo por selector CSS ***
async function findAndExtractCountdownBySelector() {
    console.log(`${getCurrentTimestamp()} 🔍 Intentando encontrar conteo regresivo por selector CSS...`);
    try {
        // Selector basado en el elemento HTML proporcionado
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
            const timeParagraphSelector = `${countdownContainerSelector} > p.sc-etPtWW.hRiIai`;
            await page.waitForSelector(timeParagraphSelector, { timeout: 2000 });
            
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
                if (divText && divText.includes(labelTimes[0])) { // Buscar "time left to collect"
                    console.log(`${getCurrentTimestamp()} ℹ️ Posible contenedor de conteo encontrado. Texto: ${divText.substring(0, 100)}...`);

                    // Ahora, dentro de este div, buscar el elemento que contiene el temporizador.
                    const potentialContainers = divElement.querySelectorAll('*'); // Todos los descendientes

                    for (let container of potentialContainers) {
                        const spans = container.querySelectorAll('span');
                        // console.log(`Revisando contenedor con ${spans.length} spans`); // Para debugging

                        // Un temporizador típico tiene al menos 4 spans: HH, hours, MM, min (y posiblemente SS, sec)
                        if (spans.length >= 4) {
                            let timeParts = [];
                            let isValidTimeStructure = true;

                            for (let i = 0; i < Math.min(spans.length, 6); i++) { // Limitar a 6 partes por si acaso
                                const spanText = spans[i].textContent?.trim();
                                if (spanText) {
                                    timeParts.push(spanText);
                                } else {
                                    isValidTimeStructure = false;
                                    break;
                                }
                            }

                            if (isValidTimeStructure && timeParts.length >= 4) {
                                const countdownText = timeParts.join(' ');
                                console.log(`${getCurrentTimestamp()} ℹ️ Posible texto de temporizador extraído: ${countdownText}`);

                                // Validación básica: debe contener 'hours' y 'min'
                                if (countdownText.toLowerCase().includes('hours') && countdownText.toLowerCase().includes('min')) {
                                    console.log(`${getCurrentTimestamp()} ✅ Conteo regresivo encontrado y validado.`);
                                    return {
                                        text: countdownText,
                                        elementHtml: divElement.outerHTML.substring(0, 200) // Para debugging
                                    };
                                }
                            }
                        }
                    }
                } else if (divText && divText.includes(labelTimes[1])) { // Buscar "next pot available in"
                    console.log(`${getCurrentTimestamp()} ℹ️ Posible contenedor de conteo encontrado. Texto: ${divText.substring(0, 100)}...`);

                    // Ahora, dentro de este div, buscar el elemento que contiene el temporizador.
                    const potentialContainers = divElement.querySelectorAll('*'); // Todos los descendientes

                    for (let container of potentialContainers) {
                        const spans = container.querySelectorAll('span');
                        // console.log(`Revisando contenedor con ${spans.length} spans`); // Para debugging

                        // Un temporizador típico tiene al menos 4 spans: HH, hours, MM, min (y posiblemente SS, sec)
                        if (spans.length >= 4) {
                            let timeParts = [];
                            let isValidTimeStructure = true;

                            for (let i = 0; i < Math.min(spans.length, 6); i++) { // Limitar a 6 partes por si acaso
                                const spanText = spans[i].textContent?.trim();
                                if (spanText) {
                                    timeParts.push(spanText);
                                } else {
                                    isValidTimeStructure = false;
                                    break;
                                }
                            }

                            if (isValidTimeStructure && timeParts.length >= 4) {
                                const countdownText = timeParts.join(' ');
                                console.log(`${getCurrentTimestamp()} ℹ️ Posible texto de temporizador extraído: ${countdownText}`);

                                // Validación básica: debe contener 'hours' y 'min'
                                if (countdownText.toLowerCase().includes('hours') && countdownText.toLowerCase().includes('min')) {
                                    console.log(`${getCurrentTimestamp()} ✅ Conteo regresivo encontrado y validado.`);
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

            // Si llegamos aquí, no se encontró el conteo regresivo con la estrategia principal
            console.log(`${getCurrentTimestamp()} ℹ️ No se encontró el contenedor principal del conteo regresivo con la estrategia de búsqueda de spans.`);
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
      console.log(`${getCurrentTimestamp()} 🚀 Iniciando bot de Honeygain...`);
      browser = await puppeteer.launch({
        headless: 'old', // Usar el modo headless antiguo
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
      const response = await page.goto("https://dashboard.honeygain.com/login", {
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
        
        if (!currentUrl.includes("dashboard.honeygain.com/")) {
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

    // Obtener balance actual con hora
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance actual...`);
    // Esperar un poco más para que el contenido dinámico se cargue
    await page.waitForTimeout(5000);
    
    // Usar un selector más general para encontrar el contenedor del balance
    // Intentar encontrar el elemento que contiene "Current Balance" y el valor numérico
    let balance = "0";
    let balanceFound = false;
    
    // Estrategia 1: Intentar con el nuevo selector del balance (el que me proporcionaste)
    console.log(`${getCurrentTimestamp()} 🔍 Intentando nuevo selector del balance...`);
    try {
      await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-etzZfr.hJDEkH.gbMWSi > div.sc-blHHSb.kbMxlb > div.sc-ivxoEo.dTydep > span', { timeout: 15000 });
      
      const balanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-etzZfr.hJDEkH.gbMWSi > div.sc-blHHSb.kbMxlb > div.sc-ivxoEo.dTydep > span');
      balance = await page.evaluate(element => element.textContent, balanceContainer);
      balanceFound = true;
      console.log(`${getCurrentTimestamp()} ✅ Balance encontrado con nuevo selector: ${balance}`);
    } catch (newSelectorError) {
      console.log(`${getCurrentTimestamp()} ⚠️ Nuevo selector no encontrado: ${newSelectorError.message}`);
    }
    
    // Si el nuevo selector falla, intentar con los anteriores
    if (!balanceFound) {
        // Intentar con el selector original (el más largo)
        try {
          console.log(`${getCurrentTimestamp()} 🔍 Intentando selector original del balance...`);
          await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis', { timeout: 15000 });
          
          const balanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis');
          const balanceText = await page.evaluate(element => element.textContent, balanceContainer);
          
          // Extraer solo el valor numérico del balance (asumiendo que está después de "Current Balance")
          const balanceMatch = balanceText.match(/Current Balance\s*([\d,.]+)/i);
          if (balanceMatch && balanceMatch[1]) {
            balance = balanceMatch[1];
            balanceFound = true;
            console.log(`${getCurrentTimestamp()} ✅ Balance encontrado con selector original: ${balance}`);
          } else {
            console.log(`${getCurrentTimestamp()} ⚠️ No se encontró el valor numérico con el selector original. Texto completo: "${balanceText}"`);
          }
        } catch (originalSelectorError) {
          console.log(`${getCurrentTimestamp()} ⚠️ Selector original no encontrado: ${originalSelectorError.message}`);
        }
    }
    
    // Estrategia 2: Si los anteriores fallan, buscar por contenido textual
    if (!balanceFound) {
      console.log(`${getCurrentTimestamp()} 🔍 Buscando balance por contenido textual...`);
      try {
        // Buscar un elemento que contenga "Current Balance" y luego extraer el número
        // Esto puede ser más robusto si la estructura cambia ligeramente
        await page.waitForFunction(() => {
          const elements = document.querySelectorAll('div, span, p'); // Buscar en tipos de elementos comunes
          for (let elem of elements) {
            const text = elem.textContent;
            if (text && text.includes('Current Balance')) {
              // Intentar encontrar un número después de "Current Balance"
              const match = text.match(/Current Balance\s*([\d,.]+)/i);
              if (match && match[1]) {
                return match[1];
              }
            }
          }
          return null;
        }, { timeout: 15000 });
        
        // Si waitForFunction no falla, significa que encontró el texto y el número
        // Ahora obtenemos el valor
        const balanceValue = await page.evaluate(() => {
          const elements = document.querySelectorAll('div, span, p');
          for (let elem of elements) {
            const text = elem.textContent;
            if (text && text.includes('Current Balance')) {
              const match = text.match(/Current Balance\s*([\d,.]+)/i);
              if (match && match[1]) {
                return match[1];
              }
            }
          }
          return null;
        });
        
        if (balanceValue) {
          balance = balanceValue;
          balanceFound = true;
          console.log(`${getCurrentTimestamp()} ✅ Balance encontrado por contenido textual: ${balance}`);
        } else {
          console.log(`${getCurrentTimestamp()} ⚠️ No se pudo encontrar el balance por contenido textual.`);
        }
      } catch (textContentError) {
        console.log(`${getCurrentTimestamp()} ⚠️ Error buscando balance por contenido textual: ${textContentError.message}`);
      }
    }
    
    // Estrategia 3: Si las anteriores fallan, usar un selector más genérico si es posible
    if (!balanceFound) {
      console.log(`${getCurrentTimestamp()} 🔍 Buscando balance con selector genérico...`);
      try {
        // Intentar encontrar el span que contiene el valor numérico directamente
        // Este selector puede no ser tan específico, pero podría ser más estable
        await page.waitForSelector('.sc-bdnyFh.bcYZov', { timeout: 5000 }); // El selector anterior que fallaba
        const balanceElement = await page.$('.sc-bdnyFh.bcYZov');
        if (balanceElement) {
          balance = await page.evaluate(element => element.textContent.trim(), balanceElement);
          balanceFound = true;
          console.log(`${getCurrentTimestamp()} ✅ Balance encontrado con selector genérico: ${balance}`);
        } else {
          console.log(`${getCurrentTimestamp()} ⚠️ Elemento con selector genérico encontrado pero sin contenido.`);
        }
      } catch (genericSelectorError) {
        console.log(`${getCurrentTimestamp()} ⚠️ Selector genérico no encontrado: ${genericSelectorError.message}`);
      }
    }
    
    if (!balanceFound) {
      throw new Error("No se pudo encontrar el elemento del balance después de múltiples intentos.");
    }
    
    const { dateStr: currentDateTimeDate, timeStr: currentDateTimeTime } = getCurrentTimestamp();
    console.log(`${getCurrentTimestamp()} 💰 Balance actual el ${currentDateTimeDate} a las ${currentDateTimeTime} : ${balance}`);

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
    const potBaseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(4) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div';
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

              // Refrescar la página para obtener el balance actualizado
              console.log(`${getCurrentTimestamp()} 🔄 Refrescando página para obtener balance actualizado...`);
              await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
              await page.waitForTimeout(5000);

              // Verificar el nuevo balance
              console.log(`${getCurrentTimestamp()} 🔍 Verificando nuevo balance...`);
              // Reutilizar la lógica de búsqueda de balance actualizada
              let newBalance = "0";
              let newBalanceFound = false;

              // Estrategia 1: Intentar con el nuevo selector del balance (el que me proporcionaste)
              console.log(`${getCurrentTimestamp()} 🔍 Intentando nuevo selector del balance (nuevo)...`);
              try {
                await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-etzZfr.hJDEkH.gbMWSi > div.sc-blHHSb.kbMxlb > div.sc-ivxoEo.dTydep > span', { timeout: 15000 });
                
                const newBalanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-etzZfr.hJDEkH.gbMWSi > div.sc-blHHSb.kbMxlb > div.sc-ivxoEo.dTydep > span');
                newBalance = await page.evaluate(element => element.textContent, newBalanceContainer);
                newBalanceFound = true;
                console.log(`${getCurrentTimestamp()} ✅ Nuevo balance encontrado con nuevo selector: ${newBalance}`);
              } catch (newSelectorErrorNew) {
                console.log(`${getCurrentTimestamp()} ⚠️ Nuevo selector no encontrado (nuevo): ${newSelectorErrorNew.message}`);
              }
              
              // Si el nuevo selector falla, intentar con los anteriores
              if (!newBalanceFound) {
                  // Intentar con el selector original (el más largo)
                  try {
                    console.log(`${getCurrentTimestamp()} 🔍 Intentando selector original del balance (nuevo)...`);
                    await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis', { timeout: 15000 });
                    
                    const newBalanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis');
                    const newBalanceText = await page.evaluate(element => element.textContent, newBalanceContainer);
                    
                    const newBalanceMatch = newBalanceText.match(/Current Balance\s*([\d,.]+)/i);
                    if (newBalanceMatch && newBalanceMatch[1]) {
                      newBalance = newBalanceMatch[1];
                      newBalanceFound = true;
                      console.log(`${getCurrentTimestamp()} ✅ Nuevo balance encontrado con selector original: ${newBalance}`);
                    } else {
                      console.log(`${getCurrentTimestamp()} ⚠️ No se encontró el valor numérico con el selector original (nuevo). Texto completo: "${newBalanceText}"`);
                    }
                  } catch (originalSelectorErrorNew) {
                    console.log(`${getCurrentTimestamp()} ⚠️ Selector original no encontrado (nuevo): ${originalSelectorErrorNew.message}`);
                  }
              }
              
              // Estrategia 2: Si los anteriores fallan, buscar por contenido textual
              if (!newBalanceFound) {
                console.log(`${getCurrentTimestamp()} 🔍 Buscando nuevo balance por contenido textual...`);
                try {
                  await page.waitForFunction(() => {
                    const elements = document.querySelectorAll('div, span, p');
                    for (let elem of elements) {
                      const text = elem.textContent;
                      if (text && text.includes('Current Balance')) {
                        const match = text.match(/Current Balance\s*([\d,.]+)/i);
                        if (match && match[1]) {
                          return match[1];
                        }
                      }
                    }
                    return null;
                  }, { timeout: 15000 });
                  
                  const newBalanceValue = await page.evaluate(() => {
                    const elements = document.querySelectorAll('div, span, p');
                    for (let elem of elements) {
                      const text = elem.textContent;
                      if (text && text.includes('Current Balance')) {
                        const match = text.match(/Current Balance\s*([\d,.]+)/i);
                        if (match && match[1]) {
                          return match[1];
                        }
                      }
                    }
                    return null;
                  });
                  
                  if (newBalanceValue) {
                    newBalance = newBalanceValue;
                    newBalanceFound = true;
                    console.log(`${getCurrentTimestamp()} ✅ Nuevo balance encontrado por contenido textual: ${newBalance}`);
                  } else {
                    console.log(`${getCurrentTimestamp()} ⚠️ No se pudo encontrar el nuevo balance por contenido textual.`);
                  }
                } catch (textContentErrorNew) {
                  console.log(`${getCurrentTimestamp()} ⚠️ Error buscando nuevo balance por contenido textual: ${textContentErrorNew.message}`);
                }
              }
              
              // Estrategia 3: Si las anteriores fallan, usar un selector más genérico
              if (!newBalanceFound) {
                console.log(`${getCurrentTimestamp()} 🔍 Buscando nuevo balance con selector genérico...`);
                try {
                  await page.waitForSelector('.sc-bdnyFh.bcYZov', { timeout: 5000 });
                  const newBalanceElement = await page.$('.sc-bdnyFh.bcYZov');
                  if (newBalanceElement) {
                    newBalance = await page.evaluate(element => element.textContent.trim(), newBalanceElement);
                    newBalanceFound = true;
                    console.log(`${getCurrentTimestamp()} ✅ Nuevo balance encontrado con selector genérico: ${newBalance}`);
                  } else {
                    console.log(`${getCurrentTimestamp()} ⚠️ Elemento con selector genérico encontrado pero sin contenido (nuevo).`);
                  }
                } catch (genericSelectorErrorNew) {
                  console.log(`${getCurrentTimestamp()} ⚠️ Selector genérico no encontrado (nuevo): ${genericSelectorErrorNew.message}`);
                }
              }
              
              if (!newBalanceFound) {
                throw new Error("No se pudo encontrar el nuevo elemento del balance después de múltiples intentos.");
              }
              
              const { dateStr: newDateTimeDate, timeStr: newDateTimeTime } = getCurrentTimestamp();
              if (newBalance !== balance) {
                console.log(`${getCurrentTimestamp()} 🎉 Balance incrementado el ${newDateTimeDate} a las ${newDateTimeTime} : ${balance} → ${newBalance}`);
                // Enviar notificación de éxito SOLO SI EL BALANCE AUMENTÓ
                await sendNotification("Premio Honeygain reclamado con aumento de balance");
              } else {
                console.log(`${getCurrentTimestamp()} ℹ️ Balance sin cambios el ${newDateTimeDate} a las ${newDateTimeTime} : ${balance} → ${newBalance}`);
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
