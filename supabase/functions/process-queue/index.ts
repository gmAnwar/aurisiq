import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const workerId = crypto.randomUUID();
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Claim up to 3 pending jobs atomically
  const { data: jobs, error } = await db.rpc("claim_next_jobs", {
    p_limit: 3,
    p_worker_id: workerId,
  });

  if (error) {
    console.error(`[process-queue] claim_next_jobs error: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const claimed = jobs?.length ?? 0;
  console.log(`[process-queue] worker=${workerId.slice(0, 8)} claimed=${claimed}`);

  if (claimed > 0) {
    // Fire-and-forget: invoke analyze for each job, don't await
    const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze`;
    for (const job of jobs) {
      fetch(analyzeUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id: job.id }),
      }).catch((err) => {
        console.error(`[process-queue] Failed to invoke analyze for job ${job.id}: ${err.message}`);
      });
    }
  }

  return new Response(JSON.stringify({ claimed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
