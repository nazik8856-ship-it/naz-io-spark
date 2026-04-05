import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface Project {
  id: string;
  user_id: string;
  title: string;
  html: string;
  prompt: string | null;
  status: string;
  last_opened_at: string;
  created_at: string;
}

export function useProjects(userId: string | undefined) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchProjects = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("last_opened_at", { ascending: false });

    if (error) {
      toast({ title: "Failed to load projects", description: error.message, variant: "destructive" });
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
      const { data, error } = await supabase
        .from("projects")
        .insert({ user_id: userId, title, html, prompt, status: "active" })
        .select()
        .single();

      if (error) {
        toast({ title: "Failed to save project", description: error.message, variant: "destructive" });
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
        .from("projects")
        .update({ html, last_opened_at: new Date().toISOString() })
        .eq("id", projectId);

      if (error) {
        toast({ title: "Failed to update project", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Project updated", description: "Your changes are saved." });
      }
      await fetchProjects();
    },
    [toast, fetchProjects],
  );

  const trashProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase.from("projects").update({ status: "trashed" }).eq("id", projectId);
      if (!error) {
        toast({ title: "Project moved to trash" });
        await fetchProjects();
      }
    },
    [toast, fetchProjects],
  );

  const restoreProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase
        .from("projects")
        .update({ status: "active", last_opened_at: new Date().toISOString() })
        .eq("id", projectId);
      if (!error) {
        toast({ title: "Project restored" });
        await fetchProjects();
      }
    },
    [toast, fetchProjects],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", projectId);
      if (!error) {
        toast({ title: "Project permanently deleted" });
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
