import { Loader2, Trash2 } from "lucide-react";
import { ProjectCard } from "@/components/ProjectCard";
import type { Project } from "@/hooks/useProjects";

interface Props {
  projects: Project[];
  loading: boolean;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveToAll: (id: string) => void;
  onOpenProject: (project: Project) => void;
}

export default function DashboardTrash({ projects, loading, onRestore, onDelete, onSaveToAll, onOpenProject }: Props) {
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
        <Trash2 className="w-10 h-10 opacity-40" />
        <p className="text-sm">Trash is empty</p>
        <p className="text-xs">Deleted projects will appear here</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Trash</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} mode="trash" onRestore={onRestore} onDelete={onDelete} onSaveToAll={onSaveToAll} />
        ))}
      </div>
    </div>
  );
}
