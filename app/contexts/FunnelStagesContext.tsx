"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "../../lib/supabase";

export interface FunnelStage {
  id: string;
  stage_type: "llamada" | "visita" | "cierre";
  active: boolean;
  organization_id: string;
}

interface FunnelStagesContextValue {
  funnelStages: FunnelStage[];
  loading: boolean;
  error: Error | null;
}

const FunnelStagesContext = createContext<FunnelStagesContextValue>({
  funnelStages: [],
  loading: false,
  error: null,
});

export function FunnelStagesProvider({
  organizationId,
  children,
}: {
  organizationId: string | null | undefined;
  children: ReactNode;
}) {
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState<boolean>(!!organizationId);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!organizationId) {
      setFunnelStages([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from("funnel_stages")
      .select("id, stage_type, active, organization_id")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(error as unknown as Error);
          setFunnelStages([]);
        } else {
          setFunnelStages((data ?? []) as FunnelStage[]);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return (
    <FunnelStagesContext.Provider value={{ funnelStages, loading, error }}>
      {children}
    </FunnelStagesContext.Provider>
  );
}

export function useFunnelStages(): FunnelStagesContextValue {
  return useContext(FunnelStagesContext);
}
