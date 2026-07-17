// POST /api/fill-form
// 申請様式(記入シート)の下書き内容をClaudeで生成する。
// 行政書士法・社労士法対応: 本サービスは様式そのものを「作成・提出代行」しない。
// 出力は申請者本人が正式な様式(公式サイトからダウンロードしたExcel/Word/PDF等)へ転記するための参考下書き。
// レスポンスはストリーミング(プレーンテキスト逐次配信)。エラー時のみ従来通りJSONを返す。

import { streamTextResponse } from "./stream-utils.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function handleFillForm(request, env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: "サーバー設定エラー(APIキー未設定)" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエスト形式が不正です" }, 400);
  }

  const formLabel = typeof body.formLabel === "string" ? body.formLabel.trim().slice(0, 200) : "";
  const formPurpose = typeof body.formPurpose === "string" ? body.formPurpose.trim().slice(0, 500) : "";
  if (!formLabel) return jsonResponse({ error: "様式が指定されていません" }, 400);

  let companyContext = "";
  if (body.company && typeof body.company === "object") {
    const c = body.company;
    companyContext = [
      typeof c.companyName === "string" ? `会社名: ${c.companyName.slice(0, 200)}` : "",
      typeof c.industry === "string" ? `業種(推定): ${c.industry.slice(0, 100)}` : "",
      typeof c.scaleGuess === "string" ? `規模(推定): ${c.scaleGuess.slice(0, 100)}` : "",
      Array.isArray(c.attributes) ? `特徴: ${c.attributes.slice(0, 10).map((a) => String(a).slice(0, 100)).join("、")}` : "",
    ].filter(Boolean).join("\n");
  }

  let registryContext = "";
  if (body.registryProfile && typeof body.registryProfile === "object") {
    const r = body.registryProfile;
    registryContext = [
      r.name ? `法人名(確認済み): ${String(r.name).slice(0, 200)}` : "",
      r.capitalStock != null ? `資本金(確認済み): ${r.capitalStock}円` : "",
      r.employeeNumber != null ? `従業員数(確認済み): ${r.employeeNumber}人` : "",
    ].filter(Boolean).join("\n");
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 6000,
      stream: true,
      output_config: { effort: "low" },
      system: [
        {
          type: "text",
          text:
            "あなたは、日本の中小企業が補助金・助成金の申請様式に記入する内容の下書きを作成するアシスタントです。" +
            "生成するのは、申請者本人が正式な様式(公式サイトからダウンロードしたExcel/Word/PDF等)に転記するための参考下書きであり、様式そのものではありません。\n" +
            "守るべきルール:\n" +
            "1. 会社固有の事実が入力に含まれていない項目は、決して数値や固有名詞をでっち上げず、「【要確認:◯◯をご記入ください】」の形式で明記する。\n" +
            "2. 出力は「項目名: 内容」の形式で整理された箇条書きにする。\n" +
            "3. 冒頭に「※この記入内容は下書き(自己作成支援)です。正式な様式に転記のうえご確認ください。」の一文を必ず入れる。\n" +
            "4. 末尾に「確認・記入が必要な項目」の一覧を箇条書きでまとめる。\n" +
            "5. 誇張表現や採択・支給を保証するような表現は使わない。\n" +
            "6. 全体は日本語のプレーンテキストで、そのままメモ帳で編集できる形式にする。",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content:
            `様式名: ${formLabel}\n様式の目的: ${formPurpose}\n\n` +
            (companyContext ? `【会社情報(AI推定)】\n${companyContext}\n\n` : "") +
            (registryContext ? `【法人番号(gBizINFO)で確認した公的データ】\n${registryContext}\n\n` : "") +
            (note ? `【申請者からの補足】\n${note}\n\n` : "") +
            "上記をもとに、この様式の記入内容の下書きを作成してください。",
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const status = anthropicRes.status;
    const msg = status === 429 ? "アクセスが集中しています。しばらくしてからお試しください" : "記入内容の生成に失敗しました";
    return jsonResponse({ error: msg }, 502);
  }

  return streamTextResponse(anthropicRes);
}
