#!/usr/bin/env python3
"""基础 HTTP 抓取模板
用途: 静态页面抓取，无 JS 渲染，无反爬保护
替换: URL, CSS_SELECTOR, 输出处理逻辑
"""
from scrapling.fetchers import Fetcher

URL = "{{URL}}"
CSS_SELECTOR = "{{CSS_SELECTOR}}"  # 如 '.article h1::text'

page = Fetcher.get(URL, impersonate='chrome', timeout=30)
print(f"Status: {page.status}")

if CSS_SELECTOR:
    results = page.css(CSS_SELECTOR).getall()
    for r in results:
        print(r)
else:
    print(page.get_all_text(strip=True)[:2000])
