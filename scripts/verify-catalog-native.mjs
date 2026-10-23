import { chromium, expect } from "@playwright/test";
const requireLive = process.argv.includes("--require-live");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9238");
try {
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith("http://127.0.0.1:1420"));
  if(!page)throw new Error("AnimDesk WebView2 не найден");
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  if(requireLive) {
    await page.getByRole("link",{name:"Главная",exact:true}).click();
    await expect(page.locator('[aria-label="Результаты каталога"]')).toHaveCount(1,{timeout:35000});
    console.log("Главная: живое аниме текущего сезона загружено.");
    await page.screenshot({path:"docs/screenshots/home-native-live.png"});
  }
  await page.getByRole("link",{name:"Поиск",exact:true}).click();
  const started = Date.now();
  await page.getByRole("textbox",{name:"Название аниме"}).fill("Death Note");
  await expect(page.getByText("Загрузка данных…",{exact:true})).toHaveCount(0,{timeout:130000});
  // Debounce may not have begun yet: wait for a terminal catalog state.
  await expect(page.locator('[aria-label="Результаты каталога"], section[role="alert"]')).toBeVisible({timeout:130000});
  const elapsed = Date.now() - started;
  console.log(`Поиск завершился за ${elapsed} мс`);
  if(elapsed > 40_000) throw new Error("Превышен общий предел ожидания UI");
  const cards=await page.locator('[aria-label="Результаты каталога"] li').count();
  console.log(cards ? `Живой каталог: ${cards} результатов; ${await page.locator('[aria-label="Результаты каталога"] li').first().innerText()}` : `Живой каталог: ${await page.locator('section[role="alert"]').innerText()}`);
  await page.screenshot({path:"docs/screenshots/catalog-native-live.png"});
  if(requireLive && !cards) throw new Error("Живые результаты не получены");
  if(cards) {
    await page.locator('[aria-label="Результаты каталога"] a').first().click();
    await expect(page.locator("article dl, section[role=alert]")).toBeVisible({timeout:130000});
    if(requireLive) await expect(page.getByRole("heading",{name:"Тетрадь смерти",exact:true,level:1})).toBeVisible();
    await page.screenshot({path:"docs/screenshots/anime-native-live.png"});
    console.log(`Подробная карточка: ${await page.getByRole("main").innerText()}`);
  }
  if(errors.length)throw new Error(errors.join("\n"));
  console.log("WebView2: поиск завершён без необработанных JavaScript-ошибок; сетевое состояние показано пользователю.");
} finally { await browser.close(); }
