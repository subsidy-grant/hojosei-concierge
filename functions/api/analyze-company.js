// POST /api/analyze-company
// 会社HPのURL(と任意の補足テキスト)から事業プロフィールを推定し、
// 掲載制度(PROGRAM_SUMMARIES)とのマッチングをClaudeで行う。
// APIキーは Cloudflare Pages の環境変数 ANTHROPIC_API_KEY(リポジトリには置かない)。

// index.html の PROGRAMS と対応するキーの要約。制度を追加/削除したら両方更新すること。
const PROGRAM_SUMMARIES = [
  { key: "ai", name: "デジタル化・AI導入補助金2026(旧IT導入補助金)", type: "補助金", summary: "中小企業のソフトウェア・クラウド導入費を補助。予約/顧客管理/会計等のITツール導入向け。" },
  { key: "jizoku", name: "小規模事業者持続化補助金", type: "補助金", summary: "従業員5〜20人以下の小規模事業者の販路開拓(広報費・Web関連費・機械装置等)を補助。個人事業主も対象。" },
  { key: "shoryokuka", name: "中小企業省力化投資補助金", type: "補助金", summary: "人手不足対策の自動化・省人化機器(自動精算機、清掃ロボット等)の導入費を補助。" },
  { key: "monodukuri", name: "新事業進出・ものづくり商業サービス補助金", type: "補助金", summary: "革新的な新製品・新サービス開発や新事業進出のための大型設備投資を補助。賃上げ計画が必須。" },
  { key: "career", name: "キャリアアップ助成金(正社員化コース)", type: "助成金", summary: "有期雇用・パート等の従業員を正社員化した事業主に定額支給。転換後3%以上の賃上げが要件。" },
  { key: "trial", name: "トライアル雇用助成金", type: "助成金", summary: "ハローワーク等の紹介で就職困難な求職者を3か月試行雇用すると月額支給。" },
  { key: "tokutei", name: "特定求職者雇用開発助成金", type: "助成金", summary: "高年齢者(60歳以上)・障害者・母子家庭の母等をハローワーク紹介で継続雇用すると支給。" },
  { key: "ryoritsu", name: "両立支援等助成金(育児休業等支援コース)", type: "助成金", summary: "中小企業が育休復帰支援プランを作成し育児休業取得・職場復帰を支援すると支給。" },
  { key: "kaizen", name: "業務改善助成金", type: "助成金", summary: "事業場内最低賃金を50円以上引き上げ、生産性向上設備を導入する中小企業に費用の3/4〜4/5を助成。" },
  { key: "jinzai", name: "人材開発支援助成金(人材育成支援コース)", type: "助成金", summary: "従業員に10時間以上の研修・訓練を実施した事業主に経費・賃金を助成。" },
];

const PROGRAM_KEYS = PROGRAM_SUMMARIES.map((p) => p.key);

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    company: {
      type: "object",
      properties: {
        industry: { type: "string" },
        scaleGuess: { type: "string" },
        attributes: { type: "array", items: { type: "string" } },
      },
      required: ["industry", "scaleGuess", "attributes"],
      additionalProperties: false,
    },
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          programKey: { type: "string", enum: PROGRAM_KEYS },
          reason: { type: "string" },
        },
        required: ["programKey", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["company", "matches"],
  additionalProperties: false,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function isFetchableUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  // SSRF対策: ローカル・プライベートアドレスへのアクセスを拒否
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return false;
  }
  if (host === "[::1]" || host.startsWith("fd") || host.startsWith("fe80")) return false;
  return true;
}

async function fetchCompanyText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "hojosei-concierge-demo/1.0 (+company profile analysis)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
    const html = await res.text();
    // scriptとstyleを除去し、タグをスペースに置換してテキスト化
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-zA-Z#0-9]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 6000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestPost(context) {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: "サーバー設定エラー(APIキー未設定)" }, 500);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "リクエスト形式が不正です" }, 400);
  }

  const url = typeof body.url === "string" ? body.url.trim().slice(0, 500) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
  if (!url && !description) return jsonResponse({ error: "URLまたは事業内容を入力してください" }, 400);

  let siteText = null;
  if (url) {
    if (!isFetchableUrl(url)) return jsonResponse({ error: "このURLは解析できません" }, 400);
    siteText = await fetchCompanyText(url);
  }

  const catalog = PROGRAM_SUMMARIES.map(
    (p) => `- key: ${p.key} / ${p.name}(${p.type}): ${p.summary}`
  ).join("\n");

  const companyInfo = [
    siteText ? `【会社ホームページの本文抜粋】\n${siteText}` : url ? "【会社ホームページ】取得できませんでした(補足テキストのみで推定してください)" : "",
    description ? `【利用者による補足】\n${description}` : "",
  ].filter(Boolean).join("\n\n");

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RESPONSE_SCHEMA },
      },
      system:
        "あなたは日本の中小企業向け補助金・助成金の一次スクリーニングを行うアシスタントです。" +
        "与えられた会社情報から業種・規模・取り組み予定を推定し、制度カタログの中から活用できる可能性のある制度を選びます。" +
        "確実に対象外と判断できる制度は含めないでください。判断材料が乏しい場合は attributes にその旨を含め、マッチは控えめにしてください。" +
        "reason は必ず日本語で、その会社の情報のどこから判断したかが分かるように書いてください。マッチは0〜6件程度。",
      messages: [
        {
          role: "user",
          content: `【制度カタログ】\n${catalog}\n\n${companyInfo}\n\n上記の会社が活用できる可能性のある制度をJSONで返してください。`,
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const status = anthropicRes.status;
    const msg = status === 429 ? "アクセスが集中しています。しばらくしてからお試しください" : "AI解析に失敗しました";
    return jsonResponse({ error: msg }, 502);
  }

  const result = await anthropicRes.json();
  if (result.stop_reason === "refusal") {
    return jsonResponse({ error: "この内容は解析できませんでした" }, 422);
  }
  const textBlock = (result.content || []).find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return jsonResponse({ error: "AI解析結果の形式が不正でした。再度お試しください" }, 502);
  }

  return jsonResponse({
    company: parsed.company,
    matches: parsed.matches,
    disclaimer: "この結果はAIによる推定であり、対象可否を保証するものではありません。必ず各制度の公募要領・支給要領をご確認ください。",
  });
}
