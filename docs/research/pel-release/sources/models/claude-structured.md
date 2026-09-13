---
source_url: "https://platform.claude.com/docs/en/build-with-claude/structured-outputs"
captured_at: "2026-09-13T03:01:16.021848+00:00"
contributor: "Foreman release research; Scrapling"
---

[Messages](/docs/en/intro)Model capabilities

# Structured outputs

Copy page



Get validated JSON results from agent workflows

Copy page



Structured outputs

[ZDR](/docs/en/manage-claude/api-and-data-retention)

Eligible

excludes [Covered Models](/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)

Structured outputs constrain Claude's responses to follow a specific schema, ensuring valid, parseable output for downstream processing. Structured outputs provide two complementary features:

* **JSON outputs** (`output_config.format`): Get Claude's response in a specific JSON format
* **Strict tool use** (`strict: true`): Guarantee schema validation on tool names and inputs

You can use these features independently or together in the same request.



**Migrating from beta?** The `output_format` parameter has moved to `output_config.format`, and beta headers are no longer required. The API continues to accept the old beta header (`structured-outputs-2025-11-13`) and the `output_format` request field for a transition period, but the Python SDK (v1.0 and later) does not accept `output_format={...}` on `client.beta.messages.create()` or `count_tokens()` and raises a `TypeError`; use `output_config` instead. See the following code examples for the updated API shape.

## Why use structured outputs

Without structured outputs, Claude can generate malformed JSON responses or invalid tool inputs that break your applications. Even with careful prompting, you may encounter:

* Parsing errors from invalid JSON syntax
* Missing required fields
* Inconsistent data types
* Schema violations requiring error handling and retries

Structured outputs guarantee schema-compliant responses through constrained decoding:

* **Always valid:** No more `JSON.parse()` errors
* **Type safe:** Guaranteed field types and required fields
* **Reliable:** No retries needed for schema violations

## JSON outputs

JSON outputs control Claude's response format, ensuring Claude returns valid JSON matching your schema. Use JSON outputs when you need to:

* Control Claude's response format
* Extract data from images or text
* Generate structured reports
* Format API responses

### Quick start

cURLCLIPythonTypeScriptC#GoJavaPHPRuby



```
client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm.",
        }
    ],
    output_config={
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "email": {"type": "string"},
                    "plan_interest": {"type": "string"},
                    "demo_requested": {"type": "boolean"},
                },
                "required": ["name", "email", "plan_interest", "demo_requested"],
                "additionalProperties": False,
            },
        }
    },
)
print(next(block.text for block in response.content if block.type == "text"))
```

**Response format:** Valid JSON matching your schema in the response's text content block

Output



```
{
  "name": "John Smith",
  "email": "john@example.com",
  "plan_interest": "Enterprise",
  "demo_requested": true
}
```

### How it works

1. 1

   ### Define your JSON schema

   Create a JSON schema that describes the structure you want Claude to follow. The schema uses standard JSON Schema format with some limitations (see [JSON Schema limitations](#json-schema-limitations)).
2. 2

   ### Add the output\_config.format parameter

   Include the `output_config.format` parameter in your API request with `type: "json_schema"` and your schema definition.
3. 3

   ### Parse the response

   Claude's response is valid JSON matching your schema, returned in the response's text content block.

### Working with JSON outputs in SDKs

The SDKs provide helpers that make it easier to work with JSON outputs, including schema transformation, automatic validation, and integration with popular schema libraries.



The Python SDK's `client.messages.parse()` still accepts `output_format` as a convenience parameter and translates it to `output_config.format` internally. Other SDKs require `output_config` directly. The following examples show the SDK helper syntax.

#### Using native schema definitions

Instead of writing raw JSON schemas, you can use familiar schema definition tools in your language:

* **Python:** [Pydantic](https://docs.pydantic.dev/) models with `client.messages.parse()`
* **TypeScript:** [Zod](https://zod.dev/) schemas with `zodOutputFormat()` or typed JSON Schema literals with `jsonSchemaOutputFormat()`
* **Java:** Plain Java classes with automatic schema derivation through `outputConfig(Class<T>)`
* **Ruby:** `Anthropic::BaseModel` classes with `output_config: {format: Model}`
* **PHP:** Classes implementing `StructuredOutputModel` with `outputConfig: ['format' => MyClass::class]`
* **C#:** Plain C# classes with the generic `Create<T>()` overload, which derives the schema automatically
* **Go:** Go structs reflected into JSON schemas automatically on the beta API, or raw JSON schemas through `output_config`
* **CLI:** Raw JSON schemas passed through `output_config`

CLIPythonTypeScriptC#GoJavaPHPRuby



```
from pydantic import BaseModel
from anthropic import Anthropic


class ContactInfo(BaseModel):
    name: str
    email: str
    plan_interest: str
    demo_requested: bool


client = Anthropic()

response = client.messages.parse(
    model="claude-opus-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm.",
        }
    ],
    output_format=ContactInfo,
)

print(response.parsed_output)
```

#### SDK-specific methods

Each SDK provides helpers that make working with structured outputs easier. See individual SDK pages for full details.

CLIPythonTypeScriptC#GoJavaPHPRuby

**`client.messages.parse()` (Recommended)**

The `parse()` method automatically transforms your Pydantic model, validates the response, and returns a `parsed_output` attribute.

```
from pydantic import BaseModel
# ...
class ContactInfo(BaseModel):
    name: str
    email: str
    plan_interest: str
# ...
response = client.messages.parse(
    model="claude-opus-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Extract contact info: John Smith, john@example.com, interested in the Pro plan",
        }
    ],
    output_format=ContactInfo,
)

# Access the parsed output directly
contact = response.parsed_output
print(contact.name, contact.email)
```



**`transform_schema()` helper**

For when you need to manually transform schemas before sending, or when you want to modify a Pydantic-generated schema. Unlike `client.messages.parse()`, which transforms provided schemas automatically, this gives you the transformed schema so you can further customize it.

```
from anthropic import transform_schema
from pydantic import TypeAdapter
# ...

# First convert Pydantic model to JSON schema, then transform
schema = TypeAdapter(ContactInfo).json_schema()
schema = transform_schema(schema)
# Modify schema if needed
schema["properties"]["custom_field"] = {"type": "string"}

response = client.messages.create(
    model="claude-opus-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "..."}],
    output_config={
        "format": {"type": "json_schema", "schema": schema},
    },
)
```



#### How SDK transformation works

The Python, TypeScript, Ruby, and PHP SDKs automatically transform schemas with unsupported features. The C# and Go SDKs apply the same transformations when the schema is derived from a native type (`Create<T>()` in C#; struct reflection or `BetaJSONSchemaOutputFormat()` on the Go beta API). The transformation steps:

1. **Remove unsupported constraints** (for example, `minimum`, `maximum`, `minLength`, `maxLength`)
2. **Update descriptions** with constraint info (for example, "Must be at least 100"), when the constraint is not directly supported with structured outputs
3. **Add `additionalProperties: false`** to all objects
4. **Filter string formats** to supported list only
5. **Validate responses** against your original schema (with all constraints)

This means Claude receives a simplified schema, but your code still enforces all constraints through validation.

**Example:** A Pydantic field with `minimum: 100` becomes a plain integer in the sent schema, but the SDK updates the description to "Must be at least 100" and validates the response against the original constraint.

### Common use cases

### Data extraction

Extract structured data from unstructured text:

cURLCLIPythonTypeScriptC#GoJavaPHPRuby



```
from pydantic import BaseModel


class Invoice(BaseModel):
    invoice_number: str
    date: str
    total_amount: float
    line_items: list[dict]
    customer_name: str


client = anthropic.Anthropic()
invoice_text = "Invoice #12345, Date: 2024-01-15, Total: $500.00"

response = client.messages.parse(
    model="claude-opus-5",
    max_tokens=4096,
    output_format=Invoice,
    messages=[
        {"role": "user", "content": f"Extract invoice data from: {invoice_text}"}
    ],
)

print(response.parsed_output)
```

### Classification

Classify content with structured categories:

cURLCLIPythonTypeScriptC#GoJavaPHPRuby



```
from pydantic import BaseModel

client = Anthropic()


class Classification(BaseModel):
    category: str
    confidence: float
    tags: list[str]
    sentiment: str


feedback_text = "Great product, but the delivery was slow."
response = client.messages.parse(
    model="claude-opus-5",
    max_tokens=1024,
    output_format=Classification,
    messages=[{"role": "user", "content": f"Classify this feedback: {feedback_text}"}],
)

print(response.parsed_output)
```

### API response formatting

Generate API-ready responses:

cURLCLIPythonTypeScriptC#GoJavaPHPRuby



```
from pydantic import BaseModel

client = Anthropic()


class APIResponse(BaseModel):
    status: str
    data: dict
    errors: list[dict] | None
    metadata: dict


response = client.messages.parse(
    model="claude-opus-5",
    max_tokens=1024,
    output_format=APIResponse,
    messages=[{"role": "user", "content": "Process this request: ..."}],
)

print(response.parsed_output)
```

## Strict tool use

To enforce JSON Schema compliance on tool inputs with grammar-constrained sampling, see [Strict tool use](/docs/en/agents-and-tools/tool-use/strict-tool-use).

## Using both features together

JSON outputs and strict tool use solve different problems and work together:

* **JSON outputs** control Claude's response format (what Claude says)
* **Strict tool use** validates tool parameters (how Claude calls your functions)

When combined, Claude can call tools with guaranteed-valid parameters AND return structured JSON responses. This is useful for agentic workflows where you need both reliable tool calls and structured final outputs.

cURLCLIPythonTypeScriptC#GoJavaPHPRuby



```
response = client.messages.create(
    model="claude-opus-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Help me plan a trip to Paris departing May 15, 2026",
        }
    ],
    # JSON outputs: structured response format
    output_config={
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "next_steps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["summary", "next_steps"],
                "additionalProperties": False,
            },
        }
    },
    # Strict tool use: guaranteed tool parameters
    tools=[
        {
            "name": "search_flights",
            "strict": True,
            "input_schema": {
                "type": "object",
                "properties": {
                    "destination": {"type": "string"},
                    "date": {"type": "string", "format": "date"},
                },
                "required": ["destination", "date"],
                "additionalProperties": False,
            },
        }
    ],
)

print(response)
```

## Important considerations

### Grammar compilation and caching

Structured outputs use constrained sampling with compiled grammar artifacts. This introduces some performance characteristics to be aware of:

* **First request latency:** The first time you use a specific schema, there is additional latency while the grammar compiles
* **Automatic caching:** Compiled grammars are cached for 24 hours from last use, making subsequent requests much faster
* **Cache invalidation:** The cache is invalidated if you change:
  + The JSON schema structure
  + The set of tools in your request (when using both structured outputs and tool use)
  + Changing only `name` or `description` fields does not invalidate the cache

### Prompt modification and token costs

When using structured outputs, Claude automatically receives an additional system prompt explaining the expected output format. This means:

* Your input token count is slightly higher
* The injected prompt costs you tokens like any other system prompt
* Changing the `output_config.format` parameter will invalidate any [prompt cache](/docs/en/build-with-claude/prompt-caching) for that conversation thread

### JSON Schema limitations

Structured outputs support standard JSON Schema with some limitations. Both JSON outputs and strict tool use share these limitations.

### Supported features

* All basic types: object, array, string, integer, number, boolean, null
* `enum` (strings, numbers, bools, or nulls only - no complex types; see [Invalid outputs](#invalid-outputs) for a capitalization caveat)
* `const`
* `anyOf` and `allOf` (with limitations - `allOf` with `$ref` not supported)
* `$ref`, `$def`, and `definitions` (external `$ref` not supported)
* `default` property for all supported types
* `required` and `additionalProperties` (must be set to `false` for objects)
* String formats: `date-time`, `time`, `date`, `duration`, `email`, `hostname`, `uri`, `ipv4`, `ipv6`, `uuid`
* Array `minItems` (only values 0 and 1 supported)

### Not supported

* Recursive schemas
* Complex types within enums
* External `$ref` (for example, `'$ref': 'http://...'`)
* Numerical constraints (such as `minimum`, `maximum`, `multipleOf`)
* String constraints (`minLength`, `maxLength`)
* Array constraints beyond `minItems` of 0 or 1
* `additionalProperties` set to anything other than `false`

If you use an unsupported feature, you'll receive a 400 error with details.

### Pattern support (regex)

**Supported regex features:**

* Full matching (`^...$`) and partial matching
* Quantifiers: `*`, `+`, `?`, simple `{n,m}` cases
* Character classes: `[]`, `.`, `\d`, `\w`, `\s`
* Groups: `(...)`

**NOT supported:**

* Backreferences to groups (for example, `\1`, `\2`)
* Lookahead/lookbehind assertions (for example, `(?=...)`, `(?!...)`)
* Word boundaries: `\b`, `\B`
* Complex `{n,m}` quantifiers with large ranges

Simple regex patterns work well. Complex patterns may result in 400 errors.



The Python, TypeScript, Ruby, and PHP SDKs can automatically transform schemas with unsupported features by removing them and adding constraints to field descriptions. The C# and Go SDKs do the same when the schema is derived from a native type. See [SDK-specific methods](#sdk-specific-methods) for details.

### Property ordering

When using structured outputs, properties in objects maintain their defined ordering from your schema, with one important caveat: **required properties appear first, followed by optional properties**.

For example, given this schema:

```
{
  "type": "object",
  "properties": {
    "notes": { "type": "string" },
    "name": { "type": "string" },
    "email": { "type": "string" },
    "age": { "type": "integer" }
  },
  "required": ["name", "email"],
  "additionalProperties": false
}
```



The output will order properties as:

1. `name` (required, in schema order)
2. `email` (required, in schema order)
3. `notes` (optional, in schema order)
4. `age` (optional, in schema order)

This means the output might look like:

```
{
  "name": "John Smith",
  "email": "john@example.com",
  "notes": "Interested in enterprise plan",
  "age": 35
}
```



If property order in the output is important to your application, mark all properties as required, or account for this reordering in your parsing logic.

### Invalid outputs

While structured outputs guarantee schema compliance in most cases, there are scenarios where the output may not match your schema:

**Refusals** (`stop_reason: "refusal"`)

Claude maintains its safety and helpfulness properties even when using structured outputs. If Claude refuses a request for safety reasons:

* The response has `stop_reason: "refusal"`
* You'll receive a 200 status code
* You'll be billed for the tokens generated
* The output may not match your schema because the refusal message takes precedence over schema constraints

**Token limit reached** (`stop_reason: "max_tokens"`)

If the response is cut off due to reaching the `max_tokens` limit:

* The response has `stop_reason: "max_tokens"`
* The output may be incomplete and not match your schema
* Retry with a higher `max_tokens` value to get the complete structured output

**Enum value casing**

Structured outputs don't guarantee the capitalization of string `enum` and `const` values: Claude may return a value that differs from your schema only in capitalization, typically in the first letter of a word following a space. For example, given this schema:

```
{
  "type": "string",
  "enum": ["Conversation Topic 1", "Conversation Topic 2", "Conversation topic 3"]
}
```



The output may contain `"Conversation Topic 3"` (capital "T") even though that exact value isn't in the enum. The response completes normally, with no error and no special `stop_reason`. This applies to both JSON outputs and strict tool use. Compare enum values case-insensitively, and avoid enum values that differ only in capitalization.

### Schema complexity limits

Structured outputs work by compiling your JSON schemas into a grammar that constrains Claude's output. More complex schemas produce larger grammars that take longer to compile. To protect against excessive compilation times, the API enforces several complexity limits.

#### Explicit limits

The following limits apply to all requests with `output_config.format` or `strict: true`:

| Limit | Value | Description |
| --- | --- | --- |
| Strict tools per request | 20 | Maximum number of tools with `strict: true`. Non-strict tools don't count toward this limit. |
| Optional parameters | 24 | Total optional parameters across all strict tool schemas and JSON output schemas. Each parameter not listed in `required` counts toward this limit. |
| Parameters with union types | 16 | Total parameters that use `anyOf` or type arrays (for example, `"type": ["string", "null"]`) across all strict schemas. These are especially expensive because they create exponential compilation cost. |



These limits apply to the combined total across all strict schemas in a single request. For example, if you have 4 strict tools with 6 optional parameters each, you'll reach the 24-parameter limit even though no single tool seems complex.

#### Additional internal limits

Beyond the explicit limits in the preceding table, there are additional internal limits on the compiled grammar size. These limits exist because schema complexity doesn't reduce to a single dimension: features like optional parameters, union types, nested objects, and number of tools interact with each other in ways that can make the compiled grammar disproportionately large.

When these limits are exceeded, you'll receive a 400 error with the message "Schema is too complex for compilation." These errors mean the combined complexity of your schemas exceeds what can be efficiently compiled, even if each individual limit in the preceding table is satisfied. As a final stop-gap, the API also enforces a **compilation timeout of 180 seconds**. Schemas that pass all explicit checks but produce very large compiled grammars may hit this timeout.

#### Tips for reducing schema complexity

If you're hitting complexity limits, try these strategies in order:

1. **Mark only critical tools as strict.** If you have many tools, reserve it for tools where schema violations cause real problems, and rely on Claude's natural adherence for simpler tools.
2. **Reduce optional parameters.** Make parameters `required` where possible. Each optional parameter roughly doubles a portion of the grammar's state space. If a parameter always has a reasonable default, consider making it required and having Claude provide that default explicitly.
3. **Simplify nested structures.** Deeply nested objects with optional fields compound the complexity. Flatten structures where possible.
4. **Split into multiple requests.** If you have many strict tools, consider splitting them across separate requests or sub-agents.

For persistent issues with valid schemas, [contact support](https://support.claude.com/en/articles/9015913-how-to-get-support) with your schema definition.

## Data retention

Prompts and responses are processed with ZDR when using structured outputs. However, the JSON schema itself is temporarily cached for up to 24 hours since last use for optimization purposes. No prompt or response data is retained beyond the API response.

Structured outputs are HIPAA eligible, but **PHI must not be included in JSON schema definitions**. The API compiles JSON schemas into grammars that are cached separately from message content, and these cached schemas do not receive the same PHI protections as prompts and responses. Do not include PHI in schema property names, `enum` values, `const` values, or `pattern` regular expressions. PHI should only appear in message content (prompts and responses), where it is protected under HIPAA safeguards.

For ZDR and HIPAA eligibility across all features, see [API and data retention](/docs/en/manage-claude/api-and-data-retention).

## Feature compatibility

**Works with:**

* **[Batch processing](/docs/en/build-with-claude/batch-processing):** Process structured outputs at scale with 50% discount
* **[Token counting](/docs/en/build-with-claude/token-counting):** Count tokens without compilation
* **[Streaming](/docs/en/build-with-claude/streaming):** Stream structured outputs like normal responses
* **Combined usage:** Use JSON outputs (`output_config.format`) and strict tool use (`strict: true`) together in the same request

**Incompatible with:**

* **[Citations](/docs/en/build-with-claude/citations):** Citations require interleaving citation blocks with text, which conflicts with strict JSON schema constraints. Returns 400 error if citations enabled with `output_config.format`.
* **Message Prefilling:** Incompatible with JSON outputs



**Grammar scope:** Grammars apply only to Claude's direct output, not to tool use calls, tool results, or thinking tags (when using [thinking](/docs/en/build-with-claude/thinking)). Grammar state resets between sections, allowing Claude to think freely while still producing structured output in the final response.

## Next steps

[Citations](/docs/en/build-with-claude/citations)

Have Claude cite its sources when answering questions about provided documents.



[Strict tool use](/docs/en/agents-and-tools/tool-use/strict-tool-use)

Enforce JSON Schema compliance on Claude's tool inputs with grammar-constrained sampling.



[Tool use with Claude](/docs/en/agents-and-tools/tool-use/overview)

Connect Claude to external tools and APIs. Learn where tools execute and how the agentic loop works.

[Pricing](/docs/en/about-claude/pricing)

Learn about Anthropic's pricing structure for models and features.

## Compatibility

|  |  |
| --- | --- |
| Supported models | * Fable 5 and 5.1 * Mythos 5, 5.1, and Preview * Opus 4.5, 4.6, 4.7, 4.8, and 5 * Sonnet 4.5, 4.6, and 5 * Haiku 4.5 |
| Supported platforms | * Claude API * Claude Platform on AWS * Amazon Bedrock[1](#compat-fn-1) * Google Cloud * Microsoft Foundry |

1. On Amazon Bedrock, structured outputs are available for Claude Opus 4.6, Claude Sonnet 4.6, Claude Sonnet 4.5, Claude Opus 4.5, and Claude Haiku 4.5. [↩](#compat-fnref-1)

Was this page helpful?


