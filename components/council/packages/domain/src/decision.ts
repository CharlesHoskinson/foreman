export type Decision<Event, Rejection> =
  | {
      readonly _tag: "Accepted";
      readonly events: readonly [Event, ...Event[]];
    }
  | {
      readonly _tag: "Rejected";
      readonly error: Rejection;
    };
