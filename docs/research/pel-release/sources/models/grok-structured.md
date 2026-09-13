---
source_url: "https://docs.x.ai/developers/model-capabilities/text/structured-outputs"
captured_at: "2026-09-13T03:01:25.734693+00:00"
contributor: "Foreman release research; Scrapling"
---

#### [Model Capabilities](#model-capabilities)

# [Structured Outputs](#structured-outputs)

Copy for LLM[View as Markdown](/developers/model-capabilities/text/structured-outputs.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-model-capabilities-text-structured-outputs&utm_content=article-api-key)[Try Playground](https://console.x.ai/team/default/chat?utm_source=docs&utm_medium=referral&utm_campaign=developers-model-capabilities-text-structured-outputs&utm_content=playground-cta)[Meet grok-4.6](https://x.ai/news/grok-4-6)

Structured Outputs lets the API return responses in a specific format,
for example, a JSON object matching a schema you define instead of free-form
text. This feature is especially useful for tasks like document parsing, entity
extraction, and report generation.

When using supported schema features, the response is *guaranteed* to match your schema.

There are two ways to request structured outputs from the model.

The primary and most flexible method is to use the `response_format` parameter. By setting `response_format.type` to `"json_schema"` and providing your schema under `response_format.json_schema`, you can define exactly what structured output the model should return. The parameter also accepts `"json_object"` for any well-formed JSON when you don't need a specific structure, or `"text"` (the default) for free-form text.

The second way is through tool calling. When you define tools, xAI models will always generate tool call arguments that strictly conform to the tool’s input JSON Schema (the `strict` flag is implicitly always `true`).

Tool schemas follow the same JSON Schema support rules described on this page. See the [Function Calling](/developers/tools/function-calling) documentation for full details.

You can define schemas using libraries like
[Pydantic](https://pydantic.dev/) or [Zod](https://zod.dev/).

## [JSON Schema support](#json-schema-support)

We support a practical subset of JSON Schema. Schemas authored against Draft 2020-12 work best; Draft-07 schemas are also accepted.

### [Supported types](#supported-types)

* `string`
* `number`
* `integer`
* `boolean`
* `null`
* `enum`
* `const`
* `array`
* `object`
* `anyOf`
* `oneOf` (behaves identically to `anyOf`)
* `allOf` (single subschema only; see [Best-effort keywords](#best-effort-keywords) for multiple)
* `$ref` / `$defs` (non-circular references only)

`additionalProperties` defaults to `false` and must be set to `true` explicitly.

To make a field nullable, use a type array (`{"type": ["string", "null"]}`) or an `anyOf` variant that includes `null`. Fields not listed in `required` are treated as optional.

### [String formats](#string-formats)

The `format` keyword is enforced for these values:

`date` · `time` · `date-time` · `email` · `uuid` · `ipv4` · `ipv6` · `uri`

Other `format` values are accepted but not enforced (see [Best-effort keywords](#best-effort-keywords)).

### [Constraint limits](#constraint-limits)

The following constraints are enforced by the output engine up to
the thresholds below. Schemas exceeding these limits are still accepted,
but conformance relies on model behavior.

| Keyword | Guaranteed up to |
| --- | --- |
| `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` | No limit |
| `minLength` / `maxLength` | 2,048 |
| `minItems` / `maxItems` | 256 |
| `minProperties` / `maxProperties` | 64 |

### [Best-effort keywords](#best-effort-keywords)

These keywords are accepted but not structurally enforced; the model
handles them and does so reliably in practice, but outputs are not
guaranteed to satisfy these constraints. We recommend validating
if strict conformance is required.

* `not`
* `if` / `then` / `else`
* `allOf` with more than one subschema
* `format` values not listed under [String formats](#string-formats)
* Constraints exceeding the limits above

### [Rejected schemas](#rejected-schemas)

The following will return a `400` error:

* `enum` or `anyOf` with zero variants
* Properties with a schema of `true` or `false`
* `maxContains` / `minContains`
* `items` as an array (use `prefixItems` for tuple validation)

### [Regex support (`pattern`)](#regex-support-pattern)

When using the `pattern` keyword on a string field, we support a practical subset of ECMAScript Regular Expressions (ECMA-262).

**Supported:**

* Literals and character classes (`[abc]`, `[a-z]`, `[^abc]`)
* `.` (matches any Unicode codepoint, including newlines)
* Alternation `|`, grouping `(...)`, and non-capturing groups `(?:...)`
* Quantifiers `*`, `+`, `?` and repetition ranges `{n}`, `{n,}`, `{n,m}`
* Shorthand classes `\d`, `\w`, `\s` (and their negations `\D`, `\W`, `\S`)
* Common escapes: `\n`, `\t`, `\r`, `\f`, `\xHH`, `\uHHHH`, `\u{HHHHHH}`

**Not supported:**

* Backreferences (`\1`, `\k<name>`, etc.)
* Unicode property escapes (`\p{L}`, `\P{Letter}`)
* Word boundaries (`\b`, `\B`)
* Lookahead and lookbehind (`(?=...)`, `(?<=...)`, etc.)
* Inline modifiers (`(?i)`, `(?m)`, etc.)
* Conditional expressions and other advanced constructs

**Semantic differences from standard JavaScript RegExp:**

* `.` matches newlines
* `^` and `$` are *implicit*—the pattern always matches the *entire string* (no need to add them)
* Capturing groups `(...)` have no semantic effect (they behave like non-capturing groups)
* The regex is evaluated with Unicode support

---

## [Example: Invoice Parsing](#example-invoice-parsing)

A common use case for Structured Outputs is parsing raw documents. For example, invoices contain structured data like vendor details, amounts, and dates, but extracting this data from raw text can be error-prone. Structured Outputs ensures the extracted data matches a predefined schema.

Let's say you want to extract the following data from an invoice:

* Vendor name and address
* Invoice number and date
* Line items (description, quantity, price)
* Total amount and currency

We'll use structured outputs to have Grok generate a strongly typed JSON for this.

---

### [Step 1: Defining the Schema](#step-1-defining-the-schema)

You can use [Pydantic](https://pydantic.dev/) or [Zod](https://zod.dev/) to define your schema.

PythonJavaScript

```
from datetime import date
from enum import Enum

from pydantic import BaseModel, Field

class Currency(str, Enum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"

class LineItem(BaseModel):
    description: str = Field(description="Description of the item or service")
    quantity: int = Field(description="Number of units", ge=1)
    unit_price: float = Field(description="Price per unit", ge=0)

class Address(BaseModel):
    street: str = Field(description="Street address")
    city: str = Field(description="City")
    postal_code: str = Field(description="Postal/ZIP code")
    country: str = Field(description="Country")

class Invoice(BaseModel):
    vendor_name: str = Field(description="Name of the vendor")
    vendor_address: Address = Field(description="Vendor's address")
    invoice_number: str = Field(description="Unique invoice identifier")
    invoice_date: date = Field(description="Date the invoice was issued")
    line_items: list[LineItem] = Field(description="List of purchased items/services")
    total_amount: float = Field(description="Total amount due", ge=0)
    currency: Currency = Field(description="Currency of the invoice")
```

```
import { z } from "zod";

const CurrencyEnum = z.enum(["USD", "EUR", "GBP"]);

const LineItemSchema = z.object({
    description: z.string().describe("Description of the item or service"),
    quantity: z.number().int().min(1).describe("Number of units"),
    unit_price: z.number().min(0).describe("Price per unit"),
});

const AddressSchema = z.object({
    street: z.string().describe("Street address"),
    city: z.string().describe("City"),
    postal_code: z.string().describe("Postal/ZIP code"),
    country: z.string().describe("Country"),
});

const InvoiceSchema = z.object({
    vendor_name: z.string().describe("Name of the vendor"),
    vendor_address: AddressSchema.describe("Vendor's address"),
    invoice_number: z.string().describe("Unique invoice identifier"),
    invoice_date: z.string().date().describe("Date the invoice was issued"),
    line_items: z.array(LineItemSchema).describe("List of purchased items/services"),
    total_amount: z.number().min(0).describe("Total amount due"),
    currency: CurrencyEnum.describe("Currency of the invoice"),
});
```

---

### [Step 2: Prepare The Prompts](#step-2-prepare-the-prompts)

### [System Prompt](#system-prompt)

The system prompt instructs the model to extract invoice data from text. Since the schema is defined separately, the prompt can focus on the task without explicitly specifying the required fields in the output JSON.

Text

```
Given a raw invoice, carefully analyze the text and extract the relevant invoice data into JSON format.
```

### [Example Invoice Text](#example-invoice-text)

Text

```
Vendor: Acme Corp, 123 Main St, Springfield, IL 62704
Invoice Number: INV-2025-001
Date: 2025-02-10
Items:
- Widget A, 5 units, $10.00 each
- Widget B, 2 units, $15.00 each
Total: $80.00 USD
```

---

### [Step 3: The Final Code](#step-3-the-final-code)

Use the structured outputs feature of the SDK to parse the invoice.

PythonPython (OpenAI)JavaScript (OpenAI) JavaScript

```
import os
from datetime import date
from enum import Enum

from pydantic import BaseModel, Field

from xai_sdk import Client
from xai_sdk.chat import system, user

# Pydantic Schemas

class Currency(str, Enum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"

class LineItem(BaseModel):
    description: str = Field(description="Description of the item or service")
    quantity: int = Field(description="Number of units", ge=1)
    unit_price: float = Field(description="Price per unit", ge=0)

class Address(BaseModel):
    street: str = Field(description="Street address")
    city: str = Field(description="City")
    postal_code: str = Field(description="Postal/ZIP code")
    country: str = Field(description="Country")

class Invoice(BaseModel):
    vendor_name: str = Field(description="Name of the vendor")
    vendor_address: Address = Field(description="Vendor's address")
    invoice_number: str = Field(description="Unique invoice identifier")
    invoice_date: date = Field(description="Date the invoice was issued")
    line_items: list[LineItem] = Field(description="List of purchased items/services")
    total_amount: float = Field(description="Total amount due", ge=0)
    currency: Currency = Field(description="Currency of the invoice")

client = Client(api_key=os.getenv("XAI_API_KEY"))
chat = client.chat.create(model="grok-4.6")

chat.append(system("Given a raw invoice, carefully analyze the text and extract the invoice data into JSON format."))
chat.append(
user("""
Vendor: Acme Corp, 123 Main St, Springfield, IL 62704
Invoice Number: INV-2025-001
Date: 2025-02-10
Items: - Widget A, 5 units, $10.00 each - Widget B, 2 units, $15.00 each
Total: $80.00 USD
""")
)

# The parse method returns a tuple of the full response object as well as the parsed pydantic object.

response, invoice = chat.parse(Invoice)
assert isinstance(invoice, Invoice)

# Can access fields of the parsed invoice object directly

print(invoice.vendor_name)
print(invoice.invoice_number)
print(invoice.invoice_date)
print(invoice.line_items)
print(invoice.total_amount)
print(invoice.currency)

# Can also access fields from the raw response object such as the content.

# In this case, the content is the JSON schema representation of the parsed invoice object

print(response.content)
```

```
from openai import OpenAI

from pydantic import BaseModel, Field
from datetime import date
from enum import Enum

# Pydantic Schemas

class Currency(str, Enum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"

class LineItem(BaseModel):
    description: str = Field(description="Description of the item or service")
    quantity: int = Field(description="Number of units", ge=1)
    unit_price: float = Field(description="Price per unit", ge=0)

class Address(BaseModel):
    street: str = Field(description="Street address")
    city: str = Field(description="City")
    postal_code: str = Field(description="Postal/ZIP code")
    country: str = Field(description="Country")

class Invoice(BaseModel):
    vendor_name: str = Field(description="Name of the vendor")
    vendor_address: Address = Field(description="Vendor's address")
    invoice_number: str = Field(description="Unique invoice identifier")
    invoice_date: date = Field(description="Date the invoice was issued")
    line_items: list[LineItem] = Field(description="List of purchased items/services")
    total_amount: float = Field(description="Total amount due", ge=0)
    currency: Currency = Field(description="Currency of the invoice")

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
)

completion = client.beta.chat.completions.parse(
    model="grok-4.6",
    messages=[
    {"role": "system", "content": "Given a raw invoice, carefully analyze the text and extract the invoice data into JSON format."},
    {"role": "user", "content": """
    Vendor: Acme Corp, 123 Main St, Springfield, IL 62704
    Invoice Number: INV-2025-001
    Date: 2025-02-10
    Items:

    - Widget A, 5 units, $10.00 each
    - Widget B, 2 units, $15.00 each
      Total: $80.00 USD
      """}
      ],
      response_format=Invoice,
  )

invoice = completion.choices[0].message.parsed
print(invoice)
```

```
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

const CurrencyEnum = z.enum(["USD", "EUR", "GBP"]);

const LineItemSchema = z.object({
    description: z.string().describe("Description of the item or service"),
    quantity: z.number().int().min(1).describe("Number of units"),
    unit_price: z.number().min(0).describe("Price per unit"),
});

const AddressSchema = z.object({
    street: z.string().describe("Street address"),
    city: z.string().describe("City"),
    postal_code: z.string().describe("Postal/ZIP code"),
    country: z.string().describe("Country"),
});

const InvoiceSchema = z.object({
    vendor_name: z.string().describe("Name of the vendor"),
    vendor_address: AddressSchema.describe("Vendor's address"),
    invoice_number: z.string().describe("Unique invoice identifier"),
    invoice_date: z.string().date().describe("Date the invoice was issued"),
    line_items: z.array(LineItemSchema).describe("List of purchased items/services"),
    total_amount: z.number().min(0).describe("Total amount due"),
    currency: CurrencyEnum.describe("Currency of the invoice"),
});

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
});

const completion = await client.chat.completions.parse({
    model: "grok-4.6",
    messages: [
    { role: "system", content: "Given a raw invoice, carefully analyze the text and extract the invoice data into JSON format." },
    { role: "user", content: `
    Vendor: Acme Corp, 123 Main St, Springfield, IL 62704
    Invoice Number: INV-2025-001
    Date: 2025-02-10
    Items:

    - Widget A, 5 units, $10.00 each
    - Widget B, 2 units, $15.00 each
      Total: $80.00 USD
      ` },
    ],
    response_format: zodResponseFormat(InvoiceSchema, "invoice"),
});

const invoice = completion.choices[0].message.parsed;
console.log(invoice);
```

```
import { xai } from '@ai-sdk/xai';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const CurrencyEnum = z.enum(['USD', 'EUR', 'GBP']);

const LineItemSchema = z.object({
  description: z.string().describe('Description of the item or service'),
  quantity: z.number().int().min(1).describe('Number of units'),
  unit_price: z.number().min(0).describe('Price per unit'),
});

const AddressSchema = z.object({
  street: z.string().describe('Street address'),
  city: z.string().describe('City'),
  postal_code: z.string().describe('Postal/ZIP code'),
  country: z.string().describe('Country'),
});

const InvoiceSchema = z.object({
  vendor_name: z.string().describe('Name of the vendor'),
  vendor_address: AddressSchema.describe("Vendor's address"),
  invoice_number: z.string().describe('Unique invoice identifier'),
  invoice_date: z.string().date().describe('Date the invoice was issued'),
  line_items: z
    .array(LineItemSchema)
    .describe('List of purchased items/services'),
  total_amount: z.number().min(0).describe('Total amount due'),
  currency: CurrencyEnum.describe('Currency of the invoice'),
});

const result = await generateText({
  model: xai.responses('grok-4.6'),
  output: Output.object({ schema: InvoiceSchema }),
  system:
    'Given a raw invoice, carefully analyze the text and extract the invoice data into JSON format.',
  prompt: `
  Vendor: Acme Corp, 123 Main St, Springfield, IL 62704
  Invoice Number: INV-2025-001
  Date: 2025-02-10
  Items:

  - Widget A, 5 units, $10.00 each
  - Widget B, 2 units, $15.00 each
    Total: $80.00 USD
    `,
});

console.log(result._output);
```

---

### [Step 4: Type-safe Output](#step-4-type-safe-output)

When using supported schema features, the output will be type-safe and respect the input schema.

JSON

```
{
  "vendor_name": "Acme Corp",
  "vendor_address": {
    "street": "123 Main St",
    "city": "Springfield",
    "postal_code": "62704",
    "country": "IL"
  },
  "invoice_number": "INV-2025-001",
  "invoice_date": "2025-02-10",
  "line_items": [
    { "description": "Widget A", "quantity": 5, "unit_price": 10.0 },
    { "description": "Widget B", "quantity": 2, "unit_price": 15.0 }
  ],
  "total_amount": 80.0,
  "currency": "USD"
}
```

---

## [Structured Outputs with Tools](#structured-outputs-with-tools)

Structured outputs with tools is only available for supported Grok 4 family models.

You can combine structured outputs with tool calling to get type-safe responses from tool-augmented queries. This works with both:

* **[Agentic tool calling](/developers/tools/overview)**: Server-side tools like web search, X search, and code execution that the model orchestrates autonomously.
* **[Function calling](/developers/tools/function-calling)**: User-supplied tools where you define custom functions and handle tool execution yourself.

This combination enables workflows where the model can use tools to gather information and return results in a predictable, strongly typed format.

### [Example: Agentic Tools with Structured Output](#example-agentic-tools-with-structured-output)

This example uses web search to find the latest research on a topic and extracts structured data into a schema:

PythonJavaScript

```
from pydantic import BaseModel, Field

class ProofInfo(BaseModel):
    name: str = Field(description="Name of the proof or paper")
    authors: str = Field(description="Authors of the proof")
    year: str = Field(description="Year published")
    summary: str = Field(description="Brief summary of the approach")
```

```
import { z } from "zod";

const ProofInfoSchema = z.object({
    name: z.string().describe("Name of the proof or paper"),
    authors: z.string().describe("Authors of the proof"),
    year: z.string().describe("Year published"),
    summary: z.string().describe("Brief summary of the approach"),
});
```

PythonPython (OpenAI)JavaScript (OpenAI)

```
import os
from pydantic import BaseModel, Field

from xai_sdk import Client
from xai_sdk.chat import user
from xai_sdk.tools import web_search

# ProofInfo schema defined above

client = Client(api_key=os.getenv("XAI_API_KEY"))
chat = client.chat.create(
    model="grok-4.6",
    tools=[web_search()],
)

chat.append(user("Find the latest machine-checked proof of the four color theorem."))

response, proof = chat.parse(ProofInfo)

print(f"Name: {proof.name}")
print(f"Authors: {proof.authors}")
print(f"Year: {proof.year}")
print(f"Summary: {proof.summary}")
```

```
import os
from openai import OpenAI
from pydantic import BaseModel, Field

# ProofInfo schema defined above

client = OpenAI(
    api_key=os.getenv("XAI_API_KEY"),
    base_url="https://api.x.ai/v1",
)

response = client.responses.parse(
    model="grok-4.6",
    input="Find the latest machine-checked proof of the four color theorem.",
    tools=[
        {"type": "web_search"}
    ],
    text_format=ProofInfo,
)

proof = response.output_parsed
print(f"Name: {proof.name}")
print(f"Authors: {proof.authors}")
print(f"Year: {proof.year}")
print(f"Summary: {proof.summary}")
```

```
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

// ProofInfoSchema defined above

const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
});

// Convert Zod schema to JSON schema format
const format = zodResponseFormat(ProofInfoSchema, "proof_info");

const response = await client.responses.create({
    model: "grok-4.6",
    input: "Find the latest machine-checked proof of the four color theorem.",
    tools: [
        { type: "web_search" }
    ],
    text: {
        format: {
            type: "json_schema",
            name: format.json_schema.name,
            schema: format.json_schema.schema,
            strict: true,
        }
    }
});

// Find the message in the output array
const message = response.output.find((item) => item.type === "message");
const textContent = message?.content?.find((c) => c.type === "output_text");

if (textContent) {
    const proof = JSON.parse(textContent.text);
    console.log(`Name: ${proof.name}`);
    console.log(`Authors: ${proof.authors}`);
    console.log(`Year: ${proof.year}`);
    console.log(`Summary: ${proof.summary}`);
}
```

### [Example: Client-side Tools with Structured Output](#example-client-side-tools-with-structured-output)

This example uses a client-side function tool to compute Collatz sequence steps and returns the result in a structured format:

PythonJavaScript

```
from pydantic import BaseModel, Field

class CollatzResult(BaseModel):
    starting_number: int = Field(description="The input number")
    steps: int = Field(description="Number of steps to reach 1")
```

```
const CollatzResultSchema = {
    type: "object",
    properties: {
        starting_number: { type: "integer", description: "The input number" },
        steps: { type: "integer", description: "Number of steps to reach 1" },
    },
    required: ["starting_number", "steps"],
    additionalProperties: false,
};
```

PythonPython (OpenAI)JavaScript (OpenAI)

```
import os
import json
from pydantic import BaseModel, Field

from xai_sdk import Client
from xai_sdk.chat import tool, tool_result, user

# CollatzResult schema defined above

def collatz_steps(n: int) -> int:
    """Returns the number of steps for n to reach 1 in the Collatz sequence."""
    steps = 0
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        steps += 1
    return steps

collatz_tool = tool(
    name="collatz_steps",
    description="Compute the number of steps for a number to reach 1 in the Collatz sequence",
    parameters={
        "type": "object",
        "properties": {
            "n": {"type": "integer", "description": "The starting number"},
        },
        "required": ["n"],
    },
)

client = Client(api_key=os.getenv("XAI_API_KEY"))
chat = client.chat.create(
    model="grok-4.6",
    tools=[collatz_tool],
)

chat.append(user("Use the collatz_steps tool to find how many steps it takes for 20250709 to reach 1."))

# Handle tool calls until we get a final response
while True:
    response = chat.sample()
    
    if not response.tool_calls:
        break
    
    chat.append(response)
    for tc in response.tool_calls:
        args = json.loads(tc.function.arguments)
        result = collatz_steps(args["n"])
        chat.append(tool_result(str(result)))

# Parse the final response into structured output
response, result = chat.parse(CollatzResult)

print(f"Starting number: {result.starting_number}")
print(f"Steps to reach 1: {result.steps}")
```

```
import os
import json
from openai import OpenAI
from pydantic import BaseModel, Field

# CollatzResult schema defined above

def collatz_steps(n: int) -> int:
    """Returns the number of steps for n to reach 1 in the Collatz sequence."""
    steps = 0
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        steps += 1
    return steps

client = OpenAI(
    api_key=os.getenv("XAI_API_KEY"),
    base_url="https://api.x.ai/v1",
)

tools = [
    {
        "type": "function",
        "function": {
            "name": "collatz_steps",
            "description": "Compute the number of steps for a number to reach 1 in the Collatz sequence",
            "parameters": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer", "description": "The starting number"},
                },
                "required": ["n"],
            },
        },
    }
]

messages = [
    {"role": "user", "content": "Use the collatz_steps tool to find how many steps it takes for 20250709 to reach 1."}
]

# Handle tool calls until we get a final response
while True:
    completion = client.chat.completions.create(
        model="grok-4.6",
        messages=messages,
        tools=tools,
    )
    
    message = completion.choices[0].message
    
    if not message.tool_calls:
        break
    
    messages.append(message)
    for tc in message.tool_calls:
        args = json.loads(tc.function.arguments)
        result = collatz_steps(args["n"])
        messages.append({
            "role": "tool",
            "tool_call_id": tc.id,
            "content": str(result),
        })

# Final call with structured output
completion = client.beta.chat.completions.parse(
    model="grok-4.6",
    messages=messages,
    response_format=CollatzResult,
)

result = completion.choices[0].message.parsed
print(f"Starting number: {result.starting_number}")
print(f"Steps to reach 1: {result.steps}")
```

```
import OpenAI from "openai";

// CollatzResultSchema defined above

function collatzSteps(n) {
    let steps = 0;
    while (n !== 1) {
        n = n % 2 === 0 ? n / 2 : 3 * n + 1;
        steps++;
    }
    return steps;
}

const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
});

const tools = [
    {
        type: "function",
        function: {
            name: "collatz_steps",
            description: "Compute the number of steps for a number to reach 1 in the Collatz sequence",
            parameters: {
                type: "object",
                properties: {
                    n: { type: "integer", description: "The starting number" },
                },
                required: ["n"],
            },
        },
    },
];

let messages = [
    { role: "user", content: "Use the collatz_steps tool to find how many steps it takes for 20250709 to reach 1." }
];

// Handle tool calls until we get a final response
while (true) {
    const completion = await client.chat.completions.create({
        model: "grok-4.6",
        messages,
        tools,
    });

    const message = completion.choices[0].message;

    if (!message.tool_calls) {
        break;
    }

    messages.push(message);
    for (const tc of message.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        const result = collatzSteps(args.n);
        messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: String(result),
        });
    }
}

// Final call with structured output
const completion = await client.chat.completions.create({
    model: "grok-4.6",
    messages,
    response_format: {
        type: "json_schema",
        json_schema: {
            name: "collatz_result",
            schema: CollatzResultSchema,
            strict: true,
        },
    },
});

const result = JSON.parse(completion.choices[0].message.content);
console.log("Starting number:", result.starting_number);
console.log("Steps to reach 1:", result.steps);
```

---

## [Alternative: Using `response_format` with `sample()` or `stream()`](#alternative-using-response_format-with-sample-or-stream)

When using the xAI Python SDK, there's an alternative way to retrieve structured outputs. Instead of using the `parse()` method, you can pass your Pydantic model directly to the `response_format` parameter when creating a chat, and then use `sample()` or `stream()` to get the response.

### [How It Works](#how-it-works)

When you pass a Pydantic model to `response_format`, the SDK automatically:

1. Converts your Pydantic model to a JSON schema
2. Constrains the model's output to conform to that schema
3. Returns the response as a JSON string, that is conforming to the Pydantic model, in `response.content`

You then manually parse the JSON string into your Pydantic model instance.

### [Key Differences](#key-differences)

| Approach | Method | Returns | Parsing |
| --- | --- | --- | --- |
| **Using `parse()`** | `chat.parse(Model)` | Tuple of `(Response, Model)` | Automatic - SDK parses for you |
| **Using `response_format`** | `chat.sample()` or `chat.stream()` | `Response` with JSON string | Manual - You parse `response.content` |

### [When to Use Each Approach](#when-to-use-each-approach)

* **Use `parse()`** when you want the simplest, most convenient experience with automatic parsing
* **Use `response_format` + `sample()` or `stream()`** when you:
  + Want more control over the parsing process
  + Need to handle the raw JSON string before parsing
  + Want to use streaming with structured outputs
  + Are integrating with existing code that expects to work with `sample()` or `stream()`

### [Example Using `response_format`](#example-using-response_format)

Python

```
import os
from datetime import date
from enum import Enum

from pydantic import BaseModel, Field
from xai_sdk import Client
from xai_sdk.chat import system, user

# Pydantic Schemas
class Currency(str, Enum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"


class LineItem(BaseModel):
    description: str = Field(description="Description of the item or service")
    quantity: int = Field(description="Number of units", ge=1)
    unit_price: float = Field(description="Price per unit", ge=0)


class Address(BaseModel):
    street: str = Field(description="Street address")
    city: str = Field(description="City")
    postal_code: str = Field(description="Postal/ZIP code")
    country: str = Field(description="Country")


class Invoice(BaseModel):
    vendor_name: str = Field(description="Name of the vendor")
    vendor_address: Address = Field(description="Vendor's address")
    invoice_number: str = Field(description="Unique invoice identifier")
    invoice_date: date = Field(description="Date the invoice was issued")
    line_items: list[LineItem] = Field(description="List of purchased items/services")
    total_amount: float = Field(description="Total amount due", ge=0)
    currency: Currency = Field(description="Currency of the invoice")


client = Client(api_key=os.getenv("XAI_API_KEY"))

# Pass the Pydantic model to response_format instead of using parse()
chat = client.chat.create(
    model="grok-4.6",
    response_format=Invoice,  # Pass the Pydantic model here
)

chat.append(system("Given a raw invoice, carefully analyze the text and extract the invoice data into JSON format."))
chat.append(
    user("""
Vendor: Acme Corp, 123 Main St, Springfield, IL 62704
Invoice Number: INV-2025-001
Date: 2025-02-10
Items: - Widget A, 5 units, $10.00 each - Widget B, 2 units, $15.00 each
Total: $80.00 USD
""")
)

# Use sample() instead of parse() - returns Response object
response = chat.sample()

# The response.content is a valid JSON string conforming to your schema
print(response.content)
# Output: {"vendor_name": "Acme Corp", "vendor_address": {...}, ...}

# Manually parse the JSON string into your Pydantic model
invoice = Invoice.model_validate_json(response.content)
assert isinstance(invoice, Invoice)

# Access fields of the parsed invoice object
print(invoice.vendor_name)
print(invoice.invoice_number)
print(invoice.total_amount)
```

### [Streaming with Structured Outputs](#streaming-with-structured-outputs)

You can also use `stream()` with `response_format` to get streaming structured output. The chunks will progressively build up the JSON string:

Python

```
import os

from pydantic import BaseModel, Field
from xai_sdk import Client
from xai_sdk.chat import system, user


class Summary(BaseModel):
    title: str = Field(description="A brief title")
    key_points: list[str] = Field(description="Main points from the text")
    sentiment: str = Field(description="Overall sentiment: positive, negative, or neutral")


client = Client(api_key=os.getenv("XAI_API_KEY"))

chat = client.chat.create(
    model="grok-4.6",
    response_format=Summary,  # Pass the Pydantic model here
)

chat.append(system("Analyze the following text and provide a structured summary."))
chat.append(user("The new product launch exceeded expectations with record sales..."))


# Stream the response - chunks contain partial JSON
for response, chunk in chat.stream():
    print(chunk.content, end="", flush=True)


# Parse the complete JSON string into your model
summary = Summary.model_validate_json(response.content)
print(f"Title: {summary.title}")
print(f"Sentiment: {summary.sentiment}")
```

---

Last updated: May 12, 2026
