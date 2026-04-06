import { useState, useEffect } from "react";
import { Loader2, Clock, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Interface updated to match image_72d166.png
interface Mission {
  id: string;
  directive: string; // This is where your HTML/Code lives
  status: string;
  created_at: string;
  user_id: string;
}

interface Props {
  onOpenProject?: (website: any) => void;
  onEditPrompt?: (website: any) => void;
  projects?: any[];
  loading?: boolean;
  onTrash?: (id: string) => void;
}

export default function DashboardRecently({ onOpenProject, onEditPrompt }: Props) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMissions = async () => {
      setLoading(true);
      // CORRECT TABLE: 'missions' | CORRECT COLUMNS: '*'
      const { data, error } = await supabase
        .from("missions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        console.error("DASHBOARD_FETCH_ERROR:", error);
      } else if (data) {
        setMissions(data as Mission[]);
      }
      setLoading(false);
    };

    fetchMissions();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (missions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 py-12">
        <Clock className="w-10 h-10 opacity-40" />
        <p className="text-sm">No recent missions yet</p>
        <p className="text-xs">Archive a generation to see it here</p>
      </div>
    );
  }

  // Maps the 'Mission' data back to the 'Project' format the rest of your app expects
  const toProject = (m: Mission) => ({
    id: m.id,
    html: m.directive, // Map directive back to html for the iframe
    title: `Mission ${m.id.slice(0, 5)}`, // Generate a temp title since 'title' column is missing
    prompt: m.directive.substring(0, 50) + "...", // Use start of code as a prompt preview
    last_opened_at: m.created_at,
    created_at: m.created_at,
    user_id: m.user_id,
    status: m.status,
  });

  return (
    <div className="animate-in fade-in duration-500">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        Recently Generated{" "}
        <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
          Cloud Sync
        </span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {missions.map((m) => {
          const project = toProject(m);
          return (
            <div
              key={m.id}
              onClick={() => onOpenProject?.(project)}
              className="cursor-pointer rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-0.5 hover:bg-accent/40 group relative"
            >
              {onEditPrompt && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditPrompt(project);
                  }}
                  className="absolute top-3 right-3 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity bg-secondary/80 hover:bg-primary/20 text-muted-foreground hover:text-primary"
                  title="View Source"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors pr-8">
                {project.title}
              </h3>
              <p className="text-[10px] font-mono text-muted-foreground mt-1 truncate opacity-70">
                {m.directive.substring(0, 60)}...
              </p>
              <div className="flex items-center justify-between mt-4">
                <span className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</span>
                <span className="text-[10px] uppercase tracking-widest text-primary font-bold">{m.status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
