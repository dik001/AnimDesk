#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
compile_error!("AnimDesk поддерживает только Windows 10/11.");

mod catalog;
mod media;
mod transfer;

use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteConnection},
    Connection, Row,
};
use std::{fmt, path::Path};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:anidesk.db";
const DATABASE_FILE: &str = "anidesk.db";
const INITIAL_MIGRATION: &str = include_str!("../migrations/001_initial.sql");
const PERSONAL_RATINGS_MIGRATION: &str = include_str!("../migrations/004_personal_ratings.sql");
const DETAIL_METADATA_MIGRATION: &str = include_str!("../migrations/003_detail_metadata.sql");
const EXTERNAL_IDS_MIGRATION: &str = include_str!("../migrations/002_external_ids.sql");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimeTitleInput {
    language: String,
    title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimeUpsertInput {
    provider: String,
    provider_id: String,
    shikimori_id: Option<String>,
    mal_id: Option<i64>,
    title: String,
    synopsis: Option<String>,
    cover_url: Option<String>,
    cover_cache_path: Option<String>,
    year: Option<i64>,
    format: Option<String>,
    episodes_total: Option<i64>,
    community_score: Option<f64>,
    fetched_at: String,
    metadata_json: Option<String>,
    titles: Vec<AnimeTitleInput>,
    genres: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimeUpsertResult {
    anime_id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimeCommandError {
    code: &'static str,
    message: String,
}

#[derive(Debug)]
enum AnimeUpsertError {
    IdentityConflict(String),
    Database(sqlx::Error),
}

impl From<sqlx::Error> for AnimeUpsertError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl fmt::Display for AnimeUpsertError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IdentityConflict(message) => formatter.write_str(message),
            Self::Database(error) => error.fmt(formatter),
        }
    }
}

fn validate_upsert(input: &AnimeUpsertInput) -> Result<(), String> {
    if input.provider.trim().is_empty()
        || input.provider_id.trim().is_empty()
        || input.title.trim().is_empty()
    {
        return Err("Источник, внешний ID и название аниме обязательны".into());
    }

    if input.episodes_total.is_some_and(|total| total < 0) {
        return Err("Число серий не может быть отрицательным".into());
    }

    if input
        .shikimori_id
        .as_ref()
        .is_some_and(|id| id.trim().is_empty())
    {
        return Err("Shikimori ID не может быть пустым".into());
    }

    if input.mal_id.is_some_and(|id| id <= 0) {
        return Err("MAL ID должен быть положительным целым числом".into());
    }

    if input
        .titles
        .iter()
        .any(|title| title.language.trim().is_empty() || title.title.trim().is_empty())
    {
        return Err("Язык и альтернативное название не могут быть пустыми".into());
    }

    if input.genres.iter().any(|genre| genre.trim().is_empty()) {
        return Err("Название жанра не может быть пустым".into());
    }

    Ok(())
}

async fn open_database(path: &Path) -> Result<SqliteConnection, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);

    SqliteConnection::connect_with(&options).await
}

async fn upsert_anime_transaction(
    connection: &mut SqliteConnection,
    input: AnimeUpsertInput,
) -> Result<i64, AnimeUpsertError> {
    let mut transaction = connection.begin().await?;
    let id = upsert_anime_in_transaction(&mut transaction, input).await?;
    transaction.commit().await?;
    Ok(id)
}

async fn upsert_anime_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    input: AnimeUpsertInput,
) -> Result<i64, AnimeUpsertError> {
    let provider = input.provider.trim().to_owned();
    let provider_id = input.provider_id.trim().to_owned();
    let shikimori_id = input
        .shikimori_id
        .as_deref()
        .map(str::trim)
        .map(str::to_owned);
    let mal_id = input.mal_id;

    let matches = sqlx::query(
        "SELECT id, shikimori_id, mal_id
         FROM anime
         WHERE (provider = ? AND provider_id = ?)
            OR (? IS NOT NULL AND shikimori_id = ?)
            OR (? IS NOT NULL AND mal_id = ?)",
    )
    .bind(&provider)
    .bind(&provider_id)
    .bind(shikimori_id.as_deref())
    .bind(shikimori_id.as_deref())
    .bind(mal_id)
    .bind(mal_id)
    .fetch_all(&mut **transaction)
    .await?;

    if matches.len() > 1 {
        return Err(AnimeUpsertError::IdentityConflict(
            "Переданные внешние идентификаторы относятся к разным локальным записям".into(),
        ));
    }

    let anime_id = if let Some(existing) = matches.first() {
        let anime_id: i64 = existing.try_get("id")?;
        let existing_shikimori_id: Option<String> = existing.try_get("shikimori_id")?;
        let existing_mal_id: Option<i64> = existing.try_get("mal_id")?;

        if shikimori_id.as_ref().is_some_and(|new_id| {
            existing_shikimori_id
                .as_ref()
                .is_some_and(|saved_id| saved_id != new_id)
        }) || mal_id
            .is_some_and(|new_id| existing_mal_id.is_some_and(|saved_id| saved_id != new_id))
        {
            return Err(AnimeUpsertError::IdentityConflict(
                "Новые внешние идентификаторы противоречат сохранённой записи".into(),
            ));
        }

        sqlx::query(
            "UPDATE anime SET
                shikimori_id = COALESCE(?, shikimori_id),
                mal_id = COALESCE(?, mal_id),
                title = ?, synopsis = COALESCE(?, synopsis), cover_url = COALESCE(?, cover_url), cover_cache_path = COALESCE(?, cover_cache_path),
                year = COALESCE(?, year), format = COALESCE(?, format), episodes_total = COALESCE(?, episodes_total), community_score = COALESCE(?, community_score), fetched_at = ?, metadata_json = COALESCE(?, metadata_json)
             WHERE id = ?",
        )
        .bind(shikimori_id.as_deref())
        .bind(mal_id)
        .bind(input.title.trim())
        .bind(input.synopsis.as_deref())
        .bind(input.cover_url.as_deref())
        .bind(input.cover_cache_path.as_deref())
        .bind(input.year)
        .bind(input.format.as_deref())
        .bind(input.episodes_total)
        .bind(input.community_score)
        .bind(&input.fetched_at)
        .bind(input.metadata_json.as_deref())
        .bind(anime_id)
        .execute(&mut **transaction)
        .await?;

        anime_id
    } else {
        sqlx::query(
            "INSERT INTO anime (
                provider, provider_id, shikimori_id, mal_id, title, synopsis,
                cover_url, cover_cache_path, year, format, episodes_total,
                community_score, fetched_at, metadata_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&provider)
        .bind(&provider_id)
        .bind(shikimori_id.as_deref())
        .bind(mal_id)
        .bind(input.title.trim())
        .bind(input.synopsis.as_deref())
        .bind(input.cover_url.as_deref())
        .bind(input.cover_cache_path.as_deref())
        .bind(input.year)
        .bind(input.format.as_deref())
        .bind(input.episodes_total)
        .bind(input.community_score)
        .bind(&input.fetched_at)
        .bind(input.metadata_json.as_deref())
        .execute(&mut **transaction)
        .await?
        .last_insert_rowid()
    };

    for title in input.titles {
        sqlx::query(
            "INSERT OR IGNORE INTO anime_titles (anime_id, language, title) VALUES (?, ?, ?)",
        )
        .bind(anime_id)
        .bind(title.language.trim())
        .bind(title.title.trim())
        .execute(&mut **transaction)
        .await?;
    }

    for genre in input.genres {
        let genre = genre.trim();
        sqlx::query("INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO NOTHING")
            .bind(genre)
            .execute(&mut **transaction)
            .await?;

        sqlx::query(
            "INSERT OR IGNORE INTO anime_genres (anime_id, genre_id)
             SELECT ?, id FROM genres WHERE name = ? COLLATE NOCASE",
        )
        .bind(anime_id)
        .bind(genre)
        .execute(&mut **transaction)
        .await?;
    }

    Ok(anime_id)
}

#[tauri::command]
async fn upsert_anime(
    app: AppHandle,
    input: AnimeUpsertInput,
) -> Result<AnimeUpsertResult, AnimeCommandError> {
    validate_upsert(&input).map_err(|message| AnimeCommandError {
        code: "validation",
        message,
    })?;

    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| AnimeCommandError {
            code: "storage",
            message: format!("Не удалось определить каталог данных AnimDesk: {error}"),
        })?;
    std::fs::create_dir_all(&app_config_dir).map_err(|error| AnimeCommandError {
        code: "storage",
        message: format!("Не удалось создать каталог данных AnimDesk: {error}"),
    })?;

    let mut connection = open_database(&app_config_dir.join(DATABASE_FILE))
        .await
        .map_err(|error| AnimeCommandError {
            code: "storage",
            message: format!("Не удалось открыть базу AnimDesk: {error}"),
        })?;
    let anime_id = upsert_anime_transaction(&mut connection, input)
        .await
        .map_err(|error| match error {
            AnimeUpsertError::IdentityConflict(message) => AnimeCommandError {
                code: "identityConflict",
                message,
            },
            AnimeUpsertError::Database(error)
                if error
                    .as_database_error()
                    .is_some_and(|database_error| database_error.is_unique_violation()) =>
            {
                AnimeCommandError {
                    code: "identityConflict",
                    message: "Внешний идентификатор уже связан с другой записью".into(),
                }
            }
            AnimeUpsertError::Database(error) => AnimeCommandError {
                code: "storage",
                message: format!("Не удалось сохранить аниме: {error}"),
            },
        })?;

    Ok(AnimeUpsertResult { anime_id })
}

fn main() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_local_storage",
            sql: INITIAL_MIGRATION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_trusted_external_ids",
            sql: EXTERNAL_IDS_MIGRATION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "detail_metadata",
            sql: DETAIL_METADATA_MIGRATION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "personal_ratings",
            sql: PERSONAL_RATINGS_MIGRATION,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .manage(catalog::CatalogState::new())
        .manage(media::MediaState::default())
        .manage(transfer::TransferState::default())
        .invoke_handler(tauri::generate_handler![
            upsert_anime,
            catalog::catalog_request,
            media::cover_image,
            media::warm_covers,
            media::avatar_image,
            media::choose_avatar,
            media::reset_avatar,
            transfer::export_library,
            transfer::preview_import,
            transfer::apply_import,
            transfer::cancel_import
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить AnimDesk");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn migrated_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("test database should open");
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&pool)
            .await
            .expect("initial migration should apply");
        sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
            .execute(&pool)
            .await
            .expect("external IDs migration should apply");
        sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PERSONAL_RATINGS_MIGRATION)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn personal_ratings_are_local_and_enforce_integer_bounds() {
        let pool = migrated_pool().await;
        sqlx::query("INSERT INTO anime(id,provider,provider_id,title,fetched_at,community_score) VALUES(1,'shikimori','100','Сезон','now',8.6)").execute(&pool).await.unwrap();
        for rating in [1, 10] {
            sqlx::query("INSERT INTO anime_ratings(profile_id,anime_id,rating,updated_at) VALUES('local-default',1,?,'now') ON CONFLICT(profile_id,anime_id) DO UPDATE SET rating=excluded.rating").bind(rating).execute(&pool).await.unwrap();
        }
        for rating in [0.0, 11.0, 2.5] {
            assert!(sqlx::query("UPDATE anime_ratings SET rating=?")
                .bind(rating)
                .execute(&pool)
                .await
                .is_err());
        }
        let rating: i64 = sqlx::query_scalar("SELECT rating FROM anime_ratings")
            .fetch_one(&pool)
            .await
            .unwrap();
        let score: f64 = sqlx::query_scalar("SELECT community_score FROM anime WHERE id=1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let entries: i64 = sqlx::query_scalar("SELECT count(*) FROM library_entries")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rating, 10);
        assert_eq!(score, 8.6);
        assert_eq!(entries, 0);
    }

    #[tokio::test]
    async fn same_title_with_different_external_ids_stays_separate() {
        let mut connection = open_database(Path::new(":memory:")).await.unwrap();
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        let first = anime_input("Одинаковое название");
        let id1 = upsert_anime_transaction(&mut connection, first)
            .await
            .unwrap();
        let mut second = anime_input("Одинаковое название");
        second.provider_id = "season-2".into();
        second.shikimori_id = Some("102".into());
        second.mal_id = Some(203);
        let id2 = upsert_anime_transaction(&mut connection, second)
            .await
            .unwrap();
        assert_ne!(id1, id2);
    }

    #[tokio::test]
    async fn migration_creates_only_the_default_profile() {
        let pool = migrated_pool().await;
        let profile_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM profiles WHERE id = 'local-default'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let anime_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anime")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(profile_count, 1);
        assert_eq!(anime_count, 0);
    }

    #[tokio::test]
    async fn migration_002_backfills_only_canonical_jikan_ids_and_preserves_user_data() {
        let options = SqliteConnectOptions::new()
            .in_memory(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();

        sqlx::query("UPDATE profiles SET display_name = ? WHERE id = ?")
            .bind("Сохранённый профиль")
            .bind("local-default")
            .execute(&mut connection)
            .await
            .unwrap();
        for provider_id in ["5114", "001", "0", "-1", "12x", "9223372036854775808"] {
            sqlx::query(
                "INSERT INTO anime (provider, provider_id, title, fetched_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind("jikan")
            .bind(provider_id)
            .bind(format!("Jikan {provider_id}"))
            .bind("2026-10-23T00:00:00.000Z")
            .execute(&mut connection)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO anime (provider, provider_id, title, fetched_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind("shikimori")
        .bind("777")
        .bind("Не Jikan")
        .bind("2026-10-23T00:00:00.000Z")
        .execute(&mut connection)
        .await
        .unwrap();
        let saved_anime_id: i64 =
            sqlx::query_scalar("SELECT id FROM anime WHERE provider = ? AND provider_id = ?")
                .bind("jikan")
                .bind("5114")
                .fetch_one(&mut connection)
                .await
                .unwrap();
        sqlx::query(
            "INSERT INTO library_entries (
                profile_id, anime_id, status, watched_episodes, notes, added_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("local-default")
        .bind(saved_anime_id)
        .bind("watching")
        .bind(7_i64)
        .bind("Не потерять")
        .bind("2026-10-23T00:00:00.000Z")
        .bind("2026-10-23T00:00:00.000Z")
        .execute(&mut connection)
        .await
        .unwrap();

        sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();

        let migrated_mal_id: Option<i64> =
            sqlx::query_scalar("SELECT mal_id FROM anime WHERE id = ?")
                .bind(saved_anime_id)
                .fetch_one(&mut connection)
                .await
                .unwrap();
        let untouched_invalid_ids: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM anime WHERE provider = ? AND provider_id <> ? AND mal_id IS NULL",
        )
        .bind("jikan")
        .bind("5114")
        .fetch_one(&mut connection)
        .await
        .unwrap();
        let profile_name: String =
            sqlx::query_scalar("SELECT display_name FROM profiles WHERE id = ?")
                .bind("local-default")
                .fetch_one(&mut connection)
                .await
                .unwrap();
        let non_jikan_mal_id: Option<i64> =
            sqlx::query_scalar("SELECT mal_id FROM anime WHERE provider = ? AND provider_id = ?")
                .bind("shikimori")
                .bind("777")
                .fetch_one(&mut connection)
                .await
                .unwrap();
        let library_data: (i64, String, String) = sqlx::query_as(
            "SELECT watched_episodes, status, notes
             FROM library_entries WHERE profile_id = ? AND anime_id = ?",
        )
        .bind("local-default")
        .bind(saved_anime_id)
        .fetch_one(&mut connection)
        .await
        .unwrap();

        assert_eq!(migrated_mal_id, Some(5114));
        assert_eq!(untouched_invalid_ids, 5);
        assert_eq!(non_jikan_mal_id, None);
        assert_eq!(profile_name, "Сохранённый профиль");
        assert_eq!(library_data, (7, "watching".into(), "Не потерять".into()));
    }

    #[tokio::test]
    async fn external_id_indexes_are_unique_only_for_known_values() {
        let pool = migrated_pool().await;
        sqlx::query(
            "INSERT INTO anime (
                provider, provider_id, shikimori_id, mal_id, title, fetched_at
             ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("shikimori")
        .bind("10")
        .bind("10")
        .bind(20_i64)
        .bind("Первая запись")
        .bind("now")
        .execute(&pool)
        .await
        .unwrap();

        let duplicate_shikimori = sqlx::query(
            "INSERT INTO anime (provider, provider_id, shikimori_id, title, fetched_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind("other")
        .bind("shiki-duplicate")
        .bind("10")
        .bind("Дубликат")
        .bind("now")
        .execute(&pool)
        .await;
        let duplicate_mal = sqlx::query(
            "INSERT INTO anime (provider, provider_id, mal_id, title, fetched_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind("other")
        .bind("mal-duplicate")
        .bind(20_i64)
        .bind("Дубликат")
        .bind("now")
        .execute(&pool)
        .await;

        assert!(duplicate_shikimori.is_err());
        assert!(duplicate_mal.is_err());

        for provider_id in ["unknown-a", "unknown-b"] {
            sqlx::query(
                "INSERT INTO anime (provider, provider_id, title, fetched_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind("other")
            .bind(provider_id)
            .bind("Без известных ID")
            .bind("now")
            .execute(&pool)
            .await
            .expect("multiple NULL external IDs must be allowed");
        }
    }

    #[tokio::test]
    async fn foreign_keys_and_progress_guards_are_enforced() {
        let pool = migrated_pool().await;
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(foreign_keys, 1);

        let missing_anime = sqlx::query(
            "INSERT INTO library_entries (
                profile_id, anime_id, status, watched_episodes, added_at, updated_at
             ) VALUES ('local-default', 999, 'planned', 0, 'now', 'now')",
        )
        .execute(&pool)
        .await;
        assert!(missing_anime.is_err());

        sqlx::query(
            "INSERT INTO anime (provider, provider_id, title, episodes_total, fetched_at)
             VALUES ('test', 'known', 'Known', 12, 'now'),
                    ('test', 'unknown', 'Unknown', NULL, 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let too_far = sqlx::query(
            "INSERT INTO library_entries (
                profile_id, anime_id, status, watched_episodes, added_at, updated_at
             ) SELECT 'local-default', id, 'watching', 13, 'now', 'now'
               FROM anime WHERE provider_id = 'known'",
        )
        .execute(&pool)
        .await;
        assert!(too_far.is_err());

        sqlx::query(
            "INSERT INTO library_entries (
                profile_id, anime_id, status, watched_episodes, added_at, updated_at
             ) SELECT 'local-default', id, 'planned', 99, 'now', 'now'
               FROM anime WHERE provider_id = 'unknown'",
        )
        .execute(&pool)
        .await
        .expect("unknown total must allow manual progress");

        let row = sqlx::query(
            "SELECT status, watched_episodes FROM library_entries
             JOIN anime ON anime.id = library_entries.anime_id
             WHERE anime.provider_id = 'unknown'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.get::<String, _>("status"), "planned");
        assert_eq!(row.get::<i64, _>("watched_episodes"), 99);
    }

    fn anime_input(title: &str) -> AnimeUpsertInput {
        AnimeUpsertInput {
            provider: "test-provider".into(),
            provider_id: "season-1".into(),
            shikimori_id: Some("101".into()),
            mal_id: Some(202),
            title: title.into(),
            synopsis: None,
            cover_url: None,
            cover_cache_path: None,
            year: Some(2026),
            format: Some("TV".into()),
            episodes_total: None,
            community_score: None,
            metadata_json: None,
            fetched_at: "2026-10-23T00:00:00.000Z".into(),
            titles: vec![AnimeTitleInput {
                language: "ru".into(),
                title: title.into(),
            }],
            genres: vec!["Фэнтези".into()],
        }
    }

    #[tokio::test]
    async fn repeated_upsert_is_atomic_and_does_not_duplicate_anime() {
        let options = SqliteConnectOptions::new()
            .in_memory(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();

        let first_id = upsert_anime_transaction(&mut connection, anime_input("Первое название"))
            .await
            .unwrap();
        let second_id = upsert_anime_transaction(&mut connection, anime_input("Новое название"))
            .await
            .unwrap();

        let anime_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM anime WHERE provider = ? AND provider_id = ?")
                .bind("test-provider")
                .bind("season-1")
                .fetch_one(&mut connection)
                .await
                .unwrap();
        let saved_title: String = sqlx::query_scalar("SELECT title FROM anime WHERE id = ?")
            .bind(first_id)
            .fetch_one(&mut connection)
            .await
            .unwrap();

        assert_eq!(first_id, second_id);
        assert_eq!(anime_count, 1);
        assert_eq!(saved_title, "Новое название");
    }

    #[tokio::test]
    async fn trusted_mal_id_links_shikimori_metadata_to_the_existing_record() {
        let options = SqliteConnectOptions::new()
            .in_memory(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();

        let mut jikan = anime_input("Название Jikan");
        jikan.provider = "jikan".into();
        jikan.provider_id = "5114".into();
        jikan.shikimori_id = None;
        jikan.mal_id = Some(5114);
        let anime_id = upsert_anime_transaction(&mut connection, jikan)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO library_entries (
                profile_id, anime_id, status, watched_episodes, added_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("local-default")
        .bind(anime_id)
        .bind("watching")
        .bind(9_i64)
        .bind("now")
        .bind("now")
        .execute(&mut connection)
        .await
        .unwrap();

        let mut shikimori = anime_input("Название Shikimori");
        shikimori.provider = "shikimori".into();
        shikimori.provider_id = "20".into();
        shikimori.shikimori_id = Some("20".into());
        shikimori.mal_id = Some(5114);
        let matched_id = upsert_anime_transaction(&mut connection, shikimori)
            .await
            .unwrap();

        let identity: (String, String, Option<String>, Option<i64>, String) = sqlx::query_as(
            "SELECT provider, provider_id, shikimori_id, mal_id, title FROM anime WHERE id = ?",
        )
        .bind(anime_id)
        .fetch_one(&mut connection)
        .await
        .unwrap();
        let progress: i64 = sqlx::query_scalar(
            "SELECT watched_episodes FROM library_entries WHERE profile_id = ? AND anime_id = ?",
        )
        .bind("local-default")
        .bind(anime_id)
        .fetch_one(&mut connection)
        .await
        .unwrap();

        assert_eq!(matched_id, anime_id);
        assert_eq!(
            identity,
            (
                "jikan".into(),
                "5114".into(),
                Some("20".into()),
                Some(5114),
                "Название Shikimori".into(),
            )
        );
        assert_eq!(progress, 9);
    }

    #[tokio::test]
    async fn contradictory_external_ids_are_reported_without_merging_records() {
        let options = SqliteConnectOptions::new()
            .in_memory(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();

        upsert_anime_transaction(&mut connection, anime_input("Первая"))
            .await
            .unwrap();
        let mut second = anime_input("Вторая");
        second.provider_id = "season-2".into();
        second.shikimori_id = Some("102".into());
        second.mal_id = Some(203);
        upsert_anime_transaction(&mut connection, second)
            .await
            .unwrap();

        let mut conflict = anime_input("Конфликт");
        conflict.provider_id = "season-conflict".into();
        conflict.shikimori_id = Some("101".into());
        conflict.mal_id = Some(203);
        let result = upsert_anime_transaction(&mut connection, conflict).await;
        let anime_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anime")
            .fetch_one(&mut connection)
            .await
            .unwrap();

        assert!(matches!(result, Err(AnimeUpsertError::IdentityConflict(_))));
        assert_eq!(anime_count, 2);
    }

    #[tokio::test]
    async fn failed_related_write_rolls_back_the_whole_anime_upsert() {
        let options = SqliteConnectOptions::new()
            .in_memory(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
            .execute(&mut connection)
            .await
            .unwrap();

        let anime_id = upsert_anime_transaction(&mut connection, anime_input("Исходное название"))
            .await
            .unwrap();
        let mut invalid_update = anime_input("Не должно сохраниться");
        invalid_update.genres = vec!["".into()];

        let update_result = upsert_anime_transaction(&mut connection, invalid_update).await;
        assert!(update_result.is_err());

        let saved_title: String = sqlx::query_scalar("SELECT title FROM anime WHERE id = ?")
            .bind(anime_id)
            .fetch_one(&mut connection)
            .await
            .unwrap();
        let genres: Vec<String> = sqlx::query_scalar(
            "SELECT genres.name FROM genres
             JOIN anime_genres ON anime_genres.genre_id = genres.id
             WHERE anime_genres.anime_id = ?",
        )
        .bind(anime_id)
        .fetch_all(&mut connection)
        .await
        .unwrap();

        assert_eq!(saved_title, "Исходное название");
        assert_eq!(genres, vec!["Фэнтези"]);
    }

    #[tokio::test]
    async fn file_database_preserves_profile_and_library_after_reopen() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("animdesk-storage-{unique}.db"));

        {
            let mut connection = open_database(&path).await.unwrap();
            sqlx::raw_sql(INITIAL_MIGRATION)
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::raw_sql(EXTERNAL_IDS_MIGRATION)
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::raw_sql(DETAIL_METADATA_MIGRATION)
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::query("UPDATE profiles SET display_name = ? WHERE id = ?")
                .bind("Сохранённое имя")
                .bind("local-default")
                .execute(&mut connection)
                .await
                .unwrap();
            let anime_id = upsert_anime_transaction(&mut connection, anime_input("Сезон"))
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO library_entries (
                    profile_id, anime_id, status, watched_episodes, added_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind("local-default")
            .bind(anime_id)
            .bind("watching")
            .bind(7_i64)
            .bind("2026-10-23T00:00:00.000Z")
            .bind("2026-10-23T00:00:00.000Z")
            .execute(&mut connection)
            .await
            .unwrap();
            connection.close().await.unwrap();
        }

        {
            let mut connection = open_database(&path).await.unwrap();
            let name: String = sqlx::query_scalar("SELECT display_name FROM profiles WHERE id = ?")
                .bind("local-default")
                .fetch_one(&mut connection)
                .await
                .unwrap();
            let progress: i64 = sqlx::query_scalar(
                "SELECT watched_episodes FROM library_entries WHERE profile_id = ?",
            )
            .bind("local-default")
            .fetch_one(&mut connection)
            .await
            .unwrap();

            assert_eq!(name, "Сохранённое имя");
            assert_eq!(progress, 7);
            connection.close().await.unwrap();
        }

        std::fs::remove_file(path).expect("temporary database should be removable");
    }
}
