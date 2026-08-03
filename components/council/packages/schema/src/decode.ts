import * as Schema from "effect/Schema";

export const decodeStrictSync = <A, I>(
  schema: Schema.Schema<A, I>,
  input: unknown,
): A => Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(input);
