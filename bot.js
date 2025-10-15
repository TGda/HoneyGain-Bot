// bot.js
const puppeteer = require("puppeteer");

// Función para obtener la fecha y hora actual formateada
function getCurrentDateTime() {
  const now = new Date();
  // Formatear la fecha como "DD MMM YYYY"
  const dateStr = now.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  // Formatear la hora como "HH:MM:SS"
  const timeStr = now.toLocaleTimeString('es-ES', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return { dateStr, timeStr };
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
  console.warn(`⚠️ No se pudo parsear el texto del temporizador: "${countdownText}". Usando 0 segundos.`);
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

let browser;
let page;
let isFirstRun = true;

// Función para login con reintentos
async function login() {
  for (let attempt = 1; attempt < 4; ++attempt) {
    try {
      const email = process.env.EMAIL;
      const password = process.env.PASSWORD;

      console.log(`✍️ Escribiendo credenciales (intento ${attempt})...`);
      await page.type("#email", email, { delay: 50 });
      await page.type("#password", password, { delay: 50 });

      console.log("🔑 Enviando login...");
      await page.click(".sc-kLhKbu.dEXYZj.hg-login-with-email");
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
      return true;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Silently attempt to log in ${attempt} times failed.`);
      }
      console.log(`⚠️ Intento ${attempt} fallido. Reintentando en 30 segundos...`);
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
}

// Función principal del ciclo
async function runCycle() {
  try {
    if (isFirstRun) {
      console.log("🚀 Iniciando bot de Honeygain...");
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
      
      console.log("🌐 Abriendo página de login...");
      const response = await page.goto("https://dashboard.honeygain.com/login", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      console.log(`   Estado de carga: ${response.status()}`);

      // Verificar si hay mensaje de JavaScript no soportado
      const content = await page.content();
      if (content.includes("Your browser does not support JavaScript!")) {
        console.log("⚠️ La página indica que el navegador no soporta JavaScript. Esto puede ser un problema para la automatización.");
        // Opcional: Tomar un screenshot para debugging
        // await page.screenshot({ path: 'js_error.png', fullPage: true });
      }

      // Esperar y hacer clic en el botón inicial si aparece
      console.log("🔍 Esperando botón inicial...");
      try {
        await page.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 });
        console.log("👆 Haciendo clic en botón inicial...");
        await page.click(".sc-kLhKbu.cRDTkV");
      } catch (e) {
        console.log("ℹ️ No se encontró botón inicial, continuando...");
      }

      // Esperar a que los campos de entrada estén disponibles
      console.log("🔍 Esperando campos de login...");
      await page.waitForSelector('#email', { timeout: 15000 });
      await page.waitForSelector('#password', { timeout: 15000 });

      const email = process.env.EMAIL;
      const password = process.env.PASSWORD;

      if (!email || !password) {
        throw new Error("❌ Variables de entorno EMAIL y PASSWORD requeridas.");
      }

      // Realizar login
      if (await login()) {
        console.log("✅ Login exitoso. Redirigido a dashboard.");
        
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
      console.log("🔄 Refrescando dashboard...");
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForTimeout(5000); // Esperar un poco más después de refrescar
    }

    // Obtener balance actual con hora
    console.log("🔍 Obteniendo balance actual...");
    // Esperar un poco más para que el contenido dinámico se cargue
    await page.waitForTimeout(5000);
    
    // Usar el nuevo selector del contenedor del balance que me proporcionaste
    console.log("🔍 Intentando nuevo selector del balance (contenedor)...");
    let balance = "0";
    let balanceFound = false;
    
    try {
      // Esperar a que el contenedor del balance esté disponible
      await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(2) > div > div > div > div', { timeout: 15000 });
      
      // Dentro del contenedor, buscar el span que contiene el valor numérico
      // Asumiendo que el span con el balance está dentro de este div
      // Podría ser necesario ajustar este selector si la estructura interna es diferente
      const balanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(2) > div > div > div > div');
      // Intentar encontrar el span directamente dentro del contenedor o sus hijos
      const balanceSpan = await balanceContainer.$('span');
      if (balanceSpan) {
          balance = await page.evaluate(element => element.textContent, balanceSpan);
          balanceFound = true;
          console.log(`✅ Balance encontrado con nuevo selector (contenedor): ${balance}`);
      } else {
          console.log("⚠️ No se encontró un span dentro del contenedor del balance.");
      }
    } catch (balanceContainerError) {
      console.log(`⚠️ Nuevo selector de contenedor del balance no encontrado: ${balanceContainerError.message}`);
    }
    
    // Si no se encontró con el contenedor, intentar con selectores anteriores o texto
    if (!balanceFound) {
        // Intentar con el selector original (el más largo) - ACTUALIZADO A nth-child(1)
        try {
          console.log("🔍 Intentando selector original del balance (ACTUALIZADO)...");
          await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis', { timeout: 15000 });
          
          const balanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis');
          const balanceText = await page.evaluate(element => element.textContent, balanceContainer);
          
          // Extraer solo el valor numérico del balance (asumiendo que está después de "Current Balance")
          const balanceMatch = balanceText.match(/Current Balance\s*([\d,.]+)/i);
          if (balanceMatch && balanceMatch[1]) {
            balance = balanceMatch[1];
            balanceFound = true;
            console.log(`✅ Balance encontrado con selector original (ACTUALIZADO): ${balance}`);
          } else {
            console.log(`⚠️ No se encontró el valor numérico con el selector original (ACTUALIZADO). Texto completo: "${balanceText}"`);
          }
        } catch (originalSelectorError) {
          console.log(`⚠️ Selector original (ACTUALIZADO) no encontrado: ${originalSelectorError.message}`);
        }
    }
    
    // Estrategia 2: Si los anteriores fallan, buscar por contenido textual
    if (!balanceFound) {
      console.log("🔍 Buscando balance por contenido textual...");
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
          console.log(`✅ Balance encontrado por contenido textual: ${balance}`);
        } else {
          console.log("⚠️ No se pudo encontrar el balance por contenido textual.");
        }
      } catch (textContentError) {
        console.log(`⚠️ Error buscando balance por contenido textual: ${textContentError.message}`);
      }
    }
    
    // Estrategia 3: Si las anteriores fallan, usar un selector más genérico si es posible
    if (!balanceFound) {
      console.log("🔍 Buscando balance con selector genérico...");
      try {
        // Intentar encontrar el span que contiene el valor numérico directamente
        // Este selector puede no ser tan específico, pero podría ser más estable
        await page.waitForSelector('.sc-bdnyFh.bcYZov', { timeout: 5000 }); // El selector anterior que fallaba
        const balanceElement = await page.$('.sc-bdnyFh.bcYZov');
        if (balanceElement) {
          balance = await page.evaluate(element => element.textContent.trim(), balanceElement);
          balanceFound = true;
          console.log(`✅ Balance encontrado con selector genérico: ${balance}`);
        } else {
          console.log("⚠️ Elemento con selector genérico encontrado pero sin contenido.");
        }
      } catch (genericSelectorError) {
        console.log(`⚠️ Selector genérico no encontrado: ${genericSelectorError.message}`);
      }
    }
    
    if (!balanceFound) {
      throw new Error("No se pudo encontrar el elemento del balance después de múltiples intentos.");
    }
    
    const { dateStr: currentDateTimeDate, timeStr: currentDateTimeTime } = getCurrentDateTime();
    console.log(`💰 Balance actual el ${currentDateTimeDate} a las ${currentDateTimeTime} : ${balance}`);

    // Verificar si aparece el conteo regresivo o el botón de reclamar
    console.log("🔍 Verificando si hay conteo regresivo o botón de reclamar...");
    
    // Esperar un poco para que se cargue el contenido del botón/conteo
    await page.waitForTimeout(3000);
    
    // Primero intentamos encontrar el conteo regresivo
    // Asumiendo que está en el contenedor nth-child(5), buscar el elemento .time
    try {
      // Selector más específico para el elemento del tiempo dentro del contenedor correcto
      const newCountdownSelector = "#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(5) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div > div";
      console.log("🔍 Intentando nuevo selector del conteo regresivo (en contenedor 5)...");
      await page.waitForSelector(newCountdownSelector, { timeout: 5000 });
      const countdownText = await page.$eval(newCountdownSelector, el => el.textContent);
      
      // Verificar si el texto contiene "Next pot available in" para confirmar que es el conteo
      if (countdownText.toLowerCase().includes("next pot available in")) {
        // Extraer solo la parte del tiempo (eliminar "Next pot available in")
        const timePart = countdownText.replace(/Next pot available in/i, '').trim();
        console.log(`⏳ Conteo regresivo encontrado: ${timePart}`);
        
        // Parsear el tiempo y calcular espera
        const timeObj = parseCountdownText(timePart);
        const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos
        
        // Programar el próximo ciclo
        const { dateStr: futureDateTimeDate, timeStr: futureDateTimeTime } = getFutureDateTime(waitTimeMs);
        const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
        console.log(`⏰ Próximo intento el ${futureDateTimeDate} a las ${futureDateTimeTime} que son aproximadamente en ${minutes} minutos...`);
        
        // Esperar el tiempo calculado antes de repetir
        setTimeout(runCycle, waitTimeMs);
      } else {
        // Si no contiene "Next pot available in", probablemente es el botón
        console.log("ℹ️ Contenido en contenedor 5 no es conteo regresivo, asumiendo es botón.");
        throw new Error("No es conteo regresivo"); // Lanzar un error para ir al catch
      }
    } catch (newCountdownError) {
      console.log(`⚠️ Contenido en contenedor 5 no es conteo regresivo o no encontrado: ${newCountdownError.message}`);
      
      // Si no hay conteo regresivo en contenedor 5, verificar si hay botón de reclamar
      console.log("ℹ️ No se encontró conteo regresivo. Verificando si hay botón de reclamar...");
      
      // Intentar con el NUEVO selector del botón de reclamar (el que me proporcionaste - en contenedor 5)
      console.log("🔍 Intentando nuevo selector del botón de reclamar (en contenedor 5)...");
      try {
        // El selector que proporcionaste apunta al span dentro del botón en nth-child(5)
        const newClaimButtonSelector = "#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(5) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div > button > span > div > span";
        await page.waitForSelector(newClaimButtonSelector, { timeout: 5000 });
        console.log("✅ Botón de reclamar encontrado (nuevo selector - en contenedor 5). Haciendo clic para reclamar el premio...");
        
        // Hacer clic en el botón de reclamar (en el span específico)
        await page.click(newClaimButtonSelector);
        
        // Esperar un momento después de reclamar
        console.log("⏳ Esperando después de reclamar el premio...");
        await page.waitForTimeout(5000);
        
        // Refrescar la página para obtener el balance actualizado
        console.log("🔄 Refrescando página para obtener balance actualizado...");
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(5000);
        
        // Verificar el nuevo balance
        console.log("🔍 Verificando nuevo balance...");
        // Reutilizar la lógica de búsqueda de balance actualizada
        let newBalance = "0";
        let newBalanceFound = false;
        
        // Estrategia 1: Intentar con el nuevo selector del contenedor del balance
        console.log("🔍 Intentando nuevo selector del balance (contenedor - nuevo)...");
        try {
          // Esperar a que el contenedor del balance esté disponible
          await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(2) > div > div > div > div', { timeout: 15000 });
          
          // Dentro del contenedor, buscar el span que contiene el valor numérico
          const newBalanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(2) > div > div > div > div');
          const newBalanceSpan = await newBalanceContainer.$('span');
          if (newBalanceSpan) {
              newBalance = await page.evaluate(element => element.textContent, newBalanceSpan);
              newBalanceFound = true;
              console.log(`✅ Nuevo balance encontrado con nuevo selector (contenedor): ${newBalance}`);
          } else {
              console.log("⚠️ No se encontró un span dentro del contenedor del balance (nuevo).");
          }
        } catch (newBalanceContainerError) {
          console.log(`⚠️ Nuevo selector de contenedor del balance no encontrado (nuevo): ${newBalanceContainerError.message}`);
        }
        
        // Si no se encontró con el contenedor, intentar con selectores anteriores o texto
        if (!newBalanceFound) {
            // Intentar con el selector original (el más largo) - ACTUALIZADO A nth-child(1)
            try {
              console.log("🔍 Intentando selector original del balance (nuevo - ACTUALIZADO)...");
              await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis', { timeout: 15000 });
              
              const newBalanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis');
              const newBalanceText = await page.evaluate(element => element.textContent, newBalanceContainer);
              
              const newBalanceMatch = newBalanceText.match(/Current Balance\s*([\d,.]+)/i);
              if (newBalanceMatch && newBalanceMatch[1]) {
                newBalance = newBalanceMatch[1];
                newBalanceFound = true;
                console.log(`✅ Nuevo balance encontrado con selector original (ACTUALIZADO): ${newBalance}`);
              } else {
                console.log(`⚠️ No se encontró el valor numérico con el selector original (nuevo - ACTUALIZADO). Texto completo: "${newBalanceText}"`);
              }
            } catch (originalSelectorErrorNew) {
              console.log(`⚠️ Selector original (ACTUALIZADO) no encontrado (nuevo): ${originalSelectorErrorNew.message}`);
            }
        }
        
        // Estrategia 2: Si los anteriores fallan, buscar por contenido textual
        if (!newBalanceFound) {
          console.log("🔍 Buscando nuevo balance por contenido textual...");
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
              console.log(`✅ Nuevo balance encontrado por contenido textual: ${newBalance}`);
            } else {
              console.log("⚠️ No se pudo encontrar el nuevo balance por contenido textual.");
            }
          } catch (textContentErrorNew) {
            console.log(`⚠️ Error buscando nuevo balance por contenido textual: ${textContentErrorNew.message}`);
          }
        }
        
        // Estrategia 3: Si las anteriores fallan, usar un selector más genérico
        if (!newBalanceFound) {
          console.log("🔍 Buscando nuevo balance con selector genérico...");
          try {
            await page.waitForSelector('.sc-bdnyFh.bcYZov', { timeout: 5000 });
            const newBalanceElement = await page.$('.sc-bdnyFh.bcYZov');
            if (newBalanceElement) {
              newBalance = await page.evaluate(element => element.textContent.trim(), newBalanceElement);
              newBalanceFound = true;
              console.log(`✅ Nuevo balance encontrado con selector genérico: ${newBalance}`);
            } else {
              console.log("⚠️ Elemento con selector genérico encontrado pero sin contenido (nuevo).");
            }
          } catch (genericSelectorErrorNew) {
            console.log(`⚠️ Selector genérico no encontrado (nuevo): ${genericSelectorErrorNew.message}`);
          }
        }
        
        if (!newBalanceFound) {
          throw new Error("No se pudo encontrar el nuevo elemento del balance después de múltiples intentos.");
        }
        
        const { dateStr: newDateTimeDate, timeStr: newDateTimeTime } = getCurrentDateTime();
        if (newBalance !== balance) {
          console.log(`🎉 Balance incrementado el ${newDateTimeDate} a las ${newDateTimeTime} : ${balance} → ${newBalance}`);
        } else {
          console.log(`ℹ️ Balance sin cambios el ${newDateTimeDate} a las ${newDateTimeTime} : ${balance} → ${newBalance}`);
        }
        
        // Esperar 5 minutos antes del próximo intento
        console.log("⏰ Próximo intento en 5 minutos...");
        setTimeout(runCycle, 300000); // 5 minutos
        
      } catch (newClaimButtonError) {
        console.log(`⚠️ No se encontró ni conteo regresivo ni botón de reclamar en contenedor 5. Reintentando en 5 minutos...`);
        setTimeout(runCycle, 300000); // 5 minutos
      }
    }

  } catch (err) {
    console.error("⚠️ Error en el ciclo:", err.message);
    
    // Intentar reconectar en caso de error
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("⚠️ Error al cerrar el navegador:", closeErr.message);
      }
    }
    
    // Reiniciar después de 60 segundos
    console.log("🔄 Intentando reconectar en 60 segundos...");
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
  console.log("\n🛑 Recibida señal de interrupción. Cerrando...");
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log("\n🛑 Recibida señal de terminación. Cerrando...");
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
