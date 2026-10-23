use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager, State};

const IMAGE_LIMIT: usize = 5 * 1024 * 1024;
pub struct MediaState {
    jobs: tokio::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>,
    >,
    downloads: tokio::sync::Semaphore,
    avatar: tokio::sync::Mutex<()>,
    warming: tokio::sync::Mutex<()>,
    failures: tokio::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>,
}
impl Default for MediaState {
    fn default() -> Self {
        Self {
            jobs: Default::default(),
            downloads: tokio::sync::Semaphore::new(3),
            avatar: Default::default(),
            warming: Default::default(),
            failures: Default::default(),
        }
    }
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn normalize_url(value: &str) -> Result<reqwest::Url, String> {
    normalize_provider_url(value, "shikimori")
}
pub fn normalize_provider_url(value: &str, provider: &str) -> Result<reqwest::Url, String> {
    if value.len() > 4096
        || value.trim().is_empty()
        || value.starts_with("//")
        || value.split('/').any(|part| part == ".." || part == ".")
        || value.to_lowercase().contains("%2f")
        || value.to_lowercase().contains("%5c")
        || value.contains('\\')
        || value.chars().any(char::is_control)
        || value.contains('%') && value.to_lowercase().contains("%2e")
    {
        return Err("Недопустимый URL обложки".into());
    }
    let url = if !value.contains(':') {
        reqwest::Url::parse(if provider == "jikan" {
            "https://cdn.myanimelist.net"
        } else {
            "https://shikimori.io"
        })
        .unwrap()
        .join(value)
    } else {
        reqwest::Url::parse(value)
    }
    .map_err(err)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
        || !matches!(
            url.host_str(),
            Some(
                "shikimori.io"
                    | "shikimori.one"
                    | "desu.shikimori.io"
                    | "desu.shikimori.one"
                    | "cdn.myanimelist.net"
            )
        )
    {
        return Err("Обложка должна использовать HTTPS доверенного источника".into());
    }
    Ok(url)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn regular(path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(err)?;
    use std::os::windows::fs::MetadataExt;
    if meta.file_attributes() & 0x400 != 0 {
        return Err("Ссылки и точки перенаправления запрещены".into());
    }
    Ok(())
}
pub fn safe_dir(root: &Path, parts: &[&str]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root).map_err(err)?;
    regular(root)?;
    let mut dir = root.to_path_buf();
    for part in parts {
        if !part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
            return Err("Недопустимый каталог".into());
        }
        dir.push(part);
        match std::fs::create_dir(&dir) {
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(err(e)),
        }
        regular(&dir)?;
    }
    Ok(dir)
}
pub fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    regular(path)?;
    let file = std::fs::File::open(path).map_err(err)?;
    if !file.metadata().map_err(err)?.is_file() {
        return Err("Нужен обычный файл".into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > limit {
        return Err(format!("Файл превышает лимит {} МБ", limit / 1024 / 1024));
    }
    Ok(bytes)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Нет каталога")?).map_err(err)?;
    file.write_all(bytes).map_err(err)?;
    file.as_file().sync_all().map_err(err)?;
    file.persist(path).map_err(err)?;
    Ok(())
}
fn image_mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > IMAGE_LIMIT {
        return Err("Изображение должно быть не больше 5 МБ".into());
    }
    let format = image::guess_format(bytes).map_err(err)?;
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        _ => return Err("Разрешены PNG, JPEG и WebP".into()),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(err)?;
    Ok(mime)
}
fn data_image(bytes: &[u8]) -> Result<String, String> {
    Ok(format!(
        "data:{};base64,{}",
        image_mime(bytes)?,
        STANDARD.encode(bytes)
    ))
}
async fn download_image(client: &reqwest::Client, url: reqwest::Url) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?;
    if !response.status().is_success() {
        return Err("Источник перенаправил или отклонил запрос обложки".into());
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .to_owned();
    if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp")
        || response
            .content_length()
            .is_some_and(|n| n > IMAGE_LIMIT as u64)
    {
        return Err("Недопустимый тип или размер обложки".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(err)? {
        if bytes.len() + chunk.len() > IMAGE_LIMIT {
            return Err("Обложка превышает 5 МБ".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if image_mime(&bytes)? != mime {
        return Err("Тип обложки не совпадает с содержимым".into());
    }
    Ok(bytes)
}
async fn database(app: &AppHandle) -> Result<sqlx::SqliteConnection, String> {
    crate::open_database(
        &app.path()
            .app_config_dir()
            .map_err(err)?
            .join(crate::DATABASE_FILE),
    )
    .await
    .map_err(err)
}
#[derive(serde::Serialize)]
pub struct CoverImage {
    saved: bool,
    data: Option<String>,
}
async fn cover(app: &AppHandle, state: &MediaState, url: &str) -> Result<CoverImage, String> {
    let normalized = normalize_url(url)?;
    // Deduplicate this URL only: other cached covers never wait for its network.
    let job = {
        let mut jobs = state.jobs.lock().await;
        if jobs.len() > 512 {
            jobs.retain(|_, job| std::sync::Arc::strong_count(job) > 1);
        }
        jobs.entry(normalized.to_string()).or_default().clone()
    };
    let _url_guard = job.lock().await;
    let mut db = database(app).await?;
    let rows = sqlx::query("SELECT a.id, a.provider, a.cover_url FROM anime a JOIN library_entries l ON l.anime_id=a.id WHERE l.profile_id='local-default' AND a.cover_url IS NOT NULL").fetch_all(&mut db).await.map_err(err)?;
    let ids: Vec<i64> = rows
        .iter()
        .filter(|r| {
            normalize_provider_url(r.get::<&str, _>("cover_url"), r.get::<&str, _>("provider"))
                .ok()
                .as_ref()
                == Some(&normalized)
        })
        .map(|r| r.get("id"))
        .collect();
    if ids.is_empty() {
        return Ok(CoverImage {
            saved: false,
            data: None,
        });
    }
    let dir = safe_dir(
        &app.path().app_data_dir().map_err(err)?,
        &["cache", "covers"],
    )?;
    let key = format!("{}.img", hash(normalized.as_str().as_bytes()));
    let path = dir.join(&key);
    let bytes = if path.exists() {
        read_bounded(&path, IMAGE_LIMIT)
            .and_then(|b| image_mime(&b).map(|_| b))
            .ok()
    } else {
        None
    };
    let bytes = match bytes {
        Some(bytes) => bytes,
        None => {
            // Cached reads never wait for background network requests.
            let mut failures = state.failures.lock().await;
            failures.retain(|_, time| time.elapsed() < Duration::from_secs(30));
            if failures.contains_key(normalized.as_str()) {
                return Ok(CoverImage {
                    saved: true,
                    data: None,
                });
            }
            failures.insert(normalized.as_str().to_owned(), std::time::Instant::now());
            drop(failures);
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(err)?;
            let _permit = tokio::time::timeout(Duration::from_secs(2), state.downloads.acquire())
                .await
                .map_err(err)?
                .map_err(err)?;
            let bytes = download_image(&client, normalized).await?;
            atomic_write(&path, &bytes)?;
            bytes
        }
    };
    for id in ids {
        sqlx::query("UPDATE anime SET cover_cache_path=? WHERE id=?")
            .bind(format!("cache/covers/{key}"))
            .bind(id)
            .execute(&mut db)
            .await
            .map_err(err)?;
    }
    Ok(CoverImage {
        saved: true,
        data: Some(data_image(&bytes)?),
    })
}
#[tauri::command]
pub async fn cover_image(
    app: AppHandle,
    state: State<'_, MediaState>,
    url: String,
) -> Result<CoverImage, String> {
    Ok(match cover(&app, &state, &url).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Cover cache: {e}");
            CoverImage {
                saved: true,
                data: None,
            }
        }
    })
}
#[tauri::command]
pub async fn warm_covers(app: AppHandle, state: State<'_, MediaState>) -> Result<(), String> {
    let Ok(_warming) = state.warming.try_lock() else {
        return Ok(());
    };
    let mut db = database(&app).await?;
    let urls: Vec<String> = sqlx::query_scalar("SELECT DISTINCT cover_url FROM anime a JOIN library_entries l ON l.anime_id=a.id WHERE cover_url IS NOT NULL").fetch_all(&mut db).await.map_err(err)?;
    for url in urls {
        if let Err(e) = cover(&app, &state, &url).await {
            eprintln!("Cover cache: {e}");
        }
    }
    Ok(())
}
fn avatar_path(root: &Path, value: &str) -> Result<PathBuf, String> {
    let key = value
        .strip_prefix("avatars/")
        .and_then(|s| s.strip_suffix(".img"))
        .ok_or("Недопустимый путь аватара")?;
    if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Недопустимый путь аватара".into());
    }
    Ok(safe_dir(root, &["avatars"])?.join(format!("{key}.img")))
}
#[tauri::command]
pub async fn avatar_image(app: AppHandle) -> Result<Option<String>, String> {
    let mut db = database(&app).await?;
    let path: Option<String> =
        sqlx::query_scalar("SELECT avatar_path FROM profiles WHERE id='local-default'")
            .fetch_one(&mut db)
            .await
            .map_err(err)?;
    path.map(|p| {
        data_image(&read_bounded(
            &avatar_path(&app.path().app_data_dir().map_err(err)?, &p)?,
            IMAGE_LIMIT,
        )?)
    })
    .transpose()
}
#[tauri::command]
pub async fn choose_avatar(
    app: AppHandle,
    state: State<'_, MediaState>,
) -> Result<Option<String>, String> {
    let _guard = state.avatar.lock().await;
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Выбрать аватар (до 5 МБ)")
            .add_filter("Изображение", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
    })
    .await
    .map_err(err)?;
    let Some(path) = path else {
        return Ok(None);
    };
    let bytes = read_bounded(&path, IMAGE_LIMIT)?;
    let data = data_image(&bytes)?;
    let relative = format!("avatars/{}.img", hash(&bytes));
    let target = avatar_path(&app.path().app_data_dir().map_err(err)?, &relative)?;
    atomic_write(&target, &bytes)?;
    let mut db = database(&app).await?;
    sqlx::query("UPDATE profiles SET avatar_path=? WHERE id='local-default'")
        .bind(relative)
        .execute(&mut db)
        .await
        .map_err(err)?;
    Ok(Some(data))
}
#[tauri::command]
pub async fn reset_avatar(app: AppHandle, state: State<'_, MediaState>) -> Result<(), String> {
    let _guard = state.avatar.lock().await;
    sqlx::query("UPDATE profiles SET avatar_path=NULL WHERE id='local-default'")
        .execute(&mut database(&app).await?)
        .await
        .map_err(err)?;
    Ok(())
}
#[cfg(test)]
#[path = "media_tests.rs"]
mod tests;
