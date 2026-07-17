// POST /api/draft
// 選択した制度について、申請者本人が編集して使う「たたき台」文書をClaudeで生成する。
// 行政書士法・社労士法対応: 本サービスは書類を「作成・提出代行」しない。
// 出力は必ず自己作成支援の参考文書であり、フロント側で編集可能なtextareaに表示し免責を常時併記する。

// public/index.html の PROGRAMS と対応。制度を追加/削除したら両方更新すること。
const PROGRAM_INFO = {
  ai: { name: "デジタル化・AI導入補助金2026(旧IT導入補助金)", type: "hojokin", docLabel: "事業計画(ITツール導入計画)のたたき台" },
  jizoku: { name: "小規模事業者持続化補助金", type: "hojokin", docLabel: "経営計画書・補助事業計画書のたたき台" },
  shoryokuka: { name: "中小企業省力化投資補助金", type: "hojokin", docLabel: "事業計画(省力化投資計画)のたたき台" },
  monodukuri: { name: "新事業進出・ものづくり商業サービス補助金", type: "hojokin", docLabel: "事業計画書のたたき台" },
  career: { name: "キャリアアップ助成金(正社員化コース)", type: "joseikin", docLabel: "キャリアアップ計画の検討メモ(たたき台)" },
  trial: { name: "トライアル雇用助成金", type: "joseikin", docLabel: "試行雇用の取組概要メモ(たたき台)" },
  tokutei: { name: "特定求職者雇用開発助成金", type: "joseikin", docLabel: "雇入れ計画の検討メモ(たたき台)" },
  ryoritsu: { name: "両立支援等助成金(育児休業等支援コース)", type: "joseikin", docLabel: "育休復帰支援プランの検討メモ(たたき台)" },
  kaizen: { name: "業務改善助成金", type: "joseikin", docLabel: "賃金引上げ・設備投資計画の検討メモ(たたき台)" },
  jinzai: { name: "人材開発支援助成金(人材育成支援コース)", type: "joseikin", docLabel: "訓練計画の検討メモ(たたき台)" },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function handleDraft(request, env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: "サーバー設定エラー(APIキー未設定)" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエスト形式が不正です" }, 400);
  }

  const program = PROGRAM_INFO[body.programKey];
  if (!program) return jsonResponse({ error: "制度が指定されていません" }, 400);

  const userInput = typeof body.userInput === "string" ? body.userInput.trim().slice(0, 3000) : "";
  if (!userInput) return jsonResponse({ error: "事業の内容を入力してください" }, 400);

  let companyContext = "";
  if (body.company && typeof body.company === "object") {
    const c = body.company;
    companyContext = [
      typeof c.industry === "string" ? `業種(推定): ${c.industry.slice(0, 100)}` : "",
      typeof c.scaleGuess === "string" ? `規模(推定): ${c.scaleGuess.slice(0, 100)}` : "",
      Array.isArray(c.attributes) ? `特徴: ${c.attributes.slice(0, 10).map((a) => String(a).slice(0, 100)).join("、")}` : "",
    ].filter(Boolean).join("\n");
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 12000,
      output_config: { effort: "medium" },
      system:
        "あなたは、日本の中小企業経営者が補助金・助成金の申請書類を「自分で」作成するのを支援するアシスタントです。" +
        "生成するのは申請者本人が編集して仕上げるための参考たたき台であり、そのまま提出できる完成書類ではありません。" +
        "守るべきルール:\n" +
        "1. 会社固有の事実(売上高、創業年、従業員数、具体的な数値目標など)が入力に含まれていない場合は、決して数値をでっち上げず、【ここに◯◯を記入】の形のプレースホルダーにする。\n" +
        "2. 構成は実際の公募でよく使われる項目立て(事業の背景・現状の課題・取組内容・実施体制・スケジュール・期待される効果)に沿わせる。\n" +
        "3. 文書の冒頭に「※このたたき台はご自身で編集・確認のうえご利用ください。最新の公募要領の様式・記載要領に従ってください。」の一文を必ず入れる。\n" +
        "4. 誇張表現や採択を保証するような表現は使わない。\n" +
        "5. 全体は日本語のプレーンテキスト(見出しは【】)で、そのままメモ帳で編集できる形式にする。",
      messages: [
        {
          role: "user",
          content:
            `対象制度: ${program.name}\n作成する文書: ${program.docLabel}\n\n` +
            (companyContext ? `【会社情報(AI推定)】\n${companyContext}\n\n` : "") +
            `【申請者が記入した事業内容・やりたいこと】\n${userInput}\n\n` +
            "上記をもとに、この制度向けのたたき台を作成してください。",
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const status = anthropicRes.status;
    const msg = status === 429 ? "アクセスが集中しています。しばらくしてからお試しください" : "下書き生成に失敗しました";
    return jsonResponse({ error: msg }, 502);
  }

  const result = await anthropicRes.json();
  if (result.stop_reason === "refusal") {
    return jsonResponse({ error: "この内容では下書きを生成できませんでした" }, 422);
  }
  const textBlock = (result.content || []).find((b) => b.type === "text");
  if (!textBlock || !textBlock.text) {
    return jsonResponse({ error: "下書き生成に失敗しました。再度お試しください" }, 502);
  }

  return jsonResponse({
    draft: textBlock.text,
    disclaimer: "本下書きはご自身で編集・提出いただくための参考文書(自己作成支援)です。内容の正確性・採択を保証するものではありません。",
  });
}
