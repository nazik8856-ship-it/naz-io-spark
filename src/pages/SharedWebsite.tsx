import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const SharedWebsite = () => {
  const { id } = useParams<{ id: string }>();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchWebsite = async () => {
      if (!id) {
        setError("No website ID provided");
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("shared_websites")
        .select("html")
        .eq("id", id)
        .single();

      if (fetchError || !data) {
        setError("Website not found");
      } else {
        setHtml(data.html);
      }
      setLoading(false);
    };

    fetchWebsite();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !html) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-xl font-semibold text-foreground">Website not found</p>
          <p className="text-muted-foreground">This shared link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-white">
      <iframe
        srcDoc={html}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin"
        title="Shared Website"
      />
    </div>
  );
};

export default SharedWebsite;
