#!/usr/bin/env python3
"""Session 登录 + 多页抓取模板
用途: 需要登录后才能访问的页面，基于 HTTP（无 JS 登录表单）
替换: LOGIN_URL, LOGIN_DATA, TARGET_URLS
"""
from scrapling.fetchers import FetcherSession

LOGIN_URL = "{{LOGIN_URL}}"
LOGIN_DATA = {{LOGIN_DATA}}  # {'username': '...', 'password': '...'}
TARGET_URLS = {{TARGET_URLS}}  # ['https://site.com/page1', ...]

with FetcherSession(impersonate='chrome') as s:
    login_resp = s.post(LOGIN_URL, data=LOGIN_DATA)
    print(f"Login status: {login_resp.status}")

    for url in TARGET_URLS:
        page = s.get(url)
        print(f"\n--- {url} (status: {page.status}) ---")
        print(page.get_all_text(strip=True)[:1000])
