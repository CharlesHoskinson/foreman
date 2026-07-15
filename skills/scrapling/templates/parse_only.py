#!/usr/bin/env python3
"""纯 HTML 解析模板（不需要 fetchers 依赖）
用途: 已有 HTML 内容（来自 WebFetch/文件/API），只需解析提取
替换: HTML_SOURCE, BASE_URL, CSS_SELECTOR
"""
from scrapling.parser import Selector

HTML_SOURCE = """{{HTML}}"""
# 或从文件读取: HTML_SOURCE = open('page.html').read()

page = Selector(HTML_SOURCE, url='{{BASE_URL}}')

results = page.css('{{CSS_SELECTOR}}')
for item in results:
    print(item.get_all_text(strip=True))
