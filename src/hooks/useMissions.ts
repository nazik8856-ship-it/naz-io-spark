import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ocWrite } from "@/lib/encrypted-write"; // encrypted content is written through the server (data encryption, front 3)
import { ocRead } from "@/lib/outer-control-read"; // encrypted content is read through the server (data encryption, front 3)

export interface Mission {
  id: string;
  directive: string;
  attachment_urls: string[];
  status: string;
  created_at: string;
}

export function useMissions() {
  const { user } = useAuth();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMissions = async () => {
    if (!user) {
      setMissions([]);
      setLoading(false);
      return;
    }

    const { data, error } = await ocRead("missions")
      .select("id, directive, attachment_urls, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!error && data) {
      setMissions(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMissions();
  }, [user]);

  const saveMission = async (directive: string, attachmentUrls: string[]) => {
    if (!user) return null;

    const { data, error } = await ocWrite("missions")
      .insert({
        user_id: user.id,
        directive,
        attachment_urls: attachmentUrls,
        status: "completed",
      })
      .select("*")
      .single();

    if (!error && data) {
      setMissions((prev) => [data, ...prev].slice(0, 10));
    }

    return { data, error };
  };

  return { missions, loading, saveMission, refetch: fetchMissions };
}
