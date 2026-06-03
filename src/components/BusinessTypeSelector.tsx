import React from "react";

interface BusinessTypeSelectorProps {
  onSelect: (businessType: string) => void;
}

const options = [
  { id: "ecom", title: "E-Commerce", icon: "🛍️" },
  { id: "saas", title: "SaaS", icon: "⚙️" },
  { id: "port", title: "Portfolio", icon: "🎨" },
];

const BusinessTypeSelector = ({ onSelect }: BusinessTypeSelectorProps) => {
  const [selected, setSelected] = React.useState("");
  const [custom, setCustom] = React.useState("");
  const [isCustom, setIsCustom] = React.useState(false);

  const currentValue = isCustom ? custom.trim() : selected;

  return (
    <div className="max-w-2xl mx-auto w-full text-center space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          What are you building?
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose your AI Agent type so we can tailor the website for you.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              setSelected(opt.title);
              setIsCustom(false);
            }}
            className={`p-4 rounded-xl border-2 transition-all ${
              selected === opt.title && !isCustom
                ? "border-primary bg-primary/10"
                : "border-border bg-secondary/50"
            }`}
          >
            <span className="text-2xl mb-1 block">{opt.icon}</span>
            <span className="text-sm font-bold text-foreground">{opt.title}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setIsCustom(true);
            setSelected("");
          }}
          className={`p-4 rounded-xl border-2 transition-all ${
            isCustom ? "border-primary bg-primary/10" : "border-border bg-secondary/50"
          }`}
        >
          <span className="text-2xl mb-1 block">✨</span>
          <span className="text-sm font-bold text-foreground">Other</span>
        </button>
      </div>

      {isCustom && (
        <input
          type="text"
          placeholder="What kind of AI Agent? (e.g. AI Gym, Pet Shop...)"
          className="w-full p-3 bg-secondary/50 border border-border rounded-lg text-foreground outline-none focus:border-primary"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      )}

      <button
        type="button"
        disabled={!currentValue}
        onClick={() => onSelect(currentValue)}
        className="px-8 py-3 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40 transition-opacity"
      >
        Continue
      </button>
    </div>
  );
};

export default BusinessTypeSelector;
