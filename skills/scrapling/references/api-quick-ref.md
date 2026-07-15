# Scrapling API 速查卡

## Fetcher（基于 curl_cffi，最快）

```python
from scrapling.fetchers import Fetcher

# GET 请求
page = Fetcher.get(url, impersonate='chrome', timeout=30, headers=None, cookies=None)

# POST 请求
page = Fetcher.post(url, data=None, json=None, impersonate='chrome', timeout=30)
```

**Cookie 格式**: `dict` — `{'name': 'value'}`
**超时单位**: 秒

## FetcherSession（保持会话 cookie）

```python
from scrapling.fetchers import FetcherSession

with FetcherSession(impersonate='chrome') as s:
    s.post(login_url, data={'user': '...', 'pass': '...'})
    page = s.get(target_url)
```

## StealthyFetcher（Camoufox，绕过反爬）

```python
from scrapling.fetchers import StealthyFetcher

page = StealthyFetcher.fetch(
    url,
    headless=True,           # 无头模式
    solve_cloudflare=True,   # 自动过 Cloudflare
    cookies=None,            # list[dict] 格式
    timeout=60000,           # 毫秒
    network_idle=True,       # 等待网络空闲
    hide_canvas=True,        # 隐藏 canvas 指纹
    block_webrtc=True,       # 阻止 WebRTC 泄露 IP
    disable_resources=False, # 禁用图片/字体加速
)
```

**Cookie 格式**: `list[dict]` — `[{'name': 'n', 'value': 'v', 'domain': '.site.com', 'path': '/'}]`
**超时单位**: 毫秒

## DynamicFetcher（Playwright，JS 渲染）

```python
from scrapling.fetchers import DynamicFetcher

page = DynamicFetcher.fetch(
    url,
    headless=True,
    cookies=None,            # list[dict] 格式
    timeout=30000,           # 毫秒
    network_idle=True,       # 等待网络空闲
    wait_selector=None,      # 等待特定元素出现
    disable_resources=True,  # 跳过图片/字体/CSS 加速
)
```

**Cookie 格式**: `list[dict]`
**超时单位**: 毫秒

## Selector（纯 HTML 解析，无网络请求）

```python
from scrapling.parser import Selector

page = Selector(html_string, url='https://base-url.com')
```

## Response 常用属性

```python
page.status          # HTTP 状态码 (int)
page.text            # 原始 HTML/文本内容 (str)
page.url             # 最终 URL（可能经过重定向）
page.cookies         # 响应 cookie
page.headers         # 响应头
```

## 选择器方法

```python
# CSS 选择器
page.css('div.content')              # 返回元素列表
page.css_first('h1')                 # 返回第一个匹配元素

# XPath 选择器
page.xpath('//div[@class="content"]')

# 文本提取伪元素
page.css('h1::text')                 # 提取文本内容
page.css('a::attr(href)')            # 提取属性值

# 获取所有匹配结果的文本
results = page.css('h1::text').getall()  # list[str]

# 获取第一个匹配结果的文本
result = page.css('h1::text').get()      # str | None
```

## 元素方法

```python
element = page.css_first('div.post')

element.text                          # 直接子文本
element.get_all_text(strip=True)      # 递归获取所有文本
element.attrib                        # 属性字典
element.attrib.get('href')            # 获取单个属性
element.css('span.author::text')      # 在子树中继续选择
element.parent                        # 父元素
element.children                      # 子元素列表
```

## 正则提取

```python
# 从文本中提取匹配
page.re(r'price: \$(\d+\.\d+)')      # list[str] — 所有匹配
page.re_first(r'price: \$(\d+\.\d+)')  # str | None — 第一个匹配
```
