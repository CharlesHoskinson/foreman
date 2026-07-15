#!/usr/bin/env python3
"""Cloudflare 反爬绕过模板
用途: 有 Cloudflare/WAF 保护的网站
替换: URL, COOKIES(可选), CSS_SELECTOR
"""
from scrapling.fetchers import StealthyFetcher

URL = "{{URL}}"
COOKIES = {{COOKIES}}  # None 或 [{'name': ..., 'value': ..., 'domain': ..., 'path': '/'}]
CSS_SELECTOR = "{{CSS_SELECTOR}}"

page = StealthyFetcher.fetch(
    URL,
    headless=True,
    solve_cloudflare=True,
    cookies=COOKIES,
    timeout=60000,
    network_idle=True,
)

print(f"Status: {page.status}")

if CSS_SELECTOR:
    results = page.css(CSS_SELECTOR).getall()
    for r in results:
        print(r)
else:
    print(page.get_all_text(strip=True)[:2000])
