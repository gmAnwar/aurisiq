export const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";

export const CLAUDE_MODEL = "claude-sonnet-4-20250514";
export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const CLAUDE_MAX_TOKENS = 4096;

export const TIER_LIMITS: Record<string, number | null> = {
  free: 10,
  starter: 50,
  growth: 500,
  pro: 2000,
  scale: 10000,
  enterprise: null,
  founder: 50,
};
