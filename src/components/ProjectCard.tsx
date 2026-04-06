import { Clock, Trash2, RotateCcw, X, FolderOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import type { Project } from "@/hooks/useProjects";

interface ProjectCardProps {
  project: Project;
  mode: "active" | "trash";
  onOpen?: (project: Project) => void;
  onTrash?: (projectId: string) => void;
  onRestore?: (projectId: string) => void;
  onDelete?: (projectId: string) => void;
  onSaveToAll?: (projectId: string) => void;
}

export function ProjectCard({ project, mode, onOpen, onTrash, onRestore, onDelete, onSaveToAll }: ProjectCardProps) {
  const timeAgo = formatDistanceToNow(new Date(project.updated_at || project.created_at), { addSuffix: true });

  return (
    <Card className="group border-border bg-card/60 backdrop-blur-sm hover:border-primary/30 transition-all">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium truncate">{project.directive?.slice(0, 50) || "Untitled"}</CardTitle>
      </CardHeader>
      <CardContent className="pb-2">
        <div className="h-32 rounded-md overflow-hidden border border-border bg-white">
          <iframe
            srcDoc={project.directive}
            className="w-full h-full pointer-events-none scale-[0.25] origin-top-left"
            style={{ width: "400%", height: "400%" }}
            title={project.directive?.slice(0, 50) || "Untitled"}
            sandbox=""
          />
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>{timeAgo}</span>
        </div>
      </CardContent>
      <CardFooter className="pt-0 gap-1.5 flex-wrap">
        {mode === "active" && (
          <>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onOpen?.(project)}>
              <ExternalLink className="w-3 h-3 mr-1" /> Open
            </Button>
            <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => onTrash?.(project.id)}>
              <Trash2 className="w-3 h-3 mr-1" /> Trash
            </Button>
          </>
        )}
        {mode === "trash" && (
          <>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onRestore?.(project.id)}>
              <RotateCcw className="w-3 h-3 mr-1" /> Use Again
            </Button>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onSaveToAll?.(project.id)}>
              <FolderOpen className="w-3 h-3 mr-1" /> Save to All
            </Button>
            <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => onDelete?.(project.id)}>
              <X className="w-3 h-3 mr-1" /> Remove
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
