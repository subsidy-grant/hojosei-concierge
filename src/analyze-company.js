// POST /api/analyze-company
// 会社HPのURL(と任意の補足テキスト)から事業プロフィールを推定し、
// 掲載制度(PROGRAM_SUMMARIES)とのマッチングをClaudeで行う。
// APIキーは Cloudflare の環境変数 ANTHROPIC_API_KEY(リポジトリには置かない)。

// public/index.html の PROGRAMS と対応するキーの要約。制度を追加/削除したら両方更新すること。
const PROGRAM_SUMMARIES = [
  { key: "ai", name: "デジタル化・AI導入補助金2026(旧IT導入補助金)", type: "補助金", summary: "中小企業・小規模事業者のソフトウェア・クラウド導入費を補助。予約/顧客管理/会計等のITツール導入向け。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
  { key: "jizoku", name: "小規模事業者持続化補助金", type: "補助金", summary: "従業員5〜20人以下の小規模事業者の販路開拓(広報費・Web関連費・機械装置等)を補助。個人事業主も対象。", eligibleSizes: ["個人事業主", "小規模事業者"] },
  { key: "shoryokuka", name: "中小企業省力化投資補助金", type: "補助金", summary: "人手不足対策の自動化・省人化機器(自動精算機、清掃ロボット等)の導入費を補助。中小企業・小規模事業者向け。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
  { key: "monodukuri", name: "新事業進出・ものづくり商業サービス補助金", type: "補助金", summary: "革新的な新製品・新サービス開発や新事業進出のための大型設備投資を補助。中小企業・中堅企業向け。賃上げ計画が必須。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業", "中堅企業"] },
  { key: "career", name: "キャリアアップ助成金(正社員化コース)", type: "助成金", summary: "有期雇用・パート等の従業員を正社員化した事業主に定額支給。転換後3%以上の賃上げが要件。企業規模を問わず雇用保険適用事業所であれば対象。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業", "中堅企業", "大企業"] },
  { key: "trial", name: "トライアル雇用助成金", type: "助成金", summary: "ハローワーク等の紹介で就職困難な求職者を3か月試行雇用すると月額支給。企業規模を問わず対象。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業", "中堅企業", "大企業"] },
  { key: "tokutei", name: "特定求職者雇用開発助成金", type: "助成金", summary: "高年齢者(60歳以上)・障害者・母子家庭の母等をハローワーク紹介で継続雇用すると支給。企業規模を問わず対象(中小企業とそれ以外で支給額が異なる)。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業", "中堅企業", "大企業"] },
  { key: "ryoritsu", name: "両立支援等助成金(育児休業等支援コース)", type: "助成金", summary: "中小企業が育休復帰支援プランを作成し育児休業取得・職場復帰を支援すると支給。中小企業事業主のみ対象。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
  { key: "kaizen", name: "業務改善助成金", type: "助成金", summary: "事業場内最低賃金を50円以上引き上げ、生産性向上設備を導入する中小企業・小規模事業者に費用の3/4〜4/5を助成。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
  { key: "jinzai", name: "人材開発支援助成金(人材育成支援コース)", type: "助成金", summary: "従業員に10時間以上の研修・訓練を実施した事業主に経費・賃金を助成。企業規模を問わず対象(中小企業は助成率優遇)。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業", "中堅企業", "大企業"] },
  { key: "shokei", name: "事業承継・M&A補助金(事業承継促進枠)", type: "補助金", summary: "5年以内に親族内承継・従業員承継を予定する中小企業・小規模事業者の設備投資等を補助。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
  { key: "koreisha", name: "65歳超雇用推進助成金(65歳超継続雇用促進コース)", type: "助成金", summary: "65歳以上への定年引上げ・定年廃止・66歳以上の継続雇用制度導入等を行った事業主に支給。企業規模を問わず対象。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業", "中堅企業", "大企業"] },
  { key: "telework", name: "人材確保等支援助成金(テレワークコース)", type: "助成金", summary: "テレワーク制度を新規導入・拡大した中小企業事業主に支給。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
  { key: "hatarakikata", name: "働き方改革推進支援助成金(労働時間短縮・年休促進支援コース)", type: "助成金", summary: "残業削減・年次有給休暇の取得促進等に取り組む中小企業事業主の経費を助成。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
  { key: "kaigo", name: "両立支援等助成金(介護離職防止支援コース)", type: "助成金", summary: "中小企業が介護支援プランを作成し、介護休業取得・仕事と介護の両立を支援すると支給。", eligibleSizes: ["個人事業主", "小規模事業者", "中小企業"] },
];

const PROGRAM_KEYS = PROGRAM_SUMMARIES.map((p) => p.key);
const SIZE_CATEGORIES = ["個人事業主", "小規模事業者", "中小企業", "中堅企業", "大企業", "不明"];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    company: {
      type: "object",
      properties: {
        companyName: { type: "string" },
        industry: { type: "string" },
        scaleGuess: { type: "string" },
        sizeCategory: { type: "string", enum: SIZE_CATEGORIES },
        attributes: { type: "array", items: { type: "string" } },
      },
      required: ["companyName", "industry", "scaleGuess", "sizeCategory", "attributes"],
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

const HTML_ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
function decodeEntities(s) {
  return s.replace(/&([a-zA-Z#0-9]+);/g, (m, name) => HTML_ENTITY_MAP[name] || " ");
}
function extractMetaContent(html, attrName, attrValue) {
  const re1 = new RegExp(`<meta[^>]+${attrName}=["']${attrValue}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attrName}=["']${attrValue}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : "";
}
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
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

    // <head>内のSEOメタ情報を先に抽出する。JS描画のSPA(React/Vue等)ではbody本文がほぼ空のことが多く、
    // <title>やmeta descriptionが唯一のまとまった手がかりになるケースがあるため、タグ除去より先に拾っておく。
    const title = extractTitle(html);
    const metaDescription = extractMetaContent(html, "name", "description");
    const ogDescription = extractMetaContent(html, "property", "og:description");
    const metaKeywords = extractMetaContent(html, "name", "keywords");

    // scriptとstyleを除去し、タグをスペースに置換して本文テキスト化
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-zA-Z#0-9]+;/g, (m, ..._args) => decodeEntities(m))
      .replace(/\s+/g, " ")
      .trim();

    const parts = [];
    if (title) parts.push(`ページタイトル: ${title}`);
    if (metaDescription) parts.push(`meta description: ${metaDescription}`);
    if (ogDescription && ogDescription !== metaDescription) parts.push(`OGP description: ${ogDescription}`);
    if (metaKeywords) parts.push(`meta keywords: ${metaKeywords}`);
    if (bodyText) parts.push(`本文抜粋: ${bodyText.slice(0, 5000)}`);

    const combined = parts.join("\n");
    return combined ? combined.slice(0, 6000) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleAnalyzeCompany(request, env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: "サーバー設定エラー(APIキー未設定)" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエスト形式が不正です" }, 400);
  }

  const url = typeof body.url === "string" ? body.url.trim().slice(0, 500) : "";
  const registryProfile = body.registryProfile && typeof body.registryProfile === "object" ? body.registryProfile : null;
  if (!url) return jsonResponse({ error: "会社ホームページのURLを入力してください" }, 400);

  if (!isFetchableUrl(url)) return jsonResponse({ error: "このURLは解析できません" }, 400);
  const siteText = await fetchCompanyText(url);

  const catalog = PROGRAM_SUMMARIES.map(
    (p) => `- key: ${p.key} / ${p.name}(${p.type}): ${p.summary} [対象規模: ${p.eligibleSizes.join("・")}]`
  ).join("\n");

  let registryText = "";
  if (registryProfile && (registryProfile.capitalStock != null || registryProfile.employeeNumber != null)) {
    registryText = "【法人番号(gBizINFO/経済産業省)で確認した公的データ・最優先で信頼すること】\n"
      + (registryProfile.name ? `法人名: ${String(registryProfile.name).slice(0, 200)}\n` : "")
      + (registryProfile.capitalStock != null ? `資本金: ${registryProfile.capitalStock}円\n` : "")
      + (registryProfile.employeeNumber != null ? `従業員数: ${registryProfile.employeeNumber}人\n` : "")
      + (registryProfile.businessSummary ? `事業概要: ${String(registryProfile.businessSummary).slice(0, 500)}\n` : "");
  }

  const companyInfo = [
    registryText,
    siteText ? `【会社ホームページの本文抜粋】\n${siteText}` : "【会社ホームページ】取得できませんでした(公的データのみで推定してください)",
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
      temperature: 0,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RESPONSE_SCHEMA },
      },
      system:
        "あなたは日本の補助金・助成金の一次スクリーニングを行うアシスタントです。" +
        "与えられた会社情報から会社名・業種・規模・取り組み予定を推定し、制度カタログの中から活用できる可能性のある制度を選びます。\n\n" +
        "【企業規模の判定(sizeCategory)は特に厳密に行うこと】\n" +
        "- 個人事業主: 法人化していない事業者\n" +
        "- 小規模事業者: 従業員が概ね20人以下(商業・サービス業は5人以下)の小さな事業者\n" +
        "- 中小企業: 中小企業基本法の基準内(業種により資本金3億円以下または従業員300人以下等)\n" +
        "- 中堅企業: 中小企業基本法の基準は超えるが、大企業ほどの規模ではない事業者\n" +
        "- 大企業: 誰もが知る大手企業・上場企業・鉄道会社/大手メーカー/大手小売等、従業員数百〜数千人規模以上、または資本金が中小企業基準を明確に超える事業者\n" +
        "- 不明: 会社情報から規模がまったく判断できない場合のみ\n" +
        "【法人番号(gBizINFO)で確認した公的データが提供されている場合】資本金・従業員数の数値は推測ではなく確認済みの事実であるため、これを最優先の根拠として中小企業基本法の基準(業種によって異なるが、資本金3億円以下または従業員300人以下なら概ね中小企業、卸売業は資本金1億円以下/従業員100人以下、小売業は資本金5千万円以下/従業員50人以下、サービス業は資本金5千万円以下/従業員100人以下)と照らしてsizeCategoryを判定すること。\n" +
        "大企業・有名企業のホームページだと分かる場合(会社概要ページの記載、規模の大きさが明らかな事業内容、上場・グループ会社である旨の記載等)は、控えめにではなく明確に「大企業」と判定すること。誤って中小企業向け制度を大企業に勧めることは絶対に避けること。\n\n" +
        "【制度マッチングのルール】\n" +
        "各制度には[対象規模]が明記されています。会社のsizeCategoryがその制度の対象規模に含まれない場合、その制度を絶対にmatchesに含めないこと。これは最優先の絶対ルールであり、事業内容がどれだけ合致していても規模が対象外なら除外する。\n" +
        "規模以外の要件(業種・取り組み内容)についても、確実に対象外と判断できる制度は含めない。判断材料が乏しい場合は attributes にその旨を含め、マッチは控えめにする。\n" +
        "reason は必ず日本語で、その会社の情報のどこから判断したかが分かるように書くこと。マッチは0〜6件程度。",
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

  // 安全のための機械的フィルタ: AIの判断に加えて、対象規模から明確に外れる制度は必ず除外する
  // (例: 大企業が「小規模事業者持続化補助金」等にマッチしてしまう誤りを防ぐ)
  const sizeCategory = parsed.company && parsed.company.sizeCategory;
  let matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  if (sizeCategory && sizeCategory !== "不明") {
    matches = matches.filter((m) => {
      const summary = PROGRAM_SUMMARIES.find((p) => p.key === m.programKey);
      return summary ? summary.eligibleSizes.includes(sizeCategory) : true;
    });
  }

  return jsonResponse({
    company: parsed.company,
    matches,
    disclaimer: "この結果はAIによる推定であり、対象可否を保証するものではありません。必ず各制度の公募要領・支給要領をご確認ください。",
  });
}
