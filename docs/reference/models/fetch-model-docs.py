#!/usr/bin/env python3
"""Pin vendor model documentation locally via Scrapling. Output: docs/reference/models/raw/*.md"""
import pathlib, sys, re, json
from scrapling.fetchers import Fetcher

OUT = pathlib.Path('/home/charl/foreman/docs/reference/models/raw')
OUT.mkdir(parents=True, exist_ok=True)

TARGETS = {
 'grok-4.5': ['https://docs.x.ai/docs/models', 'https://docs.x.ai/docs/overview'],
 'gpt-5.6': ['https://developers.openai.com/api/docs/models/gpt-5.6-luna',
             'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
             'https://openai.com/index/gpt-5-6/'],
 'gemini': ['https://ai.google.dev/gemini-api/docs/models',
            'https://ai.google.dev/gemini-api/docs/pricing'],
 'claude': ['https://docs.claude.com/en/docs/about-claude/models/overview',
            'https://docs.claude.com/en/docs/about-claude/pricing'],
}

index = {}
for family, urls in TARGETS.items():
    for u in urls:
        slug = family + '--' + re.sub(r'[^a-z0-9]+','-', u.split('://')[1].lower()).strip('-')
        dest = OUT / f'{slug}.md'
        try:
            page = Fetcher.get(u, timeout=60)
            text = page.get_all_text(ignore_tags=('script','style'))
            status = page.status
        except Exception as e:
            text, status = f'FETCH-ERROR: {e}', None
        dest.write_text(f'# source: {u}\n# status: {status}\n\n{text}\n', encoding='utf-8')
        ok = status == 200 and not text.startswith('FETCH-ERROR')
        index[u] = {'family': family, 'file': dest.name, 'status': status,
                    'bytes': len(text), 'ok': bool(ok)}
        print(f'{"ok " if ok else "FAIL"} {status} {len(text):>7}B  {u}', flush=True)

(OUT.parent / 'fetch-index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
print('WROTE', OUT.parent / 'fetch-index.json')
