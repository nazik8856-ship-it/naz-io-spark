import { useState, useEffect } from "react";
import { Loader2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Website {
  id: string;
  title: string;
  html: string;
  prompt: string | null;
  created_at: string;
}

interface Props {
  onOpenProject?: (website: any) => void;
  projects?: any[];
  loading?: boolean;
  onTrash?: (id: string) => void;
}

export default function DashboardRecently({ onOpenProject }: Props) {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWebsites = async () => {
      setLoading(true);
      const { data, error } = await (supabase.from as any)('websites')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (!error && data) {
        setWebsites(data as Website[]);
      }
      setLoading(false);
    };

    fetchWebsites();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (websites.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Clock className="w-10 h-10 opacity-40" />
        <p className="text-sm">No recent websites yet</p>
        <p className="text-xs">Generate your first website to see it here</p>
      </div>
    );
  }

  const handleClick = (w: Website) => {
    onOpenProject?.({
      id: w.id,
      html: w.html,
      title: w.title,
      prompt: w.prompt,
      last_opened_at: w.created_at,
      created_at: w.created_at,
      user_id: '',
      status: 'active',
    });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Recently Generated</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {websites.map((w) => (
          <div
            key={w.id}
            onClick={() => handleClick(w)}
            className="cursor-pointer rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-0.5 hover:bg-accent/40 group"
          >
            <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors">{w.title}</h3>
            <p className="text-xs text-muted-foreground mt-1 truncate">{w.prompt || "No prompt"}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {new Date(w.created_at).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
