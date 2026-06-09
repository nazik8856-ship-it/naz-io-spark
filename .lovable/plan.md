## NazAI Agent Generator Flow

Generate Agent creates only a clean 8-section autonomous agent plan with no meta text.

Approve & Build now stays on the same page, calls `run-ai-agent` in build mode, and renders a final formatted agent specification card.

Final card requirements:
- Success message: "Agent successfully built!"
- Buttons: Copy Spec, Deploy Preview, Save Agent
- No popups, no closing windows, no automatic 10-second build.

Backend requirements:
- `generate-ai-agent` uses the strict 8-section prompt.
- `run-ai-agent` cleans model output and returns `{ agentId, name, finalSpec, systemPrompt }` for build mode.
- Prefer `OPENAI_API_KEY`; fall back to Lovable AI only if OpenAI is unavailable.