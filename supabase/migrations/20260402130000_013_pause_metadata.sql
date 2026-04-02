-- Migration: Add pause metadata to analysis_jobs
ALTER TABLE analysis_jobs
  ADD COLUMN IF NOT EXISTS pause_count SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER DEFAULT 0;
