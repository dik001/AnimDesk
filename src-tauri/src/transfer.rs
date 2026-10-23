use crate::{AnimeTitleInput, AnimeUpsertInput};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TransferAnime {
    id: i64,

    provider: String,
    provider_id: String,
    shikimori_id: Option<String>,
    mal_id: Option<i64>,
    title: String,
    synopsis: Option<String>,
    cover_url: Option<String>,
    year: Option<i64>,
    format: Option<String>,
    episodes_total: Option<i64>,
    community_score: Option<f64>,
    fetched_at: String,
    metadata_json: Option<String>,
    titles: Vec<AnimeTitleInput>,
    genres: Vec<String>,
}
impl TransferAnime {
    fn input(&self) -> AnimeUpsertInput {
        AnimeUpsertInput {
            cover_cache_path: None,
            provider: self.provider.clone(),
            provider_id: self.provider_id.clone(),
            shikimori_id: self
                .shikimori_id
                .clone()
                .or_else(|| (self.provider == "shikimori").then(|| self.provider_id.clone())),
            mal_id: self.mal_id.or_else(|| {
                if self.provider == "jikan" {
                    self.provider_id.parse().ok()
                } else {
                    None
                }
            }),
            title: self.title.clone(),
            synopsis: self.synopsis.clone(),
            cover_url: self
                .cover_url
                .as_ref()
                .and_then(|url| crate::media::normalize_provider_url(url, &self.provider).ok())
                .map(|url| url.to_string()),
            year: self.year.clone(),
            format: self.format.clone(),
            episodes_total: self.episodes_total.clone(),
            community_score: self.community_score.clone(),
            fetched_at: self.fetched_at.clone(),
            metadata_json: self.metadata_json.clone(),
            titles: self.titles.clone(),
            genres: self.genres.clone(),
        }
    }
}
use sqlx::{Connection, Row, SqliteConnection};
use std::collections::HashSet;
use tauri::{AppHandle, Manager, State};
const LIMIT: usize = 20 * 1024 * 1024;
const PROFILE: &str = "local-default";
const EXPORT_FORMAT: &str = "animdesk-library";
// Version 1 backups remain importable with the same validation rules.
const LEGACY_IMPORT_FORMAT: &str = "anidesk-library";
#[derive(Default)]
pub struct TransferState(tokio::sync::Mutex<Option<Pending>>);
struct Pending {
    token: String,
    snapshot: Snapshot,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Profile {
    name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    anime_id: i64,
    status: String,
    watched_episodes: i64,
    notes: Option<String>,
    added_at: String,
    updated_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rating {
    anime_id: i64,
    rating: i64,
    updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    format: String,
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    profile: Profile,
    anime: Vec<TransferAnime>,
    library_entries: Vec<Entry>,
    #[serde(default)]
    ratings: Vec<Rating>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn date(s: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(s).is_ok()
        || chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}
fn text(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.len() <= max && !s.contains('\0')
}
fn id(s: &str) -> bool {
    s.parse::<i64>().is_ok_and(|n| n > 0 && n.to_string() == s)
}
impl Snapshot {
    fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > LIMIT {
            return Err("Файл превышает 20 МБ".into());
        }
        let data: Self = serde_json::from_slice(bytes)
            .map_err(|e| format!("Некорректный JSON библиотеки: {e}"))?;
        data.validate()?;
        Ok(data)
    }
    fn validate(&self) -> Result<(), String> {
        if !matches!(self.format.as_str(), EXPORT_FORMAT | LEGACY_IMPORT_FORMAT)
            || self.schema_version != 1
        {
            return Err("Неподдерживаемый формат или версия библиотеки (нужна версия 1)".into());
        }
        if !text(&self.profile.name, 400)
            || self.profile.name.chars().count() > 100
            || !date(&self.exported_at)
            || self.anime.len() > 10000
            || self.library_entries.len() > self.anime.len()
            || self.ratings.len() > self.anime.len()
        {
            return Err("Некорректный профиль, дата или количество элементов".into());
        }
        let mut ids = HashSet::new();
        let mut pairs = HashSet::new();
        let mut shiki = HashSet::new();
        let mut mal = HashSet::new();
        for a in &self.anime {
            crate::validate_upsert(&a.input())?;
            if a.id <= 0
                || !ids.insert(a.id)
                || !matches!(a.provider.as_str(), "shikimori" | "jikan")
                || !id(&a.provider_id)
                || !pairs.insert((&a.provider, &a.provider_id))
                || a.shikimori_id
                    .as_ref()
                    .is_some_and(|v| !id(v) || !shiki.insert(v))
                || a.mal_id.is_some_and(|v| v <= 0 || !mal.insert(v))
                || a.provider == "shikimori"
                    && a.shikimori_id.as_ref().is_some_and(|v| v != &a.provider_id)
                || a.provider == "jikan" && a.mal_id.is_some_and(|v| v.to_string() != a.provider_id)
                || !text(&a.title, 2000)
                || !date(&a.fetched_at)
                || a.synopsis.as_ref().is_some_and(|s| s.len() > 100000)
                || a.metadata_json.as_ref().is_some_and(|s| {
                    s.len() > 1000000 || serde_json::from_str::<serde_json::Value>(s).is_err()
                })
                || a.titles.len() > 100
                || a.genres.len() > 100
                || a.titles
                    .iter()
                    .any(|t| !text(&t.title, 2000) || !text(&t.language, 30))
                || a.genres.iter().any(|g| !text(g, 200))
                || a.year.is_some_and(|v| !(1800..=3000).contains(&v))
                || a.episodes_total.is_some_and(|v| v > 1000000)
                || a.community_score
                    .is_some_and(|s| !s.is_finite() || !(0.0..=10.0).contains(&s))
                || a.format.as_ref().is_some_and(|s| s.len() > 100)
                || a.cover_url
                    .as_ref()
                    .is_some_and(|s| crate::media::normalize_provider_url(s, &a.provider).is_err())
            {
                return Err(format!(
                    "Некорректные данные или конфликт ID аниме {}",
                    a.id
                ));
            }
        }
        let mut entries = HashSet::new();
        for e in &self.library_entries {
            let a = self
                .anime
                .iter()
                .find(|a| a.id == e.anime_id)
                .ok_or("Запись ссылается на отсутствующее аниме")?;
            if !entries.insert(e.anime_id)
                || !matches!(
                    e.status.as_str(),
                    "watching" | "planned" | "completed" | "on_hold" | "dropped"
                )
                || e.watched_episodes < 0
                || e.watched_episodes > 1000000
                || a.episodes_total.is_some_and(|v| e.watched_episodes > v)
                || e.notes.as_ref().is_some_and(|s| s.len() > 100000)
                || !date(&e.added_at)
                || !date(&e.updated_at)
                || e.started_at.as_ref().is_some_and(|s| !date(s))
                || e.completed_at.as_ref().is_some_and(|s| !date(s))
            {
                return Err("Некорректный статус, прогресс, заметки или дата записи".into());
            }
        }
        let mut rated = HashSet::new();
        for r in &self.ratings {
            if !ids.contains(&r.anime_id)
                || !rated.insert(r.anime_id)
                || !(1..=10).contains(&r.rating)
                || !date(&r.updated_at)
            {
                return Err("Некорректная личная оценка".into());
            }
        }
        if ids
            .iter()
            .any(|id| !entries.contains(id) && !rated.contains(id))
        {
            return Err("Аниме не связано с библиотекой или личной оценкой".into());
        }
        Ok(())
    }
}
async fn snapshot(db: &mut SqliteConnection) -> Result<Snapshot, String> {
    let mut data = Snapshot {
        format: EXPORT_FORMAT.into(),
        schema_version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        profile: Profile {
            name: sqlx::query_scalar("SELECT display_name FROM profiles WHERE id=?")
                .bind(PROFILE)
                .fetch_one(&mut *db)
                .await
                .map_err(err)?,
        },
        anime: vec![],
        library_entries: vec![],
        ratings: vec![],
    };
    let rows = sqlx::query("SELECT a.* FROM anime a WHERE EXISTS(SELECT 1 FROM library_entries l WHERE l.anime_id=a.id AND l.profile_id=?) OR EXISTS(SELECT 1 FROM anime_ratings r WHERE r.anime_id=a.id AND r.profile_id='local-default') ORDER BY a.id").bind(PROFILE).fetch_all(&mut *db).await.map_err(err)?;
    for r in rows {
        let id: i64 = r.get("id");
        let titles = sqlx::query(
            "SELECT language,title FROM anime_titles WHERE anime_id=? ORDER BY language,title",
        )
        .bind(id)
        .fetch_all(&mut *db)
        .await
        .map_err(err)?
        .iter()
        .map(|r| AnimeTitleInput {
            language: r.get("language"),
            title: r.get("title"),
        })
        .collect();
        let genres = sqlx::query_scalar("SELECT g.name FROM genres g JOIN anime_genres ag ON ag.genre_id=g.id WHERE ag.anime_id=? ORDER BY g.name").bind(id).fetch_all(&mut *db).await.map_err(err)?;
        data.anime.push(TransferAnime {
            id,
            provider: r.get("provider"),
            provider_id: r.get("provider_id"),
            shikimori_id: r.get("shikimori_id"),
            mal_id: r.get("mal_id"),
            title: r.get("title"),
            synopsis: r.get("synopsis"),
            cover_url: r.get("cover_url"),
            year: r.get("year"),
            format: r.get("format"),
            episodes_total: r.get("episodes_total"),
            community_score: r.get("community_score"),
            fetched_at: r.get("fetched_at"),
            metadata_json: r.get("metadata_json"),
            titles,
            genres,
        });
    }
    for r in sqlx::query("SELECT * FROM library_entries WHERE profile_id=? ORDER BY anime_id")
        .bind(PROFILE)
        .fetch_all(&mut *db)
        .await
        .map_err(err)?
    {
        data.library_entries.push(Entry {
            anime_id: r.get("anime_id"),
            status: r.get("status"),
            watched_episodes: r.get("watched_episodes"),
            notes: r.get("notes"),
            added_at: r.get("added_at"),
            updated_at: r.get("updated_at"),
            started_at: r.get("started_at"),
            completed_at: r.get("completed_at"),
        });
    }
    for r in sqlx::query("SELECT r.* FROM anime_ratings r WHERE r.profile_id=? ORDER BY r.anime_id")
        .bind(PROFILE)
        .fetch_all(&mut *db)
        .await
        .map_err(err)?
    {
        data.ratings.push(Rating {
            anime_id: r.get("anime_id"),
            rating: r.get("rating"),
            updated_at: r.get("updated_at"),
        });
    }
    Ok(data)
}
async fn database(app: &AppHandle) -> Result<SqliteConnection, String> {
    crate::open_database(
        &app.path()
            .app_config_dir()
            .map_err(err)?
            .join(crate::DATABASE_FILE),
    )
    .await
    .map_err(err)
}
// Caller owns one transaction for all anime, child tables, entries, ratings and profile.
async fn import_rows(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    data: &Snapshot,
    replace: bool,
) -> Result<(), String> {
    if replace {
        sqlx::query("DELETE FROM anime_ratings WHERE profile_id=?")
            .bind(PROFILE)
            .execute(&mut **tx)
            .await
            .map_err(err)?;
        sqlx::query("DELETE FROM library_entries WHERE profile_id=?")
            .bind(PROFILE)
            .execute(&mut **tx)
            .await
            .map_err(err)?;
        // Metadata belongs to the library too; clear only unreferenced rows.
        sqlx::query("DELETE FROM anime WHERE NOT EXISTS (SELECT 1 FROM library_entries l WHERE l.anime_id=anime.id) AND NOT EXISTS (SELECT 1 FROM anime_ratings r WHERE r.anime_id=anime.id)").execute(&mut **tx).await.map_err(err)?;
    }
    let mut mapped = HashSet::new();
    for a in &data.anime {
        let id = crate::upsert_anime_in_transaction(tx, a.input())
            .await
            .map_err(err)?;
        if !mapped.insert(id) {
            return Err(
                "Несколько импортируемых аниме соответствуют одной локальной записи".into(),
            );
        }
        if let Some(e) = data.library_entries.iter().find(|e| e.anime_id == a.id) {
            sqlx::query("INSERT INTO library_entries(profile_id,anime_id,status,watched_episodes,notes,added_at,updated_at,started_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,anime_id) DO UPDATE SET status=excluded.status,watched_episodes=excluded.watched_episodes,notes=excluded.notes,added_at=excluded.added_at,updated_at=excluded.updated_at,started_at=excluded.started_at,completed_at=excluded.completed_at")
            .bind(PROFILE).bind(id).bind(&e.status).bind(e.watched_episodes).bind(&e.notes).bind(&e.added_at).bind(&e.updated_at).bind(&e.started_at).bind(&e.completed_at).execute(&mut **tx).await.map_err(err)?;
        }
        if let Some(r) = data.ratings.iter().find(|r| r.anime_id == a.id) {
            sqlx::query("INSERT INTO anime_ratings(profile_id,anime_id,rating,updated_at) VALUES(?,?,?,?) ON CONFLICT(profile_id,anime_id) DO UPDATE SET rating=excluded.rating,updated_at=excluded.updated_at").bind(PROFILE).bind(id).bind(r.rating).bind(&r.updated_at).execute(&mut **tx).await.map_err(err)?;
        }
    }
    sqlx::query("UPDATE profiles SET display_name=? WHERE id=?")
        .bind(&data.profile.name)
        .bind(PROFILE)
        .execute(&mut **tx)
        .await
        .map_err(err)?;
    Ok(())
}
async fn import_atomic(
    db: &mut SqliteConnection,
    data: &Snapshot,
    replace: bool,
    backup_dir: Option<&std::path::Path>,
) -> Result<Option<String>, String> {
    data.validate()?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await.map_err(err)?;
    let result = async {
        let backup = if replace {
            if let Some(dir) = backup_dir {
                let previous = snapshot(&mut tx).await?;
                let bytes = serde_json::to_vec_pretty(&previous).map_err(err)?;
                // Verify the protective export can actually be restored before deleting anything.
                Snapshot::parse(&bytes)?;
                let path = dir.join(format!(
                    "before-replace-{}.json",
                    chrono::Utc::now().format("%Y%m%dT%H%M%S%.9fZ")
                ));
                crate::media::atomic_write(&path, &bytes)?;
                Some(path.to_string_lossy().into_owned())
            } else {
                None
            }
        } else {
            None
        };
        import_rows(&mut tx, data, replace).await?;
        Ok::<_, String>(backup)
    }
    .await;
    match result {
        Ok(backup) => {
            tx.commit().await.map_err(err)?;
            Ok(backup)
        }
        Err(e) => {
            tx.rollback().await.map_err(err)?;
            Err(e)
        }
    }
}
#[tauri::command]
pub async fn export_library(app: AppHandle) -> Result<Option<String>, String> {
    let mut db = database(&app).await?;
    let mut tx = db.begin().await.map_err(err)?;
    let data = snapshot(&mut tx).await?;
    tx.commit().await.map_err(err)?;
    let bytes = serde_json::to_vec_pretty(&data).map_err(err)?;
    Snapshot::parse(&bytes)?;
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Экспортировать библиотеку")
            .add_filter("Библиотека JSON", &["json"])
            .set_file_name("AnimDesk-library.json")
            .save_file()
    })
    .await
    .map_err(err)?;
    match path {
        Some(path) => {
            crate::media::atomic_write(&path, &bytes)?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    token: String,
    anime_count: usize,
    entry_count: usize,
    rating_count: usize,
    profile_name: String,
}
#[tauri::command]
pub async fn preview_import(state: State<'_, TransferState>) -> Result<Option<Preview>, String> {
    let mut pending = state.0.lock().await;
    *pending = None;
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Импортировать библиотеку")
            .add_filter("Библиотека JSON", &["json"])
            .pick_file()
    })
    .await
    .map_err(err)?;
    let Some(path) = path else {
        return Ok(None);
    };
    let data = Snapshot::parse(&crate::media::read_bounded(&path, LIMIT)?)?;
    let token = chrono::Utc::now()
        .timestamp_nanos_opt()
        .ok_or("Не удалось создать идентификатор импорта")?
        .to_string();
    let preview = Preview {
        token: token.clone(),
        anime_count: data.anime.len(),
        entry_count: data.library_entries.len(),
        rating_count: data.ratings.len(),
        profile_name: data.profile.name.clone(),
    };
    *pending = Some(Pending {
        token,
        snapshot: data,
    });
    Ok(Some(preview))
}
#[tauri::command]
pub async fn cancel_import(state: State<'_, TransferState>, token: String) -> Result<(), String> {
    let mut pending = state.0.lock().await;
    if pending.as_ref().is_some_and(|p| p.token == token) {
        *pending = None;
    }
    Ok(())
}
#[tauri::command]
pub async fn apply_import(
    app: AppHandle,
    state: State<'_, TransferState>,
    token: String,
    mode: String,
    confirmed: bool,
) -> Result<Option<String>, String> {
    if !confirmed || !matches!(mode.as_str(), "merge" | "replace") {
        return Err("Подтвердите выбранный режим импорта".into());
    }
    let mut pending = state.0.lock().await;
    let p = pending
        .as_ref()
        .filter(|p| p.token == token)
        .ok_or("Предпросмотр устарел: выберите файл снова")?;
    let dir = crate::media::safe_dir(&app.path().app_data_dir().map_err(err)?, &["backups"])?;
    let result = import_atomic(
        &mut database(&app).await?,
        &p.snapshot,
        mode == "replace",
        Some(&dir),
    )
    .await?;
    *pending = None;
    Ok(result)
}
#[cfg(test)]
#[path = "transfer_tests.rs"]
mod tests;
