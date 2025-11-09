// bot.js - Versión v1.5.2
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

async function findBalanceContainer(page) {
    const baseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div';
    const possibleNths = [1, 2, 3, 4, 5];

    for (const n of possibleNths) {
        const selector = baseSelector.replace('NTH', n.toString());
        try {
            await page.waitForSelector(selector, { timeout: 5000 });
            const container = await page.$(selector);
            const text = await page.evaluate(el => el.textContent, container);
            if (text && text.toLowerCase().includes('current balance')) {
                console.log(`${getCurrentTimestamp()} ✅ Contenedor de balance válido encontrado con nth-child(${n}).`);
                return selector;
            } else {
                console.log(`${getCurrentTimestamp()} ℹ️ Contenedor nth-child(${n}) existe pero no contiene 'Current balance'.`);
            }
        } catch (e) {
            // continue
        }
    }
    console.log(`${getCurrentTimestamp()} ⚠️ No se encontró contenedor de balance válido.`);
    return null;
}

async function findPotContainer(page) {
    const baseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div';
    const possibleNths = [1, 2, 3, 4, 5];

    for (const n of possibleNths) {
        const selector = baseSelector.replace('NTH', n.toString());
        try {
            await page.waitForSelector(selector, { timeout: 5000 });
            const buttonSelector = `${selector} button`;
            try {
                await page.waitForSelector(buttonSelector, { timeout: 5000 });
                const buttonText = await page.evaluate(el => el.textContent.trim(), await page.$(buttonSelector));
                const lowerText = buttonText.toLowerCase();
                if (lowerText.includes('claim') || lowerText.includes('open lucky pot')) {
                    console.log(`${getCurrentTimestamp()} ✅ Contenedor de pot válido encontrado con nth-child(${n}).`);
                    return selector;
                } else {
                    console.log(`${getCurrentTimestamp()} ℹ️ Contenedor nth-child(${n}) tiene botón, pero texto no válido: "${buttonText}".`);
                }
            } catch (e) {
                console.log(`${getCurrentTimestamp()} ℹ️ Contenedor nth-child(${n}) existe pero no contiene botón válido.`);
            }
        } catch (e) {
            // continue
        }
    }
    console.log(`${getCurrentTimestamp()} ⚠️ No se encontró contenedor de pot válido.`);
    return null;
}

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

async function findClaimButton(page) {
    console.log(`${getCurrentTimestamp()} 🔍 Buscando botón de acción ('Claim' o 'Open Lucky Pot')...`);

    const potContainerSelector = await findPotContainer(page);
    if (potContainerSelector) {
        try {
            const buttonSelector = `${potContainerSelector} button`;
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
                console.log(`${getCurrentTimestamp()} ⏳ Timeout: No se encontró botón dentro del contenedor en 25 segundos.`);
            } else {
                console.log(`${getCurrentTimestamp()} ⚠️ Error al verificar botón en contenedor: ${e.message}`);
            }
        }
    }

    console.log(`${getCurrentTimestamp()} ❌ No se encontró botón válido.`);
    return { found: false };
}

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
                    const waitTimeMs = timeToMilliseconds(timeObj) + 300000; // +5 minutos
                    const { dateStr, timeStr } = getFutureTime(waitTimeMs);
                    const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
                    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento programado para el ${dateStr} a las ${timeStr} (~${minutes} min)...`);
                    return { found: true, waitTimeMs };
                } else {
                    console.log(`${getCurrentTimestamp()} ℹ️ Temporizador encontrado, pero el tiempo es 0.`);
                }
            }
        }
    } catch (e) {
        // Silently continue
    }

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
                const waitTimeMs = timeToMilliseconds(timeObj) + 300000; // +5 minutos
                const { dateStr, timeStr } = getFutureTime(waitTimeMs);
                const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
                console.log(`${getCurrentTimestamp()} ⏰ Próximo intento programado para el ${dateStr} a las ${timeStr} (~${minutes} min)...`);
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

// Función para obtener balance de forma segura
async function getBalanceSafely(page) {
    const balanceContainerSelector = await findBalanceContainer(page);
    if (!balanceContainerSelector) {
        console.log(`${getCurrentTimestamp()} ⚠️ No se pudo obtener el balance.`);
        return null;
    }
    const balanceContainer = await page.$(balanceContainerSelector);
    const balance = await extractBalanceFromContainer(page, balanceContainer);
    if (balance) {
        console.log(`${getCurrentTimestamp()} 💰 Balance actual: ${balance}`);
    }
    return balance;
}

// Función principal del ciclo
async function runCycle() {
  let browser = null;
  let page = null;

  try {
    console.log(`${getCurrentTimestamp()} 🚀 Iniciando ciclo principal...`);
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
    await page.goto("https://dashboard.honeygain.com/login", { waitUntil: "networkidle2", timeout: 60000 });

    try {
      await page.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 });
      await page.click(".sc-kLhKbu.cRDTkV");
    } catch (e) {}

    await page.waitForSelector('#email', { timeout: 15000 });
    await page.waitForSelector('#password', { timeout: 15000 });

    const email = process.env.EMAIL;
    const password = process.env.PASSWORD;
    if (!email || !password) {
      throw new Error("❌ Variables de entorno EMAIL y PASSWORD requeridas.");
    }

    if (!(await performLogin(page))) {
      throw new Error("No se pudo realizar el login");
    }

    // --- ✅ PRIMERO: OBTENER Y MOSTRAR BALANCE ACTUAL ---
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance actual al inicio del ciclo...`);
    const balanceAtStart = await getBalanceSafely(page);
    if (!balanceAtStart) {
      throw new Error("No se pudo obtener el balance al inicio del ciclo.");
    }

    // --- 1. BUSCAR BOTÓN ---
    const claimButtonResult = await findClaimButton(page);
    if (claimButtonResult.found) {
        console.log(`${getCurrentTimestamp()} 👆 Botón encontrado. Procediendo a reclamar...`);
        await page.click(`${claimButtonResult.selector} button`);
        console.log(`${getCurrentTimestamp()} ⏳ Esperando 30 segundos para que Honeygain procese el premio...`);
        await page.waitForTimeout(30000);

        // --- OBTENER BALANCE DESPUÉS ---
        console.log(`${getCurrentTimestamp()} 🔄 Refrescando para obtener balance después del reclamo...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(10000);

        const balanceAfter = await getBalanceSafely(page);
        if (!balanceAfter) {
            console.log(`${getCurrentTimestamp()} ⚠️ No se pudo obtener el balance después del reclamo.`);
        } else {
            const balanceBeforeNum = parseFloat(balanceAtStart.replace(/,/g, ''));
            const balanceAfterNum = parseFloat(balanceAfter.replace(/,/g, ''));
            const balanceIncreased = balanceAfterNum > balanceBeforeNum;
            const difference = balanceAfterNum - balanceBeforeNum;

            console.log(`${getCurrentTimestamp()} 📊 Comparación:`);
            console.log(`${getCurrentTimestamp()}    Antes: ${balanceAtStart}`);
            console.log(`${getCurrentTimestamp()}    Después: ${balanceAfter}`);
            console.log(`${getCurrentTimestamp()}    Diferencia: ${difference.toFixed(2)}`);

            if (balanceIncreased) {
                console.log(`${getCurrentTimestamp()} 🎉 ÉXITO: El balance aumentó. Premio reclamado.`);
                await sendNotification("Premio Honeygain reclamado con aumento de balance");
            } else {
                console.log(`${getCurrentTimestamp()} ⚠️ SIN CAMBIO: El balance no aumentó después de reclamar.`);
            }
        }

        console.log(`${getCurrentTimestamp()} 🔒 Cerrando sesión y esperando 5 minutos antes del próximo ciclo...`);
        if (browser) await browser.close();
        setTimeout(runCycle, 300000); // 5 minutos
        return;
    }

    // --- 2. NO HAY BOTÓN: BUSCAR TEMPORIZADOR ---
    console.log(`${getCurrentTimestamp()} ℹ️ Botón no encontrado. Buscando temporizador...`);
    const countdownResult = await findAndExtractCountdown(page);
    if (browser) await browser.close();

    if (countdownResult.found) {
        // Programar próxima ejecución normal
        setTimeout(runCycle, countdownResult.waitTimeMs);
    } else {
        // --- 3. NO HAY NI BOTÓN NI TEMPORIZADOR: INICIAR REINTENTOS PROGRESIVOS ---
        console.log(`${getCurrentTimestamp()} ⚠️ No se encontró botón ni temporizador. Iniciando secuencia de reintentos progresivos...`);

        const retryDelays = [
            5 * 60 * 1000,   // 5 min
            10 * 60 * 1000,  // +10 min (total 15)
            15 * 60 * 1000,  // +15 min (total 30)
            30 * 60 * 1000,  // +30 min (total 1h)
            60 * 60 * 1000   // +60 min (total 2h)
        ];

        let totalWait = 0;
        for (let i = 0; i < retryDelays.length; i++) {
            totalWait += retryDelays[i];
            const nextTime = new Date(Date.now() + retryDelays[i]);
            const timeStr = nextTime.toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit' });
            console.log(`${getCurrentTimestamp()} ⏳ Reintento ${i + 1}/5 programado para las ${timeStr}...`);

            await new Promise(resolve => setTimeout(resolve, retryDelays[i]));

            // --- Intento de reclamo con balance inicial fijo ---
            let retryBrowser = null;
            let retryPage = null;
            try {
                retryBrowser = await puppeteer.launch({
                  headless: 'old',
                  args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
                  ],
                });
                retryPage = await retryBrowser.newPage();
                await retryPage.goto("https://dashboard.honeygain.com/login", { waitUntil: "networkidle2", timeout: 60000 });

                try { await retryPage.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 }); await retryPage.click(".sc-kLhKbu.cRDTkV"); } catch (e) {}
                await retryPage.waitForSelector('#email', { timeout: 15000 });
                await retryPage.waitForSelector('#password', { timeout: 15000 });
                if (!(await performLogin(retryPage))) throw new Error("Login fallido en reintento");

                const claimResult = await findClaimButton(retryPage);
                if (claimResult.found) {
                    console.log(`${getCurrentTimestamp()} 👆 Botón encontrado en reintento ${i + 1}. Reclamando...`);
                    await retryPage.click(`${claimResult.selector} button`);
                    await retryPage.waitForTimeout(30000);

                    // Balance después
                    await retryPage.reload({ waitUntil: "networkidle2", timeout: 30000 });
                    await retryPage.waitForTimeout(10000);
                    const balanceAfterRetry = await getBalanceSafely(retryPage);

                    if (balanceAfterRetry) {
                        const balanceBeforeNum = parseFloat(balanceAtStart.replace(/,/g, ''));
                        const balanceAfterNum = parseFloat(balanceAfterRetry.replace(/,/g, ''));
                        const balanceIncreased = balanceAfterNum > balanceBeforeNum;

                        console.log(`${getCurrentTimestamp()} 📊 Comparación en reintento:`);
                        console.log(`${getCurrentTimestamp()}    Antes (inicio de ciclo): ${balanceAtStart}`);
                        console.log(`${getCurrentTimestamp()}    Después: ${balanceAfterRetry}`);
                        console.log(`${getCurrentTimestamp()}    Diferencia: ${(balanceAfterNum - balanceBeforeNum).toFixed(2)}`);

                        if (balanceIncreased) {
                            console.log(`${getCurrentTimestamp()} ✅ ÉXITO en reintento ${i + 1}.`);
                            await sendNotification("Premio Honeygain reclamado con aumento de balance");
                            if (retryBrowser) await retryBrowser.close();
                            console.log(`${getCurrentTimestamp()} ⏰ Esperando 5 minutos antes del próximo ciclo...`);
                            setTimeout(runCycle, 300000);
                            return;
                        }
                    }
                }
                if (retryBrowser) await retryBrowser.close();
            } catch (err) {
                console.error(`${getCurrentTimestamp()} ⚠️ Error en reintento ${i + 1}:`, err.message);
                if (retryBrowser) { try { await retryBrowser.close(); } catch (e) {} }
            }
        }

        // --- 4. TRAS 2H SIN ÉXITO: VOLVER AL CICLO NORMAL ---
        console.log(`${getCurrentTimestamp()} ❌ Reintentos finalizados sin éxito. Volviendo al ciclo normal.`);
        setTimeout(runCycle, 300000);
    }

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en ciclo principal:`, err.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    console.log(`${getCurrentTimestamp()} 🔄 Reintentando en 60 segundos...`);
    setTimeout(runCycle, 60000);
  }
}

// Iniciar
runCycle();

process.on('SIGINT', () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Cerrando...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Cerrando...`);
  process.exit(0);
});
