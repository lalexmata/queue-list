-- Migration: Add social_tokens table for storing OAuth tokens
CREATE TABLE IF NOT EXISTS social_tokens (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(50) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  user_id VARCHAR(255),
  other_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform, user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_tokens_platform ON social_tokens(platform);
CREATE INDEX IF NOT EXISTS idx_social_tokens_user ON social_tokens(user_id);
