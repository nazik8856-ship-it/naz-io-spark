import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, ExternalLink, Video, Users, Twitter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CreditRefillModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
}

export default function CreditRefillModal({ open, onOpenChange, userId }: CreditRefillModalProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [copiedRef, setCopiedRef] = useState(false);
  const [submittedVideo, setSubmittedVideo] = useState(false);
  const { toast } = useToast();

  const referralLink = `${window.location.origin}?ref=${userId || ""}`;

  const handleCopyReferral = async () => {
    await navigator.clipboard.writeText(referralLink);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
    toast({ title: "Copied!", description: "Referral link copied to clipboard." });
  };

  const handleSubmitVideo = () => {
    if (!videoUrl.trim()) {
      toast({ title: "Enter a URL", description: "Please paste your TikTok/Reel link.", variant: "destructive" });
      return;
    }
    setSubmittedVideo(true);
    toast({ title: "Submitted!", description: "We'll review your post and add +5 credits." });
    setVideoUrl("");
    setTimeout(() => setSubmittedVideo(false), 3000);
  };

  const handleFollowTwitter = () => {
    window.open("https://twitter.com/NazAI", "_blank");
    toast({ title: "Thanks!", description: "+1 credit will be added after verification." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border border-[#22c55e]/30 text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-[#22c55e]">Refill Your Credits</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Complete tasks below to earn free credits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {/* Task A: TikTok/Reel */}
          <div className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-[#22c55e]" />
                <span className="text-sm font-semibold">Post a TikTok/Reel with #NazAI</span>
              </div>
              <span className="text-xs font-bold text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full">+5</span>
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                placeholder="Paste your video URL..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-sm"
              />
              <Button
                size="sm"
                onClick={handleSubmitVideo}
                disabled={submittedVideo}
                className="bg-[#22c55e] text-black font-bold hover:bg-[#22c55e]/80 shrink-0"
              >
                {submittedVideo ? <Check className="w-4 h-4" /> : "Submit"}
              </Button>
            </div>
          </div>

          {/* Task B: Referral */}
          <div className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#22c55e]" />
                <span className="text-sm font-semibold">Share Referral Link</span>
              </div>
              <span className="text-xs font-bold text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full">+3</span>
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                readOnly
                value={referralLink}
                className="bg-zinc-800 border-zinc-700 text-xs text-zinc-400"
              />
              <Button
                size="sm"
                onClick={handleCopyReferral}
                className="bg-[#22c55e] text-black font-bold hover:bg-[#22c55e]/80 shrink-0"
              >
                {copiedRef ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Task C: Follow Twitter */}
          <div className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Twitter className="w-4 h-4 text-[#22c55e]" />
                <span className="text-sm font-semibold">Follow on X/Twitter</span>
              </div>
              <span className="text-xs font-bold text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full">+1</span>
            </div>
            <Button
              size="sm"
              onClick={handleFollowTwitter}
              className="mt-3 w-full bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-[#22c55e]/10 hover:border-[#22c55e]/40"
            >
              <ExternalLink className="w-3 h-3 mr-1.5" />
              Follow @NazAI
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
