use super::*;
const NOW: &str = "2026-10-23T00:00:00Z";
async fn db() -> SqliteConnection {
    let mut db = crate::open_database(std::path::Path::new(":memory:"))
        .await
        .unwrap();
    for sql in [
        crate::INITIAL_MIGRATION,
        crate::EXTERNAL_IDS_MIGRATION,
        crate::DETAIL_METADATA_MIGRATION,
        crate::PERSONAL_RATINGS_MIGRATION,
    ] {
        sqlx::raw_sql(sql).execute(&mut db).await.unwrap();
    }
    db
}
fn fixture() -> Snapshot {
    Snapshot {
        format: "animdesk-library".into(),
        schema_version: 1,
        exported_at: NOW.into(),
        profile: Profile {
            name: "Анна".into(),
        },
        anime: vec![TransferAnime {
            id: 77,
            provider: "shikimori".into(),
            provider_id: "100".into(),
            shikimori_id: Some("100".into()),
            mal_id: Some(1535),
            title: "Сезон".into(),
            synopsis: Some("Описание".into()),
            cover_url: Some("https://cdn.myanimelist.net/images/anime/a.jpg".into()),
            year: Some(2020),
            format: Some("tv".into()),
            episodes_total: Some(12),
            community_score: Some(8.6),
            fetched_at: NOW.into(),
            metadata_json: None,
            titles: vec![AnimeTitleInput {
                language: "en".into(),
                title: "Season".into(),
            }],
            genres: vec!["Драма".into()],
        }],
        library_entries: vec![Entry {
            anime_id: 77,
            status: "watching".into(),
            watched_episodes: 3,
            notes: Some("Заметка".into()),
            added_at: NOW.into(),
            updated_at: NOW.into(),
            started_at: Some("2026-10-22".into()),
            completed_at: None,
        }],
        ratings: vec![Rating {
            anime_id: 77,
            rating: 9,
            updated_at: NOW.into(),
        }],
    }
}
async fn count(db: &mut SqliteConnection, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
        .fetch_one(db)
        .await
        .unwrap()
}
#[tokio::test]
async fn round_trip_preserves_all_portable_fields() {
    let mut source = db().await;
    import_atomic(&mut source, &fixture(), false, None)
        .await
        .unwrap();
    let exported = snapshot(&mut source).await.unwrap();
    assert_eq!(exported.format, EXPORT_FORMAT);
    let bytes = serde_json::to_vec_pretty(&exported).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("cache_path"));
    let parsed = Snapshot::parse(&bytes).unwrap();
    let mut target = db().await;
    import_atomic(&mut target, &parsed, false, None)
        .await
        .unwrap();
    let mut restored = snapshot(&mut target).await.unwrap();
    restored.exported_at = exported.exported_at.clone();
    assert_eq!(
        serde_json::to_value(restored).unwrap(),
        serde_json::to_value(exported).unwrap()
    );
}
#[tokio::test]
async fn merge_restores_two_provider_identity_without_duplicates() {
    let mut db = db().await;
    let mut jikan = fixture();
    let a = &mut jikan.anime[0];
    a.provider = "jikan".into();
    a.provider_id = "1535".into();
    a.shikimori_id = None;
    import_atomic(&mut db, &jikan, false, None).await.unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM anime")
        .fetch_one(&mut db)
        .await
        .unwrap();
    for _ in 0..2 {
        import_atomic(&mut db, &fixture(), false, None)
            .await
            .unwrap();
    }
    assert_eq!(count(&mut db, "anime").await, 1);
    assert_eq!(count(&mut db, "library_entries").await, 1);
    let a = &snapshot(&mut db).await.unwrap().anime[0];
    assert_eq!(a.id, id);
    assert_eq!(a.shikimori_id.as_deref(), Some("100"));
    assert_eq!(a.mal_id, Some(1535));
    assert_eq!(a.provider, "jikan");
}
#[test]
fn invalid_json_version_links_values_and_duplicate_ids_rejected() {
    for bytes in [b"{".as_slice(), b"[]", b"null"] {
        assert!(Snapshot::parse(bytes).is_err());
    }
    let good = serde_json::to_value(fixture()).unwrap();
    for (key, value) in [
        ("schemaVersion", serde_json::json!(2)),
        ("format", serde_json::json!("other")),
        ("profile", serde_json::json!({"name":""})),
    ] {
        let mut bad = good.clone();
        bad[key] = value;
        assert!(Snapshot::parse(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    let mut bad = fixture();
    bad.library_entries[0].anime_id = 123;
    assert!(bad.validate().is_err());
    let mut bad = fixture();
    bad.anime.push(bad.anime[0].clone());
    bad.library_entries.push(bad.library_entries[0].clone());
    assert!(bad.validate().is_err());
    let mut bad = fixture();
    bad.library_entries[0].watched_episodes = 13;
    assert!(bad.validate().is_err());
    let mut bad = fixture();
    bad.anime[0].cover_url = Some("file:///C:/private".into());
    assert!(bad.validate().is_err());
    let mut bad = good;
    bad["anime"][0]["cover_cache_path"] = serde_json::json!("C:/private");
    assert!(Snapshot::parse(&serde_json::to_vec(&bad).unwrap()).is_err());
}
#[tokio::test]
async fn failure_midway_rolls_back_including_replace_and_profile() {
    for replace in [false, true] {
        let mut db = db().await;
        import_atomic(&mut db, &fixture(), false, None)
            .await
            .unwrap();
        let before = snapshot(&mut db).await.unwrap();
        let mut incoming = fixture();
        incoming.profile.name = "Другое имя".into();
        incoming.library_entries[0].watched_episodes = 7;
        let mut second = incoming.anime[0].clone();
        second.id = 88;
        second.provider_id = "200".into();
        second.shikimori_id = Some("200".into());
        second.mal_id = Some(200);
        incoming.anime.push(second);
        let mut entry = incoming.library_entries[0].clone();
        entry.anime_id = 88;
        incoming.library_entries.push(entry);
        sqlx::raw_sql("CREATE TRIGGER fail_second BEFORE INSERT ON anime WHEN NEW.provider_id='200' BEGIN SELECT RAISE(ABORT,'injected_failure'); END;").execute(&mut db).await.unwrap();
        assert!(import_atomic(&mut db, &incoming, replace, None)
            .await
            .unwrap_err()
            .contains("injected_failure"));
        let mut after = snapshot(&mut db).await.unwrap();
        after.exported_at = before.exported_at.clone();
        assert_eq!(
            serde_json::to_value(before).unwrap(),
            serde_json::to_value(after).unwrap()
        );
    }
}
#[tokio::test]
async fn identity_conflict_does_not_merge_or_change_data() {
    let mut db = db().await;
    import_atomic(&mut db, &fixture(), false, None)
        .await
        .unwrap();
    sqlx::query("INSERT INTO anime(provider,provider_id,mal_id,title,fetched_at) VALUES('jikan','200',200,'Другое',?)").bind(NOW).execute(&mut db).await.unwrap();
    let mut incoming = fixture();
    incoming.anime[0].mal_id = Some(200);
    assert!(import_atomic(&mut db, &incoming, false, None)
        .await
        .is_err());
    assert_eq!(count(&mut db, "anime").await, 2);
    assert_eq!(snapshot(&mut db).await.unwrap().anime[0].mal_id, Some(1535));
}
#[tokio::test]
async fn replacement_backup_is_restorable_and_failure_to_backup_preserves_data() {
    let mut db = db().await;
    import_atomic(&mut db, &fixture(), false, None)
        .await
        .unwrap();
    let mut empty = fixture();
    empty.anime.clear();
    empty.library_entries.clear();
    empty.ratings.clear();
    let dir = tempfile::tempdir().unwrap();
    let invalid = dir.path().join("missing");
    assert!(import_atomic(&mut db, &empty, true, Some(&invalid))
        .await
        .is_err());
    assert_eq!(count(&mut db, "library_entries").await, 1);
    let path = import_atomic(&mut db, &empty, true, Some(dir.path()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(count(&mut db, "library_entries").await, 0);
    let backup = Snapshot::parse(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(backup.anime.len(), 1);
    import_atomic(&mut db, &backup, false, None).await.unwrap();
    assert_eq!(count(&mut db, "library_entries").await, 1);
}
#[tokio::test]
async fn reopening_database_offline_retains_details_and_profile() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let mut memory = db().await;
    // Apply the real schema to a file, then close every connection.
    let mut file = crate::open_database(&path).await.unwrap();
    for sql in [
        crate::INITIAL_MIGRATION,
        crate::EXTERNAL_IDS_MIGRATION,
        crate::DETAIL_METADATA_MIGRATION,
        crate::PERSONAL_RATINGS_MIGRATION,
    ] {
        sqlx::raw_sql(sql).execute(&mut file).await.unwrap();
    }
    import_atomic(&mut file, &fixture(), false, None)
        .await
        .unwrap();
    file.close().await.unwrap();
    let mut reopened = crate::open_database(&path).await.unwrap();
    let data = snapshot(&mut reopened).await.unwrap();
    assert_eq!(data.profile.name, "Анна");
    assert_eq!(data.anime[0].titles[0].title, "Season");
    assert_eq!(data.library_entries[0].watched_episodes, 3);
    import_atomic(&mut memory, &data, false, None)
        .await
        .unwrap();
}
#[tokio::test]
async fn standalone_personal_ratings_round_trip_without_inventing_library_entries() {
    let mut source = db().await;
    let mut data = fixture();
    data.library_entries.clear();
    import_atomic(&mut source, &data, false, None)
        .await
        .unwrap();
    let exported = snapshot(&mut source).await.unwrap();
    assert_eq!(exported.anime.len(), 1);
    assert_eq!(exported.ratings.len(), 1);
    assert!(exported.library_entries.is_empty());
    let mut target = db().await;
    import_atomic(
        &mut target,
        &Snapshot::parse(&serde_json::to_vec(&exported).unwrap()).unwrap(),
        false,
        None,
    )
    .await
    .unwrap();
    assert_eq!(count(&mut target, "anime_ratings").await, 1);
    assert_eq!(count(&mut target, "library_entries").await, 0);
}

#[tokio::test]
async fn authoritative_source_pair_restores_missing_source_id_without_duplicate() {
    let mut db = db().await;
    let mut existing = fixture();
    existing.anime[0].provider = "jikan".into();
    existing.anime[0].provider_id = "1535".into();
    import_atomic(&mut db, &existing, false, None)
        .await
        .unwrap();
    let mut incoming = fixture();
    incoming.anime[0].shikimori_id = None;
    incoming.anime[0].mal_id = None;
    import_atomic(&mut db, &incoming, false, None)
        .await
        .unwrap();
    assert_eq!(count(&mut db, "anime").await, 1);
    assert_eq!(snapshot(&mut db).await.unwrap().anime[0].mal_id, Some(1535));
}

#[tokio::test]
async fn legacy_import_reexports_current_format_without_losing_fields() {
    let mut legacy = fixture();
    legacy.format = LEGACY_IMPORT_FORMAT.into();
    let parsed = Snapshot::parse(&serde_json::to_vec(&legacy).unwrap()).unwrap();
    let mut target = db().await;
    import_atomic(&mut target, &parsed, false, None)
        .await
        .unwrap();
    let mut exported = snapshot(&mut target).await.unwrap();
    assert_eq!(exported.format, EXPORT_FORMAT);
    exported.exported_at = legacy.exported_at.clone();
    // Internal IDs are reassigned by import; compare two equivalent imports.
    let mut reference = db().await;
    import_atomic(&mut reference, &fixture(), false, None)
        .await
        .unwrap();
    let mut expected = snapshot(&mut reference).await.unwrap();
    expected.exported_at = exported.exported_at.clone();
    assert_eq!(
        serde_json::to_value(exported).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    legacy.schema_version = 2;
    assert!(Snapshot::parse(&serde_json::to_vec(&legacy).unwrap()).is_err());
    legacy.schema_version = 1;
    legacy.library_entries[0].watched_episodes = -1;
    assert!(Snapshot::parse(&serde_json::to_vec(&legacy).unwrap()).is_err());
    legacy.format = EXPORT_FORMAT.into();
    assert!(Snapshot::parse(&serde_json::to_vec(&legacy).unwrap()).is_err());
    legacy.library_entries[0].watched_episodes = 3;
    legacy.format = "unrecognized-library".into();
    assert!(Snapshot::parse(&serde_json::to_vec(&legacy).unwrap()).is_err());
}
