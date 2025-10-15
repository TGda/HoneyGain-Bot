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
  const regex = /(\d+) hours (\d+) min (\d+) sec/;
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

        // 2. Buscar un patrón numérico que coincida con formatos comunes de balance
        //    Este regex busca: dígitos, posiblemente separados por comas o puntos, incluyendo puntos/comas decimales
        //    Ej: 1,234.56, 1234.56, 1.234,56
        //    Busca el último número que aparezca en el texto (por si hay más texto después)
        const balanceRegex = /([\d.,]+\d)/g; // \d al final asegura que termina en número
        const matches = fullText.match(balanceRegex);
        if (matches) {
            // Tomar el último match como el balance (por si hay múltiples números)
            const potentialBalance = matches[matches.length - 1];
            console.log(`${getCurrentTimestamp()} ℹ️ Valor numérico potencial encontrado: "${potentialBalance}"`);
            // Validar que el match tenga sentido como balance (no es solo un número suelto)
            // Una simple validación: que tenga al menos un separador (, o .) o sea mayor a 999
            if (potentialBalance.includes(',') || potentialBalance.includes('.') || parseInt(potentialBalance.replace(/,/g, '').replace(/\./g, ''), 10) > 999) {
                return potentialBalance;
            } else {
                console.log(`${getCurrentTimestamp()} ⚠️ El valor potencial "${potentialBalance}" no parece un balance válido.`);
            }
        } else {
            console.log(`${getCurrentTimestamp()} ⚠️ No se encontró un patrón numérico de balance en el texto del contenedor.`);
        }
    } catch (e) {
        console.log(`${getCurrentTimestamp()} ⚠️ Error al extraer balance del contenedor: ${e.message}`);
    }
    return null;
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
      console.log(`${getCurrentTimestamp()}    Estado de carga: ${response.status()}`);

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

      const email = process.env.EMAIL;
      const password = process.env.PASSWORD;

      if (!email || !password) {
        throw new Error("❌ Variables de entorno EMAIL y PASSWORD requeridas.");
      }

      // Realizar login
      if (await login()) {
        console.log(`${getCurrentTimestamp()} ✅ Login exitoso. Redirigido a dashboard.`);
        
        // Verificar que estamos en el dashboard
        const currentUrl = page.url();
        console.log(`${getCurrentTimestamp()} 📍 URL después del login: ${currentUrl}`);
        
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

    // Obtener balance actual
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance actual...`);
    // Esperar un poco más para que el contenido dinámico se cargue
    await page.waitForTimeout(5000);

    // Definir la base del selector para el contenedor del balance
    const balanceBaseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div';
    const possibleBalanceNths = [1, 2, 3, 4, 5]; // Rango de valores a probar para el balance

    let balance = "0";
    let balanceFound = false;

    // Usar la función para encontrar el contenedor del balance
    const balanceContainerSelector = await findElementByNthChild(balanceBaseSelector, possibleBalanceNths, 'balance');
    if (balanceContainerSelector) {
        try {
          const balanceContainer = await page.$(balanceContainerSelector);
          // Usar la nueva función para extraer el balance del contenedor
          const extractedBalance = await extractBalanceFromContainer(balanceContainer);
          if (extractedBalance) {
              balance = extractedBalance;
              balanceFound = true;
              console.log(`${getCurrentTimestamp()} ✅ Balance encontrado: ${balance}`);
          } else {
              console.log(`${getCurrentTimestamp()} ⚠️ No se pudo extraer un valor numérico válido del contenedor encontrado.`);
          }
        } catch (e) {
          console.log(`${getCurrentTimestamp()} ⚠️ Error al extraer balance del contenedor encontrado: ${e.message}`);
        }
    }

    if (!balanceFound) {
      throw new Error("No se pudo encontrar el elemento del balance después de múltiples intentos.");
    }

    console.log(`${getCurrentTimestamp()} 💰 Balance: ${balance}`);

    // Verificar si aparece el conteo regresivo o el botón de reclamar
    console.log(`${getCurrentTimestamp()} 🔍 Verificando si hay conteo regresivo o botón de reclamar...`);
    
    // Esperar un poco para que se cargue el contenido del botón/conteo
    await page.waitForTimeout(3000);

    // Definir la base del selector para el contenedor del conteo/botón
    const potBaseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div';
    const possiblePotNths = [1, 2, 3, 4, 5]; // Rango de valores a probar para el conteo/botón

    // Intentar encontrar el conteo regresivo
    // Buscar un elemento que contenga "Next pot available in"
    let countdownFound = false;
    let potContainerSelector = await findElementByNthChild(potBaseSelector, possiblePotNths, 'conteo/botón');
    if (potContainerSelector) {
        try {
          // Buscar un elemento descendiente que contenga el texto del conteo
          // Asumiendo que el conteo regresivo está en un div hijo
          const countdownElement = await page.$(`${potContainerSelector} div`);
          if (countdownElement) {
            const countdownText = await page.evaluate(element => element.textContent, countdownElement);
            if (countdownText && countdownText.toLowerCase().includes("next pot available in")) {
                // Extraer solo la parte del tiempo (eliminar "Next pot available in")
                const timePart = countdownText.replace(/Next pot available in/i, '').trim();
                console.log(`${getCurrentTimestamp()} ⏳ Conteo regresivo encontrado: ${timePart}`);
                
                // Parsear el tiempo y calcular espera
                const timeObj = parseCountdownText(timePart);
                const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos
                
                // Programar el próximo ciclo
                const { dateStr: futureDateTimeDate, timeStr: futureDateTimeTime } = getFutureTime(waitTimeMs);
                const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
                console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${futureDateTimeDate} a las ${futureDateTimeTime} que son aproximadamente en ${minutes} minutos...`);
                
                // Esperar el tiempo calculado antes de repetir
                setTimeout(runCycle, waitTimeMs);
                countdownFound = true;
            }
          }
        } catch (e) {
          console.log(`${getCurrentTimestamp()} ⚠️ Error al verificar conteo regresivo en contenedor encontrado: ${e.message}`);
        }
    }

    if (!countdownFound) {
        // Si no hay conteo regresivo, verificar si hay botón de reclamar
        console.log(`${getCurrentTimestamp()} ℹ️ No se encontró conteo regresivo. Verificando si hay botón de reclamar en contenedor encontrado...`);
        
        if (potContainerSelector) {
            try {
              // El botón de reclamar debería estar dentro del mismo contenedor general
              // Selector más específico para el botón dentro del contenedor encontrado
              const claimButtonSelector = `${potContainerSelector} button > span > div > span`;
              await page.waitForSelector(claimButtonSelector, { timeout: 5000 });
              console.log(`${getCurrentTimestamp()} ✅ Botón de reclamar encontrado (en contenedor encontrado). Haciendo clic para reclamar el premio...`);
              
              // Hacer clic en el botón de reclamar
              await page.click(claimButtonSelector);
              
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

              // Usar la función para encontrar el contenedor del balance (nuevamente después del refresh)
              const newBalanceContainerSelector = await findElementByNthChild(balanceBaseSelector, possibleBalanceNths, 'balance');
              if (newBalanceContainerSelector) {
                  try {
                    const newBalanceContainer = await page.$(newBalanceContainerSelector);
                    // Usar la nueva función para extraer el balance del contenedor
                    const extractedNewBalance = await extractBalanceFromContainer(newBalanceContainer);
                    if (extractedNewBalance) {
                        newBalance = extractedNewBalance;
                        newBalanceFound = true;
                        console.log(`${getCurrentTimestamp()} ✅ Nuevo balance encontrado: ${newBalance}`);
                    } else {
                        console.log(`${getCurrentTimestamp()} ⚠️ No se pudo extraer un valor numérico válido del contenedor del nuevo balance.`);
                    }
                  } catch (e) {
                    console.log(`${getCurrentTimestamp()} ⚠️ Error al extraer nuevo balance del contenedor encontrado: ${e.message}`);
                  }
              }

              if (!newBalanceFound) {
                throw new Error("No se pudo encontrar el nuevo elemento del balance después de múltiples intentos.");
              }

              if (newBalance !== balance) {
                console.log(`${getCurrentTimestamp()} 🎉 Balance: ${balance} → ${newBalance}`);
              } else {
                console.log(`${getCurrentTimestamp()} ℹ️ Balance: ${balance} (sin cambios)`);
              }
              
              // Esperar 5 minutos antes del próximo intento
              console.log(`${getCurrentTimestamp()} ⏰ Próximo intento en 5 minutos...`);
              setTimeout(runCycle, 300000); // 5 minutos
              
            } catch (claimButtonError) {
              console.log(`${getCurrentTimestamp()} ⚠️ No se encontró botón de reclamar en contenedor encontrado: ${claimButtonError.message}`);
              console.log(`${getCurrentTimestamp()} ⚠️ No se encontró ni conteo regresivo ni botón de reclamar. Reintentando en 5 minutos...`);
              setTimeout(runCycle, 300000); // 5 minutos
            }
        } else {
            console.log(`${getCurrentTimestamp()} ⚠️ No se encontró contenedor para conteo ni botón. Reintentando en 5 minutos...`);
            setTimeout(runCycle, 300000); // 5 minutos
        }
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
