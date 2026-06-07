Yes. The correct fix is not another placeholder patch — NazAI needs a dedicated agent-building path from input to output, with deterministic routing and a real deployable result.

Plan:

1. Make AI Agent selection deterministic
- Read `nazai_pending_type` from `GeneratorHome` inside `GenerationWorkspace`.
- If the user selected `AI Agent`, always call `generate-ai-agent` even if the prompt does not contain the word “agent”.
- Keep text-based agent intent detection only as a fallback for prompts typed directly in the workspace.

2. Replace fragile streaming handling with a reliable parser
- Keep token-by-token streaming for the UI.
- Handle malformed/partial SSE chunks safely.
- If the stream fails, show a clear error toast and still render a valid fallback agent spec instead of an empty screen.
- Ensure the generated agent appears in the preview tab immediately as it streams.

3. Fix the backend agent builder function
- Use one backend prompt that outputs only the final agent in the exact 8-section format.
- Remove any meta/status language from the model prompt.
- Prefer the built-in AI gateway unless the existing OpenAI key is explicitly required.
- Add proper handling for rate limit, payment/credits, invalid key, and empty model output.

4. Add actual “build” output instead of just chat text
- Render the generated agent as the primary output artifact in the right preview pane.
- Structure the output as an agent spec: name, description, goal, capabilities, workflow, guardrails, deployment options, impact.
- Add a real deploy/action area only if it performs something meaningful, otherwise do not show a fake unpressable deploy button.

5. Preserve the simple blueprint
```text
Input Screen -> Generation -> Output Screen
```
- Input Screen: user describes the agent need.
- Generation: NazAI expands short prompts and respects long prompts.
- Output Screen: generated agent appears in the same tab, non-cached, ready to copy/refine/deploy later.

6. Validate the flow end-to-end
- Test from `GeneratorHome` with AI Agent selected.
- Test from direct workspace prompt.
- Test a tiny prompt and a large prompt.
- Confirm the network call hits `generate-ai-agent` and the preview pane shows the final agent, not placeholder text.