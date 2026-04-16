"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { computeEditPercentage } from "../../../lib/text";
import { useRecording } from "../../contexts/RecordingContext";
import MobileSelect from "../../components/MobileSelect";

interface GuideField { field_name: string; phrases: string[]; }
interface GuidePhase { phase_name: string; transition?: string; fields?: GuideField[]; phrases?: string[]; }

interface LeadSource {
  id: string;
  name: string;
  active: boolean;
}

type Status = "idle" | "analyzing" | "error";

interface FunnelStage {
  id: string;
  name: string;
  scorecard_id: string | null;
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

interface ChecklistField { slug: string; label: string; }

export default function NuevaLlamadaPage() {
  const rec = useRecording();

  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [orgVertical, setOrgVertical] = useState<string>("");
  const [checklistFields, setChecklistFields] = useState<ChecklistField[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const [stageNoScorecard, setStageNoScorecard] = useState(false);
  const [stageNoSpeech, setStageNoSpeech] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [prospectPhone, setProspectPhone] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileMsg, setFileMsg] = useState("");
  const [method, setMethod] = useState<"none" | "record" | "upload" | "paste">("none");
  const [checkedItems, setCheckedItems] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(sessionStorage.getItem("c2_checked_items") || "[]")); } catch { return new Set(); }
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionOriginal, setTranscriptionOriginal] = useState<string | null>(null);
  const [transcriptionSource, setTranscriptionSource] = useState<"manual" | "audio">("manual");
  const [editPct, setEditPct] = useState(0);

  const [mobile, setMobile] = useState(false);
  const [analysisPct, setAnalysisPct] = useState(0);
  const [analysisPhase, setAnalysisPhase] = useState("");
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePhases, setGuidePhases] = useState<GuidePhase[]>([]);
  const [guideLoading, setGuideLoading] = useState(false);
  const [missedFields, setMissedFields] = useState<string[]>([]);
  const [dailyTarget, setDailyTarget] = useState<number | null>(null);
  const [dailyDone, setDailyDone] = useState(0);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const wordCount = transcription.trim().split(/\s+/).filter(Boolean).length;
  const MIN_WORDS = transcriptionSource === "audio" ? 50 : 200;

  const TRANSCRIPT_LIMITS = {
    presencial: { maxChars: 40000, maxRecordingMin: 50, warnAtChars: 25000 },
    telefonica: { maxChars: 20000, maxRecordingMin: 25, warnAtChars: 12000 },
  } as const;

  const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm", ".mp4"];
  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  // ─── Consume transcription result from recording context ──
  useEffect(() => {
    if (rec.transcriptionResult) {
      setTranscription(rec.transcriptionResult.text);
      setTranscriptionOriginal(rec.transcriptionResult.original);
      setTranscriptionSource("audio");
      setEditPct(0);
      setFileMsg(rec.transcriptionResult.message);
      rec.clearTranscriptionResult();
    }
  }, [rec.transcriptionResult]);

  // ─── File upload transcription (independent of recording) ─
  const transcribeAudioBlob = async (blob: Blob, label?: string) => {
    if (blob.size < 1024) {
      setFileMsg("La grabación es muy corta. Intenta con un audio más largo.");
      return;
    }
    if (blob.size > 25 * 1024 * 1024) {
      setFileMsg("El audio excede 25MB. Intenta con un archivo más corto.");
      return;
    }
    setIsTranscribing(true);
    setFileMsg(label || "Transcribiendo audio...");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transcribe", audio_base64: base64, organization_id: orgId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Normalize legacy worker size errors to the current 25MB limit
        const raw = (data.error as string) || "";
        if (/audio exceeds/i.test(raw)) {
          throw new Error("El audio excede 25MB. Intenta con un archivo más corto.");
        }
        throw new Error(raw || "No pudimos transcribir el audio. Intenta grabar de nuevo en un lugar con menos ruido.");
      }

      let text = data.text || "";
      const textWords = text.trim().split(/\s+/).filter(Boolean).length;

      if (textWords === 0) {
        setFileMsg("No pudimos transcribir el audio. Intenta grabar de nuevo en un lugar con menos ruido.");
        setIsTranscribing(false);
        return;
      } else {
        setFileMsg("Transcripción automática lista — revisa antes de analizar.");
      }

      const maxC = (isPresencial ? TRANSCRIPT_LIMITS.presencial : TRANSCRIPT_LIMITS.telefonica).maxChars;
      if (text.length > maxC) {
        text = text.slice(0, maxC);
        setFileMsg(`La transcripción es muy larga. Se mostrarán los primeros ${maxC.toLocaleString()} caracteres.`);
      }

      setTranscription(text);
      setTranscriptionOriginal(text);
      setTranscriptionSource("audio");
      setEditPct(0);
      sessionStorage.setItem("c2_transcription", text);
      sessionStorage.setItem("c2_original", text);
      sessionStorage.setItem("c2_source_type", "audio");
    } catch (err) {
      setFileMsg(err instanceof Error ? err.message : "No pudimos transcribir el audio. Intenta grabar de nuevo en un lugar con menos ruido.");
    }
    setIsTranscribing(false);
  };

  const extractTextFromFile = async (file: File) => {
    setFileMsg("");
    const name = file.name.toLowerCase();

    if (AUDIO_EXTENSIONS.some(ext => name.endsWith(ext))) {
      await transcribeAudioBlob(file, `Transcribiendo "${file.name}"...`);
      return;
    }

    const FILE_CHAR_LIMIT = (isPresencial ? TRANSCRIPT_LIMITS.presencial : TRANSCRIPT_LIMITS.telefonica).maxChars;
    if (name.endsWith(".txt")) {
      const text = await file.text();
      if (text.length > FILE_CHAR_LIMIT) {
        setFileMsg(`El archivo tiene ${text.length.toLocaleString()} caracteres (máximo ${FILE_CHAR_LIMIT.toLocaleString()}).`);
        return;
      }
      setTranscription(text);
      setFileMsg(`Archivo "${file.name}" cargado.`);
    } else if (name.endsWith(".doc") || name.endsWith(".docx")) {
      const text = await file.text();
      const cleaned = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned.length > FILE_CHAR_LIMIT) {
        setFileMsg(`El texto extraído tiene ${cleaned.length.toLocaleString()} caracteres (máximo ${FILE_CHAR_LIMIT.toLocaleString()}).`);
        return;
      }
      if (cleaned.length < 50) {
        setFileMsg("No se pudo extraer texto del archivo. Intenta con un .txt.");
        return;
      }
      setTranscription(cleaned);
      setFileMsg(`Archivo "${file.name}" cargado.`);
    } else {
      setFileMsg("Formato no soportado. Usa .txt, .doc, .docx, .mp3, .m4a, .wav u .ogg.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (status === "analyzing") return;
    const file = e.dataTransfer.files?.[0];
    if (file) extractTextFromFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) extractTextFromFile(file);
    e.target.value = "";
  };
  // Stage is optional: Claude auto-detects it from the transcription
  // when the user leaves it blank. User can still choose a stage manually.
  const missingConfig = leadSources.length === 0 && !loading;
  // Everything is presencial except financiero
  const isPresencial = orgVertical !== "" && orgVertical !== "financiero";

  // Unique scorecards from funnel stages (for multi-scorecard presencial toggle)
  const uniqueScorecards = funnelStages
    .filter(s => s.scorecard_id)
    .reduce<{ id: string; name: string; stageId: string }[]>((acc, s) => {
      if (!acc.some(x => x.id === s.scorecard_id)) acc.push({ id: s.scorecard_id!, name: s.name, stageId: s.id });
      return acc;
    }, []);
  const isMultiScorecard = isPresencial && uniqueScorecards.length >= 2;
  const needsStageChoice = isMultiScorecard && !selectedStage;

  const charCount = transcription.length;
  const limits = isPresencial ? TRANSCRIPT_LIMITS.presencial : TRANSCRIPT_LIMITS.telefonica;
  const CHAR_LIMIT = limits.maxChars;
  const canSubmit = (isPresencial ? !needsStageChoice : (selectedSource !== "" && !missingConfig)) && wordCount >= MIN_WORDS && charCount <= CHAR_LIMIT && status === "idle" && !isTranscribing && !stageNoScorecard;

  useEffect(() => {
    setMobile(isMobile());
    async function init() {
      // Allow training_mode users (direccion / gerente / super_admin)
      // to use C2 as captadora without being redirected. session.role
      // already reflects the effective role from getSession (training
      // override applied there).
      const session = await requireAuth(["captadora", "super_admin", "gerente", "direccion"]);
      if (!session) return;

      // session.organizationId is already the effective org (super_admin
      // override is applied in getSession). No need to read localStorage
      // here — it was causing non-super_admin users to pick up a stale
      // admin_active_org_id and blow up RLS on lead_sources/funnel_stages.
      const effectiveOrgId = session.organizationId;
      setUserId(session.userId);
      setOrgId(effectiveOrgId);
      setIsSuperAdmin(session.realRoles.includes("super_admin"));

      // Unconditional fetch. RLS handles org scoping — no frontend
      // role gate. Drop `active` filter so inactive-but-not-deleted
      // sources still appear while the gerente is configuring them.
      const [sourcesRes, stagesRes] = await Promise.all([
        supabase.from("lead_sources").select("id, name, active")
          .eq("organization_id", effectiveOrgId).order("name"),
        supabase.from("funnel_stages").select("id, name, scorecard_id")
          .eq("organization_id", effectiveOrgId).eq("active", true).order("order_index"),
      ]);

      const { data: sourcesRaw, error } = sourcesRes;
      const sources = (sourcesRaw || []).filter(s => s.active !== false);
      setFunnelStages(stagesRes.data || []);

      // Vertical + checklist now loaded reactively via useEffect on selectedStage

      if (error) {
        setErrorMsg("No pudimos cargar las fuentes de lead. Intenta de nuevo.");
      } else {
        setLeadSources(sources || []);
      }

      setLoading(false);

      // Monthly progress counter
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const [objRes, monthRes] = await Promise.all([
        supabase.from("objectives").select("target_value")
          .eq("organization_id", effectiveOrgId).eq("is_active", true)
          .eq("type", "volume").in("period_type", ["monthly"])
          .or(`target_user_id.eq.${session.userId},target_user_id.is.null`)
          .order("target_user_id", { ascending: false, nullsFirst: false })
          .limit(1),
        supabase.from("analyses").select("id")
          .eq("user_id", session.userId).eq("organization_id", effectiveOrgId).eq("status", "completado")
          .gte("created_at", monthStart),
      ]);
      if (objRes.data && objRes.data.length > 0) {
        setDailyTarget(objRes.data[0].target_value);
      }
      setDailyDone(monthRes.data?.length || 0);

      // Restore draft from sessionStorage
      const savedText = sessionStorage.getItem("c2_transcription");
      const savedStage = sessionStorage.getItem("c2_stage");
      const savedSource = sessionStorage.getItem("c2_source");
      const savedNotes = sessionStorage.getItem("c2_notes");
      const savedPhone = sessionStorage.getItem("c2_phone");
      const savedOriginal = sessionStorage.getItem("c2_original");
      const savedSrc = sessionStorage.getItem("c2_source_type");
      if (savedText) setTranscription(savedText);
      if (savedStage) setSelectedStage(savedStage);
      if (savedSource) setSelectedSource(savedSource);
      if (savedNotes) setNotes(savedNotes);
      if (savedPhone) setProspectPhone(savedPhone);
      const savedCallNotes = sessionStorage.getItem("c2_call_notes");
      if (savedCallNotes) setCallNotes(savedCallNotes);
      if (savedOriginal) {
        setTranscriptionOriginal(savedOriginal);
        setTranscriptionSource((savedSrc as "manual" | "audio") || "manual");
      }
    }

    init();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Track edits to auto-transcribed text
  const handleTranscriptionChange = useCallback((value: string) => {
    setTranscription(value);
    sessionStorage.setItem("c2_transcription", value);
    if (transcriptionSource === "audio" && transcriptionOriginal) {
      const pct = computeEditPercentage(transcriptionOriginal, value);
      setEditPct(pct);
    }
  }, [transcriptionSource, transcriptionOriginal]);

  // ─── Waveform drawing (uses analyserNode from context) ────

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = rec.analyserNode;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const barCount = 32;
      const barWidth = Math.floor(w / barCount) - 2;
      const step = Math.floor(bufferLength / barCount);
      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255;
        const barHeight = Math.max(2, value * h * 0.85);
        const x = i * (barWidth + 2);
        const y = (h - barHeight) / 2;
        ctx.fillStyle = value > 0.4 ? "#c87840" : "rgba(200,120,64,0.3)";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };
    draw();
  }, [rec.analyserNode]);

  useEffect(() => {
    if (rec.recMode === "recording" && rec.analyserNode && canvasRef.current) {
      drawWaveform();
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [rec.recMode, rec.analyserNode, drawWaveform]);

  // ─── Guide drawer ──────────────────────────────────────────

  const openGuide = async () => {
    if (!selectedStage || !orgId) return;
    setGuideOpen(true);
    if (guidePhases.length > 0) return;
    setGuideLoading(true);

    // Get speech for this stage, filtered by scorecard to avoid cross-scorecard contamination
    const stage = funnelStages.find(s => s.id === selectedStage);
    let speechQuery = supabase.from("speech_versions")
      .select("content")
      .eq("organization_id", orgId)
      .or("published.eq.true,is_provisional.eq.true")
      .eq("funnel_stage_id", selectedStage)
      .order("published", { ascending: false })
      .limit(1);
    if (stage?.scorecard_id) speechQuery = speechQuery.eq("scorecard_id", stage.scorecard_id);
    let { data } = await speechQuery;

    // Fallback: org-wide speech (funnel_stage_id is NULL)
    if (!data || data.length === 0) {
      let fallbackQuery = supabase.from("speech_versions")
        .select("content")
        .eq("organization_id", orgId)
        .or("published.eq.true,is_provisional.eq.true")
        .is("funnel_stage_id", null)
        .order("published", { ascending: false })
        .limit(1);
      if (stage?.scorecard_id) fallbackQuery = fallbackQuery.eq("scorecard_id", stage.scorecard_id);
      data = (await fallbackQuery).data;
    }

    if (data && data.length > 0) {
      const content = data[0].content as unknown;
      setGuidePhases(parseGuideContent(content));
    }
    setGuideLoading(false);
  };

  // Parse speech content into guide phases — supports multiple formats
  function parseGuideContent(content: unknown): GuidePhase[] {
    if (!content) return [];

    // Root-level array: [{phase_name, frases|phrases, ...}]
    if (Array.isArray(content)) {
      return (content as Array<Record<string, unknown>>).map(p => ({
        phase_name: (p.phase_name as string) || (p.phase_id as string) || "",
        transition: (p.transition as string) || "",
        fields: (p.fields as GuideField[]) || [],
        phrases: Array.isArray(p.frases) ? (p.frases as string[]) : Array.isArray(p.phrases) ? (p.phrases as string[]) : [],
      }));
    }

    const c = content as Record<string, unknown>;
    if (Array.isArray(c.phases)) {
      return (c.phases as Array<Record<string, unknown>>).map(p => ({
        phase_name: (p.phase_name as string) || "",
        transition: (p.transition as string) || "",
        fields: (p.fields as GuideField[]) || [],
        phrases: Array.isArray(p.frases) ? (p.frases as string[]) : Array.isArray(p.phrases) ? (p.phrases as string[]) : [],
      }));
    }

    return Object.entries(c).map(([name, phrases]) => ({
      phase_name: name,
      phrases: Array.isArray(phrases) ? phrases as string[] : [],
    }));
  }

  // Load vertical from organization (not scorecard)
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      try {
        const { data } = await supabase.from("organizations").select("vertical").eq("id", orgId).single();
        if (data?.vertical) setOrgVertical(data.vertical);
      } catch { /* ignore */ }
    })();
  }, [orgId]);

  // Reload checklist from stage_checklist_items when stage changes
  useEffect(() => {
    if (!selectedStage) {
      setChecklistFields([]);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from("stage_checklist_items")
          .select("label")
          .eq("funnel_stage_id", selectedStage)
          .eq("active", true)
          .order("sort_order");
        setChecklistFields((data || []).map(d => ({ slug: d.label.toLowerCase().replace(/\s+/g, "_"), label: d.label })));
      } catch { setChecklistFields([]); }
    })();
  }, [selectedStage]);

  // Reload speech when stage or org changes — 2-step priority:
  // 1. Published speech for the specific stage
  // 2. Published global speech (funnel_stage_id IS NULL)
  useEffect(() => {
    setGuidePhases([]);
    setStageNoScorecard(false);
    setStageNoSpeech(false);
    if (!orgId) return;
    let cancelled = false;
    const stage = funnelStages.find(s => s.id === selectedStage);

    // Check: stage selected but no scorecard
    if (selectedStage && stage && !stage.scorecard_id) {
      setStageNoScorecard(true);
      return;
    }

    (async () => {
      try {
        let data: { content: unknown }[] | null = null;

        if (selectedStage) {
          let q1 = supabase.from("speech_versions").select("content")
            .eq("organization_id", orgId).eq("published", true)
            .eq("funnel_stage_id", selectedStage).limit(1);
          if (stage?.scorecard_id) q1 = q1.eq("scorecard_id", stage.scorecard_id);
          data = (await q1)?.data ?? null;
        }

        if (!data?.length) {
          let q2 = supabase.from("speech_versions").select("content")
            .eq("organization_id", orgId).eq("published", true)
            .is("funnel_stage_id", null).limit(1);
          if (stage?.scorecard_id) q2 = q2.eq("scorecard_id", stage.scorecard_id);
          data = (await q2)?.data ?? null;
        }

        if (cancelled) return;
        if (data?.length && data[0]?.content) {
          setGuidePhases(parseGuideContent(data[0].content as unknown));
        } else if (selectedStage) {
          setStageNoSpeech(true);
        }
      } catch { /* ignore — guidePhases stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [selectedStage, orgId, funnelStages]);

  // Fetch missed fields from last 5 analyses for this stage
  useEffect(() => {
    if (!selectedStage || !userId) { setMissedFields([]); return; }
    (async () => {
      const { data } = await supabase.from("analyses")
        .select("checklist_results")
        .eq("user_id", userId)
        .eq("funnel_stage_id", selectedStage)
        .eq("status", "completado")
        .not("checklist_results", "is", null)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!data || data.length === 0) { setMissedFields([]); return; }

      const missCounts: Record<string, number> = {};
      for (const a of data) {
        const items = a.checklist_results as { field: string; covered: boolean }[] | null;
        if (!items) continue;
        for (const item of items) {
          if (!item.covered) missCounts[item.field] = (missCounts[item.field] || 0) + 1;
        }
      }

      const sorted = Object.entries(missCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .filter(([, count]) => count >= 2)
        .map(([field]) => field);

      setMissedFields(sorted);
    })();
  }, [selectedStage, userId]);

  // Clear irrelevant fields for presencial verticals
  useEffect(() => {
    if (!isPresencial) return;
    setSelectedSource("");
    setProspectPhone("");
    sessionStorage.removeItem("c2_source");
    sessionStorage.removeItem("c2_phone");
    // Only clear stage if single-scorecard (multi-scorecard needs user choice)
    if (uniqueScorecards.length < 2) {
      setSelectedStage("");
      sessionStorage.removeItem("c2_stage");
    }
  }, [isPresencial, uniqueScorecards.length]);

  // ─── Submit ────────────────────────────────────────────────

  // ─── Shared: resolve scorecard before submit ──────────────
  // Rule: 1 funnel_stage = 1 scorecard. Always derive from stage first.
  const resolveScorecard = async (submitOrgId: string): Promise<string> => {
    // 1. If a stage is selected, use its mapped scorecard_id (canonical path)
    if (selectedStage) {
      const stage = funnelStages.find(s => s.id === selectedStage);
      if (stage?.scorecard_id) return stage.scorecard_id;
    }

    // 2. Multi-scorecard org without stage = hard error (never guess)
    if (uniqueScorecards.length >= 2) {
      throw new Error("Selecciona una etapa antes de analizar");
    }

    // 3. Fallback: single-scorecard org, no stage — pick the org's active scorecard
    if (isSuperAdmin) {
      const { data: { session: s } } = await supabase.auth.getSession();
      const token = s?.access_token;
      const scRes = await fetch(`/api/admin/scorecard?organization_id=${encodeURIComponent(submitOrgId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const scBody = await scRes.json();
      if (!scRes.ok || !scBody.scorecard?.id) throw new Error("scorecard");
      return scBody.scorecard.id;
    }
    const { data: scorecard } = await supabase
      .from("scorecards")
      .select("id")
      .eq("organization_id", submitOrgId)
      .eq("active", true)
      .limit(1)
      .single();
    if (!scorecard) throw new Error("scorecard");
    return scorecard.id;
  };

  // ─── Shared: clear session storage after redirect ────────
  const clearSessionData = () => {
    sessionStorage.removeItem("c2_transcription");
    sessionStorage.removeItem("c2_stage");
    sessionStorage.removeItem("c2_source");
    sessionStorage.removeItem("c2_notes");
    sessionStorage.removeItem("c2_call_notes");
    sessionStorage.removeItem("c2_phone");
    sessionStorage.removeItem("c2_original");
    sessionStorage.removeItem("c2_source_type");
    sessionStorage.removeItem("c2_checked_items");
  };

  // ─── Shared: redirect to analysis result ─────────────────
  const redirectToResult = async (analysisId: string) => {
    setAnalysisPct(100);
    setAnalysisPhase("Listo — redirigiendo a resultados...");
    if (!selectedStage) {
      try {
        const { data: a } = await supabase
          .from("analyses")
          .select("funnel_stage_id")
          .eq("id", analysisId)
          .maybeSingle();
        if (a?.funnel_stage_id) setSelectedStage(a.funnel_stage_id);
      } catch { /* ignore */ }
    }
    setTimeout(() => {
      clearSessionData();
      window.location.href = `/analisis/${analysisId}`;
    }, 600);
  };

  // ─── Path A: Cloudflare Worker (existing, flag=false) ────
  const submitViaWorker = async (submitOrgId: string, scorecardId: string) => {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcription: transcription.trim(),
        scorecard_id: scorecardId,
        user_id: userId,
        organization_id: submitOrgId,
        fuente_lead_id: selectedSource,
        funnel_stage_id: selectedStage || null,
        prospect_phone: prospectPhone.trim() || null,
        transcription_original: transcriptionOriginal,
        transcription_edited: transcriptionSource === "audio" && transcriptionOriginal && transcription.trim() !== transcriptionOriginal
          ? transcription.trim() : null,
        edit_percentage: transcriptionOriginal && transcription.trim() !== transcriptionOriginal
          ? editPct : 0,
        call_notes: callNotes.trim() || null,
        has_audio: transcriptionSource === "audio",
        pause_count: rec.pauseCount,
        total_paused_seconds: rec.totalPausedSecs,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 429) throw new Error("quota");
      if (res.status === 403) throw new Error("readonly");
      throw new Error(data.error || "worker_error");
    }

    const analysisId = data.analysis_id;

    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await fetch(WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", analysis_id: analysisId, organization_id: submitOrgId }),
        });
        const statusData = await statusRes.json();

        if (statusData.status === "completado") {
          clearInterval(pollInterval);
          if (progressRef.current) clearInterval(progressRef.current);
          await redirectToResult(analysisId);
        } else if (statusData.status === "error") {
          clearInterval(pollInterval);
          if (progressRef.current) clearInterval(progressRef.current);
          setStatus("error");
          setErrorMsg(statusData.error_message || "Hubo un problema al analizar tu llamada. Intenta de nuevo.");
        }
      } catch {
        // Network error on poll — keep trying
      }
    }, 3000);

    setTimeout(() => {
      clearInterval(pollInterval);
      setStatus((current) => {
        if (current === "analyzing") {
          setErrorMsg("El análisis está tomando más tiempo de lo esperado. Intenta de nuevo en unos minutos.");
          return "error";
        }
        return current;
      });
    }, 120000);
  };

  // ─── Path B: Supabase Edge Function (flag=true) ──────────
  const submitViaEdgeFunction = async (submitOrgId: string, scorecardId: string) => {
    const { data: job, error: insertError } = await supabase
      .from("background_jobs")
      .insert({
        organization_id: submitOrgId,
        user_id: userId,
        type: "analysis",
        status: "pending",
        priority: 0,
        payload: {
          transcription_text: transcription.trim(),
          scorecard_id: scorecardId,
          funnel_stage_id: selectedStage || null,
          fuente_lead_id: selectedSource,
          prospect_phone: prospectPhone.trim() || null,
          transcription_original: transcriptionOriginal,
          transcription_edited: transcriptionSource === "audio" && transcriptionOriginal && transcription.trim() !== transcriptionOriginal
            ? transcription.trim() : null,
          edit_percentage: transcriptionOriginal && transcription.trim() !== transcriptionOriginal
            ? editPct : 0,
          call_notes: callNotes.trim() || null,
          has_audio: transcriptionSource === "audio",
          pause_count: rec.pauseCount,
          total_paused_seconds: rec.totalPausedSecs,
          avanzo_a_siguiente_etapa: "pending",
        },
      })
      .select("id")
      .single();

    if (insertError || !job) {
      throw new Error(insertError?.message || "No se pudo crear el job de análisis.");
    }

    const jobId = job.id;
    let softWarningShown = false;

    const pollInterval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from("background_jobs")
          .select("status, result, error_message")
          .eq("id", jobId)
          .single();

        if (data?.status === "completed") {
          clearInterval(pollInterval);
          if (progressRef.current) clearInterval(progressRef.current);
          const analysisId = (data.result as { analysis_id: string })?.analysis_id;
          if (analysisId) {
            await redirectToResult(analysisId);
          } else {
            setStatus("error");
            setErrorMsg("Análisis completado pero no se encontró el resultado. Revisa tu historial.");
          }
        } else if (data?.status === "error" || data?.status === "cancelled") {
          clearInterval(pollInterval);
          if (progressRef.current) clearInterval(progressRef.current);
          setStatus("error");
          setErrorMsg(data.error_message || "Hubo un problema al analizar tu llamada. Intenta de nuevo.");
        }
      } catch {
        // Network error on poll — keep trying
      }
    }, 3000);

    // Soft warning at 90s — don't kill anything
    setTimeout(() => {
      if (!softWarningShown) {
        softWarningShown = true;
        setAnalysisPhase("El análisis está tardando más de lo esperado. Puedes cerrar esta pantalla y revisar tu historial en unos minutos.");
      }
    }, 90000);

    // Hard timeout at 180s — stop polling, show error
    setTimeout(() => {
      clearInterval(pollInterval);
      setStatus((current) => {
        if (current === "analyzing") {
          if (progressRef.current) clearInterval(progressRef.current);
          setErrorMsg("Timeout esperando análisis. Consulta tu historial en unos minutos.");
          return "error";
        }
        return current;
      });
    }, 180000);
  };

  // ─── Main submit handler ─────────────────────────────────
  const handleSubmit = async () => {
    setSubmitAttempted(true);
    if (!canSubmit || !userId || !orgId) return;

    setStatus("analyzing");
    setErrorMsg("");
    setAnalysisPct(0);
    setAnalysisPhase("Enviando transcripción...");

    const phases = [
      { at: 0, text: "Enviando transcripción..." },
      { at: 15, text: "Analizando con IA..." },
      { at: 40, text: "Evaluando fases del scorecard..." },
      { at: 85, text: "Generando coaching personalizado..." },
      { at: 95, text: "Listo — redirigiendo a resultados..." },
    ];
    let pct = 0;
    const startTime = Date.now();
    progressRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      pct = Math.min(94, Math.floor(elapsed * 1.2));
      if (elapsed > 60) setAnalysisPhase("Tomando más de lo esperado...");
      else {
        const current = [...phases].reverse().find(p => pct >= p.at);
        if (current) setAnalysisPhase(current.text);
      }
      setAnalysisPct(pct);
    }, 500);

    try {
      const submitOrgId = orgId;
      const scorecardId = await resolveScorecard(submitOrgId);

      const useEdgeFunction = process.env.NEXT_PUBLIC_USE_EDGE_FUNCTION === "true";
      if (useEdgeFunction) {
        await submitViaEdgeFunction(submitOrgId, scorecardId);
      } else {
        await submitViaWorker(submitOrgId, scorecardId);
      }
    } catch (err: unknown) {
      if (progressRef.current) clearInterval(progressRef.current);
      setStatus("error");
      const message = err instanceof Error ? err.message : "error";
      if (message === "scorecard") {
        setErrorMsg("Tu organización aún no tiene un scorecard configurado. Contacta a tu gerente.");
      } else if (message === "quota") {
        setErrorMsg("Se alcanzó el límite de análisis del mes. Contacta a tu gerente para actualizar el plan.");
      } else if (message === "readonly") {
        setErrorMsg("Tu organización está en modo lectura. Contacta a tu gerente.");
      } else {
        setErrorMsg("No pudimos procesar tu llamada. Intenta de nuevo.");
      }
    }
  };

  const handleRetry = () => {
    setStatus("idle");
    setErrorMsg("");
  };

  if (loading) {
    return (
      <div className="container c2-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-select" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-button" />
      </div>
    );
  }

  // ─── Recording UI (replaces form while active) ─────────────

  if (rec.recMode !== "off") {
    return (
      <div className="container ear-container">
        {(rec.recMode === "recording" || rec.recMode === "paused") && (
          <div className="ear-recording">
            <div className="ear-rec-indicator">
              <span className="ear-rec-dot" style={rec.recMode === "paused" ? { animation: "none", opacity: 0.3 } : undefined} />
              <span className="ear-rec-label">{rec.recMode === "paused" ? "En pausa" : rec.recLabel}</span>
            </div>
            <span className="ear-timer">{formatTime(rec.recElapsed)}</span>
            <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
            {rec.recElapsed > 1800 && (
              <p className="ear-long-warning">Llevas más de 30 minutos grabando. Transcripciones muy largas pueden tardar más en analizar.</p>
            )}
            {rec.pauseCount > 0 && (
              <span className="ear-pause-info">{rec.pauseCount} pausa{rec.pauseCount > 1 ? "s" : ""}</span>
            )}
            <div className="ear-btn-row">
              {rec.recMode === "recording" ? (
                <button className="ear-pause-btn" onClick={rec.pauseRecording}>Pausar</button>
              ) : (
                <button className="ear-resume-btn" onClick={rec.resumeRecording}>Continuar</button>
              )}
              <button className="ear-stop-btn" onClick={rec.stopRecording}>
                Terminar llamada
              </button>
            </div>
            <button className="ear-retry-btn" onClick={rec.cancelRecording}>
              Cancelar
            </button>
          </div>
        )}

        {/* Notes during recording */}
        {(rec.recMode === "recording" || rec.recMode === "paused") && (
          <div style={{ width: "100%", maxWidth: 400, marginTop: 16 }}>
            <textarea
              className="input-field"
              rows={3}
              placeholder="Notas de la llamada..."
              value={callNotes}
              onChange={(e) => { setCallNotes(e.target.value); sessionStorage.setItem("c2_call_notes", e.target.value); }}
              style={{ fontSize: 13, resize: "vertical" }}
            />
          </div>
        )}

        {/* Checklist during recording */}
        {(rec.recMode === "recording" || rec.recMode === "paused") && checklistFields.length > 0 && (
          <details style={{ width: "100%", maxWidth: 400, marginTop: 12, border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, overflow: "hidden" }}>
            <summary style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between" }}>
              Checklist <span style={{ color: "var(--ink-light)", fontWeight: 400 }}>{checkedItems.size}/{checklistFields.length}</span>
            </summary>
            <div style={{ padding: "8px 14px 12px", fontSize: 13 }}>
              {(() => {
                const toggle = (slug: string) => {
                  const next = new Set(checkedItems);
                  if (next.has(slug)) next.delete(slug); else next.add(slug);
                  setCheckedItems(next);
                  sessionStorage.setItem("c2_checked_items", JSON.stringify([...next]));
                };
                return (
                  <div style={{ columns: 2, columnGap: 16 }}>
                    {checklistFields.map((f) => (
                      <label key={f.slug} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, cursor: "pointer" }}>
                        <input type="checkbox" checked={checkedItems.has(f.slug)} onChange={() => toggle(f.slug)} style={{ accentColor: "var(--accent)", flexShrink: 0 }} />
                        <span style={{ color: checkedItems.has(f.slug) ? "var(--ink-light)" : "var(--ink)", textDecoration: checkedItems.has(f.slug) ? "line-through" : "none" }}>
                          {f.label}
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })()}
            </div>
          </details>
        )}

        {/* Speech visible during recording — collapsible phases */}
        {(rec.recMode === "recording" || rec.recMode === "paused") && guidePhases.length > 0 && (
          <div style={{ width: "100%", maxWidth: 400, marginTop: 12, border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, overflow: "hidden" }}>
            {guidePhases.map((phase, i) => (
              <details key={i} open={i === 0} className="g5-speech-phase">
                <summary className="g5-speech-phase-summary">
                  <span className="g5-phase-number">{i + 1}</span>
                  <span className="g5-phase-name">{phase.phase_name}</span>
                  <svg className="g5-phase-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </summary>
                <div className="g5-speech-phase-body">
                  {phase.transition && <p className="c5-transition">{phase.transition}</p>}
                  {phase.fields && phase.fields.length > 0 ? (
                    <div className="c5-fields">
                      {phase.fields.map((field, j) => (
                        <div key={j} style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{field.field_name}:</span>
                          {field.phrases[0] && <p style={{ margin: "2px 0 0 10px", fontSize: 13 }}>{field.phrases[0]}</p>}
                        </div>
                      ))}
                    </div>
                  ) : phase.phrases && phase.phrases.length > 0 ? (
                    <p style={{ margin: "4px 0 0", fontSize: 13 }}>{phase.phrases[0]}</p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        )}
        {(rec.recMode === "recording" || rec.recMode === "paused") && guidePhases.length === 0 && selectedStage && (
          <p style={{ fontSize: 13, color: "var(--ink-light)", marginTop: 12, textAlign: "center" }}>Sin speech publicado para esta etapa</p>
        )}
        {rec.recMode === "transcribing" && (
          <div className="ear-recording">
            <div className="ear-rec-indicator">
              <span className="ear-rec-dot" style={{ animationDuration: "2s" }} />
              <span className="ear-rec-label">Procesando</span>
            </div>
            <span className="ear-timer">{formatTime(rec.recElapsed)}</span>
            <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
            <div className="c2-progress-section" style={{ width: "100%", maxWidth: 320 }}>
              <div className="c2-progress-bg">
                <div className="c2-progress-fill" style={{ width: `${rec.transcribePct}%` }} />
              </div>
              <p className="c2-progress-phase">{rec.transcribePhase}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Normal C2 form ────────────────────────────────────────

  return (
    <div className="container c2-container">
      {/* Draft banner */}
      {rec.hasDraft && (
        <div className="c2-draft-banner">
          <p className="c2-draft-text">Tienes una grabación pendiente</p>
          <div className="c2-draft-actions">
            <button className="c2-draft-btn c2-draft-use" onClick={() => orgId && rec.useDraft(orgId)}>Transcribir</button>
            <button className="c2-draft-btn c2-draft-discard" onClick={rec.deleteDraft}>Descartar</button>
          </div>
        </div>
      )}

      <div className="c2-header">
        {dailyTarget !== null && (
          <p className={`c2-daily-counter ${dailyDone >= dailyTarget ? "c2-daily-done" : ""}`}>
            {dailyDone >= dailyTarget
              ? `${dailyDone} de ${dailyTarget} este mes — objetivo cumplido`
              : `${dailyDone} de ${dailyTarget} este mes`}
          </p>
        )}
        <h1 className="c2-title">Nueva llamada</h1>
        <p className="c2-subtitle">Graba en vivo, sube un audio o pega la transcripción, aurisIQ se encarga del resto.</p>
        {isPresencial && (
          <p className="c2-subtitle" style={{ fontSize: 13, marginTop: 2 }}>Modo consulta — solo graba y analiza</p>
        )}
      </div>

      {/* Scorecard toggle for multi-scorecard presencial orgs */}
      {isMultiScorecard && (
        <div className="c2-scorecard-toggle">
          {uniqueScorecards.map(sc => (
            <button
              key={sc.id}
              type="button"
              className={`c2-toggle-pill${selectedStage === sc.stageId ? " c2-toggle-pill--active" : ""}`}
              onClick={() => { setSelectedStage(sc.stageId); sessionStorage.setItem("c2_stage", sc.stageId); }}
              disabled={status === "analyzing"}
            >
              {sc.name}
            </button>
          ))}
        </div>
      )}

      <div className="c2-form">
        {!isPresencial && (
        <>
        <div className="input-group">
          <label htmlFor="funnel-stage" className="input-label">
            Etapa del embudo <span style={{ fontWeight: 400, color: "var(--ink-light)" }}>(opcional — se detecta automáticamente)</span>
          </label>
          <MobileSelect
            value={selectedStage}
            onChange={(v) => { setSelectedStage(v); sessionStorage.setItem("c2_stage", v); }}
            placeholder="Detectar automáticamente"
            label="Etapa del embudo"
            disabled={status === "analyzing"}
            options={funnelStages.map(s => ({ value: s.id, label: s.name }))}
          />
          {stageNoScorecard && (
            <div className="message-box message-error" style={{ marginTop: 8 }}>
              <p>Esta etapa no está completamente configurada. Pídele a tu administrador que le asigne criterios de evaluación antes de grabar.</p>
            </div>
          )}
          {stageNoSpeech && !stageNoScorecard && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, fontSize: 13, color: "#92400e" }}>
              Esta etapa aún no tiene speech publicado. Puedes grabar pero no tendrás referencia durante la llamada.
            </div>
          )}
          {missedFields.length > 0 && !transcription && rec.recMode === "off" && (
            <p className="c2-missed-tip">En tus últimas llamadas se te olvidó preguntar: {missedFields.join(", ")}</p>
          )}
        </div>

        <div className="input-group">
          <label htmlFor="fuente-lead" className="input-label">
            Fuente del lead *
          </label>
          <MobileSelect
            value={selectedSource}
            onChange={(v) => { setSelectedSource(v); sessionStorage.setItem("c2_source", v); }}
            placeholder="Selecciona de dónde vino el prospecto"
            label="Fuente del lead"
            disabled={status === "analyzing"}
            error={submitAttempted && selectedSource === ""}
            options={leadSources.map(s => ({ value: s.id, label: s.name }))}
          />
          {submitAttempted && selectedSource === "" && (
            <p className="input-hint-error">Selecciona la fuente del lead para continuar</p>
          )}
          {leadSources.length === 0 && !errorMsg && !loading && (
            <div className="message-box message-error" style={{ marginTop: 8 }}>
              <p>Tu organización no tiene fuentes de lead configuradas. No puedes registrar llamadas hasta que tu gerente las configure en <strong>Configuración</strong>.</p>
            </div>
          )}
        </div>

        <div className="input-group">
          <label htmlFor="prospect-phone" className="input-label">
            WhatsApp del prospecto <span style={{ fontWeight: 400, color: "var(--ink-light)" }}>(opcional)</span>
          </label>
          <input
            id="prospect-phone"
            type="tel"
            inputMode="tel"
            className="input-field"
            value={prospectPhone}
            onChange={(e) => { setProspectPhone(e.target.value); sessionStorage.setItem("c2_phone", e.target.value); }}
            placeholder="+52 55 1234 5678"
            disabled={status === "analyzing"}
            autoComplete="tel"
          />
          <p className="c2-hint">Si lo dejas vacío, lo detectamos automáticamente de la transcripción.</p>
        </div>
        </>
        )}

        <div className="input-group">
          <label htmlFor="transcription" className="input-label">
            {isPresencial ? "Transcripción de la consulta *" : "Transcripción de la llamada *"}
          </label>
          <div
            className={`c2-drop-zone ${dragging ? "c2-drop-active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <textarea
              id="transcription"
              className="input-field c2-textarea"
              placeholder="Pega aquí la transcripción o arrastra un archivo de texto o audio"
              value={transcription}
              onChange={(e) => {
                if (e.target.value.length <= CHAR_LIMIT) {
                  handleTranscriptionChange(e.target.value);
                }
              }}
              disabled={status === "analyzing" || isTranscribing}
              rows={10}
            />
          </div>
          {transcriptionSource === "audio" && transcriptionOriginal && (
            <p className="c2-auto-banner">Transcripción automática — revisa antes de analizar</p>
          )}
          {editPct > 40 && (
            <p className="c2-edit-warning">Has editado una parte importante del texto ({editPct}%) — el análisis refleja tu versión.</p>
          )}
          {isTranscribing && (
            <div className="c2-transcribing">
              <span className="c2-transcribing-spinner" />
              Transcribiendo audio...
            </div>
          )}
          <div className="c2-char-count">
            <span className={wordCount < MIN_WORDS ? "c2-char-warning" : charCount > CHAR_LIMIT ? "c2-char-error" : charCount > limits.warnAtChars ? "c2-char-amber" : ""}>
              {wordCount} palabras{wordCount < MIN_WORDS ? ` (mínimo ${MIN_WORDS})` : ""} · {charCount.toLocaleString()} / {CHAR_LIMIT.toLocaleString()} caracteres
            </span>
            {charCount > limits.warnAtChars && charCount <= CHAR_LIMIT && (
              <span className="c2-char-amber" style={{ display: "block", fontSize: 11, marginTop: 2 }}>Transcripcion larga, analisis puede tardar 30-60s</span>
            )}
            {charCount > CHAR_LIMIT && (
              <span className="c2-char-error" style={{ display: "block", fontSize: 11, marginTop: 2 }}>Limite excedido — recorta la transcripcion para continuar</span>
            )}
          </div>
        </div>

        {/* Secondary input: record or upload */}
        <div className="c2-file-row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn-submit"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", fontSize: 14, fontWeight: 500 }}
            onClick={() => orgId && rec.startRecording(orgId)}
            disabled={status === "analyzing" || isTranscribing || transcription.length > 0}
            type="button"
          >
            {isPresencial ? "🎙️ Grabar consulta" : "🎙️ Grabar llamada"}
          </button>
          <label className="c2-file-btn">
            Buscar archivo
            <input type="file" accept=".txt,.doc,.docx,.mp3,.m4a,.wav,.ogg,.opus,.webm,.mp4,audio/ogg,audio/opus" onChange={handleFileInput} hidden disabled={status === "analyzing" || isTranscribing} />
          </label>
          {fileMsg && <span className="c2-file-msg">{fileMsg}</span>}
          {rec.recError && <p className="c2-rec-error">{rec.recError}</p>}
        </div>
        <p className="c2-rec-hint" style={{ marginTop: 4 }}>
          {isPresencial
            ? "Coloca el celular sobre la mesa o cerca y presiona grabar."
            : mobile
              ? "Pon tu llamada en altavoz y presiona grabar."
              : "Selecciona la pestaña de tu llamada cuando se abra el selector."}
        </p>
        {!isPresencial && (
          <button
            className="c2-guide-link"
            onClick={openGuide}
            disabled={!selectedStage}
            type="button"
          >
            {selectedStage ? "Ver mi guía antes de llamar" : "Selecciona una etapa para ver tu guía"}
          </button>
        )}

        {!isPresencial && (
        <div className="input-group">
          <label htmlFor="notes" className="input-label">
            Notas de contexto (opcional)
          </label>
          <textarea
            id="notes"
            className="input-field"
            placeholder="Ej: La grabación empezó al minuto 2, prospecto ya había hablado con otra captadora..."
            value={notes}
            onChange={(e) => { setNotes(e.target.value); sessionStorage.setItem("c2_notes", e.target.value); }}
            disabled={status === "analyzing"}
            rows={3}
            style={{ minHeight: 60, resize: "vertical" }}
          />
          <p className="c2-hint">Contexto adicional que ayude a interpretar mejor esta llamada.</p>
        </div>
        )}

        {/* Collapsible reference panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 1. Mi Speech — only shown when phases are loaded */}
          {guidePhases.length > 0 && (
          <div className="c2-collapse" style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, overflow: "hidden" }}>
            <div className="c2-collapse-summary" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 14 }}>Mi Speech</div>
            {guidePhases.map((phase, i) => (
              <details key={i} open={i === 0} className="c2-speech-phase">
                <summary className="c2-speech-phase-summary">{phase.phase_name}</summary>
                <div className="c2-speech-phase-body">
                  {phase.transition && <p className="c2-hint" style={{ margin: "0 0 6px" }}>{phase.transition}</p>}
                  {phase.phrases && phase.phrases.length > 0 && (
                    <SpeechPhraseSingle phrases={phase.phrases} storageKey={`${selectedStage}_${i}`} />
                  )}
                  {phase.fields && phase.fields.length > 0 && phase.fields.map((f, k) => (
                    <SpeechFieldSingle key={k} field={f} storageKey={`${selectedStage}_${i}`} />
                  ))}
                </div>
              </details>
            ))}
          </div>
          )}

          {/* 2. Checklist — full list with missed-field highlights (hidden in presencial pre-recording) */}
          {!isPresencial && (
          <details className="c2-collapse">
            <summary className="c2-collapse-summary">Checklist de referencia{checklistFields.length > 0 ? ` (${checklistFields.length} campos)` : ""}</summary>
            <div className="c2-collapse-body">
              {!selectedStage ? (
                <p className="c2-hint">Selecciona una etapa para ver su checklist, o se detectará automáticamente.</p>
              ) : checklistFields.length === 0 ? (
                <p className="c2-hint">Esta etapa no tiene checklist configurado.</p>
              ) : (() => {
                const missedSet = new Set(missedFields);
                const checked = checkedItems;
                const toggle = (slug: string) => {
                  const next = new Set(checked);
                  if (next.has(slug)) next.delete(slug); else next.add(slug);
                  setCheckedItems(next);
                  sessionStorage.setItem("c2_checked_items", JSON.stringify([...next]));
                };
                return (
                  <div style={{ fontSize: 13 }}>
                    <div style={{ fontSize: 11, color: "var(--ink-light)", marginBottom: 6 }}>{checked.size}/{checklistFields.length} marcados</div>
                    <div style={{ columns: 2, columnGap: 24 }}>
                      {checklistFields.map((f) => {
                        const isMissed = missedSet.has(f.label);
                        return (
                          <label key={f.slug} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, cursor: "pointer" }}>
                            <input type="checkbox" checked={checked.has(f.slug)} onChange={() => toggle(f.slug)} style={{ accentColor: "var(--accent)", flexShrink: 0 }} />
                            <span style={{ color: isMissed ? "var(--red, #ef4444)" : checked.has(f.slug) ? "var(--ink-light)" : "var(--ink)", textDecoration: checked.has(f.slug) ? "line-through" : "none" }}>
                              {isMissed && <span className="c2-checklist-warn">!</span>}{f.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </details>
          )}

          {/* 3. Notas de llamada (hidden in presencial pre-recording — available during recording) */}
          {!isPresencial && (
          <details className="c2-collapse">
            <summary className="c2-collapse-summary">Notas de llamada</summary>
            <div className="c2-collapse-body">
              <textarea
                className="input-field"
                placeholder="Escribe tus notas durante o después de la llamada..."
                value={callNotes}
                onChange={(e) => { setCallNotes(e.target.value); sessionStorage.setItem("c2_call_notes", e.target.value); }}
                disabled={status === "analyzing"}
                rows={4}
                style={{ resize: "vertical" }}
              />
              <p className="c2-hint">Estas notas se guardan con el análisis y son visibles en los resultados.</p>
            </div>
          </details>
          )}
        </div>

        {status === "analyzing" && (
          <div className="c2-progress-section">
            <div className="c2-progress-bg">
              <div className="c2-progress-fill" style={{ width: `${analysisPct}%` }} />
            </div>
            <p className="c2-progress-phase">{analysisPhase}</p>
          </div>
        )}

        {errorMsg && (
          <div className="message-box message-error">
            <p>{errorMsg}</p>
            {status === "error" && (
              <button className="c2-retry-btn" onClick={handleRetry}>
                Reintentar
              </button>
            )}
          </div>
        )}

        {status !== "analyzing" && (
          <button
            className="btn-submit btn-terracota"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Analizar
          </button>
        )}
      </div>

      {/* Guide drawer */}
      {guideOpen && (
        <>
          <div className="c2-guide-backdrop" onClick={() => setGuideOpen(false)} />
          <div className="c2-guide-drawer">
            <div className="c2-guide-header">
              <span className="c2-guide-title">Tu guía de llamada</span>
              <button className="c2-guide-close" onClick={() => setGuideOpen(false)}>&times;</button>
            </div>
            <div className="c2-guide-body">
              {guideLoading && <p className="c2-guide-loading">Cargando guía...</p>}
              {!guideLoading && guidePhases.length === 0 && (
                <p className="c2-guide-empty">No hay guía disponible para esta etapa.</p>
              )}
              {guidePhases.map((phase, i) => (
                <div key={i} className="c2-guide-phase">
                  <h3 className="c5-phase-name">{phase.phase_name}</h3>
                  {phase.transition && <p className="c5-transition">{phase.transition}</p>}
                  {phase.fields && phase.fields.length > 0 ? (
                    <div className="c5-fields">
                      {phase.fields.map((field, j) => (
                        <GuideFieldItem key={j} field={field} />
                      ))}
                    </div>
                  ) : phase.phrases && phase.phrases.length > 0 ? (
                    <ul className="c5-phrase-list">
                      {phase.phrases.map((ph, j) => <li key={j} className="c5-phrase">{ph}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// C2 recording: show 1 phrase per field with optional selector, persisted in localStorage
function SpeechFieldSingle({ field }: { field: { field_name: string; phrases: string[] }; storageKey: string }) {
  if (!field.phrases || field.phrases.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{field.field_name}:</span>
      <p style={{ margin: "2px 0 0 10px", fontSize: 13 }}>{field.phrases[0]}</p>
    </div>
  );
}

function SpeechPhraseSingle({ phrases }: { phrases: string[]; storageKey: string }) {
  if (!phrases || phrases.length === 0) return null;
  return <p style={{ margin: "4px 0 0 0", fontSize: 13 }}>{phrases[0]}</p>;
}

function GuideFieldItem({ field }: { field: { field_name: string; phrases: string[] } }) {
  const [expanded, setExpanded] = useState(false);
  if (!field.phrases || field.phrases.length === 0) return null;
  return (
    <div className="c5-field">
      <button className="c5-field-btn" onClick={() => setExpanded(!expanded)}>
        <span className="c5-field-name">{field.field_name}</span>
        <span className="c5-field-arrow">{expanded ? "\u2191" : "\u2193"}</span>
      </button>
      <p className="c5-field-phrase-main">{field.phrases[0]}</p>
      {expanded && field.phrases.length > 1 && (
        <div className="c5-field-alts">
          {field.phrases.slice(1).map((ph, i) => (
            <p key={i} className="c5-field-phrase-alt">{ph}</p>
          ))}
        </div>
      )}
    </div>
  );
}
