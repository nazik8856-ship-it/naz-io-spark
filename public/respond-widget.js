/*!
 * Drop-in embeddable chat widget for the Control API's POST /respond
 * endpoint (see src/pages/ControlApiDocs.tsx). Zero dependencies, no
 * build step -- an integrating company includes this one script on
 * their own page and gets a floating chat bubble that talks to their
 * own key's configured context/persona.
 *
 * Usage:
 *   <script src="https://<this-app>/respond-widget.js"
 *           data-api-key="nazai_sk_..."
 *           data-base-url="https://<project-ref>.supabase.co/functions/v1"
 *           async></script>
 *
 * Optional attributes:
 *   data-title           Header text (default "Chat").
 *   data-greeting        First message shown before the visitor sends one.
 *   data-position        "right" (default) or "left".
 *   data-accent-color    Any CSS color for the bubble/header (default "#0891b2").
 *
 * Deliberately renders NOTHING that names NazAI or any underlying model --
 * the whole point of this endpoint (see response-sanitizer.ts) is that the
 * integrating company's own end user never sees who is actually answering.
 * All styles are inlined and scoped under one root id so this can't
 * collide with the host page's own CSS.
 */
(function () {
  "use strict";

  var scriptTag = document.currentScript;
  if (!scriptTag) return;

  var apiKey = scriptTag.getAttribute("data-api-key");
  var baseUrl = scriptTag.getAttribute("data-base-url");
  if (!apiKey || !baseUrl) {
    console.error("[respond-widget] data-api-key and data-base-url are both required.");
    return;
  }
  baseUrl = baseUrl.replace(/\/+$/, "");
  var title = scriptTag.getAttribute("data-title") || "Chat";
  var greeting = scriptTag.getAttribute("data-greeting") || "Hi! How can I help?";
  var position = scriptTag.getAttribute("data-position") === "left" ? "left" : "right";
  var accent = scriptTag.getAttribute("data-accent-color") || "#0891b2";

  var ROOT_ID = "nazai-respond-widget-root";
  if (document.getElementById(ROOT_ID)) return; // already initialized once on this page

  var root = document.createElement("div");
  root.id = ROOT_ID;
  root.style.cssText =
    "position:fixed;bottom:20px;" + position + ":20px;z-index:2147483000;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
  document.body.appendChild(root);

  var open = false;
  var history = []; // { role: 'user'|'assistant', content: string }
  var sending = false;

  var bubble = document.createElement("button");
  bubble.setAttribute("aria-label", title);
  bubble.style.cssText =
    "width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;" +
    "background:" + accent + ";color:#fff;font-size:24px;line-height:56px;text-align:center;" +
    "box-shadow:0 4px 14px rgba(0,0,0,0.25);";
  bubble.textContent = "💬"; // speech balloon emoji, no branding

  var panel = document.createElement("div");
  panel.style.cssText =
    "display:none;flex-direction:column;width:320px;max-width:calc(100vw - 40px);height:440px;" +
    "max-height:calc(100vh - 100px);position:absolute;bottom:68px;" + position + ":0;" +
    "background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.25);overflow:hidden;";

  var header = document.createElement("div");
  header.style.cssText = "background:" + accent + ";color:#fff;padding:12px 14px;font-weight:600;font-size:14px;";
  header.textContent = title;

  var messagesEl = document.createElement("div");
  messagesEl.style.cssText = "flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f8fafc;";

  var inputRow = document.createElement("div");
  inputRow.style.cssText = "display:flex;border-top:1px solid #e2e8f0;padding:8px;gap:6px;";

  var input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a message…";
  input.style.cssText = "flex:1;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;font-size:13px;outline:none;";

  var sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  sendBtn.style.cssText =
    "background:" + accent + ";color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer;";

  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  panel.appendChild(header);
  panel.appendChild(messagesEl);
  panel.appendChild(inputRow);
  root.appendChild(panel);
  root.appendChild(bubble);

  function addBubbleMessage(role, text) {
    var row = document.createElement("div");
    row.style.cssText =
      "max-width:85%;padding:8px 10px;border-radius:10px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;" +
      (role === "user"
        ? "align-self:flex-end;background:" + accent + ";color:#fff;"
        : "align-self:flex-start;background:#fff;color:#1e293b;border:1px solid #e2e8f0;");
    row.textContent = text;
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  var greeted = false;
  function ensureGreeting() {
    if (greeted) return;
    greeted = true;
    addBubbleMessage("assistant", greeting);
  }

  bubble.addEventListener("click", function () {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    if (open) ensureGreeting();
  });

  // Streams the SSE body from POST /respond (item 165's frame format:
  // "data: {...}\n\n", the last one carrying done:true) into one message
  // bubble, updating it as chunks arrive -- a plain fetch + manual frame
  // parse, not EventSource, since EventSource can't send a POST body or
  // an Authorization header.
  function streamInto(row, resp) {
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var text = "";

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var frames = buffer.split("\n\n");
        buffer = frames.pop();
        for (var i = 0; i < frames.length; i++) {
          var frame = frames[i];
          if (frame.indexOf("data: ") !== 0) continue;
          var payload;
          try {
            payload = JSON.parse(frame.slice(6));
          } catch (e) {
            continue;
          }
          if (typeof payload.delta === "string") {
            text += payload.delta;
            row.textContent = text;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
        return pump();
      });
    }
    return pump().then(function () {
      return text;
    });
  }

  function send() {
    var message = input.value.trim();
    if (!message || sending) return;
    ensureGreeting();
    addBubbleMessage("user", message);
    input.value = "";
    sending = true;
    sendBtn.disabled = true;

    var answerRow = addBubbleMessage("assistant", "…");

    fetch(baseUrl + "/control-api/v1/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({ message: message, conversation_history: history.slice(-20), stream: true }),
    })
      .then(function (resp) {
        if (!resp.ok || !resp.body) {
          return resp
            .json()
            .catch(function () { return {}; })
            .then(function (body) {
              throw new Error(body.message || body.error || "Request failed (" + resp.status + ")");
            });
        }
        return streamInto(answerRow, resp);
      })
      .then(function (finalText) {
        history.push({ role: "user", content: message });
        history.push({ role: "assistant", content: finalText });
      })
      .catch(function (err) {
        answerRow.textContent = "Sorry, something went wrong. Please try again.";
        console.error("[respond-widget]", err);
      })
      .finally(function () {
        sending = false;
        sendBtn.disabled = false;
      });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });
})();
