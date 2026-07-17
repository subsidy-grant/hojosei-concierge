// POST /api/lookup-corporate
// 法人番号(13桁)から gBizINFO(経済産業省) の法人情報APIで業種・従業員数・資本金を取得し、
// /api/analyze-company の企業プロフィール推定を補完するための「確認済みデータ」として使う。
//
// 国税庁 法人番号公表サイトのWeb-APIは商号・所在地・法人番号のみを提供し、
// 従業員数・資本金・業種は含まれないため、本サービスでは gBizINFO を利用する。
// 利用には無料の事前申請(https://info.gbiz.go.jp/hojin/various_registration/form)が必要で、
// 取得したトークンを Cloudflare の環境変数 GBIZINFO_API_TOKEN に設定する(リポジトリには置かない)。

const GBIZINFO_ENDPOINT = "https://info.gbiz.go.jp/hojin/v1/hojin/";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function isValidCorporateNumber(v) {
  return typeof v === "string" && /^\d{13}$/.test(v);
}

export async function handleLookupCorporate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエスト形式が不正です" }, 400);
  }

  const corporateNumber = typeof body.corporateNumber === "string" ? body.corporateNumber.trim() : "";
  if (!isValidCorporateNumber(corporateNumber)) {
    return jsonResponse({ error: "法人番号は数字13桁で入力してください" }, 400);
  }

  const token = env.GBIZINFO_API_TOKEN;
  if (!token) {
    // デモ環境でトークン未設定の場合は、機能を無効化した旨を伝えるだけでエラー扱いにしない
    // (URL入力のみでも制度検索フローは成立するため)
    return jsonResponse({
      available: false,
      message: "法人番号による自動補完は現在利用できません。ホームページURLの入力のみでお進みください。",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(GBIZINFO_ENDPOINT + corporateNumber, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-hojinInfo-api-token": token,
      },
    });
  } catch {
    clearTimeout(timer);
    return jsonResponse({ available: true, found: false, message: "法人情報の取得に失敗しました(通信エラー)。時間をおいて再度お試しください。" }, 502);
  }
  clearTimeout(timer);

  if (res.status === 404) {
    return jsonResponse({ available: true, found: false, message: "指定の法人番号に該当する法人情報が見つかりませんでした。" });
  }
  if (!res.ok) {
    return jsonResponse({ available: true, found: false, message: "法人情報の取得に失敗しました。時間をおいて再度お試しください。" }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return jsonResponse({ available: true, found: false, message: "法人情報の形式が不正でした。" }, 502);
  }

  const info = Array.isArray(data["hojin-infos"]) ? data["hojin-infos"][0] : null;
  if (!info) {
    return jsonResponse({ available: true, found: false, message: "指定の法人番号に該当する法人情報が見つかりませんでした。" });
  }

  return jsonResponse({
    available: true,
    found: true,
    profile: {
      corporateNumber,
      name: info.name || null,
      capitalStock: typeof info.capital_stock === "number" ? info.capital_stock : null,
      employeeNumber: typeof info.employee_number === "number" ? info.employee_number : null,
      businessSummary: info.business_summary || null,
      companyUrl: info.company_url || null,
    },
    disclaimer: "gBizINFO(経済産業省)で公開されている情報です。最新でない場合があるため参考情報としてご利用ください。",
  });
}
