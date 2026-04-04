import React from "react";
import { X, FileText, Image, Video } from "lucide-react";

interface Attachment {
  name: string;
  url: string;
  type: string;
}

interface AttachmentChipProps {
  attachment: Attachment;
  onRemove: () => void;
}

const getIcon = (type: string) => {
  if (type.startsWith("image/")) return Image;
  if (type.startsWith("video/")) return Video;
  return FileText;
};

const AttachmentChip: React.FC<AttachmentChipProps> = ({ attachment, onRemove }) => {
  const Icon = getIcon(attachment.type);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border border-white/10 rounded-lg backdrop-blur-sm group">
      <Icon size={12} className="text-[#00A3FF]/70 shrink-0" />
      <span className="text-[10px] text-white/60 font-mono truncate max-w-[120px]">
        {attachment.name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 p-0.5 rounded hover:bg-white/10 transition-colors"
      >
        <X size={10} className="text-white/30 hover:text-white/60" />
      </button>
    </div>
  );
};

export default AttachmentChip;
export type { Attachment };
