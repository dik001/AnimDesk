CREATE TABLE anime_ratings (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 10),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, anime_id)
);
