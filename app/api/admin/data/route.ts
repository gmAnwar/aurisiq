import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function GET(req: Request) {
  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY no está configurado en el entorno del servidor" },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userRes, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerRow, error: callerErr } = await admin
      .from("users")
      .select("role")
      .eq("id", userRes.user.id)
      .single();
    if (callerErr || callerRow?.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden — super_admin only" }, { status: 403 });
    }

    // Fetch all collections with service role (bypasses RLS)
    const [orgsRes, usersRes, analysesRes, speechRes] = await Promise.all([
      admin
        .from("organizations")
        .select("id, name, slug, plan, analyses_count, analyses_limit, access_status, invite_token, role_label_vendedor")
        .order("created_at", { ascending: false }),
      admin
        .from("users")
        .select("id, name, email, role, organization_id, active, training_mode, created_at")
        .order("created_at", { ascending: false }),
      admin
        .from("analyses")
        .select("id, organization_id, user_id, score_general, clasificacion, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("speech_versions")
        .select("id, organization_id, version_number, published, created_at, content")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    return NextResponse.json({
      ok: true,
      orgs: orgsRes.data || [],
      users: usersRes.data || [],
      analyses: analysesRes.data || [],
      speech_versions: speechRes.data || [],
      errors: {
        orgs: orgsRes.error?.message || null,
        users: usersRes.error?.message || null,
        analyses: analysesRes.error?.message || null,
        speech_versions: speechRes.error?.message || null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
