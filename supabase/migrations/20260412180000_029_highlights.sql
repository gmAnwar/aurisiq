-- 029: Auto-highlights from Claude analysis (Propuesta 10)
-- Stores snippet-based highlights for momento_critico and patron_error
-- in the transcription. Frontend matches snippets and renders colored spans.

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS highlights JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN analyses.highlights IS 'Array of {type, snippet, description} from Claude analysis for transcription highlighting';
