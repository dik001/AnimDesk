PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  avatar_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  provider_id TEXT NOT NULL CHECK (length(trim(provider_id)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  synopsis TEXT,
  cover_url TEXT,
  cover_cache_path TEXT,
  year INTEGER,
  format TEXT,
  episodes_total INTEGER CHECK (episodes_total IS NULL OR episodes_total >= 0),
  community_score REAL,
  fetched_at TEXT NOT NULL,
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS anime_titles (
  anime_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  PRIMARY KEY (anime_id, language, title),
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS anime_genres (
  anime_id INTEGER NOT NULL,
  genre_id INTEGER NOT NULL,
  PRIMARY KEY (anime_id, genre_id),
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS library_entries (
  profile_id TEXT NOT NULL,
  anime_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('watching', 'planned', 'completed', 'on_hold', 'dropped')
  ),
  watched_episodes INTEGER NOT NULL DEFAULT 0 CHECK (watched_episodes >= 0),
  notes TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (profile_id, anime_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anime_titles_title
  ON anime_titles(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_anime_titles_anime
  ON anime_titles(anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_genres_genre
  ON anime_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_library_entries_profile
  ON library_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_library_entries_status
  ON library_entries(status);
CREATE INDEX IF NOT EXISTS idx_library_entries_updated_at
  ON library_entries(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_entries_profile_status_updated
  ON library_entries(profile_id, status, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS library_progress_insert_guard
BEFORE INSERT ON library_entries
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM anime
  WHERE id = NEW.anime_id
    AND episodes_total IS NOT NULL
    AND NEW.watched_episodes > episodes_total
)
BEGIN
  SELECT RAISE(ABORT, 'watched_episodes_exceeds_total');
END;

CREATE TRIGGER IF NOT EXISTS library_progress_update_guard
BEFORE UPDATE OF watched_episodes, anime_id ON library_entries
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM anime
  WHERE id = NEW.anime_id
    AND episodes_total IS NOT NULL
    AND NEW.watched_episodes > episodes_total
)
BEGIN
  SELECT RAISE(ABORT, 'watched_episodes_exceeds_total');
END;

CREATE TRIGGER IF NOT EXISTS anime_total_update_guard
BEFORE UPDATE OF episodes_total ON anime
FOR EACH ROW
WHEN NEW.episodes_total IS NOT NULL AND EXISTS (
  SELECT 1 FROM library_entries
  WHERE anime_id = NEW.id
    AND watched_episodes > NEW.episodes_total
)
BEGIN
  SELECT RAISE(ABORT, 'episodes_total_below_progress');
END;

INSERT INTO profiles (id, display_name, avatar_path, created_at)
VALUES (
  'local-default',
  'Пользователь',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(id) DO NOTHING;
