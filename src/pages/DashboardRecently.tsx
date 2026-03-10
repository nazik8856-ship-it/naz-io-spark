import { Loader2, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ProjectCard } from "@/components/ProjectCard";
import type { Project } from "@/hooks/useProjects";

interface Props {
  projects: Project[];
  loading: boolean;
  onTrash: (id: string) => void;
  onOpenProject: (project: Project) => void;
}

export default function DashboardRecently({ projects, loading, onTrash, onOpenProject }: Props) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Clock className="w-10 h-10 opacity-40" />
        <p className="text-sm">No recent projects yet</p>
        <p className="text-xs">Generate your first website to see it here</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Recently Opened</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} mode="active" onOpen={onOpenProject} onTrash={onTrash} />
        ))}
      </div>
    </div>
  );
}
