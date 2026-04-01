-- Migration: Delete all provisional speeches generated with wrong context
-- They were generated without the scorecard prompt_template, so the business
-- context was wrong (e.g. selling houses instead of capturing properties).
-- Next visit to Mi Speech will re-generate with the correct scorecard context.

DELETE FROM speech_versions WHERE is_provisional = true;
