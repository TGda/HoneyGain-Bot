// bot.js - Versión v1.3
const puppeteer = require("puppeteer");
const http = require("http");
const https = require("https");

function getCurrentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const year = String(now.getFullYear()).slice(-2);
  const timeStr = now.toLocaleTimeString('es-ES', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return `[${day}${month}${year} ${timeStr}]`;
}

function parseCountdownText(countdownText) {
  const regex = /(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/;
  const match = countdownText.match(regex);

  if (match && match.length === 4) {
    return {
      hours: parseInt(match[1], 10),
      minutes: parseInt(match[2], 10),
      seconds: parseInt(match[3], 10)
    };
  }

  console.warn(`${getCurrentTimestamp()} ⚠️ No se pudo parsear el texto del temporizador: "${countdownText}". Usando 0 segundos.`);
  return { hours: 0, minutes: 0, seconds: 0 };
}

function timeToMilliseconds(timeObj) {
  return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
}

function getFutureTime(milliseconds) {
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

async function sendNotification(message) {
    const notificationUrl = process.env.NOTIFICATION;
    if (!notificationUrl) {
        console.log(`${getCurrentTimestamp()} ℹ️ Variable NOTIFICATION no definida. Omitiendo notificación.`);
        return;
    }

    console.log(`${getCurrentTimestamp()} 📢 Enviando notificación a: ${notificationUrl}`);
    
    return new Promise((resolve) => {
        const postData = '';
        let url;
        try {
           url = new URL(notificationUrl);
        } catch (err) {
            console.error(`${getCurrentTimestamp()} ⚠️ Error al parsear la URL de notificación '${notificationUrl}': ${err.message}. Omitiendo notificación.`);
            resolve();
            return;
        }
        
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = httpModule.request(options, (res) => {
            console.log(`${getCurrentTimestamp()} ✅ Notificación enviada. Código de estado: ${res.statusCode}`);
            resolve();
        });

        req.on('error', (e) => {
            console.error(`${getCurrentTimestamp()} ⚠️ Error al enviar notificación a '${notificationUrl}': ${e.message}`);
            resolve(); 
        });

        req.write(postData);
        req.end();
    });
}

// Función para login con reintentos (ahora dentro de cada ciclo)
async function performLogin(page) {
  for (let attempt = 1; attempt < 4; ++attempt) {
    try {
      const email = process.env.EMAIL;
      const password = process.env.PASSWORD;

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
async function findElementByNthChild(page, baseSelector, nthValues, description) {
  // Probamos todos los valores, no hay "último exitoso" porque es sesión nueva
  for (const n of nthValues) {
    const tentativeSelector = baseSelector.replace('NTH', n.toString());
    console.log(`${getCurrentTimestamp()} 🔍 Probando ${description} con nth-child(${n})...`);
    try {
      await page.waitForSelector(tentativeSelector, { timeout: 5000 });
      console.log(`${getCurrentTimestamp()} ✅ ${description} encontrado con nth-child(${n}).`);
      return tentativeSelector;
    } catch (e) {
      continue;
    }
  }
  console.log(`${getCurrentTimestamp()} ⚠️ No se encontró el selector de ${description} con ninguno de los valores de nth-child probados.`);
  return null;
}

// Función para extraer el balance numérico de un contenedor ya encontrado
async function extractBalanceFromContainer(page, containerElement) {
    if (!containerElement) {
        console.log(`${getCurrentTimestamp()} ⚠️ Contenedor de balance no proporcionado para extracción.`);
        return null;
    }
    try {
        const fullText = await page.evaluate(element => element.textContent, containerElement);
        const balanceLabelIndex = fullText.toLowerCase().indexOf('current balance');
        if (balanceLabelIndex === -1) {
            console.log(`${getCurrentTimestamp()} ⚠️ No se encontró la etiqueta 'Current balance' en el contenedor.`);
            return null;
        }

        const textAfterLabel = fullText.substring(balanceLabelIndex + 'current balance'.length).trim();
        const balanceRegex = /^\s*([\d.,]+\d)/;
        const match = textAfterLabel.match(balanceRegex);

        if (match && match[1]) {
            const potentialBalance = match[1];
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

// Buscar botón de acción
async function findClaimButton(page) {
    console.log(`${getCurrentTimestamp()} 🔍 Buscando botón de acción ('Claim' o 'Open Lucky Pot')...`);

    const potBaseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div';
    const possiblePotNths = [1, 2, 3, 4, 5];

    for (const n of possiblePotNths) {
        const potContainerSelector = potBaseSelector.replace('NTH', n.toString());
        try {
            await page.waitForSelector(potContainerSelector, { timeout: 5000 });
            const buttonSelector = `${potContainerSelector} button`;
            // Esperar hasta 25 segundos a que aparezca el botón
            await page.waitForSelector(buttonSelector, { timeout: 25000 });
            const claimButton = await page.$(buttonSelector);
            if (claimButton) {
                const buttonText = await page.evaluate(el => el.textContent.trim(), claimButton);
                const lowerButtonText = buttonText.toLowerCase();
                const validLabels = ['claim', 'open lucky pot'];
                const isValid = validLabels.some(label => lowerButtonText.includes(label));

                if (isValid) {
                    console.log(`${getCurrentTimestamp()} ✅ Botón válido encontrado. Texto: "${buttonText}"`);
                    return { found: true, selector: potContainerSelector };
                } else {
                    console.log(`${getCurrentTimestamp()} ℹ️ Botón encontrado, pero texto no coincide: "${buttonText}"`);
                }
            }
        } catch (e) {
            if (e.name === 'TimeoutError') {
                // Silently continue to next nth
            } else {
                console.log(`${getCurrentTimestamp()} ⚠️ Error al verificar botón en contenedor nth-child(${n}): ${e.message}`);
            }
        }
    }

    console.log(`${getCurrentTimestamp()} ❌ No se encontró botón válido.`);
    return { found: false };
}

// Buscar temporizador
async function findAndExtractCountdown(page) {
    console.log(`${getCurrentTimestamp()} 🔍 Buscando temporizador...`);

    try {
        const countdownContainerSelector = 'div.sc-duWCru.dPYLJV';
        await page.waitForSelector(countdownContainerSelector, { timeout: 5000 });
        const container = await page.$(countdownContainerSelector);
        const containerText = await page.evaluate(el => el.textContent, container);
        const lowerText = containerText.toLowerCase();

        const validLabels = ["time left to collect", "next pot available in"];
        let foundLabel = null;
        for (const label of validLabels) {
            if (lowerText.includes(label)) {
                foundLabel = label;
                break;
            }
        }

        if (foundLabel) {
            console.log(`${getCurrentTimestamp()} ✅ Etiqueta de temporizador encontrada: '${foundLabel}'`);
            const timeParagraphSelector = `${countdownContainerSelector} > p.sc-etPtWW.hRiIai`;
            await page.waitForSelector(timeParagraphSelector, { timeout: 2000 });
            const timeText = await page.$eval(timeParagraphSelector, el => el.textContent);
            if (timeText) {
                const timeObj = parseCountdownText(timeText);
                const totalSeconds = timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds;
                if (totalSeconds > 0) {
                    const waitTimeMs = timeToMilliseconds(timeObj) + 20000;
                    const { dateStr, timeStr } = getFutureTime(waitTimeMs);
                    const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
                    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${dateStr} a las ${timeStr} (~${minutes} min)...`);
                    return { found: true, waitTimeMs };
                } else {
                    console.log(`${getCurrentTimestamp()} ℹ️ Temporizador encontrado, pero el tiempo es 0.`);
                }
            }
        }
    } catch (e) {
        // Silently continue
    }

    // Fallback por texto
    try {
        const validLabelsLower = ["time left to collect", "next pot available in"];
        const countdownInfo = await page.evaluate((labels) => {
            const divs = document.querySelectorAll('div');
            for (const div of divs) {
                const text = div.textContent?.toLowerCase() || '';
                let foundLabel = null;
                for (const label of labels) {
                    if (text.includes(label)) {
                        foundLabel = label;
                        break;
                    }
                }
                if (foundLabel) {
                    const spans = div.querySelectorAll('span');
                    if (spans.length >= 4) {
                        let parts = [];
                        for (let i = 0; i < Math.min(spans.length, 6); i++) {
                            const t = spans[i].textContent?.trim();
                            if (t) parts.push(t);
                        }
                        if (parts.length >= 4) {
                            const timeStr = parts.join(' ');
                            if (timeStr.toLowerCase().includes('hours') && timeStr.toLowerCase().includes('min')) {
                                return { text: timeStr };
                            }
                        }
                    }
                }
            }
            return null;
        }, validLabelsLower);

        if (countdownInfo && countdownInfo.text) {
            const timeObj = parseCountdownText(countdownInfo.text);
            const totalSeconds = timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds;
            if (totalSeconds > 0) {
                const waitTimeMs = timeToMilliseconds(timeObj) + 20000;
                const { dateStr, timeStr } = getFutureTime(waitTimeMs);
                const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
                console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${dateStr} a las ${timeStr} (~${minutes} min)...`);
                return { found: true, waitTimeMs };
            } else {
                console.log(`${getCurrentTimestamp()} ℹ️ Temporizador por texto encontrado, pero tiempo es 0.`);
            }
        }
    } catch (e) {
        console.log(`${getCurrentTimestamp()} ⚠️ Error en búsqueda fallback de temporizador: ${e.message}`);
    }

    console.log(`${getCurrentTimestamp()} ❌ No se encontró temporizador válido con tiempo > 0.`);
    return { found: false };
}

// Función principal del ciclo (ahora efímera)
async function runCycle() {
  let browser = null;
  let page = null;

  try {
    console.log(`${getCurrentTimestamp()} 🚀 Iniciando nueva sesión de Honeygain...`);
    browser = await puppeteer.launch({
      headless: 'old',
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
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
      ],
    });

    page = await browser.newPage();
    console.log(`${getCurrentTimestamp()} 🌐 Abriendo página de login...`);
    const response = await page.goto("https://dashboard.honeygain.com/login", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    console.log(`${getCurrentTimestamp()}    Estado de carga: ${response.status()}`);

    const content = await page.content();
    if (content.includes("Your browser does not support JavaScript!")) {
      console.log(`${getCurrentTimestamp()} ⚠️ La página indica que el navegador no soporta JavaScript.`);
    }

    try {
      await page.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 });
      console.log(`${getCurrentTimestamp()} 👆 Haciendo clic en botón inicial...`);
      await page.click(".sc-kLhKbu.cRDTkV");
    } catch (e) {
      console.log(`${getCurrentTimestamp()} ℹ️ No se encontró botón inicial, continuando...`);
    }

    await page.waitForSelector('#email', { timeout: 15000 });
    await page.waitForSelector('#password', { timeout: 15000 });

    const email = process.env.EMAIL;
    const password = process.env.PASSWORD;
    if (!email || !password) {
      throw new Error("❌ Variables de entorno EMAIL y PASSWORD requeridas.");
    }

    if (await performLogin(page)) {
      console.log(`${getCurrentTimestamp()} ✅ Login exitoso. Redirigido a dashboard.`);
      const currentUrl = page.url();
      if (!currentUrl.includes("dashboard.honeygain.com/")) {
        throw new Error("No se pudo acceder al dashboard después del login");
      }
    } else {
      throw new Error("No se pudo realizar el login");
    }

    // --- Obtener balance ANTES ---
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance ANTES...`);
    await page.waitForTimeout(5000);

    const balanceBaseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div';
    const possibleBalanceNths = [1, 2, 3, 4, 5];

    let balanceBefore = "0";
    let balanceBeforeFound = false;
    const balanceContainerSelector = await findElementByNthChild(page, balanceBaseSelector, possibleBalanceNths, 'balance');
    if (balanceContainerSelector) {
        const balanceContainer = await page.$(balanceContainerSelector);
        const extractedBalance = await extractBalanceFromContainer(page, balanceContainer);
        if (extractedBalance) {
            balanceBefore = extractedBalance;
            balanceBeforeFound = true;
            console.log(`${getCurrentTimestamp()} ✅ Balance ANTES: ${balanceBefore}`);
        }
    }

    if (!balanceBeforeFound) {
      throw new Error("No se pudo encontrar el balance antes de reclamar.");
    }

    // --- Buscar botón ---
    const claimButtonResult = await findClaimButton(page);

    if (claimButtonResult.found) {
        console.log(`${getCurrentTimestamp()} 👆 Haciendo clic en botón válido...`);
        await page.click(`${claimButtonResult.selector} button`);

        console.log(`${getCurrentTimestamp()} ⏳ Esperando después de la acción...`);
        await page.waitForTimeout(5000);

        // --- Obtener balance DESPUÉS ---
        console.log(`${getCurrentTimestamp()} 🔄 Refrescando para obtener balance DESPUÉS...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(5000);

        let balanceAfter = "0";
        let balanceAfterFound = false;
        const newBalanceContainerSelector = await findElementByNthChild(page, balanceBaseSelector, possibleBalanceNths, 'balance');
        if (newBalanceContainerSelector) {
            const newBalanceContainer = await page.$(newBalanceContainerSelector);
            const extractedNewBalance = await extractBalanceFromContainer(page, newBalanceContainer);
            if (extractedNewBalance) {
                balanceAfter = extractedNewBalance;
                balanceAfterFound = true;
                console.log(`${getCurrentTimestamp()} ✅ Balance DESPUÉS: ${balanceAfter}`);
            }
        }

        if (!balanceAfterFound) {
            throw new Error("No se pudo encontrar el balance después.");
        }

        const balanceIncreased = parseFloat(balanceAfter.replace(/,/g, '')) > parseFloat(balanceBefore.replace(/,/g, ''));
        if (balanceIncreased) {
            console.log(`${getCurrentTimestamp()} 🎉 Éxito: El balance aumentó. Premio reclamado.`);
            await sendNotification("Premio Honeygain reclamado con aumento de balance");
        } else {
            console.log(`${getCurrentTimestamp()} ⚠️ Advertencia: El balance NO aumentó después de reclamar.`);
        }

        // Cerrar sesión y esperar 5 minutos antes del próximo ciclo
        console.log(`${getCurrentTimestamp()} 🔒 Cerrando sesión y esperando 5 minutos antes del próximo ciclo...`);
        if (browser) await browser.close();
        setTimeout(runCycle, 300000); // 5 minutos
        return;
    }

    // --- No hay botón: buscar temporizador ---
    const countdownResult = await findAndExtractCountdown(page);
    if (countdownResult.found) {
        console.log(`${getCurrentTimestamp()} 🔒 Cerrando sesión y esperando hasta el próximo pot...`);
        if (browser) await browser.close();
        setTimeout(runCycle, countdownResult.waitTimeMs);
        return;
    }

    // --- Ni botón ni temporizador ---
    console.log(`${getCurrentTimestamp()} ⚠️ No se encontró botón ni temporizador. Cerrando sesión y reintentando en 5 minutos...");
    if (browser) await browser.close();
    setTimeout(runCycle, 300000);

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en el ciclo:`, err.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    console.log(`${getCurrentTimestamp()} 🔄 Intentando reconectar en 60 segundos...`);
    setTimeout(runCycle, 60000);
  }
}

// Iniciar el primer ciclo
runCycle();

// Manejar señales de cierre
process.on('SIGINT', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Recibida señal de interrupción. Cerrando...`);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Recibida señal de terminación. Cerrando...`);
  process.exit(0);
});
