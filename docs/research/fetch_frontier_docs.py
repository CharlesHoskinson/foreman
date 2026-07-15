"""Fetch frontier coding-agent docs via scrapling for Foreman QA."""
from pathlib import Path
import json
import re
import traceback

out_dir = Path(r"C:\Users\charl\foreman\docs\research")
out_dir.mkdir(parents=True, exist_ok=True)

urls = [
    ("anthropic_subagents", "https://code.claude.com/docs/en/sub-agents"),
    ("anthropic_best_practices", "https://code.claude.com/docs/en/best-practices"),
    ("anthropic_agent_teams", "https://code.claude.com/docs/en/agent-teams"),
    ("anthropic_cli_ref", "https://code.claude.com/docs/en/cli-reference"),
    ("anthropic_skills", "https://code.claude.com/docs/en/skills"),
    ("anthropic_advisor_tool", "https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool"),
    ("anthropic_multi_agent", "https://platform.claude.com/docs/en/managed-agents/multi-agent"),
    ("openai_codex_cli", "https://developers.openai.com/codex/cli"),
    ("openai_codex_exec", "https://developers.openai.com/codex/cli/reference"),
    ("openai_codex_sandbox", "https://developers.openai.com/codex/cli/sandbox"),
    ("openai_codex_review", "https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk"),
    ("xai_grok_build", "https://docs.x.ai/build/overview"),
    ("xai_grok_headless", "https://docs.x.ai/build/cli/headless-scripting"),
    ("xai_grok_news", "https://x.ai/news/grok-build-cli"),
    ("agentskills_spec", "https://agentskills.io"),
    ("agentskills_spec_github", "https://github.com/agentskills/agentskills"),
    ("fable_advisor", "https://github.com/DannyMac180/fable-advisor"),
]

results = []

try:
    from scrapling.fetchers import Fetcher
except Exception as e:
    print("Fetcher import failed:", e)
    raise

for key, url in urls:
    item = {"key": key, "url": url, "ok": False, "status": None, "chars": 0, "excerpt": "", "error": None}
    try:
        page = Fetcher.get(url, stealthy_headers=True, timeout=45)
        # scrapling Selector-like page
        status = getattr(page, "status", None) or getattr(page, "status_code", None)
        text = ""
        if hasattr(page, "get_all_text"):
            text = page.get_all_text(ignore_tags=("script", "style"))
        elif hasattr(page, "body"):
            text = str(page.body)
        else:
            text = str(page)
        # normalize whitespace
        text = re.sub(r"\s+", " ", text).strip()
        item["status"] = status
        item["chars"] = len(text)
        item["ok"] = len(text) > 200
        item["excerpt"] = text[:6000]
        (out_dir / f"{key}.txt").write_text(text[:50000], encoding="utf-8", errors="replace")
        print(f"OK {key}: status={status} chars={len(text)}")
    except Exception as e:
        item["error"] = f"{type(e).__name__}: {e}"
        print(f"FAIL {key}: {item['error']}")
        traceback.print_exc()
    results.append(item)

(out_dir / "fetch-index.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print("DONE", len(results), "urls")
