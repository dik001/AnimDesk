ALTER TABLE anime ADD COLUMN shikimori_id TEXT;
ALTER TABLE anime ADD COLUMN mal_id INTEGER;

UPDATE anime
SET mal_id = CAST(provider_id AS INTEGER)
WHERE provider = 'jikan'
  AND provider_id <> ''
  AND provider_id NOT GLOB '*[^0-9]*'
  AND CAST(provider_id AS INTEGER) > 0
  AND CAST(CAST(provider_id AS INTEGER) AS TEXT) = provider_id;

CREATE UNIQUE INDEX idx_anime_unique_shikimori_id
  ON anime(shikimori_id)
  WHERE shikimori_id IS NOT NULL;

CREATE UNIQUE INDEX idx_anime_unique_mal_id
  ON anime(mal_id)
  WHERE mal_id IS NOT NULL;
