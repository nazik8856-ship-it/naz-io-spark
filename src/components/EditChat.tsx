import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

interface EditChatProps {
  onSendEdit: (message: string, history: ChatMessage[]) => Promise<void>;
  isGenerating: boolean;
}

const EditChat = ({ onSendEdit, isGenerating }: EditChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");

    try {
      await onSendEdit(text, updatedMessages);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "✓ Changes applied to the preview." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to apply changes. Please try again." },
      ]);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col max-h-[300px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <MessageSquare className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Edit & Improve</span>
        <span className="text-xs text-muted-foreground ml-auto">
          Describe changes to refine your website
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[60px]">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Try: "Make the hero section bigger" or "Change the color scheme to blue"
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "text-sm px-3 py-2 rounded-lg max-w-[85%] w-fit",
              msg.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground"
            )}
          >
            {msg.content}
          </div>
        ))}
        {isGenerating && (
          <div className="flex items-center gap-2 text-primary text-sm px-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Applying changes...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 px-3 py-2.5 border-t border-border">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Describe changes you want..."
          className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isGenerating}
        />
        <Button
          variant="hero"
          size="icon"
          onClick={handleSend}
          disabled={!input.trim() || isGenerating}
          className="shrink-0 h-9 w-9"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
};

export default EditChat;
