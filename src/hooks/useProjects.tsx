import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Updated Interface to match image_72d166.png
export interface Project {
  id: string;
  user_id: string;
  directive: string;
  status: string;
  created_at: string;
  updated_at: string;
  attachment_urls: string[] | null;
}

export function useProjects(userId: string | undefined) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchProjects = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    // FETCHING FROM MISSIONS TABLE
    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("FETCH_ERROR:", error);
      toast({ title: "Failed to load missions", description: error.message, variant: "destructive" });
    } else {
      setProjects((data as Project[]) || []);
    }
    setLoading(false);
  }, [userId, toast]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const saveProject = useCallback(
    async (title: string, html: string, prompt: string) => {
      if (!userId) return null;

      // INSERTING INTO MISSIONS TABLE
      const { data, error } = await supabase
        .from("missions")
        .insert({
          user_id: userId,
          directive: html, // Mapping HTML content to directive column
          status: "active",
        })
        .select()
        .single();

      if (error) {
        toast({ title: "Failed to save mission", description: error.message, variant: "destructive" });
        return null;
      }
      await fetchProjects();
      return data as Project;
    },
    [userId, toast, fetchProjects],
  );

  const updateProjectHTML = useCallback(
    async (projectId: string, html: string) => {
      const { error } = await supabase
        .from("missions")
        .update({ directive: html }) // Updated column name
        .eq("id", projectId);

      if (error) {
        toast({ title: "Failed to update mission", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Mission updated", description: "Cloud sync complete." });
      }
      await fetchProjects();
    },
    [toast, fetchProjects],
  );

  const trashProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase.from("missions").update({ status: "trashed" }).eq("id", projectId);
      if (!error) {
        toast({ title: "Mission moved to trash" });
        await fetchProjects();
      }
    },
    [toast, fetchProjects],
  );

  const restoreProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase.from("missions").update({ status: "active" }).eq("id", projectId);
      if (!error) {
        toast({ title: "Mission restored" });
        await fetchProjects();
      }
    },
    [toast, fetchProjects],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase.from("missions").delete().eq("id", projectId);
      if (!error) {
        toast({ title: "Mission permanently deleted" });
        await fetchProjects();
      }
    },
    [toast, fetchProjects],
  );

  const activeProjects = projects.filter((p) => p.status === "active");
  const trashedProjects = projects.filter((p) => p.status === "trashed");
  const recentProjects = activeProjects.slice(0, 10);

  return {
    projects,
    activeProjects,
    trashedProjects,
    recentProjects,
    loading,
    saveProject,
    updateProjectHTML,
    trashProject,
    restoreProject,
    deleteProject,
    fetchProjects,
  };
}
