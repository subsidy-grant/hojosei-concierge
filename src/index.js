import { handleAnalyzeCompany } from "./analyze-company.js";
import { handleDraft } from "./draft.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/analyze-company") {
      return handleAnalyzeCompany(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/draft") {
      return handleDraft(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
