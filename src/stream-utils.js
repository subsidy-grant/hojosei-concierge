// Anthropic Messages APIのSSEストリーム(stream: true時)を、
// テキスト差分だけを流すプレーンテキストストリームに変換する共通ユーティリティ。
// フロント側はSSEをパースせず、単純にレスポンス本文を逐次読み込むだけでよくなる。

export function sseToTextStream(anthropicRes) {
  const reader = anthropicRes.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        let enqueued = false;
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          let evt;
          try {
            evt = JSON.parse(jsonStr);
          } catch {
            continue;
          }
          if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(evt.delta.text));
            enqueued = true;
          } else if (evt.type === "message_delta" && evt.delta && evt.delta.stop_reason === "refusal") {
            controller.enqueue(encoder.encode("\n\n[この内容については生成できませんでした。表現を変えて再度お試しください]"));
            enqueued = true;
          } else if (evt.type === "error") {
            const msg = (evt.error && evt.error.message) || "生成中にエラーが発生しました";
            controller.enqueue(encoder.encode("\n\n[エラー: " + msg + "]"));
            enqueued = true;
          }
        }
        if (enqueued) return;
      }
    },
  });
}

export function streamTextResponse(anthropicRes) {
  return new Response(sseToTextStream(anthropicRes), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
