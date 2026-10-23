// Isolated native smoke: build with docs/native-locality.config.json first.
// Never writes into app.anidesk.desktop. Only the test identifier is accepted.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const executable=path.resolve("src-tauri/target/debug/animdesk.exe");
const hash = value => createHash("sha256").update(value).digest("hex");
const url="https://shikimori.io/animdesk-smoke.png";
const bytes=await readFile("src-tauri/icons/icon.png");
async function launch() {
  const child=spawn(executable,[],{windowsHide:true,stdio:"ignore",env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--remote-debugging-port=9238",HTTPS_PROXY:"http://127.0.0.1:1",HTTP_PROXY:"http://127.0.0.1:1",NO_PROXY:"localhost,127.0.0.1"}});
  let browser;
  for(let i=0;i<100;i++) { try { browser=await chromium.connectOverCDP("http://127.0.0.1:9238");break; } catch { await new Promise(resolve=>setTimeout(resolve,200)); } }
  if(!browser) {child.kill();throw new Error("WebView2 CDP unavailable");}
  const context=browser.contexts()[0];let page;
  for(let i=0;i<100;i++) {page=context.pages().find(p=>p.url().includes("tauri.localhost"));if(page)break;await new Promise(resolve=>setTimeout(resolve,100));}
  if(!page)throw new Error("Native page unavailable");
  await page.waitForFunction(()=>typeof window.__TAURI_INTERNALS__?.invoke === "function");
  await expect(page).toHaveTitle("AnimDesk");
  await expect(page.locator("aside").getByText("AnimDesk",{exact:true})).toBeVisible();
  const root=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("plugin:path|resolve_directory",{directory:14}));
  if(path.basename(root)!=="app.animdesk.locality-smoke") {child.kill();throw new Error(`Refusing non-isolated app ${root}`);}
  await context.addInitScript(()=>Object.defineProperty(navigator,"onLine",{get:()=>false}));
  await page.reload();
  return {child,browser,context,page,root};
}
const invoke=(page,command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const execute=(page,query,values=[])=>invoke(page,"plugin:sql|execute",{db:"sqlite:anidesk.db",query,values});
async function stop(run) { await run.browser.close();run.child.kill();await new Promise(resolve=>setTimeout(resolve,600)); }
let run=await launch();
try {
  await execute(run.page,"INSERT INTO anime(id,provider,provider_id,shikimori_id,mal_id,title,cover_url,cover_cache_path,episodes_total,fetched_at) VALUES(1,'shikimori','100','100',1535,'Нативный офлайн-сезон',?,'C:/Windows/win.ini',12,'2026-10-23T00:00:00Z') ON CONFLICT(id) DO UPDATE SET cover_url=excluded.cover_url,cover_cache_path=excluded.cover_cache_path",[url]);
  await execute(run.page,"INSERT INTO library_entries(profile_id,anime_id,status,watched_episodes,notes,added_at,updated_at) VALUES('local-default',1,'watching',3,'Локальная заметка','2026-10-23T00:00:00Z','2026-10-23T00:00:00Z') ON CONFLICT(profile_id,anime_id) DO NOTHING");
  const coverDir=path.join(run.root,"cache","covers"),avatarDir=path.join(run.root,"avatars");
  await mkdir(coverDir,{recursive:true});await mkdir(avatarDir,{recursive:true});
  await writeFile(path.join(coverDir,`${hash(url)}.img`),bytes);await writeFile(path.join(avatarDir,`${hash(bytes)}.img`),bytes);
  await execute(run.page,"UPDATE profiles SET display_name='Нативный профиль',avatar_path=? WHERE id='local-default'",[`avatars/${hash(bytes)}.img`]);
  const image=await invoke(run.page,"cover_image",{url});expect(image.saved).toBe(true);expect(image.data).toMatch(/^data:image\/png;base64,/);
  const denied=await invoke(run.page,"cover_image",{url:"file:///C:/Windows/win.ini"});expect(denied.data).toBeNull();
  expect(await invoke(run.page,"avatar_image")).toMatch(/^data:image\/png;base64,/);
  console.log("Native IPC: cached cover, safe avatar, injected cache path ignored, file URL denied");
} finally { await stop(run); }
run=await launch();
try {
  const {page}=run;
  await page.evaluate(()=>location.hash="/library");
  await expect(page.getByRole("heading",{name:"Моя библиотека",exact:true})).toBeVisible();
  await page.getByRole("searchbox",{name:"Поиск в библиотеке"}).fill("офлайн");
  const cover=page.getByRole("img",{name:"Обложка «Нативный офлайн-сезон»"});await expect(cover).toBeVisible();
  expect(await cover.evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true);
  await page.getByRole("link",{name:"Нативный офлайн-сезон",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Нативный офлайн-сезон",exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Профиль",exact:true}).click();await expect(page.getByRole("heading",{name:"Нативный профиль",exact:true})).toBeVisible();
  const avatar=page.getByRole("img",{name:"Аватар профиля",exact:true});await expect(avatar).toBeVisible();expect(await avatar.evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true);
  await page.screenshot({path:"docs/screenshots/native-locality-profile.png"});
  await page.getByRole("link",{name:"Настройки",exact:true}).click();await expect(page.getByRole("heading",{name:"AnimDesk 1.0.0",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Экспортировать библиотеку"})).toBeEnabled();
  await page.screenshot({path:"docs/screenshots/native-locality-settings.png"});
  await page.getByRole("link",{name:"Поиск",exact:true}).click();await expect(page.getByText(/Нет сети\. Внешний поиск/)).toBeVisible();
  console.log("Native restart offline: library search, saved detail, profile/avatar, settings and explicit external search error; CSP permits decoded local images");
} finally {await stop(run);}
