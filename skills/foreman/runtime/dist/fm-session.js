var __defProp = Object.defineProperty;
var __export = (target, all5) => {
  for (var name in all5)
    __defProp(target, name, { get: all5[name], enumerable: true });
};

// packages/orchestration/src/fm-session-main.ts
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes as randomBytes3, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute2, join as join6, dirname as dirname3, resolve as resolve2 } from "node:path";
import {
  existsSync as existsSync3,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync3,
  writeFileSync,
  renameSync as renameSync4,
  rmSync as rmSync3,
  openSync as openSync3,
  closeSync as closeSync3,
  fsyncSync as fsyncSync3,
  lstatSync as lstatSync2,
  realpathSync,
  accessSync,
  constants as constants2
} from "node:fs";

// node_modules/effect/dist/esm/Function.js
var isFunction = (input) => typeof input === "function";
var dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      if (arity(arguments)) {
        return body.apply(this, arguments);
      }
      return (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    case 4:
      return function(a, b, c, d) {
        if (arguments.length >= 4) {
          return body(a, b, c, d);
        }
        return function(self) {
          return body(self, a, b, c);
        };
      };
    case 5:
      return function(a, b, c, d, e) {
        if (arguments.length >= 5) {
          return body(a, b, c, d, e);
        }
        return function(self) {
          return body(self, a, b, c, d);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args2 = arguments;
        return function(self) {
          return body(self, ...args2);
        };
      };
  }
};
var identity = (a) => a;
var constant = (value) => () => value;
var constTrue = /* @__PURE__ */ constant(true);
var constFalse = /* @__PURE__ */ constant(false);
var constUndefined = /* @__PURE__ */ constant(void 0);
var constVoid = constUndefined;
function pipe(a, ab, bc, cd, de, ef, fg, gh, hi) {
  switch (arguments.length) {
    case 1:
      return a;
    case 2:
      return ab(a);
    case 3:
      return bc(ab(a));
    case 4:
      return cd(bc(ab(a)));
    case 5:
      return de(cd(bc(ab(a))));
    case 6:
      return ef(de(cd(bc(ab(a)))));
    case 7:
      return fg(ef(de(cd(bc(ab(a))))));
    case 8:
      return gh(fg(ef(de(cd(bc(ab(a)))))));
    case 9:
      return hi(gh(fg(ef(de(cd(bc(ab(a))))))));
    default: {
      let ret = arguments[0];
      for (let i = 1; i < arguments.length; i++) {
        ret = arguments[i](ret);
      }
      return ret;
    }
  }
}

// node_modules/effect/dist/esm/Equivalence.js
var make = (isEquivalent) => (self, that) => self === that || isEquivalent(self, that);
var mapInput = /* @__PURE__ */ dual(2, (self, f) => make((x, y) => self(f(x), f(y))));
var array = (item) => make((self, that) => {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0; i < self.length; i++) {
    const isEq = item(self[i], that[i]);
    if (!isEq) {
      return false;
    }
  }
  return true;
});

// node_modules/effect/dist/esm/internal/doNotation.js
var let_ = (map14) => dual(3, (self, name, f) => map14(self, (a) => ({
  ...a,
  [name]: f(a)
})));
var bindTo = (map14) => dual(2, (self, name) => map14(self, (a) => ({
  [name]: a
})));
var bind = (map14, flatMap12) => dual(3, (self, name, f) => flatMap12(self, (a) => map14(f(a), (b) => ({
  ...a,
  [name]: b
}))));

// node_modules/effect/dist/esm/GlobalValue.js
var globalStoreId = `effect/GlobalValue`;
var globalStore;
var globalValue = (id, compute) => {
  if (!globalStore) {
    globalThis[globalStoreId] ??= /* @__PURE__ */ new Map();
    globalStore = globalThis[globalStoreId];
  }
  if (!globalStore.has(id)) {
    globalStore.set(id, compute());
  }
  return globalStore.get(id);
};

// node_modules/effect/dist/esm/Predicate.js
var isString = (input) => typeof input === "string";
var isNumber = (input) => typeof input === "number";
var isBigInt = (input) => typeof input === "bigint";
var isFunction2 = isFunction;
var isRecordOrArray = (input) => typeof input === "object" && input !== null;
var isObject = (input) => isRecordOrArray(input) || isFunction2(input);
var hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObject(self) && property in self);
var isTagged = /* @__PURE__ */ dual(2, (self, tag) => hasProperty(self, "_tag") && self["_tag"] === tag);
var isNullable = (input) => input === null || input === void 0;
var isIterable = (input) => typeof input === "string" || hasProperty(input, Symbol.iterator);
var isPromiseLike = (input) => hasProperty(input, "then") && isFunction2(input.then);

// node_modules/effect/dist/esm/internal/errors.js
var getBugErrorMessage = (message) => `BUG: ${message} - please report an issue at https://github.com/Effect-TS/effect/issues`;

// node_modules/effect/dist/esm/Utils.js
var GenKindTypeId = /* @__PURE__ */ Symbol.for("effect/Gen/GenKind");
var GenKindImpl = class {
  value;
  constructor(value) {
    this.value = value;
  }
  /**
   * @since 2.0.0
   */
  get _F() {
    return identity;
  }
  /**
   * @since 2.0.0
   */
  get _R() {
    return (_) => _;
  }
  /**
   * @since 2.0.0
   */
  get _O() {
    return (_) => _;
  }
  /**
   * @since 2.0.0
   */
  get _E() {
    return (_) => _;
  }
  /**
   * @since 2.0.0
   */
  [GenKindTypeId] = GenKindTypeId;
  /**
   * @since 2.0.0
   */
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SingleShotGen = class _SingleShotGen {
  self;
  called = false;
  constructor(self) {
    this.self = self;
  }
  /**
   * @since 2.0.0
   */
  next(a) {
    return this.called ? {
      value: a,
      done: true
    } : (this.called = true, {
      value: this.self,
      done: false
    });
  }
  /**
   * @since 2.0.0
   */
  return(a) {
    return {
      value: a,
      done: true
    };
  }
  /**
   * @since 2.0.0
   */
  throw(e) {
    throw e;
  }
  /**
   * @since 2.0.0
   */
  [Symbol.iterator]() {
    return new _SingleShotGen(this.self);
  }
};
var defaultIncHi = 335903614;
var defaultIncLo = 4150755663;
var MUL_HI = 1481765933 >>> 0;
var MUL_LO = 1284865837 >>> 0;
var BIT_53 = 9007199254740992;
var BIT_27 = 134217728;
var PCGRandom = class {
  _state;
  constructor(seedHi, seedLo, incHi, incLo) {
    if (isNullable(seedLo) && isNullable(seedHi)) {
      seedLo = Math.random() * 4294967295 >>> 0;
      seedHi = 0;
    } else if (isNullable(seedLo)) {
      seedLo = seedHi;
      seedHi = 0;
    }
    if (isNullable(incLo) && isNullable(incHi)) {
      incLo = this._state ? this._state[3] : defaultIncLo;
      incHi = this._state ? this._state[2] : defaultIncHi;
    } else if (isNullable(incLo)) {
      incLo = incHi;
      incHi = 0;
    }
    this._state = new Int32Array([0, 0, incHi >>> 0, ((incLo || 0) | 1) >>> 0]);
    this._next();
    add64(this._state, this._state[0], this._state[1], seedHi >>> 0, seedLo >>> 0);
    this._next();
    return this;
  }
  /**
   * Returns a copy of the internal state of this random number generator as a
   * JavaScript Array.
   *
   * @category getters
   * @since 2.0.0
   */
  getState() {
    return [this._state[0], this._state[1], this._state[2], this._state[3]];
  }
  /**
   * Restore state previously retrieved using `getState()`.
   *
   * @since 2.0.0
   */
  setState(state) {
    this._state[0] = state[0];
    this._state[1] = state[1];
    this._state[2] = state[2];
    this._state[3] = state[3] | 1;
  }
  /**
   * Get a uniformly distributed 32 bit integer between [0, max).
   *
   * @category getter
   * @since 2.0.0
   */
  integer(max6) {
    return Math.round(this.number() * Number.MAX_SAFE_INTEGER) % max6;
  }
  /**
   * Get a uniformly distributed IEEE-754 double between 0.0 and 1.0, with
   * 53 bits of precision (every bit of the mantissa is randomized).
   *
   * @category getters
   * @since 2.0.0
   */
  number() {
    const hi = (this._next() & 67108863) * 1;
    const lo = (this._next() & 134217727) * 1;
    return (hi * BIT_27 + lo) / BIT_53;
  }
  /** @internal */
  _next() {
    const oldHi = this._state[0] >>> 0;
    const oldLo = this._state[1] >>> 0;
    mul64(this._state, oldHi, oldLo, MUL_HI, MUL_LO);
    add64(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
    let xsHi = oldHi >>> 18;
    let xsLo = (oldLo >>> 18 | oldHi << 14) >>> 0;
    xsHi = (xsHi ^ oldHi) >>> 0;
    xsLo = (xsLo ^ oldLo) >>> 0;
    const xorshifted = (xsLo >>> 27 | xsHi << 5) >>> 0;
    const rot = oldHi >>> 27;
    const rot2 = (-rot >>> 0 & 31) >>> 0;
    return (xorshifted >>> rot | xorshifted << rot2) >>> 0;
  }
};
function mul64(out, aHi, aLo, bHi, bLo) {
  let c1 = (aLo >>> 16) * (bLo & 65535) >>> 0;
  let c0 = (aLo & 65535) * (bLo >>> 16) >>> 0;
  let lo = (aLo & 65535) * (bLo & 65535) >>> 0;
  let hi = (aLo >>> 16) * (bLo >>> 16) + ((c0 >>> 16) + (c1 >>> 16)) >>> 0;
  c0 = c0 << 16 >>> 0;
  lo = lo + c0 >>> 0;
  if (lo >>> 0 < c0 >>> 0) {
    hi = hi + 1 >>> 0;
  }
  c1 = c1 << 16 >>> 0;
  lo = lo + c1 >>> 0;
  if (lo >>> 0 < c1 >>> 0) {
    hi = hi + 1 >>> 0;
  }
  hi = hi + Math.imul(aLo, bHi) >>> 0;
  hi = hi + Math.imul(aHi, bLo) >>> 0;
  out[0] = hi;
  out[1] = lo;
}
function add64(out, aHi, aLo, bHi, bLo) {
  let hi = aHi + bHi >>> 0;
  const lo = aLo + bLo >>> 0;
  if (lo >>> 0 < aLo >>> 0) {
    hi = hi + 1 | 0;
  }
  out[0] = hi;
  out[1] = lo;
}
var YieldWrapTypeId = /* @__PURE__ */ Symbol.for("effect/Utils/YieldWrap");
var YieldWrap = class {
  /**
   * @since 3.0.6
   */
  #value;
  constructor(value) {
    this.#value = value;
  }
  /**
   * @since 3.0.6
   */
  [YieldWrapTypeId]() {
    return this.#value;
  }
};
function yieldWrapGet(self) {
  if (typeof self === "object" && self !== null && YieldWrapTypeId in self) {
    return self[YieldWrapTypeId]();
  }
  throw new Error(getBugErrorMessage("yieldWrapGet"));
}
var structuralRegionState = /* @__PURE__ */ globalValue("effect/Utils/isStructuralRegion", () => ({
  enabled: false,
  tester: void 0
}));
var standard = {
  effect_internal_function: (body) => {
    return body();
  }
};
var forced = {
  effect_internal_function: (body) => {
    try {
      return body();
    } finally {
    }
  }
};
var isNotOptimizedAway = /* @__PURE__ */ standard.effect_internal_function(() => new Error().stack)?.includes("effect_internal_function") === true;
var internalCall = isNotOptimizedAway ? standard.effect_internal_function : forced.effect_internal_function;
var genConstructor = function* () {
}.constructor;
var isGeneratorFunction = (u) => isObject(u) && u.constructor === genConstructor;

// node_modules/effect/dist/esm/Hash.js
var randomHashCache = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap());
var symbol = /* @__PURE__ */ Symbol.for("effect/Hash");
var hash = (self) => {
  if (structuralRegionState.enabled === true) {
    return 0;
  }
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "boolean":
      return string(String(self));
    case "symbol":
      return string(String(self));
    case "string":
      return string(self);
    case "undefined":
      return string("undefined");
    case "function":
    case "object": {
      if (self === null) {
        return string("null");
      } else if (self instanceof Date) {
        if (Number.isNaN(self.getTime())) {
          return string("Invalid Date");
        }
        return hash(self.toISOString());
      } else if (self instanceof URL) {
        return hash(self.href);
      } else if (isHash(self)) {
        return self[symbol]();
      } else {
        return random(self);
      }
    }
    default:
      throw new Error(`BUG: unhandled typeof ${typeof self} - please report an issue at https://github.com/Effect-TS/effect/issues`);
  }
};
var random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, number(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
  }
  return randomHashCache.get(self);
};
var combine = (b) => (self) => self * 53 ^ b;
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
var isHash = (u) => hasProperty(u, symbol);
var number = (n) => {
  if (n !== n || n === Infinity) {
    return 0;
  }
  let h = n | 0;
  if (h !== n) {
    h ^= n * 4294967295;
  }
  while (n > 4294967295) {
    h ^= n /= 4294967295;
  }
  return optimize(h);
};
var string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
};
var structureKeys = (o, keys5) => {
  let h = 12289;
  for (let i = 0; i < keys5.length; i++) {
    h ^= pipe(string(keys5[i]), combine(hash(o[keys5[i]])));
  }
  return optimize(h);
};
var structure = (o) => structureKeys(o, Object.keys(o));
var array2 = (arr) => {
  let h = 6151;
  for (let i = 0; i < arr.length; i++) {
    h = pipe(h, combine(hash(arr[i])));
  }
  return optimize(h);
};
var cached = function() {
  if (arguments.length === 1) {
    const self2 = arguments[0];
    return function(hash3) {
      Object.defineProperty(self2, symbol, {
        value() {
          return hash3;
        },
        enumerable: false
      });
      return hash3;
    };
  }
  const self = arguments[0];
  const hash2 = arguments[1];
  Object.defineProperty(self, symbol, {
    value() {
      return hash2;
    },
    enumerable: false
  });
  return hash2;
};

// node_modules/effect/dist/esm/Equal.js
var symbol2 = /* @__PURE__ */ Symbol.for("effect/Equal");
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that) {
    return true;
  }
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "object" || selfType === "function") {
    if (self !== null && that !== null) {
      if (isEqual(self) && isEqual(that)) {
        if (hash(self) === hash(that) && self[symbol2](that)) {
          return true;
        } else {
          return structuralRegionState.enabled && structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
        }
      } else if (self instanceof Date && that instanceof Date) {
        const t1 = self.getTime();
        const t2 = that.getTime();
        return t1 === t2 || Number.isNaN(t1) && Number.isNaN(t2);
      } else if (self instanceof URL && that instanceof URL) {
        return self.href === that.href;
      }
    }
    if (structuralRegionState.enabled) {
      if (self === null || that === null) {
        return false;
      }
      if (Array.isArray(self) && Array.isArray(that)) {
        return self.length === that.length && self.every((v, i) => compareBoth(v, that[i]));
      }
      if (Object.getPrototypeOf(self) === Object.prototype && Object.getPrototypeOf(that) === Object.prototype) {
        const keysSelf = Object.keys(self);
        const keysThat = Object.keys(that);
        if (keysSelf.length === keysThat.length) {
          for (const key of keysSelf) {
            if (!(key in that && compareBoth(self[key], that[key]))) {
              return structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
            }
          }
          return true;
        }
      }
      return structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
    }
  }
  return structuralRegionState.enabled && structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
}
var isEqual = (u) => hasProperty(u, symbol2);
var equivalence = () => equals;

// node_modules/effect/dist/esm/Inspectable.js
var NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var toJSON = (x) => {
  try {
    if (hasProperty(x, "toJSON") && isFunction2(x["toJSON"]) && x["toJSON"].length === 0) {
      return x.toJSON();
    } else if (Array.isArray(x)) {
      return x.map(toJSON);
    }
  } catch {
    return {};
  }
  return redact(x);
};
var format = (x) => JSON.stringify(x, null, 2);
var BaseProto = {
  toJSON() {
    return toJSON(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};
var Class = class {
  /**
   * @since 2.0.0
   */
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  /**
   * @since 2.0.0
   */
  toString() {
    return format(this.toJSON());
  }
};
var toStringUnknown = (u, whitespace = 2) => {
  if (typeof u === "string") {
    return u;
  }
  try {
    return typeof u === "object" ? stringifyCircular(u, whitespace) : String(u);
  } catch {
    return String(u);
  }
};
var stringifyCircular = (obj, whitespace) => {
  let cache = [];
  const retVal = JSON.stringify(obj, (_key, value) => typeof value === "object" && value !== null ? cache.includes(value) ? void 0 : cache.push(value) && (redactableState.fiberRefs !== void 0 && isRedactable(value) ? value[symbolRedactable](redactableState.fiberRefs) : value) : value, whitespace);
  cache = void 0;
  return retVal;
};
var symbolRedactable = /* @__PURE__ */ Symbol.for("effect/Inspectable/Redactable");
var isRedactable = (u) => typeof u === "object" && u !== null && symbolRedactable in u;
var redactableState = /* @__PURE__ */ globalValue("effect/Inspectable/redactableState", () => ({
  fiberRefs: void 0
}));
var withRedactableContext = (context4, f) => {
  const prev = redactableState.fiberRefs;
  redactableState.fiberRefs = context4;
  try {
    return f();
  } finally {
    redactableState.fiberRefs = prev;
  }
};
var redact = (u) => {
  if (isRedactable(u) && redactableState.fiberRefs !== void 0) {
    return u[symbolRedactable](redactableState.fiberRefs);
  }
  return u;
};

// node_modules/effect/dist/esm/Pipeable.js
var pipeArguments = (self, args2) => {
  switch (args2.length) {
    case 0:
      return self;
    case 1:
      return args2[0](self);
    case 2:
      return args2[1](args2[0](self));
    case 3:
      return args2[2](args2[1](args2[0](self)));
    case 4:
      return args2[3](args2[2](args2[1](args2[0](self))));
    case 5:
      return args2[4](args2[3](args2[2](args2[1](args2[0](self)))));
    case 6:
      return args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self))))));
    case 7:
      return args2[6](args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self)))))));
    case 8:
      return args2[7](args2[6](args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self))))))));
    case 9:
      return args2[8](args2[7](args2[6](args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args2.length; i < len; i++) {
        ret = args2[i](ret);
      }
      return ret;
    }
  }
};

// node_modules/effect/dist/esm/internal/opCodes/effect.js
var OP_ASYNC = "Async";
var OP_COMMIT = "Commit";
var OP_FAILURE = "Failure";
var OP_ON_FAILURE = "OnFailure";
var OP_ON_SUCCESS = "OnSuccess";
var OP_ON_SUCCESS_AND_FAILURE = "OnSuccessAndFailure";
var OP_SUCCESS = "Success";
var OP_SYNC = "Sync";
var OP_TAG = "Tag";
var OP_UPDATE_RUNTIME_FLAGS = "UpdateRuntimeFlags";
var OP_WHILE = "While";
var OP_ITERATOR = "Iterator";
var OP_WITH_RUNTIME = "WithRuntime";
var OP_YIELD = "Yield";
var OP_REVERT_FLAGS = "RevertFlags";

// node_modules/effect/dist/esm/internal/version.js
var moduleVersion = "3.22.1";
var getCurrentVersion = () => moduleVersion;

// node_modules/effect/dist/esm/internal/effectable.js
var EffectTypeId = /* @__PURE__ */ Symbol.for("effect/Effect");
var StreamTypeId = /* @__PURE__ */ Symbol.for("effect/Stream");
var SinkTypeId = /* @__PURE__ */ Symbol.for("effect/Sink");
var ChannelTypeId = /* @__PURE__ */ Symbol.for("effect/Channel");
var effectVariance = {
  /* c8 ignore next */
  _R: (_) => _,
  /* c8 ignore next */
  _E: (_) => _,
  /* c8 ignore next */
  _A: (_) => _,
  _V: /* @__PURE__ */ getCurrentVersion()
};
var sinkVariance = {
  /* c8 ignore next */
  _A: (_) => _,
  /* c8 ignore next */
  _In: (_) => _,
  /* c8 ignore next */
  _L: (_) => _,
  /* c8 ignore next */
  _E: (_) => _,
  /* c8 ignore next */
  _R: (_) => _
};
var channelVariance = {
  /* c8 ignore next */
  _Env: (_) => _,
  /* c8 ignore next */
  _InErr: (_) => _,
  /* c8 ignore next */
  _InElem: (_) => _,
  /* c8 ignore next */
  _InDone: (_) => _,
  /* c8 ignore next */
  _OutErr: (_) => _,
  /* c8 ignore next */
  _OutElem: (_) => _,
  /* c8 ignore next */
  _OutDone: (_) => _
};
var EffectPrototype = {
  [EffectTypeId]: effectVariance,
  [StreamTypeId]: effectVariance,
  [SinkTypeId]: sinkVariance,
  [ChannelTypeId]: channelVariance,
  [symbol2](that) {
    return this === that;
  },
  [symbol]() {
    return cached(this, random(this));
  },
  [Symbol.iterator]() {
    return new SingleShotGen(new YieldWrap(this));
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var StructuralPrototype = {
  [symbol]() {
    return cached(this, structure(this));
  },
  [symbol2](that) {
    const selfKeys = Object.keys(this);
    const thatKeys = Object.keys(that);
    if (selfKeys.length !== thatKeys.length) {
      return false;
    }
    for (const key of selfKeys) {
      if (!(key in that && equals(this[key], that[key]))) {
        return false;
      }
    }
    return true;
  }
};
var CommitPrototype = {
  ...EffectPrototype,
  _op: OP_COMMIT
};
var StructuralCommitPrototype = {
  ...CommitPrototype,
  ...StructuralPrototype
};
var Base = /* @__PURE__ */ (function() {
  function Base3() {
  }
  Base3.prototype = CommitPrototype;
  return Base3;
})();

// node_modules/effect/dist/esm/internal/option.js
var TypeId = /* @__PURE__ */ Symbol.for("effect/Option");
var CommonProto = {
  ...EffectPrototype,
  [TypeId]: {
    _A: (_) => _
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};
var SomeProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "Some",
  _op: "Some",
  [symbol2](that) {
    return isOption(that) && isSome(that) && equals(this.value, that.value);
  },
  [symbol]() {
    return cached(this, combine(hash(this._tag))(hash(this.value)));
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag,
      value: toJSON(this.value)
    };
  }
});
var NoneHash = /* @__PURE__ */ hash("None");
var NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "None",
  _op: "None",
  [symbol2](that) {
    return isOption(that) && isNone(that);
  },
  [symbol]() {
    return NoneHash;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag
    };
  }
});
var isOption = (input) => hasProperty(input, TypeId);
var isNone = (fa) => fa._tag === "None";
var isSome = (fa) => fa._tag === "Some";
var none = /* @__PURE__ */ Object.create(NoneProto);
var some = (value) => {
  const a = Object.create(SomeProto);
  a.value = value;
  return a;
};

// node_modules/effect/dist/esm/internal/either.js
var TypeId2 = /* @__PURE__ */ Symbol.for("effect/Either");
var CommonProto2 = {
  ...EffectPrototype,
  [TypeId2]: {
    _R: (_) => _
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};
var RightProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Right",
  _op: "Right",
  [symbol2](that) {
    return isEither(that) && isRight(that) && equals(this.right, that.right);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.right));
  },
  toJSON() {
    return {
      _id: "Either",
      _tag: this._tag,
      right: toJSON(this.right)
    };
  }
});
var LeftProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Left",
  _op: "Left",
  [symbol2](that) {
    return isEither(that) && isLeft(that) && equals(this.left, that.left);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.left));
  },
  toJSON() {
    return {
      _id: "Either",
      _tag: this._tag,
      left: toJSON(this.left)
    };
  }
});
var isEither = (input) => hasProperty(input, TypeId2);
var isLeft = (ma) => ma._tag === "Left";
var isRight = (ma) => ma._tag === "Right";
var left = (left3) => {
  const a = Object.create(LeftProto);
  a.left = left3;
  return a;
};
var right = (right3) => {
  const a = Object.create(RightProto);
  a.right = right3;
  return a;
};

// node_modules/effect/dist/esm/Either.js
var right2 = right;
var left2 = left;
var isLeft2 = isLeft;
var isRight2 = isRight;
var match = /* @__PURE__ */ dual(2, (self, {
  onLeft,
  onRight
}) => isLeft2(self) ? onLeft(self.left) : onRight(self.right));
var merge = /* @__PURE__ */ match({
  onLeft: identity,
  onRight: identity
});

// node_modules/effect/dist/esm/internal/array.js
var isNonEmptyArray = (self) => self.length > 0;

// node_modules/effect/dist/esm/Order.js
var make2 = (compare) => (self, that) => self === that ? 0 : compare(self, that);
var number2 = /* @__PURE__ */ make2((self, that) => self < that ? -1 : 1);
var mapInput2 = /* @__PURE__ */ dual(2, (self, f) => make2((b1, b2) => self(f(b1), f(b2))));
var lessThan = (O) => dual(2, (self, that) => O(self, that) === -1);
var greaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var min = (O) => dual(2, (self, that) => self === that || O(self, that) < 1 ? self : that);
var max = (O) => dual(2, (self, that) => self === that || O(self, that) > -1 ? self : that);
var clamp = (O) => dual(2, (self, options) => min(O)(options.maximum, max(O)(options.minimum, self)));
var between = (O) => dual(2, (self, options) => !lessThan(O)(self, options.minimum) && !greaterThan(O)(self, options.maximum));

// node_modules/effect/dist/esm/Option.js
var none2 = () => none;
var some2 = some;
var isNone2 = isNone;
var isSome2 = isSome;
var match2 = /* @__PURE__ */ dual(2, (self, {
  onNone,
  onSome
}) => isNone2(self) ? onNone() : onSome(self.value));
var getOrElse = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? onNone() : self.value);
var orElseSome = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? some2(onNone()) : self);
var fromNullable = (nullableValue) => nullableValue == null ? none2() : some2(nullableValue);
var getOrUndefined = /* @__PURE__ */ getOrElse(constUndefined);
var liftThrowable = (f) => (...a) => {
  try {
    return some2(f(...a));
  } catch {
    return none2();
  }
};
var getOrThrowWith = /* @__PURE__ */ dual(2, (self, onNone) => {
  if (isSome2(self)) {
    return self.value;
  }
  throw onNone();
});
var getOrThrow = /* @__PURE__ */ getOrThrowWith(() => new Error("getOrThrow called on a None"));
var map = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : some2(f(self.value)));
var flatMap = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : f(self.value));
var containsWith = (isEquivalent) => dual(2, (self, a) => isNone2(self) ? false : isEquivalent(self.value, a));
var _equivalence = /* @__PURE__ */ equivalence();
var contains = /* @__PURE__ */ containsWith(_equivalence);
var mergeWith = (f) => (o1, o2) => {
  if (isNone2(o1)) {
    return o2;
  } else if (isNone2(o2)) {
    return o1;
  }
  return some2(f(o1.value, o2.value));
};

// node_modules/effect/dist/esm/Tuple.js
var make3 = (...elements) => elements;

// node_modules/effect/dist/esm/Array.js
var allocate = (n) => new Array(n);
var makeBy = /* @__PURE__ */ dual(2, (n, f) => {
  const max6 = Math.max(1, Math.floor(n));
  const out = new Array(max6);
  for (let i = 0; i < max6; i++) {
    out[i] = f(i);
  }
  return out;
});
var fromIterable = (collection) => Array.isArray(collection) ? collection : Array.from(collection);
var ensure = (self) => Array.isArray(self) ? self : [self];
var prepend = /* @__PURE__ */ dual(2, (self, head5) => [head5, ...self]);
var append = /* @__PURE__ */ dual(2, (self, last3) => [...self, last3]);
var appendAll = /* @__PURE__ */ dual(2, (self, that) => fromIterable(self).concat(fromIterable(that)));
var isEmptyArray = (self) => self.length === 0;
var isEmptyReadonlyArray = isEmptyArray;
var isNonEmptyArray2 = isNonEmptyArray;
var isNonEmptyReadonlyArray = isNonEmptyArray;
var isOutOfBounds = (i, as7) => i < 0 || i >= as7.length;
var clamp2 = (i, as7) => Math.floor(Math.min(Math.max(0, i), as7.length));
var get = /* @__PURE__ */ dual(2, (self, index) => {
  const i = Math.floor(index);
  return isOutOfBounds(i, self) ? none2() : some2(self[i]);
});
var unsafeGet = /* @__PURE__ */ dual(2, (self, index) => {
  const i = Math.floor(index);
  if (isOutOfBounds(i, self)) {
    throw new Error(`Index ${i} out of bounds`);
  }
  return self[i];
});
var head = /* @__PURE__ */ get(0);
var headNonEmpty = /* @__PURE__ */ unsafeGet(0);
var last = (self) => isNonEmptyReadonlyArray(self) ? some2(lastNonEmpty(self)) : none2();
var lastNonEmpty = (self) => self[self.length - 1];
var tailNonEmpty = (self) => self.slice(1);
var spanIndex = (self, predicate) => {
  let i = 0;
  for (const a of self) {
    if (!predicate(a, i)) {
      break;
    }
    i++;
  }
  return i;
};
var span = /* @__PURE__ */ dual(2, (self, predicate) => splitAt(self, spanIndex(self, predicate)));
var drop = /* @__PURE__ */ dual(2, (self, n) => {
  const input = fromIterable(self);
  return input.slice(clamp2(n, input), input.length);
});
var reverse = (self) => Array.from(self).reverse();
var sort = /* @__PURE__ */ dual(2, (self, O) => {
  const out = Array.from(self);
  out.sort(O);
  return out;
});
var zip = /* @__PURE__ */ dual(2, (self, that) => zipWith(self, that, make3));
var zipWith = /* @__PURE__ */ dual(3, (self, that, f) => {
  const as7 = fromIterable(self);
  const bs = fromIterable(that);
  if (isNonEmptyReadonlyArray(as7) && isNonEmptyReadonlyArray(bs)) {
    const out = [f(headNonEmpty(as7), headNonEmpty(bs))];
    const len = Math.min(as7.length, bs.length);
    for (let i = 1; i < len; i++) {
      out[i] = f(as7[i], bs[i]);
    }
    return out;
  }
  return [];
});
var _equivalence2 = /* @__PURE__ */ equivalence();
var splitAt = /* @__PURE__ */ dual(2, (self, n) => {
  const input = Array.from(self);
  const _n = Math.floor(n);
  if (isNonEmptyReadonlyArray(input)) {
    if (_n >= 1) {
      return splitNonEmptyAt(input, _n);
    }
    return [[], input];
  }
  return [input, []];
});
var splitNonEmptyAt = /* @__PURE__ */ dual(2, (self, n) => {
  const _n = Math.max(1, Math.floor(n));
  return _n >= self.length ? [copy(self), []] : [prepend(self.slice(1, _n), headNonEmpty(self)), self.slice(_n)];
});
var copy = (self) => self.slice();
var unionWith = /* @__PURE__ */ dual(3, (self, that, isEquivalent) => {
  const a = fromIterable(self);
  const b = fromIterable(that);
  if (isNonEmptyReadonlyArray(a)) {
    if (isNonEmptyReadonlyArray(b)) {
      const dedupe2 = dedupeWith(isEquivalent);
      return dedupe2(appendAll(a, b));
    }
    return a;
  }
  return b;
});
var union = /* @__PURE__ */ dual(2, (self, that) => unionWith(self, that, _equivalence2));
var empty = () => [];
var of = (a) => [a];
var map2 = /* @__PURE__ */ dual(2, (self, f) => self.map(f));
var flatMap2 = /* @__PURE__ */ dual(2, (self, f) => {
  if (isEmptyReadonlyArray(self)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < self.length; i++) {
    const inner = f(self[i], i);
    for (let j = 0; j < inner.length; j++) {
      out.push(inner[j]);
    }
  }
  return out;
});
var flatten = /* @__PURE__ */ flatMap2(identity);
var filterMap = /* @__PURE__ */ dual(2, (self, f) => {
  const as7 = fromIterable(self);
  const out = [];
  for (let i = 0; i < as7.length; i++) {
    const o = f(as7[i], i);
    if (isSome2(o)) {
      out.push(o.value);
    }
  }
  return out;
});
var partitionMap = /* @__PURE__ */ dual(2, (self, f) => {
  const left3 = [];
  const right3 = [];
  const as7 = fromIterable(self);
  for (let i = 0; i < as7.length; i++) {
    const e = f(as7[i], i);
    if (isLeft2(e)) {
      left3.push(e.left);
    } else {
      right3.push(e.right);
    }
  }
  return [left3, right3];
});
var getSomes = /* @__PURE__ */ filterMap(identity);
var reduce = /* @__PURE__ */ dual(3, (self, b, f) => fromIterable(self).reduce((b2, a, i) => f(b2, a, i), b));
var reduceRight = /* @__PURE__ */ dual(3, (self, b, f) => fromIterable(self).reduceRight((b2, a, i) => f(b2, a, i), b));
var unfold = (b, f) => {
  const out = [];
  let next = b;
  let o;
  while (isSome2(o = f(next))) {
    const [a, b2] = o.value;
    out.push(a);
    next = b2;
  }
  return out;
};
var getEquivalence = array;
var dedupeWith = /* @__PURE__ */ dual(2, (self, isEquivalent) => {
  const input = fromIterable(self);
  if (isNonEmptyReadonlyArray(input)) {
    const out = [headNonEmpty(input)];
    const rest = tailNonEmpty(input);
    for (const r of rest) {
      if (out.every((a) => !isEquivalent(r, a))) {
        out.push(r);
      }
    }
    return out;
  }
  return [];
});
var dedupe = (self) => dedupeWith(self, equivalence());
var join = /* @__PURE__ */ dual(2, (self, sep) => fromIterable(self).join(sep));

// node_modules/effect/dist/esm/Number.js
var Order = number2;

// node_modules/effect/dist/esm/RegExp.js
var escape = (string2) => string2.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

// node_modules/effect/dist/esm/Boolean.js
var not = (self) => !self;

// node_modules/effect/dist/esm/internal/context.js
var TagTypeId = /* @__PURE__ */ Symbol.for("effect/Context/Tag");
var ReferenceTypeId = /* @__PURE__ */ Symbol.for("effect/Context/Reference");
var STMSymbolKey = "effect/STM";
var STMTypeId = /* @__PURE__ */ Symbol.for(STMSymbolKey);
var TagProto = {
  ...EffectPrototype,
  _op: "Tag",
  [STMTypeId]: effectVariance,
  [TagTypeId]: {
    _Service: (_) => _,
    _Identifier: (_) => _
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "Tag",
      key: this.key,
      stack: this.stack
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  of(self) {
    return self;
  },
  context(self) {
    return make4(this, self);
  }
};
var ReferenceProto = {
  ...TagProto,
  [ReferenceTypeId]: ReferenceTypeId
};
var makeGenericTag = (key) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error();
  Error.stackTraceLimit = limit;
  const tag = Object.create(TagProto);
  Object.defineProperty(tag, "stack", {
    get() {
      return creationError.stack;
    }
  });
  tag.key = key;
  return tag;
};
var Reference = () => (id, options) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error();
  Error.stackTraceLimit = limit;
  function ReferenceClass() {
  }
  Object.setPrototypeOf(ReferenceClass, ReferenceProto);
  ReferenceClass.key = id;
  ReferenceClass.defaultValue = options.defaultValue;
  Object.defineProperty(ReferenceClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return ReferenceClass;
};
var TypeId3 = /* @__PURE__ */ Symbol.for("effect/Context");
var ContextProto = {
  [TypeId3]: {
    _Services: (_) => _
  },
  [symbol2](that) {
    if (isContext(that)) {
      if (this.unsafeMap.size === that.unsafeMap.size) {
        for (const k of this.unsafeMap.keys()) {
          if (!that.unsafeMap.has(k) || !equals(this.unsafeMap.get(k), that.unsafeMap.get(k))) {
            return false;
          }
        }
        return true;
      }
    }
    return false;
  },
  [symbol]() {
    return cached(this, number(this.unsafeMap.size));
  },
  pipe() {
    return pipeArguments(this, arguments);
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "Context",
      services: Array.from(this.unsafeMap).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var makeContext = (unsafeMap) => {
  const context4 = Object.create(ContextProto);
  context4.unsafeMap = unsafeMap;
  return context4;
};
var serviceNotFoundError = (tag) => {
  const error = new Error(`Service not found${tag.key ? `: ${String(tag.key)}` : ""}`);
  if (tag.stack) {
    const lines = tag.stack.split("\n");
    if (lines.length > 2) {
      const afterAt = lines[2].match(/at (.*)/);
      if (afterAt) {
        error.message = error.message + ` (defined at ${afterAt[1]})`;
      }
    }
  }
  if (error.stack) {
    const lines = error.stack.split("\n");
    lines.splice(1, 3);
    error.stack = lines.join("\n");
  }
  return error;
};
var isContext = (u) => hasProperty(u, TypeId3);
var isTag = (u) => hasProperty(u, TagTypeId);
var isReference = (u) => hasProperty(u, ReferenceTypeId);
var _empty = /* @__PURE__ */ makeContext(/* @__PURE__ */ new Map());
var empty2 = () => _empty;
var make4 = (tag, service) => makeContext(/* @__PURE__ */ new Map([[tag.key, service]]));
var add = /* @__PURE__ */ dual(3, (self, tag, service) => {
  const map14 = new Map(self.unsafeMap);
  map14.set(tag.key, service);
  return makeContext(map14);
});
var defaultValueCache = /* @__PURE__ */ globalValue("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map());
var getDefaultValue = (tag) => {
  if (defaultValueCache.has(tag.key)) {
    return defaultValueCache.get(tag.key);
  }
  const value = tag.defaultValue();
  defaultValueCache.set(tag.key, value);
  return value;
};
var unsafeGetReference = (self, tag) => {
  return self.unsafeMap.has(tag.key) ? self.unsafeMap.get(tag.key) : getDefaultValue(tag);
};
var unsafeGet2 = /* @__PURE__ */ dual(2, (self, tag) => {
  if (!self.unsafeMap.has(tag.key)) {
    if (ReferenceTypeId in tag) return getDefaultValue(tag);
    throw serviceNotFoundError(tag);
  }
  return self.unsafeMap.get(tag.key);
});
var get2 = unsafeGet2;
var getOption = /* @__PURE__ */ dual(2, (self, tag) => {
  if (!self.unsafeMap.has(tag.key)) {
    return isReference(tag) ? some(getDefaultValue(tag)) : none;
  }
  return some(self.unsafeMap.get(tag.key));
});
var merge2 = /* @__PURE__ */ dual(2, (self, that) => {
  const map14 = new Map(self.unsafeMap);
  for (const [tag, s] of that.unsafeMap) {
    map14.set(tag, s);
  }
  return makeContext(map14);
});
var mergeAll = (...ctxs) => {
  const map14 = /* @__PURE__ */ new Map();
  for (let i = 0; i < ctxs.length; i++) {
    ctxs[i].unsafeMap.forEach((value, key) => {
      map14.set(key, value);
    });
  }
  return makeContext(map14);
};

// node_modules/effect/dist/esm/Context.js
var GenericTag = makeGenericTag;
var isContext2 = isContext;
var isTag2 = isTag;
var empty3 = empty2;
var make5 = make4;
var add2 = add;
var get3 = get2;
var unsafeGet3 = unsafeGet2;
var getOption2 = getOption;
var merge3 = merge2;
var mergeAll2 = mergeAll;
var Reference2 = Reference;

// node_modules/effect/dist/esm/Chunk.js
var TypeId4 = /* @__PURE__ */ Symbol.for("effect/Chunk");
function copy2(src, srcPos, dest, destPos, len) {
  for (let i = srcPos; i < Math.min(src.length, srcPos + len); i++) {
    dest[destPos + i - srcPos] = src[i];
  }
  return dest;
}
var emptyArray = [];
var getEquivalence2 = (isEquivalent) => make((self, that) => self.length === that.length && toReadonlyArray(self).every((value, i) => isEquivalent(value, unsafeGet4(that, i))));
var _equivalence3 = /* @__PURE__ */ getEquivalence2(equals);
var ChunkProto = {
  [TypeId4]: {
    _A: (_) => _
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "Chunk",
      values: toReadonlyArray(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  [symbol2](that) {
    return isChunk(that) && _equivalence3(this, that);
  },
  [symbol]() {
    return cached(this, array2(toReadonlyArray(this)));
  },
  [Symbol.iterator]() {
    switch (this.backing._tag) {
      case "IArray": {
        return this.backing.array[Symbol.iterator]();
      }
      case "IEmpty": {
        return emptyArray[Symbol.iterator]();
      }
      default: {
        return toReadonlyArray(this)[Symbol.iterator]();
      }
    }
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeChunk = (backing) => {
  const chunk2 = Object.create(ChunkProto);
  chunk2.backing = backing;
  switch (backing._tag) {
    case "IEmpty": {
      chunk2.length = 0;
      chunk2.depth = 0;
      chunk2.left = chunk2;
      chunk2.right = chunk2;
      break;
    }
    case "IConcat": {
      chunk2.length = backing.left.length + backing.right.length;
      chunk2.depth = 1 + Math.max(backing.left.depth, backing.right.depth);
      chunk2.left = backing.left;
      chunk2.right = backing.right;
      break;
    }
    case "IArray": {
      chunk2.length = backing.array.length;
      chunk2.depth = 0;
      chunk2.left = _empty2;
      chunk2.right = _empty2;
      break;
    }
    case "ISingleton": {
      chunk2.length = 1;
      chunk2.depth = 0;
      chunk2.left = _empty2;
      chunk2.right = _empty2;
      break;
    }
    case "ISlice": {
      chunk2.length = backing.length;
      chunk2.depth = backing.chunk.depth + 1;
      chunk2.left = _empty2;
      chunk2.right = _empty2;
      break;
    }
  }
  return chunk2;
};
var isChunk = (u) => hasProperty(u, TypeId4);
var _empty2 = /* @__PURE__ */ makeChunk({
  _tag: "IEmpty"
});
var empty4 = () => _empty2;
var make6 = (...as7) => unsafeFromNonEmptyArray(as7);
var of2 = (a) => makeChunk({
  _tag: "ISingleton",
  a
});
var fromIterable2 = (self) => isChunk(self) ? self : unsafeFromArray(fromIterable(self));
var copyToArray = (self, array3, initial) => {
  switch (self.backing._tag) {
    case "IArray": {
      copy2(self.backing.array, 0, array3, initial, self.length);
      break;
    }
    case "IConcat": {
      copyToArray(self.left, array3, initial);
      copyToArray(self.right, array3, initial + self.left.length);
      break;
    }
    case "ISingleton": {
      array3[initial] = self.backing.a;
      break;
    }
    case "ISlice": {
      let i = 0;
      let j = initial;
      while (i < self.length) {
        array3[j] = unsafeGet4(self, i);
        i += 1;
        j += 1;
      }
      break;
    }
  }
};
var toReadonlyArray_ = (self) => {
  switch (self.backing._tag) {
    case "IEmpty": {
      return emptyArray;
    }
    case "IArray": {
      return self.backing.array;
    }
    default: {
      const arr = new Array(self.length);
      copyToArray(self, arr, 0);
      self.backing = {
        _tag: "IArray",
        array: arr
      };
      self.left = _empty2;
      self.right = _empty2;
      self.depth = 0;
      return arr;
    }
  }
};
var toReadonlyArray = toReadonlyArray_;
var reverseChunk = (self) => {
  switch (self.backing._tag) {
    case "IEmpty":
    case "ISingleton":
      return self;
    case "IArray": {
      return makeChunk({
        _tag: "IArray",
        array: reverse(self.backing.array)
      });
    }
    case "IConcat": {
      return makeChunk({
        _tag: "IConcat",
        left: reverse2(self.backing.right),
        right: reverse2(self.backing.left)
      });
    }
    case "ISlice":
      return unsafeFromArray(reverse(toReadonlyArray(self)));
  }
};
var reverse2 = reverseChunk;
var get4 = /* @__PURE__ */ dual(2, (self, index) => index < 0 || index >= self.length ? none2() : some2(unsafeGet4(self, index)));
var unsafeFromArray = (self) => self.length === 0 ? empty4() : self.length === 1 ? of2(self[0]) : makeChunk({
  _tag: "IArray",
  array: self
});
var unsafeFromNonEmptyArray = (self) => unsafeFromArray(self);
var unsafeGet4 = /* @__PURE__ */ dual(2, (self, index) => {
  switch (self.backing._tag) {
    case "IEmpty": {
      throw new Error(`Index out of bounds`);
    }
    case "ISingleton": {
      if (index !== 0) {
        throw new Error(`Index out of bounds`);
      }
      return self.backing.a;
    }
    case "IArray": {
      if (index >= self.length || index < 0) {
        throw new Error(`Index out of bounds`);
      }
      return self.backing.array[index];
    }
    case "IConcat": {
      return index < self.left.length ? unsafeGet4(self.left, index) : unsafeGet4(self.right, index - self.left.length);
    }
    case "ISlice": {
      return unsafeGet4(self.backing.chunk, index + self.backing.offset);
    }
  }
});
var append2 = /* @__PURE__ */ dual(2, (self, a) => appendAll2(self, of2(a)));
var prepend2 = /* @__PURE__ */ dual(2, (self, elem) => appendAll2(of2(elem), self));
var drop2 = /* @__PURE__ */ dual(2, (self, n) => {
  if (n <= 0) {
    return self;
  } else if (n >= self.length) {
    return _empty2;
  } else {
    switch (self.backing._tag) {
      case "ISlice": {
        return makeChunk({
          _tag: "ISlice",
          chunk: self.backing.chunk,
          offset: self.backing.offset + n,
          length: self.backing.length - n
        });
      }
      case "IConcat": {
        if (n > self.left.length) {
          return drop2(self.right, n - self.left.length);
        }
        return makeChunk({
          _tag: "IConcat",
          left: drop2(self.left, n),
          right: self.right
        });
      }
      default: {
        return makeChunk({
          _tag: "ISlice",
          chunk: self,
          offset: n,
          length: self.length - n
        });
      }
    }
  }
});
var appendAll2 = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.backing._tag === "IEmpty") {
    return that;
  }
  if (that.backing._tag === "IEmpty") {
    return self;
  }
  const diff8 = that.depth - self.depth;
  if (Math.abs(diff8) <= 1) {
    return makeChunk({
      _tag: "IConcat",
      left: self,
      right: that
    });
  } else if (diff8 < -1) {
    if (self.left.depth >= self.right.depth) {
      const nr = appendAll2(self.right, that);
      return makeChunk({
        _tag: "IConcat",
        left: self.left,
        right: nr
      });
    } else {
      const nrr = appendAll2(self.right.right, that);
      if (nrr.depth === self.depth - 3) {
        const nr = makeChunk({
          _tag: "IConcat",
          left: self.right.left,
          right: nrr
        });
        return makeChunk({
          _tag: "IConcat",
          left: self.left,
          right: nr
        });
      } else {
        const nl = makeChunk({
          _tag: "IConcat",
          left: self.left,
          right: self.right.left
        });
        return makeChunk({
          _tag: "IConcat",
          left: nl,
          right: nrr
        });
      }
    }
  } else {
    if (that.right.depth >= that.left.depth) {
      const nl = appendAll2(self, that.left);
      return makeChunk({
        _tag: "IConcat",
        left: nl,
        right: that.right
      });
    } else {
      const nll = appendAll2(self, that.left.left);
      if (nll.depth === that.depth - 3) {
        const nl = makeChunk({
          _tag: "IConcat",
          left: nll,
          right: that.left.right
        });
        return makeChunk({
          _tag: "IConcat",
          left: nl,
          right: that.right
        });
      } else {
        const nr = makeChunk({
          _tag: "IConcat",
          left: that.left.right,
          right: that.right
        });
        return makeChunk({
          _tag: "IConcat",
          left: nll,
          right: nr
        });
      }
    }
  }
});
var isEmpty = (self) => self.length === 0;
var isNonEmpty = (self) => self.length > 0;
var head2 = /* @__PURE__ */ get4(0);
var unsafeHead = (self) => unsafeGet4(self, 0);
var headNonEmpty2 = unsafeHead;
var tailNonEmpty2 = (self) => drop2(self, 1);

// node_modules/effect/dist/esm/Duration.js
var Duration_exports = {};
__export(Duration_exports, {
  Equivalence: () => Equivalence,
  Order: () => Order2,
  between: () => between2,
  clamp: () => clamp3,
  days: () => days,
  decode: () => decode,
  decodeUnknown: () => decodeUnknown,
  divide: () => divide,
  equals: () => equals2,
  format: () => format2,
  formatIso: () => formatIso,
  fromIso: () => fromIso,
  greaterThan: () => greaterThan2,
  greaterThanOrEqualTo: () => greaterThanOrEqualTo2,
  hours: () => hours,
  infinity: () => infinity,
  isDuration: () => isDuration,
  isFinite: () => isFinite,
  isZero: () => isZero,
  lessThan: () => lessThan2,
  lessThanOrEqualTo: () => lessThanOrEqualTo2,
  match: () => match3,
  matchWith: () => matchWith,
  max: () => max2,
  micros: () => micros,
  millis: () => millis,
  min: () => min2,
  minutes: () => minutes,
  nanos: () => nanos,
  parts: () => parts,
  seconds: () => seconds,
  subtract: () => subtract,
  sum: () => sum,
  times: () => times,
  toDays: () => toDays,
  toHours: () => toHours,
  toHrTime: () => toHrTime,
  toMillis: () => toMillis,
  toMinutes: () => toMinutes,
  toNanos: () => toNanos,
  toSeconds: () => toSeconds,
  toWeeks: () => toWeeks,
  unsafeDivide: () => unsafeDivide,
  unsafeFormatIso: () => unsafeFormatIso,
  unsafeToNanos: () => unsafeToNanos,
  weeks: () => weeks,
  zero: () => zero
});
var TypeId5 = /* @__PURE__ */ Symbol.for("effect/Duration");
var bigint0 = /* @__PURE__ */ BigInt(0);
var bigint24 = /* @__PURE__ */ BigInt(24);
var bigint60 = /* @__PURE__ */ BigInt(60);
var bigint1e3 = /* @__PURE__ */ BigInt(1e3);
var bigint1e6 = /* @__PURE__ */ BigInt(1e6);
var bigint1e9 = /* @__PURE__ */ BigInt(1e9);
var DURATION_REGEX = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
var decode = (input) => {
  if (isDuration(input)) {
    return input;
  } else if (isNumber(input)) {
    return millis(input);
  } else if (isBigInt(input)) {
    return nanos(input);
  } else if (Array.isArray(input) && input.length === 2 && input.every(isNumber)) {
    if (input[0] === -Infinity || input[1] === -Infinity || Number.isNaN(input[0]) || Number.isNaN(input[1])) {
      return zero;
    }
    if (input[0] === Infinity || input[1] === Infinity) {
      return infinity;
    }
    return nanos(BigInt(Math.round(input[0] * 1e9)) + BigInt(Math.round(input[1])));
  } else if (isString(input)) {
    const match12 = DURATION_REGEX.exec(input);
    if (match12) {
      const [_, valueStr, unit] = match12;
      const value = Number(valueStr);
      switch (unit) {
        case "nano":
        case "nanos":
          return nanos(BigInt(valueStr));
        case "micro":
        case "micros":
          return micros(BigInt(valueStr));
        case "milli":
        case "millis":
          return millis(value);
        case "second":
        case "seconds":
          return seconds(value);
        case "minute":
        case "minutes":
          return minutes(value);
        case "hour":
        case "hours":
          return hours(value);
        case "day":
        case "days":
          return days(value);
        case "week":
        case "weeks":
          return weeks(value);
      }
    }
  }
  throw new Error("Invalid DurationInput");
};
var decodeUnknown = /* @__PURE__ */ liftThrowable(decode);
var zeroValue = {
  _tag: "Millis",
  millis: 0
};
var infinityValue = {
  _tag: "Infinity"
};
var DurationProto = {
  [TypeId5]: TypeId5,
  [symbol]() {
    return cached(this, structure(this.value));
  },
  [symbol2](that) {
    return isDuration(that) && equals2(this, that);
  },
  toString() {
    return `Duration(${format2(this)})`;
  },
  toJSON() {
    switch (this.value._tag) {
      case "Millis":
        return {
          _id: "Duration",
          _tag: "Millis",
          millis: this.value.millis
        };
      case "Nanos":
        return {
          _id: "Duration",
          _tag: "Nanos",
          hrtime: toHrTime(this)
        };
      case "Infinity":
        return {
          _id: "Duration",
          _tag: "Infinity"
        };
    }
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make7 = (input) => {
  const duration = Object.create(DurationProto);
  if (isNumber(input)) {
    if (isNaN(input) || input <= 0) {
      duration.value = zeroValue;
    } else if (!Number.isFinite(input)) {
      duration.value = infinityValue;
    } else if (!Number.isInteger(input)) {
      duration.value = {
        _tag: "Nanos",
        nanos: BigInt(Math.round(input * 1e6))
      };
    } else {
      duration.value = {
        _tag: "Millis",
        millis: input
      };
    }
  } else if (input <= bigint0) {
    duration.value = zeroValue;
  } else {
    duration.value = {
      _tag: "Nanos",
      nanos: input
    };
  }
  return duration;
};
var isDuration = (u) => hasProperty(u, TypeId5);
var isFinite = (self) => self.value._tag !== "Infinity";
var isZero = (self) => {
  switch (self.value._tag) {
    case "Millis": {
      return self.value.millis === 0;
    }
    case "Nanos": {
      return self.value.nanos === bigint0;
    }
    case "Infinity": {
      return false;
    }
  }
};
var zero = /* @__PURE__ */ make7(0);
var infinity = /* @__PURE__ */ make7(Infinity);
var nanos = (nanos2) => make7(nanos2);
var micros = (micros2) => make7(micros2 * bigint1e3);
var millis = (millis2) => make7(millis2);
var seconds = (seconds2) => make7(seconds2 * 1e3);
var minutes = (minutes2) => make7(minutes2 * 6e4);
var hours = (hours2) => make7(hours2 * 36e5);
var days = (days2) => make7(days2 * 864e5);
var weeks = (weeks2) => make7(weeks2 * 6048e5);
var toMillis = (self) => match3(self, {
  onMillis: (millis2) => millis2,
  onNanos: (nanos2) => Number(nanos2) / 1e6
});
var toSeconds = (self) => match3(self, {
  onMillis: (millis2) => millis2 / 1e3,
  onNanos: (nanos2) => Number(nanos2) / 1e9
});
var toMinutes = (self) => match3(self, {
  onMillis: (millis2) => millis2 / 6e4,
  onNanos: (nanos2) => Number(nanos2) / 6e10
});
var toHours = (self) => match3(self, {
  onMillis: (millis2) => millis2 / 36e5,
  onNanos: (nanos2) => Number(nanos2) / 36e11
});
var toDays = (self) => match3(self, {
  onMillis: (millis2) => millis2 / 864e5,
  onNanos: (nanos2) => Number(nanos2) / 864e11
});
var toWeeks = (self) => match3(self, {
  onMillis: (millis2) => millis2 / 6048e5,
  onNanos: (nanos2) => Number(nanos2) / 6048e11
});
var toNanos = (self) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Infinity":
      return none2();
    case "Nanos":
      return some2(_self.value.nanos);
    case "Millis":
      return some2(BigInt(Math.round(_self.value.millis * 1e6)));
  }
};
var unsafeToNanos = (self) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Infinity":
      throw new Error("Cannot convert infinite duration to nanos");
    case "Nanos":
      return _self.value.nanos;
    case "Millis":
      return BigInt(Math.round(_self.value.millis * 1e6));
  }
};
var toHrTime = (self) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Infinity":
      return [Infinity, 0];
    case "Nanos":
      return [Number(_self.value.nanos / bigint1e9), Number(_self.value.nanos % bigint1e9)];
    case "Millis":
      return [Math.floor(_self.value.millis / 1e3), Math.round(_self.value.millis % 1e3 * 1e6)];
  }
};
var match3 = /* @__PURE__ */ dual(2, (self, options) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Nanos":
      return options.onNanos(_self.value.nanos);
    case "Infinity":
      return options.onMillis(Infinity);
    case "Millis":
      return options.onMillis(_self.value.millis);
  }
});
var matchWith = /* @__PURE__ */ dual(3, (self, that, options) => {
  const _self = decode(self);
  const _that = decode(that);
  if (_self.value._tag === "Infinity" || _that.value._tag === "Infinity") {
    return options.onMillis(toMillis(_self), toMillis(_that));
  } else if (_self.value._tag === "Nanos" || _that.value._tag === "Nanos") {
    const selfNanos = _self.value._tag === "Nanos" ? _self.value.nanos : BigInt(Math.round(_self.value.millis * 1e6));
    const thatNanos = _that.value._tag === "Nanos" ? _that.value.nanos : BigInt(Math.round(_that.value.millis * 1e6));
    return options.onNanos(selfNanos, thatNanos);
  }
  return options.onMillis(_self.value.millis, _that.value.millis);
});
var Order2 = /* @__PURE__ */ make2((self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 < that2 ? -1 : self2 > that2 ? 1 : 0,
  onNanos: (self2, that2) => self2 < that2 ? -1 : self2 > that2 ? 1 : 0
}));
var between2 = /* @__PURE__ */ between(/* @__PURE__ */ mapInput2(Order2, decode));
var Equivalence = (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 === that2,
  onNanos: (self2, that2) => self2 === that2
});
var _min = /* @__PURE__ */ min(Order2);
var min2 = /* @__PURE__ */ dual(2, (self, that) => _min(decode(self), decode(that)));
var _max = /* @__PURE__ */ max(Order2);
var max2 = /* @__PURE__ */ dual(2, (self, that) => _max(decode(self), decode(that)));
var _clamp = /* @__PURE__ */ clamp(Order2);
var clamp3 = /* @__PURE__ */ dual(2, (self, options) => _clamp(decode(self), {
  minimum: decode(options.minimum),
  maximum: decode(options.maximum)
}));
var divide = /* @__PURE__ */ dual(2, (self, by) => match3(self, {
  onMillis: (millis2) => {
    if (by === 0 || isNaN(by) || !Number.isFinite(by)) {
      return none2();
    }
    return some2(make7(millis2 / by));
  },
  onNanos: (nanos2) => {
    if (isNaN(by) || by <= 0 || !Number.isFinite(by)) {
      return none2();
    }
    try {
      return some2(make7(nanos2 / BigInt(by)));
    } catch {
      return none2();
    }
  }
}));
var unsafeDivide = /* @__PURE__ */ dual(2, (self, by) => match3(self, {
  onMillis: (millis2) => make7(millis2 / by),
  onNanos: (nanos2) => {
    if (isNaN(by) || by < 0 || Object.is(by, -0)) {
      return zero;
    } else if (Object.is(by, 0) || !Number.isFinite(by)) {
      return infinity;
    }
    return make7(nanos2 / BigInt(by));
  }
}));
var times = /* @__PURE__ */ dual(2, (self, times2) => match3(self, {
  onMillis: (millis2) => make7(millis2 * times2),
  onNanos: (nanos2) => make7(nanos2 * BigInt(times2))
}));
var subtract = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => make7(self2 - that2),
  onNanos: (self2, that2) => make7(self2 - that2)
}));
var sum = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => make7(self2 + that2),
  onNanos: (self2, that2) => make7(self2 + that2)
}));
var lessThan2 = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 < that2,
  onNanos: (self2, that2) => self2 < that2
}));
var lessThanOrEqualTo2 = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 <= that2,
  onNanos: (self2, that2) => self2 <= that2
}));
var greaterThan2 = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 > that2,
  onNanos: (self2, that2) => self2 > that2
}));
var greaterThanOrEqualTo2 = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 >= that2,
  onNanos: (self2, that2) => self2 >= that2
}));
var equals2 = /* @__PURE__ */ dual(2, (self, that) => Equivalence(decode(self), decode(that)));
var parts = (self) => {
  const duration = decode(self);
  if (duration.value._tag === "Infinity") {
    return {
      days: Infinity,
      hours: Infinity,
      minutes: Infinity,
      seconds: Infinity,
      millis: Infinity,
      nanos: Infinity
    };
  }
  const nanos2 = unsafeToNanos(duration);
  const ms = nanos2 / bigint1e6;
  const sec = ms / bigint1e3;
  const min4 = sec / bigint60;
  const hr = min4 / bigint60;
  const days2 = hr / bigint24;
  return {
    days: Number(days2),
    hours: Number(hr % bigint24),
    minutes: Number(min4 % bigint60),
    seconds: Number(sec % bigint60),
    millis: Number(ms % bigint1e3),
    nanos: Number(nanos2 % bigint1e6)
  };
};
var format2 = (self) => {
  const duration = decode(self);
  if (duration.value._tag === "Infinity") {
    return "Infinity";
  }
  if (isZero(duration)) {
    return "0";
  }
  const fragments = parts(duration);
  const pieces = [];
  if (fragments.days !== 0) {
    pieces.push(`${fragments.days}d`);
  }
  if (fragments.hours !== 0) {
    pieces.push(`${fragments.hours}h`);
  }
  if (fragments.minutes !== 0) {
    pieces.push(`${fragments.minutes}m`);
  }
  if (fragments.seconds !== 0) {
    pieces.push(`${fragments.seconds}s`);
  }
  if (fragments.millis !== 0) {
    pieces.push(`${fragments.millis}ms`);
  }
  if (fragments.nanos !== 0) {
    pieces.push(`${fragments.nanos}ns`);
  }
  return pieces.join(" ");
};
var unsafeFormatIso = (self) => {
  const duration = decode(self);
  if (!isFinite(duration)) {
    throw new RangeError("Cannot format infinite duration");
  }
  const fragments = [];
  const {
    days: days2,
    hours: hours2,
    millis: millis2,
    minutes: minutes2,
    nanos: nanos2,
    seconds: seconds2
  } = parts(duration);
  let rest = days2;
  if (rest >= 365) {
    const years = Math.floor(rest / 365);
    rest %= 365;
    fragments.push(`${years}Y`);
  }
  if (rest >= 30) {
    const months = Math.floor(rest / 30);
    rest %= 30;
    fragments.push(`${months}M`);
  }
  if (rest >= 7) {
    const weeks2 = Math.floor(rest / 7);
    rest %= 7;
    fragments.push(`${weeks2}W`);
  }
  if (rest > 0) {
    fragments.push(`${rest}D`);
  }
  if (hours2 !== 0 || minutes2 !== 0 || seconds2 !== 0 || millis2 !== 0 || nanos2 !== 0) {
    fragments.push("T");
    if (hours2 !== 0) {
      fragments.push(`${hours2}H`);
    }
    if (minutes2 !== 0) {
      fragments.push(`${minutes2}M`);
    }
    if (seconds2 !== 0 || millis2 !== 0 || nanos2 !== 0) {
      const total = BigInt(seconds2) * bigint1e9 + BigInt(millis2) * bigint1e6 + BigInt(nanos2);
      const str = (Number(total) / 1e9).toFixed(9).replace(/\.?0+$/, "");
      fragments.push(`${str}S`);
    }
  }
  return `P${fragments.join("") || "T0S"}`;
};
var formatIso = (self) => {
  const duration = decode(self);
  return isFinite(duration) ? some2(unsafeFormatIso(duration)) : none2();
};
var fromIso = (iso) => {
  const result = DURATION_ISO_REGEX.exec(iso);
  if (result == null) {
    return none2();
  }
  const [years, months, weeks2, days2, hours2, mins, secs] = result.slice(1, 8).map((_) => _ ? Number(_) : 0);
  const value = years * 365 * 24 * 60 * 60 + months * 30 * 24 * 60 * 60 + weeks2 * 7 * 24 * 60 * 60 + days2 * 24 * 60 * 60 + hours2 * 60 * 60 + mins * 60 + secs;
  return some2(seconds(value));
};
var DURATION_ISO_REGEX = /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

// node_modules/effect/dist/esm/internal/hashMap/config.js
var SIZE = 5;
var BUCKET_SIZE = /* @__PURE__ */ Math.pow(2, SIZE);
var MASK = BUCKET_SIZE - 1;
var MAX_INDEX_NODE = BUCKET_SIZE / 2;
var MIN_ARRAY_NODE = BUCKET_SIZE / 4;

// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function popcount(x) {
  x -= x >> 1 & 1431655765;
  x = (x & 858993459) + (x >> 2 & 858993459);
  x = x + (x >> 4) & 252645135;
  x += x >> 8;
  x += x >> 16;
  return x & 127;
}
function hashFragment(shift2, h) {
  return h >>> shift2 & MASK;
}
function toBitmap(x) {
  return 1 << x;
}
function fromBitmap(bitmap, bit) {
  return popcount(bitmap & bit - 1);
}

// node_modules/effect/dist/esm/internal/stack.js
var make8 = (value, previous) => ({
  value,
  previous
});

// node_modules/effect/dist/esm/internal/hashMap/array.js
function arrayUpdate(mutate4, at2, v, arr) {
  let out = arr;
  if (!mutate4) {
    const len = arr.length;
    out = new Array(len);
    for (let i = 0; i < len; ++i) out[i] = arr[i];
  }
  out[at2] = v;
  return out;
}
function arraySpliceOut(mutate4, at2, arr) {
  const newLen = arr.length - 1;
  let i = 0;
  let g = 0;
  let out = arr;
  if (mutate4) {
    i = g = at2;
  } else {
    out = new Array(newLen);
    while (i < at2) out[g++] = arr[i++];
  }
  ++i;
  while (i <= newLen) out[g++] = arr[i++];
  if (mutate4) {
    out.length = newLen;
  }
  return out;
}
function arraySpliceIn(mutate4, at2, v, arr) {
  const len = arr.length;
  if (mutate4) {
    let i2 = len;
    while (i2 >= at2) arr[i2--] = arr[i2];
    arr[at2] = v;
    return arr;
  }
  let i = 0, g = 0;
  const out = new Array(len + 1);
  while (i < at2) out[g++] = arr[i++];
  out[at2] = v;
  while (i < len) out[++g] = arr[i++];
  return out;
}

// node_modules/effect/dist/esm/internal/hashMap/node.js
var EmptyNode = class _EmptyNode {
  _tag = "EmptyNode";
  modify(edit, _shift, f, hash2, key, size11) {
    const v = f(none2());
    if (isNone2(v)) return new _EmptyNode();
    ++size11.value;
    return new LeafNode(edit, hash2, key, v);
  }
};
function isEmptyNode(a) {
  return isTagged(a, "EmptyNode");
}
function isLeafNode(node) {
  return isEmptyNode(node) || node._tag === "LeafNode" || node._tag === "CollisionNode";
}
function canEditNode(node, edit) {
  return isEmptyNode(node) ? false : edit === node.edit;
}
var LeafNode = class _LeafNode {
  edit;
  hash;
  key;
  value;
  _tag = "LeafNode";
  constructor(edit, hash2, key, value) {
    this.edit = edit;
    this.hash = hash2;
    this.key = key;
    this.value = value;
  }
  modify(edit, shift2, f, hash2, key, size11) {
    if (equals(key, this.key)) {
      const v2 = f(this.value);
      if (v2 === this.value) return this;
      else if (isNone2(v2)) {
        --size11.value;
        return new EmptyNode();
      }
      if (canEditNode(this, edit)) {
        this.value = v2;
        return this;
      }
      return new _LeafNode(edit, hash2, key, v2);
    }
    const v = f(none2());
    if (isNone2(v)) return this;
    ++size11.value;
    return mergeLeaves(edit, shift2, this.hash, this, hash2, new _LeafNode(edit, hash2, key, v));
  }
};
var CollisionNode = class _CollisionNode {
  edit;
  hash;
  children;
  _tag = "CollisionNode";
  constructor(edit, hash2, children) {
    this.edit = edit;
    this.hash = hash2;
    this.children = children;
  }
  modify(edit, shift2, f, hash2, key, size11) {
    if (hash2 === this.hash) {
      const canEdit = canEditNode(this, edit);
      const list = this.updateCollisionList(canEdit, edit, this.hash, this.children, f, key, size11);
      if (list === this.children) return this;
      return list.length > 1 ? new _CollisionNode(edit, this.hash, list) : list[0];
    }
    const v = f(none2());
    if (isNone2(v)) return this;
    ++size11.value;
    return mergeLeaves(edit, shift2, this.hash, this, hash2, new LeafNode(edit, hash2, key, v));
  }
  updateCollisionList(mutate4, edit, hash2, list, f, key, size11) {
    const len = list.length;
    for (let i = 0; i < len; ++i) {
      const child = list[i];
      if ("key" in child && equals(key, child.key)) {
        const value = child.value;
        const newValue2 = f(value);
        if (newValue2 === value) return list;
        if (isNone2(newValue2)) {
          --size11.value;
          return arraySpliceOut(mutate4, i, list);
        }
        return arrayUpdate(mutate4, i, new LeafNode(edit, hash2, key, newValue2), list);
      }
    }
    const newValue = f(none2());
    if (isNone2(newValue)) return list;
    ++size11.value;
    return arrayUpdate(mutate4, len, new LeafNode(edit, hash2, key, newValue), list);
  }
};
var IndexedNode = class _IndexedNode {
  edit;
  mask;
  children;
  _tag = "IndexedNode";
  constructor(edit, mask, children) {
    this.edit = edit;
    this.mask = mask;
    this.children = children;
  }
  modify(edit, shift2, f, hash2, key, size11) {
    const mask = this.mask;
    const children = this.children;
    const frag = hashFragment(shift2, hash2);
    const bit = toBitmap(frag);
    const indx = fromBitmap(mask, bit);
    const exists4 = mask & bit;
    const canEdit = canEditNode(this, edit);
    if (!exists4) {
      const _newChild = new EmptyNode().modify(edit, shift2 + SIZE, f, hash2, key, size11);
      if (!_newChild) return this;
      return children.length >= MAX_INDEX_NODE ? expand(edit, frag, _newChild, mask, children) : new _IndexedNode(edit, mask | bit, arraySpliceIn(canEdit, indx, _newChild, children));
    }
    const current = children[indx];
    const child = current.modify(edit, shift2 + SIZE, f, hash2, key, size11);
    if (current === child) return this;
    let bitmap = mask;
    let newChildren;
    if (isEmptyNode(child)) {
      bitmap &= ~bit;
      if (!bitmap) return new EmptyNode();
      if (children.length <= 2 && isLeafNode(children[indx ^ 1])) {
        return children[indx ^ 1];
      }
      newChildren = arraySpliceOut(canEdit, indx, children);
    } else {
      newChildren = arrayUpdate(canEdit, indx, child, children);
    }
    if (canEdit) {
      this.mask = bitmap;
      this.children = newChildren;
      return this;
    }
    return new _IndexedNode(edit, bitmap, newChildren);
  }
};
var ArrayNode = class _ArrayNode {
  edit;
  size;
  children;
  _tag = "ArrayNode";
  constructor(edit, size11, children) {
    this.edit = edit;
    this.size = size11;
    this.children = children;
  }
  modify(edit, shift2, f, hash2, key, size11) {
    let count = this.size;
    const children = this.children;
    const frag = hashFragment(shift2, hash2);
    const child = children[frag];
    const newChild = (child || new EmptyNode()).modify(edit, shift2 + SIZE, f, hash2, key, size11);
    if (child === newChild) return this;
    const canEdit = canEditNode(this, edit);
    let newChildren;
    if (isEmptyNode(child) && !isEmptyNode(newChild)) {
      ++count;
      newChildren = arrayUpdate(canEdit, frag, newChild, children);
    } else if (!isEmptyNode(child) && isEmptyNode(newChild)) {
      --count;
      if (count <= MIN_ARRAY_NODE) {
        return pack(edit, count, frag, children);
      }
      newChildren = arrayUpdate(canEdit, frag, new EmptyNode(), children);
    } else {
      newChildren = arrayUpdate(canEdit, frag, newChild, children);
    }
    if (canEdit) {
      this.size = count;
      this.children = newChildren;
      return this;
    }
    return new _ArrayNode(edit, count, newChildren);
  }
};
function pack(edit, count, removed, elements) {
  const children = new Array(count - 1);
  let g = 0;
  let bitmap = 0;
  for (let i = 0, len = elements.length; i < len; ++i) {
    if (i !== removed) {
      const elem = elements[i];
      if (elem && !isEmptyNode(elem)) {
        children[g++] = elem;
        bitmap |= 1 << i;
      }
    }
  }
  return new IndexedNode(edit, bitmap, children);
}
function expand(edit, frag, child, bitmap, subNodes) {
  const arr = [];
  let bit = bitmap;
  let count = 0;
  for (let i = 0; bit; ++i) {
    if (bit & 1) arr[i] = subNodes[count++];
    bit >>>= 1;
  }
  arr[frag] = child;
  return new ArrayNode(edit, count + 1, arr);
}
function mergeLeavesInner(edit, shift2, h1, n1, h2, n2) {
  if (h1 === h2) return new CollisionNode(edit, h1, [n2, n1]);
  const subH1 = hashFragment(shift2, h1);
  const subH2 = hashFragment(shift2, h2);
  if (subH1 === subH2) {
    return (child) => new IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2), [child]);
  } else {
    const children = subH1 < subH2 ? [n1, n2] : [n2, n1];
    return new IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2), children);
  }
}
function mergeLeaves(edit, shift2, h1, n1, h2, n2) {
  let stack = void 0;
  let currentShift = shift2;
  while (true) {
    const res = mergeLeavesInner(edit, currentShift, h1, n1, h2, n2);
    if (typeof res === "function") {
      stack = make8(res, stack);
      currentShift = currentShift + SIZE;
    } else {
      let final = res;
      while (stack != null) {
        final = stack.value(final);
        stack = stack.previous;
      }
      return final;
    }
  }
}

// node_modules/effect/dist/esm/internal/hashMap.js
var HashMapSymbolKey = "effect/HashMap";
var HashMapTypeId = /* @__PURE__ */ Symbol.for(HashMapSymbolKey);
var HashMapProto = {
  [HashMapTypeId]: HashMapTypeId,
  [Symbol.iterator]() {
    return new HashMapIterator(this, (k, v) => [k, v]);
  },
  [symbol]() {
    let hash2 = hash(HashMapSymbolKey);
    for (const item of this) {
      hash2 ^= pipe(hash(item[0]), combine(hash(item[1])));
    }
    return cached(this, hash2);
  },
  [symbol2](that) {
    if (isHashMap(that)) {
      if (that._size !== this._size) {
        return false;
      }
      for (const item of this) {
        const elem = pipe(that, getHash(item[0], hash(item[0])));
        if (isNone2(elem)) {
          return false;
        } else {
          if (!equals(item[1], elem.value)) {
            return false;
          }
        }
      }
      return true;
    }
    return false;
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "HashMap",
      values: Array.from(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeImpl = (editable, edit, root, size11) => {
  const map14 = Object.create(HashMapProto);
  map14._editable = editable;
  map14._edit = edit;
  map14._root = root;
  map14._size = size11;
  return map14;
};
var HashMapIterator = class _HashMapIterator {
  map;
  f;
  v;
  constructor(map14, f) {
    this.map = map14;
    this.f = f;
    this.v = visitLazy(this.map._root, this.f, void 0);
  }
  next() {
    if (isNone2(this.v)) {
      return {
        done: true,
        value: void 0
      };
    }
    const v0 = this.v.value;
    this.v = applyCont(v0.cont);
    return {
      done: false,
      value: v0.value
    };
  }
  [Symbol.iterator]() {
    return new _HashMapIterator(this.map, this.f);
  }
};
var applyCont = (cont) => cont ? visitLazyChildren(cont[0], cont[1], cont[2], cont[3], cont[4]) : none2();
var visitLazy = (node, f, cont = void 0) => {
  switch (node._tag) {
    case "LeafNode": {
      if (isSome2(node.value)) {
        return some2({
          value: f(node.key, node.value.value),
          cont
        });
      }
      return applyCont(cont);
    }
    case "CollisionNode":
    case "ArrayNode":
    case "IndexedNode": {
      const children = node.children;
      return visitLazyChildren(children.length, children, 0, f, cont);
    }
    default: {
      return applyCont(cont);
    }
  }
};
var visitLazyChildren = (len, children, i, f, cont) => {
  while (i < len) {
    const child = children[i++];
    if (child && !isEmptyNode(child)) {
      return visitLazy(child, f, [len, children, i, f, cont]);
    }
  }
  return applyCont(cont);
};
var _empty3 = /* @__PURE__ */ makeImpl(false, 0, /* @__PURE__ */ new EmptyNode(), 0);
var empty5 = () => _empty3;
var fromIterable3 = (entries2) => {
  const map14 = beginMutation(empty5());
  for (const entry of entries2) {
    set(map14, entry[0], entry[1]);
  }
  return endMutation(map14);
};
var isHashMap = (u) => hasProperty(u, HashMapTypeId);
var isEmpty2 = (self) => self && isEmptyNode(self._root);
var get5 = /* @__PURE__ */ dual(2, (self, key) => getHash(self, key, hash(key)));
var getHash = /* @__PURE__ */ dual(3, (self, key, hash2) => {
  let node = self._root;
  let shift2 = 0;
  while (true) {
    switch (node._tag) {
      case "LeafNode": {
        return equals(key, node.key) ? node.value : none2();
      }
      case "CollisionNode": {
        if (hash2 === node.hash) {
          const children = node.children;
          for (let i = 0, len = children.length; i < len; ++i) {
            const child = children[i];
            if ("key" in child && equals(key, child.key)) {
              return child.value;
            }
          }
        }
        return none2();
      }
      case "IndexedNode": {
        const frag = hashFragment(shift2, hash2);
        const bit = toBitmap(frag);
        if (node.mask & bit) {
          node = node.children[fromBitmap(node.mask, bit)];
          shift2 += SIZE;
          break;
        }
        return none2();
      }
      case "ArrayNode": {
        node = node.children[hashFragment(shift2, hash2)];
        if (node) {
          shift2 += SIZE;
          break;
        }
        return none2();
      }
      default:
        return none2();
    }
  }
});
var has = /* @__PURE__ */ dual(2, (self, key) => isSome2(getHash(self, key, hash(key))));
var set = /* @__PURE__ */ dual(3, (self, key, value) => modifyAt(self, key, () => some2(value)));
var setTree = /* @__PURE__ */ dual(3, (self, newRoot, newSize) => {
  if (self._editable) {
    ;
    self._root = newRoot;
    self._size = newSize;
    return self;
  }
  return newRoot === self._root ? self : makeImpl(self._editable, self._edit, newRoot, newSize);
});
var keys = (self) => new HashMapIterator(self, (key) => key);
var size = (self) => self._size;
var beginMutation = (self) => makeImpl(true, self._edit + 1, self._root, self._size);
var endMutation = (self) => {
  ;
  self._editable = false;
  return self;
};
var mutate = /* @__PURE__ */ dual(2, (self, f) => {
  const transient = beginMutation(self);
  f(transient);
  return endMutation(transient);
});
var modifyAt = /* @__PURE__ */ dual(3, (self, key, f) => modifyHash(self, key, hash(key), f));
var modifyHash = /* @__PURE__ */ dual(4, (self, key, hash2, f) => {
  const size11 = {
    value: self._size
  };
  const newRoot = self._root.modify(self._editable ? self._edit : NaN, 0, f, hash2, key, size11);
  return pipe(self, setTree(newRoot, size11.value));
});
var remove2 = /* @__PURE__ */ dual(2, (self, key) => modifyAt(self, key, none2));
var map3 = /* @__PURE__ */ dual(2, (self, f) => reduce2(self, empty5(), (map14, value, key) => set(map14, key, f(value, key))));
var forEach = /* @__PURE__ */ dual(2, (self, f) => reduce2(self, void 0, (_, value, key) => f(value, key)));
var reduce2 = /* @__PURE__ */ dual(3, (self, zero2, f) => {
  const root = self._root;
  if (root._tag === "LeafNode") {
    return isSome2(root.value) ? f(zero2, root.value.value, root.key) : zero2;
  }
  if (root._tag === "EmptyNode") {
    return zero2;
  }
  const toVisit = [root.children];
  let children;
  while (children = toVisit.pop()) {
    for (let i = 0, len = children.length; i < len; ) {
      const child = children[i++];
      if (child && !isEmptyNode(child)) {
        if (child._tag === "LeafNode") {
          if (isSome2(child.value)) {
            zero2 = f(zero2, child.value.value, child.key);
          }
        } else {
          toVisit.push(child.children);
        }
      }
    }
  }
  return zero2;
});

// node_modules/effect/dist/esm/internal/hashSet.js
var HashSetSymbolKey = "effect/HashSet";
var HashSetTypeId = /* @__PURE__ */ Symbol.for(HashSetSymbolKey);
var HashSetProto = {
  [HashSetTypeId]: HashSetTypeId,
  [Symbol.iterator]() {
    return keys(this._keyMap);
  },
  [symbol]() {
    return cached(this, combine(hash(this._keyMap))(hash(HashSetSymbolKey)));
  },
  [symbol2](that) {
    if (isHashSet(that)) {
      return size(this._keyMap) === size(that._keyMap) && equals(this._keyMap, that._keyMap);
    }
    return false;
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "HashSet",
      values: Array.from(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeImpl2 = (keyMap) => {
  const set6 = Object.create(HashSetProto);
  set6._keyMap = keyMap;
  return set6;
};
var isHashSet = (u) => hasProperty(u, HashSetTypeId);
var _empty4 = /* @__PURE__ */ makeImpl2(/* @__PURE__ */ empty5());
var empty6 = () => _empty4;
var fromIterable4 = (elements) => {
  const set6 = beginMutation2(empty6());
  for (const value of elements) {
    add3(set6, value);
  }
  return endMutation2(set6);
};
var make9 = (...elements) => {
  const set6 = beginMutation2(empty6());
  for (const value of elements) {
    add3(set6, value);
  }
  return endMutation2(set6);
};
var has2 = /* @__PURE__ */ dual(2, (self, value) => has(self._keyMap, value));
var size2 = (self) => size(self._keyMap);
var beginMutation2 = (self) => makeImpl2(beginMutation(self._keyMap));
var endMutation2 = (self) => {
  ;
  self._keyMap._editable = false;
  return self;
};
var mutate2 = /* @__PURE__ */ dual(2, (self, f) => {
  const transient = beginMutation2(self);
  f(transient);
  return endMutation2(transient);
});
var add3 = /* @__PURE__ */ dual(2, (self, value) => self._keyMap._editable ? (set(value, true)(self._keyMap), self) : makeImpl2(set(value, true)(self._keyMap)));
var remove3 = /* @__PURE__ */ dual(2, (self, value) => self._keyMap._editable ? (remove2(value)(self._keyMap), self) : makeImpl2(remove2(value)(self._keyMap)));
var difference2 = /* @__PURE__ */ dual(2, (self, that) => mutate2(self, (set6) => {
  for (const value of that) {
    remove3(set6, value);
  }
}));
var union2 = /* @__PURE__ */ dual(2, (self, that) => mutate2(empty6(), (set6) => {
  forEach2(self, (value) => add3(set6, value));
  for (const value of that) {
    add3(set6, value);
  }
}));
var map4 = /* @__PURE__ */ dual(2, (self, f) => mutate2(empty6(), (set6) => {
  forEach2(self, (a) => {
    const b = f(a);
    if (!has2(set6, b)) {
      add3(set6, b);
    }
  });
}));
var flatMap3 = /* @__PURE__ */ dual(2, (self, f) => mutate2(empty6(), (set6) => {
  forEach2(self, (a) => {
    for (const b of f(a)) {
      if (!has2(set6, b)) {
        add3(set6, b);
      }
    }
  });
}));
var forEach2 = /* @__PURE__ */ dual(2, (self, f) => forEach(self._keyMap, (_, k) => f(k)));
var reduce3 = /* @__PURE__ */ dual(3, (self, zero2, f) => reduce2(self._keyMap, zero2, (z, _, a) => f(z, a)));

// node_modules/effect/dist/esm/HashSet.js
var empty7 = empty6;
var fromIterable5 = fromIterable4;
var make10 = make9;
var has3 = has2;
var size3 = size2;
var add4 = add3;
var remove4 = remove3;
var difference3 = difference2;
var union3 = union2;
var map5 = map4;
var flatMap4 = flatMap3;
var reduce4 = reduce3;

// node_modules/effect/dist/esm/MutableRef.js
var TypeId6 = /* @__PURE__ */ Symbol.for("effect/MutableRef");
var MutableRefProto = {
  [TypeId6]: TypeId6,
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "MutableRef",
      current: toJSON(this.current)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make11 = (value) => {
  const ref = Object.create(MutableRefProto);
  ref.current = value;
  return ref;
};
var compareAndSet = /* @__PURE__ */ dual(3, (self, oldValue, newValue) => {
  if (equals(oldValue, self.current)) {
    self.current = newValue;
    return true;
  }
  return false;
});
var get6 = (self) => self.current;
var set2 = /* @__PURE__ */ dual(2, (self, value) => {
  self.current = value;
  return self;
});

// node_modules/effect/dist/esm/internal/fiberId.js
var FiberIdSymbolKey = "effect/FiberId";
var FiberIdTypeId = /* @__PURE__ */ Symbol.for(FiberIdSymbolKey);
var OP_NONE = "None";
var OP_RUNTIME = "Runtime";
var OP_COMPOSITE = "Composite";
var emptyHash = /* @__PURE__ */ string(`${FiberIdSymbolKey}-${OP_NONE}`);
var None = class {
  [FiberIdTypeId] = FiberIdTypeId;
  _tag = OP_NONE;
  id = -1;
  startTimeMillis = -1;
  [symbol]() {
    return emptyHash;
  }
  [symbol2](that) {
    return isFiberId(that) && that._tag === OP_NONE;
  }
  toString() {
    return format(this.toJSON());
  }
  toJSON() {
    return {
      _id: "FiberId",
      _tag: this._tag
    };
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var Runtime = class {
  id;
  startTimeMillis;
  [FiberIdTypeId] = FiberIdTypeId;
  _tag = OP_RUNTIME;
  constructor(id, startTimeMillis) {
    this.id = id;
    this.startTimeMillis = startTimeMillis;
  }
  [symbol]() {
    return cached(this, string(`${FiberIdSymbolKey}-${this._tag}-${this.id}-${this.startTimeMillis}`));
  }
  [symbol2](that) {
    return isFiberId(that) && that._tag === OP_RUNTIME && this.id === that.id && this.startTimeMillis === that.startTimeMillis;
  }
  toString() {
    return format(this.toJSON());
  }
  toJSON() {
    return {
      _id: "FiberId",
      _tag: this._tag,
      id: this.id,
      startTimeMillis: this.startTimeMillis
    };
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var Composite = class {
  left;
  right;
  [FiberIdTypeId] = FiberIdTypeId;
  _tag = OP_COMPOSITE;
  constructor(left3, right3) {
    this.left = left3;
    this.right = right3;
  }
  _hash;
  [symbol]() {
    return pipe(string(`${FiberIdSymbolKey}-${this._tag}`), combine(hash(this.left)), combine(hash(this.right)), cached(this));
  }
  [symbol2](that) {
    return isFiberId(that) && that._tag === OP_COMPOSITE && equals(this.left, that.left) && equals(this.right, that.right);
  }
  toString() {
    return format(this.toJSON());
  }
  toJSON() {
    return {
      _id: "FiberId",
      _tag: this._tag,
      left: toJSON(this.left),
      right: toJSON(this.right)
    };
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var none3 = /* @__PURE__ */ new None();
var isFiberId = (self) => hasProperty(self, FiberIdTypeId);
var combine2 = /* @__PURE__ */ dual(2, (self, that) => {
  if (self._tag === OP_NONE) {
    return that;
  }
  if (that._tag === OP_NONE) {
    return self;
  }
  return new Composite(self, that);
});
var ids = (self) => {
  switch (self._tag) {
    case OP_NONE: {
      return empty7();
    }
    case OP_RUNTIME: {
      return make10(self.id);
    }
    case OP_COMPOSITE: {
      return pipe(ids(self.left), union3(ids(self.right)));
    }
  }
};
var _fiberCounter = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => make11(0));
var threadName = (self) => {
  const identifiers = Array.from(ids(self)).map((n) => `#${n}`).join(",");
  return identifiers;
};
var unsafeMake = () => {
  const id = get6(_fiberCounter);
  pipe(_fiberCounter, set2(id + 1));
  return new Runtime(id, Date.now());
};

// node_modules/effect/dist/esm/FiberId.js
var none4 = none3;
var combine3 = combine2;
var ids2 = ids;
var threadName2 = threadName;
var unsafeMake2 = unsafeMake;

// node_modules/effect/dist/esm/HashMap.js
var empty8 = empty5;
var fromIterable6 = fromIterable3;
var isEmpty3 = isEmpty2;
var get7 = get5;
var set3 = set;
var keys2 = keys;
var mutate3 = mutate;
var modifyAt2 = modifyAt;
var map6 = map3;
var forEach3 = forEach;
var reduce5 = reduce2;

// node_modules/effect/dist/esm/List.js
var TypeId7 = /* @__PURE__ */ Symbol.for("effect/List");
var toArray2 = (self) => fromIterable(self);
var getEquivalence3 = (isEquivalent) => mapInput(getEquivalence(isEquivalent), toArray2);
var _equivalence4 = /* @__PURE__ */ getEquivalence3(equals);
var ConsProto = {
  [TypeId7]: TypeId7,
  _tag: "Cons",
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "List",
      _tag: "Cons",
      values: toArray2(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  [symbol2](that) {
    return isList(that) && this._tag === that._tag && _equivalence4(this, that);
  },
  [symbol]() {
    return cached(this, array2(toArray2(this)));
  },
  [Symbol.iterator]() {
    let done7 = false;
    let self = this;
    return {
      next() {
        if (done7) {
          return this.return();
        }
        if (self._tag === "Nil") {
          done7 = true;
          return this.return();
        }
        const value = self.head;
        self = self.tail;
        return {
          done: done7,
          value
        };
      },
      return(value) {
        if (!done7) {
          done7 = true;
        }
        return {
          done: true,
          value
        };
      }
    };
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeCons = (head5, tail) => {
  const cons2 = Object.create(ConsProto);
  cons2.head = head5;
  cons2.tail = tail;
  return cons2;
};
var NilHash = /* @__PURE__ */ string("Nil");
var NilProto = {
  [TypeId7]: TypeId7,
  _tag: "Nil",
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "List",
      _tag: "Nil"
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  [symbol]() {
    return NilHash;
  },
  [symbol2](that) {
    return isList(that) && this._tag === that._tag;
  },
  [Symbol.iterator]() {
    return {
      next() {
        return {
          done: true,
          value: void 0
        };
      }
    };
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var _Nil = /* @__PURE__ */ Object.create(NilProto);
var isList = (u) => hasProperty(u, TypeId7);
var isNil = (self) => self._tag === "Nil";
var isCons = (self) => self._tag === "Cons";
var nil = () => _Nil;
var cons = (head5, tail) => makeCons(head5, tail);
var empty9 = nil;
var of3 = (value) => makeCons(value, _Nil);
var appendAll3 = /* @__PURE__ */ dual(2, (self, that) => prependAll(that, self));
var prepend3 = /* @__PURE__ */ dual(2, (self, element) => cons(element, self));
var prependAll = /* @__PURE__ */ dual(2, (self, prefix) => {
  if (isNil(self)) {
    return prefix;
  } else if (isNil(prefix)) {
    return self;
  } else {
    const result = makeCons(prefix.head, self);
    let curr = result;
    let that = prefix.tail;
    while (!isNil(that)) {
      const temp = makeCons(that.head, self);
      curr.tail = temp;
      curr = temp;
      that = that.tail;
    }
    return result;
  }
});
var reduce6 = /* @__PURE__ */ dual(3, (self, zero2, f) => {
  let acc = zero2;
  let these = self;
  while (!isNil(these)) {
    acc = f(acc, these.head);
    these = these.tail;
  }
  return acc;
});
var reverse3 = (self) => {
  let result = empty9();
  let these = self;
  while (!isNil(these)) {
    result = prepend3(result, these.head);
    these = these.tail;
  }
  return result;
};

// node_modules/effect/dist/esm/internal/data.js
var ArrayProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(Array.prototype), {
  [symbol]() {
    return cached(this, array2(this));
  },
  [symbol2](that) {
    if (Array.isArray(that) && this.length === that.length) {
      return this.every((v, i) => equals(v, that[i]));
    } else {
      return false;
    }
  }
});
var Structural = /* @__PURE__ */ (function() {
  function Structural2(args2) {
    if (args2) {
      Object.assign(this, args2);
    }
  }
  Structural2.prototype = StructuralPrototype;
  return Structural2;
})();
var struct = (as7) => Object.assign(Object.create(StructuralPrototype), as7);

// node_modules/effect/dist/esm/internal/differ/contextPatch.js
var ContextPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferContextPatch");
function variance(a) {
  return a;
}
var PatchProto = {
  ...Structural.prototype,
  [ContextPatchTypeId]: {
    _Value: variance,
    _Patch: variance
  }
};
var EmptyProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
  _tag: "Empty"
});
var _empty5 = /* @__PURE__ */ Object.create(EmptyProto);
var empty10 = () => _empty5;
var AndThenProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
  _tag: "AndThen"
});
var makeAndThen = (first2, second) => {
  const o = Object.create(AndThenProto);
  o.first = first2;
  o.second = second;
  return o;
};
var AddServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
  _tag: "AddService"
});
var makeAddService = (key, service) => {
  const o = Object.create(AddServiceProto);
  o.key = key;
  o.service = service;
  return o;
};
var RemoveServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
  _tag: "RemoveService"
});
var makeRemoveService = (key) => {
  const o = Object.create(RemoveServiceProto);
  o.key = key;
  return o;
};
var UpdateServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
  _tag: "UpdateService"
});
var makeUpdateService = (key, update5) => {
  const o = Object.create(UpdateServiceProto);
  o.key = key;
  o.update = update5;
  return o;
};
var diff = (oldValue, newValue) => {
  const missingServices = new Map(oldValue.unsafeMap);
  let patch9 = empty10();
  for (const [tag, newService] of newValue.unsafeMap.entries()) {
    if (missingServices.has(tag)) {
      const old = missingServices.get(tag);
      missingServices.delete(tag);
      if (!equals(old, newService)) {
        patch9 = combine4(makeUpdateService(tag, () => newService))(patch9);
      }
    } else {
      missingServices.delete(tag);
      patch9 = combine4(makeAddService(tag, newService))(patch9);
    }
  }
  for (const [tag] of missingServices.entries()) {
    patch9 = combine4(makeRemoveService(tag))(patch9);
  }
  return patch9;
};
var combine4 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen(self, that));
var patch = /* @__PURE__ */ dual(2, (self, context4) => {
  if (self._tag === "Empty") {
    return context4;
  }
  let wasServiceUpdated = false;
  let patches = of2(self);
  const updatedContext = new Map(context4.unsafeMap);
  while (isNonEmpty(patches)) {
    const head5 = headNonEmpty2(patches);
    const tail = tailNonEmpty2(patches);
    switch (head5._tag) {
      case "Empty": {
        patches = tail;
        break;
      }
      case "AddService": {
        updatedContext.set(head5.key, head5.service);
        patches = tail;
        break;
      }
      case "AndThen": {
        patches = prepend2(prepend2(tail, head5.second), head5.first);
        break;
      }
      case "RemoveService": {
        updatedContext.delete(head5.key);
        patches = tail;
        break;
      }
      case "UpdateService": {
        updatedContext.set(head5.key, head5.update(updatedContext.get(head5.key)));
        wasServiceUpdated = true;
        patches = tail;
        break;
      }
    }
  }
  if (!wasServiceUpdated) {
    return makeContext(updatedContext);
  }
  const map14 = /* @__PURE__ */ new Map();
  for (const [tag] of context4.unsafeMap) {
    if (updatedContext.has(tag)) {
      map14.set(tag, updatedContext.get(tag));
      updatedContext.delete(tag);
    }
  }
  for (const [tag, s] of updatedContext) {
    map14.set(tag, s);
  }
  return makeContext(map14);
});

// node_modules/effect/dist/esm/internal/differ/hashSetPatch.js
var HashSetPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferHashSetPatch");
function variance2(a) {
  return a;
}
var PatchProto2 = {
  ...Structural.prototype,
  [HashSetPatchTypeId]: {
    _Value: variance2,
    _Key: variance2,
    _Patch: variance2
  }
};
var EmptyProto2 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
  _tag: "Empty"
});
var _empty6 = /* @__PURE__ */ Object.create(EmptyProto2);
var empty11 = () => _empty6;
var AndThenProto2 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
  _tag: "AndThen"
});
var makeAndThen2 = (first2, second) => {
  const o = Object.create(AndThenProto2);
  o.first = first2;
  o.second = second;
  return o;
};
var AddProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
  _tag: "Add"
});
var makeAdd = (value) => {
  const o = Object.create(AddProto);
  o.value = value;
  return o;
};
var RemoveProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
  _tag: "Remove"
});
var makeRemove = (value) => {
  const o = Object.create(RemoveProto);
  o.value = value;
  return o;
};
var diff2 = (oldValue, newValue) => {
  const [removed, patch9] = reduce4([oldValue, empty11()], ([set6, patch10], value) => {
    if (has3(value)(set6)) {
      return [remove4(value)(set6), patch10];
    }
    return [set6, combine5(makeAdd(value))(patch10)];
  })(newValue);
  return reduce4(patch9, (patch10, value) => combine5(makeRemove(value))(patch10))(removed);
};
var combine5 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen2(self, that));
var patch2 = /* @__PURE__ */ dual(2, (self, oldValue) => {
  if (self._tag === "Empty") {
    return oldValue;
  }
  let set6 = oldValue;
  let patches = of2(self);
  while (isNonEmpty(patches)) {
    const head5 = headNonEmpty2(patches);
    const tail = tailNonEmpty2(patches);
    switch (head5._tag) {
      case "Empty": {
        patches = tail;
        break;
      }
      case "AndThen": {
        patches = prepend2(head5.first)(prepend2(head5.second)(tail));
        break;
      }
      case "Add": {
        set6 = add4(head5.value)(set6);
        patches = tail;
        break;
      }
      case "Remove": {
        set6 = remove4(head5.value)(set6);
        patches = tail;
      }
    }
  }
  return set6;
});

// node_modules/effect/dist/esm/internal/differ/readonlyArrayPatch.js
var ReadonlyArrayPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferReadonlyArrayPatch");
function variance3(a) {
  return a;
}
var PatchProto3 = {
  ...Structural.prototype,
  [ReadonlyArrayPatchTypeId]: {
    _Value: variance3,
    _Patch: variance3
  }
};
var EmptyProto3 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
  _tag: "Empty"
});
var _empty7 = /* @__PURE__ */ Object.create(EmptyProto3);
var empty12 = () => _empty7;
var AndThenProto3 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
  _tag: "AndThen"
});
var makeAndThen3 = (first2, second) => {
  const o = Object.create(AndThenProto3);
  o.first = first2;
  o.second = second;
  return o;
};
var AppendProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
  _tag: "Append"
});
var makeAppend = (values3) => {
  const o = Object.create(AppendProto);
  o.values = values3;
  return o;
};
var SliceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
  _tag: "Slice"
});
var makeSlice = (from, until) => {
  const o = Object.create(SliceProto);
  o.from = from;
  o.until = until;
  return o;
};
var UpdateProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
  _tag: "Update"
});
var makeUpdate = (index, patch9) => {
  const o = Object.create(UpdateProto);
  o.index = index;
  o.patch = patch9;
  return o;
};
var diff3 = (options) => {
  let i = 0;
  let patch9 = empty12();
  while (i < options.oldValue.length && i < options.newValue.length) {
    const oldElement = options.oldValue[i];
    const newElement = options.newValue[i];
    const valuePatch = options.differ.diff(oldElement, newElement);
    if (!equals(valuePatch, options.differ.empty)) {
      patch9 = combine6(patch9, makeUpdate(i, valuePatch));
    }
    i = i + 1;
  }
  if (i < options.oldValue.length) {
    patch9 = combine6(patch9, makeSlice(0, i));
  }
  if (i < options.newValue.length) {
    patch9 = combine6(patch9, makeAppend(drop(i)(options.newValue)));
  }
  return patch9;
};
var combine6 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen3(self, that));
var patch3 = /* @__PURE__ */ dual(3, (self, oldValue, differ3) => {
  if (self._tag === "Empty") {
    return oldValue;
  }
  let readonlyArray2 = oldValue.slice();
  let patches = of(self);
  while (isNonEmptyArray2(patches)) {
    const head5 = headNonEmpty(patches);
    const tail = tailNonEmpty(patches);
    switch (head5._tag) {
      case "Empty": {
        patches = tail;
        break;
      }
      case "AndThen": {
        tail.unshift(head5.first, head5.second);
        patches = tail;
        break;
      }
      case "Append": {
        for (const value of head5.values) {
          readonlyArray2.push(value);
        }
        patches = tail;
        break;
      }
      case "Slice": {
        readonlyArray2 = readonlyArray2.slice(head5.from, head5.until);
        patches = tail;
        break;
      }
      case "Update": {
        readonlyArray2[head5.index] = differ3.patch(head5.patch, readonlyArray2[head5.index]);
        patches = tail;
        break;
      }
    }
  }
  return readonlyArray2;
});

// node_modules/effect/dist/esm/internal/differ.js
var DifferTypeId = /* @__PURE__ */ Symbol.for("effect/Differ");
var DifferProto = {
  [DifferTypeId]: {
    _P: identity,
    _V: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make14 = (params) => {
  const differ3 = Object.create(DifferProto);
  differ3.empty = params.empty;
  differ3.diff = params.diff;
  differ3.combine = params.combine;
  differ3.patch = params.patch;
  return differ3;
};
var environment = () => make14({
  empty: empty10(),
  combine: (first2, second) => combine4(second)(first2),
  diff: (oldValue, newValue) => diff(oldValue, newValue),
  patch: (patch9, oldValue) => patch(oldValue)(patch9)
});
var hashSet = () => make14({
  empty: empty11(),
  combine: (first2, second) => combine5(second)(first2),
  diff: (oldValue, newValue) => diff2(oldValue, newValue),
  patch: (patch9, oldValue) => patch2(oldValue)(patch9)
});
var readonlyArray = (differ3) => make14({
  empty: empty12(),
  combine: (first2, second) => combine6(first2, second),
  diff: (oldValue, newValue) => diff3({
    oldValue,
    newValue,
    differ: differ3
  }),
  patch: (patch9, oldValue) => patch3(patch9, oldValue, differ3)
});
var update = () => updateWith((_, a) => a);
var updateWith = (f) => make14({
  empty: identity,
  combine: (first2, second) => {
    if (first2 === identity) {
      return second;
    }
    if (second === identity) {
      return first2;
    }
    return (a) => second(first2(a));
  },
  diff: (oldValue, newValue) => {
    if (equals(oldValue, newValue)) {
      return identity;
    }
    return constant(newValue);
  },
  patch: (patch9, oldValue) => f(oldValue, patch9(oldValue))
});

// node_modules/effect/dist/esm/internal/runtimeFlagsPatch.js
var BIT_MASK = 255;
var BIT_SHIFT = 8;
var active = (patch9) => patch9 & BIT_MASK;
var enabled = (patch9) => patch9 >> BIT_SHIFT & BIT_MASK;
var make15 = (active2, enabled2) => (active2 & BIT_MASK) + ((enabled2 & active2 & BIT_MASK) << BIT_SHIFT);
var empty13 = /* @__PURE__ */ make15(0, 0);
var enable = (flag) => make15(flag, flag);
var disable = (flag) => make15(flag, 0);
var exclude = /* @__PURE__ */ dual(2, (self, flag) => make15(active(self) & ~flag, enabled(self)));
var andThen = /* @__PURE__ */ dual(2, (self, that) => self | that);
var invert = (n) => ~n >>> 0 & BIT_MASK;

// node_modules/effect/dist/esm/internal/runtimeFlags.js
var None2 = 0;
var Interruption = 1 << 0;
var OpSupervision = 1 << 1;
var RuntimeMetrics = 1 << 2;
var WindDown = 1 << 4;
var CooperativeYielding = 1 << 5;
var cooperativeYielding = (self) => isEnabled(self, CooperativeYielding);
var disable2 = /* @__PURE__ */ dual(2, (self, flag) => self & ~flag);
var enable2 = /* @__PURE__ */ dual(2, (self, flag) => self | flag);
var interruptible = (self) => interruption(self) && !windDown(self);
var interruption = (self) => isEnabled(self, Interruption);
var isEnabled = /* @__PURE__ */ dual(2, (self, flag) => (self & flag) !== 0);
var make16 = (...flags) => flags.reduce((a, b) => a | b, 0);
var none5 = /* @__PURE__ */ make16(None2);
var runtimeMetrics = (self) => isEnabled(self, RuntimeMetrics);
var windDown = (self) => isEnabled(self, WindDown);
var diff4 = /* @__PURE__ */ dual(2, (self, that) => make15(self ^ that, that));
var patch4 = /* @__PURE__ */ dual(2, (self, patch9) => self & (invert(active(patch9)) | enabled(patch9)) | active(patch9) & enabled(patch9));
var differ = /* @__PURE__ */ make14({
  empty: empty13,
  diff: (oldValue, newValue) => diff4(oldValue, newValue),
  combine: (first2, second) => andThen(second)(first2),
  patch: (_patch, oldValue) => patch4(oldValue, _patch)
});

// node_modules/effect/dist/esm/RuntimeFlagsPatch.js
var empty14 = empty13;
var enable3 = enable;
var disable3 = disable;
var exclude2 = exclude;

// node_modules/effect/dist/esm/internal/blockedRequests.js
var empty15 = {
  _tag: "Empty"
};
var par = (self, that) => ({
  _tag: "Par",
  left: self,
  right: that
});
var seq = (self, that) => ({
  _tag: "Seq",
  left: self,
  right: that
});
var single = (dataSource, blockedRequest) => ({
  _tag: "Single",
  dataSource,
  blockedRequest
});
var flatten2 = (self) => {
  let current = of3(self);
  let updated = empty9();
  while (1) {
    const [parallel5, sequential5] = reduce6(current, [parallelCollectionEmpty(), empty9()], ([parallel6, sequential6], blockedRequest) => {
      const [par2, seq2] = step(blockedRequest);
      return [parallelCollectionCombine(parallel6, par2), appendAll3(sequential6, seq2)];
    });
    updated = merge4(updated, parallel5);
    if (isNil(sequential5)) {
      return reverse3(updated);
    }
    current = sequential5;
  }
  throw new Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
};
var step = (requests) => {
  let current = requests;
  let parallel5 = parallelCollectionEmpty();
  let stack = empty9();
  let sequential5 = empty9();
  while (1) {
    switch (current._tag) {
      case "Empty": {
        if (isNil(stack)) {
          return [parallel5, sequential5];
        }
        current = stack.head;
        stack = stack.tail;
        break;
      }
      case "Par": {
        stack = cons(current.right, stack);
        current = current.left;
        break;
      }
      case "Seq": {
        const left3 = current.left;
        const right3 = current.right;
        switch (left3._tag) {
          case "Empty": {
            current = right3;
            break;
          }
          case "Par": {
            const l = left3.left;
            const r = left3.right;
            current = par(seq(l, right3), seq(r, right3));
            break;
          }
          case "Seq": {
            const l = left3.left;
            const r = left3.right;
            current = seq(l, seq(r, right3));
            break;
          }
          case "Single": {
            current = left3;
            sequential5 = cons(right3, sequential5);
            break;
          }
        }
        break;
      }
      case "Single": {
        parallel5 = parallelCollectionAdd(parallel5, current);
        if (isNil(stack)) {
          return [parallel5, sequential5];
        }
        current = stack.head;
        stack = stack.tail;
        break;
      }
    }
  }
  throw new Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
};
var merge4 = (sequential5, parallel5) => {
  if (isNil(sequential5)) {
    return of3(parallelCollectionToSequentialCollection(parallel5));
  }
  if (parallelCollectionIsEmpty(parallel5)) {
    return sequential5;
  }
  const seqHeadKeys = sequentialCollectionKeys(sequential5.head);
  const parKeys = parallelCollectionKeys(parallel5);
  if (seqHeadKeys.length === 1 && parKeys.length === 1 && equals(seqHeadKeys[0], parKeys[0])) {
    return cons(sequentialCollectionCombine(sequential5.head, parallelCollectionToSequentialCollection(parallel5)), sequential5.tail);
  }
  return cons(parallelCollectionToSequentialCollection(parallel5), sequential5);
};
var EntryTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/Entry");
var EntryImpl = class {
  request;
  result;
  listeners;
  ownerId;
  state;
  [EntryTypeId] = blockedRequestVariance;
  constructor(request2, result, listeners, ownerId, state) {
    this.request = request2;
    this.result = result;
    this.listeners = listeners;
    this.ownerId = ownerId;
    this.state = state;
  }
};
var blockedRequestVariance = {
  /* c8 ignore next */
  _R: (_) => _
};
var makeEntry = (options) => new EntryImpl(options.request, options.result, options.listeners, options.ownerId, options.state);
var RequestBlockParallelTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/RequestBlockParallel");
var parallelVariance = {
  /* c8 ignore next */
  _R: (_) => _
};
var ParallelImpl = class {
  map;
  [RequestBlockParallelTypeId] = parallelVariance;
  constructor(map14) {
    this.map = map14;
  }
};
var parallelCollectionEmpty = () => new ParallelImpl(empty8());
var parallelCollectionAdd = (self, blockedRequest) => new ParallelImpl(modifyAt2(self.map, blockedRequest.dataSource, (_) => orElseSome(map(_, append2(blockedRequest.blockedRequest)), () => of2(blockedRequest.blockedRequest))));
var parallelCollectionCombine = (self, that) => new ParallelImpl(reduce5(self.map, that.map, (map14, value, key) => set3(map14, key, match2(get7(map14, key), {
  onNone: () => value,
  onSome: (other) => appendAll2(value, other)
}))));
var parallelCollectionIsEmpty = (self) => isEmpty3(self.map);
var parallelCollectionKeys = (self) => Array.from(keys2(self.map));
var parallelCollectionToSequentialCollection = (self) => sequentialCollectionMake(map6(self.map, (x) => of2(x)));
var SequentialCollectionTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/RequestBlockSequential");
var sequentialVariance = {
  /* c8 ignore next */
  _R: (_) => _
};
var SequentialImpl = class {
  map;
  [SequentialCollectionTypeId] = sequentialVariance;
  constructor(map14) {
    this.map = map14;
  }
};
var sequentialCollectionMake = (map14) => new SequentialImpl(map14);
var sequentialCollectionCombine = (self, that) => new SequentialImpl(reduce5(that.map, self.map, (map14, value, key) => set3(map14, key, match2(get7(map14, key), {
  onNone: () => empty4(),
  onSome: (a) => appendAll2(a, value)
}))));
var sequentialCollectionKeys = (self) => Array.from(keys2(self.map));
var sequentialCollectionToChunk = (self) => Array.from(self.map);

// node_modules/effect/dist/esm/internal/opCodes/cause.js
var OP_DIE = "Die";
var OP_EMPTY = "Empty";
var OP_FAIL = "Fail";
var OP_INTERRUPT = "Interrupt";
var OP_PARALLEL = "Parallel";
var OP_SEQUENTIAL = "Sequential";

// node_modules/effect/dist/esm/internal/cause.js
var CauseSymbolKey = "effect/Cause";
var CauseTypeId = /* @__PURE__ */ Symbol.for(CauseSymbolKey);
var variance4 = {
  /* c8 ignore next */
  _E: (_) => _
};
var proto = {
  [CauseTypeId]: variance4,
  [symbol]() {
    return pipe(hash(CauseSymbolKey), combine(hash(flattenCause(this))), cached(this));
  },
  [symbol2](that) {
    return isCause(that) && causeEquals(this, that);
  },
  pipe() {
    return pipeArguments(this, arguments);
  },
  toJSON() {
    switch (this._tag) {
      case "Empty":
        return {
          _id: "Cause",
          _tag: this._tag
        };
      case "Die":
        return {
          _id: "Cause",
          _tag: this._tag,
          defect: toJSON(this.defect)
        };
      case "Interrupt":
        return {
          _id: "Cause",
          _tag: this._tag,
          fiberId: this.fiberId.toJSON()
        };
      case "Fail":
        return {
          _id: "Cause",
          _tag: this._tag,
          failure: toJSON(this.error)
        };
      case "Sequential":
      case "Parallel":
        return {
          _id: "Cause",
          _tag: this._tag,
          left: toJSON(this.left),
          right: toJSON(this.right)
        };
    }
  },
  toString() {
    return pretty(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var empty16 = /* @__PURE__ */ (() => {
  const o = /* @__PURE__ */ Object.create(proto);
  o._tag = OP_EMPTY;
  return o;
})();
var fail = (error) => {
  const o = Object.create(proto);
  o._tag = OP_FAIL;
  o.error = error;
  return o;
};
var die = (defect) => {
  const o = Object.create(proto);
  o._tag = OP_DIE;
  o.defect = defect;
  return o;
};
var interrupt = (fiberId3) => {
  const o = Object.create(proto);
  o._tag = OP_INTERRUPT;
  o.fiberId = fiberId3;
  return o;
};
var parallel = (left3, right3) => {
  const o = Object.create(proto);
  o._tag = OP_PARALLEL;
  o.left = left3;
  o.right = right3;
  return o;
};
var sequential = (left3, right3) => {
  const o = Object.create(proto);
  o._tag = OP_SEQUENTIAL;
  o.left = left3;
  o.right = right3;
  return o;
};
var isCause = (u) => hasProperty(u, CauseTypeId);
var isEmptyType = (self) => self._tag === OP_EMPTY;
var isFailType = (self) => self._tag === OP_FAIL;
var isDieType = (self) => self._tag === OP_DIE;
var isInterruptType = (self) => self._tag === OP_INTERRUPT;
var isSequentialType = (self) => self._tag === OP_SEQUENTIAL;
var isParallelType = (self) => self._tag === OP_PARALLEL;
var size4 = (self) => reduceWithContext(self, void 0, SizeCauseReducer);
var isEmpty5 = (self) => {
  if (self._tag === OP_EMPTY) {
    return true;
  }
  return reduce7(self, true, (acc, cause3) => {
    switch (cause3._tag) {
      case OP_EMPTY: {
        return some2(acc);
      }
      case OP_DIE:
      case OP_FAIL:
      case OP_INTERRUPT: {
        return some2(false);
      }
      default: {
        return none2();
      }
    }
  });
};
var isFailure = (self) => isSome2(failureOption(self));
var isDie = (self) => isSome2(dieOption(self));
var isInterrupted = (self) => isSome2(interruptOption(self));
var isInterruptedOnly = (self) => reduceWithContext(void 0, IsInterruptedOnlyCauseReducer)(self);
var failures = (self) => reverse2(reduce7(self, empty4(), (list, cause3) => cause3._tag === OP_FAIL ? some2(pipe(list, prepend2(cause3.error))) : none2()));
var defects = (self) => reverse2(reduce7(self, empty4(), (list, cause3) => cause3._tag === OP_DIE ? some2(pipe(list, prepend2(cause3.defect))) : none2()));
var interruptors = (self) => reduce7(self, empty7(), (set6, cause3) => cause3._tag === OP_INTERRUPT ? some2(pipe(set6, add4(cause3.fiberId))) : none2());
var failureOption = (self) => find(self, (cause3) => cause3._tag === OP_FAIL ? some2(cause3.error) : none2());
var failureOrCause = (self) => {
  const option3 = failureOption(self);
  switch (option3._tag) {
    case "None": {
      return right2(self);
    }
    case "Some": {
      return left2(option3.value);
    }
  }
};
var dieOption = (self) => find(self, (cause3) => cause3._tag === OP_DIE ? some2(cause3.defect) : none2());
var flipCauseOption = (self) => match4(self, {
  onEmpty: some2(empty16),
  onFail: map(fail),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: (fiberId3) => some2(interrupt(fiberId3)),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
});
var interruptOption = (self) => find(self, (cause3) => cause3._tag === OP_INTERRUPT ? some2(cause3.fiberId) : none2());
var keepDefects = (self) => match4(self, {
  onEmpty: none2(),
  onFail: () => none2(),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: () => none2(),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
});
var keepDefectsAndElectFailures = (self) => match4(self, {
  onEmpty: none2(),
  onFail: (failure) => some2(die(failure)),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: () => none2(),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
});
var linearize = (self) => match4(self, {
  onEmpty: empty7(),
  onFail: (error) => make10(fail(error)),
  onDie: (defect) => make10(die(defect)),
  onInterrupt: (fiberId3) => make10(interrupt(fiberId3)),
  onSequential: (leftSet, rightSet) => flatMap4(leftSet, (leftCause) => map5(rightSet, (rightCause) => sequential(leftCause, rightCause))),
  onParallel: (leftSet, rightSet) => flatMap4(leftSet, (leftCause) => map5(rightSet, (rightCause) => parallel(leftCause, rightCause)))
});
var stripFailures = (self) => match4(self, {
  onEmpty: empty16,
  onFail: () => empty16,
  onDie: die,
  onInterrupt: interrupt,
  onSequential: sequential,
  onParallel: parallel
});
var electFailures = (self) => match4(self, {
  onEmpty: empty16,
  onFail: die,
  onDie: die,
  onInterrupt: interrupt,
  onSequential: sequential,
  onParallel: parallel
});
var stripSomeDefects = /* @__PURE__ */ dual(2, (self, pf) => match4(self, {
  onEmpty: some2(empty16),
  onFail: (error) => some2(fail(error)),
  onDie: (defect) => {
    const option3 = pf(defect);
    return isSome2(option3) ? none2() : some2(die(defect));
  },
  onInterrupt: (fiberId3) => some2(interrupt(fiberId3)),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
}));
var as = /* @__PURE__ */ dual(2, (self, error) => map7(self, () => error));
var map7 = /* @__PURE__ */ dual(2, (self, f) => flatMap6(self, (e) => fail(f(e))));
var flatMap6 = /* @__PURE__ */ dual(2, (self, f) => match4(self, {
  onEmpty: empty16,
  onFail: (error) => f(error),
  onDie: (defect) => die(defect),
  onInterrupt: (fiberId3) => interrupt(fiberId3),
  onSequential: (left3, right3) => sequential(left3, right3),
  onParallel: (left3, right3) => parallel(left3, right3)
}));
var flatten3 = (self) => flatMap6(self, identity);
var andThen2 = /* @__PURE__ */ dual(2, (self, f) => isFunction2(f) ? flatMap6(self, f) : flatMap6(self, () => f));
var contains3 = /* @__PURE__ */ dual(2, (self, that) => {
  if (that._tag === OP_EMPTY || self === that) {
    return true;
  }
  return reduce7(self, false, (accumulator, cause3) => {
    return some2(accumulator || causeEquals(cause3, that));
  });
});
var causeEquals = (left3, right3) => {
  let leftStack = of2(left3);
  let rightStack = of2(right3);
  while (isNonEmpty(leftStack) && isNonEmpty(rightStack)) {
    const [leftParallel, leftSequential] = pipe(headNonEmpty2(leftStack), reduce7([empty7(), empty4()], ([parallel5, sequential5], cause3) => {
      const [par2, seq2] = evaluateCause(cause3);
      return some2([pipe(parallel5, union3(par2)), pipe(sequential5, appendAll2(seq2))]);
    }));
    const [rightParallel, rightSequential] = pipe(headNonEmpty2(rightStack), reduce7([empty7(), empty4()], ([parallel5, sequential5], cause3) => {
      const [par2, seq2] = evaluateCause(cause3);
      return some2([pipe(parallel5, union3(par2)), pipe(sequential5, appendAll2(seq2))]);
    }));
    if (!equals(leftParallel, rightParallel)) {
      return false;
    }
    leftStack = leftSequential;
    rightStack = rightSequential;
  }
  return true;
};
var flattenCause = (cause3) => {
  return flattenCauseLoop(of2(cause3), empty4());
};
var flattenCauseLoop = (causes, flattened) => {
  while (1) {
    const [parallel5, sequential5] = pipe(causes, reduce([empty7(), empty4()], ([parallel6, sequential6], cause3) => {
      const [par2, seq2] = evaluateCause(cause3);
      return [pipe(parallel6, union3(par2)), pipe(sequential6, appendAll2(seq2))];
    }));
    const updated = size3(parallel5) > 0 ? pipe(flattened, prepend2(parallel5)) : flattened;
    if (isEmpty(sequential5)) {
      return reverse2(updated);
    }
    causes = sequential5;
    flattened = updated;
  }
  throw new Error(getBugErrorMessage("Cause.flattenCauseLoop"));
};
var find = /* @__PURE__ */ dual(2, (self, pf) => {
  const stack = [self];
  while (stack.length > 0) {
    const item = stack.pop();
    const option3 = pf(item);
    switch (option3._tag) {
      case "None": {
        switch (item._tag) {
          case OP_SEQUENTIAL:
          case OP_PARALLEL: {
            stack.push(item.right);
            stack.push(item.left);
            break;
          }
        }
        break;
      }
      case "Some": {
        return option3;
      }
    }
  }
  return none2();
});
var filter4 = /* @__PURE__ */ dual(2, (self, predicate) => reduceWithContext(self, void 0, FilterCauseReducer(predicate)));
var evaluateCause = (self) => {
  let cause3 = self;
  const stack = [];
  let _parallel = empty7();
  let _sequential = empty4();
  while (cause3 !== void 0) {
    switch (cause3._tag) {
      case OP_EMPTY: {
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause3 = stack.pop();
        break;
      }
      case OP_FAIL: {
        _parallel = add4(_parallel, make6(cause3._tag, cause3.error));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause3 = stack.pop();
        break;
      }
      case OP_DIE: {
        _parallel = add4(_parallel, make6(cause3._tag, cause3.defect));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause3 = stack.pop();
        break;
      }
      case OP_INTERRUPT: {
        _parallel = add4(_parallel, make6(cause3._tag, cause3.fiberId));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause3 = stack.pop();
        break;
      }
      case OP_SEQUENTIAL: {
        switch (cause3.left._tag) {
          case OP_EMPTY: {
            cause3 = cause3.right;
            break;
          }
          case OP_SEQUENTIAL: {
            cause3 = sequential(cause3.left.left, sequential(cause3.left.right, cause3.right));
            break;
          }
          case OP_PARALLEL: {
            cause3 = parallel(sequential(cause3.left.left, cause3.right), sequential(cause3.left.right, cause3.right));
            break;
          }
          default: {
            _sequential = prepend2(_sequential, cause3.right);
            cause3 = cause3.left;
            break;
          }
        }
        break;
      }
      case OP_PARALLEL: {
        stack.push(cause3.right);
        cause3 = cause3.left;
        break;
      }
    }
  }
  throw new Error(getBugErrorMessage("Cause.evaluateCauseLoop"));
};
var SizeCauseReducer = {
  emptyCase: () => 0,
  failCase: () => 1,
  dieCase: () => 1,
  interruptCase: () => 1,
  sequentialCase: (_, left3, right3) => left3 + right3,
  parallelCase: (_, left3, right3) => left3 + right3
};
var IsInterruptedOnlyCauseReducer = {
  emptyCase: constTrue,
  failCase: constFalse,
  dieCase: constFalse,
  interruptCase: constTrue,
  sequentialCase: (_, left3, right3) => left3 && right3,
  parallelCase: (_, left3, right3) => left3 && right3
};
var FilterCauseReducer = (predicate) => ({
  emptyCase: () => empty16,
  failCase: (_, error) => fail(error),
  dieCase: (_, defect) => die(defect),
  interruptCase: (_, fiberId3) => interrupt(fiberId3),
  sequentialCase: (_, left3, right3) => {
    if (predicate(left3)) {
      if (predicate(right3)) {
        return sequential(left3, right3);
      }
      return left3;
    }
    if (predicate(right3)) {
      return right3;
    }
    return empty16;
  },
  parallelCase: (_, left3, right3) => {
    if (predicate(left3)) {
      if (predicate(right3)) {
        return parallel(left3, right3);
      }
      return left3;
    }
    if (predicate(right3)) {
      return right3;
    }
    return empty16;
  }
});
var OP_SEQUENTIAL_CASE = "SequentialCase";
var OP_PARALLEL_CASE = "ParallelCase";
var match4 = /* @__PURE__ */ dual(2, (self, {
  onDie,
  onEmpty,
  onFail,
  onInterrupt: onInterrupt3,
  onParallel,
  onSequential
}) => {
  return reduceWithContext(self, void 0, {
    emptyCase: () => onEmpty,
    failCase: (_, error) => onFail(error),
    dieCase: (_, defect) => onDie(defect),
    interruptCase: (_, fiberId3) => onInterrupt3(fiberId3),
    sequentialCase: (_, left3, right3) => onSequential(left3, right3),
    parallelCase: (_, left3, right3) => onParallel(left3, right3)
  });
});
var reduce7 = /* @__PURE__ */ dual(3, (self, zero2, pf) => {
  let accumulator = zero2;
  let cause3 = self;
  const causes = [];
  while (cause3 !== void 0) {
    const option3 = pf(accumulator, cause3);
    accumulator = isSome2(option3) ? option3.value : accumulator;
    switch (cause3._tag) {
      case OP_SEQUENTIAL: {
        causes.push(cause3.right);
        cause3 = cause3.left;
        break;
      }
      case OP_PARALLEL: {
        causes.push(cause3.right);
        cause3 = cause3.left;
        break;
      }
      default: {
        cause3 = void 0;
        break;
      }
    }
    if (cause3 === void 0 && causes.length > 0) {
      cause3 = causes.pop();
    }
  }
  return accumulator;
});
var reduceWithContext = /* @__PURE__ */ dual(3, (self, context4, reducer) => {
  const input = [self];
  const output = [];
  while (input.length > 0) {
    const cause3 = input.pop();
    switch (cause3._tag) {
      case OP_EMPTY: {
        output.push(right2(reducer.emptyCase(context4)));
        break;
      }
      case OP_FAIL: {
        output.push(right2(reducer.failCase(context4, cause3.error)));
        break;
      }
      case OP_DIE: {
        output.push(right2(reducer.dieCase(context4, cause3.defect)));
        break;
      }
      case OP_INTERRUPT: {
        output.push(right2(reducer.interruptCase(context4, cause3.fiberId)));
        break;
      }
      case OP_SEQUENTIAL: {
        input.push(cause3.right);
        input.push(cause3.left);
        output.push(left2({
          _tag: OP_SEQUENTIAL_CASE
        }));
        break;
      }
      case OP_PARALLEL: {
        input.push(cause3.right);
        input.push(cause3.left);
        output.push(left2({
          _tag: OP_PARALLEL_CASE
        }));
        break;
      }
    }
  }
  const accumulator = [];
  while (output.length > 0) {
    const either4 = output.pop();
    switch (either4._tag) {
      case "Left": {
        switch (either4.left._tag) {
          case OP_SEQUENTIAL_CASE: {
            const left3 = accumulator.pop();
            const right3 = accumulator.pop();
            const value = reducer.sequentialCase(context4, left3, right3);
            accumulator.push(value);
            break;
          }
          case OP_PARALLEL_CASE: {
            const left3 = accumulator.pop();
            const right3 = accumulator.pop();
            const value = reducer.parallelCase(context4, left3, right3);
            accumulator.push(value);
            break;
          }
        }
        break;
      }
      case "Right": {
        accumulator.push(either4.right);
        break;
      }
    }
  }
  if (accumulator.length === 0) {
    throw new Error("BUG: Cause.reduceWithContext - please report an issue at https://github.com/Effect-TS/effect/issues");
  }
  return accumulator.pop();
});
var pretty = (cause3, options) => {
  if (isInterruptedOnly(cause3)) {
    return "All fibers interrupted without errors.";
  }
  return prettyErrors(cause3).map(function(e) {
    if (options?.renderErrorCause !== true || e.cause === void 0) {
      return e.stack;
    }
    return `${e.stack} {
${renderErrorCause(e.cause, "  ")}
}`;
  }).join("\n");
};
var renderErrorCause = (cause3, prefix) => {
  const lines = cause3.stack.split("\n");
  let stack = `${prefix}[cause]: ${lines[0]}`;
  for (let i = 1, len = lines.length; i < len; i++) {
    stack += `
${prefix}${lines[i]}`;
  }
  if (cause3.cause) {
    stack += ` {
${renderErrorCause(cause3.cause, `${prefix}  `)}
${prefix}}`;
  }
  return stack;
};
var makePrettyError = (originalError2) => {
  const originalErrorIsObject = typeof originalError2 === "object" && originalError2 !== null;
  const prevLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 1;
  const error = new Error(prettyErrorMessage(originalError2), originalErrorIsObject && "cause" in originalError2 && typeof originalError2.cause !== "undefined" ? {
    cause: makePrettyError(originalError2.cause)
  } : void 0);
  Error.stackTraceLimit = prevLimit;
  if (error.message === "") {
    error.message = "An error has occurred";
  }
  Error.stackTraceLimit = prevLimit;
  error.name = originalError2 instanceof Error ? originalError2.name : "Error";
  if (originalErrorIsObject) {
    if (spanSymbol in originalError2) {
      error.span = originalError2[spanSymbol];
    }
    Object.keys(originalError2).forEach((key) => {
      if (!(key in error)) {
        error[key] = originalError2[key];
      }
    });
  }
  error.stack = prettyErrorStack(`${error.name}: ${error.message}`, originalError2 instanceof Error && originalError2.stack ? originalError2.stack : "", error.span);
  return error;
};
var prettyErrorMessage = (u) => {
  if (typeof u === "string") {
    return u;
  }
  if (typeof u === "object" && u !== null && u instanceof Error) {
    return u.message;
  }
  try {
    if (hasProperty(u, "toString") && isFunction2(u["toString"]) && u["toString"] !== Object.prototype.toString && u["toString"] !== globalThis.Array.prototype.toString) {
      return u["toString"]();
    }
  } catch {
  }
  return stringifyCircular(u);
};
var locationRegex = /\((.*)\)/g;
var spanToTrace = /* @__PURE__ */ globalValue("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap());
var prettyErrorStack = (message, stack, span2) => {
  const out = [message];
  const lines = stack.startsWith(message) ? stack.slice(message.length).split("\n") : stack.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes(" at new BaseEffectError") || lines[i].includes(" at new YieldableError")) {
      i++;
      continue;
    }
    if (lines[i].includes("Generator.next")) {
      break;
    }
    if (lines[i].includes("effect_internal_function")) {
      break;
    }
    out.push(lines[i].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
  }
  if (span2) {
    let current = span2;
    let i = 0;
    while (current && current._tag === "Span" && i < 10) {
      const stackFn = spanToTrace.get(current);
      if (typeof stackFn === "function") {
        const stack2 = stackFn();
        if (typeof stack2 === "string") {
          const locationMatchAll = stack2.matchAll(locationRegex);
          let match12 = false;
          for (const [, location] of locationMatchAll) {
            match12 = true;
            out.push(`    at ${current.name} (${location})`);
          }
          if (!match12) {
            out.push(`    at ${current.name} (${stack2.replace(/^at /, "")})`);
          }
        } else {
          out.push(`    at ${current.name}`);
        }
      } else {
        out.push(`    at ${current.name}`);
      }
      current = getOrUndefined(current.parent);
      i++;
    }
  }
  return out.join("\n");
};
var spanSymbol = /* @__PURE__ */ Symbol.for("effect/SpanAnnotation");
var prettyErrors = (cause3) => reduceWithContext(cause3, void 0, {
  emptyCase: () => [],
  dieCase: (_, unknownError) => {
    return [makePrettyError(unknownError)];
  },
  failCase: (_, error) => {
    return [makePrettyError(error)];
  },
  interruptCase: () => [],
  parallelCase: (_, l, r) => [...l, ...r],
  sequentialCase: (_, l, r) => [...l, ...r]
});

// node_modules/effect/dist/esm/internal/opCodes/deferred.js
var OP_STATE_PENDING = "Pending";
var OP_STATE_DONE = "Done";

// node_modules/effect/dist/esm/internal/deferred.js
var DeferredSymbolKey = "effect/Deferred";
var DeferredTypeId = /* @__PURE__ */ Symbol.for(DeferredSymbolKey);
var deferredVariance = {
  /* c8 ignore next */
  _E: (_) => _,
  /* c8 ignore next */
  _A: (_) => _
};
var pending = (joiners) => {
  return {
    _tag: OP_STATE_PENDING,
    joiners
  };
};
var done = (effect) => {
  return {
    _tag: OP_STATE_DONE,
    effect
  };
};

// node_modules/effect/dist/esm/internal/singleShotGen.js
var SingleShotGen2 = class _SingleShotGen {
  self;
  called = false;
  constructor(self) {
    this.self = self;
  }
  next(a) {
    return this.called ? {
      value: a,
      done: true
    } : (this.called = true, {
      value: this.self,
      done: false
    });
  }
  return(a) {
    return {
      value: a,
      done: true
    };
  }
  throw(e) {
    throw e;
  }
  [Symbol.iterator]() {
    return new _SingleShotGen(this.self);
  }
};

// node_modules/effect/dist/esm/internal/core.js
var blocked = (blockedRequests, _continue3) => {
  const effect = new EffectPrimitive("Blocked");
  effect.effect_instruction_i0 = blockedRequests;
  effect.effect_instruction_i1 = _continue3;
  return effect;
};
var runRequestBlock = (blockedRequests) => {
  const effect = new EffectPrimitive("RunBlocked");
  effect.effect_instruction_i0 = blockedRequests;
  return effect;
};
var EffectTypeId2 = /* @__PURE__ */ Symbol.for("effect/Effect");
var RevertFlags = class {
  patch;
  op;
  _op = OP_REVERT_FLAGS;
  constructor(patch9, op) {
    this.patch = patch9;
    this.op = op;
  }
};
var EffectPrimitive = class {
  _op;
  effect_instruction_i0 = void 0;
  effect_instruction_i1 = void 0;
  effect_instruction_i2 = void 0;
  trace = void 0;
  [EffectTypeId2] = effectVariance;
  constructor(_op) {
    this._op = _op;
  }
  [symbol2](that) {
    return this === that;
  }
  [symbol]() {
    return cached(this, random(this));
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Effect",
      _op: this._op,
      effect_instruction_i0: toJSON(this.effect_instruction_i0),
      effect_instruction_i1: toJSON(this.effect_instruction_i1),
      effect_instruction_i2: toJSON(this.effect_instruction_i2)
    };
  }
  toString() {
    return format(this.toJSON());
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [Symbol.iterator]() {
    return new SingleShotGen2(new YieldWrap(this));
  }
};
var EffectPrimitiveFailure = class {
  _op;
  effect_instruction_i0 = void 0;
  effect_instruction_i1 = void 0;
  effect_instruction_i2 = void 0;
  trace = void 0;
  [EffectTypeId2] = effectVariance;
  constructor(_op) {
    this._op = _op;
    this._tag = _op;
  }
  [symbol2](that) {
    return exitIsExit(that) && that._op === "Failure" && // @ts-expect-error
    equals(this.effect_instruction_i0, that.effect_instruction_i0);
  }
  [symbol]() {
    return pipe(
      // @ts-expect-error
      string(this._tag),
      // @ts-expect-error
      combine(hash(this.effect_instruction_i0)),
      cached(this)
    );
  }
  get cause() {
    return this.effect_instruction_i0;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Exit",
      _tag: this._op,
      cause: this.cause.toJSON()
    };
  }
  toString() {
    return format(this.toJSON());
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [Symbol.iterator]() {
    return new SingleShotGen2(new YieldWrap(this));
  }
};
var EffectPrimitiveSuccess = class {
  _op;
  effect_instruction_i0 = void 0;
  effect_instruction_i1 = void 0;
  effect_instruction_i2 = void 0;
  trace = void 0;
  [EffectTypeId2] = effectVariance;
  constructor(_op) {
    this._op = _op;
    this._tag = _op;
  }
  [symbol2](that) {
    return exitIsExit(that) && that._op === "Success" && // @ts-expect-error
    equals(this.effect_instruction_i0, that.effect_instruction_i0);
  }
  [symbol]() {
    return pipe(
      // @ts-expect-error
      string(this._tag),
      // @ts-expect-error
      combine(hash(this.effect_instruction_i0)),
      cached(this)
    );
  }
  get value() {
    return this.effect_instruction_i0;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Exit",
      _tag: this._op,
      value: toJSON(this.value)
    };
  }
  toString() {
    return format(this.toJSON());
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [Symbol.iterator]() {
    return new SingleShotGen2(new YieldWrap(this));
  }
};
var isEffect = (u) => hasProperty(u, EffectTypeId2);
var withFiberRuntime = (withRuntime) => {
  const effect = new EffectPrimitive(OP_WITH_RUNTIME);
  effect.effect_instruction_i0 = withRuntime;
  return effect;
};
var acquireUseRelease = /* @__PURE__ */ dual(3, (acquire, use, release) => uninterruptibleMask((restore) => flatMap7(acquire, (a) => flatMap7(exit(suspend(() => restore(use(a)))), (exit4) => {
  return suspend(() => release(a, exit4)).pipe(matchCauseEffect({
    onFailure: (cause3) => {
      switch (exit4._tag) {
        case OP_FAILURE:
          return failCause(sequential(exit4.effect_instruction_i0, cause3));
        case OP_SUCCESS:
          return failCause(cause3);
      }
    },
    onSuccess: () => exit4
  }));
}))));
var as2 = /* @__PURE__ */ dual(2, (self, value) => flatMap7(self, () => succeed(value)));
var asVoid = (self) => as2(self, void 0);
var custom = function() {
  const wrapper = new EffectPrimitive(OP_COMMIT);
  switch (arguments.length) {
    case 2: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.commit = arguments[1];
      break;
    }
    case 3: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.effect_instruction_i1 = arguments[1];
      wrapper.commit = arguments[2];
      break;
    }
    case 4: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.effect_instruction_i1 = arguments[1];
      wrapper.effect_instruction_i2 = arguments[2];
      wrapper.commit = arguments[3];
      break;
    }
    default: {
      throw new Error(getBugErrorMessage("you're not supposed to end up here"));
    }
  }
  return wrapper;
};
var unsafeAsync = (register, blockingOn = none4) => {
  const effect = new EffectPrimitive(OP_ASYNC);
  let cancelerRef = void 0;
  effect.effect_instruction_i0 = (resume2) => {
    cancelerRef = register(resume2);
  };
  effect.effect_instruction_i1 = blockingOn;
  return onInterrupt(effect, (_) => isEffect(cancelerRef) ? cancelerRef : void_);
};
var asyncInterrupt = (register, blockingOn = none4) => suspend(() => unsafeAsync(register, blockingOn));
var async_ = (resume2, blockingOn = none4) => {
  return custom(resume2, function() {
    let backingResume = void 0;
    let pendingEffect = void 0;
    function proxyResume(effect2) {
      if (backingResume) {
        backingResume(effect2);
      } else if (pendingEffect === void 0) {
        pendingEffect = effect2;
      }
    }
    const effect = new EffectPrimitive(OP_ASYNC);
    effect.effect_instruction_i0 = (resume3) => {
      backingResume = resume3;
      if (pendingEffect) {
        resume3(pendingEffect);
      }
    };
    effect.effect_instruction_i1 = blockingOn;
    let cancelerRef = void 0;
    let controllerRef = void 0;
    if (this.effect_instruction_i0.length !== 1) {
      controllerRef = new AbortController();
      cancelerRef = internalCall(() => this.effect_instruction_i0(proxyResume, controllerRef.signal));
    } else {
      cancelerRef = internalCall(() => this.effect_instruction_i0(proxyResume));
    }
    return cancelerRef || controllerRef ? onInterrupt(effect, (_) => {
      if (controllerRef) {
        controllerRef.abort();
      }
      return cancelerRef ?? void_;
    }) : effect;
  });
};
var catchAllCause = /* @__PURE__ */ dual(2, (self, f) => {
  const effect = new EffectPrimitive(OP_ON_FAILURE);
  effect.effect_instruction_i0 = self;
  effect.effect_instruction_i1 = f;
  return effect;
});
var catchAll = /* @__PURE__ */ dual(2, (self, f) => matchEffect(self, {
  onFailure: f,
  onSuccess: succeed
}));
var catchIf = /* @__PURE__ */ dual(3, (self, predicate, f) => catchAllCause(self, (cause3) => {
  const either4 = failureOrCause(cause3);
  switch (either4._tag) {
    case "Left":
      return predicate(either4.left) ? f(either4.left) : failCause(cause3);
    case "Right":
      return failCause(either4.right);
  }
}));
var catchSome = /* @__PURE__ */ dual(2, (self, pf) => catchAllCause(self, (cause3) => {
  const either4 = failureOrCause(cause3);
  switch (either4._tag) {
    case "Left":
      return pipe(pf(either4.left), getOrElse(() => failCause(cause3)));
    case "Right":
      return failCause(either4.right);
  }
}));
var checkInterruptible = (f) => withFiberRuntime((_, status) => f(interruption(status.runtimeFlags)));
var originalSymbol = /* @__PURE__ */ Symbol.for("effect/OriginalAnnotation");
var originalInstance = (obj) => {
  if (hasProperty(obj, originalSymbol)) {
    return obj[originalSymbol];
  }
  return obj;
};
var capture = (obj, span2) => {
  if (isSome2(span2)) {
    return new Proxy(obj, {
      has(target, p) {
        return p === spanSymbol || p === originalSymbol || p in target;
      },
      get(target, p) {
        if (p === spanSymbol) {
          return span2.value;
        }
        if (p === originalSymbol) {
          return obj;
        }
        return target[p];
      }
    });
  }
  return obj;
};
var die2 = (defect) => isObject(defect) && !(spanSymbol in defect) ? withFiberRuntime((fiber) => failCause(die(capture(defect, currentSpanFromFiber(fiber))))) : failCause(die(defect));
var dieMessage = (message) => failCauseSync(() => die(new RuntimeException(message)));
var dieSync = (evaluate2) => flatMap7(sync(evaluate2), die2);
var either2 = (self) => matchEffect(self, {
  onFailure: (e) => succeed(left2(e)),
  onSuccess: (a) => succeed(right2(a))
});
var exit = (self) => matchCause(self, {
  onFailure: exitFailCause,
  onSuccess: exitSucceed
});
var fail2 = (error) => isObject(error) && !(spanSymbol in error) ? withFiberRuntime((fiber) => failCause(fail(capture(error, currentSpanFromFiber(fiber))))) : failCause(fail(error));
var failSync = (evaluate2) => flatMap7(sync(evaluate2), fail2);
var failCause = (cause3) => {
  const effect = new EffectPrimitiveFailure(OP_FAILURE);
  effect.effect_instruction_i0 = cause3;
  return effect;
};
var failCauseSync = (evaluate2) => flatMap7(sync(evaluate2), failCause);
var fiberId = /* @__PURE__ */ withFiberRuntime((state) => succeed(state.id()));
var fiberIdWith = (f) => withFiberRuntime((state) => f(state.id()));
var flatMap7 = /* @__PURE__ */ dual(2, (self, f) => {
  const effect = new EffectPrimitive(OP_ON_SUCCESS);
  effect.effect_instruction_i0 = self;
  effect.effect_instruction_i1 = f;
  return effect;
});
var andThen3 = /* @__PURE__ */ dual(2, (self, f) => flatMap7(self, (a) => {
  const b = typeof f === "function" ? f(a) : f;
  if (isEffect(b)) {
    return b;
  } else if (isPromiseLike(b)) {
    return unsafeAsync((resume2) => {
      b.then((a2) => resume2(succeed(a2)), (e) => resume2(fail2(new UnknownException(e, "An unknown error occurred in Effect.andThen"))));
    });
  }
  return succeed(b);
}));
var step2 = (self) => {
  const effect = new EffectPrimitive("OnStep");
  effect.effect_instruction_i0 = self;
  return effect;
};
var flatten4 = (self) => flatMap7(self, identity);
var flip = (self) => matchEffect(self, {
  onFailure: succeed,
  onSuccess: fail2
});
var matchCause = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onFailure: (cause3) => succeed(options.onFailure(cause3)),
  onSuccess: (a) => succeed(options.onSuccess(a))
}));
var matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => {
  const effect = new EffectPrimitive(OP_ON_SUCCESS_AND_FAILURE);
  effect.effect_instruction_i0 = self;
  effect.effect_instruction_i1 = options.onFailure;
  effect.effect_instruction_i2 = options.onSuccess;
  return effect;
});
var matchEffect = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onFailure: (cause3) => {
    const defects3 = defects(cause3);
    if (defects3.length > 0) {
      return failCause(electFailures(cause3));
    }
    const failures3 = failures(cause3);
    if (failures3.length > 0) {
      return options.onFailure(unsafeHead(failures3));
    }
    return failCause(cause3);
  },
  onSuccess: options.onSuccess
}));
var forEachSequential = /* @__PURE__ */ dual(2, (self, f) => suspend(() => {
  const arr = fromIterable(self);
  const ret = allocate(arr.length);
  let i = 0;
  return as2(whileLoop({
    while: () => i < arr.length,
    body: () => f(arr[i], i),
    step: (b) => {
      ret[i++] = b;
    }
  }), ret);
}));
var forEachSequentialDiscard = /* @__PURE__ */ dual(2, (self, f) => suspend(() => {
  const arr = fromIterable(self);
  let i = 0;
  return whileLoop({
    while: () => i < arr.length,
    body: () => f(arr[i], i),
    step: () => {
      i++;
    }
  });
}));
var if_ = /* @__PURE__ */ dual((args2) => typeof args2[0] === "boolean" || isEffect(args2[0]), (self, options) => isEffect(self) ? flatMap7(self, (b) => b ? options.onTrue() : options.onFalse()) : self ? options.onTrue() : options.onFalse());
var interrupt2 = /* @__PURE__ */ flatMap7(fiberId, (fiberId3) => interruptWith(fiberId3));
var interruptWith = (fiberId3) => failCause(interrupt(fiberId3));
var interruptible2 = (self) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = enable3(Interruption);
  effect.effect_instruction_i1 = () => self;
  return effect;
};
var interruptibleMask = (f) => custom(f, function() {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = enable3(Interruption);
  effect.effect_instruction_i1 = (oldFlags) => interruption(oldFlags) ? internalCall(() => this.effect_instruction_i0(interruptible2)) : internalCall(() => this.effect_instruction_i0(uninterruptible));
  return effect;
});
var intoDeferred = /* @__PURE__ */ dual(2, (self, deferred) => uninterruptibleMask((restore) => flatMap7(exit(restore(self)), (exit4) => deferredDone(deferred, exit4))));
var map8 = /* @__PURE__ */ dual(2, (self, f) => flatMap7(self, (a) => sync(() => f(a))));
var mapBoth = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
  onFailure: (e) => failSync(() => options.onFailure(e)),
  onSuccess: (a) => sync(() => options.onSuccess(a))
}));
var mapError = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
  onFailure: (cause3) => {
    const either4 = failureOrCause(cause3);
    switch (either4._tag) {
      case "Left": {
        return failSync(() => f(either4.left));
      }
      case "Right": {
        return failCause(either4.right);
      }
    }
  },
  onSuccess: succeed
}));
var onError = /* @__PURE__ */ dual(2, (self, cleanup) => onExit(self, (exit4) => exitIsSuccess(exit4) ? void_ : cleanup(exit4.effect_instruction_i0)));
var onExit = /* @__PURE__ */ dual(2, (self, cleanup) => uninterruptibleMask((restore) => matchCauseEffect(restore(self), {
  onFailure: (cause1) => {
    const result = exitFailCause(cause1);
    return matchCauseEffect(cleanup(result), {
      onFailure: (cause22) => exitFailCause(sequential(cause1, cause22)),
      onSuccess: () => result
    });
  },
  onSuccess: (success) => {
    const result = exitSucceed(success);
    return zipRight(cleanup(result), result);
  }
})));
var onInterrupt = /* @__PURE__ */ dual(2, (self, cleanup) => onExit(self, exitMatch({
  onFailure: (cause3) => isInterruptedOnly(cause3) ? asVoid(cleanup(interruptors(cause3))) : void_,
  onSuccess: () => void_
})));
var orElse = /* @__PURE__ */ dual(2, (self, that) => attemptOrElse(self, that, succeed));
var orDie = (self) => orDieWith(self, identity);
var orDieWith = /* @__PURE__ */ dual(2, (self, f) => matchEffect(self, {
  onFailure: (e) => die2(f(e)),
  onSuccess: succeed
}));
var partitionMap2 = partitionMap;
var runtimeFlags = /* @__PURE__ */ withFiberRuntime((_, status) => succeed(status.runtimeFlags));
var succeed = (value) => {
  const effect = new EffectPrimitiveSuccess(OP_SUCCESS);
  effect.effect_instruction_i0 = value;
  return effect;
};
var suspend = (evaluate2) => {
  const effect = new EffectPrimitive(OP_COMMIT);
  effect.commit = evaluate2;
  return effect;
};
var sync = (thunk) => {
  const effect = new EffectPrimitive(OP_SYNC);
  effect.effect_instruction_i0 = thunk;
  return effect;
};
var tap = /* @__PURE__ */ dual((args2) => args2.length === 3 || args2.length === 2 && !(isObject(args2[1]) && "onlyEffect" in args2[1]), (self, f) => flatMap7(self, (a) => {
  const b = typeof f === "function" ? f(a) : f;
  if (isEffect(b)) {
    return as2(b, a);
  } else if (isPromiseLike(b)) {
    return unsafeAsync((resume2) => {
      b.then((_) => resume2(succeed(a)), (e) => resume2(fail2(new UnknownException(e, "An unknown error occurred in Effect.tap"))));
    });
  }
  return succeed(a);
}));
var transplant = (f) => withFiberRuntime((state) => {
  const scopeOverride = state.getFiberRef(currentForkScopeOverride);
  const scope3 = pipe(scopeOverride, getOrElse(() => state.scope()));
  return f(fiberRefLocally(currentForkScopeOverride, some2(scope3)));
});
var attemptOrElse = /* @__PURE__ */ dual(3, (self, that, onSuccess) => matchCauseEffect(self, {
  onFailure: (cause3) => {
    const defects3 = defects(cause3);
    if (defects3.length > 0) {
      return failCause(getOrThrow(keepDefectsAndElectFailures(cause3)));
    }
    return that();
  },
  onSuccess
}));
var uninterruptible = (self) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = disable3(Interruption);
  effect.effect_instruction_i1 = () => self;
  return effect;
};
var uninterruptibleMask = (f) => custom(f, function() {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = disable3(Interruption);
  effect.effect_instruction_i1 = (oldFlags) => interruption(oldFlags) ? internalCall(() => this.effect_instruction_i0(interruptible2)) : internalCall(() => this.effect_instruction_i0(uninterruptible));
  return effect;
});
var void_ = /* @__PURE__ */ succeed(void 0);
var updateRuntimeFlags = (patch9) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = patch9;
  effect.effect_instruction_i1 = void 0;
  return effect;
};
var whenEffect = /* @__PURE__ */ dual(2, (self, condition) => flatMap7(condition, (b) => {
  if (b) {
    return pipe(self, map8(some2));
  }
  return succeed(none2());
}));
var whileLoop = (options) => {
  const effect = new EffectPrimitive(OP_WHILE);
  effect.effect_instruction_i0 = options.while;
  effect.effect_instruction_i1 = options.body;
  effect.effect_instruction_i2 = options.step;
  return effect;
};
var fromIterator = (iterator) => suspend(() => {
  const effect = new EffectPrimitive(OP_ITERATOR);
  effect.effect_instruction_i0 = iterator();
  return effect;
});
var gen = function() {
  const f = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
  return fromIterator(() => f(pipe));
};
var fnUntraced = (body, ...pipeables) => Object.defineProperty(pipeables.length === 0 ? function(...args2) {
  return fromIterator(() => body.apply(this, args2));
} : function(...args2) {
  let effect = fromIterator(() => body.apply(this, args2));
  for (const x of pipeables) {
    effect = x(effect, ...args2);
  }
  return effect;
}, "length", {
  value: body.length,
  configurable: true
});
var withConcurrency = /* @__PURE__ */ dual(2, (self, concurrency) => fiberRefLocally(self, currentConcurrency, concurrency));
var withRequestBatching = /* @__PURE__ */ dual(2, (self, requestBatching) => fiberRefLocally(self, currentRequestBatching, requestBatching));
var withRuntimeFlags = /* @__PURE__ */ dual(2, (self, update5) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = update5;
  effect.effect_instruction_i1 = () => self;
  return effect;
});
var withTracerEnabled = /* @__PURE__ */ dual(2, (effect, enabled2) => fiberRefLocally(effect, currentTracerEnabled, enabled2));
var withTracerTiming = /* @__PURE__ */ dual(2, (effect, enabled2) => fiberRefLocally(effect, currentTracerTimingEnabled, enabled2));
var yieldNow = (options) => {
  const effect = new EffectPrimitive(OP_YIELD);
  return typeof options?.priority !== "undefined" ? withSchedulingPriority(effect, options.priority) : effect;
};
var zip2 = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, (a) => map8(that, (b) => [a, b])));
var zipLeft = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, (a) => as2(that, a)));
var zipRight = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, () => that));
var zipWith2 = /* @__PURE__ */ dual(3, (self, that, f) => flatMap7(self, (a) => map8(that, (b) => f(a, b))));
var never = /* @__PURE__ */ asyncInterrupt(() => {
  const interval = setInterval(() => {
  }, 2 ** 31 - 1);
  return sync(() => clearInterval(interval));
});
var interruptFiber = (self) => flatMap7(fiberId, (fiberId3) => pipe(self, interruptAsFiber(fiberId3)));
var interruptAsFiber = /* @__PURE__ */ dual(2, (self, fiberId3) => flatMap7(self.interruptAsFork(fiberId3), () => self.await));
var logLevelAll = {
  _tag: "All",
  syslog: 0,
  label: "ALL",
  ordinal: Number.MIN_SAFE_INTEGER,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var logLevelFatal = {
  _tag: "Fatal",
  syslog: 2,
  label: "FATAL",
  ordinal: 5e4,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var logLevelError = {
  _tag: "Error",
  syslog: 3,
  label: "ERROR",
  ordinal: 4e4,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var logLevelWarning = {
  _tag: "Warning",
  syslog: 4,
  label: "WARN",
  ordinal: 3e4,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var logLevelInfo = {
  _tag: "Info",
  syslog: 6,
  label: "INFO",
  ordinal: 2e4,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var logLevelDebug = {
  _tag: "Debug",
  syslog: 7,
  label: "DEBUG",
  ordinal: 1e4,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var logLevelTrace = {
  _tag: "Trace",
  syslog: 7,
  label: "TRACE",
  ordinal: 0,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var logLevelNone = {
  _tag: "None",
  syslog: 7,
  label: "OFF",
  ordinal: Number.MAX_SAFE_INTEGER,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var FiberRefSymbolKey = "effect/FiberRef";
var FiberRefTypeId = /* @__PURE__ */ Symbol.for(FiberRefSymbolKey);
var fiberRefVariance = {
  /* c8 ignore next */
  _A: (_) => _
};
var fiberRefGet = (self) => withFiberRuntime((fiber) => exitSucceed(fiber.getFiberRef(self)));
var fiberRefGetWith = /* @__PURE__ */ dual(2, (self, f) => flatMap7(fiberRefGet(self), f));
var fiberRefSet = /* @__PURE__ */ dual(2, (self, value) => fiberRefModify(self, () => [void 0, value]));
var fiberRefModify = /* @__PURE__ */ dual(2, (self, f) => withFiberRuntime((state) => {
  const [b, a] = f(state.getFiberRef(self));
  state.setFiberRef(self, a);
  return succeed(b);
}));
var RequestResolverSymbolKey = "effect/RequestResolver";
var RequestResolverTypeId = /* @__PURE__ */ Symbol.for(RequestResolverSymbolKey);
var requestResolverVariance = {
  /* c8 ignore next */
  _A: (_) => _,
  /* c8 ignore next */
  _R: (_) => _
};
var RequestResolverImpl = class _RequestResolverImpl {
  runAll;
  target;
  [RequestResolverTypeId] = requestResolverVariance;
  constructor(runAll, target) {
    this.runAll = runAll;
    this.target = target;
  }
  [symbol]() {
    return cached(this, this.target ? hash(this.target) : random(this));
  }
  [symbol2](that) {
    return this.target ? isRequestResolver(that) && equals(this.target, that.target) : this === that;
  }
  identified(...ids3) {
    return new _RequestResolverImpl(this.runAll, fromIterable2(ids3));
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var isRequestResolver = (u) => hasProperty(u, RequestResolverTypeId);
var fiberRefLocally = /* @__PURE__ */ dual(3, (use, self, value) => acquireUseRelease(zipLeft(fiberRefGet(self), fiberRefSet(self, value)), () => use, (oldValue) => fiberRefSet(self, oldValue)));
var fiberRefLocallyWith = /* @__PURE__ */ dual(3, (use, self, f) => fiberRefGetWith(self, (a) => fiberRefLocally(use, self, f(a))));
var fiberRefUnsafeMake = (initial, options) => fiberRefUnsafeMakePatch(initial, {
  differ: update(),
  fork: options?.fork ?? identity,
  join: options?.join
});
var fiberRefUnsafeMakeHashSet = (initial) => {
  const differ3 = hashSet();
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ3,
    fork: differ3.empty
  });
};
var fiberRefUnsafeMakeReadonlyArray = (initial) => {
  const differ3 = readonlyArray(update());
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ3,
    fork: differ3.empty
  });
};
var fiberRefUnsafeMakeContext = (initial) => {
  const differ3 = environment();
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ3,
    fork: differ3.empty
  });
};
var fiberRefUnsafeMakePatch = (initial, options) => {
  const _fiberRef = {
    ...CommitPrototype,
    [FiberRefTypeId]: fiberRefVariance,
    initial,
    commit() {
      return fiberRefGet(this);
    },
    diff: (oldValue, newValue) => options.differ.diff(oldValue, newValue),
    combine: (first2, second) => options.differ.combine(first2, second),
    patch: (patch9) => (oldValue) => options.differ.patch(patch9, oldValue),
    fork: options.fork,
    join: options.join ?? ((_, n) => n)
  };
  return _fiberRef;
};
var fiberRefUnsafeMakeRuntimeFlags = (initial) => fiberRefUnsafeMakePatch(initial, {
  differ,
  fork: differ.empty
});
var currentContext = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentContext"), () => fiberRefUnsafeMakeContext(empty3()));
var currentSchedulingPriority = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => fiberRefUnsafeMake(0));
var currentMaxOpsBeforeYield = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => fiberRefUnsafeMake(2048));
var currentLogAnnotations = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => fiberRefUnsafeMake(empty8()));
var currentLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogLevel"), () => fiberRefUnsafeMake(logLevelInfo));
var currentLogSpan = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogSpan"), () => fiberRefUnsafeMake(empty9()));
var withSchedulingPriority = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentSchedulingPriority, scheduler));
var withMaxOpsBeforeYield = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentMaxOpsBeforeYield, scheduler));
var currentConcurrency = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentConcurrency"), () => fiberRefUnsafeMake("unbounded"));
var currentRequestBatching = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentRequestBatching"), () => fiberRefUnsafeMake(true));
var currentUnhandledErrorLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => fiberRefUnsafeMake(some2(logLevelDebug)));
var currentVersionMismatchErrorLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => fiberRefUnsafeMake(some2(logLevelWarning)));
var withUnhandledErrorLogLevel = /* @__PURE__ */ dual(2, (self, level) => fiberRefLocally(self, currentUnhandledErrorLogLevel, level));
var currentMetricLabels = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentMetricLabels"), () => fiberRefUnsafeMakeReadonlyArray(empty()));
var metricLabels = /* @__PURE__ */ fiberRefGet(currentMetricLabels);
var currentForkScopeOverride = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => fiberRefUnsafeMake(none2(), {
  fork: () => none2(),
  join: (parent, _) => parent
}));
var currentInterruptedCause = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => fiberRefUnsafeMake(empty16, {
  fork: () => empty16,
  join: (parent, _) => parent
}));
var currentTracerEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerEnabled"), () => fiberRefUnsafeMake(true));
var currentTracerTimingEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerTiming"), () => fiberRefUnsafeMake(true));
var currentTracerSpanAnnotations = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerSpanAnnotations"), () => fiberRefUnsafeMake(empty8()));
var currentTracerSpanLinks = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerSpanLinks"), () => fiberRefUnsafeMake(empty4()));
var ScopeTypeId = /* @__PURE__ */ Symbol.for("effect/Scope");
var CloseableScopeTypeId = /* @__PURE__ */ Symbol.for("effect/CloseableScope");
var scopeAddFinalizer = (self, finalizer) => self.addFinalizer(() => asVoid(finalizer));
var scopeAddFinalizerExit = (self, finalizer) => self.addFinalizer(finalizer);
var scopeClose = (self, exit4) => self.close(exit4);
var scopeFork = (self, strategy) => self.fork(strategy);
var causeSquash = (self) => {
  return causeSquashWith(identity)(self);
};
var causeSquashWith = /* @__PURE__ */ dual(2, (self, f) => {
  const option3 = pipe(self, failureOption, map(f));
  switch (option3._tag) {
    case "None": {
      return pipe(defects(self), head2, match2({
        onNone: () => {
          const interrupts = fromIterable(interruptors(self)).flatMap((fiberId3) => fromIterable(ids2(fiberId3)).map((id) => `#${id}`));
          return new InterruptedException(interrupts ? `Interrupted by fibers: ${interrupts.join(", ")}` : void 0);
        },
        onSome: identity
      }));
    }
    case "Some": {
      return option3.value;
    }
  }
});
var YieldableError = /* @__PURE__ */ (function() {
  class YieldableError3 extends globalThis.Error {
    commit() {
      return fail2(this);
    }
    toJSON() {
      const obj = {
        ...this
      };
      if (this.message) obj.message = this.message;
      if (this.cause) obj.cause = this.cause;
      return obj;
    }
    [NodeInspectSymbol]() {
      if (this.toString !== globalThis.Error.prototype.toString) {
        return this.stack ? `${this.toString()}
${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
      } else if ("Bun" in globalThis) {
        return pretty(fail(this), {
          renderErrorCause: true
        });
      }
      return this;
    }
  }
  Object.assign(YieldableError3.prototype, StructuralCommitPrototype);
  return YieldableError3;
})();
var makeException = (proto4, tag) => {
  class Base3 extends YieldableError {
    _tag = tag;
  }
  Object.assign(Base3.prototype, proto4);
  Base3.prototype.name = tag;
  return Base3;
};
var RuntimeExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/RuntimeException");
var RuntimeException = /* @__PURE__ */ makeException({
  [RuntimeExceptionTypeId]: RuntimeExceptionTypeId
}, "RuntimeException");
var isRuntimeException = (u) => hasProperty(u, RuntimeExceptionTypeId);
var InterruptedExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/InterruptedException");
var InterruptedException = /* @__PURE__ */ makeException({
  [InterruptedExceptionTypeId]: InterruptedExceptionTypeId
}, "InterruptedException");
var isInterruptedException = (u) => hasProperty(u, InterruptedExceptionTypeId);
var IllegalArgumentExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/IllegalArgument");
var IllegalArgumentException = /* @__PURE__ */ makeException({
  [IllegalArgumentExceptionTypeId]: IllegalArgumentExceptionTypeId
}, "IllegalArgumentException");
var isIllegalArgumentException = (u) => hasProperty(u, IllegalArgumentExceptionTypeId);
var NoSuchElementExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/NoSuchElement");
var NoSuchElementException = /* @__PURE__ */ makeException({
  [NoSuchElementExceptionTypeId]: NoSuchElementExceptionTypeId
}, "NoSuchElementException");
var isNoSuchElementException = (u) => hasProperty(u, NoSuchElementExceptionTypeId);
var InvalidPubSubCapacityExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/InvalidPubSubCapacityException");
var InvalidPubSubCapacityException = /* @__PURE__ */ makeException({
  [InvalidPubSubCapacityExceptionTypeId]: InvalidPubSubCapacityExceptionTypeId
}, "InvalidPubSubCapacityException");
var ExceededCapacityExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/ExceededCapacityException");
var ExceededCapacityException = /* @__PURE__ */ makeException({
  [ExceededCapacityExceptionTypeId]: ExceededCapacityExceptionTypeId
}, "ExceededCapacityException");
var isExceededCapacityException = (u) => hasProperty(u, ExceededCapacityExceptionTypeId);
var TimeoutExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/Timeout");
var TimeoutException = /* @__PURE__ */ makeException({
  [TimeoutExceptionTypeId]: TimeoutExceptionTypeId
}, "TimeoutException");
var timeoutExceptionFromDuration = (duration) => new TimeoutException(`Operation timed out after '${format2(duration)}'`);
var isTimeoutException = (u) => hasProperty(u, TimeoutExceptionTypeId);
var UnknownExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/UnknownException");
var UnknownException = /* @__PURE__ */ (function() {
  class UnknownException3 extends YieldableError {
    _tag = "UnknownException";
    error;
    constructor(cause3, message) {
      super(message ?? "An unknown error occurred", {
        cause: cause3
      });
      this.error = cause3;
    }
  }
  Object.assign(UnknownException3.prototype, {
    [UnknownExceptionTypeId]: UnknownExceptionTypeId,
    name: "UnknownException"
  });
  return UnknownException3;
})();
var isUnknownException = (u) => hasProperty(u, UnknownExceptionTypeId);
var exitIsExit = (u) => isEffect(u) && "_tag" in u && (u._tag === "Success" || u._tag === "Failure");
var exitIsFailure = (self) => self._tag === "Failure";
var exitIsSuccess = (self) => self._tag === "Success";
var exitIsInterrupted = (self) => {
  switch (self._tag) {
    case OP_FAILURE:
      return isInterrupted(self.effect_instruction_i0);
    case OP_SUCCESS:
      return false;
  }
};
var exitAs = /* @__PURE__ */ dual(2, (self, value) => {
  switch (self._tag) {
    case OP_FAILURE: {
      return exitFailCause(self.effect_instruction_i0);
    }
    case OP_SUCCESS: {
      return exitSucceed(value);
    }
  }
});
var exitAsVoid = (self) => exitAs(self, void 0);
var exitCauseOption = (self) => {
  switch (self._tag) {
    case OP_FAILURE:
      return some2(self.effect_instruction_i0);
    case OP_SUCCESS:
      return none2();
  }
};
var exitCollectAll = (exits, options) => exitCollectAllInternal(exits, options?.parallel ? parallel : sequential);
var exitDie = (defect) => exitFailCause(die(defect));
var exitExists = /* @__PURE__ */ dual(2, (self, refinement) => {
  switch (self._tag) {
    case OP_FAILURE:
      return false;
    case OP_SUCCESS:
      return refinement(self.effect_instruction_i0);
  }
});
var exitFail = (error) => exitFailCause(fail(error));
var exitFailCause = (cause3) => {
  const effect = new EffectPrimitiveFailure(OP_FAILURE);
  effect.effect_instruction_i0 = cause3;
  return effect;
};
var exitFlatMap = /* @__PURE__ */ dual(2, (self, f) => {
  switch (self._tag) {
    case OP_FAILURE: {
      return exitFailCause(self.effect_instruction_i0);
    }
    case OP_SUCCESS: {
      return f(self.effect_instruction_i0);
    }
  }
});
var exitFlatMapEffect = /* @__PURE__ */ dual(2, (self, f) => {
  switch (self._tag) {
    case OP_FAILURE: {
      return succeed(exitFailCause(self.effect_instruction_i0));
    }
    case OP_SUCCESS: {
      return f(self.effect_instruction_i0);
    }
  }
});
var exitFlatten = (self) => pipe(self, exitFlatMap(identity));
var exitForEachEffect = /* @__PURE__ */ dual(2, (self, f) => {
  switch (self._tag) {
    case OP_FAILURE: {
      return succeed(exitFailCause(self.effect_instruction_i0));
    }
    case OP_SUCCESS: {
      return exit(f(self.effect_instruction_i0));
    }
  }
});
var exitFromEither = (either4) => {
  switch (either4._tag) {
    case "Left":
      return exitFail(either4.left);
    case "Right":
      return exitSucceed(either4.right);
  }
};
var exitFromOption = (option3) => {
  switch (option3._tag) {
    case "None":
      return exitFail(void 0);
    case "Some":
      return exitSucceed(option3.value);
  }
};
var exitGetOrElse = /* @__PURE__ */ dual(2, (self, orElse3) => {
  switch (self._tag) {
    case OP_FAILURE:
      return orElse3(self.effect_instruction_i0);
    case OP_SUCCESS:
      return self.effect_instruction_i0;
  }
});
var exitInterrupt = (fiberId3) => exitFailCause(interrupt(fiberId3));
var exitMap = /* @__PURE__ */ dual(2, (self, f) => {
  switch (self._tag) {
    case OP_FAILURE:
      return exitFailCause(self.effect_instruction_i0);
    case OP_SUCCESS:
      return exitSucceed(f(self.effect_instruction_i0));
  }
});
var exitMapBoth = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => {
  switch (self._tag) {
    case OP_FAILURE:
      return exitFailCause(pipe(self.effect_instruction_i0, map7(onFailure)));
    case OP_SUCCESS:
      return exitSucceed(onSuccess(self.effect_instruction_i0));
  }
});
var exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
  switch (self._tag) {
    case OP_FAILURE:
      return exitFailCause(pipe(self.effect_instruction_i0, map7(f)));
    case OP_SUCCESS:
      return exitSucceed(self.effect_instruction_i0);
  }
});
var exitMapErrorCause = /* @__PURE__ */ dual(2, (self, f) => {
  switch (self._tag) {
    case OP_FAILURE:
      return exitFailCause(f(self.effect_instruction_i0));
    case OP_SUCCESS:
      return exitSucceed(self.effect_instruction_i0);
  }
});
var exitMatch = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => {
  switch (self._tag) {
    case OP_FAILURE:
      return onFailure(self.effect_instruction_i0);
    case OP_SUCCESS:
      return onSuccess(self.effect_instruction_i0);
  }
});
var exitMatchEffect = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => {
  switch (self._tag) {
    case OP_FAILURE:
      return onFailure(self.effect_instruction_i0);
    case OP_SUCCESS:
      return onSuccess(self.effect_instruction_i0);
  }
});
var exitSucceed = (value) => {
  const effect = new EffectPrimitiveSuccess(OP_SUCCESS);
  effect.effect_instruction_i0 = value;
  return effect;
};
var exitVoid = /* @__PURE__ */ exitSucceed(void 0);
var exitZip = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
  onSuccess: (a, a2) => [a, a2],
  onFailure: sequential
}));
var exitZipLeft = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
  onSuccess: (a, _) => a,
  onFailure: sequential
}));
var exitZipRight = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
  onSuccess: (_, a2) => a2,
  onFailure: sequential
}));
var exitZipPar = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
  onSuccess: (a, a2) => [a, a2],
  onFailure: parallel
}));
var exitZipParLeft = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
  onSuccess: (a, _) => a,
  onFailure: parallel
}));
var exitZipParRight = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
  onSuccess: (_, a2) => a2,
  onFailure: parallel
}));
var exitZipWith = /* @__PURE__ */ dual(3, (self, that, {
  onFailure,
  onSuccess
}) => {
  switch (self._tag) {
    case OP_FAILURE: {
      switch (that._tag) {
        case OP_SUCCESS:
          return exitFailCause(self.effect_instruction_i0);
        case OP_FAILURE: {
          return exitFailCause(onFailure(self.effect_instruction_i0, that.effect_instruction_i0));
        }
      }
    }
    case OP_SUCCESS: {
      switch (that._tag) {
        case OP_SUCCESS:
          return exitSucceed(onSuccess(self.effect_instruction_i0, that.effect_instruction_i0));
        case OP_FAILURE:
          return exitFailCause(that.effect_instruction_i0);
      }
    }
  }
});
var exitCollectAllInternal = (exits, combineCauses) => {
  const list = fromIterable2(exits);
  if (!isNonEmpty(list)) {
    return none2();
  }
  return pipe(tailNonEmpty2(list), reduce(pipe(headNonEmpty2(list), exitMap(of2)), (accumulator, current) => pipe(accumulator, exitZipWith(current, {
    onSuccess: (list2, value) => pipe(list2, prepend2(value)),
    onFailure: combineCauses
  }))), exitMap(reverse2), exitMap((chunk2) => toReadonlyArray(chunk2)), some2);
};
var deferredUnsafeMake = (fiberId3) => {
  const _deferred = {
    ...CommitPrototype,
    [DeferredTypeId]: deferredVariance,
    state: make11(pending([])),
    commit() {
      return deferredAwait(this);
    },
    blockingOn: fiberId3
  };
  return _deferred;
};
var deferredMake = () => flatMap7(fiberId, (id) => deferredMakeAs(id));
var deferredMakeAs = (fiberId3) => sync(() => deferredUnsafeMake(fiberId3));
var deferredAwait = (self) => asyncInterrupt((resume2) => {
  const state = get6(self.state);
  switch (state._tag) {
    case OP_STATE_DONE: {
      return resume2(state.effect);
    }
    case OP_STATE_PENDING: {
      state.joiners.push(resume2);
      return deferredInterruptJoiner(self, resume2);
    }
  }
}, self.blockingOn);
var deferredComplete = /* @__PURE__ */ dual(2, (self, effect) => intoDeferred(effect, self));
var deferredCompleteWith = /* @__PURE__ */ dual(2, (self, effect) => sync(() => {
  const state = get6(self.state);
  switch (state._tag) {
    case OP_STATE_DONE: {
      return false;
    }
    case OP_STATE_PENDING: {
      set2(self.state, done(effect));
      for (let i = 0, len = state.joiners.length; i < len; i++) {
        state.joiners[i](effect);
      }
      return true;
    }
  }
}));
var deferredDone = /* @__PURE__ */ dual(2, (self, exit4) => deferredCompleteWith(self, exit4));
var deferredFailCause = /* @__PURE__ */ dual(2, (self, cause3) => deferredCompleteWith(self, failCause(cause3)));
var deferredInterrupt = (self) => flatMap7(fiberId, (fiberId3) => deferredCompleteWith(self, interruptWith(fiberId3)));
var deferredSucceed = /* @__PURE__ */ dual(2, (self, value) => deferredCompleteWith(self, succeed(value)));
var deferredUnsafeDone = (self, effect) => {
  const state = get6(self.state);
  if (state._tag === OP_STATE_PENDING) {
    set2(self.state, done(effect));
    for (let i = 0, len = state.joiners.length; i < len; i++) {
      state.joiners[i](effect);
    }
  }
};
var deferredInterruptJoiner = (self, joiner) => sync(() => {
  const state = get6(self.state);
  if (state._tag === OP_STATE_PENDING) {
    const index = state.joiners.indexOf(joiner);
    if (index >= 0) {
      state.joiners.splice(index, 1);
    }
  }
});
var constContext = /* @__PURE__ */ withFiberRuntime((fiber) => exitSucceed(fiber.currentContext));
var context = () => constContext;
var contextWithEffect = (f) => flatMap7(context(), f);
var provideContext = /* @__PURE__ */ dual(2, (self, context4) => fiberRefLocally(currentContext, context4)(self));
var provideSomeContext = /* @__PURE__ */ dual(2, (self, context4) => fiberRefLocallyWith(currentContext, (parent) => merge3(parent, context4))(self));
var mapInputContext = /* @__PURE__ */ dual(2, (self, f) => contextWithEffect((context4) => provideContext(self, f(context4))));
var filterEffectOrElse = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => flatMap7(options.predicate(a), (pass) => pass ? succeed(a) : options.orElse(a))));
var filterEffectOrFail = /* @__PURE__ */ dual(2, (self, options) => filterEffectOrElse(self, {
  predicate: options.predicate,
  orElse: (a) => fail2(options.orFailWith(a))
}));
var currentSpanFromFiber = (fiber) => {
  const span2 = fiber.currentSpan;
  return span2 !== void 0 && span2._tag === "Span" ? some2(span2) : none2();
};
var NoopSpanProto = {
  _tag: "Span",
  spanId: "noop",
  traceId: "noop",
  sampled: false,
  status: {
    _tag: "Ended",
    startTime: /* @__PURE__ */ BigInt(0),
    endTime: /* @__PURE__ */ BigInt(0),
    exit: exitVoid
  },
  attributes: /* @__PURE__ */ new Map(),
  links: [],
  kind: "internal",
  attribute() {
  },
  event() {
  },
  end() {
  },
  addLinks() {
  }
};
var noopSpan = (options) => Object.assign(Object.create(NoopSpanProto), options);

// node_modules/effect/dist/esm/Deferred.js
var _await = deferredAwait;
var done2 = deferredDone;
var interrupt3 = deferredInterrupt;
var unsafeMake3 = deferredUnsafeMake;

// node_modules/effect/dist/esm/Exit.js
var Exit_exports = {};
__export(Exit_exports, {
  all: () => all,
  as: () => as3,
  asVoid: () => asVoid2,
  causeOption: () => causeOption,
  die: () => die3,
  exists: () => exists,
  fail: () => fail3,
  failCause: () => failCause2,
  flatMap: () => flatMap8,
  flatMapEffect: () => flatMapEffect,
  flatten: () => flatten5,
  forEachEffect: () => forEachEffect,
  fromEither: () => fromEither,
  fromOption: () => fromOption2,
  getOrElse: () => getOrElse4,
  interrupt: () => interrupt4,
  isExit: () => isExit,
  isFailure: () => isFailure2,
  isInterrupted: () => isInterrupted2,
  isSuccess: () => isSuccess,
  map: () => map9,
  mapBoth: () => mapBoth2,
  mapError: () => mapError2,
  mapErrorCause: () => mapErrorCause,
  match: () => match5,
  matchEffect: () => matchEffect2,
  succeed: () => succeed2,
  void: () => void_2,
  zip: () => zip3,
  zipLeft: () => zipLeft2,
  zipPar: () => zipPar,
  zipParLeft: () => zipParLeft,
  zipParRight: () => zipParRight,
  zipRight: () => zipRight2,
  zipWith: () => zipWith3
});
var isExit = exitIsExit;
var isFailure2 = exitIsFailure;
var isSuccess = exitIsSuccess;
var isInterrupted2 = exitIsInterrupted;
var as3 = exitAs;
var asVoid2 = exitAsVoid;
var causeOption = exitCauseOption;
var all = exitCollectAll;
var die3 = exitDie;
var exists = exitExists;
var fail3 = exitFail;
var failCause2 = exitFailCause;
var flatMap8 = exitFlatMap;
var flatMapEffect = exitFlatMapEffect;
var flatten5 = exitFlatten;
var forEachEffect = exitForEachEffect;
var fromEither = exitFromEither;
var fromOption2 = exitFromOption;
var getOrElse4 = exitGetOrElse;
var interrupt4 = exitInterrupt;
var map9 = exitMap;
var mapBoth2 = exitMapBoth;
var mapError2 = exitMapError;
var mapErrorCause = exitMapErrorCause;
var match5 = exitMatch;
var matchEffect2 = exitMatchEffect;
var succeed2 = exitSucceed;
var void_2 = exitVoid;
var zip3 = exitZip;
var zipLeft2 = exitZipLeft;
var zipRight2 = exitZipRight;
var zipPar = exitZipPar;
var zipParLeft = exitZipParLeft;
var zipParRight = exitZipParRight;
var zipWith3 = exitZipWith;

// node_modules/effect/dist/esm/MutableHashMap.js
var TypeId8 = /* @__PURE__ */ Symbol.for("effect/MutableHashMap");
var MutableHashMapProto = {
  [TypeId8]: TypeId8,
  [Symbol.iterator]() {
    return new MutableHashMapIterator(this);
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "MutableHashMap",
      values: Array.from(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var MutableHashMapIterator = class _MutableHashMapIterator {
  self;
  referentialIterator;
  bucketIterator;
  constructor(self) {
    this.self = self;
    this.referentialIterator = self.referential[Symbol.iterator]();
  }
  next() {
    if (this.bucketIterator !== void 0) {
      return this.bucketIterator.next();
    }
    const result = this.referentialIterator.next();
    if (result.done) {
      this.bucketIterator = new BucketIterator(this.self.buckets.values());
      return this.next();
    }
    return result;
  }
  [Symbol.iterator]() {
    return new _MutableHashMapIterator(this.self);
  }
};
var BucketIterator = class {
  backing;
  constructor(backing) {
    this.backing = backing;
  }
  currentBucket;
  next() {
    if (this.currentBucket === void 0) {
      const result2 = this.backing.next();
      if (result2.done) {
        return result2;
      }
      this.currentBucket = result2.value[Symbol.iterator]();
    }
    const result = this.currentBucket.next();
    if (result.done) {
      this.currentBucket = void 0;
      return this.next();
    }
    return result;
  }
};
var empty17 = () => {
  const self = Object.create(MutableHashMapProto);
  self.referential = /* @__PURE__ */ new Map();
  self.buckets = /* @__PURE__ */ new Map();
  self.bucketsSize = 0;
  return self;
};
var get8 = /* @__PURE__ */ dual(2, (self, key) => {
  if (isEqual(key) === false) {
    return self.referential.has(key) ? some2(self.referential.get(key)) : none2();
  }
  const hash2 = key[symbol]();
  const bucket = self.buckets.get(hash2);
  if (bucket === void 0) {
    return none2();
  }
  return getFromBucket(self, bucket, key);
});
var getFromBucket = (self, bucket, key, remove8 = false) => {
  for (let i = 0, len = bucket.length; i < len; i++) {
    if (key[symbol2](bucket[i][0])) {
      const value = bucket[i][1];
      if (remove8) {
        bucket.splice(i, 1);
        self.bucketsSize--;
      }
      return some2(value);
    }
  }
  return none2();
};
var has4 = /* @__PURE__ */ dual(2, (self, key) => isSome2(get8(self, key)));
var set4 = /* @__PURE__ */ dual(3, (self, key, value) => {
  if (isEqual(key) === false) {
    self.referential.set(key, value);
    return self;
  }
  const hash2 = key[symbol]();
  const bucket = self.buckets.get(hash2);
  if (bucket === void 0) {
    self.buckets.set(hash2, [[key, value]]);
    self.bucketsSize++;
    return self;
  }
  removeFromBucket(self, bucket, key);
  bucket.push([key, value]);
  self.bucketsSize++;
  return self;
});
var removeFromBucket = (self, bucket, key) => {
  for (let i = 0, len = bucket.length; i < len; i++) {
    if (key[symbol2](bucket[i][0])) {
      bucket.splice(i, 1);
      self.bucketsSize--;
      return;
    }
  }
};
var remove5 = /* @__PURE__ */ dual(2, (self, key) => {
  if (isEqual(key) === false) {
    self.referential.delete(key);
    return self;
  }
  const hash2 = key[symbol]();
  const bucket = self.buckets.get(hash2);
  if (bucket === void 0) {
    return self;
  }
  removeFromBucket(self, bucket, key);
  if (bucket.length === 0) {
    self.buckets.delete(hash2);
  }
  return self;
});
var size5 = (self) => {
  return self.referential.size + self.bucketsSize;
};

// node_modules/effect/dist/esm/MutableList.js
var TypeId9 = /* @__PURE__ */ Symbol.for("effect/MutableList");
var MutableListProto = {
  [TypeId9]: TypeId9,
  [Symbol.iterator]() {
    let done7 = false;
    let head5 = this.head;
    return {
      next() {
        if (done7) {
          return this.return();
        }
        if (head5 == null) {
          done7 = true;
          return this.return();
        }
        const value = head5.value;
        head5 = head5.next;
        return {
          done: done7,
          value
        };
      },
      return(value) {
        if (!done7) {
          done7 = true;
        }
        return {
          done: true,
          value
        };
      }
    };
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "MutableList",
      values: Array.from(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeNode = (value) => ({
  value,
  removed: false,
  prev: void 0,
  next: void 0
});
var empty18 = () => {
  const list = Object.create(MutableListProto);
  list.head = void 0;
  list.tail = void 0;
  list._length = 0;
  return list;
};
var isEmpty6 = (self) => length(self) === 0;
var length = (self) => self._length;
var append3 = /* @__PURE__ */ dual(2, (self, value) => {
  const node = makeNode(value);
  if (self.head === void 0) {
    self.head = node;
  }
  if (self.tail === void 0) {
    self.tail = node;
  } else {
    self.tail.next = node;
    node.prev = self.tail;
    self.tail = node;
  }
  ;
  self._length += 1;
  return self;
});
var shift = (self) => {
  const head5 = self.head;
  if (head5 !== void 0) {
    remove6(self, head5);
    return head5.value;
  }
  return void 0;
};
var remove6 = (self, node) => {
  if (node.removed) {
    return;
  }
  node.removed = true;
  if (node.prev !== void 0 && node.next !== void 0) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  } else if (node.prev !== void 0) {
    self.tail = node.prev;
    node.prev.next = void 0;
  } else if (node.next !== void 0) {
    self.head = node.next;
    node.next.prev = void 0;
  } else {
    self.tail = void 0;
    self.head = void 0;
  }
  if (self._length > 0) {
    ;
    self._length -= 1;
  }
};

// node_modules/effect/dist/esm/MutableQueue.js
var TypeId10 = /* @__PURE__ */ Symbol.for("effect/MutableQueue");
var EmptyMutableQueue = /* @__PURE__ */ Symbol.for("effect/mutable/MutableQueue/Empty");
var MutableQueueProto = {
  [TypeId10]: TypeId10,
  [Symbol.iterator]() {
    return Array.from(this.queue)[Symbol.iterator]();
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "MutableQueue",
      values: Array.from(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make18 = (capacity) => {
  const queue = Object.create(MutableQueueProto);
  queue.queue = empty18();
  queue.capacity = capacity;
  return queue;
};
var unbounded = () => make18(void 0);
var offer = /* @__PURE__ */ dual(2, (self, value) => {
  const queueLength = length(self.queue);
  if (self.capacity !== void 0 && queueLength === self.capacity) {
    return false;
  }
  append3(value)(self.queue);
  return true;
});
var poll = /* @__PURE__ */ dual(2, (self, def) => {
  if (isEmpty6(self.queue)) {
    return def;
  }
  return shift(self.queue);
});

// node_modules/effect/dist/esm/internal/clock.js
var ClockSymbolKey = "effect/Clock";
var ClockTypeId = /* @__PURE__ */ Symbol.for(ClockSymbolKey);
var clockTag = /* @__PURE__ */ GenericTag("effect/Clock");
var MAX_TIMER_MILLIS = 2 ** 31 - 1;
var globalClockScheduler = {
  unsafeSchedule(task, duration) {
    const millis2 = toMillis(duration);
    if (millis2 > MAX_TIMER_MILLIS) {
      return constFalse;
    }
    let completed = false;
    const handle = setTimeout(() => {
      completed = true;
      task();
    }, millis2);
    return () => {
      clearTimeout(handle);
      return !completed;
    };
  }
};
var performanceNowNanos = /* @__PURE__ */ (function() {
  const bigint1e62 = /* @__PURE__ */ BigInt(1e6);
  if (typeof performance === "undefined" || typeof performance.now !== "function") {
    return () => BigInt(Date.now()) * bigint1e62;
  }
  let origin;
  return () => {
    if (origin === void 0) {
      origin = BigInt(Date.now()) * bigint1e62 - BigInt(Math.round(performance.now() * 1e6));
    }
    return origin + BigInt(Math.round(performance.now() * 1e6));
  };
})();
var processOrPerformanceNow = /* @__PURE__ */ (function() {
  const processHrtime = typeof process === "object" && "hrtime" in process && typeof process.hrtime.bigint === "function" ? process.hrtime : void 0;
  if (!processHrtime) {
    return performanceNowNanos;
  }
  const origin = /* @__PURE__ */ performanceNowNanos() - /* @__PURE__ */ processHrtime.bigint();
  return () => origin + processHrtime.bigint();
})();
var ClockImpl = class {
  [ClockTypeId] = ClockTypeId;
  unsafeCurrentTimeMillis() {
    return Date.now();
  }
  unsafeCurrentTimeNanos() {
    return processOrPerformanceNow();
  }
  currentTimeMillis = /* @__PURE__ */ sync(() => this.unsafeCurrentTimeMillis());
  currentTimeNanos = /* @__PURE__ */ sync(() => this.unsafeCurrentTimeNanos());
  scheduler() {
    return succeed(globalClockScheduler);
  }
  sleep(duration) {
    return async_((resume2) => {
      const canceler = globalClockScheduler.unsafeSchedule(() => resume2(void_), duration);
      return asVoid(sync(canceler));
    });
  }
};
var make19 = () => new ClockImpl();

// node_modules/effect/dist/esm/internal/opCodes/configError.js
var OP_AND = "And";
var OP_OR = "Or";
var OP_INVALID_DATA = "InvalidData";
var OP_MISSING_DATA = "MissingData";
var OP_SOURCE_UNAVAILABLE = "SourceUnavailable";
var OP_UNSUPPORTED = "Unsupported";

// node_modules/effect/dist/esm/internal/configError.js
var ConfigErrorSymbolKey = "effect/ConfigError";
var ConfigErrorTypeId = /* @__PURE__ */ Symbol.for(ConfigErrorSymbolKey);
var proto2 = {
  _tag: "ConfigError",
  [ConfigErrorTypeId]: ConfigErrorTypeId
};
var And = (self, that) => {
  const error = Object.create(proto2);
  error._op = OP_AND;
  error.left = self;
  error.right = that;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      return `${this.left} and ${this.right}`;
    }
  });
  Object.defineProperty(error, "message", {
    enumerable: false,
    get() {
      return this.toString();
    }
  });
  return error;
};
var Or = (self, that) => {
  const error = Object.create(proto2);
  error._op = OP_OR;
  error.left = self;
  error.right = that;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      return `${this.left} or ${this.right}`;
    }
  });
  Object.defineProperty(error, "message", {
    enumerable: false,
    get() {
      return this.toString();
    }
  });
  return error;
};
var InvalidData = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_INVALID_DATA;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Invalid data at ${path2}: "${this.message}")`;
    }
  });
  return error;
};
var MissingData = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_MISSING_DATA;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Missing data at ${path2}: "${this.message}")`;
    }
  });
  return error;
};
var SourceUnavailable = (path, message, cause3, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_SOURCE_UNAVAILABLE;
  error.path = path;
  error.message = message;
  error.cause = cause3;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Source unavailable at ${path2}: "${this.message}")`;
    }
  });
  return error;
};
var Unsupported = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_UNSUPPORTED;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Unsupported operation at ${path2}: "${this.message}")`;
    }
  });
  return error;
};
var prefixed = /* @__PURE__ */ dual(2, (self, prefix) => {
  switch (self._op) {
    case OP_AND: {
      return And(prefixed(self.left, prefix), prefixed(self.right, prefix));
    }
    case OP_OR: {
      return Or(prefixed(self.left, prefix), prefixed(self.right, prefix));
    }
    case OP_INVALID_DATA: {
      return InvalidData([...prefix, ...self.path], self.message);
    }
    case OP_MISSING_DATA: {
      return MissingData([...prefix, ...self.path], self.message);
    }
    case OP_SOURCE_UNAVAILABLE: {
      return SourceUnavailable([...prefix, ...self.path], self.message, self.cause);
    }
    case OP_UNSUPPORTED: {
      return Unsupported([...prefix, ...self.path], self.message);
    }
  }
});
var reduceWithContext2 = /* @__PURE__ */ dual(3, (self, context4, reducer) => {
  const input = [self];
  const output = [];
  while (input.length > 0) {
    const error = input.pop();
    switch (error._op) {
      case OP_AND: {
        input.push(error.right);
        input.push(error.left);
        output.push(left2({
          _op: "AndCase"
        }));
        break;
      }
      case OP_OR: {
        input.push(error.right);
        input.push(error.left);
        output.push(left2({
          _op: "OrCase"
        }));
        break;
      }
      case OP_INVALID_DATA: {
        output.push(right2(reducer.invalidDataCase(context4, error.path, error.message)));
        break;
      }
      case OP_MISSING_DATA: {
        output.push(right2(reducer.missingDataCase(context4, error.path, error.message)));
        break;
      }
      case OP_SOURCE_UNAVAILABLE: {
        output.push(right2(reducer.sourceUnavailableCase(context4, error.path, error.message, error.cause)));
        break;
      }
      case OP_UNSUPPORTED: {
        output.push(right2(reducer.unsupportedCase(context4, error.path, error.message)));
        break;
      }
    }
  }
  const accumulator = [];
  while (output.length > 0) {
    const either4 = output.pop();
    switch (either4._op) {
      case "Left": {
        switch (either4.left._op) {
          case "AndCase": {
            const left3 = accumulator.pop();
            const right3 = accumulator.pop();
            const value = reducer.andCase(context4, left3, right3);
            accumulator.push(value);
            break;
          }
          case "OrCase": {
            const left3 = accumulator.pop();
            const right3 = accumulator.pop();
            const value = reducer.orCase(context4, left3, right3);
            accumulator.push(value);
            break;
          }
        }
        break;
      }
      case "Right": {
        accumulator.push(either4.right);
        break;
      }
    }
  }
  if (accumulator.length === 0) {
    throw new Error("BUG: ConfigError.reduceWithContext - please report an issue at https://github.com/Effect-TS/effect/issues");
  }
  return accumulator.pop();
});

// node_modules/effect/dist/esm/internal/configProvider/pathPatch.js
var empty19 = {
  _tag: "Empty"
};
var patch5 = /* @__PURE__ */ dual(2, (path, patch9) => {
  let input = of3(patch9);
  let output = path;
  while (isCons(input)) {
    const patch10 = input.head;
    switch (patch10._tag) {
      case "Empty": {
        input = input.tail;
        break;
      }
      case "AndThen": {
        input = cons(patch10.first, cons(patch10.second, input.tail));
        break;
      }
      case "MapName": {
        output = map2(output, patch10.f);
        input = input.tail;
        break;
      }
      case "Nested": {
        output = prepend(output, patch10.name);
        input = input.tail;
        break;
      }
      case "Unnested": {
        const containsName = pipe(head(output), contains(patch10.name));
        if (containsName) {
          output = tailNonEmpty(output);
          input = input.tail;
        } else {
          return left2(MissingData(output, `Expected ${patch10.name} to be in path in ConfigProvider#unnested`));
        }
        break;
      }
    }
  }
  return right2(output);
});

// node_modules/effect/dist/esm/internal/opCodes/config.js
var OP_CONSTANT = "Constant";
var OP_FAIL2 = "Fail";
var OP_FALLBACK = "Fallback";
var OP_DESCRIBED = "Described";
var OP_LAZY = "Lazy";
var OP_MAP_OR_FAIL = "MapOrFail";
var OP_NESTED = "Nested";
var OP_PRIMITIVE = "Primitive";
var OP_REDACTED = "Redacted";
var OP_SEQUENCE = "Sequence";
var OP_HASHMAP = "HashMap";
var OP_ZIP_WITH = "ZipWith";

// node_modules/effect/dist/esm/internal/configProvider.js
var concat = (l, r) => [...l, ...r];
var ConfigProviderSymbolKey = "effect/ConfigProvider";
var ConfigProviderTypeId = /* @__PURE__ */ Symbol.for(ConfigProviderSymbolKey);
var configProviderTag = /* @__PURE__ */ GenericTag("effect/ConfigProvider");
var FlatConfigProviderSymbolKey = "effect/ConfigProviderFlat";
var FlatConfigProviderTypeId = /* @__PURE__ */ Symbol.for(FlatConfigProviderSymbolKey);
var make21 = (options) => ({
  [ConfigProviderTypeId]: ConfigProviderTypeId,
  pipe() {
    return pipeArguments(this, arguments);
  },
  ...options
});
var makeFlat = (options) => ({
  [FlatConfigProviderTypeId]: FlatConfigProviderTypeId,
  patch: options.patch,
  load: (path, config, split = true) => options.load(path, config, split),
  enumerateChildren: options.enumerateChildren
});
var fromFlat = (flat) => make21({
  load: (config) => flatMap7(fromFlatLoop(flat, empty(), config, false), (chunk2) => match2(head(chunk2), {
    onNone: () => fail2(MissingData(empty(), `Expected a single value having structure: ${config}`)),
    onSome: succeed
  })),
  flattened: flat
});
var fromEnv = (options) => {
  const {
    pathDelim,
    seqDelim
  } = Object.assign({}, {
    pathDelim: "_",
    seqDelim: ","
  }, options);
  const makePathString = (path) => pipe(path, join(pathDelim));
  const unmakePathString = (pathString) => pathString.split(pathDelim);
  const getEnv = () => typeof process !== "undefined" && "env" in process && typeof process.env === "object" ? process.env : {};
  const load = (path, primitive, split = true) => {
    const pathString = makePathString(path);
    const current = getEnv();
    const valueOpt = pathString in current ? some2(current[pathString]) : none2();
    return pipe(valueOpt, mapError(() => MissingData(path, `Expected ${pathString} to exist in the process context`)), flatMap7((value) => parsePrimitive(value, path, primitive, seqDelim, split)));
  };
  const enumerateChildren = (path) => sync(() => {
    const current = getEnv();
    const keys5 = Object.keys(current);
    const keyPaths = keys5.map((value) => unmakePathString(value.toUpperCase()));
    const filteredKeyPaths = keyPaths.filter((keyPath) => {
      for (let i = 0; i < path.length; i++) {
        const pathComponent = pipe(path, unsafeGet(i));
        const currentElement = keyPath[i];
        if (currentElement === void 0 || pathComponent !== currentElement) {
          return false;
        }
      }
      return true;
    }).flatMap((keyPath) => keyPath.slice(path.length, path.length + 1));
    return fromIterable5(filteredKeyPaths);
  });
  return fromFlat(makeFlat({
    load,
    enumerateChildren,
    patch: empty19
  }));
};
var extend = (leftDef, rightDef, left3, right3) => {
  const leftPad = unfold(left3.length, (index) => index >= right3.length ? none2() : some2([leftDef(index), index + 1]));
  const rightPad = unfold(right3.length, (index) => index >= left3.length ? none2() : some2([rightDef(index), index + 1]));
  const leftExtension = concat(left3, leftPad);
  const rightExtension = concat(right3, rightPad);
  return [leftExtension, rightExtension];
};
var appendConfigPath = (path, config) => {
  let op = config;
  if (op._tag === "Nested") {
    const out = path.slice();
    while (op._tag === "Nested") {
      out.push(op.name);
      op = op.config;
    }
    return out;
  }
  return path;
};
var RedactedConfigErrorReducer = {
  andCase: (_, left3, right3) => And(left3, right3),
  orCase: (_, left3, right3) => Or(left3, right3),
  invalidDataCase: (_, path) => InvalidData(path, "<redacted>"),
  missingDataCase: (_, path) => MissingData(path, "<redacted>"),
  sourceUnavailableCase: (_, path, _message, cause3) => SourceUnavailable(path, "<redacted>", cause3),
  unsupportedCase: (_, path) => Unsupported(path, "<redacted>")
};
var redactConfigError = (error) => reduceWithContext2(error, void 0, RedactedConfigErrorReducer);
var fromFlatLoop = (flat, prefix, config, split) => {
  const op = config;
  switch (op._tag) {
    case OP_CONSTANT: {
      return succeed(of(op.value));
    }
    case OP_DESCRIBED: {
      return suspend(() => fromFlatLoop(flat, prefix, op.config, split));
    }
    case OP_FAIL2: {
      return fail2(MissingData(prefix, op.message));
    }
    case OP_FALLBACK: {
      return pipe(suspend(() => fromFlatLoop(flat, prefix, op.first, split)), catchAll((error1) => {
        if (op.condition(error1)) {
          return pipe(fromFlatLoop(flat, prefix, op.second, split), catchAll((error2) => fail2(Or(error1, error2))));
        }
        return fail2(error1);
      }));
    }
    case OP_LAZY: {
      return suspend(() => fromFlatLoop(flat, prefix, op.config(), split));
    }
    case OP_MAP_OR_FAIL: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.original, split), flatMap7(forEachSequential((a) => pipe(op.mapOrFail(a), mapError(prefixed(appendConfigPath(prefix, op.original))))))));
    }
    case OP_NESTED: {
      return suspend(() => fromFlatLoop(flat, concat(prefix, of(op.name)), op.config, split));
    }
    case OP_PRIMITIVE: {
      return pipe(patch5(prefix, flat.patch), flatMap7((prefix2) => pipe(flat.load(prefix2, op, split), flatMap7((values3) => {
        if (values3.length === 0) {
          const name = pipe(last(prefix2), getOrElse(() => "<n/a>"));
          return fail2(MissingData([], `Expected ${op.description} with name ${name}`));
        }
        return succeed(values3);
      }))));
    }
    case OP_REDACTED: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.original, split), mapError(redactConfigError), map8(map2(op.redact))));
    }
    case OP_SEQUENCE: {
      return pipe(patch5(prefix, flat.patch), flatMap7((patchedPrefix) => pipe(flat.enumerateChildren(patchedPrefix), flatMap7(indicesFrom), flatMap7((indices) => {
        if (indices.length === 0) {
          return suspend(() => map8(fromFlatLoop(flat, prefix, op.config, true), of));
        }
        return pipe(forEachSequential(indices, (index) => fromFlatLoop(flat, append(prefix, `[${index}]`), op.config, true)), map8((chunkChunk) => {
          const flattened = flatten(chunkChunk);
          if (flattened.length === 0) {
            return of(empty());
          }
          return of(flattened);
        }));
      }))));
    }
    case OP_HASHMAP: {
      return suspend(() => pipe(patch5(prefix, flat.patch), flatMap7((prefix2) => pipe(flat.enumerateChildren(prefix2), flatMap7((keys5) => {
        return pipe(keys5, forEachSequential((key) => fromFlatLoop(flat, concat(prefix2, of(key)), op.valueConfig, split)), map8((matrix) => {
          if (matrix.length === 0) {
            return of(empty8());
          }
          return pipe(transpose(matrix), map2((values3) => fromIterable6(zip(fromIterable(keys5), values3))));
        }));
      })))));
    }
    case OP_ZIP_WITH: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.left, split), either2, flatMap7((left3) => pipe(fromFlatLoop(flat, prefix, op.right, split), either2, flatMap7((right3) => {
        if (isLeft2(left3) && isLeft2(right3)) {
          return fail2(And(left3.left, right3.left));
        }
        if (isLeft2(left3) && isRight2(right3)) {
          return fail2(left3.left);
        }
        if (isRight2(left3) && isLeft2(right3)) {
          return fail2(right3.left);
        }
        if (isRight2(left3) && isRight2(right3)) {
          const path = pipe(prefix, join("."));
          const fail7 = fromFlatLoopFail(prefix, path);
          const [lefts, rights] = extend(fail7, fail7, pipe(left3.right, map2(right2)), pipe(right3.right, map2(right2)));
          return pipe(lefts, zip(rights), forEachSequential(([left4, right4]) => pipe(zip2(left4, right4), map8(([left5, right5]) => op.zip(left5, right5)))));
        }
        throw new Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
      })))));
    }
  }
};
var fromFlatLoopFail = (prefix, path) => (index) => left2(MissingData(prefix, `The element at index ${index} in a sequence at path "${path}" was missing`));
var splitPathString = (text, delim) => {
  const split = text.split(new RegExp(`\\s*${escape(delim)}\\s*`));
  return split;
};
var parsePrimitive = (text, path, primitive, delimiter, split) => {
  if (!split) {
    return pipe(primitive.parse(text), mapBoth({
      onFailure: prefixed(path),
      onSuccess: of
    }));
  }
  return pipe(splitPathString(text, delimiter), forEachSequential((char) => primitive.parse(char.trim())), mapError(prefixed(path)));
};
var transpose = (array3) => {
  return Object.keys(array3[0]).map((column) => array3.map((row) => row[column]));
};
var indicesFrom = (quotedIndices) => pipe(forEachSequential(quotedIndices, parseQuotedIndex), mapBoth({
  onFailure: () => empty(),
  onSuccess: sort(Order)
}), either2, map8(merge));
var QUOTED_INDEX_REGEX = /^(\[(\d+)\])$/;
var parseQuotedIndex = (str) => {
  const match12 = str.match(QUOTED_INDEX_REGEX);
  if (match12 !== null) {
    const matchedIndex = match12[2];
    return pipe(matchedIndex !== void 0 && matchedIndex.length > 0 ? some2(matchedIndex) : none2(), flatMap(parseInteger));
  }
  return none2();
};
var parseInteger = (str) => {
  const parsedIndex = Number.parseInt(str);
  return Number.isNaN(parsedIndex) ? none2() : some2(parsedIndex);
};

// node_modules/effect/dist/esm/internal/defaultServices/console.js
var TypeId11 = /* @__PURE__ */ Symbol.for("effect/Console");
var consoleTag = /* @__PURE__ */ GenericTag("effect/Console");
var defaultConsole = {
  [TypeId11]: TypeId11,
  assert(condition, ...args2) {
    return sync(() => {
      console.assert(condition, ...args2);
    });
  },
  clear: /* @__PURE__ */ sync(() => {
    console.clear();
  }),
  count(label) {
    return sync(() => {
      console.count(label);
    });
  },
  countReset(label) {
    return sync(() => {
      console.countReset(label);
    });
  },
  debug(...args2) {
    return sync(() => {
      console.debug(...args2);
    });
  },
  dir(item, options) {
    return sync(() => {
      console.dir(item, options);
    });
  },
  dirxml(...args2) {
    return sync(() => {
      console.dirxml(...args2);
    });
  },
  error(...args2) {
    return sync(() => {
      console.error(...args2);
    });
  },
  group(options) {
    return options?.collapsed ? sync(() => console.groupCollapsed(options?.label)) : sync(() => console.group(options?.label));
  },
  groupEnd: /* @__PURE__ */ sync(() => {
    console.groupEnd();
  }),
  info(...args2) {
    return sync(() => {
      console.info(...args2);
    });
  },
  log(...args2) {
    return sync(() => {
      console.log(...args2);
    });
  },
  table(tabularData, properties) {
    return sync(() => {
      console.table(tabularData, properties);
    });
  },
  time(label) {
    return sync(() => console.time(label));
  },
  timeEnd(label) {
    return sync(() => console.timeEnd(label));
  },
  timeLog(label, ...args2) {
    return sync(() => {
      console.timeLog(label, ...args2);
    });
  },
  trace(...args2) {
    return sync(() => {
      console.trace(...args2);
    });
  },
  warn(...args2) {
    return sync(() => {
      console.warn(...args2);
    });
  },
  unsafe: console
};

// node_modules/effect/dist/esm/internal/random.js
var RandomSymbolKey = "effect/Random";
var RandomTypeId = /* @__PURE__ */ Symbol.for(RandomSymbolKey);
var randomTag = /* @__PURE__ */ GenericTag("effect/Random");
var RandomImpl = class {
  seed;
  [RandomTypeId] = RandomTypeId;
  PRNG;
  constructor(seed) {
    this.seed = seed;
    this.PRNG = new PCGRandom(seed);
  }
  get next() {
    return sync(() => this.PRNG.number());
  }
  get nextBoolean() {
    return map8(this.next, (n) => n > 0.5);
  }
  get nextInt() {
    return sync(() => this.PRNG.integer(Number.MAX_SAFE_INTEGER));
  }
  nextRange(min4, max6) {
    return map8(this.next, (n) => (max6 - min4) * n + min4);
  }
  nextIntBetween(min4, max6) {
    return sync(() => this.PRNG.integer(max6 - min4) + min4);
  }
  shuffle(elements) {
    return shuffleWith(elements, (n) => this.nextIntBetween(0, n));
  }
};
var shuffleWith = (elements, nextIntBounded) => {
  return suspend(() => pipe(sync(() => Array.from(elements)), flatMap7((buffer) => {
    const numbers = [];
    for (let i = buffer.length; i >= 2; i = i - 1) {
      numbers.push(i);
    }
    return pipe(numbers, forEachSequentialDiscard((n) => pipe(nextIntBounded(n), map8((k) => swap(buffer, n - 1, k)))), as2(fromIterable2(buffer)));
  })));
};
var swap = (buffer, index1, index2) => {
  const tmp = buffer[index1];
  buffer[index1] = buffer[index2];
  buffer[index2] = tmp;
  return buffer;
};
var make22 = (seed) => new RandomImpl(hash(seed));
var FixedRandomImpl = class {
  values;
  [RandomTypeId] = RandomTypeId;
  index = 0;
  constructor(values3) {
    this.values = values3;
    if (values3.length === 0) {
      throw new Error("Requires at least one value");
    }
  }
  getNextValue() {
    const value = this.values[this.index];
    this.index = (this.index + 1) % this.values.length;
    return value;
  }
  get next() {
    return sync(() => {
      const value = this.getNextValue();
      if (typeof value === "number") {
        return Math.max(0, Math.min(1, value));
      }
      return hash(value) / 2147483647;
    });
  }
  get nextBoolean() {
    return sync(() => {
      const value = this.getNextValue();
      if (typeof value === "boolean") {
        return value;
      }
      return hash(value) % 2 === 0;
    });
  }
  get nextInt() {
    return sync(() => {
      const value = this.getNextValue();
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.round(value);
      }
      return Math.abs(hash(value));
    });
  }
  nextRange(min4, max6) {
    return map8(this.next, (n) => (max6 - min4) * n + min4);
  }
  nextIntBetween(min4, max6) {
    return sync(() => {
      const value = this.getNextValue();
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(min4, Math.min(max6 - 1, Math.round(value)));
      }
      const hash2 = Math.abs(hash(value));
      return min4 + hash2 % (max6 - min4);
    });
  }
  shuffle(elements) {
    return shuffleWith(elements, (n) => this.nextIntBetween(0, n));
  }
};
var fixed = (values3) => new FixedRandomImpl(values3);

// node_modules/effect/dist/esm/internal/tracer.js
var TracerTypeId = /* @__PURE__ */ Symbol.for("effect/Tracer");
var make23 = (options) => ({
  [TracerTypeId]: TracerTypeId,
  ...options
});
var tracerTag = /* @__PURE__ */ GenericTag("effect/Tracer");
var spanTag = /* @__PURE__ */ GenericTag("effect/ParentSpan");
var randomHexString = /* @__PURE__ */ (function() {
  const characters = "abcdef0123456789";
  const charactersLength = characters.length;
  return function(length2) {
    let result = "";
    for (let i = 0; i < length2; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  };
})();
var NativeSpan = class {
  name;
  parent;
  context;
  startTime;
  kind;
  _tag = "Span";
  spanId;
  traceId = "native";
  sampled = true;
  status;
  attributes;
  events = [];
  links;
  constructor(name, parent, context4, links, startTime, kind) {
    this.name = name;
    this.parent = parent;
    this.context = context4;
    this.startTime = startTime;
    this.kind = kind;
    this.status = {
      _tag: "Started",
      startTime
    };
    this.attributes = /* @__PURE__ */ new Map();
    this.traceId = parent._tag === "Some" ? parent.value.traceId : randomHexString(32);
    this.spanId = randomHexString(16);
    this.links = Array.from(links);
  }
  end(endTime, exit4) {
    this.status = {
      _tag: "Ended",
      endTime,
      exit: exit4,
      startTime: this.status.startTime
    };
  }
  attribute(key, value) {
    this.attributes.set(key, value);
  }
  event(name, startTime, attributes) {
    this.events.push([name, startTime, attributes ?? {}]);
  }
  addLinks(links) {
    this.links.push(...links);
  }
};
var nativeTracer = /* @__PURE__ */ make23({
  span: (name, parent, context4, links, startTime, kind) => new NativeSpan(name, parent, context4, links, startTime, kind),
  context: (f) => f()
});
var addSpanStackTrace = (options) => {
  if (options?.captureStackTrace === false) {
    return options;
  } else if (options?.captureStackTrace !== void 0 && typeof options.captureStackTrace !== "boolean") {
    return options;
  }
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 3;
  const traceError = new Error();
  Error.stackTraceLimit = limit;
  let cache = false;
  return {
    ...options,
    captureStackTrace: () => {
      if (cache !== false) {
        return cache;
      }
      if (traceError.stack !== void 0) {
        const stack = traceError.stack.split("\n");
        if (stack[3] !== void 0) {
          cache = stack[3].trim();
          return cache;
        }
      }
    }
  };
};
var DisablePropagation = /* @__PURE__ */ Reference2()("effect/Tracer/DisablePropagation", {
  defaultValue: constFalse
});

// node_modules/effect/dist/esm/internal/defaultServices.js
var liveServices = /* @__PURE__ */ pipe(/* @__PURE__ */ empty3(), /* @__PURE__ */ add2(clockTag, /* @__PURE__ */ make19()), /* @__PURE__ */ add2(consoleTag, defaultConsole), /* @__PURE__ */ add2(randomTag, /* @__PURE__ */ make22(/* @__PURE__ */ Math.random())), /* @__PURE__ */ add2(configProviderTag, /* @__PURE__ */ fromEnv()), /* @__PURE__ */ add2(tracerTag, nativeTracer));
var currentServices = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/DefaultServices/currentServices"), () => fiberRefUnsafeMakeContext(liveServices));
var sleep = (duration) => {
  const decodedDuration = decode(duration);
  return clockWith((clock3) => clock3.sleep(decodedDuration));
};
var defaultServicesWith = (f) => withFiberRuntime((fiber) => f(fiber.currentDefaultServices));
var clockWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(clockTag.key)));
var currentTimeMillis = /* @__PURE__ */ clockWith((clock3) => clock3.currentTimeMillis);
var currentTimeNanos = /* @__PURE__ */ clockWith((clock3) => clock3.currentTimeNanos);
var withClock = /* @__PURE__ */ dual(2, (effect, c) => fiberRefLocallyWith(currentServices, add2(clockTag, c))(effect));
var withConfigProvider = /* @__PURE__ */ dual(2, (self, provider) => fiberRefLocallyWith(currentServices, add2(configProviderTag, provider))(self));
var configProviderWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(configProviderTag.key)));
var randomWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(randomTag.key)));
var withRandom = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(currentServices, add2(randomTag, value))(effect));
var tracerWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(tracerTag.key)));
var withTracer = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(currentServices, add2(tracerTag, value))(effect));

// node_modules/effect/dist/esm/Clock.js
var sleep2 = sleep;
var currentTimeMillis2 = currentTimeMillis;
var currentTimeNanos2 = currentTimeNanos;
var clockWith2 = clockWith;
var Clock = clockTag;

// node_modules/effect/dist/esm/internal/fiberRefs.js
function unsafeMake4(fiberRefLocals) {
  return new FiberRefsImpl(fiberRefLocals);
}
function empty20() {
  return unsafeMake4(/* @__PURE__ */ new Map());
}
var FiberRefsSym = /* @__PURE__ */ Symbol.for("effect/FiberRefs");
var FiberRefsImpl = class {
  locals;
  [FiberRefsSym] = FiberRefsSym;
  constructor(locals) {
    this.locals = locals;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var findAncestor = (_ref, _parentStack, _childStack, _childModified = false) => {
  const ref = _ref;
  let parentStack = _parentStack;
  let childStack = _childStack;
  let childModified = _childModified;
  let ret = void 0;
  while (ret === void 0) {
    if (isNonEmptyReadonlyArray(parentStack) && isNonEmptyReadonlyArray(childStack)) {
      const parentFiberId = headNonEmpty(parentStack)[0];
      const parentAncestors = tailNonEmpty(parentStack);
      const childFiberId = headNonEmpty(childStack)[0];
      const childRefValue = headNonEmpty(childStack)[1];
      const childAncestors = tailNonEmpty(childStack);
      if (parentFiberId.startTimeMillis < childFiberId.startTimeMillis) {
        childStack = childAncestors;
        childModified = true;
      } else if (parentFiberId.startTimeMillis > childFiberId.startTimeMillis) {
        parentStack = parentAncestors;
      } else {
        if (parentFiberId.id < childFiberId.id) {
          childStack = childAncestors;
          childModified = true;
        } else if (parentFiberId.id > childFiberId.id) {
          parentStack = parentAncestors;
        } else {
          ret = [childRefValue, childModified];
        }
      }
    } else {
      ret = [ref.initial, true];
    }
  }
  return ret;
};
var joinAs = /* @__PURE__ */ dual(3, (self, fiberId3, that) => {
  const parentFiberRefs = new Map(self.locals);
  that.locals.forEach((childStack, fiberRef) => {
    const childValue = childStack[0][1];
    if (!childStack[0][0][symbol2](fiberId3)) {
      if (!parentFiberRefs.has(fiberRef)) {
        if (equals(childValue, fiberRef.initial)) {
          return;
        }
        parentFiberRefs.set(fiberRef, [[fiberId3, fiberRef.join(fiberRef.initial, childValue)]]);
        return;
      }
      const parentStack = parentFiberRefs.get(fiberRef);
      const [ancestor, wasModified] = findAncestor(fiberRef, parentStack, childStack);
      if (wasModified) {
        const patch9 = fiberRef.diff(ancestor, childValue);
        const oldValue = parentStack[0][1];
        const newValue = fiberRef.join(oldValue, fiberRef.patch(patch9)(oldValue));
        if (!equals(oldValue, newValue)) {
          let newStack;
          const parentFiberId = parentStack[0][0];
          if (parentFiberId[symbol2](fiberId3)) {
            newStack = [[parentFiberId, newValue], ...parentStack.slice(1)];
          } else {
            newStack = [[fiberId3, newValue], ...parentStack];
          }
          parentFiberRefs.set(fiberRef, newStack);
        }
      }
    }
  });
  return new FiberRefsImpl(parentFiberRefs);
});
var forkAs = /* @__PURE__ */ dual(2, (self, childId) => {
  const map14 = /* @__PURE__ */ new Map();
  unsafeForkAs(self, map14, childId);
  return new FiberRefsImpl(map14);
});
var unsafeForkAs = (self, map14, fiberId3) => {
  self.locals.forEach((stack, fiberRef) => {
    const oldValue = stack[0][1];
    const newValue = fiberRef.patch(fiberRef.fork)(oldValue);
    if (equals(oldValue, newValue)) {
      map14.set(fiberRef, stack);
    } else {
      map14.set(fiberRef, [[fiberId3, newValue], ...stack]);
    }
  });
};
var fiberRefs = (self) => fromIterable5(self.locals.keys());
var setAll = (self) => forEachSequentialDiscard(fiberRefs(self), (fiberRef) => fiberRefSet(fiberRef, getOrDefault(self, fiberRef)));
var delete_ = /* @__PURE__ */ dual(2, (self, fiberRef) => {
  const locals = new Map(self.locals);
  locals.delete(fiberRef);
  return new FiberRefsImpl(locals);
});
var get9 = /* @__PURE__ */ dual(2, (self, fiberRef) => {
  if (!self.locals.has(fiberRef)) {
    return none2();
  }
  return some2(headNonEmpty(self.locals.get(fiberRef))[1]);
});
var getOrDefault = /* @__PURE__ */ dual(2, (self, fiberRef) => pipe(get9(self, fiberRef), getOrElse(() => fiberRef.initial)));
var updateAs = /* @__PURE__ */ dual(2, (self, {
  fiberId: fiberId3,
  fiberRef,
  value
}) => {
  if (self.locals.size === 0) {
    return new FiberRefsImpl(/* @__PURE__ */ new Map([[fiberRef, [[fiberId3, value]]]]));
  }
  const locals = new Map(self.locals);
  unsafeUpdateAs(locals, fiberId3, fiberRef, value);
  return new FiberRefsImpl(locals);
});
var unsafeUpdateAs = (locals, fiberId3, fiberRef, value) => {
  const oldStack = locals.get(fiberRef) ?? [];
  let newStack;
  if (isNonEmptyReadonlyArray(oldStack)) {
    const [currentId, currentValue] = headNonEmpty(oldStack);
    if (currentId[symbol2](fiberId3)) {
      if (equals(currentValue, value)) {
        return;
      } else {
        newStack = [[fiberId3, value], ...oldStack.slice(1)];
      }
    } else {
      newStack = [[fiberId3, value], ...oldStack];
    }
  } else {
    newStack = [[fiberId3, value]];
  }
  locals.set(fiberRef, newStack);
};
var updateManyAs = /* @__PURE__ */ dual(2, (self, {
  entries: entries2,
  forkAs: forkAs2
}) => {
  if (self.locals.size === 0) {
    return new FiberRefsImpl(new Map(entries2));
  }
  const locals = new Map(self.locals);
  if (forkAs2 !== void 0) {
    unsafeForkAs(self, locals, forkAs2);
  }
  entries2.forEach(([fiberRef, values3]) => {
    if (values3.length === 1) {
      unsafeUpdateAs(locals, values3[0][0], fiberRef, values3[0][1]);
    } else {
      values3.forEach(([fiberId3, value]) => {
        unsafeUpdateAs(locals, fiberId3, fiberRef, value);
      });
    }
  });
  return new FiberRefsImpl(locals);
});

// node_modules/effect/dist/esm/FiberRefs.js
var get10 = get9;
var getOrDefault2 = getOrDefault;
var joinAs2 = joinAs;
var setAll2 = setAll;
var updateManyAs2 = updateManyAs;
var empty21 = empty20;

// node_modules/effect/dist/esm/LogLevel.js
var All = logLevelAll;
var Fatal = logLevelFatal;
var Error2 = logLevelError;
var Warning = logLevelWarning;
var Info = logLevelInfo;
var Debug = logLevelDebug;
var Trace = logLevelTrace;
var None3 = logLevelNone;
var Order3 = /* @__PURE__ */ pipe(Order, /* @__PURE__ */ mapInput2((level) => level.ordinal));
var greaterThan3 = /* @__PURE__ */ greaterThan(Order3);
var fromLiteral = (literal) => {
  switch (literal) {
    case "All":
      return All;
    case "Debug":
      return Debug;
    case "Error":
      return Error2;
    case "Fatal":
      return Fatal;
    case "Info":
      return Info;
    case "Trace":
      return Trace;
    case "None":
      return None3;
    case "Warning":
      return Warning;
  }
};

// node_modules/effect/dist/esm/internal/logSpan.js
var make24 = (label, startTime) => ({
  label,
  startTime
});
var formatLabel = (key) => key.replace(/[\s="]/g, "_");
var render = (now) => (self) => {
  const label = formatLabel(self.label);
  return `${label}=${now - self.startTime}ms`;
};

// node_modules/effect/dist/esm/LogSpan.js
var make25 = make24;

// node_modules/effect/dist/esm/Effectable.js
var EffectPrototype2 = EffectPrototype;
var CommitPrototype2 = CommitPrototype;
var Base2 = Base;
var Class2 = class extends Base2 {
};

// node_modules/effect/dist/esm/Readable.js
var TypeId12 = /* @__PURE__ */ Symbol.for("effect/Readable");
var Proto = {
  [TypeId12]: TypeId12,
  pipe() {
    return pipeArguments(this, arguments);
  }
};

// node_modules/effect/dist/esm/internal/ref.js
var RefTypeId = /* @__PURE__ */ Symbol.for("effect/Ref");
var refVariance = {
  /* c8 ignore next */
  _A: (_) => _
};
var RefImpl = class extends Class2 {
  ref;
  commit() {
    return this.get;
  }
  [RefTypeId] = refVariance;
  [TypeId12] = TypeId12;
  constructor(ref) {
    super();
    this.ref = ref;
    this.get = sync(() => get6(this.ref));
  }
  get;
  modify(f) {
    return sync(() => {
      const current = get6(this.ref);
      const [b, a] = f(current);
      if (current !== a) {
        set2(a)(this.ref);
      }
      return b;
    });
  }
};
var unsafeMake5 = (value) => new RefImpl(make11(value));
var make26 = (value) => sync(() => unsafeMake5(value));
var get11 = (self) => self.get;
var set5 = /* @__PURE__ */ dual(2, (self, value) => self.modify(() => [void 0, value]));
var getAndSet = /* @__PURE__ */ dual(2, (self, value) => self.modify((a) => [a, value]));
var modify3 = /* @__PURE__ */ dual(2, (self, f) => self.modify(f));
var update2 = /* @__PURE__ */ dual(2, (self, f) => self.modify((a) => [void 0, f(a)]));

// node_modules/effect/dist/esm/Ref.js
var make27 = make26;
var get12 = get11;
var getAndSet2 = getAndSet;
var update3 = update2;

// node_modules/effect/dist/esm/Tracer.js
var tracerWith2 = tracerWith;

// node_modules/effect/dist/esm/internal/fiberRefs/patch.js
var OP_EMPTY2 = "Empty";
var OP_ADD = "Add";
var OP_REMOVE = "Remove";
var OP_UPDATE = "Update";
var OP_AND_THEN = "AndThen";
var empty22 = {
  _tag: OP_EMPTY2
};
var diff5 = (oldValue, newValue) => {
  const missingLocals = new Map(oldValue.locals);
  let patch9 = empty22;
  for (const [fiberRef, pairs] of newValue.locals.entries()) {
    const newValue2 = headNonEmpty(pairs)[1];
    const old = missingLocals.get(fiberRef);
    if (old !== void 0) {
      const oldValue2 = headNonEmpty(old)[1];
      if (!equals(oldValue2, newValue2)) {
        patch9 = combine7({
          _tag: OP_UPDATE,
          fiberRef,
          patch: fiberRef.diff(oldValue2, newValue2)
        })(patch9);
      }
    } else {
      patch9 = combine7({
        _tag: OP_ADD,
        fiberRef,
        value: newValue2
      })(patch9);
    }
    missingLocals.delete(fiberRef);
  }
  for (const [fiberRef] of missingLocals.entries()) {
    patch9 = combine7({
      _tag: OP_REMOVE,
      fiberRef
    })(patch9);
  }
  return patch9;
};
var combine7 = /* @__PURE__ */ dual(2, (self, that) => ({
  _tag: OP_AND_THEN,
  first: self,
  second: that
}));
var patch6 = /* @__PURE__ */ dual(3, (self, fiberId3, oldValue) => {
  let fiberRefs3 = oldValue;
  let patches = of(self);
  while (isNonEmptyReadonlyArray(patches)) {
    const head5 = headNonEmpty(patches);
    const tail = tailNonEmpty(patches);
    switch (head5._tag) {
      case OP_EMPTY2: {
        patches = tail;
        break;
      }
      case OP_ADD: {
        fiberRefs3 = updateAs(fiberRefs3, {
          fiberId: fiberId3,
          fiberRef: head5.fiberRef,
          value: head5.value
        });
        patches = tail;
        break;
      }
      case OP_REMOVE: {
        fiberRefs3 = delete_(fiberRefs3, head5.fiberRef);
        patches = tail;
        break;
      }
      case OP_UPDATE: {
        const value = getOrDefault(fiberRefs3, head5.fiberRef);
        fiberRefs3 = updateAs(fiberRefs3, {
          fiberId: fiberId3,
          fiberRef: head5.fiberRef,
          value: head5.fiberRef.patch(head5.patch)(value)
        });
        patches = tail;
        break;
      }
      case OP_AND_THEN: {
        patches = prepend(head5.first)(prepend(head5.second)(tail));
        break;
      }
    }
  }
  return fiberRefs3;
});

// node_modules/effect/dist/esm/internal/metric/label.js
var MetricLabelSymbolKey = "effect/MetricLabel";
var MetricLabelTypeId = /* @__PURE__ */ Symbol.for(MetricLabelSymbolKey);
var MetricLabelImpl = class {
  key;
  value;
  [MetricLabelTypeId] = MetricLabelTypeId;
  _hash;
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this._hash = string(MetricLabelSymbolKey + this.key + this.value);
  }
  [symbol]() {
    return this._hash;
  }
  [symbol2](that) {
    return isMetricLabel(that) && this.key === that.key && this.value === that.value;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make28 = (key, value) => {
  return new MetricLabelImpl(key, value);
};
var isMetricLabel = (u) => hasProperty(u, MetricLabelTypeId);

// node_modules/effect/dist/esm/internal/core-effect.js
var annotateLogs = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), function() {
  const args2 = arguments;
  return fiberRefLocallyWith(args2[0], currentLogAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations));
});
var asSome = (self) => map8(self, some2);
var asSomeError = (self) => mapError(self, some2);
var try_ = (arg) => {
  let evaluate2;
  let onFailure = void 0;
  if (typeof arg === "function") {
    evaluate2 = arg;
  } else {
    evaluate2 = arg.try;
    onFailure = arg.catch;
  }
  return suspend(() => {
    try {
      return succeed(internalCall(evaluate2));
    } catch (error) {
      return fail2(onFailure ? internalCall(() => onFailure(error)) : new UnknownException(error, "An unknown error occurred in Effect.try"));
    }
  });
};
var _catch = /* @__PURE__ */ dual(3, (self, tag, options) => catchAll(self, (e) => {
  if (hasProperty(e, tag) && e[tag] === options.failure) {
    return options.onFailure(e);
  }
  return fail2(e);
}));
var catchAllDefect = /* @__PURE__ */ dual(2, (self, f) => catchAllCause(self, (cause3) => {
  const option3 = find(cause3, (_) => isDieType(_) ? some2(_) : none2());
  switch (option3._tag) {
    case "None": {
      return failCause(cause3);
    }
    case "Some": {
      return f(option3.value.defect);
    }
  }
}));
var catchSomeCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
  onFailure: (cause3) => {
    const option3 = f(cause3);
    switch (option3._tag) {
      case "None": {
        return failCause(cause3);
      }
      case "Some": {
        return option3.value;
      }
    }
  },
  onSuccess: succeed
}));
var catchSomeDefect = /* @__PURE__ */ dual(2, (self, pf) => catchAllCause(self, (cause3) => {
  const option3 = find(cause3, (_) => isDieType(_) ? some2(_) : none2());
  switch (option3._tag) {
    case "None": {
      return failCause(cause3);
    }
    case "Some": {
      const optionEffect = pf(option3.value.defect);
      return optionEffect._tag === "Some" ? optionEffect.value : failCause(cause3);
    }
  }
}));
var catchTag = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, ...args2) => {
  const f = args2[args2.length - 1];
  let predicate;
  if (args2.length === 2) {
    predicate = isTagged(args2[0]);
  } else {
    predicate = (e) => {
      const tag = hasProperty(e, "_tag") ? e["_tag"] : void 0;
      if (!tag) return false;
      for (let i = 0; i < args2.length - 1; i++) {
        if (args2[i] === tag) return true;
      }
      return false;
    };
  }
  return catchIf(self, predicate, f);
});
var catchTags = /* @__PURE__ */ dual(2, (self, cases) => {
  let keys5;
  return catchIf(self, (e) => {
    keys5 ??= Object.keys(cases);
    return hasProperty(e, "_tag") && isString(e["_tag"]) && keys5.includes(e["_tag"]);
  }, (e) => cases[e["_tag"]](e));
});
var cause = (self) => matchCause(self, {
  onFailure: identity,
  onSuccess: () => empty16
});
var clockWith3 = clockWith2;
var clock = /* @__PURE__ */ clockWith3(succeed);
var delay = /* @__PURE__ */ dual(2, (self, duration) => zipRight(sleep2(duration), self));
var descriptorWith = (f) => withFiberRuntime((state, status) => f({
  id: state.id(),
  status,
  interruptors: interruptors(state.getFiberRef(currentInterruptedCause))
}));
var allowInterrupt = /* @__PURE__ */ descriptorWith((descriptor3) => size3(descriptor3.interruptors) > 0 ? interrupt2 : void_);
var descriptor = /* @__PURE__ */ descriptorWith(succeed);
var diffFiberRefs = (self) => summarized(self, fiberRefs2, diff5);
var diffFiberRefsAndRuntimeFlags = (self) => summarized(self, zip2(fiberRefs2, runtimeFlags), ([refs, flags], [refsNew, flagsNew]) => [diff5(refs, refsNew), diff4(flags, flagsNew)]);
var Do = /* @__PURE__ */ succeed({});
var bind2 = /* @__PURE__ */ bind(map8, flatMap7);
var bindTo2 = /* @__PURE__ */ bindTo(map8);
var let_2 = /* @__PURE__ */ let_(map8);
var dropUntil = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
  const iterator = elements[Symbol.iterator]();
  const builder = [];
  let next;
  let dropping = succeed(false);
  let i = 0;
  while ((next = iterator.next()) && !next.done) {
    const a = next.value;
    const index = i++;
    dropping = flatMap7(dropping, (bool) => {
      if (bool) {
        builder.push(a);
        return succeed(true);
      }
      return predicate(a, index);
    });
  }
  return map8(dropping, () => builder);
}));
var dropWhile = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
  const iterator = elements[Symbol.iterator]();
  const builder = [];
  let next;
  let dropping = succeed(true);
  let i = 0;
  while ((next = iterator.next()) && !next.done) {
    const a = next.value;
    const index = i++;
    dropping = flatMap7(dropping, (d) => map8(d ? predicate(a, index) : succeed(false), (b) => {
      if (!b) {
        builder.push(a);
      }
      return b;
    }));
  }
  return map8(dropping, () => builder);
}));
var contextWith = (f) => map8(context(), f);
var eventually = (self) => orElse(self, () => flatMap7(yieldNow(), () => eventually(self)));
var filterMap3 = /* @__PURE__ */ dual(2, (elements, pf) => map8(forEachSequential(elements, identity), filterMap(pf)));
var filterOrDie = /* @__PURE__ */ dual(3, (self, predicate, orDieWith3) => filterOrElse(self, predicate, (a) => dieSync(() => orDieWith3(a))));
var filterOrDieMessage = /* @__PURE__ */ dual(3, (self, predicate, message) => filterOrElse(self, predicate, () => dieMessage(message)));
var filterOrElse = /* @__PURE__ */ dual(3, (self, predicate, orElse3) => flatMap7(self, (a) => predicate(a) ? succeed(a) : orElse3(a)));
var liftPredicate = /* @__PURE__ */ dual(3, (self, predicate, orFailWith) => suspend(() => predicate(self) ? succeed(self) : fail2(orFailWith(self))));
var filterOrFail = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, predicate, orFailWith) => filterOrElse(self, predicate, (a) => orFailWith === void 0 ? fail2(new NoSuchElementException()) : failSync(() => orFailWith(a))));
var findFirst3 = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
  const iterator = elements[Symbol.iterator]();
  const next = iterator.next();
  if (!next.done) {
    return findLoop(iterator, 0, predicate, next.value);
  }
  return succeed(none2());
}));
var findLoop = (iterator, index, f, value) => flatMap7(f(value, index), (result) => {
  if (result) {
    return succeed(some2(value));
  }
  const next = iterator.next();
  if (!next.done) {
    return findLoop(iterator, index + 1, f, next.value);
  }
  return succeed(none2());
});
var firstSuccessOf = (effects) => suspend(() => {
  const list = fromIterable2(effects);
  if (!isNonEmpty(list)) {
    return dieSync(() => new IllegalArgumentException(`Received an empty collection of effects`));
  }
  return pipe(tailNonEmpty2(list), reduce(headNonEmpty2(list), (left3, right3) => orElse(left3, () => right3)));
});
var flipWith = /* @__PURE__ */ dual(2, (self, f) => flip(f(flip(self))));
var match7 = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
  onFailure: (e) => succeed(options.onFailure(e)),
  onSuccess: (a) => succeed(options.onSuccess(a))
}));
var every4 = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => forAllLoop(elements[Symbol.iterator](), 0, predicate)));
var forAllLoop = (iterator, index, f) => {
  const next = iterator.next();
  return next.done ? succeed(true) : flatMap7(f(next.value, index), (b) => b ? forAllLoop(iterator, index + 1, f) : succeed(b));
};
var forever = (self) => {
  const loop3 = flatMap7(flatMap7(self, () => yieldNow()), () => loop3);
  return loop3;
};
var fiberRefs2 = /* @__PURE__ */ withFiberRuntime((state) => succeed(state.getFiberRefs()));
var head3 = (self) => flatMap7(self, (as7) => {
  const iterator = as7[Symbol.iterator]();
  const next = iterator.next();
  if (next.done) {
    return fail2(new NoSuchElementException());
  }
  return succeed(next.value);
});
var ignore = (self) => match7(self, {
  onFailure: constVoid,
  onSuccess: constVoid
});
var ignoreLogged = (self) => matchCauseEffect(self, {
  onFailure: (cause3) => logDebug(cause3, "An error was silently ignored because it is not anticipated to be useful"),
  onSuccess: () => void_
});
var inheritFiberRefs = (childFiberRefs) => updateFiberRefs((parentFiberId, parentFiberRefs) => joinAs2(parentFiberRefs, parentFiberId, childFiberRefs));
var isFailure3 = (self) => match7(self, {
  onFailure: constTrue,
  onSuccess: constFalse
});
var isSuccess2 = (self) => match7(self, {
  onFailure: constFalse,
  onSuccess: constTrue
});
var iterate = (initial, options) => suspend(() => {
  if (options.while(initial)) {
    return flatMap7(options.body(initial), (z2) => iterate(z2, options));
  }
  return succeed(initial);
});
var logWithLevel = (level) => (...message) => {
  const levelOption = fromNullable(level);
  let cause3 = void 0;
  for (let i = 0, len = message.length; i < len; i++) {
    const msg = message[i];
    if (isCause(msg)) {
      if (cause3 !== void 0) {
        cause3 = sequential(cause3, msg);
      } else {
        cause3 = msg;
      }
      message = [...message.slice(0, i), ...message.slice(i + 1)];
      i--;
    }
  }
  if (cause3 === void 0) {
    cause3 = empty16;
  }
  return withFiberRuntime((fiberState) => {
    fiberState.log(message, cause3, levelOption);
    return void_;
  });
};
var log = /* @__PURE__ */ logWithLevel();
var logTrace = /* @__PURE__ */ logWithLevel(Trace);
var logDebug = /* @__PURE__ */ logWithLevel(Debug);
var logInfo = /* @__PURE__ */ logWithLevel(Info);
var logWarning = /* @__PURE__ */ logWithLevel(Warning);
var logError = /* @__PURE__ */ logWithLevel(Error2);
var logFatal = /* @__PURE__ */ logWithLevel(Fatal);
var withLogSpan = /* @__PURE__ */ dual(2, (effect, label) => flatMap7(currentTimeMillis2, (now) => fiberRefLocallyWith(effect, currentLogSpan, prepend3(make25(label, now)))));
var logAnnotations = /* @__PURE__ */ fiberRefGet(currentLogAnnotations);
var loop = (initial, options) => options.discard ? loopDiscard(initial, options.while, options.step, options.body) : map8(loopInternal(initial, options.while, options.step, options.body), fromIterable);
var loopInternal = (initial, cont, inc, body) => suspend(() => cont(initial) ? flatMap7(body(initial), (a) => map8(loopInternal(inc(initial), cont, inc, body), prepend3(a))) : sync(() => empty9()));
var loopDiscard = (initial, cont, inc, body) => suspend(() => cont(initial) ? flatMap7(body(initial), () => loopDiscard(inc(initial), cont, inc, body)) : void_);
var mapAccum2 = /* @__PURE__ */ dual(3, (elements, initial, f) => suspend(() => {
  const iterator = elements[Symbol.iterator]();
  const builder = [];
  let result = succeed(initial);
  let next;
  let i = 0;
  while (!(next = iterator.next()).done) {
    const index = i++;
    const value = next.value;
    result = flatMap7(result, (state) => map8(f(state, value, index), ([z, b]) => {
      builder.push(b);
      return z;
    }));
  }
  return map8(result, (z) => [z, builder]);
}));
var mapErrorCause2 = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
  onFailure: (c) => failCauseSync(() => f(c)),
  onSuccess: succeed
}));
var memoize = (self) => pipe(deferredMake(), flatMap7((deferred) => pipe(diffFiberRefsAndRuntimeFlags(self), intoDeferred(deferred), once, map8((complete3) => zipRight(complete3, pipe(deferredAwait(deferred), flatMap7(([patch9, a]) => as2(zip2(patchFiberRefs(patch9[0]), updateRuntimeFlags(patch9[1])), a))))))));
var merge5 = (self) => matchEffect(self, {
  onFailure: (e) => succeed(e),
  onSuccess: succeed
});
var negate = (self) => map8(self, (b) => !b);
var none6 = (self) => flatMap7(self, (option3) => {
  switch (option3._tag) {
    case "None":
      return void_;
    case "Some":
      return fail2(new NoSuchElementException());
  }
});
var once = (self) => map8(make27(true), (ref) => asVoid(whenEffect(self, getAndSet2(ref, false))));
var option = (self) => matchEffect(self, {
  onFailure: () => succeed(none2()),
  onSuccess: (a) => succeed(some2(a))
});
var orElseFail = /* @__PURE__ */ dual(2, (self, evaluate2) => orElse(self, () => failSync(evaluate2)));
var orElseSucceed = /* @__PURE__ */ dual(2, (self, evaluate2) => orElse(self, () => sync(evaluate2)));
var parallelErrors = (self) => matchCauseEffect(self, {
  onFailure: (cause3) => {
    const errors = fromIterable(failures(cause3));
    return errors.length === 0 ? failCause(cause3) : fail2(errors);
  },
  onSuccess: succeed
});
var patchFiberRefs = (patch9) => updateFiberRefs((fiberId3, fiberRefs3) => pipe(patch9, patch6(fiberId3, fiberRefs3)));
var promise = (evaluate2) => evaluate2.length >= 1 ? async_((resolve3, signal) => {
  try {
    evaluate2(signal).then((a) => resolve3(succeed(a)), (e) => resolve3(die2(e)));
  } catch (e) {
    resolve3(die2(e));
  }
}) : async_((resolve3) => {
  try {
    ;
    evaluate2().then((a) => resolve3(succeed(a)), (e) => resolve3(die2(e)));
  } catch (e) {
    resolve3(die2(e));
  }
});
var provideService = /* @__PURE__ */ dual(3, (self, tag, service) => contextWithEffect((env) => provideContext(self, add2(env, tag, service))));
var provideServiceEffect = /* @__PURE__ */ dual(3, (self, tag, effect) => contextWithEffect((env) => flatMap7(effect, (service) => provideContext(self, pipe(env, add2(tag, service))))));
var random2 = /* @__PURE__ */ randomWith(succeed);
var reduce8 = /* @__PURE__ */ dual(3, (elements, zero2, f) => fromIterable(elements).reduce((acc, el, i) => flatMap7(acc, (a) => f(a, el, i)), succeed(zero2)));
var reduceRight2 = /* @__PURE__ */ dual(3, (elements, zero2, f) => fromIterable(elements).reduceRight((acc, el, i) => flatMap7(acc, (a) => f(el, a, i)), succeed(zero2)));
var reduceWhile = /* @__PURE__ */ dual(3, (elements, zero2, options) => flatMap7(sync(() => elements[Symbol.iterator]()), (iterator) => reduceWhileLoop(iterator, 0, zero2, options.while, options.body)));
var reduceWhileLoop = (iterator, index, state, predicate, f) => {
  const next = iterator.next();
  if (!next.done && predicate(state)) {
    return flatMap7(f(state, next.value, index), (nextState) => reduceWhileLoop(iterator, index + 1, nextState, predicate, f));
  }
  return succeed(state);
};
var repeatN = /* @__PURE__ */ dual(2, (self, n) => suspend(() => repeatNLoop(self, n)));
var repeatNLoop = (self, n) => flatMap7(self, (a) => n <= 0 ? succeed(a) : zipRight(yieldNow(), repeatNLoop(self, n - 1)));
var sandbox = (self) => matchCauseEffect(self, {
  onFailure: fail2,
  onSuccess: succeed
});
var setFiberRefs = (fiberRefs3) => suspend(() => setAll2(fiberRefs3));
var sleep3 = sleep2;
var succeedNone = /* @__PURE__ */ succeed(/* @__PURE__ */ none2());
var succeedSome = (value) => succeed(some2(value));
var summarized = /* @__PURE__ */ dual(3, (self, summary5, f) => flatMap7(summary5, (start3) => flatMap7(self, (value) => map8(summary5, (end3) => [f(start3, end3), value]))));
var tagMetrics = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), function() {
  return labelMetrics(arguments[0], typeof arguments[1] === "string" ? [make28(arguments[1], arguments[2])] : Object.entries(arguments[1]).map(([k, v]) => make28(k, v)));
});
var labelMetrics = /* @__PURE__ */ dual(2, (self, labels) => fiberRefLocallyWith(self, currentMetricLabels, (old) => union(old, labels)));
var takeUntil = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
  const iterator = elements[Symbol.iterator]();
  const builder = [];
  let next;
  let effect = succeed(false);
  let i = 0;
  while ((next = iterator.next()) && !next.done) {
    const a = next.value;
    const index = i++;
    effect = flatMap7(effect, (bool) => {
      if (bool) {
        return succeed(true);
      }
      builder.push(a);
      return predicate(a, index);
    });
  }
  return map8(effect, () => builder);
}));
var takeWhile = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
  const iterator = elements[Symbol.iterator]();
  const builder = [];
  let next;
  let taking = succeed(true);
  let i = 0;
  while ((next = iterator.next()) && !next.done) {
    const a = next.value;
    const index = i++;
    taking = flatMap7(taking, (taking2) => pipe(taking2 ? predicate(a, index) : succeed(false), map8((bool) => {
      if (bool) {
        builder.push(a);
      }
      return bool;
    })));
  }
  return map8(taking, () => builder);
}));
var tapBoth = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => matchCauseEffect(self, {
  onFailure: (cause3) => {
    const either4 = failureOrCause(cause3);
    switch (either4._tag) {
      case "Left": {
        return zipRight(onFailure(either4.left), failCause(cause3));
      }
      case "Right": {
        return failCause(cause3);
      }
    }
  },
  onSuccess: (a) => as2(onSuccess(a), a)
}));
var tapDefect = /* @__PURE__ */ dual(2, (self, f) => catchAllCause(self, (cause3) => match2(keepDefects(cause3), {
  onNone: () => failCause(cause3),
  onSome: (a) => zipRight(f(a), failCause(cause3))
})));
var tapError = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
  onFailure: (cause3) => {
    const either4 = failureOrCause(cause3);
    switch (either4._tag) {
      case "Left":
        return zipRight(f(either4.left), failCause(cause3));
      case "Right":
        return failCause(cause3);
    }
  },
  onSuccess: succeed
}));
var tapErrorTag = /* @__PURE__ */ dual(3, (self, k, f) => tapError(self, (e) => {
  if (isTagged(e, k)) {
    return f(e);
  }
  return void_;
}));
var tapErrorCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
  onFailure: (cause3) => zipRight(f(cause3), failCause(cause3)),
  onSuccess: succeed
}));
var timed = (self) => timedWith(self, currentTimeNanos2);
var timedWith = /* @__PURE__ */ dual(2, (self, nanos2) => summarized(self, nanos2, (start3, end3) => nanos(end3 - start3)));
var tracerWith3 = tracerWith2;
var tracer = /* @__PURE__ */ tracerWith3(succeed);
var tryPromise = (arg) => {
  let evaluate2;
  let catcher = void 0;
  if (typeof arg === "function") {
    evaluate2 = arg;
  } else {
    evaluate2 = arg.try;
    catcher = arg.catch;
  }
  const fail7 = (e) => catcher ? failSync(() => catcher(e)) : fail2(new UnknownException(e, "An unknown error occurred in Effect.tryPromise"));
  if (evaluate2.length >= 1) {
    return async_((resolve3, signal) => {
      try {
        evaluate2(signal).then((a) => resolve3(succeed(a)), (e) => resolve3(fail7(e)));
      } catch (e) {
        resolve3(fail7(e));
      }
    });
  }
  return async_((resolve3) => {
    try {
      evaluate2().then((a) => resolve3(succeed(a)), (e) => resolve3(fail7(e)));
    } catch (e) {
      resolve3(fail7(e));
    }
  });
};
var tryMap = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => try_({
  try: () => options.try(a),
  catch: options.catch
})));
var tryMapPromise = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => tryPromise({
  try: options.try.length >= 1 ? (signal) => options.try(a, signal) : () => options.try(a),
  catch: options.catch
})));
var unless = /* @__PURE__ */ dual(2, (self, condition) => suspend(() => condition() ? succeedNone : asSome(self)));
var unlessEffect = /* @__PURE__ */ dual(2, (self, condition) => flatMap7(condition, (b) => b ? succeedNone : asSome(self)));
var unsandbox = (self) => mapErrorCause2(self, flatten3);
var updateFiberRefs = (f) => withFiberRuntime((state) => {
  state.setFiberRefs(f(state.id(), state.getFiberRefs()));
  return void_;
});
var updateService = /* @__PURE__ */ dual(3, (self, tag, f) => mapInputContext(self, (context4) => add2(context4, tag, f(unsafeGet3(context4, tag)))));
var when = /* @__PURE__ */ dual(2, (self, condition) => suspend(() => condition() ? map8(self, some2) : succeed(none2())));
var whenFiberRef = /* @__PURE__ */ dual(3, (self, fiberRef, predicate) => flatMap7(fiberRefGet(fiberRef), (s) => predicate(s) ? map8(self, (a) => [s, some2(a)]) : succeed([s, none2()])));
var whenRef = /* @__PURE__ */ dual(3, (self, ref, predicate) => flatMap7(get12(ref), (s) => predicate(s) ? map8(self, (a) => [s, some2(a)]) : succeed([s, none2()])));
var withMetric = /* @__PURE__ */ dual(2, (self, metric) => metric(self));
var serviceFunctionEffect = (getService, f) => (...args2) => flatMap7(getService, (a) => f(a)(...args2));
var serviceFunction = (getService, f) => (...args2) => map8(getService, (a) => f(a)(...args2));
var serviceFunctions = (getService) => new Proxy({}, {
  get(_target, prop, _receiver) {
    return (...args2) => flatMap7(getService, (s) => s[prop](...args2));
  }
});
var serviceConstants = (getService) => new Proxy({}, {
  get(_target, prop, _receiver) {
    return flatMap7(getService, (s) => isEffect(s[prop]) ? s[prop] : succeed(s[prop]));
  }
});
var serviceMembers = (getService) => ({
  functions: serviceFunctions(getService),
  constants: serviceConstants(getService)
});
var serviceOption = (tag) => map8(context(), getOption2(tag));
var serviceOptional = (tag) => flatMap7(context(), getOption2(tag));
var annotateCurrentSpan = function() {
  const args2 = arguments;
  return ignore(flatMap7(currentPropagatedSpan, (span2) => sync(() => {
    if (typeof args2[0] === "string") {
      span2.attribute(args2[0], args2[1]);
    } else {
      for (const key in args2[0]) {
        span2.attribute(key, args2[0][key]);
      }
    }
  })));
};
var linkSpanCurrent = function() {
  const args2 = arguments;
  const links = Array.isArray(args2[0]) ? args2[0] : [{
    _tag: "SpanLink",
    span: args2[0],
    attributes: args2[1] ?? {}
  }];
  return ignore(flatMap7(currentSpan, (span2) => sync(() => span2.addLinks(links))));
};
var annotateSpans = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), function() {
  const args2 = arguments;
  return fiberRefLocallyWith(args2[0], currentTracerSpanAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations));
});
var currentParentSpan = /* @__PURE__ */ serviceOptional(spanTag);
var currentSpan = /* @__PURE__ */ flatMap7(/* @__PURE__ */ context(), (context4) => {
  const span2 = context4.unsafeMap.get(spanTag.key);
  return span2 !== void 0 && span2._tag === "Span" ? succeed(span2) : fail2(new NoSuchElementException());
});
var currentPropagatedSpan = /* @__PURE__ */ flatMap7(/* @__PURE__ */ context(), (context4) => {
  const span2 = filterDisablePropagation(getOption2(context4, spanTag));
  return span2._tag === "Some" && span2.value._tag === "Span" ? succeed(span2.value) : fail2(new NoSuchElementException());
});
var linkSpans = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, span2, attributes) => fiberRefLocallyWith(self, currentTracerSpanLinks, append2({
  _tag: "SpanLink",
  span: span2,
  attributes: attributes ?? {}
})));
var bigint02 = /* @__PURE__ */ BigInt(0);
var filterDisablePropagation = /* @__PURE__ */ flatMap((span2) => get3(span2.context, DisablePropagation) ? span2._tag === "Span" ? filterDisablePropagation(span2.parent) : none2() : some2(span2));
var unsafeMakeSpan = (fiber, name, options) => {
  const disablePropagation = !fiber.getFiberRef(currentTracerEnabled) || options.context && get3(options.context, DisablePropagation);
  const context4 = fiber.getFiberRef(currentContext);
  const parent = options.parent ? some2(options.parent) : options.root ? none2() : filterDisablePropagation(getOption2(context4, spanTag));
  let span2;
  if (disablePropagation) {
    span2 = noopSpan({
      name,
      parent,
      context: add2(options.context ?? empty3(), DisablePropagation, true)
    });
  } else {
    const services = fiber.getFiberRef(currentServices);
    const tracer3 = get3(services, tracerTag);
    const clock3 = get3(services, Clock);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const fiberRefs3 = fiber.getFiberRefs();
    const annotationsFromEnv = get10(fiberRefs3, currentTracerSpanAnnotations);
    const linksFromEnv = get10(fiberRefs3, currentTracerSpanLinks);
    const links = linksFromEnv._tag === "Some" ? options.links !== void 0 ? [...toReadonlyArray(linksFromEnv.value), ...options.links ?? []] : toReadonlyArray(linksFromEnv.value) : options.links ?? empty();
    span2 = tracer3.span(name, parent, options.context ?? empty3(), links, timingEnabled ? clock3.unsafeCurrentTimeNanos() : bigint02, options.kind ?? "internal", options);
    if (annotationsFromEnv._tag === "Some") {
      forEach3(annotationsFromEnv.value, (value, key) => span2.attribute(key, value));
    }
    if (options.attributes !== void 0) {
      Object.entries(options.attributes).forEach(([k, v]) => span2.attribute(k, v));
    }
  }
  if (typeof options.captureStackTrace === "function") {
    spanToTrace.set(span2, options.captureStackTrace);
  }
  return span2;
};
var makeSpan = (name, options) => {
  options = addSpanStackTrace(options);
  return withFiberRuntime((fiber) => succeed(unsafeMakeSpan(fiber, name, options)));
};
var spanAnnotations = /* @__PURE__ */ fiberRefGet(currentTracerSpanAnnotations);
var spanLinks = /* @__PURE__ */ fiberRefGet(currentTracerSpanLinks);
var endSpan = (span2, exit4, clock3, timingEnabled) => sync(() => {
  if (span2.status._tag === "Ended") {
    return;
  }
  if (exitIsFailure(exit4) && spanToTrace.has(span2)) {
    span2.attribute("code.stacktrace", spanToTrace.get(span2)());
  }
  span2.end(timingEnabled ? clock3.unsafeCurrentTimeNanos() : bigint02, exit4);
});
var useSpan = (name, ...args2) => {
  const options = addSpanStackTrace(args2.length === 1 ? void 0 : args2[0]);
  const evaluate2 = args2[args2.length - 1];
  return withFiberRuntime((fiber) => {
    const span2 = unsafeMakeSpan(fiber, name, options);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const clock3 = get3(fiber.getFiberRef(currentServices), clockTag);
    return onExit(evaluate2(span2), (exit4) => endSpan(span2, exit4, clock3, timingEnabled));
  });
};
var withParentSpan = /* @__PURE__ */ dual(2, (self, span2) => provideService(self, spanTag, span2));
var withSpan = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return useSpan(name, options, (span2) => withParentSpan(self, span2));
  }
  return (self) => useSpan(name, options, (span2) => withParentSpan(self, span2));
};
var functionWithSpan = (options) => function() {
  let captureStackTrace = options.captureStackTrace ?? false;
  if (options.captureStackTrace !== false) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const error = new Error();
    Error.stackTraceLimit = limit;
    let cache = false;
    captureStackTrace = () => {
      if (cache !== false) {
        return cache;
      }
      if (error.stack) {
        const stack = error.stack.trim().split("\n");
        cache = stack.slice(2).join("\n").trim();
        return cache;
      }
    };
  }
  return suspend(() => {
    const opts = typeof options.options === "function" ? options.options.apply(null, arguments) : options.options;
    return withSpan(suspend(() => internalCall(() => options.body.apply(this, arguments))), opts.name, {
      ...opts,
      captureStackTrace
    });
  });
};
var fromNullable2 = (value) => value == null ? fail2(new NoSuchElementException()) : succeed(value);
var optionFromOptional = (self) => catchAll(map8(self, some2), (error) => isNoSuchElementException(error) ? succeedNone : fail2(error));

// node_modules/effect/dist/esm/internal/executionStrategy.js
var OP_SEQUENTIAL2 = "Sequential";
var OP_PARALLEL2 = "Parallel";
var OP_PARALLEL_N = "ParallelN";
var sequential2 = {
  _tag: OP_SEQUENTIAL2
};
var parallel2 = {
  _tag: OP_PARALLEL2
};
var parallelN = (parallelism) => ({
  _tag: OP_PARALLEL_N,
  parallelism
});
var isSequential = (self) => self._tag === OP_SEQUENTIAL2;
var isParallel = (self) => self._tag === OP_PARALLEL2;

// node_modules/effect/dist/esm/ExecutionStrategy.js
var sequential3 = sequential2;
var parallel3 = parallel2;
var parallelN2 = parallelN;

// node_modules/effect/dist/esm/FiberRefsPatch.js
var diff6 = diff5;
var patch7 = patch6;

// node_modules/effect/dist/esm/internal/fiberStatus.js
var FiberStatusSymbolKey = "effect/FiberStatus";
var FiberStatusTypeId = /* @__PURE__ */ Symbol.for(FiberStatusSymbolKey);
var OP_DONE = "Done";
var OP_RUNNING = "Running";
var OP_SUSPENDED = "Suspended";
var DoneHash = /* @__PURE__ */ string(`${FiberStatusSymbolKey}-${OP_DONE}`);
var Done = class {
  [FiberStatusTypeId] = FiberStatusTypeId;
  _tag = OP_DONE;
  [symbol]() {
    return DoneHash;
  }
  [symbol2](that) {
    return isFiberStatus(that) && that._tag === OP_DONE;
  }
};
var Running = class {
  runtimeFlags;
  [FiberStatusTypeId] = FiberStatusTypeId;
  _tag = OP_RUNNING;
  constructor(runtimeFlags2) {
    this.runtimeFlags = runtimeFlags2;
  }
  [symbol]() {
    return pipe(hash(FiberStatusSymbolKey), combine(hash(this._tag)), combine(hash(this.runtimeFlags)), cached(this));
  }
  [symbol2](that) {
    return isFiberStatus(that) && that._tag === OP_RUNNING && this.runtimeFlags === that.runtimeFlags;
  }
};
var Suspended = class {
  runtimeFlags;
  blockingOn;
  [FiberStatusTypeId] = FiberStatusTypeId;
  _tag = OP_SUSPENDED;
  constructor(runtimeFlags2, blockingOn) {
    this.runtimeFlags = runtimeFlags2;
    this.blockingOn = blockingOn;
  }
  [symbol]() {
    return pipe(hash(FiberStatusSymbolKey), combine(hash(this._tag)), combine(hash(this.runtimeFlags)), combine(hash(this.blockingOn)), cached(this));
  }
  [symbol2](that) {
    return isFiberStatus(that) && that._tag === OP_SUSPENDED && this.runtimeFlags === that.runtimeFlags && equals(this.blockingOn, that.blockingOn);
  }
};
var done3 = /* @__PURE__ */ new Done();
var running = (runtimeFlags2) => new Running(runtimeFlags2);
var suspended = (runtimeFlags2, blockingOn) => new Suspended(runtimeFlags2, blockingOn);
var isFiberStatus = (u) => hasProperty(u, FiberStatusTypeId);
var isDone = (self) => self._tag === OP_DONE;

// node_modules/effect/dist/esm/FiberStatus.js
var done4 = done3;
var running2 = running;
var suspended2 = suspended;
var isDone2 = isDone;

// node_modules/effect/dist/esm/Micro.js
var TypeId13 = /* @__PURE__ */ Symbol.for("effect/Micro");
var MicroExitTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroExit");
var MicroCauseTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroCause");
var microCauseVariance = {
  _E: identity
};
var MicroCauseImpl = class extends globalThis.Error {
  _tag;
  traces;
  [MicroCauseTypeId];
  constructor(_tag, originalError2, traces) {
    const causeName = `MicroCause.${_tag}`;
    let name;
    let message;
    let stack;
    if (originalError2 instanceof globalThis.Error) {
      name = `(${causeName}) ${originalError2.name}`;
      message = originalError2.message;
      const messageLines = message.split("\n").length;
      stack = originalError2.stack ? `(${causeName}) ${originalError2.stack.split("\n").slice(0, messageLines + 3).join("\n")}` : `${name}: ${message}`;
    } else {
      name = causeName;
      message = toStringUnknown(originalError2, 0);
      stack = `${name}: ${message}`;
    }
    if (traces.length > 0) {
      stack += `
    ${traces.join("\n    ")}`;
    }
    super(message);
    this._tag = _tag;
    this.traces = traces;
    this[MicroCauseTypeId] = microCauseVariance;
    this.name = name;
    this.stack = stack;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toString() {
    return this.stack;
  }
  [NodeInspectSymbol]() {
    return this.stack;
  }
};
var Die = class extends MicroCauseImpl {
  defect;
  constructor(defect, traces = []) {
    super("Die", defect, traces);
    this.defect = defect;
  }
};
var causeDie = (defect, traces = []) => new Die(defect, traces);
var Interrupt = class extends MicroCauseImpl {
  constructor(traces = []) {
    super("Interrupt", "interrupted", traces);
  }
};
var causeInterrupt = (traces = []) => new Interrupt(traces);
var causeIsInterrupt = (self) => self._tag === "Interrupt";
var MicroFiberTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroFiber");
var fiberVariance = {
  _A: identity,
  _E: identity
};
var MicroFiberImpl = class {
  context;
  interruptible;
  [MicroFiberTypeId];
  _stack = [];
  _observers = [];
  _exit;
  _children;
  currentOpCount = 0;
  constructor(context4, interruptible5 = true) {
    this.context = context4;
    this.interruptible = interruptible5;
    this[MicroFiberTypeId] = fiberVariance;
  }
  getRef(ref) {
    return unsafeGetReference(this.context, ref);
  }
  addObserver(cb) {
    if (this._exit) {
      cb(this._exit);
      return constVoid;
    }
    this._observers.push(cb);
    return () => {
      const index = this._observers.indexOf(cb);
      if (index >= 0) {
        this._observers.splice(index, 1);
      }
    };
  }
  _interrupted = false;
  unsafeInterrupt() {
    if (this._exit) {
      return;
    }
    this._interrupted = true;
    if (this.interruptible) {
      this.evaluate(exitInterrupt2);
    }
  }
  unsafePoll() {
    return this._exit;
  }
  evaluate(effect) {
    if (this._exit) {
      return;
    } else if (this._yielded !== void 0) {
      const yielded = this._yielded;
      this._yielded = void 0;
      yielded();
    }
    const exit4 = this.runLoop(effect);
    if (exit4 === Yield) {
      return;
    }
    const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
    if (interruptChildren !== void 0) {
      return this.evaluate(flatMap9(interruptChildren, () => exit4));
    }
    this._exit = exit4;
    for (let i = 0; i < this._observers.length; i++) {
      this._observers[i](exit4);
    }
    this._observers.length = 0;
  }
  runLoop(effect) {
    let yielding = false;
    let current = effect;
    this.currentOpCount = 0;
    try {
      while (true) {
        this.currentOpCount++;
        if (!yielding && this.getRef(CurrentScheduler).shouldYield(this)) {
          yielding = true;
          const prev = current;
          current = flatMap9(yieldNow2, () => prev);
        }
        current = current[evaluate](this);
        if (current === Yield) {
          const yielded = this._yielded;
          if (MicroExitTypeId in yielded) {
            this._yielded = void 0;
            return yielded;
          }
          return Yield;
        }
      }
    } catch (error) {
      if (!hasProperty(current, evaluate)) {
        return exitDie2(`MicroFiber.runLoop: Not a valid effect: ${String(current)}`);
      }
      return exitDie2(error);
    }
  }
  getCont(symbol3) {
    while (true) {
      const op = this._stack.pop();
      if (!op) return void 0;
      const cont = op[ensureCont] && op[ensureCont](this);
      if (cont) return {
        [symbol3]: cont
      };
      if (op[symbol3]) return op;
    }
  }
  // cancel the yielded operation, or for the yielded exit value
  _yielded = void 0;
  yieldWith(value) {
    this._yielded = value;
    return Yield;
  }
  children() {
    return this._children ??= /* @__PURE__ */ new Set();
  }
};
var fiberMiddleware = /* @__PURE__ */ globalValue("effect/Micro/fiberMiddleware", () => ({
  interruptChildren: void 0
}));
var fiberInterruptAll = (fibers) => suspend2(() => {
  for (const fiber of fibers) fiber.unsafeInterrupt();
  const iter = fibers[Symbol.iterator]();
  const wait = suspend2(() => {
    let result = iter.next();
    while (!result.done) {
      if (result.value.unsafePoll()) {
        result = iter.next();
        continue;
      }
      const fiber = result.value;
      return async((resume2) => {
        fiber.addObserver((_) => {
          resume2(wait);
        });
      });
    }
    return exitVoid2;
  });
  return wait;
});
var identifier = /* @__PURE__ */ Symbol.for("effect/Micro/identifier");
var args = /* @__PURE__ */ Symbol.for("effect/Micro/args");
var evaluate = /* @__PURE__ */ Symbol.for("effect/Micro/evaluate");
var successCont = /* @__PURE__ */ Symbol.for("effect/Micro/successCont");
var failureCont = /* @__PURE__ */ Symbol.for("effect/Micro/failureCont");
var ensureCont = /* @__PURE__ */ Symbol.for("effect/Micro/ensureCont");
var Yield = /* @__PURE__ */ Symbol.for("effect/Micro/Yield");
var microVariance = {
  _A: identity,
  _E: identity,
  _R: identity
};
var MicroProto = {
  ...EffectPrototype2,
  _op: "Micro",
  [TypeId13]: microVariance,
  pipe() {
    return pipeArguments(this, arguments);
  },
  [Symbol.iterator]() {
    return new SingleShotGen(new YieldWrap(this));
  },
  toJSON() {
    return {
      _id: "Micro",
      op: this[identifier],
      ...args in this ? {
        args: this[args]
      } : void 0
    };
  },
  toString() {
    return format(this);
  },
  [NodeInspectSymbol]() {
    return format(this);
  }
};
function defaultEvaluate(_fiber) {
  return exitDie2(`Micro.evaluate: Not implemented`);
}
var makePrimitiveProto = (options) => ({
  ...MicroProto,
  [identifier]: options.op,
  [evaluate]: options.eval ?? defaultEvaluate,
  [successCont]: options.contA,
  [failureCont]: options.contE,
  [ensureCont]: options.ensure
});
var makePrimitive = (options) => {
  const Proto2 = makePrimitiveProto(options);
  return function() {
    const self = Object.create(Proto2);
    self[args] = options.single === false ? arguments : arguments[0];
    return self;
  };
};
var makeExit = (options) => {
  const Proto2 = {
    ...makePrimitiveProto(options),
    [MicroExitTypeId]: MicroExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    toJSON() {
      return {
        _id: "MicroExit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isMicroExit(that) && that._tag === options.op && equals(this[args], that[args]);
    },
    [symbol]() {
      return cached(this, combine(string(options.op))(hash(this[args])));
    }
  };
  return function(value) {
    const self = Object.create(Proto2);
    self[args] = value;
    self[successCont] = void 0;
    self[failureCont] = void 0;
    self[ensureCont] = void 0;
    return self;
  };
};
var succeed3 = /* @__PURE__ */ makeExit({
  op: "Success",
  prop: "value",
  eval(fiber) {
    const cont = fiber.getCont(successCont);
    return cont ? cont[successCont](this[args], fiber) : fiber.yieldWith(this);
  }
});
var failCause3 = /* @__PURE__ */ makeExit({
  op: "Failure",
  prop: "cause",
  eval(fiber) {
    let cont = fiber.getCont(failureCont);
    while (causeIsInterrupt(this[args]) && cont && fiber.interruptible) {
      cont = fiber.getCont(failureCont);
    }
    return cont ? cont[failureCont](this[args], fiber) : fiber.yieldWith(this);
  }
});
var sync2 = /* @__PURE__ */ makePrimitive({
  op: "Sync",
  eval(fiber) {
    const value = this[args]();
    const cont = fiber.getCont(successCont);
    return cont ? cont[successCont](value, fiber) : fiber.yieldWith(exitSucceed2(value));
  }
});
var suspend2 = /* @__PURE__ */ makePrimitive({
  op: "Suspend",
  eval(_fiber) {
    return this[args]();
  }
});
var yieldNowWith = /* @__PURE__ */ makePrimitive({
  op: "Yield",
  eval(fiber) {
    let resumed = false;
    fiber.getRef(CurrentScheduler).scheduleTask(() => {
      if (resumed) return;
      fiber.evaluate(exitVoid2);
    }, this[args] ?? 0);
    return fiber.yieldWith(() => {
      resumed = true;
    });
  }
});
var yieldNow2 = /* @__PURE__ */ yieldNowWith(0);
var void_3 = /* @__PURE__ */ succeed3(void 0);
var withMicroFiber = /* @__PURE__ */ makePrimitive({
  op: "WithMicroFiber",
  eval(fiber) {
    return this[args](fiber);
  }
});
var asyncOptions = /* @__PURE__ */ makePrimitive({
  op: "Async",
  single: false,
  eval(fiber) {
    const register = this[args][0];
    let resumed = false;
    let yielded = false;
    const controller = this[args][1] ? new AbortController() : void 0;
    const onCancel = register((effect) => {
      if (resumed) return;
      resumed = true;
      if (yielded) {
        fiber.evaluate(effect);
      } else {
        yielded = effect;
      }
    }, controller?.signal);
    if (yielded !== false) return yielded;
    yielded = true;
    fiber._yielded = () => {
      resumed = true;
    };
    if (controller === void 0 && onCancel === void 0) {
      return Yield;
    }
    fiber._stack.push(asyncFinalizer(() => {
      resumed = true;
      controller?.abort();
      return onCancel ?? exitVoid2;
    }));
    return Yield;
  }
});
var asyncFinalizer = /* @__PURE__ */ makePrimitive({
  op: "AsyncFinalizer",
  ensure(fiber) {
    if (fiber.interruptible) {
      fiber.interruptible = false;
      fiber._stack.push(setInterruptible(true));
    }
  },
  contE(cause3, _fiber) {
    return causeIsInterrupt(cause3) ? flatMap9(this[args](), () => failCause3(cause3)) : failCause3(cause3);
  }
});
var async = (register) => asyncOptions(register, register.length >= 2);
var as4 = /* @__PURE__ */ dual(2, (self, value) => map10(self, (_) => value));
var exit2 = (self) => matchCause2(self, {
  onFailure: exitFailCause2,
  onSuccess: exitSucceed2
});
var flatMap9 = /* @__PURE__ */ dual(2, (self, f) => {
  const onSuccess = Object.create(OnSuccessProto);
  onSuccess[args] = self;
  onSuccess[successCont] = f;
  return onSuccess;
});
var OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccess",
  eval(fiber) {
    fiber._stack.push(this);
    return this[args];
  }
});
var map10 = /* @__PURE__ */ dual(2, (self, f) => flatMap9(self, (a) => succeed3(f(a))));
var isMicroExit = (u) => hasProperty(u, MicroExitTypeId);
var exitSucceed2 = succeed3;
var exitFailCause2 = failCause3;
var exitInterrupt2 = /* @__PURE__ */ exitFailCause2(/* @__PURE__ */ causeInterrupt());
var exitDie2 = (defect) => exitFailCause2(causeDie(defect));
var exitVoid2 = /* @__PURE__ */ exitSucceed2(void 0);
var exitVoidAll = (exits) => {
  for (const exit4 of exits) {
    if (exit4._tag === "Failure") {
      return exit4;
    }
  }
  return exitVoid2;
};
var setImmediate = "setImmediate" in globalThis ? globalThis.setImmediate : (f) => setTimeout(f, 0);
var MicroSchedulerDefault = class {
  tasks = [];
  running = false;
  /**
   * @since 3.5.9
   */
  scheduleTask(task, _priority) {
    this.tasks.push(task);
    if (!this.running) {
      this.running = true;
      setImmediate(this.afterScheduled);
    }
  }
  /**
   * @since 3.5.9
   */
  afterScheduled = () => {
    this.running = false;
    this.runTasks();
  };
  /**
   * @since 3.5.9
   */
  runTasks() {
    const tasks = this.tasks;
    this.tasks = [];
    for (let i = 0, len = tasks.length; i < len; i++) {
      tasks[i]();
    }
  }
  /**
   * @since 3.5.9
   */
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.getRef(MaxOpsBeforeYield);
  }
  /**
   * @since 3.5.9
   */
  flush() {
    while (this.tasks.length > 0) {
      this.runTasks();
    }
  }
};
var updateContext = /* @__PURE__ */ dual(2, (self, f) => withMicroFiber((fiber) => {
  const prev = fiber.context;
  fiber.context = f(prev);
  return onExit2(self, () => {
    fiber.context = prev;
    return void_3;
  });
}));
var provideContext2 = /* @__PURE__ */ dual(2, (self, provided) => updateContext(self, merge3(provided)));
var MaxOpsBeforeYield = class extends (/* @__PURE__ */ Reference2()("effect/Micro/currentMaxOpsBeforeYield", {
  defaultValue: () => 2048
})) {
};
var CurrentConcurrency = class extends (/* @__PURE__ */ Reference2()("effect/Micro/currentConcurrency", {
  defaultValue: () => "unbounded"
})) {
};
var CurrentScheduler = class extends (/* @__PURE__ */ Reference2()("effect/Micro/currentScheduler", {
  defaultValue: () => new MicroSchedulerDefault()
})) {
};
var matchCauseEffect2 = /* @__PURE__ */ dual(2, (self, options) => {
  const primitive = Object.create(OnSuccessAndFailureProto);
  primitive[args] = self;
  primitive[successCont] = options.onSuccess;
  primitive[failureCont] = options.onFailure;
  return primitive;
});
var OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccessAndFailure",
  eval(fiber) {
    fiber._stack.push(this);
    return this[args];
  }
});
var matchCause2 = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect2(self, {
  onFailure: (cause3) => sync2(() => options.onFailure(cause3)),
  onSuccess: (value) => sync2(() => options.onSuccess(value))
}));
var MicroScopeTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroScope");
var MicroScopeImpl = class _MicroScopeImpl {
  [MicroScopeTypeId];
  state = {
    _tag: "Open",
    finalizers: /* @__PURE__ */ new Set()
  };
  constructor() {
    this[MicroScopeTypeId] = MicroScopeTypeId;
  }
  unsafeAddFinalizer(finalizer) {
    if (this.state._tag === "Open") {
      this.state.finalizers.add(finalizer);
    }
  }
  addFinalizer(finalizer) {
    return suspend2(() => {
      if (this.state._tag === "Open") {
        this.state.finalizers.add(finalizer);
        return void_3;
      }
      return finalizer(this.state.exit);
    });
  }
  unsafeRemoveFinalizer(finalizer) {
    if (this.state._tag === "Open") {
      this.state.finalizers.delete(finalizer);
    }
  }
  close(microExit) {
    return suspend2(() => {
      if (this.state._tag === "Open") {
        const finalizers = Array.from(this.state.finalizers).reverse();
        this.state = {
          _tag: "Closed",
          exit: microExit
        };
        return flatMap9(forEach4(finalizers, (finalizer) => exit2(finalizer(microExit))), exitVoidAll);
      }
      return void_3;
    });
  }
  get fork() {
    return sync2(() => {
      const newScope = new _MicroScopeImpl();
      if (this.state._tag === "Closed") {
        newScope.state = this.state;
        return newScope;
      }
      function fin(exit4) {
        return newScope.close(exit4);
      }
      this.state.finalizers.add(fin);
      newScope.unsafeAddFinalizer((_) => sync2(() => this.unsafeRemoveFinalizer(fin)));
      return newScope;
    });
  }
};
var onExit2 = /* @__PURE__ */ dual(2, (self, f) => uninterruptibleMask2((restore) => matchCauseEffect2(restore(self), {
  onFailure: (cause3) => flatMap9(f(exitFailCause2(cause3)), () => failCause3(cause3)),
  onSuccess: (a) => flatMap9(f(exitSucceed2(a)), () => succeed3(a))
})));
var setInterruptible = /* @__PURE__ */ makePrimitive({
  op: "SetInterruptible",
  ensure(fiber) {
    fiber.interruptible = this[args];
    if (fiber._interrupted && fiber.interruptible) {
      return () => exitInterrupt2;
    }
  }
});
var interruptible3 = (self) => withMicroFiber((fiber) => {
  if (fiber.interruptible) return self;
  fiber.interruptible = true;
  fiber._stack.push(setInterruptible(false));
  if (fiber._interrupted) return exitInterrupt2;
  return self;
});
var uninterruptibleMask2 = (f) => withMicroFiber((fiber) => {
  if (!fiber.interruptible) return f(identity);
  fiber.interruptible = false;
  fiber._stack.push(setInterruptible(true));
  return f(interruptible3);
});
var whileLoop2 = /* @__PURE__ */ makePrimitive({
  op: "While",
  contA(value, fiber) {
    this[args].step(value);
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid2;
  },
  eval(fiber) {
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid2;
  }
});
var forEach4 = (iterable, f, options) => withMicroFiber((parent) => {
  const concurrencyOption = options?.concurrency === "inherit" ? parent.getRef(CurrentConcurrency) : options?.concurrency ?? 1;
  const concurrency = concurrencyOption === "unbounded" ? Number.POSITIVE_INFINITY : Math.max(1, concurrencyOption);
  const items = fromIterable(iterable);
  let length2 = items.length;
  if (length2 === 0) {
    return options?.discard ? void_3 : succeed3([]);
  }
  const out = options?.discard ? void 0 : new Array(length2);
  let index = 0;
  if (concurrency === 1) {
    return as4(whileLoop2({
      while: () => index < items.length,
      body: () => f(items[index], index),
      step: out ? (b) => out[index++] = b : (_) => index++
    }), out);
  }
  return async((resume2) => {
    const fibers = /* @__PURE__ */ new Set();
    let result = void 0;
    let inProgress = 0;
    let doneCount = 0;
    let pumping = false;
    let interrupted = false;
    function pump() {
      pumping = true;
      while (inProgress < concurrency && index < length2) {
        const currentIndex = index;
        const item = items[currentIndex];
        index++;
        inProgress++;
        try {
          const child = unsafeFork(parent, f(item, currentIndex), true, true);
          fibers.add(child);
          child.addObserver((exit4) => {
            fibers.delete(child);
            if (interrupted) {
              return;
            } else if (exit4._tag === "Failure") {
              if (result === void 0) {
                result = exit4;
                length2 = index;
                fibers.forEach((fiber) => fiber.unsafeInterrupt());
              }
            } else if (out !== void 0) {
              out[currentIndex] = exit4.value;
            }
            doneCount++;
            inProgress--;
            if (doneCount === length2) {
              resume2(result ?? succeed3(out));
            } else if (!pumping && inProgress < concurrency) {
              pump();
            }
          });
        } catch (err) {
          result = exitDie2(err);
          length2 = index;
          fibers.forEach((fiber) => fiber.unsafeInterrupt());
        }
      }
      pumping = false;
    }
    pump();
    return suspend2(() => {
      interrupted = true;
      index = length2;
      return fiberInterruptAll(fibers);
    });
  });
});
var unsafeFork = (parent, effect, immediate = false, daemon = false) => {
  const child = new MicroFiberImpl(parent.context, parent.interruptible);
  if (!daemon) {
    parent.children().add(child);
    child.addObserver(() => parent.children().delete(child));
  }
  if (immediate) {
    child.evaluate(effect);
  } else {
    parent.getRef(CurrentScheduler).scheduleTask(() => child.evaluate(effect), 0);
  }
  return child;
};
var runFork = (effect, options) => {
  const fiber = new MicroFiberImpl(CurrentScheduler.context(options?.scheduler ?? new MicroSchedulerDefault()));
  fiber.evaluate(effect);
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.unsafeInterrupt();
    } else {
      const abort = () => fiber.unsafeInterrupt();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  return fiber;
};

// node_modules/effect/dist/esm/Scheduler.js
var SchedulerRunner = class _SchedulerRunner {
  scheduleDrain;
  running = false;
  tasks = /* @__PURE__ */ new PriorityBuckets();
  constructor(scheduleDrain) {
    this.scheduleDrain = scheduleDrain;
  }
  starveInternal = (depth) => {
    const tasks = this.tasks.buckets;
    this.tasks.buckets = [];
    for (const [_, toRun] of tasks) {
      for (let i = 0; i < toRun.length; i++) {
        toRun[i]();
      }
    }
    if (this.tasks.buckets.length === 0) {
      this.running = false;
    } else {
      this.starve(depth);
    }
  };
  starve(depth = 0) {
    this.scheduleDrain(depth, this.starveInternal);
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (!this.running) {
      this.running = true;
      this.starve();
    }
  }
  /**
   * @since 3.20.0
   * @category constructors
   */
  static cached(scheduleDrain) {
    const fallback = new _SchedulerRunner(scheduleDrain);
    const runners = /* @__PURE__ */ new WeakMap();
    return (fiber) => {
      if (fiber === void 0) {
        return fallback;
      }
      let runner = runners.get(fiber);
      if (runner === void 0) {
        runner = new _SchedulerRunner(scheduleDrain);
        runners.set(fiber, runner);
      }
      return runner;
    };
  }
};
var PriorityBuckets = class {
  /**
   * @since 2.0.0
   */
  buckets = [];
  /**
   * @since 2.0.0
   */
  scheduleTask(task, priority) {
    const length2 = this.buckets.length;
    let bucket = void 0;
    let index = 0;
    for (; index < length2; index++) {
      if (this.buckets[index][0] <= priority) {
        bucket = this.buckets[index];
      } else {
        break;
      }
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === length2) {
      this.buckets.push([priority, [task]]);
    } else {
      this.buckets.splice(index, 0, [priority, [task]]);
    }
  }
};
var MixedScheduler = class {
  maxNextTickBeforeTimer;
  getRunner = /* @__PURE__ */ SchedulerRunner.cached((depth, drain) => {
    if (depth >= this.maxNextTickBeforeTimer) {
      setTimeout(() => drain(0), 0);
    } else {
      Promise.resolve(void 0).then(() => drain(depth + 1));
    }
  });
  constructor(maxNextTickBeforeTimer) {
    this.maxNextTickBeforeTimer = maxNextTickBeforeTimer;
  }
  /**
   * @since 2.0.0
   */
  shouldYield(fiber) {
    return fiber.currentOpCount > fiber.getFiberRef(currentMaxOpsBeforeYield) ? fiber.getFiberRef(currentSchedulingPriority) : false;
  }
  /**
   * @since 2.0.0
   */
  scheduleTask(task, priority, fiber) {
    this.getRunner(fiber).scheduleTask(task, priority);
  }
};
var defaultScheduler = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Scheduler/defaultScheduler"), () => new MixedScheduler(2048));
var SyncScheduler = class {
  /**
   * @since 2.0.0
   */
  tasks = /* @__PURE__ */ new PriorityBuckets();
  /**
   * @since 2.0.0
   */
  deferred = false;
  /**
   * @since 2.0.0
   */
  scheduleTask(task, priority, fiber) {
    if (this.deferred) {
      defaultScheduler.scheduleTask(task, priority, fiber);
    } else {
      this.tasks.scheduleTask(task, priority);
    }
  }
  /**
   * @since 2.0.0
   */
  shouldYield(fiber) {
    return fiber.currentOpCount > fiber.getFiberRef(currentMaxOpsBeforeYield) ? fiber.getFiberRef(currentSchedulingPriority) : false;
  }
  /**
   * @since 2.0.0
   */
  flush() {
    while (this.tasks.buckets.length > 0) {
      const tasks = this.tasks.buckets;
      this.tasks.buckets = [];
      for (const [_, toRun] of tasks) {
        for (let i = 0; i < toRun.length; i++) {
          toRun[i]();
        }
      }
    }
    this.deferred = true;
  }
};
var currentScheduler = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentScheduler"), () => fiberRefUnsafeMake(defaultScheduler));
var withScheduler = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentScheduler, scheduler));

// node_modules/effect/dist/esm/internal/completedRequestMap.js
var currentRequestMap = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentRequestMap"), () => fiberRefUnsafeMake(/* @__PURE__ */ new Map()));

// node_modules/effect/dist/esm/internal/concurrency.js
var match9 = (concurrency, sequential5, unbounded2, bounded) => {
  switch (concurrency) {
    case void 0:
      return sequential5();
    case "unbounded":
      return unbounded2();
    case "inherit":
      return fiberRefGetWith(currentConcurrency, (concurrency2) => concurrency2 === "unbounded" ? unbounded2() : concurrency2 > 1 ? bounded(concurrency2) : sequential5());
    default:
      return concurrency > 1 ? bounded(concurrency) : sequential5();
  }
};
var matchSimple = (concurrency, sequential5, concurrent) => {
  switch (concurrency) {
    case void 0:
      return sequential5();
    case "unbounded":
      return concurrent();
    case "inherit":
      return fiberRefGetWith(currentConcurrency, (concurrency2) => concurrency2 === "unbounded" || concurrency2 > 1 ? concurrent() : sequential5());
    default:
      return concurrency > 1 ? concurrent() : sequential5();
  }
};

// node_modules/effect/dist/esm/internal/fiberMessage.js
var OP_INTERRUPT_SIGNAL = "InterruptSignal";
var OP_STATEFUL = "Stateful";
var OP_RESUME = "Resume";
var OP_YIELD_NOW = "YieldNow";
var interruptSignal = (cause3) => ({
  _tag: OP_INTERRUPT_SIGNAL,
  cause: cause3
});
var stateful = (onFiber) => ({
  _tag: OP_STATEFUL,
  onFiber
});
var resume = (effect) => ({
  _tag: OP_RESUME,
  effect
});
var yieldNow3 = () => ({
  _tag: OP_YIELD_NOW
});

// node_modules/effect/dist/esm/internal/fiberScope.js
var FiberScopeSymbolKey = "effect/FiberScope";
var FiberScopeTypeId = /* @__PURE__ */ Symbol.for(FiberScopeSymbolKey);
var Global = class {
  [FiberScopeTypeId] = FiberScopeTypeId;
  fiberId = none4;
  roots = /* @__PURE__ */ new Set();
  add(_runtimeFlags, child) {
    this.roots.add(child);
    child.addObserver(() => {
      this.roots.delete(child);
    });
  }
};
var Local = class {
  fiberId;
  parent;
  [FiberScopeTypeId] = FiberScopeTypeId;
  constructor(fiberId3, parent) {
    this.fiberId = fiberId3;
    this.parent = parent;
  }
  add(_runtimeFlags, child) {
    this.parent.tell(stateful((parentFiber) => {
      parentFiber.addChild(child);
      child.addObserver(() => {
        parentFiber.removeChild(child);
      });
    }));
  }
};
var unsafeMake6 = (fiber) => {
  return new Local(fiber.id(), fiber);
};
var globalScope = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberScope/Global"), () => new Global());

// node_modules/effect/dist/esm/internal/fiber.js
var FiberSymbolKey = "effect/Fiber";
var FiberTypeId = /* @__PURE__ */ Symbol.for(FiberSymbolKey);
var fiberVariance2 = {
  /* c8 ignore next */
  _E: (_) => _,
  /* c8 ignore next */
  _A: (_) => _
};
var fiberProto = {
  [FiberTypeId]: fiberVariance2,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var RuntimeFiberSymbolKey = "effect/Fiber";
var RuntimeFiberTypeId = /* @__PURE__ */ Symbol.for(RuntimeFiberSymbolKey);
var isRuntimeFiber = (self) => RuntimeFiberTypeId in self;
var _await2 = (self) => self.await;
var inheritAll = (self) => self.inheritAll;
var interruptAllAs = /* @__PURE__ */ dual(2, /* @__PURE__ */ fnUntraced(function* (fibers, fiberId3) {
  for (const fiber of fibers) {
    if (isRuntimeFiber(fiber)) {
      fiber.unsafeInterruptAsFork(fiberId3);
      continue;
    }
    yield* fiber.interruptAsFork(fiberId3);
  }
  for (const fiber of fibers) {
    if (isRuntimeFiber(fiber) && fiber.unsafePoll()) {
      continue;
    }
    yield* fiber.await;
  }
}));
var interruptAsFork = /* @__PURE__ */ dual(2, (self, fiberId3) => self.interruptAsFork(fiberId3));
var join2 = (self) => zipLeft(flatten4(self.await), self.inheritAll);
var _never = {
  ...CommitPrototype,
  commit() {
    return join2(this);
  },
  ...fiberProto,
  id: () => none4,
  await: never,
  children: /* @__PURE__ */ succeed([]),
  inheritAll: never,
  poll: /* @__PURE__ */ succeed(/* @__PURE__ */ none2()),
  interruptAsFork: () => never
};
var currentFiberURI = "effect/FiberCurrent";

// node_modules/effect/dist/esm/internal/logger.js
var LoggerSymbolKey = "effect/Logger";
var LoggerTypeId = /* @__PURE__ */ Symbol.for(LoggerSymbolKey);
var loggerVariance = {
  /* c8 ignore next */
  _Message: (_) => _,
  /* c8 ignore next */
  _Output: (_) => _
};
var makeLogger = (log3) => ({
  [LoggerTypeId]: loggerVariance,
  log: log3,
  pipe() {
    return pipeArguments(this, arguments);
  }
});
var none7 = {
  [LoggerTypeId]: loggerVariance,
  log: constVoid,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var textOnly = /^[^\s"=]*$/;
var format3 = (quoteValue, whitespace) => ({
  annotations,
  cause: cause3,
  date,
  fiberId: fiberId3,
  logLevel,
  message,
  spans
}) => {
  const formatValue = (value) => value.match(textOnly) ? value : quoteValue(value);
  const format4 = (label, value) => `${formatLabel(label)}=${formatValue(value)}`;
  const append4 = (label, value) => " " + format4(label, value);
  let out = format4("timestamp", date.toISOString());
  out += append4("level", logLevel.label);
  out += append4("fiber", threadName(fiberId3));
  const messages = ensure(message);
  for (let i = 0; i < messages.length; i++) {
    out += append4("message", toStringUnknown(messages[i], whitespace));
  }
  if (!isEmptyType(cause3)) {
    out += append4("cause", pretty(cause3, {
      renderErrorCause: true
    }));
  }
  for (const span2 of spans) {
    out += " " + render(date.getTime())(span2);
  }
  for (const [label, value] of annotations) {
    out += append4(label, toStringUnknown(value, whitespace));
  }
  return out;
};
var escapeDoubleQuotes = (s) => `"${s.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`;
var stringLogger = /* @__PURE__ */ makeLogger(/* @__PURE__ */ format3(escapeDoubleQuotes));
var colors = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
  white: "37",
  gray: "90",
  black: "30",
  bgBrightRed: "101"
};
var logLevelColors = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warning: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black]
};
var hasProcessStdout = typeof process === "object" && process !== null && typeof process.stdout === "object" && process.stdout !== null;
var processStdoutIsTTY = hasProcessStdout && process.stdout.isTTY === true;
var hasProcessStdoutOrDeno = hasProcessStdout || "Deno" in globalThis;

// node_modules/effect/dist/esm/internal/metric/boundaries.js
var MetricBoundariesSymbolKey = "effect/MetricBoundaries";
var MetricBoundariesTypeId = /* @__PURE__ */ Symbol.for(MetricBoundariesSymbolKey);
var MetricBoundariesImpl = class {
  values;
  [MetricBoundariesTypeId] = MetricBoundariesTypeId;
  constructor(values3) {
    this.values = values3;
    this._hash = pipe(string(MetricBoundariesSymbolKey), combine(array2(this.values)));
  }
  _hash;
  [symbol]() {
    return this._hash;
  }
  [symbol2](u) {
    return isMetricBoundaries(u) && equals(this.values, u.values);
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var isMetricBoundaries = (u) => hasProperty(u, MetricBoundariesTypeId);
var fromIterable7 = (iterable) => {
  const values3 = pipe(iterable, appendAll(of2(Number.POSITIVE_INFINITY)), dedupe);
  return new MetricBoundariesImpl(values3);
};
var exponential = (options) => pipe(makeBy(options.count - 1, (i) => options.start * Math.pow(options.factor, i)), unsafeFromArray, fromIterable7);

// node_modules/effect/dist/esm/internal/metric/keyType.js
var MetricKeyTypeSymbolKey = "effect/MetricKeyType";
var MetricKeyTypeTypeId = /* @__PURE__ */ Symbol.for(MetricKeyTypeSymbolKey);
var CounterKeyTypeSymbolKey = "effect/MetricKeyType/Counter";
var CounterKeyTypeTypeId = /* @__PURE__ */ Symbol.for(CounterKeyTypeSymbolKey);
var FrequencyKeyTypeSymbolKey = "effect/MetricKeyType/Frequency";
var FrequencyKeyTypeTypeId = /* @__PURE__ */ Symbol.for(FrequencyKeyTypeSymbolKey);
var GaugeKeyTypeSymbolKey = "effect/MetricKeyType/Gauge";
var GaugeKeyTypeTypeId = /* @__PURE__ */ Symbol.for(GaugeKeyTypeSymbolKey);
var HistogramKeyTypeSymbolKey = "effect/MetricKeyType/Histogram";
var HistogramKeyTypeTypeId = /* @__PURE__ */ Symbol.for(HistogramKeyTypeSymbolKey);
var SummaryKeyTypeSymbolKey = "effect/MetricKeyType/Summary";
var SummaryKeyTypeTypeId = /* @__PURE__ */ Symbol.for(SummaryKeyTypeSymbolKey);
var metricKeyTypeVariance = {
  /* c8 ignore next */
  _In: (_) => _,
  /* c8 ignore next */
  _Out: (_) => _
};
var CounterKeyType = class {
  incremental;
  bigint;
  [MetricKeyTypeTypeId] = metricKeyTypeVariance;
  [CounterKeyTypeTypeId] = CounterKeyTypeTypeId;
  constructor(incremental, bigint) {
    this.incremental = incremental;
    this.bigint = bigint;
    this._hash = string(CounterKeyTypeSymbolKey);
  }
  _hash;
  [symbol]() {
    return this._hash;
  }
  [symbol2](that) {
    return isCounterKey(that);
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var FrequencyKeyTypeHash = /* @__PURE__ */ string(FrequencyKeyTypeSymbolKey);
var FrequencyKeyType = class {
  preregisteredWords;
  [MetricKeyTypeTypeId] = metricKeyTypeVariance;
  [FrequencyKeyTypeTypeId] = FrequencyKeyTypeTypeId;
  constructor(preregisteredWords) {
    this.preregisteredWords = preregisteredWords;
  }
  [symbol]() {
    return FrequencyKeyTypeHash;
  }
  [symbol2](that) {
    return isFrequencyKey(that);
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var GaugeKeyTypeHash = /* @__PURE__ */ string(GaugeKeyTypeSymbolKey);
var GaugeKeyType = class {
  bigint;
  [MetricKeyTypeTypeId] = metricKeyTypeVariance;
  [GaugeKeyTypeTypeId] = GaugeKeyTypeTypeId;
  constructor(bigint) {
    this.bigint = bigint;
  }
  [symbol]() {
    return GaugeKeyTypeHash;
  }
  [symbol2](that) {
    return isGaugeKey(that);
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var HistogramKeyType = class {
  boundaries;
  [MetricKeyTypeTypeId] = metricKeyTypeVariance;
  [HistogramKeyTypeTypeId] = HistogramKeyTypeTypeId;
  constructor(boundaries) {
    this.boundaries = boundaries;
    this._hash = pipe(string(HistogramKeyTypeSymbolKey), combine(hash(this.boundaries)));
  }
  _hash;
  [symbol]() {
    return this._hash;
  }
  [symbol2](that) {
    return isHistogramKey(that) && equals(this.boundaries, that.boundaries);
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var SummaryKeyType = class {
  maxAge;
  maxSize;
  error;
  quantiles;
  [MetricKeyTypeTypeId] = metricKeyTypeVariance;
  [SummaryKeyTypeTypeId] = SummaryKeyTypeTypeId;
  constructor(maxAge, maxSize, error, quantiles) {
    this.maxAge = maxAge;
    this.maxSize = maxSize;
    this.error = error;
    this.quantiles = quantiles;
    this._hash = pipe(string(SummaryKeyTypeSymbolKey), combine(hash(this.maxAge)), combine(hash(this.maxSize)), combine(hash(this.error)), combine(array2(this.quantiles)));
  }
  _hash;
  [symbol]() {
    return this._hash;
  }
  [symbol2](that) {
    return isSummaryKey(that) && equals(this.maxAge, that.maxAge) && this.maxSize === that.maxSize && this.error === that.error && equals(this.quantiles, that.quantiles);
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var counter = (options) => new CounterKeyType(options?.incremental ?? false, options?.bigint ?? false);
var histogram = (boundaries) => {
  return new HistogramKeyType(boundaries);
};
var isCounterKey = (u) => hasProperty(u, CounterKeyTypeTypeId);
var isFrequencyKey = (u) => hasProperty(u, FrequencyKeyTypeTypeId);
var isGaugeKey = (u) => hasProperty(u, GaugeKeyTypeTypeId);
var isHistogramKey = (u) => hasProperty(u, HistogramKeyTypeTypeId);
var isSummaryKey = (u) => hasProperty(u, SummaryKeyTypeTypeId);

// node_modules/effect/dist/esm/internal/metric/key.js
var MetricKeySymbolKey = "effect/MetricKey";
var MetricKeyTypeId = /* @__PURE__ */ Symbol.for(MetricKeySymbolKey);
var metricKeyVariance = {
  /* c8 ignore next */
  _Type: (_) => _
};
var arrayEquivilence = /* @__PURE__ */ getEquivalence(equals);
var MetricKeyImpl = class {
  name;
  keyType;
  description;
  tags;
  [MetricKeyTypeId] = metricKeyVariance;
  constructor(name, keyType, description, tags = []) {
    this.name = name;
    this.keyType = keyType;
    this.description = description;
    this.tags = tags;
    this._hash = pipe(string(this.name + this.description), combine(hash(this.keyType)), combine(array2(this.tags)));
  }
  _hash;
  [symbol]() {
    return this._hash;
  }
  [symbol2](u) {
    return isMetricKey(u) && this.name === u.name && equals(this.keyType, u.keyType) && equals(this.description, u.description) && arrayEquivilence(this.tags, u.tags);
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var isMetricKey = (u) => hasProperty(u, MetricKeyTypeId);
var counter2 = (name, options) => new MetricKeyImpl(name, counter(options), fromNullable(options?.description));
var histogram2 = (name, boundaries, description) => new MetricKeyImpl(name, histogram(boundaries), fromNullable(description));
var taggedWithLabels = /* @__PURE__ */ dual(2, (self, extraTags) => extraTags.length === 0 ? self : new MetricKeyImpl(self.name, self.keyType, self.description, union(self.tags, extraTags)));

// node_modules/effect/dist/esm/internal/metric/state.js
var MetricStateSymbolKey = "effect/MetricState";
var MetricStateTypeId = /* @__PURE__ */ Symbol.for(MetricStateSymbolKey);
var CounterStateSymbolKey = "effect/MetricState/Counter";
var CounterStateTypeId = /* @__PURE__ */ Symbol.for(CounterStateSymbolKey);
var FrequencyStateSymbolKey = "effect/MetricState/Frequency";
var FrequencyStateTypeId = /* @__PURE__ */ Symbol.for(FrequencyStateSymbolKey);
var GaugeStateSymbolKey = "effect/MetricState/Gauge";
var GaugeStateTypeId = /* @__PURE__ */ Symbol.for(GaugeStateSymbolKey);
var HistogramStateSymbolKey = "effect/MetricState/Histogram";
var HistogramStateTypeId = /* @__PURE__ */ Symbol.for(HistogramStateSymbolKey);
var SummaryStateSymbolKey = "effect/MetricState/Summary";
var SummaryStateTypeId = /* @__PURE__ */ Symbol.for(SummaryStateSymbolKey);
var metricStateVariance = {
  /* c8 ignore next */
  _A: (_) => _
};
var CounterState = class {
  count;
  [MetricStateTypeId] = metricStateVariance;
  [CounterStateTypeId] = CounterStateTypeId;
  constructor(count) {
    this.count = count;
  }
  [symbol]() {
    return pipe(hash(CounterStateSymbolKey), combine(hash(this.count)), cached(this));
  }
  [symbol2](that) {
    return isCounterState(that) && this.count === that.count;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var arrayEquals = /* @__PURE__ */ getEquivalence(equals);
var FrequencyState = class {
  occurrences;
  [MetricStateTypeId] = metricStateVariance;
  [FrequencyStateTypeId] = FrequencyStateTypeId;
  constructor(occurrences) {
    this.occurrences = occurrences;
  }
  _hash;
  [symbol]() {
    return pipe(string(FrequencyStateSymbolKey), combine(array2(fromIterable(this.occurrences.entries()))), cached(this));
  }
  [symbol2](that) {
    return isFrequencyState(that) && arrayEquals(fromIterable(this.occurrences.entries()), fromIterable(that.occurrences.entries()));
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var GaugeState = class {
  value;
  [MetricStateTypeId] = metricStateVariance;
  [GaugeStateTypeId] = GaugeStateTypeId;
  constructor(value) {
    this.value = value;
  }
  [symbol]() {
    return pipe(hash(GaugeStateSymbolKey), combine(hash(this.value)), cached(this));
  }
  [symbol2](u) {
    return isGaugeState(u) && this.value === u.value;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var HistogramState = class {
  buckets;
  count;
  min;
  max;
  sum;
  [MetricStateTypeId] = metricStateVariance;
  [HistogramStateTypeId] = HistogramStateTypeId;
  constructor(buckets, count, min4, max6, sum2) {
    this.buckets = buckets;
    this.count = count;
    this.min = min4;
    this.max = max6;
    this.sum = sum2;
  }
  [symbol]() {
    return pipe(hash(HistogramStateSymbolKey), combine(hash(this.buckets)), combine(hash(this.count)), combine(hash(this.min)), combine(hash(this.max)), combine(hash(this.sum)), cached(this));
  }
  [symbol2](that) {
    return isHistogramState(that) && equals(this.buckets, that.buckets) && this.count === that.count && this.min === that.min && this.max === that.max && this.sum === that.sum;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var SummaryState = class {
  error;
  quantiles;
  count;
  min;
  max;
  sum;
  [MetricStateTypeId] = metricStateVariance;
  [SummaryStateTypeId] = SummaryStateTypeId;
  constructor(error, quantiles, count, min4, max6, sum2) {
    this.error = error;
    this.quantiles = quantiles;
    this.count = count;
    this.min = min4;
    this.max = max6;
    this.sum = sum2;
  }
  [symbol]() {
    return pipe(hash(SummaryStateSymbolKey), combine(hash(this.error)), combine(hash(this.quantiles)), combine(hash(this.count)), combine(hash(this.min)), combine(hash(this.max)), combine(hash(this.sum)), cached(this));
  }
  [symbol2](that) {
    return isSummaryState(that) && this.error === that.error && equals(this.quantiles, that.quantiles) && this.count === that.count && this.min === that.min && this.max === that.max && this.sum === that.sum;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var counter3 = (count) => new CounterState(count);
var frequency2 = (occurrences) => {
  return new FrequencyState(occurrences);
};
var gauge2 = (count) => new GaugeState(count);
var histogram3 = (options) => new HistogramState(options.buckets, options.count, options.min, options.max, options.sum);
var summary2 = (options) => new SummaryState(options.error, options.quantiles, options.count, options.min, options.max, options.sum);
var isCounterState = (u) => hasProperty(u, CounterStateTypeId);
var isFrequencyState = (u) => hasProperty(u, FrequencyStateTypeId);
var isGaugeState = (u) => hasProperty(u, GaugeStateTypeId);
var isHistogramState = (u) => hasProperty(u, HistogramStateTypeId);
var isSummaryState = (u) => hasProperty(u, SummaryStateTypeId);

// node_modules/effect/dist/esm/internal/metric/hook.js
var MetricHookSymbolKey = "effect/MetricHook";
var MetricHookTypeId = /* @__PURE__ */ Symbol.for(MetricHookSymbolKey);
var metricHookVariance = {
  /* c8 ignore next */
  _In: (_) => _,
  /* c8 ignore next */
  _Out: (_) => _
};
var make29 = (options) => ({
  [MetricHookTypeId]: metricHookVariance,
  pipe() {
    return pipeArguments(this, arguments);
  },
  ...options
});
var bigint03 = /* @__PURE__ */ BigInt(0);
var counter4 = (key) => {
  let sum2 = key.keyType.bigint ? bigint03 : 0;
  const canUpdate = key.keyType.incremental ? key.keyType.bigint ? (value) => value >= bigint03 : (value) => value >= 0 : (_value) => true;
  const update5 = (value) => {
    if (canUpdate(value)) {
      sum2 = sum2 + value;
    }
  };
  return make29({
    get: () => counter3(sum2),
    update: update5,
    modify: update5
  });
};
var frequency3 = (key) => {
  const values3 = /* @__PURE__ */ new Map();
  for (const word of key.keyType.preregisteredWords) {
    values3.set(word, 0);
  }
  const update5 = (word) => {
    const slotCount = values3.get(word) ?? 0;
    values3.set(word, slotCount + 1);
  };
  return make29({
    get: () => frequency2(values3),
    update: update5,
    modify: update5
  });
};
var gauge3 = (_key, startAt) => {
  let value = startAt;
  return make29({
    get: () => gauge2(value),
    update: (v) => {
      value = v;
    },
    modify: (v) => {
      value = value + v;
    }
  });
};
var histogram4 = (key) => {
  const bounds = key.keyType.boundaries.values;
  const size11 = bounds.length;
  const values3 = new Uint32Array(size11 + 1);
  const boundaries = new Float64Array(size11);
  let count = 0;
  let sum2 = 0;
  let min4 = Number.MAX_VALUE;
  let max6 = Number.MIN_VALUE;
  pipe(bounds, sort(Order), map2((n, i) => {
    boundaries[i] = n;
  }));
  const update5 = (value) => {
    let from = 0;
    let to = size11;
    while (from !== to) {
      const mid = Math.floor(from + (to - from) / 2);
      const boundary = boundaries[mid];
      if (value <= boundary) {
        to = mid;
      } else {
        from = mid;
      }
      if (to === from + 1) {
        if (value <= boundaries[from]) {
          to = from;
        } else {
          from = to;
        }
      }
    }
    values3[from] = values3[from] + 1;
    count = count + 1;
    sum2 = sum2 + value;
    if (value < min4) {
      min4 = value;
    }
    if (value > max6) {
      max6 = value;
    }
  };
  const getBuckets = () => {
    const builder = allocate(size11);
    let cumulated = 0;
    for (let i = 0; i < size11; i++) {
      const boundary = boundaries[i];
      const value = values3[i];
      cumulated = cumulated + value;
      builder[i] = [boundary, cumulated];
    }
    return builder;
  };
  return make29({
    get: () => histogram3({
      buckets: getBuckets(),
      count,
      min: min4,
      max: max6,
      sum: sum2
    }),
    update: update5,
    modify: update5
  });
};
var summary3 = (key) => {
  const {
    error,
    maxAge,
    maxSize,
    quantiles
  } = key.keyType;
  const sortedQuantiles = pipe(quantiles, sort(Order));
  const values3 = allocate(maxSize);
  let head5 = 0;
  let count = 0;
  let sum2 = 0;
  let min4 = 0;
  let max6 = 0;
  const snapshot = (now) => {
    const builder = [];
    let i = 0;
    while (i !== maxSize - 1) {
      const item = values3[i];
      if (item != null) {
        const [t, v] = item;
        const age = millis(now - t);
        if (greaterThanOrEqualTo2(age, zero) && lessThanOrEqualTo2(age, maxAge)) {
          builder.push(v);
        }
      }
      i = i + 1;
    }
    return calculateQuantiles(error, sortedQuantiles, sort(builder, Order));
  };
  const observe = (value, timestamp) => {
    if (maxSize > 0) {
      head5 = head5 + 1;
      const target = head5 % maxSize;
      values3[target] = [timestamp, value];
    }
    min4 = count === 0 ? value : Math.min(min4, value);
    max6 = count === 0 ? value : Math.max(max6, value);
    count = count + 1;
    sum2 = sum2 + value;
  };
  return make29({
    get: () => summary2({
      error,
      quantiles: snapshot(Date.now()),
      count,
      min: min4,
      max: max6,
      sum: sum2
    }),
    update: ([value, timestamp]) => observe(value, timestamp),
    modify: ([value, timestamp]) => observe(value, timestamp)
  });
};
var calculateQuantiles = (error, sortedQuantiles, sortedSamples) => {
  const sampleCount = sortedSamples.length;
  if (!isNonEmptyReadonlyArray(sortedQuantiles)) {
    return empty();
  }
  const head5 = sortedQuantiles[0];
  const tail = sortedQuantiles.slice(1);
  const resolvedHead = resolveQuantile(error, sampleCount, none2(), 0, head5, sortedSamples);
  const resolved = of(resolvedHead);
  tail.forEach((quantile) => {
    resolved.push(resolveQuantile(error, sampleCount, resolvedHead.value, resolvedHead.consumed, quantile, resolvedHead.rest));
  });
  return map2(resolved, (rq) => [rq.quantile, rq.value]);
};
var resolveQuantile = (error, sampleCount, current, consumed, quantile, rest) => {
  let error_1 = error;
  let sampleCount_1 = sampleCount;
  let current_1 = current;
  let consumed_1 = consumed;
  let quantile_1 = quantile;
  let rest_1 = rest;
  let error_2 = error;
  let sampleCount_2 = sampleCount;
  let current_2 = current;
  let consumed_2 = consumed;
  let quantile_2 = quantile;
  let rest_2 = rest;
  while (1) {
    if (!isNonEmptyReadonlyArray(rest_1)) {
      return {
        quantile: quantile_1,
        value: none2(),
        consumed: consumed_1,
        rest: []
      };
    }
    if (quantile_1 === 1) {
      return {
        quantile: quantile_1,
        value: some2(lastNonEmpty(rest_1)),
        consumed: consumed_1 + rest_1.length,
        rest: []
      };
    }
    const headValue = headNonEmpty(rest_1);
    const sameHead = span(rest_1, (n) => n === headValue);
    const desired = quantile_1 * sampleCount_1;
    const allowedError = error_1 / 2 * desired;
    const candConsumed = consumed_1 + sameHead[0].length;
    const candError = Math.abs(candConsumed - desired);
    if (candConsumed < desired - allowedError) {
      error_2 = error_1;
      sampleCount_2 = sampleCount_1;
      current_2 = head(rest_1);
      consumed_2 = candConsumed;
      quantile_2 = quantile_1;
      rest_2 = sameHead[1];
      error_1 = error_2;
      sampleCount_1 = sampleCount_2;
      current_1 = current_2;
      consumed_1 = consumed_2;
      quantile_1 = quantile_2;
      rest_1 = rest_2;
      continue;
    }
    if (candConsumed > desired + allowedError) {
      const valueToReturn = isNone2(current_1) ? some2(headValue) : current_1;
      return {
        quantile: quantile_1,
        value: valueToReturn,
        consumed: consumed_1,
        rest: rest_1
      };
    }
    switch (current_1._tag) {
      case "None": {
        error_2 = error_1;
        sampleCount_2 = sampleCount_1;
        current_2 = head(rest_1);
        consumed_2 = candConsumed;
        quantile_2 = quantile_1;
        rest_2 = sameHead[1];
        error_1 = error_2;
        sampleCount_1 = sampleCount_2;
        current_1 = current_2;
        consumed_1 = consumed_2;
        quantile_1 = quantile_2;
        rest_1 = rest_2;
        continue;
      }
      case "Some": {
        const prevError = Math.abs(desired - current_1.value);
        if (candError < prevError) {
          error_2 = error_1;
          sampleCount_2 = sampleCount_1;
          current_2 = head(rest_1);
          consumed_2 = candConsumed;
          quantile_2 = quantile_1;
          rest_2 = sameHead[1];
          error_1 = error_2;
          sampleCount_1 = sampleCount_2;
          current_1 = current_2;
          consumed_1 = consumed_2;
          quantile_1 = quantile_2;
          rest_1 = rest_2;
          continue;
        }
        return {
          quantile: quantile_1,
          value: some2(current_1.value),
          consumed: consumed_1,
          rest: rest_1
        };
      }
    }
  }
  throw new Error("BUG: MetricHook.resolveQuantiles - please report an issue at https://github.com/Effect-TS/effect/issues");
};

// node_modules/effect/dist/esm/internal/metric/pair.js
var MetricPairSymbolKey = "effect/MetricPair";
var MetricPairTypeId = /* @__PURE__ */ Symbol.for(MetricPairSymbolKey);
var metricPairVariance = {
  /* c8 ignore next */
  _Type: (_) => _
};
var unsafeMake7 = (metricKey, metricState) => {
  return {
    [MetricPairTypeId]: metricPairVariance,
    metricKey,
    metricState,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
};

// node_modules/effect/dist/esm/internal/metric/registry.js
var MetricRegistrySymbolKey = "effect/MetricRegistry";
var MetricRegistryTypeId = /* @__PURE__ */ Symbol.for(MetricRegistrySymbolKey);
var MetricRegistryImpl = class {
  [MetricRegistryTypeId] = MetricRegistryTypeId;
  map = /* @__PURE__ */ empty17();
  snapshot() {
    const result = [];
    for (const [key, hook] of this.map) {
      result.push(unsafeMake7(key, hook.get()));
    }
    return result;
  }
  get(key) {
    const hook = pipe(this.map, get8(key), getOrUndefined);
    if (hook == null) {
      if (isCounterKey(key.keyType)) {
        return this.getCounter(key);
      }
      if (isGaugeKey(key.keyType)) {
        return this.getGauge(key);
      }
      if (isFrequencyKey(key.keyType)) {
        return this.getFrequency(key);
      }
      if (isHistogramKey(key.keyType)) {
        return this.getHistogram(key);
      }
      if (isSummaryKey(key.keyType)) {
        return this.getSummary(key);
      }
      throw new Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
    } else {
      return hook;
    }
  }
  getCounter(key) {
    let value = pipe(this.map, get8(key), getOrUndefined);
    if (value == null) {
      const counter7 = counter4(key);
      if (!pipe(this.map, has4(key))) {
        pipe(this.map, set4(key, counter7));
      }
      value = counter7;
    }
    return value;
  }
  getFrequency(key) {
    let value = pipe(this.map, get8(key), getOrUndefined);
    if (value == null) {
      const frequency5 = frequency3(key);
      if (!pipe(this.map, has4(key))) {
        pipe(this.map, set4(key, frequency5));
      }
      value = frequency5;
    }
    return value;
  }
  getGauge(key) {
    let value = pipe(this.map, get8(key), getOrUndefined);
    if (value == null) {
      const gauge5 = gauge3(key, key.keyType.bigint ? BigInt(0) : 0);
      if (!pipe(this.map, has4(key))) {
        pipe(this.map, set4(key, gauge5));
      }
      value = gauge5;
    }
    return value;
  }
  getHistogram(key) {
    let value = pipe(this.map, get8(key), getOrUndefined);
    if (value == null) {
      const histogram6 = histogram4(key);
      if (!pipe(this.map, has4(key))) {
        pipe(this.map, set4(key, histogram6));
      }
      value = histogram6;
    }
    return value;
  }
  getSummary(key) {
    let value = pipe(this.map, get8(key), getOrUndefined);
    if (value == null) {
      const summary5 = summary3(key);
      if (!pipe(this.map, has4(key))) {
        pipe(this.map, set4(key, summary5));
      }
      value = summary5;
    }
    return value;
  }
};
var make30 = () => {
  return new MetricRegistryImpl();
};

// node_modules/effect/dist/esm/internal/metric.js
var MetricSymbolKey = "effect/Metric";
var MetricTypeId = /* @__PURE__ */ Symbol.for(MetricSymbolKey);
var metricVariance = {
  /* c8 ignore next */
  _Type: (_) => _,
  /* c8 ignore next */
  _In: (_) => _,
  /* c8 ignore next */
  _Out: (_) => _
};
var globalMetricRegistry = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Metric/globalMetricRegistry"), () => make30());
var make31 = function(keyType, unsafeUpdate, unsafeValue, unsafeModify) {
  const metric = Object.assign((effect) => tap(effect, (a) => update4(metric, a)), {
    [MetricTypeId]: metricVariance,
    keyType,
    unsafeUpdate,
    unsafeValue,
    unsafeModify,
    register() {
      this.unsafeValue([]);
      return this;
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  });
  return metric;
};
var counter5 = (name, options) => fromMetricKey(counter2(name, options));
var fromMetricKey = (key) => {
  let untaggedHook;
  const hookCache = /* @__PURE__ */ new WeakMap();
  const hook = (extraTags) => {
    if (extraTags.length === 0) {
      if (untaggedHook !== void 0) {
        return untaggedHook;
      }
      untaggedHook = globalMetricRegistry.get(key);
      return untaggedHook;
    }
    let hook2 = hookCache.get(extraTags);
    if (hook2 !== void 0) {
      return hook2;
    }
    hook2 = globalMetricRegistry.get(taggedWithLabels(key, extraTags));
    hookCache.set(extraTags, hook2);
    return hook2;
  };
  return make31(key.keyType, (input, extraTags) => hook(extraTags).update(input), (extraTags) => hook(extraTags).get(), (input, extraTags) => hook(extraTags).modify(input));
};
var histogram5 = (name, boundaries, description) => fromMetricKey(histogram2(name, boundaries, description));
var tagged = /* @__PURE__ */ dual(3, (self, key, value) => taggedWithLabels2(self, [make28(key, value)]));
var taggedWithLabels2 = /* @__PURE__ */ dual(2, (self, extraTags) => {
  return make31(self.keyType, (input, extraTags1) => self.unsafeUpdate(input, union(extraTags, extraTags1)), (extraTags1) => self.unsafeValue(union(extraTags, extraTags1)), (input, extraTags1) => self.unsafeModify(input, union(extraTags, extraTags1)));
});
var update4 = /* @__PURE__ */ dual(2, (self, input) => fiberRefGetWith(currentMetricLabels, (tags) => sync(() => self.unsafeUpdate(input, tags))));

// node_modules/effect/dist/esm/internal/request.js
var RequestSymbolKey = "effect/Request";
var RequestTypeId = /* @__PURE__ */ Symbol.for(RequestSymbolKey);
var requestVariance = {
  /* c8 ignore next */
  _E: (_) => _,
  /* c8 ignore next */
  _A: (_) => _
};
var RequestPrototype = {
  ...StructuralPrototype,
  [RequestTypeId]: requestVariance
};
var isRequest = (u) => hasProperty(u, RequestTypeId);
var complete = /* @__PURE__ */ dual(2, (self, result) => fiberRefGetWith(currentRequestMap, (map14) => sync(() => {
  if (map14.has(self)) {
    const entry = map14.get(self);
    if (!entry.state.completed) {
      entry.state.completed = true;
      deferredUnsafeDone(entry.result, result);
    }
  }
})));
var Listeners = class {
  count = 0;
  observers = /* @__PURE__ */ new Set();
  interrupted = false;
  addObserver(f) {
    this.observers.add(f);
  }
  removeObserver(f) {
    this.observers.delete(f);
  }
  increment() {
    this.count++;
    this.observers.forEach((f) => f(this.count));
  }
  decrement() {
    this.count--;
    this.observers.forEach((f) => f(this.count));
  }
};

// node_modules/effect/dist/esm/internal/redBlackTree/iterator.js
var Direction = {
  Forward: 0,
  Backward: 1 << 0
};
var RedBlackTreeIterator = class _RedBlackTreeIterator {
  self;
  stack;
  direction;
  count = 0;
  constructor(self, stack, direction) {
    this.self = self;
    this.stack = stack;
    this.direction = direction;
  }
  /**
   * Clones the iterator
   */
  clone() {
    return new _RedBlackTreeIterator(this.self, this.stack.slice(), this.direction);
  }
  /**
   * Reverse the traversal direction
   */
  reversed() {
    return new _RedBlackTreeIterator(this.self, this.stack.slice(), this.direction === Direction.Forward ? Direction.Backward : Direction.Forward);
  }
  /**
   * Iterator next
   */
  next() {
    const entry = this.entry;
    this.count++;
    if (this.direction === Direction.Forward) {
      this.moveNext();
    } else {
      this.movePrev();
    }
    switch (entry._tag) {
      case "None": {
        return {
          done: true,
          value: this.count
        };
      }
      case "Some": {
        return {
          done: false,
          value: entry.value
        };
      }
    }
  }
  /**
   * Returns the key
   */
  get key() {
    if (this.stack.length > 0) {
      return some2(this.stack[this.stack.length - 1].key);
    }
    return none2();
  }
  /**
   * Returns the value
   */
  get value() {
    if (this.stack.length > 0) {
      return some2(this.stack[this.stack.length - 1].value);
    }
    return none2();
  }
  /**
   * Returns the key
   */
  get entry() {
    return map(last(this.stack), (node) => [node.key, node.value]);
  }
  /**
   * Returns the position of this iterator in the sorted list
   */
  get index() {
    let idx = 0;
    const stack = this.stack;
    if (stack.length === 0) {
      const r = this.self._root;
      if (r != null) {
        return r.count;
      }
      return 0;
    } else if (stack[stack.length - 1].left != null) {
      idx = stack[stack.length - 1].left.count;
    }
    for (let s = stack.length - 2; s >= 0; --s) {
      if (stack[s + 1] === stack[s].right) {
        ++idx;
        if (stack[s].left != null) {
          idx += stack[s].left.count;
        }
      }
    }
    return idx;
  }
  /**
   * Advances iterator to next element in list
   */
  moveNext() {
    const stack = this.stack;
    if (stack.length === 0) {
      return;
    }
    let n = stack[stack.length - 1];
    if (n.right != null) {
      n = n.right;
      while (n != null) {
        stack.push(n);
        n = n.left;
      }
    } else {
      stack.pop();
      while (stack.length > 0 && stack[stack.length - 1].right === n) {
        n = stack[stack.length - 1];
        stack.pop();
      }
    }
  }
  /**
   * Checks if there is a next element
   */
  get hasNext() {
    const stack = this.stack;
    if (stack.length === 0) {
      return false;
    }
    if (stack[stack.length - 1].right != null) {
      return true;
    }
    for (let s = stack.length - 1; s > 0; --s) {
      if (stack[s - 1].left === stack[s]) {
        return true;
      }
    }
    return false;
  }
  /**
   * Advances iterator to previous element in list
   */
  movePrev() {
    const stack = this.stack;
    if (stack.length === 0) {
      return;
    }
    let n = stack[stack.length - 1];
    if (n != null && n.left != null) {
      n = n.left;
      while (n != null) {
        stack.push(n);
        n = n.right;
      }
    } else {
      stack.pop();
      while (stack.length > 0 && stack[stack.length - 1].left === n) {
        n = stack[stack.length - 1];
        stack.pop();
      }
    }
  }
  /**
   * Checks if there is a previous element
   */
  get hasPrev() {
    const stack = this.stack;
    if (stack.length === 0) {
      return false;
    }
    if (stack[stack.length - 1].left != null) {
      return true;
    }
    for (let s = stack.length - 1; s > 0; --s) {
      if (stack[s - 1].right === stack[s]) {
        return true;
      }
    }
    return false;
  }
};

// node_modules/effect/dist/esm/internal/redBlackTree/node.js
var Color = {
  Red: 0,
  Black: 1 << 0
};
var clone = ({
  color,
  count,
  key,
  left: left3,
  right: right3,
  value
}) => ({
  color,
  key,
  value,
  left: left3,
  right: right3,
  count
});
function swap2(n, v) {
  n.key = v.key;
  n.value = v.value;
  n.left = v.left;
  n.right = v.right;
  n.color = v.color;
  n.count = v.count;
}
var repaint = ({
  count,
  key,
  left: left3,
  right: right3,
  value
}, color) => ({
  color,
  key,
  value,
  left: left3,
  right: right3,
  count
});
var recount = (node) => {
  node.count = 1 + (node.left?.count ?? 0) + (node.right?.count ?? 0);
};

// node_modules/effect/dist/esm/internal/redBlackTree.js
var RedBlackTreeSymbolKey = "effect/RedBlackTree";
var RedBlackTreeTypeId = /* @__PURE__ */ Symbol.for(RedBlackTreeSymbolKey);
var redBlackTreeVariance = {
  /* c8 ignore next */
  _Key: (_) => _,
  /* c8 ignore next */
  _Value: (_) => _
};
var RedBlackTreeProto = {
  [RedBlackTreeTypeId]: redBlackTreeVariance,
  [symbol]() {
    let hash2 = hash(RedBlackTreeSymbolKey);
    for (const item of this) {
      hash2 ^= pipe(hash(item[0]), combine(hash(item[1])));
    }
    return cached(this, hash2);
  },
  [symbol2](that) {
    if (isRedBlackTree(that)) {
      if ((this._root?.count ?? 0) !== (that._root?.count ?? 0)) {
        return false;
      }
      const entries2 = Array.from(that);
      return Array.from(this).every((itemSelf, i) => {
        const itemThat = entries2[i];
        return equals(itemSelf[0], itemThat[0]) && equals(itemSelf[1], itemThat[1]);
      });
    }
    return false;
  },
  [Symbol.iterator]() {
    const stack = [];
    let n = this._root;
    while (n != null) {
      stack.push(n);
      n = n.left;
    }
    return new RedBlackTreeIterator(this, stack, Direction.Forward);
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "RedBlackTree",
      values: Array.from(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeImpl3 = (ord, root) => {
  const tree = Object.create(RedBlackTreeProto);
  tree._ord = ord;
  tree._root = root;
  return tree;
};
var isRedBlackTree = (u) => hasProperty(u, RedBlackTreeTypeId);
var findFirst4 = /* @__PURE__ */ dual(2, (self, key) => {
  const cmp = self._ord;
  let node = self._root;
  while (node !== void 0) {
    const d = cmp(key, node.key);
    if (equals(key, node.key)) {
      return some2(node.value);
    }
    if (d <= 0) {
      node = node.left;
    } else {
      node = node.right;
    }
  }
  return none2();
});
var has5 = /* @__PURE__ */ dual(2, (self, key) => isSome2(findFirst4(self, key)));
var insert = /* @__PURE__ */ dual(3, (self, key, value) => {
  const cmp = self._ord;
  let n = self._root;
  const n_stack = [];
  const d_stack = [];
  while (n != null) {
    const d = cmp(key, n.key);
    n_stack.push(n);
    d_stack.push(d);
    if (d <= 0) {
      n = n.left;
    } else {
      n = n.right;
    }
  }
  n_stack.push({
    color: Color.Red,
    key,
    value,
    left: void 0,
    right: void 0,
    count: 1
  });
  for (let s = n_stack.length - 2; s >= 0; --s) {
    const n2 = n_stack[s];
    if (d_stack[s] <= 0) {
      n_stack[s] = {
        color: n2.color,
        key: n2.key,
        value: n2.value,
        left: n_stack[s + 1],
        right: n2.right,
        count: n2.count + 1
      };
    } else {
      n_stack[s] = {
        color: n2.color,
        key: n2.key,
        value: n2.value,
        left: n2.left,
        right: n_stack[s + 1],
        count: n2.count + 1
      };
    }
  }
  for (let s = n_stack.length - 1; s > 1; --s) {
    const p = n_stack[s - 1];
    const n3 = n_stack[s];
    if (p.color === Color.Black || n3.color === Color.Black) {
      break;
    }
    const pp = n_stack[s - 2];
    if (pp.left === p) {
      if (p.left === n3) {
        const y = pp.right;
        if (y && y.color === Color.Red) {
          p.color = Color.Black;
          pp.right = repaint(y, Color.Black);
          pp.color = Color.Red;
          s -= 1;
        } else {
          pp.color = Color.Red;
          pp.left = p.right;
          p.color = Color.Black;
          p.right = pp;
          n_stack[s - 2] = p;
          n_stack[s - 1] = n3;
          recount(pp);
          recount(p);
          if (s >= 3) {
            const ppp = n_stack[s - 3];
            if (ppp.left === pp) {
              ppp.left = p;
            } else {
              ppp.right = p;
            }
          }
          break;
        }
      } else {
        const y = pp.right;
        if (y && y.color === Color.Red) {
          p.color = Color.Black;
          pp.right = repaint(y, Color.Black);
          pp.color = Color.Red;
          s -= 1;
        } else {
          p.right = n3.left;
          pp.color = Color.Red;
          pp.left = n3.right;
          n3.color = Color.Black;
          n3.left = p;
          n3.right = pp;
          n_stack[s - 2] = n3;
          n_stack[s - 1] = p;
          recount(pp);
          recount(p);
          recount(n3);
          if (s >= 3) {
            const ppp = n_stack[s - 3];
            if (ppp.left === pp) {
              ppp.left = n3;
            } else {
              ppp.right = n3;
            }
          }
          break;
        }
      }
    } else {
      if (p.right === n3) {
        const y = pp.left;
        if (y && y.color === Color.Red) {
          p.color = Color.Black;
          pp.left = repaint(y, Color.Black);
          pp.color = Color.Red;
          s -= 1;
        } else {
          pp.color = Color.Red;
          pp.right = p.left;
          p.color = Color.Black;
          p.left = pp;
          n_stack[s - 2] = p;
          n_stack[s - 1] = n3;
          recount(pp);
          recount(p);
          if (s >= 3) {
            const ppp = n_stack[s - 3];
            if (ppp.right === pp) {
              ppp.right = p;
            } else {
              ppp.left = p;
            }
          }
          break;
        }
      } else {
        const y = pp.left;
        if (y && y.color === Color.Red) {
          p.color = Color.Black;
          pp.left = repaint(y, Color.Black);
          pp.color = Color.Red;
          s -= 1;
        } else {
          p.left = n3.right;
          pp.color = Color.Red;
          pp.right = n3.left;
          n3.color = Color.Black;
          n3.right = p;
          n3.left = pp;
          n_stack[s - 2] = n3;
          n_stack[s - 1] = p;
          recount(pp);
          recount(p);
          recount(n3);
          if (s >= 3) {
            const ppp = n_stack[s - 3];
            if (ppp.right === pp) {
              ppp.right = n3;
            } else {
              ppp.left = n3;
            }
          }
          break;
        }
      }
    }
  }
  n_stack[0].color = Color.Black;
  return makeImpl3(self._ord, n_stack[0]);
});
var keysForward = (self) => keys3(self, Direction.Forward);
var keys3 = (self, direction) => {
  const begin = self[Symbol.iterator]();
  let count = 0;
  return {
    [Symbol.iterator]: () => keys3(self, direction),
    next: () => {
      count++;
      const entry = begin.key;
      if (direction === Direction.Forward) {
        begin.moveNext();
      } else {
        begin.movePrev();
      }
      switch (entry._tag) {
        case "None": {
          return {
            done: true,
            value: count
          };
        }
        case "Some": {
          return {
            done: false,
            value: entry.value
          };
        }
      }
    }
  };
};
var removeFirst = /* @__PURE__ */ dual(2, (self, key) => {
  if (!has5(self, key)) {
    return self;
  }
  const ord = self._ord;
  const cmp = ord;
  let node = self._root;
  const stack = [];
  while (node !== void 0) {
    const d = cmp(key, node.key);
    stack.push(node);
    if (equals(key, node.key)) {
      node = void 0;
    } else if (d <= 0) {
      node = node.left;
    } else {
      node = node.right;
    }
  }
  if (stack.length === 0) {
    return self;
  }
  const cstack = new Array(stack.length);
  let n = stack[stack.length - 1];
  cstack[cstack.length - 1] = {
    color: n.color,
    key: n.key,
    value: n.value,
    left: n.left,
    right: n.right,
    count: n.count
  };
  for (let i = stack.length - 2; i >= 0; --i) {
    n = stack[i];
    if (n.left === stack[i + 1]) {
      cstack[i] = {
        color: n.color,
        key: n.key,
        value: n.value,
        left: cstack[i + 1],
        right: n.right,
        count: n.count
      };
    } else {
      cstack[i] = {
        color: n.color,
        key: n.key,
        value: n.value,
        left: n.left,
        right: cstack[i + 1],
        count: n.count
      };
    }
  }
  n = cstack[cstack.length - 1];
  if (n.left !== void 0 && n.right !== void 0) {
    const split = cstack.length;
    n = n.left;
    while (n.right != null) {
      cstack.push(n);
      n = n.right;
    }
    const v = cstack[split - 1];
    cstack.push({
      color: n.color,
      key: v.key,
      value: v.value,
      left: n.left,
      right: n.right,
      count: n.count
    });
    cstack[split - 1].key = n.key;
    cstack[split - 1].value = n.value;
    for (let i = cstack.length - 2; i >= split; --i) {
      n = cstack[i];
      cstack[i] = {
        color: n.color,
        key: n.key,
        value: n.value,
        left: n.left,
        right: cstack[i + 1],
        count: n.count
      };
    }
    cstack[split - 1].left = cstack[split];
  }
  n = cstack[cstack.length - 1];
  if (n.color === Color.Red) {
    const p = cstack[cstack.length - 2];
    if (p.left === n) {
      p.left = void 0;
    } else if (p.right === n) {
      p.right = void 0;
    }
    cstack.pop();
    for (let i = 0; i < cstack.length; ++i) {
      cstack[i].count--;
    }
    return makeImpl3(ord, cstack[0]);
  } else {
    if (n.left !== void 0 || n.right !== void 0) {
      if (n.left !== void 0) {
        swap2(n, n.left);
      } else if (n.right !== void 0) {
        swap2(n, n.right);
      }
      n.color = Color.Black;
      for (let i = 0; i < cstack.length - 1; ++i) {
        cstack[i].count--;
      }
      return makeImpl3(ord, cstack[0]);
    } else if (cstack.length === 1) {
      return makeImpl3(ord, void 0);
    } else {
      for (let i = 0; i < cstack.length; ++i) {
        cstack[i].count--;
      }
      const parent = cstack[cstack.length - 2];
      fixDoubleBlack(cstack);
      if (parent.left === n) {
        parent.left = void 0;
      } else {
        parent.right = void 0;
      }
    }
  }
  return makeImpl3(ord, cstack[0]);
});
var fixDoubleBlack = (stack) => {
  let n, p, s, z;
  for (let i = stack.length - 1; i >= 0; --i) {
    n = stack[i];
    if (i === 0) {
      n.color = Color.Black;
      return;
    }
    p = stack[i - 1];
    if (p.left === n) {
      s = p.right;
      if (s !== void 0 && s.right !== void 0 && s.right.color === Color.Red) {
        s = p.right = clone(s);
        z = s.right = clone(s.right);
        p.right = s.left;
        s.left = p;
        s.right = z;
        s.color = p.color;
        n.color = Color.Black;
        p.color = Color.Black;
        z.color = Color.Black;
        recount(p);
        recount(s);
        if (i > 1) {
          const pp = stack[i - 2];
          if (pp.left === p) {
            pp.left = s;
          } else {
            pp.right = s;
          }
        }
        stack[i - 1] = s;
        return;
      } else if (s !== void 0 && s.left !== void 0 && s.left.color === Color.Red) {
        s = p.right = clone(s);
        z = s.left = clone(s.left);
        p.right = z.left;
        s.left = z.right;
        z.left = p;
        z.right = s;
        z.color = p.color;
        p.color = Color.Black;
        s.color = Color.Black;
        n.color = Color.Black;
        recount(p);
        recount(s);
        recount(z);
        if (i > 1) {
          const pp = stack[i - 2];
          if (pp.left === p) {
            pp.left = z;
          } else {
            pp.right = z;
          }
        }
        stack[i - 1] = z;
        return;
      }
      if (s !== void 0 && s.color === Color.Black) {
        if (p.color === Color.Red) {
          p.color = Color.Black;
          p.right = repaint(s, Color.Red);
          return;
        } else {
          p.right = repaint(s, Color.Red);
          continue;
        }
      } else if (s !== void 0) {
        s = clone(s);
        p.right = s.left;
        s.left = p;
        s.color = p.color;
        p.color = Color.Red;
        recount(p);
        recount(s);
        if (i > 1) {
          const pp = stack[i - 2];
          if (pp.left === p) {
            pp.left = s;
          } else {
            pp.right = s;
          }
        }
        stack[i - 1] = s;
        stack[i] = p;
        if (i + 1 < stack.length) {
          stack[i + 1] = n;
        } else {
          stack.push(n);
        }
        i = i + 2;
      }
    } else {
      s = p.left;
      if (s !== void 0 && s.left !== void 0 && s.left.color === Color.Red) {
        s = p.left = clone(s);
        z = s.left = clone(s.left);
        p.left = s.right;
        s.right = p;
        s.left = z;
        s.color = p.color;
        n.color = Color.Black;
        p.color = Color.Black;
        z.color = Color.Black;
        recount(p);
        recount(s);
        if (i > 1) {
          const pp = stack[i - 2];
          if (pp.right === p) {
            pp.right = s;
          } else {
            pp.left = s;
          }
        }
        stack[i - 1] = s;
        return;
      } else if (s !== void 0 && s.right !== void 0 && s.right.color === Color.Red) {
        s = p.left = clone(s);
        z = s.right = clone(s.right);
        p.left = z.right;
        s.right = z.left;
        z.right = p;
        z.left = s;
        z.color = p.color;
        p.color = Color.Black;
        s.color = Color.Black;
        n.color = Color.Black;
        recount(p);
        recount(s);
        recount(z);
        if (i > 1) {
          const pp = stack[i - 2];
          if (pp.right === p) {
            pp.right = z;
          } else {
            pp.left = z;
          }
        }
        stack[i - 1] = z;
        return;
      }
      if (s !== void 0 && s.color === Color.Black) {
        if (p.color === Color.Red) {
          p.color = Color.Black;
          p.left = repaint(s, Color.Red);
          return;
        } else {
          p.left = repaint(s, Color.Red);
          continue;
        }
      } else if (s !== void 0) {
        s = clone(s);
        p.left = s.right;
        s.right = p;
        s.color = p.color;
        p.color = Color.Red;
        recount(p);
        recount(s);
        if (i > 1) {
          const pp = stack[i - 2];
          if (pp.right === p) {
            pp.right = s;
          } else {
            pp.left = s;
          }
        }
        stack[i - 1] = s;
        stack[i] = p;
        if (i + 1 < stack.length) {
          stack[i + 1] = n;
        } else {
          stack.push(n);
        }
        i = i + 2;
      }
    }
  }
};

// node_modules/effect/dist/esm/RedBlackTree.js
var has6 = has5;
var insert2 = insert;
var keys4 = keysForward;
var removeFirst2 = removeFirst;

// node_modules/effect/dist/esm/SortedSet.js
var TypeId14 = /* @__PURE__ */ Symbol.for("effect/SortedSet");
var SortedSetProto = {
  [TypeId14]: {
    _A: (_) => _
  },
  [symbol]() {
    return pipe(hash(this.keyTree), combine(hash(TypeId14)), cached(this));
  },
  [symbol2](that) {
    return isSortedSet(that) && equals(this.keyTree, that.keyTree);
  },
  [Symbol.iterator]() {
    return keys4(this.keyTree);
  },
  toString() {
    return format(this.toJSON());
  },
  toJSON() {
    return {
      _id: "SortedSet",
      values: Array.from(this).map(toJSON)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromTree = (keyTree) => {
  const a = Object.create(SortedSetProto);
  a.keyTree = keyTree;
  return a;
};
var isSortedSet = (u) => hasProperty(u, TypeId14);
var add5 = /* @__PURE__ */ dual(2, (self, value) => has6(self.keyTree, value) ? self : fromTree(insert2(self.keyTree, value, true)));
var remove7 = /* @__PURE__ */ dual(2, (self, value) => fromTree(removeFirst2(self.keyTree, value)));

// node_modules/effect/dist/esm/internal/supervisor.js
var SupervisorSymbolKey = "effect/Supervisor";
var SupervisorTypeId = /* @__PURE__ */ Symbol.for(SupervisorSymbolKey);
var supervisorVariance = {
  /* c8 ignore next */
  _T: (_) => _
};
var ProxySupervisor = class _ProxySupervisor {
  underlying;
  value0;
  [SupervisorTypeId] = supervisorVariance;
  constructor(underlying, value0) {
    this.underlying = underlying;
    this.value0 = value0;
  }
  get value() {
    return this.value0;
  }
  onStart(context4, effect, parent, fiber) {
    this.underlying.onStart(context4, effect, parent, fiber);
  }
  onEnd(value, fiber) {
    this.underlying.onEnd(value, fiber);
  }
  onEffect(fiber, effect) {
    this.underlying.onEffect(fiber, effect);
  }
  onSuspend(fiber) {
    this.underlying.onSuspend(fiber);
  }
  onResume(fiber) {
    this.underlying.onResume(fiber);
  }
  map(f) {
    return new _ProxySupervisor(this, pipe(this.value, map8(f)));
  }
  zip(right3) {
    return new Zip(this, right3);
  }
};
var Zip = class _Zip {
  left;
  right;
  _tag = "Zip";
  [SupervisorTypeId] = supervisorVariance;
  constructor(left3, right3) {
    this.left = left3;
    this.right = right3;
  }
  get value() {
    return zip2(this.left.value, this.right.value);
  }
  onStart(context4, effect, parent, fiber) {
    this.left.onStart(context4, effect, parent, fiber);
    this.right.onStart(context4, effect, parent, fiber);
  }
  onEnd(value, fiber) {
    this.left.onEnd(value, fiber);
    this.right.onEnd(value, fiber);
  }
  onEffect(fiber, effect) {
    this.left.onEffect(fiber, effect);
    this.right.onEffect(fiber, effect);
  }
  onSuspend(fiber) {
    this.left.onSuspend(fiber);
    this.right.onSuspend(fiber);
  }
  onResume(fiber) {
    this.left.onResume(fiber);
    this.right.onResume(fiber);
  }
  map(f) {
    return new ProxySupervisor(this, pipe(this.value, map8(f)));
  }
  zip(right3) {
    return new _Zip(this, right3);
  }
};
var isZip = (self) => hasProperty(self, SupervisorTypeId) && isTagged(self, "Zip");
var Track = class {
  [SupervisorTypeId] = supervisorVariance;
  fibers = /* @__PURE__ */ new Set();
  get value() {
    return sync(() => Array.from(this.fibers));
  }
  onStart(_context, _effect, _parent, fiber) {
    this.fibers.add(fiber);
  }
  onEnd(_value, fiber) {
    this.fibers.delete(fiber);
  }
  onEffect(_fiber, _effect) {
  }
  onSuspend(_fiber) {
  }
  onResume(_fiber) {
  }
  map(f) {
    return new ProxySupervisor(this, pipe(this.value, map8(f)));
  }
  zip(right3) {
    return new Zip(this, right3);
  }
  onRun(execution, _fiber) {
    return execution();
  }
};
var Const = class {
  effect;
  [SupervisorTypeId] = supervisorVariance;
  constructor(effect) {
    this.effect = effect;
  }
  get value() {
    return this.effect;
  }
  onStart(_context, _effect, _parent, _fiber) {
  }
  onEnd(_value, _fiber) {
  }
  onEffect(_fiber, _effect) {
  }
  onSuspend(_fiber) {
  }
  onResume(_fiber) {
  }
  map(f) {
    return new ProxySupervisor(this, pipe(this.value, map8(f)));
  }
  zip(right3) {
    return new Zip(this, right3);
  }
  onRun(execution, _fiber) {
    return execution();
  }
};
var FibersIn = class {
  ref;
  [SupervisorTypeId] = supervisorVariance;
  constructor(ref) {
    this.ref = ref;
  }
  get value() {
    return sync(() => get6(this.ref));
  }
  onStart(_context, _effect, _parent, fiber) {
    pipe(this.ref, set2(pipe(get6(this.ref), add5(fiber))));
  }
  onEnd(_value, fiber) {
    pipe(this.ref, set2(pipe(get6(this.ref), remove7(fiber))));
  }
  onEffect(_fiber, _effect) {
  }
  onSuspend(_fiber) {
  }
  onResume(_fiber) {
  }
  map(f) {
    return new ProxySupervisor(this, pipe(this.value, map8(f)));
  }
  zip(right3) {
    return new Zip(this, right3);
  }
  onRun(execution, _fiber) {
    return execution();
  }
};
var unsafeTrack = () => {
  return new Track();
};
var track = /* @__PURE__ */ sync(unsafeTrack);
var fromEffect = (effect) => {
  return new Const(effect);
};
var none8 = /* @__PURE__ */ globalValue("effect/Supervisor/none", () => fromEffect(void_));

// node_modules/effect/dist/esm/Differ.js
var make33 = make14;

// node_modules/effect/dist/esm/internal/supervisor/patch.js
var OP_EMPTY3 = "Empty";
var OP_ADD_SUPERVISOR = "AddSupervisor";
var OP_REMOVE_SUPERVISOR = "RemoveSupervisor";
var OP_AND_THEN2 = "AndThen";
var empty25 = {
  _tag: OP_EMPTY3
};
var combine8 = (self, that) => {
  return {
    _tag: OP_AND_THEN2,
    first: self,
    second: that
  };
};
var patch8 = (self, supervisor) => {
  return patchLoop(supervisor, of2(self));
};
var patchLoop = (_supervisor, _patches) => {
  let supervisor = _supervisor;
  let patches = _patches;
  while (isNonEmpty(patches)) {
    const head5 = headNonEmpty2(patches);
    switch (head5._tag) {
      case OP_EMPTY3: {
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_ADD_SUPERVISOR: {
        supervisor = supervisor.zip(head5.supervisor);
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_REMOVE_SUPERVISOR: {
        supervisor = removeSupervisor(supervisor, head5.supervisor);
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_AND_THEN2: {
        patches = prepend2(head5.first)(prepend2(head5.second)(tailNonEmpty2(patches)));
        break;
      }
    }
  }
  return supervisor;
};
var removeSupervisor = (self, that) => {
  if (equals(self, that)) {
    return none8;
  } else {
    if (isZip(self)) {
      return removeSupervisor(self.left, that).zip(removeSupervisor(self.right, that));
    } else {
      return self;
    }
  }
};
var toSet2 = (self) => {
  if (equals(self, none8)) {
    return empty7();
  } else {
    if (isZip(self)) {
      return pipe(toSet2(self.left), union3(toSet2(self.right)));
    } else {
      return make10(self);
    }
  }
};
var diff7 = (oldValue, newValue) => {
  if (equals(oldValue, newValue)) {
    return empty25;
  }
  const oldSupervisors = toSet2(oldValue);
  const newSupervisors = toSet2(newValue);
  const added = pipe(newSupervisors, difference3(oldSupervisors), reduce4(empty25, (patch9, supervisor) => combine8(patch9, {
    _tag: OP_ADD_SUPERVISOR,
    supervisor
  })));
  const removed = pipe(oldSupervisors, difference3(newSupervisors), reduce4(empty25, (patch9, supervisor) => combine8(patch9, {
    _tag: OP_REMOVE_SUPERVISOR,
    supervisor
  })));
  return combine8(added, removed);
};
var differ2 = /* @__PURE__ */ make33({
  empty: empty25,
  patch: patch8,
  combine: combine8,
  diff: diff7
});

// node_modules/effect/dist/esm/internal/fiberRuntime.js
var fiberStarted = /* @__PURE__ */ counter5("effect_fiber_started", {
  incremental: true
});
var fiberActive = /* @__PURE__ */ counter5("effect_fiber_active");
var fiberSuccesses = /* @__PURE__ */ counter5("effect_fiber_successes", {
  incremental: true
});
var fiberFailures = /* @__PURE__ */ counter5("effect_fiber_failures", {
  incremental: true
});
var fiberLifetimes = /* @__PURE__ */ tagged(/* @__PURE__ */ histogram5("effect_fiber_lifetimes", /* @__PURE__ */ exponential({
  start: 0.5,
  factor: 2,
  count: 35
})), "time_unit", "milliseconds");
var EvaluationSignalContinue = "Continue";
var EvaluationSignalDone = "Done";
var EvaluationSignalYieldNow = "Yield";
var runtimeFiberVariance = {
  /* c8 ignore next */
  _E: (_) => _,
  /* c8 ignore next */
  _A: (_) => _
};
var absurd = (_) => {
  throw new Error(`BUG: FiberRuntime - ${toStringUnknown(_)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
};
var YieldedOp = /* @__PURE__ */ Symbol.for("effect/internal/fiberRuntime/YieldedOp");
var yieldedOpChannel = /* @__PURE__ */ globalValue("effect/internal/fiberRuntime/yieldedOpChannel", () => ({
  currentOp: null
}));
var contOpSuccess = {
  [OP_ON_SUCCESS]: (_, cont, value) => {
    return internalCall(() => cont.effect_instruction_i1(value));
  },
  ["OnStep"]: (_, _cont, value) => {
    return exitSucceed(exitSucceed(value));
  },
  [OP_ON_SUCCESS_AND_FAILURE]: (_, cont, value) => {
    return internalCall(() => cont.effect_instruction_i2(value));
  },
  [OP_REVERT_FLAGS]: (self, cont, value) => {
    self.patchRuntimeFlags(self.currentRuntimeFlags, cont.patch);
    if (interruptible(self.currentRuntimeFlags) && self.isInterrupted()) {
      return exitFailCause(self.getInterruptedCause());
    } else {
      return exitSucceed(value);
    }
  },
  [OP_WHILE]: (self, cont, value) => {
    internalCall(() => cont.effect_instruction_i2(value));
    if (internalCall(() => cont.effect_instruction_i0())) {
      self.pushStack(cont);
      return internalCall(() => cont.effect_instruction_i1());
    } else {
      return void_;
    }
  },
  [OP_ITERATOR]: (self, cont, value) => {
    while (true) {
      const state = internalCall(() => cont.effect_instruction_i0.next(value));
      if (state.done) {
        return exitSucceed(state.value);
      }
      const primitive = yieldWrapGet(state.value);
      if (!exitIsExit(primitive)) {
        self.pushStack(cont);
        return primitive;
      } else if (primitive._tag === "Failure") {
        return primitive;
      }
      value = primitive.value;
    }
  }
};
var drainQueueWhileRunningTable = {
  [OP_INTERRUPT_SIGNAL]: (self, runtimeFlags2, cur, message) => {
    self.processNewInterruptSignal(message.cause);
    return interruptible(runtimeFlags2) ? exitFailCause(message.cause) : cur;
  },
  [OP_RESUME]: (_self, _runtimeFlags, _cur, _message) => {
    throw new Error("It is illegal to have multiple concurrent run loops in a single fiber");
  },
  [OP_STATEFUL]: (self, runtimeFlags2, cur, message) => {
    message.onFiber(self, running2(runtimeFlags2));
    return cur;
  },
  [OP_YIELD_NOW]: (_self, _runtimeFlags, cur, _message) => {
    return flatMap7(yieldNow(), () => cur);
  }
};
var runBlockedRequests = (self) => forEachSequentialDiscard(flatten2(self), (requestsByRequestResolver) => forEachConcurrentDiscard(sequentialCollectionToChunk(requestsByRequestResolver), ([dataSource, sequential5]) => {
  const map14 = /* @__PURE__ */ new Map();
  const arr = [];
  for (const block of sequential5) {
    arr.push(toReadonlyArray(block));
    for (const entry of block) {
      map14.set(entry.request, entry);
    }
  }
  const flat = arr.flat();
  return fiberRefLocally(invokeWithInterrupt(dataSource.runAll(arr), flat, () => flat.forEach((entry) => {
    entry.listeners.interrupted = true;
  })), currentRequestMap, map14);
}, false, false));
var _version = /* @__PURE__ */ getCurrentVersion();
var FiberRuntime = class extends Class2 {
  [FiberTypeId] = fiberVariance2;
  [RuntimeFiberTypeId] = runtimeFiberVariance;
  _fiberRefs;
  _fiberId;
  _queue = /* @__PURE__ */ new Array();
  _children = null;
  _observers = /* @__PURE__ */ new Array();
  _running = false;
  _stack = [];
  _asyncInterruptor = null;
  _asyncBlockingOn = null;
  _exitValue = null;
  _steps = [];
  _isYielding = false;
  currentRuntimeFlags;
  currentOpCount = 0;
  currentSupervisor;
  currentScheduler;
  currentTracer;
  currentSpan;
  currentContext;
  currentDefaultServices;
  constructor(fiberId3, fiberRefs0, runtimeFlags0) {
    super();
    this.currentRuntimeFlags = runtimeFlags0;
    this._fiberId = fiberId3;
    this._fiberRefs = fiberRefs0;
    if (runtimeMetrics(runtimeFlags0)) {
      const tags = this.getFiberRef(currentMetricLabels);
      fiberStarted.unsafeUpdate(1, tags);
      fiberActive.unsafeUpdate(1, tags);
    }
    this.refreshRefCache();
  }
  commit() {
    return join2(this);
  }
  /**
   * The identity of the fiber.
   */
  id() {
    return this._fiberId;
  }
  /**
   * Begins execution of the effect associated with this fiber on in the
   * background. This can be called to "kick off" execution of a fiber after
   * it has been created.
   */
  resume(effect) {
    this.tell(resume(effect));
  }
  /**
   * The status of the fiber.
   */
  get status() {
    return this.ask((_, status) => status);
  }
  /**
   * Gets the fiber runtime flags.
   */
  get runtimeFlags() {
    return this.ask((state, status) => {
      if (isDone2(status)) {
        return state.currentRuntimeFlags;
      }
      return status.runtimeFlags;
    });
  }
  /**
   * Returns the current `FiberScope` for the fiber.
   */
  scope() {
    return unsafeMake6(this);
  }
  /**
   * Retrieves the immediate children of the fiber.
   */
  get children() {
    return this.ask((fiber) => Array.from(fiber.getChildren()));
  }
  /**
   * Gets the fiber's set of children.
   */
  getChildren() {
    if (this._children === null) {
      this._children = /* @__PURE__ */ new Set();
    }
    return this._children;
  }
  /**
   * Retrieves the interrupted cause of the fiber, which will be `Cause.empty`
   * if the fiber has not been interrupted.
   *
   * **NOTE**: This method is safe to invoke on any fiber, but if not invoked
   * on this fiber, then values derived from the fiber's state (including the
   * log annotations and log level) may not be up-to-date.
   */
  getInterruptedCause() {
    return this.getFiberRef(currentInterruptedCause);
  }
  /**
   * Retrieves the whole set of fiber refs.
   */
  fiberRefs() {
    return this.ask((fiber) => fiber.getFiberRefs());
  }
  /**
   * Returns an effect that will contain information computed from the fiber
   * state and status while running on the fiber.
   *
   * This allows the outside world to interact safely with mutable fiber state
   * without locks or immutable data.
   */
  ask(f) {
    return suspend(() => {
      const deferred = deferredUnsafeMake(this._fiberId);
      this.tell(stateful((fiber, status) => {
        deferredUnsafeDone(deferred, sync(() => f(fiber, status)));
      }));
      return deferredAwait(deferred);
    });
  }
  /**
   * Adds a message to be processed by the fiber on the fiber.
   */
  tell(message) {
    this._queue.push(message);
    if (!this._running) {
      this._running = true;
      this.drainQueueLaterOnExecutor();
    }
  }
  get await() {
    return async_((resume2) => {
      const cb = (exit4) => resume2(succeed(exit4));
      if (this._exitValue !== null) {
        cb(this._exitValue);
        return;
      }
      this.tell(stateful((fiber, _) => {
        if (fiber._exitValue !== null) {
          cb(this._exitValue);
        } else {
          fiber.addObserver(cb);
        }
      }));
      return sync(() => this.tell(stateful((fiber, _) => {
        fiber.removeObserver(cb);
      })));
    }, this.id());
  }
  get inheritAll() {
    return withFiberRuntime((parentFiber, parentStatus) => {
      const parentFiberId = parentFiber.id();
      const parentFiberRefs = parentFiber.getFiberRefs();
      const parentRuntimeFlags = parentStatus.runtimeFlags;
      const childFiberRefs = this.getFiberRefs();
      const updatedFiberRefs = joinAs(parentFiberRefs, parentFiberId, childFiberRefs);
      parentFiber.setFiberRefs(updatedFiberRefs);
      const updatedRuntimeFlags = parentFiber.getFiberRef(currentRuntimeFlags);
      const patch9 = pipe(
        diff4(parentRuntimeFlags, updatedRuntimeFlags),
        // Do not inherit WindDown or Interruption!
        exclude2(Interruption),
        exclude2(WindDown)
      );
      return updateRuntimeFlags(patch9);
    });
  }
  /**
   * Tentatively observes the fiber, but returns immediately if it is not
   * already done.
   */
  get poll() {
    return sync(() => fromNullable(this._exitValue));
  }
  /**
   * Unsafely observes the fiber, but returns immediately if it is not
   * already done.
   */
  unsafePoll() {
    return this._exitValue;
  }
  /**
   * In the background, interrupts the fiber as if interrupted from the specified fiber.
   */
  interruptAsFork(fiberId3) {
    return sync(() => this.tell(interruptSignal(interrupt(fiberId3))));
  }
  /**
   * In the background, interrupts the fiber as if interrupted from the specified fiber.
   */
  unsafeInterruptAsFork(fiberId3) {
    this.tell(interruptSignal(interrupt(fiberId3)));
  }
  /**
   * Adds an observer to the list of observers.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  addObserver(observer) {
    if (this._exitValue !== null) {
      observer(this._exitValue);
    } else {
      this._observers.push(observer);
    }
  }
  /**
   * Removes the specified observer from the list of observers that will be
   * notified when the fiber exits.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  removeObserver(observer) {
    this._observers = this._observers.filter((o) => o !== observer);
  }
  /**
   * Retrieves all fiber refs of the fiber.
   *
   * **NOTE**: This method is safe to invoke on any fiber, but if not invoked
   * on this fiber, then values derived from the fiber's state (including the
   * log annotations and log level) may not be up-to-date.
   */
  getFiberRefs() {
    this.setFiberRef(currentRuntimeFlags, this.currentRuntimeFlags);
    return this._fiberRefs;
  }
  /**
   * Deletes the specified fiber ref.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  unsafeDeleteFiberRef(fiberRef) {
    this._fiberRefs = delete_(this._fiberRefs, fiberRef);
  }
  /**
   * Retrieves the state of the fiber ref, or else its initial value.
   *
   * **NOTE**: This method is safe to invoke on any fiber, but if not invoked
   * on this fiber, then values derived from the fiber's state (including the
   * log annotations and log level) may not be up-to-date.
   */
  getFiberRef(fiberRef) {
    if (this._fiberRefs.locals.has(fiberRef)) {
      return this._fiberRefs.locals.get(fiberRef)[0][1];
    }
    return fiberRef.initial;
  }
  /**
   * Sets the fiber ref to the specified value.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  setFiberRef(fiberRef, value) {
    this._fiberRefs = updateAs(this._fiberRefs, {
      fiberId: this._fiberId,
      fiberRef,
      value
    });
    this.refreshRefCache();
  }
  refreshRefCache() {
    this.currentDefaultServices = this.getFiberRef(currentServices);
    this.currentTracer = this.currentDefaultServices.unsafeMap.get(tracerTag.key);
    this.currentSupervisor = this.getFiberRef(currentSupervisor);
    this.currentScheduler = this.getFiberRef(currentScheduler);
    this.currentContext = this.getFiberRef(currentContext);
    this.currentSpan = this.currentContext.unsafeMap.get(spanTag.key);
  }
  /**
   * Wholesale replaces all fiber refs of this fiber.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  setFiberRefs(fiberRefs3) {
    this._fiberRefs = fiberRefs3;
    this.refreshRefCache();
  }
  /**
   * Adds a reference to the specified fiber inside the children set.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  addChild(child) {
    this.getChildren().add(child);
  }
  /**
   * Removes a reference to the specified fiber inside the children set.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  removeChild(child) {
    this.getChildren().delete(child);
  }
  /**
   * Transfers all children of this fiber that are currently running to the
   * specified fiber scope.
   *
   * **NOTE**: This method must be invoked by the fiber itself after it has
   * evaluated the effects but prior to exiting.
   */
  transferChildren(scope3) {
    const children = this._children;
    this._children = null;
    if (children !== null && children.size > 0) {
      for (const child of children) {
        if (child._exitValue === null) {
          scope3.add(this.currentRuntimeFlags, child);
        }
      }
    }
  }
  /**
   * On the current thread, executes all messages in the fiber's inbox. This
   * method may return before all work is done, in the event the fiber executes
   * an asynchronous operation.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  drainQueueOnCurrentThread() {
    let recurse = true;
    while (recurse) {
      let evaluationSignal = EvaluationSignalContinue;
      const prev = globalThis[currentFiberURI];
      globalThis[currentFiberURI] = this;
      try {
        while (evaluationSignal === EvaluationSignalContinue) {
          evaluationSignal = this._queue.length === 0 ? EvaluationSignalDone : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
        }
      } finally {
        this._running = false;
        globalThis[currentFiberURI] = prev;
      }
      if (this._queue.length > 0 && !this._running) {
        this._running = true;
        if (evaluationSignal === EvaluationSignalYieldNow) {
          this.drainQueueLaterOnExecutor();
          recurse = false;
        } else {
          recurse = true;
        }
      } else {
        recurse = false;
      }
    }
  }
  /**
   * Schedules the execution of all messages in the fiber's inbox.
   *
   * This method will return immediately after the scheduling
   * operation is completed, but potentially before such messages have been
   * executed.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  drainQueueLaterOnExecutor() {
    this.currentScheduler.scheduleTask(this.run, this.getFiberRef(currentSchedulingPriority), this);
  }
  /**
   * Drains the fiber's message queue while the fiber is actively running,
   * returning the next effect to execute, which may be the input effect if no
   * additional effect needs to be executed.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  drainQueueWhileRunning(runtimeFlags2, cur0) {
    let cur = cur0;
    while (this._queue.length > 0) {
      const message = this._queue.splice(0, 1)[0];
      cur = drainQueueWhileRunningTable[message._tag](this, runtimeFlags2, cur, message);
    }
    return cur;
  }
  /**
   * Determines if the fiber is interrupted.
   *
   * **NOTE**: This method is safe to invoke on any fiber, but if not invoked
   * on this fiber, then values derived from the fiber's state (including the
   * log annotations and log level) may not be up-to-date.
   */
  isInterrupted() {
    return !isEmpty5(this.getFiberRef(currentInterruptedCause));
  }
  /**
   * Adds an interruptor to the set of interruptors that are interrupting this
   * fiber.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  addInterruptedCause(cause3) {
    const oldSC = this.getFiberRef(currentInterruptedCause);
    this.setFiberRef(currentInterruptedCause, sequential(oldSC, cause3));
  }
  /**
   * Processes a new incoming interrupt signal.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  processNewInterruptSignal(cause3) {
    this.addInterruptedCause(cause3);
    this.sendInterruptSignalToAllChildren();
  }
  /**
   * Interrupts all children of the current fiber, returning an effect that will
   * await the exit of the children. This method will return null if the fiber
   * has no children.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  sendInterruptSignalToAllChildren() {
    if (this._children === null || this._children.size === 0) {
      return false;
    }
    let told = false;
    for (const child of this._children) {
      child.tell(interruptSignal(interrupt(this.id())));
      told = true;
    }
    return told;
  }
  /**
   * Interrupts all children of the current fiber, returning an effect that will
   * await the exit of the children. This method will return null if the fiber
   * has no children.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  interruptAllChildren() {
    if (this.sendInterruptSignalToAllChildren()) {
      const it = this._children.values();
      this._children = null;
      let isDone5 = false;
      const body = () => {
        const next = it.next();
        if (!next.done) {
          return asVoid(next.value.await);
        } else {
          return sync(() => {
            isDone5 = true;
          });
        }
      };
      return whileLoop({
        while: () => !isDone5,
        body,
        step: () => {
        }
      });
    }
    return null;
  }
  reportExitValue(exit4) {
    if (runtimeMetrics(this.currentRuntimeFlags)) {
      const tags = this.getFiberRef(currentMetricLabels);
      const startTimeMillis = this.id().startTimeMillis;
      const endTimeMillis = Date.now();
      fiberLifetimes.unsafeUpdate(endTimeMillis - startTimeMillis, tags);
      fiberActive.unsafeUpdate(-1, tags);
      switch (exit4._tag) {
        case OP_SUCCESS: {
          fiberSuccesses.unsafeUpdate(1, tags);
          break;
        }
        case OP_FAILURE: {
          fiberFailures.unsafeUpdate(1, tags);
          break;
        }
      }
    }
    if (exit4._tag === "Failure") {
      const level = this.getFiberRef(currentUnhandledErrorLogLevel);
      if (!isInterruptedOnly(exit4.cause) && level._tag === "Some") {
        this.log("Fiber terminated with an unhandled error", exit4.cause, level);
      }
    }
  }
  setExitValue(exit4) {
    this._exitValue = exit4;
    this.reportExitValue(exit4);
    for (let i = this._observers.length - 1; i >= 0; i--) {
      this._observers[i](exit4);
    }
    this._observers = [];
  }
  getLoggers() {
    return this.getFiberRef(currentLoggers);
  }
  log(message, cause3, overrideLogLevel) {
    const logLevel = isSome2(overrideLogLevel) ? overrideLogLevel.value : this.getFiberRef(currentLogLevel);
    const minimumLogLevel = this.getFiberRef(currentMinimumLogLevel);
    if (greaterThan3(minimumLogLevel, logLevel)) {
      return;
    }
    const spans = this.getFiberRef(currentLogSpan);
    const annotations = this.getFiberRef(currentLogAnnotations);
    const loggers = this.getLoggers();
    const contextMap = this.getFiberRefs();
    if (size3(loggers) > 0) {
      const clockService = get3(this.getFiberRef(currentServices), clockTag);
      const date = new Date(clockService.unsafeCurrentTimeMillis());
      withRedactableContext(contextMap, () => {
        for (const logger of loggers) {
          logger.log({
            fiberId: this.id(),
            logLevel,
            message,
            cause: cause3,
            context: contextMap,
            spans,
            annotations,
            date
          });
        }
      });
    }
  }
  /**
   * Evaluates a single message on the current thread, while the fiber is
   * suspended. This method should only be called while evaluation of the
   * fiber's effect is suspended due to an asynchronous operation.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  evaluateMessageWhileSuspended(message) {
    switch (message._tag) {
      case OP_YIELD_NOW: {
        return EvaluationSignalYieldNow;
      }
      case OP_INTERRUPT_SIGNAL: {
        this.processNewInterruptSignal(message.cause);
        if (this._asyncInterruptor !== null) {
          this._asyncInterruptor(exitFailCause(message.cause));
          this._asyncInterruptor = null;
        }
        return EvaluationSignalContinue;
      }
      case OP_RESUME: {
        this._asyncInterruptor = null;
        this._asyncBlockingOn = null;
        this.evaluateEffect(message.effect);
        return EvaluationSignalContinue;
      }
      case OP_STATEFUL: {
        message.onFiber(this, this._exitValue !== null ? done4 : suspended2(this.currentRuntimeFlags, this._asyncBlockingOn));
        return EvaluationSignalContinue;
      }
      default: {
        return absurd(message);
      }
    }
  }
  /**
   * Evaluates an effect until completion, potentially asynchronously.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  evaluateEffect(effect0) {
    this.currentSupervisor.onResume(this);
    try {
      let effect = interruptible(this.currentRuntimeFlags) && this.isInterrupted() ? exitFailCause(this.getInterruptedCause()) : effect0;
      while (effect !== null) {
        const eff = effect;
        const exit4 = this.runLoop(eff);
        if (exit4 === YieldedOp) {
          const op = yieldedOpChannel.currentOp;
          yieldedOpChannel.currentOp = null;
          if (op._op === OP_YIELD) {
            if (cooperativeYielding(this.currentRuntimeFlags)) {
              this.tell(yieldNow3());
              this.tell(resume(exitVoid));
              effect = null;
            } else {
              effect = exitVoid;
            }
          } else if (op._op === OP_ASYNC) {
            effect = null;
          }
        } else {
          this.currentRuntimeFlags = pipe(this.currentRuntimeFlags, enable2(WindDown));
          const interruption2 = this.interruptAllChildren();
          if (interruption2 !== null) {
            effect = flatMap7(interruption2, () => exit4);
          } else {
            if (this._queue.length === 0) {
              this.setExitValue(exit4);
            } else {
              this.tell(resume(exit4));
            }
            effect = null;
          }
        }
      }
    } finally {
      this.currentSupervisor.onSuspend(this);
    }
  }
  /**
   * Begins execution of the effect associated with this fiber on the current
   * thread. This can be called to "kick off" execution of a fiber after it has
   * been created, in hopes that the effect can be executed synchronously.
   *
   * This is not the normal way of starting a fiber, but it is useful when the
   * express goal of executing the fiber is to synchronously produce its exit.
   */
  start(effect) {
    if (!this._running) {
      this._running = true;
      const prev = globalThis[currentFiberURI];
      globalThis[currentFiberURI] = this;
      try {
        this.evaluateEffect(effect);
      } finally {
        this._running = false;
        globalThis[currentFiberURI] = prev;
        if (this._queue.length > 0) {
          this.drainQueueLaterOnExecutor();
        }
      }
    } else {
      this.tell(resume(effect));
    }
  }
  /**
   * Begins execution of the effect associated with this fiber on in the
   * background, and on the correct thread pool. This can be called to "kick
   * off" execution of a fiber after it has been created, in hopes that the
   * effect can be executed synchronously.
   */
  startFork(effect) {
    this.tell(resume(effect));
  }
  /**
   * Takes the current runtime flags, patches them to return the new runtime
   * flags, and then makes any changes necessary to fiber state based on the
   * specified patch.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  patchRuntimeFlags(oldRuntimeFlags, patch9) {
    const newRuntimeFlags = patch4(oldRuntimeFlags, patch9);
    globalThis[currentFiberURI] = this;
    this.currentRuntimeFlags = newRuntimeFlags;
    return newRuntimeFlags;
  }
  /**
   * Initiates an asynchronous operation, by building a callback that will
   * resume execution, and then feeding that callback to the registration
   * function, handling error cases and repeated resumptions appropriately.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  initiateAsync(runtimeFlags2, asyncRegister) {
    let alreadyCalled = false;
    const callback = (effect) => {
      if (!alreadyCalled) {
        alreadyCalled = true;
        this.tell(resume(effect));
      }
    };
    if (interruptible(runtimeFlags2)) {
      this._asyncInterruptor = callback;
    }
    try {
      asyncRegister(callback);
    } catch (e) {
      callback(failCause(die(e)));
    }
  }
  pushStack(cont) {
    this._stack.push(cont);
    if (cont._op === "OnStep") {
      this._steps.push({
        refs: this.getFiberRefs(),
        flags: this.currentRuntimeFlags
      });
    }
  }
  popStack() {
    const item = this._stack.pop();
    if (item) {
      if (item._op === "OnStep") {
        this._steps.pop();
      }
      return item;
    }
    return;
  }
  getNextSuccessCont() {
    let frame = this.popStack();
    while (frame) {
      if (frame._op !== OP_ON_FAILURE) {
        return frame;
      }
      frame = this.popStack();
    }
  }
  getNextFailCont() {
    let frame = this.popStack();
    while (frame) {
      if (frame._op !== OP_ON_SUCCESS && frame._op !== OP_WHILE && frame._op !== OP_ITERATOR) {
        return frame;
      }
      frame = this.popStack();
    }
  }
  [OP_TAG](op) {
    return sync(() => unsafeGet3(this.currentContext, op));
  }
  ["Left"](op) {
    return fail2(op.left);
  }
  ["None"](_) {
    return fail2(new NoSuchElementException());
  }
  ["Right"](op) {
    return exitSucceed(op.right);
  }
  ["Some"](op) {
    return exitSucceed(op.value);
  }
  ["Micro"](op) {
    return unsafeAsync((microResume) => {
      let resume2 = microResume;
      const fiber = runFork(provideContext2(op, this.currentContext));
      fiber.addObserver((exit4) => {
        if (exit4._tag === "Success") {
          return resume2(exitSucceed(exit4.value));
        }
        switch (exit4.cause._tag) {
          case "Interrupt": {
            return resume2(exitFailCause(interrupt(none4)));
          }
          case "Fail": {
            return resume2(fail2(exit4.cause.error));
          }
          case "Die": {
            return resume2(die2(exit4.cause.defect));
          }
        }
      });
      return unsafeAsync((abortResume) => {
        resume2 = (_) => {
          abortResume(void_);
        };
        fiber.unsafeInterrupt();
      });
    });
  }
  [OP_SYNC](op) {
    const value = internalCall(() => op.effect_instruction_i0());
    const cont = this.getNextSuccessCont();
    if (cont !== void 0) {
      if (!(cont._op in contOpSuccess)) {
        absurd(cont);
      }
      return contOpSuccess[cont._op](this, cont, value);
    } else {
      yieldedOpChannel.currentOp = exitSucceed(value);
      return YieldedOp;
    }
  }
  [OP_SUCCESS](op) {
    const oldCur = op;
    const cont = this.getNextSuccessCont();
    if (cont !== void 0) {
      if (!(cont._op in contOpSuccess)) {
        absurd(cont);
      }
      return contOpSuccess[cont._op](this, cont, oldCur.effect_instruction_i0);
    } else {
      yieldedOpChannel.currentOp = oldCur;
      return YieldedOp;
    }
  }
  [OP_FAILURE](op) {
    const cause3 = op.effect_instruction_i0;
    const cont = this.getNextFailCont();
    if (cont !== void 0) {
      switch (cont._op) {
        case OP_ON_FAILURE:
        case OP_ON_SUCCESS_AND_FAILURE: {
          if (!(interruptible(this.currentRuntimeFlags) && this.isInterrupted())) {
            return internalCall(() => cont.effect_instruction_i1(cause3));
          } else {
            return exitFailCause(stripFailures(cause3));
          }
        }
        case "OnStep": {
          if (!(interruptible(this.currentRuntimeFlags) && this.isInterrupted())) {
            return exitSucceed(exitFailCause(cause3));
          } else {
            return exitFailCause(stripFailures(cause3));
          }
        }
        case OP_REVERT_FLAGS: {
          this.patchRuntimeFlags(this.currentRuntimeFlags, cont.patch);
          if (interruptible(this.currentRuntimeFlags) && this.isInterrupted()) {
            return exitFailCause(sequential(cause3, this.getInterruptedCause()));
          } else {
            return exitFailCause(cause3);
          }
        }
        default: {
          absurd(cont);
        }
      }
    } else {
      yieldedOpChannel.currentOp = exitFailCause(cause3);
      return YieldedOp;
    }
  }
  [OP_WITH_RUNTIME](op) {
    return internalCall(() => op.effect_instruction_i0(this, running2(this.currentRuntimeFlags)));
  }
  ["Blocked"](op) {
    const refs = this.getFiberRefs();
    const flags = this.currentRuntimeFlags;
    if (this._steps.length > 0) {
      const frames = [];
      const snap = this._steps[this._steps.length - 1];
      let frame = this.popStack();
      while (frame && frame._op !== "OnStep") {
        frames.push(frame);
        frame = this.popStack();
      }
      this.setFiberRefs(snap.refs);
      this.currentRuntimeFlags = snap.flags;
      const patchRefs = diff6(snap.refs, refs);
      const patchFlags = diff4(snap.flags, flags);
      return exitSucceed(blocked(op.effect_instruction_i0, withFiberRuntime((newFiber) => {
        while (frames.length > 0) {
          newFiber.pushStack(frames.pop());
        }
        newFiber.setFiberRefs(patch7(newFiber.id(), newFiber.getFiberRefs())(patchRefs));
        newFiber.currentRuntimeFlags = patch4(patchFlags)(newFiber.currentRuntimeFlags);
        return op.effect_instruction_i1;
      })));
    }
    return uninterruptibleMask((restore) => flatMap7(forkDaemon(runRequestBlock(op.effect_instruction_i0)), () => restore(op.effect_instruction_i1)));
  }
  ["RunBlocked"](op) {
    return runBlockedRequests(op.effect_instruction_i0);
  }
  [OP_UPDATE_RUNTIME_FLAGS](op) {
    const updateFlags = op.effect_instruction_i0;
    const oldRuntimeFlags = this.currentRuntimeFlags;
    const newRuntimeFlags = patch4(oldRuntimeFlags, updateFlags);
    if (interruptible(newRuntimeFlags) && this.isInterrupted()) {
      return exitFailCause(this.getInterruptedCause());
    } else {
      this.patchRuntimeFlags(this.currentRuntimeFlags, updateFlags);
      if (op.effect_instruction_i1) {
        const revertFlags = diff4(newRuntimeFlags, oldRuntimeFlags);
        this.pushStack(new RevertFlags(revertFlags, op));
        return internalCall(() => op.effect_instruction_i1(oldRuntimeFlags));
      } else {
        return exitVoid;
      }
    }
  }
  [OP_ON_SUCCESS](op) {
    this.pushStack(op);
    return op.effect_instruction_i0;
  }
  ["OnStep"](op) {
    this.pushStack(op);
    return op.effect_instruction_i0;
  }
  [OP_ON_FAILURE](op) {
    this.pushStack(op);
    return op.effect_instruction_i0;
  }
  [OP_ON_SUCCESS_AND_FAILURE](op) {
    this.pushStack(op);
    return op.effect_instruction_i0;
  }
  [OP_ASYNC](op) {
    this._asyncBlockingOn = op.effect_instruction_i1;
    this.initiateAsync(this.currentRuntimeFlags, op.effect_instruction_i0);
    yieldedOpChannel.currentOp = op;
    return YieldedOp;
  }
  [OP_YIELD](op) {
    this._isYielding = false;
    yieldedOpChannel.currentOp = op;
    return YieldedOp;
  }
  [OP_WHILE](op) {
    const check2 = op.effect_instruction_i0;
    const body = op.effect_instruction_i1;
    if (check2()) {
      this.pushStack(op);
      return body();
    } else {
      return exitVoid;
    }
  }
  [OP_ITERATOR](op) {
    return contOpSuccess[OP_ITERATOR](this, op, void 0);
  }
  [OP_COMMIT](op) {
    return internalCall(() => op.commit());
  }
  /**
   * The main run-loop for evaluating effects.
   *
   * **NOTE**: This method must be invoked by the fiber itself.
   */
  runLoop(effect0) {
    let cur = effect0;
    this.currentOpCount = 0;
    while (true) {
      if ((this.currentRuntimeFlags & OpSupervision) !== 0) {
        this.currentSupervisor.onEffect(this, cur);
      }
      if (this._queue.length > 0) {
        cur = this.drainQueueWhileRunning(this.currentRuntimeFlags, cur);
      }
      if (!this._isYielding) {
        this.currentOpCount += 1;
        const shouldYield = this.currentScheduler.shouldYield(this);
        if (shouldYield !== false) {
          this._isYielding = true;
          this.currentOpCount = 0;
          const oldCur = cur;
          cur = flatMap7(yieldNow({
            priority: shouldYield
          }), () => oldCur);
        }
      }
      try {
        cur = this.currentTracer.context(() => {
          if (_version !== cur[EffectTypeId2]._V) {
            const level = this.getFiberRef(currentVersionMismatchErrorLogLevel);
            if (level._tag === "Some") {
              const effectVersion = cur[EffectTypeId2]._V;
              this.log(`Executing an Effect versioned ${effectVersion} with a Runtime of version ${getCurrentVersion()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, empty16, level);
            }
          }
          return this[cur._op](cur);
        }, this);
        if (cur === YieldedOp) {
          const op = yieldedOpChannel.currentOp;
          if (op._op === OP_YIELD || op._op === OP_ASYNC) {
            return YieldedOp;
          }
          yieldedOpChannel.currentOp = null;
          return op._op === OP_SUCCESS || op._op === OP_FAILURE ? op : exitFailCause(die(op));
        }
      } catch (e) {
        if (cur !== YieldedOp && !hasProperty(cur, "_op") || !(cur._op in this)) {
          cur = dieMessage(`Not a valid effect: ${toStringUnknown(cur)}`);
        } else if (isInterruptedException(e)) {
          cur = exitFailCause(sequential(die(e), interrupt(none4)));
        } else {
          cur = die2(e);
        }
      }
    }
  }
  run = () => {
    this.drainQueueOnCurrentThread();
  };
};
var currentMinimumLogLevel = /* @__PURE__ */ globalValue("effect/FiberRef/currentMinimumLogLevel", () => fiberRefUnsafeMake(fromLiteral("Info")));
var loggerWithConsoleLog = (self) => makeLogger((opts) => {
  const services = getOrDefault2(opts.context, currentServices);
  get3(services, consoleTag).unsafe.log(self.log(opts));
});
var defaultLogger = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Logger/defaultLogger"), () => loggerWithConsoleLog(stringLogger));
var tracerLogger = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Logger/tracerLogger"), () => makeLogger(({
  annotations,
  cause: cause3,
  context: context4,
  fiberId: fiberId3,
  logLevel,
  message
}) => {
  const span2 = filterDisablePropagation(getOption2(getOrDefault(context4, currentContext), spanTag));
  if (span2._tag === "None" || span2.value._tag === "ExternalSpan") {
    return;
  }
  const clockService = unsafeGet3(getOrDefault(context4, currentServices), clockTag);
  const attributes = {};
  for (const [key, value] of annotations) {
    attributes[key] = value;
  }
  attributes["effect.fiberId"] = threadName2(fiberId3);
  attributes["effect.logLevel"] = logLevel.label;
  if (cause3 !== null && cause3._tag !== "Empty") {
    attributes["effect.cause"] = pretty(cause3, {
      renderErrorCause: true
    });
  }
  span2.value.event(toStringUnknown(Array.isArray(message) && message.length === 1 ? message[0] : message), clockService.unsafeCurrentTimeNanos(), attributes);
}));
var currentLoggers = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLoggers"), () => fiberRefUnsafeMakeHashSet(make10(defaultLogger, tracerLogger)));
var annotateLogsScoped = function() {
  if (typeof arguments[0] === "string") {
    return fiberRefLocallyScopedWith(currentLogAnnotations, set3(arguments[0], arguments[1]));
  }
  const entries2 = Object.entries(arguments[0]);
  return fiberRefLocallyScopedWith(currentLogAnnotations, mutate3((annotations) => {
    for (let i = 0; i < entries2.length; i++) {
      const [key, value] = entries2[i];
      set3(annotations, key, value);
    }
    return annotations;
  }));
};
var whenLogLevel = /* @__PURE__ */ dual(2, (effect, level) => {
  const requiredLogLevel = typeof level === "string" ? fromLiteral(level) : level;
  return withFiberRuntime((fiberState) => {
    const minimumLogLevel = fiberState.getFiberRef(currentMinimumLogLevel);
    if (greaterThan3(minimumLogLevel, requiredLogLevel)) {
      return succeed(none2());
    }
    return map8(effect, some2);
  });
});
var acquireRelease = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (acquire, release) => uninterruptible(tap(acquire, (a) => addFinalizer((exit4) => release(a, exit4)))));
var acquireReleaseInterruptible = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (acquire, release) => ensuring(acquire, addFinalizer((exit4) => release(exit4))));
var addFinalizer = (finalizer) => withFiberRuntime((runtime4) => {
  const acquireRefs = runtime4.getFiberRefs();
  const acquireFlags = disable2(runtime4.currentRuntimeFlags, Interruption);
  return flatMap7(scope, (scope3) => scopeAddFinalizerExit(scope3, (exit4) => withFiberRuntime((runtimeFinalizer) => {
    const preRefs = runtimeFinalizer.getFiberRefs();
    const preFlags = runtimeFinalizer.currentRuntimeFlags;
    const patchRefs = diff6(preRefs, acquireRefs);
    const patchFlags = diff4(preFlags, acquireFlags);
    const inverseRefs = diff6(acquireRefs, preRefs);
    runtimeFinalizer.setFiberRefs(patch7(patchRefs, runtimeFinalizer.id(), acquireRefs));
    return ensuring(withRuntimeFlags(finalizer(exit4), patchFlags), sync(() => {
      runtimeFinalizer.setFiberRefs(patch7(inverseRefs, runtimeFinalizer.id(), runtimeFinalizer.getFiberRefs()));
    }));
  })));
});
var daemonChildren = (self) => {
  const forkScope = fiberRefLocally(currentForkScopeOverride, some2(globalScope));
  return forkScope(self);
};
var _existsParFound = /* @__PURE__ */ Symbol.for("effect/Effect/existsPar/found");
var exists2 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, predicate, options) => matchSimple(options?.concurrency, () => suspend(() => existsLoop(elements[Symbol.iterator](), 0, predicate)), () => matchEffect(forEach7(elements, (a, i) => if_(predicate(a, i), {
  onTrue: () => fail2(_existsParFound),
  onFalse: () => void_
}), options), {
  onFailure: (e) => e === _existsParFound ? succeed(true) : fail2(e),
  onSuccess: () => succeed(false)
})));
var existsLoop = (iterator, index, f) => {
  const next = iterator.next();
  if (next.done) {
    return succeed(false);
  }
  return flatMap7(f(next.value, index), (b) => b ? succeed(b) : existsLoop(iterator, index + 1, f));
};
var filter5 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, predicate, options) => {
  const predicate_ = options?.negate ? (a, i) => map8(predicate(a, i), not) : predicate;
  return matchSimple(options?.concurrency, () => suspend(() => fromIterable(elements).reduceRight((effect, a, i) => zipWith2(effect, suspend(() => predicate_(a, i)), (list, b) => b ? [a, ...list] : list), sync(() => new Array()))), () => map8(forEach7(elements, (a, i) => map8(predicate_(a, i), (b) => b ? some2(a) : none2()), options), getSomes));
});
var allResolveInput = (input) => {
  if (Array.isArray(input) || isIterable(input)) {
    return [input, none2()];
  }
  const keys5 = Object.keys(input);
  const size11 = keys5.length;
  return [keys5.map((k) => input[k]), some2((values3) => {
    const res = {};
    for (let i = 0; i < size11; i++) {
      ;
      res[keys5[i]] = values3[i];
    }
    return res;
  })];
};
var allValidate = (effects, reconcile, options) => {
  const eitherEffects = [];
  for (const effect of effects) {
    eitherEffects.push(either2(effect));
  }
  return flatMap7(forEach7(eitherEffects, identity, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), (eithers) => {
    const none10 = none2();
    const size11 = eithers.length;
    const errors = new Array(size11);
    const successes = new Array(size11);
    let errored = false;
    for (let i = 0; i < size11; i++) {
      const either4 = eithers[i];
      if (either4._tag === "Left") {
        errors[i] = some2(either4.left);
        errored = true;
      } else {
        successes[i] = either4.right;
        errors[i] = none10;
      }
    }
    if (errored) {
      return reconcile._tag === "Some" ? fail2(reconcile.value(errors)) : fail2(errors);
    } else if (options?.discard) {
      return void_;
    }
    return reconcile._tag === "Some" ? succeed(reconcile.value(successes)) : succeed(successes);
  });
};
var allEither = (effects, reconcile, options) => {
  const eitherEffects = [];
  for (const effect of effects) {
    eitherEffects.push(either2(effect));
  }
  if (options?.discard) {
    return forEach7(eitherEffects, identity, {
      concurrency: options?.concurrency,
      batching: options?.batching,
      discard: true,
      concurrentFinalizers: options?.concurrentFinalizers
    });
  }
  return map8(forEach7(eitherEffects, identity, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), (eithers) => reconcile._tag === "Some" ? reconcile.value(eithers) : eithers);
};
var all3 = (arg, options) => {
  const [effects, reconcile] = allResolveInput(arg);
  if (options?.mode === "validate") {
    return allValidate(effects, reconcile, options);
  } else if (options?.mode === "either") {
    return allEither(effects, reconcile, options);
  }
  return options?.discard !== true && reconcile._tag === "Some" ? map8(forEach7(effects, identity, options), reconcile.value) : forEach7(effects, identity, options);
};
var allWith = (options) => (arg) => all3(arg, options);
var allSuccesses = (elements, options) => map8(all3(fromIterable(elements).map(exit), options), filterMap((exit4) => exitIsSuccess(exit4) ? some2(exit4.effect_instruction_i0) : none2()));
var replicate = /* @__PURE__ */ dual(2, (self, n) => Array.from({
  length: n
}, () => self));
var replicateEffect = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, n, options) => all3(replicate(self, n), options));
var forEach7 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (self, f, options) => withFiberRuntime((r) => {
  const isRequestBatchingEnabled = options?.batching === true || options?.batching === "inherit" && r.getFiberRef(currentRequestBatching);
  if (options?.discard) {
    return match9(options.concurrency, () => finalizersMaskInternal(sequential3, options?.concurrentFinalizers)((restore) => isRequestBatchingEnabled ? forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), true, false, 1) : forEachSequentialDiscard(self, (a, i) => restore(f(a, i)))), () => finalizersMaskInternal(parallel3, options?.concurrentFinalizers)((restore) => forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled, false)), (n) => finalizersMaskInternal(parallelN2(n), options?.concurrentFinalizers)((restore) => forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled, false, n)));
  }
  return match9(options?.concurrency, () => finalizersMaskInternal(sequential3, options?.concurrentFinalizers)((restore) => isRequestBatchingEnabled ? forEachParN(self, 1, (a, i) => restore(f(a, i)), true) : forEachSequential(self, (a, i) => restore(f(a, i)))), () => finalizersMaskInternal(parallel3, options?.concurrentFinalizers)((restore) => forEachParUnbounded(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled)), (n) => finalizersMaskInternal(parallelN2(n), options?.concurrentFinalizers)((restore) => forEachParN(self, n, (a, i) => restore(f(a, i)), isRequestBatchingEnabled)));
}));
var forEachParUnbounded = (self, f, batching) => suspend(() => {
  const as7 = fromIterable(self);
  const array3 = new Array(as7.length);
  const fn2 = (a, i) => flatMap7(f(a, i), (b) => sync(() => array3[i] = b));
  return zipRight(forEachConcurrentDiscard(as7, fn2, batching, false), succeed(array3));
});
var forEachConcurrentDiscard = (self, f, batching, processAll, n) => uninterruptibleMask((restore) => transplant((graft) => withFiberRuntime((parent) => {
  let todos = Array.from(self).reverse();
  let target = todos.length;
  if (target === 0) {
    return void_;
  }
  let counter7 = 0;
  let interrupted = false;
  const fibersCount = n ? Math.min(todos.length, n) : todos.length;
  const fibers = /* @__PURE__ */ new Set();
  const results = new Array();
  const interruptAll = () => fibers.forEach((fiber) => {
    fiber.currentScheduler.scheduleTask(() => {
      fiber.unsafeInterruptAsFork(parent.id());
    }, 0, fiber);
  });
  const startOrder = new Array();
  const joinOrder = new Array();
  const residual = new Array();
  const collectExits = () => {
    const exits = results.filter(({
      exit: exit4
    }) => exit4._tag === "Failure").sort((a, b) => a.index < b.index ? -1 : a.index === b.index ? 0 : 1).map(({
      exit: exit4
    }) => exit4);
    if (exits.length === 0) {
      exits.push(exitVoid);
    }
    return exits;
  };
  const runFiber = (eff, interruptImmediately = false) => {
    const runnable = uninterruptible(graft(eff));
    const fiber = unsafeForkUnstarted(runnable, parent, parent.currentRuntimeFlags, globalScope);
    parent.currentScheduler.scheduleTask(() => {
      if (interruptImmediately) {
        fiber.unsafeInterruptAsFork(parent.id());
      }
      fiber.resume(runnable);
    }, 0, fiber);
    return fiber;
  };
  const onInterruptSignal = () => {
    if (!processAll) {
      target -= todos.length;
      todos = [];
    }
    interrupted = true;
    interruptAll();
  };
  const stepOrExit = batching ? step2 : exit;
  const processingFiber = runFiber(async_((resume2) => {
    const pushResult = (res, index) => {
      if (res._op === "Blocked") {
        residual.push(res);
      } else {
        results.push({
          index,
          exit: res
        });
        if (res._op === "Failure" && !interrupted) {
          onInterruptSignal();
        }
      }
    };
    const next = () => {
      if (todos.length > 0) {
        const a = todos.pop();
        let index = counter7++;
        const returnNextElement = () => {
          const a2 = todos.pop();
          index = counter7++;
          return flatMap7(yieldNow(), () => flatMap7(stepOrExit(restore(f(a2, index))), onRes));
        };
        const onRes = (res) => {
          if (todos.length > 0) {
            pushResult(res, index);
            if (todos.length > 0) {
              return returnNextElement();
            }
          }
          return succeed(res);
        };
        const todo = flatMap7(stepOrExit(restore(f(a, index))), onRes);
        const fiber = runFiber(todo);
        startOrder.push(fiber);
        fibers.add(fiber);
        if (interrupted) {
          fiber.currentScheduler.scheduleTask(() => {
            fiber.unsafeInterruptAsFork(parent.id());
          }, 0, fiber);
        }
        fiber.addObserver((wrapped) => {
          let exit4;
          if (wrapped._op === "Failure") {
            exit4 = wrapped;
          } else {
            exit4 = wrapped.effect_instruction_i0;
          }
          joinOrder.push(fiber);
          fibers.delete(fiber);
          pushResult(exit4, index);
          if (results.length === target) {
            resume2(succeed(getOrElse(exitCollectAll(collectExits(), {
              parallel: true
            }), () => exitVoid)));
          } else if (residual.length + results.length === target) {
            const exits = collectExits();
            const requests = residual.map((blocked3) => blocked3.effect_instruction_i0).reduce(par);
            resume2(succeed(blocked(requests, forEachConcurrentDiscard([getOrElse(exitCollectAll(exits, {
              parallel: true
            }), () => exitVoid), ...residual.map((blocked3) => blocked3.effect_instruction_i1)], (i) => i, batching, true, n))));
          } else {
            next();
          }
        });
      }
    };
    for (let i = 0; i < fibersCount; i++) {
      next();
    }
  }));
  return asVoid(onExit(flatten4(restore(join2(processingFiber))), exitMatch({
    onFailure: (cause3) => {
      onInterruptSignal();
      const target2 = residual.length + 1;
      const concurrency = Math.min(typeof n === "number" ? n : residual.length, residual.length);
      const toPop = Array.from(residual);
      return async_((cb) => {
        const exits = [];
        let count = 0;
        let index = 0;
        const check2 = (index2, hitNext) => (exit4) => {
          exits[index2] = exit4;
          count++;
          if (count === target2) {
            cb(exitSucceed(exitFailCause(cause3)));
          }
          if (toPop.length > 0 && hitNext) {
            next();
          }
        };
        const next = () => {
          runFiber(toPop.pop(), true).addObserver(check2(index, true));
          index++;
        };
        processingFiber.addObserver(check2(index, false));
        index++;
        for (let i = 0; i < concurrency; i++) {
          next();
        }
      });
    },
    onSuccess: () => forEachSequential(joinOrder, (f2) => f2.inheritAll)
  })));
})));
var forEachParN = (self, n, f, batching) => suspend(() => {
  const as7 = fromIterable(self);
  const array3 = new Array(as7.length);
  const fn2 = (a, i) => map8(f(a, i), (b) => array3[i] = b);
  return zipRight(forEachConcurrentDiscard(as7, fn2, batching, false, n), succeed(array3));
});
var fork = (self) => withFiberRuntime((state, status) => succeed(unsafeFork2(self, state, status.runtimeFlags)));
var forkDaemon = (self) => forkWithScopeOverride(self, globalScope);
var forkWithErrorHandler = /* @__PURE__ */ dual(2, (self, handler) => fork(onError(self, (cause3) => {
  const either4 = failureOrCause(cause3);
  switch (either4._tag) {
    case "Left":
      return handler(either4.left);
    case "Right":
      return failCause(either4.right);
  }
})));
var unsafeFork2 = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childFiber = unsafeMakeChildFiber(effect, parentFiber, parentRuntimeFlags, overrideScope);
  childFiber.resume(effect);
  return childFiber;
};
var unsafeForkUnstarted = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childFiber = unsafeMakeChildFiber(effect, parentFiber, parentRuntimeFlags, overrideScope);
  return childFiber;
};
var unsafeMakeChildFiber = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childId = unsafeMake2();
  const parentFiberRefs = parentFiber.getFiberRefs();
  const childFiberRefs = forkAs(parentFiberRefs, childId);
  const childFiber = new FiberRuntime(childId, childFiberRefs, parentRuntimeFlags);
  const childContext = getOrDefault(childFiberRefs, currentContext);
  const supervisor = childFiber.currentSupervisor;
  supervisor.onStart(childContext, effect, some2(parentFiber), childFiber);
  childFiber.addObserver((exit4) => supervisor.onEnd(exit4, childFiber));
  const parentScope = overrideScope !== null ? overrideScope : pipe(parentFiber.getFiberRef(currentForkScopeOverride), getOrElse(() => parentFiber.scope()));
  parentScope.add(parentRuntimeFlags, childFiber);
  return childFiber;
};
var forkWithScopeOverride = (self, scopeOverride) => withFiberRuntime((parentFiber, parentStatus) => succeed(unsafeFork2(self, parentFiber, parentStatus.runtimeFlags, scopeOverride)));
var mergeAll3 = /* @__PURE__ */ dual((args2) => isFunction2(args2[2]), (elements, zero2, f, options) => matchSimple(options?.concurrency, () => fromIterable(elements).reduce((acc, a, i) => zipWith2(acc, a, (acc2, a2) => f(acc2, a2, i)), succeed(zero2)), () => flatMap7(make27(zero2), (acc) => flatMap7(forEach7(elements, (effect, i) => flatMap7(effect, (a) => update3(acc, (b) => f(b, a, i))), options), () => get12(acc)))));
var partition3 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => pipe(forEach7(elements, (a, i) => either2(f(a, i)), options), map8((chunk2) => partitionMap2(chunk2, identity))));
var validateAll = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => flatMap7(partition3(elements, f, {
  concurrency: options?.concurrency,
  batching: options?.batching,
  concurrentFinalizers: options?.concurrentFinalizers
}), ([es, bs]) => isNonEmptyArray2(es) ? fail2(es) : options?.discard ? void_ : succeed(bs)));
var raceAll = (all5) => withFiberRuntime((state, status) => async_((resume2) => {
  const fibers = /* @__PURE__ */ new Set();
  let winner;
  let failures3 = empty16;
  const interruptAll = () => {
    for (const fiber of fibers) {
      fiber.unsafeInterruptAsFork(state.id());
    }
  };
  let latch = false;
  let empty30 = true;
  for (const self of all5) {
    empty30 = false;
    const fiber = unsafeFork2(interruptible2(self), state, status.runtimeFlags);
    fibers.add(fiber);
    fiber.addObserver((exit4) => {
      fibers.delete(fiber);
      if (!winner) {
        if (exit4._tag === "Success") {
          latch = true;
          winner = fiber;
          failures3 = empty16;
          interruptAll();
        } else {
          failures3 = parallel(exit4.cause, failures3);
        }
      }
      if (latch && fibers.size === 0) {
        resume2(winner ? zipRight(inheritAll(winner), winner.unsafePoll()) : failCause(failures3));
      }
    });
    if (winner) break;
  }
  if (empty30) {
    return resume2(dieSync(() => new IllegalArgumentException(`Received an empty collection of effects`)));
  }
  latch = true;
  return interruptAllAs(fibers, state.id());
}));
var reduceEffect = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, zero2, f, options) => matchSimple(options?.concurrency, () => fromIterable(elements).reduce((acc, a, i) => zipWith2(acc, a, (acc2, a2) => f(acc2, a2, i)), zero2), () => suspend(() => pipe(mergeAll3([zero2, ...elements], none2(), (acc, elem, i) => {
  switch (acc._tag) {
    case "None": {
      return some2(elem);
    }
    case "Some": {
      return some2(f(acc.value, elem, i));
    }
  }
}, options), map8((option3) => {
  switch (option3._tag) {
    case "None": {
      throw new Error("BUG: Effect.reduceEffect - please report an issue at https://github.com/Effect-TS/effect/issues");
    }
    case "Some": {
      return option3.value;
    }
  }
})))));
var parallelFinalizers = (self) => contextWithEffect((context4) => match2(getOption2(context4, scopeTag), {
  onNone: () => self,
  onSome: (scope3) => {
    switch (scope3.strategy._tag) {
      case "Parallel":
        return self;
      case "Sequential":
      case "ParallelN":
        return flatMap7(scopeFork(scope3, parallel3), (inner) => scopeExtend(self, inner));
    }
  }
}));
var parallelNFinalizers = (parallelism) => (self) => contextWithEffect((context4) => match2(getOption2(context4, scopeTag), {
  onNone: () => self,
  onSome: (scope3) => {
    if (scope3.strategy._tag === "ParallelN" && scope3.strategy.parallelism === parallelism) {
      return self;
    }
    return flatMap7(scopeFork(scope3, parallelN2(parallelism)), (inner) => scopeExtend(self, inner));
  }
}));
var finalizersMask = (strategy) => (self) => finalizersMaskInternal(strategy, true)(self);
var finalizersMaskInternal = (strategy, concurrentFinalizers) => (self) => contextWithEffect((context4) => match2(getOption2(context4, scopeTag), {
  onNone: () => self(identity),
  onSome: (scope3) => {
    if (concurrentFinalizers === true) {
      const patch9 = strategy._tag === "Parallel" ? parallelFinalizers : strategy._tag === "Sequential" ? sequentialFinalizers : parallelNFinalizers(strategy.parallelism);
      switch (scope3.strategy._tag) {
        case "Parallel":
          return patch9(self(parallelFinalizers));
        case "Sequential":
          return patch9(self(sequentialFinalizers));
        case "ParallelN":
          return patch9(self(parallelNFinalizers(scope3.strategy.parallelism)));
      }
    } else {
      return self(identity);
    }
  }
}));
var scopeWith = (f) => flatMap7(scopeTag, f);
var scopedWith = (f) => flatMap7(scopeMake(), (scope3) => onExit(f(scope3), (exit4) => scope3.close(exit4)));
var scopedEffect = (effect) => flatMap7(scopeMake(), (scope3) => scopeUse(effect, scope3));
var sequentialFinalizers = (self) => contextWithEffect((context4) => match2(getOption2(context4, scopeTag), {
  onNone: () => self,
  onSome: (scope3) => {
    switch (scope3.strategy._tag) {
      case "Sequential":
        return self;
      case "Parallel":
      case "ParallelN":
        return flatMap7(scopeFork(scope3, sequential3), (inner) => scopeExtend(self, inner));
    }
  }
}));
var tagMetricsScoped = (key, value) => labelMetricsScoped([make28(key, value)]);
var labelMetricsScoped = (labels) => fiberRefLocallyScopedWith(currentMetricLabels, (old) => union(old, labels));
var using = /* @__PURE__ */ dual(2, (self, use) => scopedWith((scope3) => flatMap7(scopeExtend(self, scope3), use)));
var validate = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => validateWith(self, that, (a, b) => [a, b], options));
var validateWith = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, f, options) => flatten4(zipWithOptions(exit(self), exit(that), (ea, eb) => exitZipWith(ea, eb, {
  onSuccess: f,
  onFailure: (ca, cb) => options?.concurrent ? parallel(ca, cb) : sequential(ca, cb)
}), options)));
var validateFirst = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => flip(forEach7(elements, (a, i) => flip(f(a, i)), options)));
var withClockScoped = (c) => fiberRefLocallyScopedWith(currentServices, add2(clockTag, c));
var withRandomScoped = (value) => fiberRefLocallyScopedWith(currentServices, add2(randomTag, value));
var withConfigProviderScoped = (provider) => fiberRefLocallyScopedWith(currentServices, add2(configProviderTag, provider));
var withEarlyRelease = (self) => scopeWith((parent) => flatMap7(scopeFork(parent, sequential2), (child) => pipe(self, scopeExtend(child), map8((value) => [fiberIdWith((fiberId3) => scopeClose(child, exitInterrupt(fiberId3))), value]))));
var zipOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => zipWithOptions(self, that, (a, b) => [a, b], options));
var zipLeftOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => {
  if (options?.concurrent !== true && (options?.batching === void 0 || options.batching === false)) {
    return zipLeft(self, that);
  }
  return zipWithOptions(self, that, (a, _) => a, options);
});
var zipRightOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => {
  if (options?.concurrent !== true && (options?.batching === void 0 || options.batching === false)) {
    return zipRight(self, that);
  }
  return zipWithOptions(self, that, (_, b) => b, options);
});
var zipWithOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, f, options) => map8(all3([self, that], {
  concurrency: options?.concurrent ? 2 : 1,
  batching: options?.batching,
  concurrentFinalizers: options?.concurrentFinalizers
}), ([a, a2]) => f(a, a2)));
var withRuntimeFlagsScoped = (update5) => {
  if (update5 === empty14) {
    return void_;
  }
  return pipe(runtimeFlags, flatMap7((runtimeFlags2) => {
    const updatedRuntimeFlags = patch4(runtimeFlags2, update5);
    const revertRuntimeFlags = diff4(updatedRuntimeFlags, runtimeFlags2);
    return pipe(updateRuntimeFlags(update5), zipRight(addFinalizer(() => updateRuntimeFlags(revertRuntimeFlags))), asVoid);
  }), uninterruptible);
};
var scopeTag = /* @__PURE__ */ GenericTag("effect/Scope");
var scope = scopeTag;
var scopeUnsafeAddFinalizer = (scope3, fin) => {
  if (scope3.state._tag === "Open") {
    scope3.state.finalizers.set({}, fin);
  }
};
var ScopeImplProto = {
  [ScopeTypeId]: ScopeTypeId,
  [CloseableScopeTypeId]: CloseableScopeTypeId,
  pipe() {
    return pipeArguments(this, arguments);
  },
  fork(strategy) {
    return sync(() => {
      const newScope = scopeUnsafeMake(strategy);
      if (this.state._tag === "Closed") {
        newScope.state = this.state;
        return newScope;
      }
      const key = {};
      const fin = (exit4) => newScope.close(exit4);
      this.state.finalizers.set(key, fin);
      scopeUnsafeAddFinalizer(newScope, (_) => sync(() => {
        if (this.state._tag === "Open") {
          this.state.finalizers.delete(key);
        }
      }));
      return newScope;
    });
  },
  close(exit4) {
    return suspend(() => {
      if (this.state._tag === "Closed") {
        return void_;
      }
      const finalizers = Array.from(this.state.finalizers.values()).reverse();
      this.state = {
        _tag: "Closed",
        exit: exit4
      };
      if (finalizers.length === 0) {
        return void_;
      }
      return isSequential(this.strategy) ? pipe(forEachSequential(finalizers, (fin) => exit(fin(exit4))), flatMap7((results) => pipe(exitCollectAll(results), map(exitAsVoid), getOrElse(() => exitVoid)))) : isParallel(this.strategy) ? pipe(forEachParUnbounded(finalizers, (fin) => exit(fin(exit4)), false), flatMap7((results) => pipe(exitCollectAll(results, {
        parallel: true
      }), map(exitAsVoid), getOrElse(() => exitVoid)))) : pipe(forEachParN(finalizers, this.strategy.parallelism, (fin) => exit(fin(exit4)), false), flatMap7((results) => pipe(exitCollectAll(results, {
        parallel: true
      }), map(exitAsVoid), getOrElse(() => exitVoid))));
    });
  },
  addFinalizer(fin) {
    return suspend(() => {
      if (this.state._tag === "Closed") {
        return fin(this.state.exit);
      }
      this.state.finalizers.set({}, fin);
      return void_;
    });
  }
};
var scopeUnsafeMake = (strategy = sequential2) => {
  const scope3 = Object.create(ScopeImplProto);
  scope3.strategy = strategy;
  scope3.state = {
    _tag: "Open",
    finalizers: /* @__PURE__ */ new Map()
  };
  return scope3;
};
var scopeMake = (strategy = sequential2) => sync(() => scopeUnsafeMake(strategy));
var scopeExtend = /* @__PURE__ */ dual(2, (effect, scope3) => mapInputContext(
  effect,
  // @ts-expect-error
  merge3(make5(scopeTag, scope3))
));
var scopeUse = /* @__PURE__ */ dual(2, (effect, scope3) => pipe(effect, scopeExtend(scope3), onExit((exit4) => scope3.close(exit4))));
var fiberRefUnsafeMakeSupervisor = (initial) => fiberRefUnsafeMakePatch(initial, {
  differ: differ2,
  fork: empty25
});
var fiberRefLocallyScoped = /* @__PURE__ */ dual(2, (self, value) => asVoid(acquireRelease(flatMap7(fiberRefGet(self), (oldValue) => as2(fiberRefSet(self, value), oldValue)), (oldValue) => fiberRefSet(self, oldValue))));
var fiberRefLocallyScopedWith = /* @__PURE__ */ dual(2, (self, f) => fiberRefGetWith(self, (a) => fiberRefLocallyScoped(self, f(a))));
var currentRuntimeFlags = /* @__PURE__ */ fiberRefUnsafeMakeRuntimeFlags(none5);
var currentSupervisor = /* @__PURE__ */ fiberRefUnsafeMakeSupervisor(none8);
var fiberAwaitAll = (fibers) => forEach7(fibers, _await2);
var fiberAll = (fibers) => {
  const _fiberAll = {
    ...CommitPrototype2,
    commit() {
      return join2(this);
    },
    [FiberTypeId]: fiberVariance2,
    id: () => fromIterable(fibers).reduce((id, fiber) => combine3(id, fiber.id()), none4),
    await: exit(forEachParUnbounded(fibers, (fiber) => flatten4(fiber.await), false)),
    children: map8(forEachParUnbounded(fibers, (fiber) => fiber.children, false), flatten),
    inheritAll: forEachSequentialDiscard(fibers, (fiber) => fiber.inheritAll),
    poll: map8(forEachSequential(fibers, (fiber) => fiber.poll), reduceRight(some2(exitSucceed(new Array())), (optionB, optionA) => {
      switch (optionA._tag) {
        case "None": {
          return none2();
        }
        case "Some": {
          switch (optionB._tag) {
            case "None": {
              return none2();
            }
            case "Some": {
              return some2(exitZipWith(optionA.value, optionB.value, {
                onSuccess: (a, chunk2) => [a, ...chunk2],
                onFailure: parallel
              }));
            }
          }
        }
      }
    })),
    interruptAsFork: (fiberId3) => forEachSequentialDiscard(fibers, (fiber) => fiber.interruptAsFork(fiberId3))
  };
  return _fiberAll;
};
var raceWith = /* @__PURE__ */ dual(3, (self, other, options) => raceFibersWith(self, other, {
  onSelfWin: (winner, loser) => flatMap7(winner.await, (exit4) => {
    switch (exit4._tag) {
      case OP_SUCCESS: {
        return flatMap7(winner.inheritAll, () => options.onSelfDone(exit4, loser));
      }
      case OP_FAILURE: {
        return options.onSelfDone(exit4, loser);
      }
    }
  }),
  onOtherWin: (winner, loser) => flatMap7(winner.await, (exit4) => {
    switch (exit4._tag) {
      case OP_SUCCESS: {
        return flatMap7(winner.inheritAll, () => options.onOtherDone(exit4, loser));
      }
      case OP_FAILURE: {
        return options.onOtherDone(exit4, loser);
      }
    }
  })
}));
var disconnect = (self) => uninterruptibleMask((restore) => fiberIdWith((fiberId3) => flatMap7(forkDaemon(restore(self)), (fiber) => pipe(restore(join2(fiber)), onInterrupt(() => pipe(fiber, interruptAsFork(fiberId3)))))));
var race = /* @__PURE__ */ dual(2, (self, that) => fiberIdWith((parentFiberId) => raceWith(self, that, {
  onSelfDone: (exit4, right3) => exitMatchEffect(exit4, {
    onFailure: (cause3) => pipe(join2(right3), mapErrorCause2((cause22) => parallel(cause3, cause22))),
    onSuccess: (value) => pipe(right3, interruptAsFiber(parentFiberId), as2(value))
  }),
  onOtherDone: (exit4, left3) => exitMatchEffect(exit4, {
    onFailure: (cause3) => pipe(join2(left3), mapErrorCause2((cause22) => parallel(cause22, cause3))),
    onSuccess: (value) => pipe(left3, interruptAsFiber(parentFiberId), as2(value))
  })
})));
var raceFibersWith = /* @__PURE__ */ dual(3, (self, other, options) => withFiberRuntime((parentFiber, parentStatus) => {
  const parentRuntimeFlags = parentStatus.runtimeFlags;
  const raceIndicator = make11(true);
  const leftFiber = unsafeMakeChildFiber(self, parentFiber, parentRuntimeFlags, options.selfScope);
  const rightFiber = unsafeMakeChildFiber(other, parentFiber, parentRuntimeFlags, options.otherScope);
  return async_((cb) => {
    leftFiber.addObserver(() => completeRace(leftFiber, rightFiber, options.onSelfWin, raceIndicator, cb));
    rightFiber.addObserver(() => completeRace(rightFiber, leftFiber, options.onOtherWin, raceIndicator, cb));
    leftFiber.startFork(self);
    rightFiber.startFork(other);
  }, combine3(leftFiber.id(), rightFiber.id()));
}));
var completeRace = (winner, loser, cont, ab, cb) => {
  if (compareAndSet(true, false)(ab)) {
    cb(cont(winner, loser));
  }
};
var ensuring = /* @__PURE__ */ dual(2, (self, finalizer) => uninterruptibleMask((restore) => matchCauseEffect(restore(self), {
  onFailure: (cause1) => matchCauseEffect(finalizer, {
    onFailure: (cause22) => failCause(sequential(cause1, cause22)),
    onSuccess: () => failCause(cause1)
  }),
  onSuccess: (a) => as2(finalizer, a)
})));
var invokeWithInterrupt = (self, entries2, onInterrupt3) => fiberIdWith((id) => ensuring(flatMap7(forkDaemon(interruptible2(self)), (processing) => async_((cb) => {
  const counts = entries2.map((_) => _.listeners.count);
  const checkDone = () => {
    if (counts.every((count) => count === 0)) {
      if (entries2.every((_) => {
        if (_.result.state.current._tag === "Pending") {
          return true;
        } else if (_.result.state.current._tag === "Done" && exitIsExit(_.result.state.current.effect) && _.result.state.current.effect._tag === "Failure" && isInterrupted(_.result.state.current.effect.cause)) {
          return true;
        } else {
          return false;
        }
      })) {
        cleanup.forEach((f) => f());
        onInterrupt3?.();
        cb(interruptFiber(processing));
      }
    }
  };
  processing.addObserver((exit4) => {
    cleanup.forEach((f) => f());
    cb(exit4);
  });
  const cleanup = entries2.map((r, i) => {
    const observer = (count) => {
      counts[i] = count;
      checkDone();
    };
    r.listeners.addObserver(observer);
    return () => r.listeners.removeObserver(observer);
  });
  checkDone();
  return sync(() => {
    cleanup.forEach((f) => f());
  });
})), suspend(() => {
  const residual = entries2.flatMap((entry) => {
    if (!entry.state.completed) {
      return [entry];
    }
    return [];
  });
  return forEachSequentialDiscard(residual, (entry) => complete(entry.request, exitInterrupt(id)));
})));
var makeSpanScoped = (name, options) => {
  options = addSpanStackTrace(options);
  return uninterruptible(withFiberRuntime((fiber) => {
    const scope3 = unsafeGet3(fiber.getFiberRef(currentContext), scopeTag);
    const span2 = unsafeMakeSpan(fiber, name, options);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const clock_ = get3(fiber.getFiberRef(currentServices), clockTag);
    return as2(scopeAddFinalizerExit(scope3, (exit4) => endSpan(span2, exit4, clock_, timingEnabled)), span2);
  }));
};
var withTracerScoped = (value) => fiberRefLocallyScopedWith(currentServices, add2(tracerTag, value));
var withSpanScoped = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return flatMap7(makeSpanScoped(name, addSpanStackTrace(options)), (span2) => provideService(self, spanTag, span2));
  }
  return (self) => flatMap7(makeSpanScoped(name, addSpanStackTrace(options)), (span2) => provideService(self, spanTag, span2));
};

// node_modules/effect/dist/esm/internal/cache.js
var complete2 = (key, exit4, entryStats, timeToLiveMillis) => struct({
  _tag: "Complete",
  key,
  exit: exit4,
  entryStats,
  timeToLiveMillis
});
var pending2 = (key, deferred) => struct({
  _tag: "Pending",
  key,
  deferred
});
var refreshing = (deferred, complete3) => struct({
  _tag: "Refreshing",
  deferred,
  complete: complete3
});
var MapKeyTypeId = /* @__PURE__ */ Symbol.for("effect/Cache/MapKey");
var MapKeyImpl = class {
  current;
  [MapKeyTypeId] = MapKeyTypeId;
  previous = void 0;
  next = void 0;
  constructor(current) {
    this.current = current;
  }
  [symbol]() {
    return pipe(hash(this.current), combine(hash(this.previous)), combine(hash(this.next)), cached(this));
  }
  [symbol2](that) {
    if (this === that) {
      return true;
    }
    return isMapKey(that) && equals(this.current, that.current) && equals(this.previous, that.previous) && equals(this.next, that.next);
  }
};
var makeMapKey = (current) => new MapKeyImpl(current);
var isMapKey = (u) => hasProperty(u, MapKeyTypeId);
var KeySetImpl = class {
  head = void 0;
  tail = void 0;
  add(key) {
    if (key !== this.tail) {
      if (this.tail === void 0) {
        this.head = key;
        this.tail = key;
      } else {
        const previous = key.previous;
        const next = key.next;
        if (next !== void 0) {
          key.next = void 0;
          if (previous !== void 0) {
            previous.next = next;
            next.previous = previous;
          } else {
            this.head = next;
            this.head.previous = void 0;
          }
        }
        this.tail.next = key;
        key.previous = this.tail;
        this.tail = key;
      }
    }
  }
  remove() {
    const key = this.head;
    if (key !== void 0) {
      const next = key.next;
      if (next !== void 0) {
        key.next = void 0;
        this.head = next;
        this.head.previous = void 0;
      } else {
        this.head = void 0;
        this.tail = void 0;
      }
    }
    return key;
  }
};
var makeKeySet = () => new KeySetImpl();
var makeCacheState = (map14, keys5, accesses, updating, hits, misses) => ({
  map: map14,
  keys: keys5,
  accesses,
  updating,
  hits,
  misses
});
var initialCacheState = () => makeCacheState(empty17(), makeKeySet(), unbounded(), make11(false), 0, 0);
var CacheSymbolKey = "effect/Cache";
var CacheTypeId = /* @__PURE__ */ Symbol.for(CacheSymbolKey);
var cacheVariance = {
  /* c8 ignore next */
  _Key: (_) => _,
  /* c8 ignore next */
  _Error: (_) => _,
  /* c8 ignore next */
  _Value: (_) => _
};
var ConsumerCacheSymbolKey = "effect/ConsumerCache";
var ConsumerCacheTypeId = /* @__PURE__ */ Symbol.for(ConsumerCacheSymbolKey);
var consumerCacheVariance = {
  /* c8 ignore next */
  _Key: (_) => _,
  /* c8 ignore next */
  _Error: (_) => _,
  /* c8 ignore next */
  _Value: (_) => _
};
var makeCacheStats = (options) => options;
var makeEntryStats = (loadedMillis) => ({
  loadedMillis
});
var CacheImpl = class {
  capacity;
  context;
  fiberId;
  lookup;
  timeToLive;
  [CacheTypeId] = cacheVariance;
  [ConsumerCacheTypeId] = consumerCacheVariance;
  cacheState;
  constructor(capacity, context4, fiberId3, lookup, timeToLive) {
    this.capacity = capacity;
    this.context = context4;
    this.fiberId = fiberId3;
    this.lookup = lookup;
    this.timeToLive = timeToLive;
    this.cacheState = initialCacheState();
  }
  get(key) {
    return map8(this.getEither(key), merge);
  }
  get cacheStats() {
    return sync(() => makeCacheStats({
      hits: this.cacheState.hits,
      misses: this.cacheState.misses,
      size: size5(this.cacheState.map)
    }));
  }
  getOption(key) {
    return suspend(() => match2(get8(this.cacheState.map, key), {
      onNone: () => {
        const mapKey = makeMapKey(key);
        this.trackAccess(mapKey);
        this.trackMiss();
        return succeed(none2());
      },
      onSome: (value) => this.resolveMapValue(value)
    }));
  }
  getOptionComplete(key) {
    return suspend(() => match2(get8(this.cacheState.map, key), {
      onNone: () => {
        const mapKey = makeMapKey(key);
        this.trackAccess(mapKey);
        this.trackMiss();
        return succeed(none2());
      },
      onSome: (value) => this.resolveMapValue(value, true)
    }));
  }
  contains(key) {
    return sync(() => has4(this.cacheState.map, key));
  }
  entryStats(key) {
    return sync(() => {
      const option3 = get8(this.cacheState.map, key);
      if (isSome2(option3)) {
        switch (option3.value._tag) {
          case "Complete": {
            const loaded = option3.value.entryStats.loadedMillis;
            return some2(makeEntryStats(loaded));
          }
          case "Pending": {
            return none2();
          }
          case "Refreshing": {
            const loaded = option3.value.complete.entryStats.loadedMillis;
            return some2(makeEntryStats(loaded));
          }
        }
      }
      return none2();
    });
  }
  getEither(key) {
    return suspend(() => {
      const k = key;
      let mapKey = void 0;
      let deferred = void 0;
      let value = getOrUndefined(get8(this.cacheState.map, k));
      if (value === void 0) {
        deferred = unsafeMake3(this.fiberId);
        mapKey = makeMapKey(k);
        if (has4(this.cacheState.map, k)) {
          value = getOrUndefined(get8(this.cacheState.map, k));
        } else {
          set4(this.cacheState.map, k, pending2(mapKey, deferred));
        }
      }
      if (value === void 0) {
        this.trackAccess(mapKey);
        this.trackMiss();
        return map8(this.lookupValueOf(key, deferred), right2);
      } else {
        return flatMap7(this.resolveMapValue(value), match2({
          onNone: () => this.getEither(key),
          onSome: (value2) => succeed(left2(value2))
        }));
      }
    });
  }
  invalidate(key) {
    return sync(() => {
      remove5(this.cacheState.map, key);
    });
  }
  invalidateWhen(key, when3) {
    return sync(() => {
      const value = get8(this.cacheState.map, key);
      if (isSome2(value) && value.value._tag === "Complete") {
        if (value.value.exit._tag === "Success") {
          if (when3(value.value.exit.value)) {
            remove5(this.cacheState.map, key);
          }
        }
      }
    });
  }
  get invalidateAll() {
    return sync(() => {
      this.cacheState.map = empty17();
    });
  }
  refresh(key) {
    return clockWith3((clock3) => suspend(() => {
      const k = key;
      const deferred = unsafeMake3(this.fiberId);
      let value = getOrUndefined(get8(this.cacheState.map, k));
      if (value === void 0) {
        if (has4(this.cacheState.map, k)) {
          value = getOrUndefined(get8(this.cacheState.map, k));
        } else {
          set4(this.cacheState.map, k, pending2(makeMapKey(k), deferred));
        }
      }
      if (value === void 0) {
        return asVoid(this.lookupValueOf(key, deferred));
      } else {
        switch (value._tag) {
          case "Complete": {
            if (this.hasExpired(clock3, value.timeToLiveMillis)) {
              const found = getOrUndefined(get8(this.cacheState.map, k));
              if (equals(found, value)) {
                remove5(this.cacheState.map, k);
              }
              return asVoid(this.get(key));
            }
            return pipe(this.lookupValueOf(key, deferred), when(() => {
              const current = getOrUndefined(get8(this.cacheState.map, k));
              if (equals(current, value)) {
                const mapValue = refreshing(deferred, value);
                set4(this.cacheState.map, k, mapValue);
                return true;
              }
              return false;
            }), asVoid);
          }
          case "Pending": {
            return _await(value.deferred);
          }
          case "Refreshing": {
            return _await(value.deferred);
          }
        }
      }
    }));
  }
  set(key, value) {
    return clockWith3((clock3) => sync(() => {
      const now = clock3.unsafeCurrentTimeMillis();
      const k = key;
      const lookupResult = succeed2(value);
      const mapValue = complete2(makeMapKey(k), lookupResult, makeEntryStats(now), now + toMillis(decode(this.timeToLive(lookupResult))));
      set4(this.cacheState.map, k, mapValue);
    }));
  }
  get size() {
    return sync(() => {
      return size5(this.cacheState.map);
    });
  }
  get values() {
    return sync(() => {
      const values3 = [];
      for (const entry of this.cacheState.map) {
        if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
          values3.push(entry[1].exit.value);
        }
      }
      return values3;
    });
  }
  get entries() {
    return sync(() => {
      const values3 = [];
      for (const entry of this.cacheState.map) {
        if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
          values3.push([entry[0], entry[1].exit.value]);
        }
      }
      return values3;
    });
  }
  get keys() {
    return sync(() => {
      const keys5 = [];
      for (const entry of this.cacheState.map) {
        if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
          keys5.push(entry[0]);
        }
      }
      return keys5;
    });
  }
  resolveMapValue(value, ignorePending = false) {
    return clockWith3((clock3) => {
      switch (value._tag) {
        case "Complete": {
          this.trackAccess(value.key);
          if (this.hasExpired(clock3, value.timeToLiveMillis)) {
            remove5(this.cacheState.map, value.key.current);
            return succeed(none2());
          }
          this.trackHit();
          return map8(value.exit, some2);
        }
        case "Pending": {
          this.trackAccess(value.key);
          this.trackHit();
          if (ignorePending) {
            return succeed(none2());
          }
          return map8(_await(value.deferred), some2);
        }
        case "Refreshing": {
          this.trackAccess(value.complete.key);
          this.trackHit();
          if (this.hasExpired(clock3, value.complete.timeToLiveMillis)) {
            if (ignorePending) {
              return succeed(none2());
            }
            return map8(_await(value.deferred), some2);
          }
          return map8(value.complete.exit, some2);
        }
      }
    });
  }
  trackHit() {
    this.cacheState.hits = this.cacheState.hits + 1;
  }
  trackMiss() {
    this.cacheState.misses = this.cacheState.misses + 1;
  }
  trackAccess(key) {
    offer(this.cacheState.accesses, key);
    if (compareAndSet(this.cacheState.updating, false, true)) {
      let loop3 = true;
      while (loop3) {
        const key2 = poll(this.cacheState.accesses, EmptyMutableQueue);
        if (key2 === EmptyMutableQueue) {
          loop3 = false;
        } else {
          this.cacheState.keys.add(key2);
        }
      }
      let size11 = size5(this.cacheState.map);
      loop3 = size11 > this.capacity;
      while (loop3) {
        const key2 = this.cacheState.keys.remove();
        if (key2 !== void 0) {
          if (has4(this.cacheState.map, key2.current)) {
            remove5(this.cacheState.map, key2.current);
            size11 = size11 - 1;
            loop3 = size11 > this.capacity;
          }
        } else {
          loop3 = false;
        }
      }
      set2(this.cacheState.updating, false);
    }
  }
  hasExpired(clock3, timeToLiveMillis) {
    return clock3.unsafeCurrentTimeMillis() > timeToLiveMillis;
  }
  lookupValueOf(input, deferred) {
    return clockWith3((clock3) => suspend(() => {
      const key = input;
      return pipe(this.lookup(input), provideContext(this.context), exit, flatMap7((exit4) => {
        const now = clock3.unsafeCurrentTimeMillis();
        const stats = makeEntryStats(now);
        const value = complete2(makeMapKey(key), exit4, stats, now + toMillis(decode(this.timeToLive(exit4))));
        set4(this.cacheState.map, key, value);
        return zipRight(done2(deferred, exit4), exit4);
      }), onInterrupt(() => zipRight(interrupt3(deferred), sync(() => {
        remove5(this.cacheState.map, key);
      }))));
    }));
  }
};
var unsafeMakeWith = (capacity, lookup, timeToLive) => new CacheImpl(capacity, empty3(), none3, lookup, (exit4) => decode(timeToLive(exit4)));

// node_modules/effect/dist/esm/Cause.js
var Cause_exports = {};
__export(Cause_exports, {
  CauseTypeId: () => CauseTypeId2,
  ExceededCapacityException: () => ExceededCapacityException2,
  ExceededCapacityExceptionTypeId: () => ExceededCapacityExceptionTypeId2,
  IllegalArgumentException: () => IllegalArgumentException2,
  IllegalArgumentExceptionTypeId: () => IllegalArgumentExceptionTypeId2,
  InterruptedException: () => InterruptedException2,
  InterruptedExceptionTypeId: () => InterruptedExceptionTypeId2,
  InvalidPubSubCapacityExceptionTypeId: () => InvalidPubSubCapacityExceptionTypeId2,
  NoSuchElementException: () => NoSuchElementException2,
  NoSuchElementExceptionTypeId: () => NoSuchElementExceptionTypeId2,
  RuntimeException: () => RuntimeException2,
  RuntimeExceptionTypeId: () => RuntimeExceptionTypeId2,
  TimeoutException: () => TimeoutException2,
  TimeoutExceptionTypeId: () => TimeoutExceptionTypeId2,
  UnknownException: () => UnknownException2,
  UnknownExceptionTypeId: () => UnknownExceptionTypeId2,
  YieldableError: () => YieldableError2,
  andThen: () => andThen4,
  as: () => as5,
  contains: () => contains4,
  defects: () => defects2,
  die: () => die4,
  dieOption: () => dieOption2,
  empty: () => empty26,
  fail: () => fail4,
  failureOption: () => failureOption2,
  failureOrCause: () => failureOrCause2,
  failures: () => failures2,
  filter: () => filter6,
  find: () => find2,
  flatMap: () => flatMap10,
  flatten: () => flatten6,
  flipCauseOption: () => flipCauseOption2,
  interrupt: () => interrupt5,
  interruptOption: () => interruptOption2,
  interruptors: () => interruptors2,
  isCause: () => isCause2,
  isDie: () => isDie2,
  isDieType: () => isDieType2,
  isEmpty: () => isEmpty7,
  isEmptyType: () => isEmptyType2,
  isExceededCapacityException: () => isExceededCapacityException2,
  isFailType: () => isFailType2,
  isFailure: () => isFailure4,
  isIllegalArgumentException: () => isIllegalArgumentException2,
  isInterruptType: () => isInterruptType2,
  isInterrupted: () => isInterrupted3,
  isInterruptedException: () => isInterruptedException2,
  isInterruptedOnly: () => isInterruptedOnly2,
  isNoSuchElementException: () => isNoSuchElementException2,
  isParallelType: () => isParallelType2,
  isRuntimeException: () => isRuntimeException2,
  isSequentialType: () => isSequentialType2,
  isTimeoutException: () => isTimeoutException2,
  isUnknownException: () => isUnknownException2,
  keepDefects: () => keepDefects2,
  linearize: () => linearize2,
  map: () => map11,
  match: () => match10,
  originalError: () => originalError,
  parallel: () => parallel4,
  pretty: () => pretty2,
  prettyErrors: () => prettyErrors2,
  reduce: () => reduce10,
  reduceWithContext: () => reduceWithContext3,
  sequential: () => sequential4,
  size: () => size8,
  squash: () => squash,
  squashWith: () => squashWith,
  stripFailures: () => stripFailures2,
  stripSomeDefects: () => stripSomeDefects2
});
var CauseTypeId2 = CauseTypeId;
var RuntimeExceptionTypeId2 = RuntimeExceptionTypeId;
var InterruptedExceptionTypeId2 = InterruptedExceptionTypeId;
var IllegalArgumentExceptionTypeId2 = IllegalArgumentExceptionTypeId;
var NoSuchElementExceptionTypeId2 = NoSuchElementExceptionTypeId;
var InvalidPubSubCapacityExceptionTypeId2 = InvalidPubSubCapacityExceptionTypeId;
var ExceededCapacityExceptionTypeId2 = ExceededCapacityExceptionTypeId;
var TimeoutExceptionTypeId2 = TimeoutExceptionTypeId;
var UnknownExceptionTypeId2 = UnknownExceptionTypeId;
var YieldableError2 = YieldableError;
var empty26 = empty16;
var fail4 = fail;
var die4 = die;
var interrupt5 = interrupt;
var parallel4 = parallel;
var sequential4 = sequential;
var isCause2 = isCause;
var isEmptyType2 = isEmptyType;
var isFailType2 = isFailType;
var isDieType2 = isDieType;
var isInterruptType2 = isInterruptType;
var isSequentialType2 = isSequentialType;
var isParallelType2 = isParallelType;
var size8 = size4;
var isEmpty7 = isEmpty5;
var isFailure4 = isFailure;
var isDie2 = isDie;
var isInterrupted3 = isInterrupted;
var isInterruptedOnly2 = isInterruptedOnly;
var failures2 = failures;
var defects2 = defects;
var interruptors2 = interruptors;
var failureOption2 = failureOption;
var failureOrCause2 = failureOrCause;
var flipCauseOption2 = flipCauseOption;
var dieOption2 = dieOption;
var interruptOption2 = interruptOption;
var keepDefects2 = keepDefects;
var linearize2 = linearize;
var stripFailures2 = stripFailures;
var stripSomeDefects2 = stripSomeDefects;
var as5 = as;
var map11 = map7;
var flatMap10 = flatMap6;
var andThen4 = andThen2;
var flatten6 = flatten3;
var contains4 = contains3;
var squash = causeSquash;
var squashWith = causeSquashWith;
var find2 = find;
var filter6 = filter4;
var match10 = match4;
var reduce10 = reduce7;
var reduceWithContext3 = reduceWithContext;
var InterruptedException2 = InterruptedException;
var isInterruptedException2 = isInterruptedException;
var IllegalArgumentException2 = IllegalArgumentException;
var isIllegalArgumentException2 = isIllegalArgumentException;
var NoSuchElementException2 = NoSuchElementException;
var isNoSuchElementException2 = isNoSuchElementException;
var RuntimeException2 = RuntimeException;
var isRuntimeException2 = isRuntimeException;
var TimeoutException2 = TimeoutException;
var isTimeoutException2 = isTimeoutException;
var UnknownException2 = UnknownException;
var isUnknownException2 = isUnknownException;
var ExceededCapacityException2 = ExceededCapacityException;
var isExceededCapacityException2 = isExceededCapacityException;
var pretty2 = pretty;
var prettyErrors2 = prettyErrors;
var originalError = originalInstance;

// node_modules/effect/dist/esm/Effect.js
var Effect_exports = {};
__export(Effect_exports, {
  Do: () => Do2,
  EffectTypeId: () => EffectTypeId3,
  Service: () => Service,
  Tag: () => Tag2,
  acquireRelease: () => acquireRelease2,
  acquireReleaseInterruptible: () => acquireReleaseInterruptible2,
  acquireUseRelease: () => acquireUseRelease2,
  addFinalizer: () => addFinalizer2,
  all: () => all4,
  allSuccesses: () => allSuccesses2,
  allWith: () => allWith2,
  allowInterrupt: () => allowInterrupt2,
  andThen: () => andThen5,
  annotateCurrentSpan: () => annotateCurrentSpan2,
  annotateLogs: () => annotateLogs2,
  annotateLogsScoped: () => annotateLogsScoped2,
  annotateSpans: () => annotateSpans2,
  ap: () => ap,
  as: () => as6,
  asSome: () => asSome2,
  asSomeError: () => asSomeError2,
  asVoid: () => asVoid4,
  async: () => async2,
  asyncEffect: () => asyncEffect2,
  awaitAllChildren: () => awaitAllChildren2,
  bind: () => bind3,
  bindAll: () => bindAll2,
  bindTo: () => bindTo3,
  blocked: () => blocked2,
  cacheRequestResult: () => cacheRequestResult,
  cached: () => cached3,
  cachedFunction: () => cachedFunction2,
  cachedInvalidateWithTTL: () => cachedInvalidateWithTTL2,
  cachedWithTTL: () => cachedWithTTL,
  catch: () => _catch2,
  catchAll: () => catchAll2,
  catchAllCause: () => catchAllCause2,
  catchAllDefect: () => catchAllDefect2,
  catchIf: () => catchIf2,
  catchSome: () => catchSome2,
  catchSomeCause: () => catchSomeCause2,
  catchSomeDefect: () => catchSomeDefect2,
  catchTag: () => catchTag2,
  catchTags: () => catchTags2,
  cause: () => cause2,
  checkInterruptible: () => checkInterruptible2,
  clock: () => clock2,
  clockWith: () => clockWith4,
  configProviderWith: () => configProviderWith2,
  console: () => console3,
  consoleWith: () => consoleWith2,
  context: () => context3,
  contextWith: () => contextWith2,
  contextWithEffect: () => contextWithEffect2,
  currentParentSpan: () => currentParentSpan2,
  currentPropagatedSpan: () => currentPropagatedSpan2,
  currentSpan: () => currentSpan2,
  custom: () => custom2,
  daemonChildren: () => daemonChildren2,
  delay: () => delay2,
  descriptor: () => descriptor2,
  descriptorWith: () => descriptorWith2,
  die: () => die5,
  dieMessage: () => dieMessage2,
  dieSync: () => dieSync2,
  diffFiberRefs: () => diffFiberRefs2,
  disconnect: () => disconnect2,
  dropUntil: () => dropUntil2,
  dropWhile: () => dropWhile2,
  either: () => either3,
  ensureErrorType: () => ensureErrorType,
  ensureRequirementsType: () => ensureRequirementsType,
  ensureSuccessType: () => ensureSuccessType,
  ensuring: () => ensuring2,
  ensuringChild: () => ensuringChild2,
  ensuringChildren: () => ensuringChildren2,
  eventually: () => eventually2,
  every: () => every5,
  exists: () => exists3,
  exit: () => exit3,
  fail: () => fail6,
  failCause: () => failCause5,
  failCauseSync: () => failCauseSync2,
  failSync: () => failSync2,
  fiberId: () => fiberId2,
  fiberIdWith: () => fiberIdWith2,
  filter: () => filter7,
  filterEffectOrElse: () => filterEffectOrElse2,
  filterEffectOrFail: () => filterEffectOrFail2,
  filterMap: () => filterMap4,
  filterOrDie: () => filterOrDie2,
  filterOrDieMessage: () => filterOrDieMessage2,
  filterOrElse: () => filterOrElse2,
  filterOrFail: () => filterOrFail2,
  finalizersMask: () => finalizersMask2,
  findFirst: () => findFirst5,
  firstSuccessOf: () => firstSuccessOf2,
  flatMap: () => flatMap11,
  flatten: () => flatten7,
  flip: () => flip2,
  flipWith: () => flipWith2,
  fn: () => fn,
  fnUntraced: () => fnUntraced2,
  forEach: () => forEach8,
  forever: () => forever3,
  fork: () => fork3,
  forkAll: () => forkAll2,
  forkDaemon: () => forkDaemon2,
  forkIn: () => forkIn2,
  forkScoped: () => forkScoped2,
  forkWithErrorHandler: () => forkWithErrorHandler2,
  fromFiber: () => fromFiber2,
  fromFiberEffect: () => fromFiberEffect2,
  fromNullable: () => fromNullable3,
  functionWithSpan: () => functionWithSpan2,
  gen: () => gen2,
  getFiberRefs: () => getFiberRefs,
  getRuntimeFlags: () => getRuntimeFlags,
  head: () => head4,
  if: () => if_2,
  ignore: () => ignore2,
  ignoreLogged: () => ignoreLogged2,
  inheritFiberRefs: () => inheritFiberRefs2,
  interrupt: () => interrupt6,
  interruptWith: () => interruptWith2,
  interruptible: () => interruptible4,
  interruptibleMask: () => interruptibleMask2,
  intoDeferred: () => intoDeferred2,
  isEffect: () => isEffect2,
  isFailure: () => isFailure5,
  isSuccess: () => isSuccess3,
  iterate: () => iterate2,
  labelMetrics: () => labelMetrics2,
  labelMetricsScoped: () => labelMetricsScoped2,
  let: () => let_3,
  liftPredicate: () => liftPredicate2,
  linkSpanCurrent: () => linkSpanCurrent2,
  linkSpans: () => linkSpans2,
  locally: () => locally,
  locallyScoped: () => locallyScoped,
  locallyScopedWith: () => locallyScopedWith,
  locallyWith: () => locallyWith,
  log: () => log2,
  logAnnotations: () => logAnnotations2,
  logDebug: () => logDebug2,
  logError: () => logError2,
  logFatal: () => logFatal2,
  logInfo: () => logInfo2,
  logTrace: () => logTrace2,
  logWarning: () => logWarning2,
  logWithLevel: () => logWithLevel2,
  loop: () => loop2,
  makeLatch: () => makeLatch2,
  makeSemaphore: () => makeSemaphore2,
  makeSpan: () => makeSpan2,
  makeSpanScoped: () => makeSpanScoped2,
  map: () => map13,
  mapAccum: () => mapAccum3,
  mapBoth: () => mapBoth3,
  mapError: () => mapError3,
  mapErrorCause: () => mapErrorCause3,
  mapInputContext: () => mapInputContext2,
  match: () => match11,
  matchCause: () => matchCause3,
  matchCauseEffect: () => matchCauseEffect3,
  matchEffect: () => matchEffect3,
  merge: () => merge6,
  mergeAll: () => mergeAll5,
  metricLabels: () => metricLabels2,
  negate: () => negate2,
  never: () => never2,
  none: () => none9,
  onError: () => onError2,
  onExit: () => onExit3,
  onInterrupt: () => onInterrupt2,
  once: () => once3,
  option: () => option2,
  optionFromOptional: () => optionFromOptional2,
  orDie: () => orDie2,
  orDieWith: () => orDieWith2,
  orElse: () => orElse2,
  orElseFail: () => orElseFail2,
  orElseSucceed: () => orElseSucceed2,
  parallelErrors: () => parallelErrors2,
  parallelFinalizers: () => parallelFinalizers2,
  partition: () => partition4,
  patchFiberRefs: () => patchFiberRefs2,
  patchRuntimeFlags: () => patchRuntimeFlags,
  promise: () => promise2,
  provide: () => provide2,
  provideService: () => provideService2,
  provideServiceEffect: () => provideServiceEffect2,
  race: () => race2,
  raceAll: () => raceAll2,
  raceFirst: () => raceFirst2,
  raceWith: () => raceWith2,
  random: () => random3,
  randomWith: () => randomWith2,
  reduce: () => reduce11,
  reduceEffect: () => reduceEffect2,
  reduceRight: () => reduceRight3,
  reduceWhile: () => reduceWhile2,
  repeat: () => repeat,
  repeatN: () => repeatN2,
  repeatOrElse: () => repeatOrElse,
  replicate: () => replicate2,
  replicateEffect: () => replicateEffect2,
  request: () => request,
  retry: () => retry,
  retryOrElse: () => retryOrElse,
  runCallback: () => runCallback,
  runFork: () => runFork2,
  runPromise: () => runPromise,
  runPromiseExit: () => runPromiseExit,
  runRequestBlock: () => runRequestBlock2,
  runSync: () => runSync,
  runSyncExit: () => runSyncExit,
  runtime: () => runtime3,
  sandbox: () => sandbox2,
  schedule: () => schedule,
  scheduleForked: () => scheduleForked2,
  scheduleFrom: () => scheduleFrom,
  scope: () => scope2,
  scopeWith: () => scopeWith2,
  scoped: () => scoped2,
  scopedWith: () => scopedWith2,
  sequentialFinalizers: () => sequentialFinalizers2,
  serviceConstants: () => serviceConstants2,
  serviceFunction: () => serviceFunction2,
  serviceFunctionEffect: () => serviceFunctionEffect2,
  serviceFunctions: () => serviceFunctions2,
  serviceMembers: () => serviceMembers2,
  serviceOption: () => serviceOption2,
  serviceOptional: () => serviceOptional2,
  setFiberRefs: () => setFiberRefs2,
  sleep: () => sleep4,
  spanAnnotations: () => spanAnnotations2,
  spanLinks: () => spanLinks2,
  step: () => step3,
  succeed: () => succeed6,
  succeedNone: () => succeedNone2,
  succeedSome: () => succeedSome2,
  summarized: () => summarized2,
  supervised: () => supervised2,
  suspend: () => suspend4,
  sync: () => sync4,
  tagMetrics: () => tagMetrics2,
  tagMetricsScoped: () => tagMetricsScoped2,
  takeUntil: () => takeUntil2,
  takeWhile: () => takeWhile2,
  tap: () => tap2,
  tapBoth: () => tapBoth2,
  tapDefect: () => tapDefect2,
  tapError: () => tapError2,
  tapErrorCause: () => tapErrorCause2,
  tapErrorTag: () => tapErrorTag2,
  timed: () => timed2,
  timedWith: () => timedWith2,
  timeout: () => timeout2,
  timeoutFail: () => timeoutFail2,
  timeoutFailCause: () => timeoutFailCause2,
  timeoutOption: () => timeoutOption2,
  timeoutTo: () => timeoutTo2,
  tracer: () => tracer2,
  tracerWith: () => tracerWith4,
  transplant: () => transplant2,
  transposeMapOption: () => transposeMapOption,
  transposeOption: () => transposeOption,
  try: () => try_2,
  tryMap: () => tryMap2,
  tryMapPromise: () => tryMapPromise2,
  tryPromise: () => tryPromise2,
  uninterruptible: () => uninterruptible2,
  uninterruptibleMask: () => uninterruptibleMask3,
  unless: () => unless2,
  unlessEffect: () => unlessEffect2,
  unsafeMakeLatch: () => unsafeMakeLatch2,
  unsafeMakeSemaphore: () => unsafeMakeSemaphore2,
  unsandbox: () => unsandbox2,
  updateFiberRefs: () => updateFiberRefs2,
  updateService: () => updateService2,
  useSpan: () => useSpan2,
  using: () => using2,
  validate: () => validate2,
  validateAll: () => validateAll2,
  validateFirst: () => validateFirst2,
  validateWith: () => validateWith2,
  void: () => _void,
  when: () => when2,
  whenEffect: () => whenEffect2,
  whenFiberRef: () => whenFiberRef2,
  whenLogLevel: () => whenLogLevel2,
  whenRef: () => whenRef2,
  whileLoop: () => whileLoop3,
  withClock: () => withClock2,
  withClockScoped: () => withClockScoped2,
  withConcurrency: () => withConcurrency2,
  withConfigProvider: () => withConfigProvider2,
  withConfigProviderScoped: () => withConfigProviderScoped2,
  withConsole: () => withConsole2,
  withConsoleScoped: () => withConsoleScoped2,
  withEarlyRelease: () => withEarlyRelease2,
  withExecutionPlan: () => withExecutionPlan2,
  withFiberRuntime: () => withFiberRuntime2,
  withLogSpan: () => withLogSpan2,
  withMaxOpsBeforeYield: () => withMaxOpsBeforeYield2,
  withMetric: () => withMetric2,
  withParentSpan: () => withParentSpan2,
  withRandom: () => withRandom2,
  withRandomFixed: () => withRandomFixed,
  withRandomScoped: () => withRandomScoped2,
  withRequestBatching: () => withRequestBatching2,
  withRequestCache: () => withRequestCache2,
  withRequestCaching: () => withRequestCaching2,
  withRuntimeFlagsPatch: () => withRuntimeFlagsPatch,
  withRuntimeFlagsPatchScoped: () => withRuntimeFlagsPatchScoped,
  withScheduler: () => withScheduler2,
  withSchedulingPriority: () => withSchedulingPriority2,
  withSpan: () => withSpan2,
  withSpanScoped: () => withSpanScoped2,
  withTracer: () => withTracer2,
  withTracerEnabled: () => withTracerEnabled2,
  withTracerScoped: () => withTracerScoped2,
  withTracerTiming: () => withTracerTiming2,
  withUnhandledErrorLogLevel: () => withUnhandledErrorLogLevel2,
  yieldNow: () => yieldNow4,
  zip: () => zip5,
  zipLeft: () => zipLeft3,
  zipRight: () => zipRight3,
  zipWith: () => zipWith4
});

// node_modules/effect/dist/esm/internal/schedule/interval.js
var IntervalSymbolKey = "effect/ScheduleInterval";
var IntervalTypeId = /* @__PURE__ */ Symbol.for(IntervalSymbolKey);
var empty27 = {
  [IntervalTypeId]: IntervalTypeId,
  startMillis: 0,
  endMillis: 0
};
var make34 = (startMillis, endMillis) => {
  if (startMillis > endMillis) {
    return empty27;
  }
  return {
    [IntervalTypeId]: IntervalTypeId,
    startMillis,
    endMillis
  };
};
var lessThan3 = /* @__PURE__ */ dual(2, (self, that) => min3(self, that) === self);
var min3 = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.endMillis <= that.startMillis) return self;
  if (that.endMillis <= self.startMillis) return that;
  if (self.startMillis < that.startMillis) return self;
  if (that.startMillis < self.startMillis) return that;
  if (self.endMillis <= that.endMillis) return self;
  return that;
});
var isEmpty8 = (self) => {
  return self.startMillis >= self.endMillis;
};
var intersect = /* @__PURE__ */ dual(2, (self, that) => {
  const start3 = Math.max(self.startMillis, that.startMillis);
  const end3 = Math.min(self.endMillis, that.endMillis);
  return make34(start3, end3);
});
var after = (startMilliseconds) => {
  return make34(startMilliseconds, Number.POSITIVE_INFINITY);
};

// node_modules/effect/dist/esm/ScheduleInterval.js
var empty28 = empty27;
var lessThan4 = lessThan3;
var isEmpty9 = isEmpty8;
var intersect2 = intersect;
var after2 = after;

// node_modules/effect/dist/esm/internal/schedule/intervals.js
var IntervalsSymbolKey = "effect/ScheduleIntervals";
var IntervalsTypeId = /* @__PURE__ */ Symbol.for(IntervalsSymbolKey);
var make36 = (intervals) => {
  return {
    [IntervalsTypeId]: IntervalsTypeId,
    intervals
  };
};
var intersect3 = /* @__PURE__ */ dual(2, (self, that) => intersectLoop(self.intervals, that.intervals, empty4()));
var intersectLoop = (_left, _right, _acc) => {
  let left3 = _left;
  let right3 = _right;
  let acc = _acc;
  while (isNonEmpty(left3) && isNonEmpty(right3)) {
    const interval = pipe(headNonEmpty2(left3), intersect2(headNonEmpty2(right3)));
    const intervals = isEmpty9(interval) ? acc : pipe(acc, prepend2(interval));
    if (pipe(headNonEmpty2(left3), lessThan4(headNonEmpty2(right3)))) {
      left3 = tailNonEmpty2(left3);
    } else {
      right3 = tailNonEmpty2(right3);
    }
    acc = intervals;
  }
  return make36(reverse2(acc));
};
var start = (self) => {
  return pipe(self.intervals, head2, getOrElse(() => empty28)).startMillis;
};
var end = (self) => {
  return pipe(self.intervals, head2, getOrElse(() => empty28)).endMillis;
};
var lessThan5 = /* @__PURE__ */ dual(2, (self, that) => start(self) < start(that));
var isNonEmpty3 = (self) => {
  return isNonEmpty(self.intervals);
};

// node_modules/effect/dist/esm/ScheduleIntervals.js
var make37 = make36;
var intersect4 = intersect3;
var start2 = start;
var end2 = end;
var lessThan6 = lessThan5;
var isNonEmpty4 = isNonEmpty3;

// node_modules/effect/dist/esm/internal/schedule/decision.js
var OP_CONTINUE = "Continue";
var OP_DONE2 = "Done";
var _continue = (intervals) => {
  return {
    _tag: OP_CONTINUE,
    intervals
  };
};
var continueWith = (interval) => {
  return {
    _tag: OP_CONTINUE,
    intervals: make37(of2(interval))
  };
};
var done5 = {
  _tag: OP_DONE2
};
var isContinue = (self) => {
  return self._tag === OP_CONTINUE;
};
var isDone3 = (self) => {
  return self._tag === OP_DONE2;
};

// node_modules/effect/dist/esm/ScheduleDecision.js
var _continue2 = _continue;
var continueWith2 = continueWith;
var done6 = done5;
var isContinue2 = isContinue;
var isDone4 = isDone3;

// node_modules/effect/dist/esm/Scope.js
var close = scopeClose;
var fork2 = scopeFork;

// node_modules/effect/dist/esm/internal/effect/circular.js
var Semaphore = class {
  permits;
  waiters = /* @__PURE__ */ new Set();
  taken = 0;
  constructor(permits) {
    this.permits = permits;
  }
  get free() {
    return this.permits - this.taken;
  }
  take = (n) => asyncInterrupt((resume2) => {
    if (this.free < n) {
      const observer = () => {
        if (this.free < n) return;
        this.waiters.delete(observer);
        resume2(suspend(() => {
          if (this.free < n) return this.take(n);
          this.taken += n;
          return succeed(n);
        }));
      };
      this.waiters.add(observer);
      return sync(() => {
        this.waiters.delete(observer);
      });
    }
    resume2(suspend(() => {
      if (this.free < n) return this.take(n);
      this.taken += n;
      return succeed(n);
    }));
  });
  updateTakenUnsafe(fiber, f) {
    this.taken = f(this.taken);
    if (this.waiters.size > 0) {
      fiber.getFiberRef(currentScheduler).scheduleTask(() => {
        const iter = this.waiters.values();
        let item = iter.next();
        while (item.done === false && this.free > 0) {
          item.value();
          item = iter.next();
        }
      }, fiber.getFiberRef(currentSchedulingPriority), fiber);
    }
    return succeed(this.free);
  }
  updateTaken(f) {
    return withFiberRuntime((fiber) => this.updateTakenUnsafe(fiber, f));
  }
  resize = (permits) => asVoid(withFiberRuntime((fiber) => {
    this.permits = permits;
    if (this.free < 0) {
      return void_;
    }
    return this.updateTakenUnsafe(fiber, (taken) => taken);
  }));
  release = (n) => this.updateTaken((taken) => taken - n);
  releaseAll = /* @__PURE__ */ this.updateTaken((_) => 0);
  withPermits = (n) => (self) => uninterruptibleMask((restore) => flatMap7(restore(this.take(n)), (permits) => ensuring(restore(self), this.release(permits))));
  withPermitsIfAvailable = (n) => (self) => uninterruptibleMask((restore) => suspend(() => {
    if (this.free < n) {
      return succeedNone;
    }
    this.taken += n;
    return ensuring(restore(asSome(self)), this.release(n));
  }));
};
var unsafeMakeSemaphore = (permits) => new Semaphore(permits);
var makeSemaphore = (permits) => sync(() => unsafeMakeSemaphore(permits));
var Latch = class extends Class2 {
  isOpen;
  waiters = [];
  scheduled = false;
  constructor(isOpen) {
    super();
    this.isOpen = isOpen;
  }
  commit() {
    return this.await;
  }
  unsafeSchedule(fiber) {
    if (this.scheduled || this.waiters.length === 0) {
      return void_;
    }
    this.scheduled = true;
    fiber.currentScheduler.scheduleTask(this.flushWaiters, fiber.getFiberRef(currentSchedulingPriority), fiber);
    return void_;
  }
  flushWaiters = () => {
    this.scheduled = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (let i = 0; i < waiters.length; i++) {
      waiters[i](exitVoid);
    }
  };
  open = /* @__PURE__ */ withFiberRuntime((fiber) => {
    if (this.isOpen) {
      return void_;
    }
    this.isOpen = true;
    return this.unsafeSchedule(fiber);
  });
  unsafeOpen() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.flushWaiters();
  }
  release = /* @__PURE__ */ withFiberRuntime((fiber) => {
    if (this.isOpen) {
      return void_;
    }
    return this.unsafeSchedule(fiber);
  });
  await = /* @__PURE__ */ asyncInterrupt((resume2) => {
    if (this.isOpen) {
      return resume2(void_);
    }
    this.waiters.push(resume2);
    return sync(() => {
      const index = this.waiters.indexOf(resume2);
      if (index !== -1) {
        this.waiters.splice(index, 1);
      }
    });
  });
  unsafeClose() {
    this.isOpen = false;
  }
  close = /* @__PURE__ */ sync(() => {
    this.isOpen = false;
  });
  whenOpen = (self) => {
    return zipRight(this.await, self);
  };
};
var unsafeMakeLatch = (open) => new Latch(open ?? false);
var makeLatch = (open) => sync(() => unsafeMakeLatch(open));
var awaitAllChildren = (self) => ensuringChildren(self, fiberAwaitAll);
var cached2 = /* @__PURE__ */ dual(2, (self, timeToLive) => map8(cachedInvalidateWithTTL(self, timeToLive), (tuple) => tuple[0]));
var cachedInvalidateWithTTL = /* @__PURE__ */ dual(2, (self, timeToLive) => {
  const duration = decode(timeToLive);
  return flatMap7(context(), (env) => map8(makeSynchronized(none2()), (cache) => [provideContext(getCachedValue(self, duration, cache), env), invalidateCache(cache)]));
});
var computeCachedValue = (self, timeToLive, start3) => {
  const timeToLiveMillis = toMillis(decode(timeToLive));
  return pipe(deferredMake(), tap((deferred) => intoDeferred(self, deferred)), map8((deferred) => some2([start3 + timeToLiveMillis, deferred])));
};
var getCachedValue = (self, timeToLive, cache) => uninterruptibleMask((restore) => pipe(clockWith3((clock3) => clock3.currentTimeMillis), flatMap7((time) => updateSomeAndGetEffectSynchronized(cache, (option3) => {
  switch (option3._tag) {
    case "None": {
      return some2(computeCachedValue(self, timeToLive, time));
    }
    case "Some": {
      const [end3] = option3.value;
      return end3 - time <= 0 ? some2(computeCachedValue(self, timeToLive, time)) : none2();
    }
  }
})), flatMap7((option3) => isNone2(option3) ? dieMessage("BUG: Effect.cachedInvalidate - please report an issue at https://github.com/Effect-TS/effect/issues") : restore(deferredAwait(option3.value[1])))));
var invalidateCache = (cache) => set5(cache, none2());
var ensuringChild = /* @__PURE__ */ dual(2, (self, f) => ensuringChildren(self, (children) => f(fiberAll(children))));
var ensuringChildren = /* @__PURE__ */ dual(2, (self, children) => flatMap7(track, (supervisor) => pipe(supervised(self, supervisor), ensuring(flatMap7(supervisor.value, children)))));
var forkAll = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (effects, options) => options?.discard ? forEachSequentialDiscard(effects, fork) : map8(forEachSequential(effects, fork), fiberAll));
var forkIn = /* @__PURE__ */ dual(2, (self, scope3) => withFiberRuntime((parent, parentStatus) => {
  const scopeImpl = scope3;
  const fiber = unsafeFork2(self, parent, parentStatus.runtimeFlags, globalScope);
  if (scopeImpl.state._tag === "Open") {
    const finalizer = () => fiberIdWith((fiberId3) => equals(fiberId3, fiber.id()) ? void_ : asVoid(interruptFiber(fiber)));
    const key = {};
    scopeImpl.state.finalizers.set(key, finalizer);
    fiber.addObserver(() => {
      if (scopeImpl.state._tag === "Closed") return;
      scopeImpl.state.finalizers.delete(key);
    });
  } else {
    fiber.unsafeInterruptAsFork(parent.id());
  }
  return succeed(fiber);
}));
var forkScoped = (self) => scopeWith((scope3) => forkIn(self, scope3));
var fromFiber = (fiber) => join2(fiber);
var fromFiberEffect = (fiber) => suspend(() => flatMap7(fiber, join2));
var memoKeySymbol = /* @__PURE__ */ Symbol.for("effect/Effect/memoizeFunction.key");
var Key = class {
  a;
  eq;
  [memoKeySymbol] = memoKeySymbol;
  constructor(a, eq) {
    this.a = a;
    this.eq = eq;
  }
  [symbol2](that) {
    if (hasProperty(that, memoKeySymbol)) {
      if (this.eq) {
        return this.eq(this.a, that.a);
      } else {
        return equals(this.a, that.a);
      }
    }
    return false;
  }
  [symbol]() {
    return this.eq ? 0 : cached(this, hash(this.a));
  }
};
var cachedFunction = (f, eq) => {
  return pipe(sync(() => empty17()), flatMap7(makeSynchronized), map8((ref) => (a) => pipe(ref.modifyEffect((map14) => {
    const result = pipe(map14, get8(new Key(a, eq)));
    if (isNone2(result)) {
      return pipe(deferredMake(), tap((deferred) => pipe(diffFiberRefs(f(a)), intoDeferred(deferred), fork)), map8((deferred) => [deferred, pipe(map14, set4(new Key(a, eq), deferred))]));
    }
    return succeed([result.value, map14]);
  }), flatMap7(deferredAwait), flatMap7(([patch9, b]) => pipe(patchFiberRefs(patch9), as2(b))))));
};
var raceFirst = /* @__PURE__ */ dual(2, (self, that) => pipe(exit(self), race(exit(that)), (effect) => flatten4(effect)));
var supervised = /* @__PURE__ */ dual(2, (self, supervisor) => {
  const supervise = fiberRefLocallyWith(currentSupervisor, (s) => s.zip(supervisor));
  return supervise(self);
});
var timeout = /* @__PURE__ */ dual(2, (self, duration) => timeoutFail(self, {
  onTimeout: () => timeoutExceptionFromDuration(duration),
  duration
}));
var timeoutFail = /* @__PURE__ */ dual(2, (self, {
  duration,
  onTimeout
}) => flatten4(timeoutTo(self, {
  onTimeout: () => failSync(onTimeout),
  onSuccess: succeed,
  duration
})));
var timeoutFailCause = /* @__PURE__ */ dual(2, (self, {
  duration,
  onTimeout
}) => flatten4(timeoutTo(self, {
  onTimeout: () => failCauseSync(onTimeout),
  onSuccess: succeed,
  duration
})));
var timeoutOption = /* @__PURE__ */ dual(2, (self, duration) => timeoutTo(self, {
  duration,
  onSuccess: some2,
  onTimeout: none2
}));
var timeoutTo = /* @__PURE__ */ dual(2, (self, {
  duration,
  onSuccess,
  onTimeout
}) => fiberIdWith((parentFiberId) => uninterruptibleMask((restore) => raceFibersWith(exit(restore(self)), interruptible2(sleep3(duration)), {
  onSelfWin: (winner, loser) => flatMap7(winner.await, (exit4) => {
    const selfExit = exitFlatten(exit4);
    if (selfExit._tag === "Success") {
      return flatMap7(winner.inheritAll, () => as2(interruptAsFiber(loser, parentFiberId), onSuccess(selfExit.value)));
    } else {
      return flatMap7(interruptAsFiber(loser, parentFiberId), () => exitFailCause(selfExit.cause));
    }
  }),
  onOtherWin: (winner, loser) => flatMap7(winner.await, (exit4) => {
    if (exit4._tag === "Success") {
      return flatMap7(winner.inheritAll, () => as2(interruptAsFiber(loser, parentFiberId), onTimeout()));
    } else {
      return flatMap7(interruptAsFiber(loser, parentFiberId), () => exitFailCause(exit4.cause));
    }
  }),
  otherScope: globalScope
}))));
var SynchronizedSymbolKey = "effect/Ref/SynchronizedRef";
var SynchronizedTypeId = /* @__PURE__ */ Symbol.for(SynchronizedSymbolKey);
var synchronizedVariance = {
  /* c8 ignore next */
  _A: (_) => _
};
var SynchronizedImpl = class extends Class2 {
  ref;
  withLock;
  [SynchronizedTypeId] = synchronizedVariance;
  [RefTypeId] = refVariance;
  [TypeId12] = TypeId12;
  constructor(ref, withLock) {
    super();
    this.ref = ref;
    this.withLock = withLock;
    this.get = get11(this.ref);
  }
  get;
  commit() {
    return this.get;
  }
  modify(f) {
    return this.modifyEffect((a) => succeed(f(a)));
  }
  modifyEffect(f) {
    return this.withLock(pipe(flatMap7(get11(this.ref), f), flatMap7(([b, a]) => as2(set5(this.ref, a), b))));
  }
};
var makeSynchronized = (value) => sync(() => unsafeMakeSynchronized(value));
var unsafeMakeSynchronized = (value) => {
  const ref = unsafeMake5(value);
  const sem = unsafeMakeSemaphore(1);
  return new SynchronizedImpl(ref, sem.withPermits(1));
};
var updateSomeAndGetEffectSynchronized = /* @__PURE__ */ dual(2, (self, pf) => self.modifyEffect((value) => {
  const result = pf(value);
  switch (result._tag) {
    case "None": {
      return succeed([value, value]);
    }
    case "Some": {
      return map8(result.value, (a) => [a, a]);
    }
  }
}));
var bindAll = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, f, options) => flatMap7(self, (a) => all3(f(a), options).pipe(map8((record) => Object.assign({}, a, record)))));

// node_modules/effect/dist/esm/internal/managedRuntime/circular.js
var TypeId15 = /* @__PURE__ */ Symbol.for("effect/ManagedRuntime");

// node_modules/effect/dist/esm/internal/opCodes/layer.js
var OP_FRESH = "Fresh";
var OP_FROM_EFFECT = "FromEffect";
var OP_SCOPED = "Scoped";
var OP_SUSPEND = "Suspend";
var OP_PROVIDE = "Provide";
var OP_PROVIDE_MERGE = "ProvideMerge";
var OP_MERGE_ALL = "MergeAll";

// node_modules/effect/dist/esm/Fiber.js
var interruptAs = interruptAsFiber;

// node_modules/effect/dist/esm/internal/runtime.js
var makeDual = (f) => function() {
  if (arguments.length === 1) {
    const runtime4 = arguments[0];
    return (effect, ...args2) => f(runtime4, effect, ...args2);
  }
  return f.apply(this, arguments);
};
var unsafeFork3 = /* @__PURE__ */ makeDual((runtime4, self, options) => {
  const fiberId3 = unsafeMake2();
  const fiberRefUpdates = [[currentContext, [[fiberId3, runtime4.context]]]];
  if (options?.scheduler) {
    fiberRefUpdates.push([currentScheduler, [[fiberId3, options.scheduler]]]);
  }
  let fiberRefs3 = updateManyAs2(runtime4.fiberRefs, {
    entries: fiberRefUpdates,
    forkAs: fiberId3
  });
  if (options?.updateRefs) {
    fiberRefs3 = options.updateRefs(fiberRefs3, fiberId3);
  }
  const fiberRuntime = new FiberRuntime(fiberId3, fiberRefs3, runtime4.runtimeFlags);
  let effect = self;
  if (options?.scope) {
    effect = flatMap7(fork2(options.scope, sequential2), (closeableScope) => zipRight(scopeAddFinalizer(closeableScope, fiberIdWith((id) => equals(id, fiberRuntime.id()) ? void_ : interruptAsFiber(fiberRuntime, id))), onExit(self, (exit4) => close(closeableScope, exit4))));
  }
  const supervisor = fiberRuntime.currentSupervisor;
  if (supervisor !== none8) {
    supervisor.onStart(runtime4.context, effect, none2(), fiberRuntime);
    fiberRuntime.addObserver((exit4) => supervisor.onEnd(exit4, fiberRuntime));
  }
  globalScope.add(runtime4.runtimeFlags, fiberRuntime);
  if (options?.immediate === false) {
    fiberRuntime.resume(effect);
  } else {
    fiberRuntime.start(effect);
  }
  return fiberRuntime;
});
var unsafeRunCallback = /* @__PURE__ */ makeDual((runtime4, effect, options = {}) => {
  const fiberRuntime = unsafeFork3(runtime4, effect, options);
  if (options.onExit) {
    fiberRuntime.addObserver((exit4) => {
      options.onExit(exit4);
    });
  }
  return (id, cancelOptions) => unsafeRunCallback(runtime4)(pipe(fiberRuntime, interruptAs(id ?? none4)), {
    ...cancelOptions,
    onExit: cancelOptions?.onExit ? (exit4) => cancelOptions.onExit(flatten5(exit4)) : void 0
  });
});
var unsafeRunSync = /* @__PURE__ */ makeDual((runtime4, effect) => {
  const result = unsafeRunSyncExit(runtime4)(effect);
  if (result._tag === "Failure") {
    throw fiberFailure(result.effect_instruction_i0);
  }
  return result.effect_instruction_i0;
});
var AsyncFiberExceptionImpl = class extends Error {
  fiber;
  _tag = "AsyncFiberException";
  constructor(fiber) {
    super(`Fiber #${fiber.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`);
    this.fiber = fiber;
    this.name = this._tag;
    this.stack = this.message;
  }
};
var asyncFiberException = (fiber) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  const error = new AsyncFiberExceptionImpl(fiber);
  Error.stackTraceLimit = limit;
  return error;
};
var FiberFailureId = /* @__PURE__ */ Symbol.for("effect/Runtime/FiberFailure");
var FiberFailureCauseId = /* @__PURE__ */ Symbol.for("effect/Runtime/FiberFailure/Cause");
var FiberFailureImpl = class extends Error {
  [FiberFailureId];
  [FiberFailureCauseId];
  constructor(cause3) {
    const head5 = prettyErrors(cause3)[0];
    super(head5?.message || "An error has occurred");
    this[FiberFailureId] = FiberFailureId;
    this[FiberFailureCauseId] = cause3;
    this.name = head5 ? `(FiberFailure) ${head5.name}` : "FiberFailure";
    if (head5?.stack) {
      this.stack = head5.stack;
    }
  }
  toJSON() {
    return {
      _id: "FiberFailure",
      cause: this[FiberFailureCauseId].toJSON()
    };
  }
  toString() {
    return "(FiberFailure) " + pretty(this[FiberFailureCauseId], {
      renderErrorCause: true
    });
  }
  [NodeInspectSymbol]() {
    return this.toString();
  }
};
var fiberFailure = (cause3) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  const error = new FiberFailureImpl(cause3);
  Error.stackTraceLimit = limit;
  return error;
};
var fastPath = (effect) => {
  const op = effect;
  switch (op._op) {
    case "Failure":
    case "Success": {
      return op;
    }
    case "Left": {
      return exitFail(op.left);
    }
    case "Right": {
      return exitSucceed(op.right);
    }
    case "Some": {
      return exitSucceed(op.value);
    }
    case "None": {
      return exitFail(new NoSuchElementException());
    }
  }
};
var unsafeRunSyncExit = /* @__PURE__ */ makeDual((runtime4, effect) => {
  const op = fastPath(effect);
  if (op) {
    return op;
  }
  const scheduler = new SyncScheduler();
  const fiberRuntime = unsafeFork3(runtime4)(effect, {
    scheduler
  });
  scheduler.flush();
  const result = fiberRuntime.unsafePoll();
  if (result) {
    return result;
  }
  return exitDie(capture(asyncFiberException(fiberRuntime), currentSpanFromFiber(fiberRuntime)));
});
var unsafeRunPromise = /* @__PURE__ */ makeDual((runtime4, effect, options) => unsafeRunPromiseExit(runtime4, effect, options).then((result) => {
  switch (result._tag) {
    case OP_SUCCESS: {
      return result.effect_instruction_i0;
    }
    case OP_FAILURE: {
      throw fiberFailure(result.effect_instruction_i0);
    }
  }
}));
var unsafeRunPromiseExit = /* @__PURE__ */ makeDual((runtime4, effect, options) => new Promise((resolve3) => {
  const op = fastPath(effect);
  if (op) {
    resolve3(op);
  }
  const fiber = unsafeFork3(runtime4)(effect);
  fiber.addObserver((exit4) => {
    resolve3(exit4);
  });
  if (options?.signal !== void 0) {
    if (options.signal.aborted) {
      fiber.unsafeInterruptAsFork(fiber.id());
    } else {
      options.signal.addEventListener("abort", () => {
        fiber.unsafeInterruptAsFork(fiber.id());
      }, {
        once: true
      });
    }
  }
}));
var RuntimeImpl = class {
  context;
  runtimeFlags;
  fiberRefs;
  constructor(context4, runtimeFlags2, fiberRefs3) {
    this.context = context4;
    this.runtimeFlags = runtimeFlags2;
    this.fiberRefs = fiberRefs3;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make38 = (options) => new RuntimeImpl(options.context, options.runtimeFlags, options.fiberRefs);
var runtime2 = () => withFiberRuntime((state, status) => succeed(new RuntimeImpl(state.getFiberRef(currentContext), status.runtimeFlags, state.getFiberRefs())));
var defaultRuntimeFlags = /* @__PURE__ */ make16(Interruption, CooperativeYielding, RuntimeMetrics);
var defaultRuntime = /* @__PURE__ */ make38({
  context: /* @__PURE__ */ empty3(),
  runtimeFlags: defaultRuntimeFlags,
  fiberRefs: /* @__PURE__ */ empty21()
});
var unsafeRunEffect = /* @__PURE__ */ unsafeRunCallback(defaultRuntime);
var unsafeForkEffect = /* @__PURE__ */ unsafeFork3(defaultRuntime);
var unsafeRunPromiseEffect = /* @__PURE__ */ unsafeRunPromise(defaultRuntime);
var unsafeRunPromiseExitEffect = /* @__PURE__ */ unsafeRunPromiseExit(defaultRuntime);
var unsafeRunSyncEffect = /* @__PURE__ */ unsafeRunSync(defaultRuntime);
var unsafeRunSyncExitEffect = /* @__PURE__ */ unsafeRunSyncExit(defaultRuntime);
var asyncEffect = (register) => suspend(() => {
  let cleanup = void 0;
  return flatMap7(deferredMake(), (deferred) => flatMap7(runtime2(), (runtime4) => uninterruptibleMask((restore) => zipRight(fork(restore(matchCauseEffect(register((cb) => unsafeRunCallback(runtime4)(intoDeferred(cb, deferred))), {
    onFailure: (cause3) => deferredFailCause(deferred, cause3),
    onSuccess: (cleanup_) => {
      cleanup = cleanup_;
      return void_;
    }
  }))), restore(onInterrupt(deferredAwait(deferred), () => cleanup ?? void_))))));
});

// node_modules/effect/dist/esm/internal/synchronizedRef.js
var modifyEffect = /* @__PURE__ */ dual(2, (self, f) => self.modifyEffect(f));

// node_modules/effect/dist/esm/internal/layer.js
var LayerSymbolKey = "effect/Layer";
var LayerTypeId = /* @__PURE__ */ Symbol.for(LayerSymbolKey);
var layerVariance = {
  /* c8 ignore next */
  _RIn: (_) => _,
  /* c8 ignore next */
  _E: (_) => _,
  /* c8 ignore next */
  _ROut: (_) => _
};
var proto3 = {
  [LayerTypeId]: layerVariance,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var MemoMapTypeIdKey = "effect/Layer/MemoMap";
var MemoMapTypeId = /* @__PURE__ */ Symbol.for(MemoMapTypeIdKey);
var CurrentMemoMap = /* @__PURE__ */ Reference2()("effect/Layer/CurrentMemoMap", {
  defaultValue: () => unsafeMakeMemoMap()
});
var isLayer = (u) => hasProperty(u, LayerTypeId);
var isFresh = (self) => {
  return self._op_layer === OP_FRESH;
};
var MemoMapImpl = class {
  ref;
  [MemoMapTypeId];
  constructor(ref) {
    this.ref = ref;
    this[MemoMapTypeId] = MemoMapTypeId;
  }
  /**
   * Checks the memo map to see if a layer exists. If it is, immediately
   * returns it. Otherwise, obtains the layer, stores it in the memo map,
   * and adds a finalizer to the `Scope`.
   */
  getOrElseMemoize(layer, scope3) {
    return pipe(modifyEffect(this.ref, (map14) => {
      const inMap = map14.get(layer);
      if (inMap !== void 0) {
        const [acquire, release] = inMap;
        const cached4 = pipe(acquire, flatMap7(([patch9, b]) => pipe(patchFiberRefs(patch9), as2(b))), onExit(exitMatch({
          onFailure: () => void_,
          onSuccess: () => scopeAddFinalizerExit(scope3, release)
        })));
        return succeed([cached4, map14]);
      }
      return pipe(make26(0), flatMap7((observers) => pipe(deferredMake(), flatMap7((deferred) => pipe(make26(() => void_), map8((finalizerRef) => {
        const resource = uninterruptibleMask((restore) => pipe(scopeMake(), flatMap7((innerScope) => pipe(restore(flatMap7(makeBuilder(layer, innerScope, true), (f) => diffFiberRefs(f(this)))), exit, flatMap7((exit4) => {
          switch (exit4._tag) {
            case OP_FAILURE: {
              return pipe(deferredFailCause(deferred, exit4.effect_instruction_i0), zipRight(scopeClose(innerScope, exit4)), zipRight(failCause(exit4.effect_instruction_i0)));
            }
            case OP_SUCCESS: {
              return pipe(set5(finalizerRef, (exit5) => pipe(scopeClose(innerScope, exit5), whenEffect(modify3(observers, (n) => [n === 1, n - 1])), asVoid)), zipRight(update2(observers, (n) => n + 1)), zipRight(scopeAddFinalizerExit(scope3, (exit5) => pipe(sync(() => map14.delete(layer)), zipRight(get11(finalizerRef)), flatMap7((finalizer) => finalizer(exit5))))), zipRight(deferredSucceed(deferred, exit4.effect_instruction_i0)), as2(exit4.effect_instruction_i0[1]));
            }
          }
        })))));
        const memoized = [pipe(deferredAwait(deferred), onExit(exitMatchEffect({
          onFailure: () => void_,
          onSuccess: () => update2(observers, (n) => n + 1)
        }))), (exit4) => pipe(get11(finalizerRef), flatMap7((finalizer) => finalizer(exit4)))];
        return [resource, isFresh(layer) ? map14 : map14.set(layer, memoized)];
      }))))));
    }), flatten4);
  }
};
var makeMemoMap = /* @__PURE__ */ suspend(() => map8(makeSynchronized(/* @__PURE__ */ new Map()), (ref) => new MemoMapImpl(ref)));
var unsafeMakeMemoMap = () => new MemoMapImpl(unsafeMakeSynchronized(/* @__PURE__ */ new Map()));
var buildWithScope = /* @__PURE__ */ dual(2, (self, scope3) => flatMap7(makeMemoMap, (memoMap) => buildWithMemoMap(self, memoMap, scope3)));
var buildWithMemoMap = /* @__PURE__ */ dual(3, (self, memoMap, scope3) => flatMap7(makeBuilder(self, scope3), (run) => provideService(run(memoMap), CurrentMemoMap, memoMap)));
var makeBuilder = (self, scope3, inMemoMap = false) => {
  const op = self;
  switch (op._op_layer) {
    case "Locally": {
      return sync(() => (memoMap) => op.f(memoMap.getOrElseMemoize(op.self, scope3)));
    }
    case "ExtendScope": {
      return sync(() => (memoMap) => scopeWith((scope4) => memoMap.getOrElseMemoize(op.layer, scope4)));
    }
    case "Fold": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.layer, scope3), matchCauseEffect({
        onFailure: (cause3) => memoMap.getOrElseMemoize(op.failureK(cause3), scope3),
        onSuccess: (value) => memoMap.getOrElseMemoize(op.successK(value), scope3)
      })));
    }
    case "Fresh": {
      return sync(() => (_) => pipe(op.layer, buildWithScope(scope3)));
    }
    case "FromEffect": {
      return inMemoMap ? sync(() => (_) => op.effect) : sync(() => (memoMap) => memoMap.getOrElseMemoize(self, scope3));
    }
    case "Provide": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, scope3), flatMap7((env) => pipe(memoMap.getOrElseMemoize(op.second, scope3), provideContext(env)))));
    }
    case "Scoped": {
      return inMemoMap ? sync(() => (_) => scopeExtend(op.effect, scope3)) : sync(() => (memoMap) => memoMap.getOrElseMemoize(self, scope3));
    }
    case "Suspend": {
      return sync(() => (memoMap) => memoMap.getOrElseMemoize(op.evaluate(), scope3));
    }
    case "ProvideMerge": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, scope3), zipWith2(memoMap.getOrElseMemoize(op.second, scope3), op.zipK)));
    }
    case "ZipWith": {
      return gen(function* () {
        const parallelScope = yield* scopeFork(scope3, parallel2);
        const firstScope = yield* scopeFork(parallelScope, sequential2);
        const secondScope = yield* scopeFork(parallelScope, sequential2);
        return (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, firstScope), zipWithOptions(memoMap.getOrElseMemoize(op.second, secondScope), op.zipK, {
          concurrent: true
        }));
      });
    }
    case "MergeAll": {
      const layers = op.layers;
      return map8(scopeFork(scope3, parallel2), (parallelScope) => (memoMap) => {
        const contexts = new Array(layers.length);
        return map8(forEachConcurrentDiscard(layers, fnUntraced(function* (layer, i) {
          const scope4 = yield* scopeFork(parallelScope, sequential2);
          const context4 = yield* memoMap.getOrElseMemoize(layer, scope4);
          contexts[i] = context4;
        }), false, false), () => mergeAll2(...contexts));
      });
    }
  }
};
var context2 = () => fromEffectContext(context());
var fromEffect2 = /* @__PURE__ */ dual(2, (a, b) => {
  const tagFirst = isTag2(a);
  const tag = tagFirst ? a : b;
  const effect = tagFirst ? b : a;
  return fromEffectContext(map8(effect, (service) => make5(tag, service)));
});
function fromEffectContext(effect) {
  const fromEffect3 = Object.create(proto3);
  fromEffect3._op_layer = OP_FROM_EFFECT;
  fromEffect3.effect = effect;
  return fromEffect3;
}
var mergeAll4 = (...layers) => {
  const mergeAll6 = Object.create(proto3);
  mergeAll6._op_layer = OP_MERGE_ALL;
  mergeAll6.layers = layers;
  return mergeAll6;
};
var scoped = /* @__PURE__ */ dual(2, (a, b) => {
  const tagFirst = isTag2(a);
  const tag = tagFirst ? a : b;
  const effect = tagFirst ? b : a;
  return scopedContext(map8(effect, (service) => make5(tag, service)));
});
var scopedContext = (effect) => {
  const scoped3 = Object.create(proto3);
  scoped3._op_layer = OP_SCOPED;
  scoped3.effect = effect;
  return scoped3;
};
var succeed4 = /* @__PURE__ */ dual(2, (a, b) => {
  const tagFirst = isTag2(a);
  const tag = tagFirst ? a : b;
  const resource = tagFirst ? b : a;
  return fromEffectContext(succeed(make5(tag, resource)));
});
var suspend3 = (evaluate2) => {
  const suspend5 = Object.create(proto3);
  suspend5._op_layer = OP_SUSPEND;
  suspend5.evaluate = evaluate2;
  return suspend5;
};
var sync3 = /* @__PURE__ */ dual(2, (a, b) => {
  const tagFirst = isTag2(a);
  const tag = tagFirst ? a : b;
  const evaluate2 = tagFirst ? b : a;
  return fromEffectContext(sync(() => make5(tag, evaluate2())));
});
var provide = /* @__PURE__ */ dual(2, (self, that) => suspend3(() => {
  const provideTo = Object.create(proto3);
  provideTo._op_layer = OP_PROVIDE;
  provideTo.first = Object.create(proto3, {
    _op_layer: {
      value: OP_PROVIDE_MERGE,
      enumerable: true
    },
    first: {
      value: context2(),
      enumerable: true
    },
    second: {
      value: Array.isArray(that) ? mergeAll4(...that) : that
    },
    zipK: {
      value: (a, b) => pipe(a, merge3(b))
    }
  });
  provideTo.second = self;
  return provideTo;
}));
var provideSomeLayer = /* @__PURE__ */ dual(2, (self, layer) => scopedWith((scope3) => flatMap7(buildWithScope(layer, scope3), (context4) => provideSomeContext(self, context4))));
var provideSomeRuntime = /* @__PURE__ */ dual(2, (self, rt) => {
  const patchRefs = diff6(defaultRuntime.fiberRefs, rt.fiberRefs);
  const patchFlags = diff4(defaultRuntime.runtimeFlags, rt.runtimeFlags);
  return uninterruptibleMask((restore) => withFiberRuntime((fiber) => {
    const oldContext = fiber.getFiberRef(currentContext);
    const oldRefs = fiber.getFiberRefs();
    const newRefs = patch7(fiber.id(), oldRefs)(patchRefs);
    const oldFlags = fiber.currentRuntimeFlags;
    const newFlags = patch4(patchFlags)(oldFlags);
    const rollbackRefs = diff6(newRefs, oldRefs);
    const rollbackFlags = diff4(newFlags, oldFlags);
    fiber.setFiberRefs(newRefs);
    fiber.currentRuntimeFlags = newFlags;
    return ensuring(provideSomeContext(restore(self), merge3(oldContext, rt.context)), withFiberRuntime((fiber2) => {
      fiber2.setFiberRefs(patch7(fiber2.id(), fiber2.getFiberRefs())(rollbackRefs));
      fiber2.currentRuntimeFlags = patch4(rollbackFlags)(fiber2.currentRuntimeFlags);
      return void_;
    }));
  }));
});
var effect_provide = /* @__PURE__ */ dual(2, (self, source) => {
  if (Array.isArray(source)) {
    return provideSomeLayer(self, mergeAll4(...source));
  } else if (isLayer(source)) {
    return provideSomeLayer(self, source);
  } else if (isContext2(source)) {
    return provideSomeContext(self, source);
  } else if (TypeId15 in source) {
    return flatMap7(source.runtimeEffect, (rt) => provideSomeRuntime(self, rt));
  } else {
    return provideSomeRuntime(self, source);
  }
});

// node_modules/effect/dist/esm/internal/console.js
var console2 = /* @__PURE__ */ map8(/* @__PURE__ */ fiberRefGet(currentServices), /* @__PURE__ */ get3(consoleTag));
var consoleWith = (f) => fiberRefGetWith(currentServices, (services) => f(get3(services, consoleTag)));
var withConsole = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(effect, currentServices, add2(consoleTag, value)));
var withConsoleScoped = (console4) => fiberRefLocallyScopedWith(currentServices, add2(consoleTag, console4));

// node_modules/effect/dist/esm/Random.js
var fixed2 = fixed;

// node_modules/effect/dist/esm/internal/schedule.js
var ScheduleSymbolKey = "effect/Schedule";
var ScheduleTypeId = /* @__PURE__ */ Symbol.for(ScheduleSymbolKey);
var isSchedule = (u) => hasProperty(u, ScheduleTypeId);
var ScheduleDriverSymbolKey = "effect/ScheduleDriver";
var ScheduleDriverTypeId = /* @__PURE__ */ Symbol.for(ScheduleDriverSymbolKey);
var defaultIterationMetadata = {
  start: 0,
  now: 0,
  input: void 0,
  output: void 0,
  elapsed: zero,
  elapsedSincePrevious: zero,
  recurrence: 0
};
var CurrentIterationMetadata = /* @__PURE__ */ Reference2()("effect/Schedule/CurrentIterationMetadata", {
  defaultValue: () => defaultIterationMetadata
});
var scheduleVariance = {
  /* c8 ignore next */
  _Out: (_) => _,
  /* c8 ignore next */
  _In: (_) => _,
  /* c8 ignore next */
  _R: (_) => _
};
var scheduleDriverVariance = {
  /* c8 ignore next */
  _Out: (_) => _,
  /* c8 ignore next */
  _In: (_) => _,
  /* c8 ignore next */
  _R: (_) => _
};
var ScheduleImpl = class {
  initial;
  step;
  [ScheduleTypeId] = scheduleVariance;
  constructor(initial, step4) {
    this.initial = initial;
    this.step = step4;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var updateInfo = (iterationMetaRef, now, input, output) => update2(iterationMetaRef, (prev) => prev.recurrence === 0 ? {
  now,
  input,
  output,
  recurrence: prev.recurrence + 1,
  elapsed: zero,
  elapsedSincePrevious: zero,
  start: now
} : {
  now,
  input,
  output,
  recurrence: prev.recurrence + 1,
  elapsed: millis(now - prev.start),
  elapsedSincePrevious: millis(now - prev.now),
  start: prev.start
});
var ScheduleDriverImpl = class {
  schedule;
  ref;
  [ScheduleDriverTypeId] = scheduleDriverVariance;
  constructor(schedule2, ref) {
    this.schedule = schedule2;
    this.ref = ref;
  }
  get state() {
    return map8(get11(this.ref), (tuple) => tuple[1]);
  }
  get last() {
    return flatMap7(get11(this.ref), ([element, _]) => {
      switch (element._tag) {
        case "None": {
          return failSync(() => new NoSuchElementException());
        }
        case "Some": {
          return succeed(element.value);
        }
      }
    });
  }
  iterationMeta = /* @__PURE__ */ unsafeMake5(defaultIterationMetadata);
  get reset() {
    return set5(this.ref, [none2(), this.schedule.initial]).pipe(zipLeft(set5(this.iterationMeta, defaultIterationMetadata)));
  }
  next(input) {
    return pipe(map8(get11(this.ref), (tuple) => tuple[1]), flatMap7((state) => pipe(currentTimeMillis2, flatMap7((now) => pipe(suspend(() => this.schedule.step(now, input, state)), flatMap7(([state2, out, decision]) => {
      const setState = set5(this.ref, [some2(out), state2]);
      if (isDone4(decision)) {
        return setState.pipe(zipRight(fail2(none2())));
      }
      const millis2 = start2(decision.intervals) - now;
      if (millis2 <= 0) {
        return setState.pipe(zipRight(updateInfo(this.iterationMeta, now, input, out)), as2(out));
      }
      const duration = millis(millis2);
      return pipe(setState, zipRight(updateInfo(this.iterationMeta, now, input, out)), zipRight(sleep3(duration)), as2(out));
    }))))));
  }
};
var makeWithState = (initial, step4) => new ScheduleImpl(initial, step4);
var asVoid3 = (self) => map12(self, constVoid);
var check = /* @__PURE__ */ dual(2, (self, test) => checkEffect(self, (input, out) => sync(() => test(input, out))));
var checkEffect = /* @__PURE__ */ dual(2, (self, test) => makeWithState(self.initial, (now, input, state) => flatMap7(self.step(now, input, state), ([state2, out, decision]) => {
  if (isDone4(decision)) {
    return succeed([state2, out, done6]);
  }
  return map8(test(input, out), (cont) => cont ? [state2, out, decision] : [state2, out, done6]);
})));
var driver = (self) => pipe(make26([none2(), self.initial]), map8((ref) => new ScheduleDriverImpl(self, ref)));
var intersect5 = /* @__PURE__ */ dual(2, (self, that) => intersectWith(self, that, intersect4));
var intersectWith = /* @__PURE__ */ dual(3, (self, that, f) => makeWithState([self.initial, that.initial], (now, input, state) => pipe(zipWith2(self.step(now, input, state[0]), that.step(now, input, state[1]), (a, b) => [a, b]), flatMap7(([[lState, out, lDecision], [rState, out2, rDecision]]) => {
  if (isContinue2(lDecision) && isContinue2(rDecision)) {
    return intersectWithLoop(self, that, input, lState, out, lDecision.intervals, rState, out2, rDecision.intervals, f);
  }
  return succeed([[lState, rState], [out, out2], done6]);
}))));
var intersectWithLoop = (self, that, input, lState, out, lInterval, rState, out2, rInterval, f) => {
  const combined = f(lInterval, rInterval);
  if (isNonEmpty4(combined)) {
    return succeed([[lState, rState], [out, out2], _continue2(combined)]);
  }
  if (pipe(lInterval, lessThan6(rInterval))) {
    return flatMap7(self.step(end2(lInterval), input, lState), ([lState2, out3, decision]) => {
      if (isDone4(decision)) {
        return succeed([[lState2, rState], [out3, out2], done6]);
      }
      return intersectWithLoop(self, that, input, lState2, out3, decision.intervals, rState, out2, rInterval, f);
    });
  }
  return flatMap7(that.step(end2(rInterval), input, rState), ([rState2, out22, decision]) => {
    if (isDone4(decision)) {
      return succeed([[lState, rState2], [out, out22], done6]);
    }
    return intersectWithLoop(self, that, input, lState, out, lInterval, rState2, out22, decision.intervals, f);
  });
};
var map12 = /* @__PURE__ */ dual(2, (self, f) => mapEffect(self, (out) => sync(() => f(out))));
var mapEffect = /* @__PURE__ */ dual(2, (self, f) => makeWithState(self.initial, (now, input, state) => flatMap7(self.step(now, input, state), ([state2, out, decision]) => map8(f(out), (out2) => [state2, out2, decision]))));
var passthrough = (self) => makeWithState(self.initial, (now, input, state) => pipe(self.step(now, input, state), map8(([state2, _, decision]) => [state2, input, decision])));
var recurs = (n) => whileOutput(forever2, (out) => out < n);
var unfold2 = (initial, f) => makeWithState(initial, (now, _, state) => sync(() => [f(state), state, continueWith2(after2(now))]));
var untilInputEffect = /* @__PURE__ */ dual(2, (self, f) => checkEffect(self, (input, _) => negate(f(input))));
var whileInputEffect = /* @__PURE__ */ dual(2, (self, f) => checkEffect(self, (input, _) => f(input)));
var whileOutput = /* @__PURE__ */ dual(2, (self, f) => check(self, (_, out) => f(out)));
var ScheduleDefectTypeId = /* @__PURE__ */ Symbol.for("effect/Schedule/ScheduleDefect");
var ScheduleDefect = class {
  error;
  [ScheduleDefectTypeId];
  constructor(error) {
    this.error = error;
    this[ScheduleDefectTypeId] = ScheduleDefectTypeId;
  }
};
var isScheduleDefect = (u) => hasProperty(u, ScheduleDefectTypeId);
var scheduleDefectWrap = (self) => catchAll(self, (e) => die2(new ScheduleDefect(e)));
var scheduleDefectRefailCause = (cause3) => match2(find(cause3, (_) => isDieType(_) && isScheduleDefect(_.defect) ? some2(_.defect) : none2()), {
  onNone: () => cause3,
  onSome: (error) => fail(error.error)
});
var scheduleDefectRefail = (effect) => catchAllCause(effect, (cause3) => failCause(scheduleDefectRefailCause(cause3)));
var repeat_Effect = /* @__PURE__ */ dual(2, (self, schedule2) => repeatOrElse_Effect(self, schedule2, (e, _) => fail2(e)));
var repeat_combined = /* @__PURE__ */ dual(2, (self, options) => {
  if (isSchedule(options)) {
    return repeat_Effect(self, options);
  }
  const base = options.schedule ?? passthrough(forever2);
  const withWhile = options.while ? whileInputEffect(base, (a) => {
    const applied = options.while(a);
    if (typeof applied === "boolean") {
      return succeed(applied);
    }
    return scheduleDefectWrap(applied);
  }) : base;
  const withUntil = options.until ? untilInputEffect(withWhile, (a) => {
    const applied = options.until(a);
    if (typeof applied === "boolean") {
      return succeed(applied);
    }
    return scheduleDefectWrap(applied);
  }) : withWhile;
  const withTimes = options.times ? intersect5(withUntil, recurs(options.times)).pipe(map12((intersectionPair) => intersectionPair[0])) : withUntil;
  return scheduleDefectRefail(repeat_Effect(self, withTimes));
});
var repeatOrElse_Effect = /* @__PURE__ */ dual(3, (self, schedule2, orElse3) => flatMap7(driver(schedule2), (driver2) => matchEffect(self, {
  onFailure: (error) => orElse3(error, none2()),
  onSuccess: (value) => repeatOrElseEffectLoop(provideServiceEffect(self, CurrentIterationMetadata, get11(driver2.iterationMeta)), driver2, (error, option3) => provideServiceEffect(orElse3(error, option3), CurrentIterationMetadata, get11(driver2.iterationMeta)), value)
})));
var repeatOrElseEffectLoop = (self, driver2, orElse3, value) => matchEffect(driver2.next(value), {
  onFailure: () => orDie(driver2.last),
  onSuccess: (b) => matchEffect(self, {
    onFailure: (error) => orElse3(error, some2(b)),
    onSuccess: (value2) => repeatOrElseEffectLoop(self, driver2, orElse3, value2)
  })
});
var retry_Effect = /* @__PURE__ */ dual(2, (self, policy) => retryOrElse_Effect(self, policy, (e, _) => fail2(e)));
var retry_combined = /* @__PURE__ */ dual(2, (self, options) => {
  if (isSchedule(options)) {
    return retry_Effect(self, options);
  }
  return scheduleDefectRefail(retry_Effect(self, fromRetryOptions(options)));
});
var fromRetryOptions = (options) => {
  const base = options.schedule ?? forever2;
  const withWhile = options.while ? whileInputEffect(base, (e) => {
    const applied = options.while(e);
    if (typeof applied === "boolean") {
      return succeed(applied);
    }
    return scheduleDefectWrap(applied);
  }) : base;
  const withUntil = options.until ? untilInputEffect(withWhile, (e) => {
    const applied = options.until(e);
    if (typeof applied === "boolean") {
      return succeed(applied);
    }
    return scheduleDefectWrap(applied);
  }) : withWhile;
  return options.times !== void 0 ? intersect5(withUntil, recurs(options.times)) : withUntil;
};
var retryOrElse_Effect = /* @__PURE__ */ dual(3, (self, policy, orElse3) => flatMap7(driver(policy), (driver2) => retryOrElse_EffectLoop(provideServiceEffect(self, CurrentIterationMetadata, get11(driver2.iterationMeta)), driver2, (e, out) => provideServiceEffect(orElse3(e, out), CurrentIterationMetadata, get11(driver2.iterationMeta)))));
var retryOrElse_EffectLoop = (self, driver2, orElse3) => {
  return catchAll(self, (e) => matchEffect(driver2.next(e), {
    onFailure: () => pipe(driver2.last, orDie, flatMap7((out) => orElse3(e, out))),
    onSuccess: () => retryOrElse_EffectLoop(self, driver2, orElse3)
  }));
};
var schedule_Effect = /* @__PURE__ */ dual(2, (self, schedule2) => scheduleFrom_Effect(self, void 0, schedule2));
var scheduleFrom_Effect = /* @__PURE__ */ dual(3, (self, initial, schedule2) => flatMap7(driver(schedule2), (driver2) => scheduleFrom_EffectLoop(provideServiceEffect(self, CurrentIterationMetadata, get11(driver2.iterationMeta)), initial, driver2)));
var scheduleFrom_EffectLoop = (self, initial, driver2) => matchEffect(driver2.next(initial), {
  onFailure: () => orDie(driver2.last),
  onSuccess: () => flatMap7(self, (a) => scheduleFrom_EffectLoop(self, a, driver2))
});
var forever2 = /* @__PURE__ */ unfold2(0, (n) => n + 1);
var once2 = /* @__PURE__ */ asVoid3(/* @__PURE__ */ recurs(1));
var scheduleForked = /* @__PURE__ */ dual(2, (self, schedule2) => forkScoped(schedule_Effect(self, schedule2)));

// node_modules/effect/dist/esm/internal/executionPlan.js
var withExecutionPlan = /* @__PURE__ */ dual(2, (effect, plan) => suspend(() => {
  let i = 0;
  let result;
  return flatMap7(whileLoop({
    while: () => i < plan.steps.length && (result === void 0 || isLeft2(result)),
    body: () => {
      const step4 = plan.steps[i];
      let nextEffect = effect_provide(effect, step4.provide);
      if (result) {
        let attempted = false;
        const wrapped = nextEffect;
        nextEffect = suspend(() => {
          if (attempted) return wrapped;
          attempted = true;
          return result;
        });
        nextEffect = scheduleDefectRefail(retry_Effect(nextEffect, scheduleFromStep(step4, false)));
      } else {
        const schedule2 = scheduleFromStep(step4, true);
        nextEffect = schedule2 ? scheduleDefectRefail(retry_Effect(nextEffect, schedule2)) : nextEffect;
      }
      return either2(nextEffect);
    },
    step: (either4) => {
      result = either4;
      i++;
    }
  }), () => result);
}));
var scheduleFromStep = (step4, first2) => {
  if (!first2) {
    return fromRetryOptions({
      schedule: step4.schedule ? step4.schedule : step4.attempts ? void 0 : once2,
      times: step4.attempts,
      while: step4.while
    });
  } else if (step4.attempts === 1 || !(step4.schedule || step4.attempts)) {
    return void 0;
  }
  return fromRetryOptions({
    schedule: step4.schedule,
    while: step4.while,
    times: step4.attempts ? step4.attempts - 1 : void 0
  });
};

// node_modules/effect/dist/esm/internal/query.js
var currentCache = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentCache"), () => fiberRefUnsafeMake(unsafeMakeWith(65536, () => map8(deferredMake(), (handle) => ({
  listeners: new Listeners(),
  handle
})), () => seconds(60))));
var currentCacheEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentCacheEnabled"), () => fiberRefUnsafeMake(false));
var fromRequest = (request2, dataSource) => flatMap7(isEffect(dataSource) ? dataSource : succeed(dataSource), (ds) => fiberIdWith((id) => {
  const proxy = new Proxy(request2, {});
  return fiberRefGetWith(currentCacheEnabled, (cacheEnabled) => {
    if (cacheEnabled) {
      const cached4 = fiberRefGetWith(currentCache, (cache) => flatMap7(cache.getEither(proxy), (orNew) => {
        switch (orNew._tag) {
          case "Left": {
            if (orNew.left.listeners.interrupted) {
              return flatMap7(cache.invalidateWhen(proxy, (entry) => entry.handle === orNew.left.handle), () => cached4);
            }
            orNew.left.listeners.increment();
            return uninterruptibleMask((restore) => flatMap7(exit(blocked(empty15, restore(deferredAwait(orNew.left.handle)))), (exit4) => {
              orNew.left.listeners.decrement();
              return exit4;
            }));
          }
          case "Right": {
            orNew.right.listeners.increment();
            return uninterruptibleMask((restore) => flatMap7(exit(blocked(single(ds, makeEntry({
              request: proxy,
              result: orNew.right.handle,
              listeners: orNew.right.listeners,
              ownerId: id,
              state: {
                completed: false
              }
            })), restore(deferredAwait(orNew.right.handle)))), () => {
              orNew.right.listeners.decrement();
              return deferredAwait(orNew.right.handle);
            }));
          }
        }
      }));
      return cached4;
    }
    const listeners = new Listeners();
    listeners.increment();
    return flatMap7(deferredMake(), (ref) => ensuring(blocked(single(ds, makeEntry({
      request: proxy,
      result: ref,
      listeners,
      ownerId: id,
      state: {
        completed: false
      }
    })), deferredAwait(ref)), sync(() => listeners.decrement())));
  });
}));
var cacheRequest = (request2, result) => {
  return fiberRefGetWith(currentCacheEnabled, (cacheEnabled) => {
    if (cacheEnabled) {
      return fiberRefGetWith(currentCache, (cache) => flatMap7(cache.getEither(request2), (orNew) => {
        switch (orNew._tag) {
          case "Left": {
            return void_;
          }
          case "Right": {
            return deferredComplete(orNew.right.handle, result);
          }
        }
      }));
    }
    return void_;
  });
};
var withRequestCaching = /* @__PURE__ */ dual(2, (self, strategy) => fiberRefLocally(self, currentCacheEnabled, strategy));
var withRequestCache = /* @__PURE__ */ dual(
  2,
  // @ts-expect-error
  (self, cache) => fiberRefLocally(self, currentCache, cache)
);

// node_modules/effect/dist/esm/Request.js
var isRequest2 = isRequest;

// node_modules/effect/dist/esm/Effect.js
var EffectTypeId3 = EffectTypeId2;
var isEffect2 = isEffect;
var cachedWithTTL = cached2;
var cachedInvalidateWithTTL2 = cachedInvalidateWithTTL;
var cached3 = memoize;
var cachedFunction2 = cachedFunction;
var once3 = once;
var all4 = all3;
var allWith2 = allWith;
var allSuccesses2 = allSuccesses;
var dropUntil2 = dropUntil;
var dropWhile2 = dropWhile;
var takeUntil2 = takeUntil;
var takeWhile2 = takeWhile;
var every5 = every4;
var exists3 = exists2;
var filter7 = filter5;
var filterMap4 = filterMap3;
var findFirst5 = findFirst3;
var forEach8 = forEach7;
var head4 = head3;
var mergeAll5 = mergeAll3;
var partition4 = partition3;
var reduce11 = reduce8;
var reduceWhile2 = reduceWhile;
var reduceRight3 = reduceRight2;
var reduceEffect2 = reduceEffect;
var replicate2 = replicate;
var replicateEffect2 = replicateEffect;
var validateAll2 = validateAll;
var validateFirst2 = validateFirst;
var async2 = async_;
var asyncEffect2 = asyncEffect;
var custom2 = custom;
var withFiberRuntime2 = withFiberRuntime;
var fail6 = fail2;
var failSync2 = failSync;
var failCause5 = failCause;
var failCauseSync2 = failCauseSync;
var die5 = die2;
var dieMessage2 = dieMessage;
var dieSync2 = dieSync;
var gen2 = gen;
var never2 = never;
var none9 = none6;
var promise2 = promise;
var succeed6 = succeed;
var succeedNone2 = succeedNone;
var succeedSome2 = succeedSome;
var suspend4 = suspend;
var sync4 = sync;
var _void = void_;
var yieldNow4 = yieldNow;
var _catch2 = _catch;
var catchAll2 = catchAll;
var catchAllCause2 = catchAllCause;
var catchAllDefect2 = catchAllDefect;
var catchIf2 = catchIf;
var catchSome2 = catchSome;
var catchSomeCause2 = catchSomeCause;
var catchSomeDefect2 = catchSomeDefect;
var catchTag2 = catchTag;
var catchTags2 = catchTags;
var cause2 = cause;
var eventually2 = eventually;
var ignore2 = ignore;
var ignoreLogged2 = ignoreLogged;
var parallelErrors2 = parallelErrors;
var sandbox2 = sandbox;
var retry = retry_combined;
var withExecutionPlan2 = withExecutionPlan;
var retryOrElse = retryOrElse_Effect;
var try_2 = try_;
var tryMap2 = tryMap;
var tryMapPromise2 = tryMapPromise;
var tryPromise2 = tryPromise;
var unsandbox2 = unsandbox;
var allowInterrupt2 = allowInterrupt;
var checkInterruptible2 = checkInterruptible;
var disconnect2 = disconnect;
var interrupt6 = interrupt2;
var interruptWith2 = interruptWith;
var interruptible4 = interruptible2;
var interruptibleMask2 = interruptibleMask;
var onInterrupt2 = onInterrupt;
var uninterruptible2 = uninterruptible;
var uninterruptibleMask3 = uninterruptibleMask;
var liftPredicate2 = liftPredicate;
var as6 = as2;
var asSome2 = asSome;
var asSomeError2 = asSomeError;
var asVoid4 = asVoid;
var flip2 = flip;
var flipWith2 = flipWith;
var map13 = map8;
var mapAccum3 = mapAccum2;
var mapBoth3 = mapBoth;
var mapError3 = mapError;
var mapErrorCause3 = mapErrorCause2;
var merge6 = merge5;
var negate2 = negate;
var acquireRelease2 = acquireRelease;
var acquireReleaseInterruptible2 = acquireReleaseInterruptible;
var acquireUseRelease2 = acquireUseRelease;
var addFinalizer2 = addFinalizer;
var ensuring2 = ensuring;
var onError2 = onError;
var onExit3 = onExit;
var parallelFinalizers2 = parallelFinalizers;
var sequentialFinalizers2 = sequentialFinalizers;
var finalizersMask2 = finalizersMask;
var scope2 = scope;
var scopeWith2 = scopeWith;
var scopedWith2 = scopedWith;
var scoped2 = scopedEffect;
var using2 = using;
var withEarlyRelease2 = withEarlyRelease;
var awaitAllChildren2 = awaitAllChildren;
var daemonChildren2 = daemonChildren;
var descriptor2 = descriptor;
var descriptorWith2 = descriptorWith;
var diffFiberRefs2 = diffFiberRefs;
var ensuringChild2 = ensuringChild;
var ensuringChildren2 = ensuringChildren;
var fiberId2 = fiberId;
var fiberIdWith2 = fiberIdWith;
var fork3 = fork;
var forkDaemon2 = forkDaemon;
var forkAll2 = forkAll;
var forkIn2 = forkIn;
var forkScoped2 = forkScoped;
var forkWithErrorHandler2 = forkWithErrorHandler;
var fromFiber2 = fromFiber;
var fromFiberEffect2 = fromFiberEffect;
var supervised2 = supervised;
var transplant2 = transplant;
var withConcurrency2 = withConcurrency;
var withScheduler2 = withScheduler;
var withSchedulingPriority2 = withSchedulingPriority;
var withMaxOpsBeforeYield2 = withMaxOpsBeforeYield;
var clock2 = clock;
var clockWith4 = clockWith3;
var withClockScoped2 = withClockScoped;
var withClock2 = withClock;
var console3 = console2;
var consoleWith2 = consoleWith;
var withConsoleScoped2 = withConsoleScoped;
var withConsole2 = withConsole;
var delay2 = delay;
var sleep4 = sleep3;
var timed2 = timed;
var timedWith2 = timedWith;
var timeout2 = timeout;
var timeoutOption2 = timeoutOption;
var timeoutFail2 = timeoutFail;
var timeoutFailCause2 = timeoutFailCause;
var timeoutTo2 = timeoutTo;
var configProviderWith2 = configProviderWith;
var withConfigProvider2 = withConfigProvider;
var withConfigProviderScoped2 = withConfigProviderScoped;
var context3 = context;
var contextWith2 = contextWith;
var contextWithEffect2 = contextWithEffect;
var mapInputContext2 = mapInputContext;
var provide2 = effect_provide;
var provideService2 = provideService;
var provideServiceEffect2 = provideServiceEffect;
var serviceFunction2 = serviceFunction;
var serviceFunctionEffect2 = serviceFunctionEffect;
var serviceFunctions2 = serviceFunctions;
var serviceConstants2 = serviceConstants;
var serviceMembers2 = serviceMembers;
var serviceOption2 = serviceOption;
var serviceOptional2 = serviceOptional;
var updateService2 = updateService;
var Do2 = Do;
var bind3 = bind2;
var bindAll2 = bindAll;
var bindTo3 = bindTo2;
var let_3 = let_2;
var option2 = option;
var either3 = either2;
var exit3 = exit;
var intoDeferred2 = intoDeferred;
var if_2 = if_;
var filterOrDie2 = filterOrDie;
var filterOrDieMessage2 = filterOrDieMessage;
var filterOrElse2 = filterOrElse;
var filterOrFail2 = filterOrFail;
var filterEffectOrElse2 = filterEffectOrElse;
var filterEffectOrFail2 = filterEffectOrFail;
var unless2 = unless;
var unlessEffect2 = unlessEffect;
var when2 = when;
var whenEffect2 = whenEffect;
var whenFiberRef2 = whenFiberRef;
var whenRef2 = whenRef;
var flatMap11 = flatMap7;
var andThen5 = andThen3;
var flatten7 = flatten4;
var race2 = race;
var raceAll2 = raceAll;
var raceFirst2 = raceFirst;
var raceWith2 = raceWith;
var summarized2 = summarized;
var tap2 = tap;
var tapBoth2 = tapBoth;
var tapDefect2 = tapDefect;
var tapError2 = tapError;
var tapErrorTag2 = tapErrorTag;
var tapErrorCause2 = tapErrorCause;
var forever3 = forever;
var iterate2 = iterate;
var loop2 = loop;
var repeat = repeat_combined;
var repeatN2 = repeatN;
var repeatOrElse = repeatOrElse_Effect;
var schedule = schedule_Effect;
var scheduleForked2 = scheduleForked;
var scheduleFrom = scheduleFrom_Effect;
var whileLoop3 = whileLoop;
var getFiberRefs = fiberRefs2;
var inheritFiberRefs2 = inheritFiberRefs;
var locally = fiberRefLocally;
var locallyWith = fiberRefLocallyWith;
var locallyScoped = fiberRefLocallyScoped;
var locallyScopedWith = fiberRefLocallyScopedWith;
var patchFiberRefs2 = patchFiberRefs;
var setFiberRefs2 = setFiberRefs;
var updateFiberRefs2 = updateFiberRefs;
var isFailure5 = isFailure3;
var isSuccess3 = isSuccess2;
var match11 = match7;
var matchCause3 = matchCause;
var matchCauseEffect3 = matchCauseEffect;
var matchEffect3 = matchEffect;
var log2 = log;
var logWithLevel2 = (level, ...message) => logWithLevel(level)(...message);
var logTrace2 = logTrace;
var logDebug2 = logDebug;
var logInfo2 = logInfo;
var logWarning2 = logWarning;
var logError2 = logError;
var logFatal2 = logFatal;
var withLogSpan2 = withLogSpan;
var annotateLogs2 = annotateLogs;
var annotateLogsScoped2 = annotateLogsScoped;
var logAnnotations2 = logAnnotations;
var withUnhandledErrorLogLevel2 = withUnhandledErrorLogLevel;
var whenLogLevel2 = whenLogLevel;
var orDie2 = orDie;
var orDieWith2 = orDieWith;
var orElse2 = orElse;
var orElseFail2 = orElseFail;
var orElseSucceed2 = orElseSucceed;
var firstSuccessOf2 = firstSuccessOf;
var random3 = random2;
var randomWith2 = randomWith;
var withRandom2 = withRandom;
var withRandomFixed = /* @__PURE__ */ dual(2, (effect, values3) => withRandom2(effect, fixed2(values3)));
var withRandomScoped2 = withRandomScoped;
var runtime3 = runtime2;
var getRuntimeFlags = runtimeFlags;
var patchRuntimeFlags = updateRuntimeFlags;
var withRuntimeFlagsPatch = withRuntimeFlags;
var withRuntimeFlagsPatchScoped = withRuntimeFlagsScoped;
var tagMetrics2 = tagMetrics;
var labelMetrics2 = labelMetrics;
var tagMetricsScoped2 = tagMetricsScoped;
var labelMetricsScoped2 = labelMetricsScoped;
var metricLabels2 = metricLabels;
var withMetric2 = withMetric;
var unsafeMakeSemaphore2 = unsafeMakeSemaphore;
var makeSemaphore2 = makeSemaphore;
var unsafeMakeLatch2 = unsafeMakeLatch;
var makeLatch2 = makeLatch;
var runFork2 = unsafeForkEffect;
var runCallback = unsafeRunEffect;
var runPromise = unsafeRunPromiseEffect;
var runPromiseExit = unsafeRunPromiseExitEffect;
var runSync = unsafeRunSyncEffect;
var runSyncExit = unsafeRunSyncExitEffect;
var validate2 = validate;
var validateWith2 = validateWith;
var zip5 = zipOptions;
var zipLeft3 = zipLeftOptions;
var zipRight3 = zipRightOptions;
var zipWith4 = zipWithOptions;
var ap = /* @__PURE__ */ dual(2, (self, that) => zipWith4(self, that, (f, a) => f(a)));
var blocked2 = blocked;
var runRequestBlock2 = runRequestBlock;
var step3 = step2;
var request = /* @__PURE__ */ dual((args2) => isRequest2(args2[0]), fromRequest);
var cacheRequestResult = cacheRequest;
var withRequestBatching2 = withRequestBatching;
var withRequestCaching2 = withRequestCaching;
var withRequestCache2 = withRequestCache;
var tracer2 = tracer;
var tracerWith4 = tracerWith;
var withTracer2 = withTracer;
var withTracerScoped2 = withTracerScoped;
var withTracerEnabled2 = withTracerEnabled;
var withTracerTiming2 = withTracerTiming;
var annotateSpans2 = annotateSpans;
var annotateCurrentSpan2 = annotateCurrentSpan;
var currentSpan2 = currentSpan;
var currentPropagatedSpan2 = currentPropagatedSpan;
var currentParentSpan2 = currentParentSpan;
var spanAnnotations2 = spanAnnotations;
var spanLinks2 = spanLinks;
var linkSpans2 = linkSpans;
var linkSpanCurrent2 = linkSpanCurrent;
var makeSpan2 = makeSpan;
var makeSpanScoped2 = makeSpanScoped;
var useSpan2 = useSpan;
var withSpan2 = withSpan;
var functionWithSpan2 = functionWithSpan;
var withSpanScoped2 = withSpanScoped;
var withParentSpan2 = withParentSpan;
var fromNullable3 = fromNullable2;
var optionFromOptional2 = optionFromOptional;
var transposeOption = (self) => {
  return isNone(self) ? succeedNone2 : map13(self.value, some);
};
var transposeMapOption = /* @__PURE__ */ dual(2, (self, f) => isNone(self) ? succeedNone2 : map13(f(self.value), some));
var makeTagProxy = (TagClass) => {
  const cache = /* @__PURE__ */ new Map();
  return new Proxy(TagClass, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      if (cache.has(prop)) {
        return cache.get(prop);
      }
      const fn2 = (...args2) => andThen3(target, (s) => {
        if (typeof s[prop] === "function") {
          cache.set(prop, (...args3) => andThen3(target, (s2) => s2[prop](...args3)));
          return s[prop](...args2);
        }
        cache.set(prop, andThen3(target, (s2) => s2[prop]));
        return s[prop];
      });
      const cn = andThen3(target, (s) => s[prop]);
      Object.assign(fn2, cn);
      const apply = fn2.apply;
      const bind4 = fn2.bind;
      const call = fn2.call;
      const proto4 = Object.setPrototypeOf({}, Object.getPrototypeOf(cn));
      proto4.apply = apply;
      proto4.bind = bind4;
      proto4.call = call;
      Object.setPrototypeOf(fn2, proto4);
      cache.set(prop, fn2);
      return fn2;
    }
  });
};
var Tag2 = (id) => () => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error();
  Error.stackTraceLimit = limit;
  function TagClass() {
  }
  Object.setPrototypeOf(TagClass, TagProto);
  TagClass.key = id;
  Object.defineProperty(TagClass, "use", {
    get() {
      return (body) => andThen3(this, body);
    }
  });
  Object.defineProperty(TagClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return makeTagProxy(TagClass);
};
var Service = function() {
  return function() {
    const [id, maker] = arguments;
    const proxy = "accessors" in maker ? maker["accessors"] : false;
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const creationError = new Error();
    Error.stackTraceLimit = limit;
    let patchState = "unchecked";
    const TagClass = function(service) {
      if (patchState === "unchecked") {
        const proto4 = Object.getPrototypeOf(service);
        if (proto4 === Object.prototype || proto4 === null) {
          patchState = "plain";
        } else {
          const selfProto = Object.getPrototypeOf(this);
          Object.setPrototypeOf(selfProto, proto4);
          patchState = "patched";
        }
      }
      if (patchState === "plain") {
        Object.assign(this, service);
      } else if (patchState === "patched") {
        Object.setPrototypeOf(service, Object.getPrototypeOf(this));
        return service;
      }
    };
    TagClass.prototype._tag = id;
    Object.defineProperty(TagClass, "make", {
      get() {
        return (service) => new this(service);
      }
    });
    Object.defineProperty(TagClass, "use", {
      get() {
        return (body) => andThen3(this, body);
      }
    });
    TagClass.key = id;
    Object.assign(TagClass, TagProto);
    Object.defineProperty(TagClass, "stack", {
      get() {
        return creationError.stack;
      }
    });
    const hasDeps = "dependencies" in maker && maker.dependencies.length > 0;
    const layerName = hasDeps ? "DefaultWithoutDependencies" : "Default";
    let layerCache;
    let isFunction3 = false;
    if ("effect" in maker) {
      isFunction3 = typeof maker.effect === "function";
      Object.defineProperty(TagClass, layerName, {
        get() {
          if (isFunction3) {
            return function() {
              return fromEffect2(TagClass, map13(maker.effect.apply(null, arguments), (_) => new this(_)));
            }.bind(this);
          }
          return layerCache ??= fromEffect2(TagClass, map13(maker.effect, (_) => new this(_)));
        }
      });
    } else if ("scoped" in maker) {
      isFunction3 = typeof maker.scoped === "function";
      Object.defineProperty(TagClass, layerName, {
        get() {
          if (isFunction3) {
            return function() {
              return scoped(TagClass, map13(maker.scoped.apply(null, arguments), (_) => new this(_)));
            }.bind(this);
          }
          return layerCache ??= scoped(TagClass, map13(maker.scoped, (_) => new this(_)));
        }
      });
    } else if ("sync" in maker) {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= sync3(TagClass, () => new this(maker.sync()));
        }
      });
    } else {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= succeed4(TagClass, new this(maker.succeed));
        }
      });
    }
    if (hasDeps) {
      let layerWithDepsCache;
      Object.defineProperty(TagClass, "Default", {
        get() {
          if (isFunction3) {
            return function() {
              return provide(this.DefaultWithoutDependencies.apply(null, arguments), maker.dependencies);
            };
          }
          return layerWithDepsCache ??= provide(this.DefaultWithoutDependencies, maker.dependencies);
        }
      });
    }
    return proxy === true ? makeTagProxy(TagClass) : TagClass;
  };
};
var fn = function(nameOrBody, ...pipeables) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const errorDef = new Error();
  Error.stackTraceLimit = limit;
  if (typeof nameOrBody !== "string") {
    return defineLength(nameOrBody.length, function(...args2) {
      const limit2 = Error.stackTraceLimit;
      Error.stackTraceLimit = 2;
      const errorCall = new Error();
      Error.stackTraceLimit = limit2;
      return fnApply({
        self: this,
        body: nameOrBody,
        args: args2,
        pipeables,
        spanName: "<anonymous>",
        spanOptions: {
          context: DisablePropagation.context(true)
        },
        errorDef,
        errorCall
      });
    });
  }
  const name = nameOrBody;
  const options = pipeables[0];
  return (body, ...pipeables2) => defineLength(body.length, {
    [name](...args2) {
      const limit2 = Error.stackTraceLimit;
      Error.stackTraceLimit = 2;
      const errorCall = new Error();
      Error.stackTraceLimit = limit2;
      return fnApply({
        self: this,
        body,
        args: args2,
        pipeables: pipeables2,
        spanName: name,
        spanOptions: options,
        errorDef,
        errorCall
      });
    }
  }[name]);
};
function defineLength(length2, fn2) {
  return Object.defineProperty(fn2, "length", {
    value: length2,
    configurable: true
  });
}
function fnApply(options) {
  let effect;
  let fnError = void 0;
  if (isGeneratorFunction(options.body)) {
    effect = fromIterator(() => options.body.apply(options.self, options.args));
  } else {
    try {
      effect = options.body.apply(options.self, options.args);
    } catch (error) {
      fnError = error;
      effect = die5(error);
    }
  }
  if (options.pipeables.length > 0) {
    try {
      for (const x of options.pipeables) {
        effect = x(effect, ...options.args);
      }
    } catch (error) {
      effect = fnError ? failCause5(sequential(die(fnError), die(error))) : die5(error);
    }
  }
  let cache = false;
  const captureStackTrace = () => {
    if (cache !== false) {
      return cache;
    }
    if (options.errorCall.stack) {
      const stackDef = options.errorDef.stack.trim().split("\n");
      const stackCall = options.errorCall.stack.trim().split("\n");
      let endStackDef = stackDef.slice(2).join("\n").trim();
      if (!endStackDef.includes(`(`)) {
        endStackDef = endStackDef.replace(/at (.*)/, "at ($1)");
      }
      let endStackCall = stackCall.slice(2).join("\n").trim();
      if (!endStackCall.includes(`(`)) {
        endStackCall = endStackCall.replace(/at (.*)/, "at ($1)");
      }
      cache = `${endStackDef}
${endStackCall}`;
      return cache;
    }
  };
  const opts = options.spanOptions && "captureStackTrace" in options.spanOptions ? options.spanOptions : {
    captureStackTrace,
    ...options.spanOptions
  };
  return withSpan2(effect, options.spanName, opts);
}
var fnUntraced2 = fnUntraced;
var ensureSuccessType = () => (effect) => effect;
var ensureErrorType = () => (effect) => effect;
var ensureRequirementsType = () => (effect) => effect;

// packages/core/src/failures.ts
var CORE_FAILURE_BRAND = Symbol("@foreman/core/CoreFailure");
function malformedUtf8() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "MalformedUtf8" };
}
function oversizeInput(maxBytes) {
  return { [CORE_FAILURE_BRAND]: true, _tag: "OversizeInput", maxBytes };
}
function duplicateJsonKey() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "DuplicateJsonKey" };
}
function invalidJson() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "InvalidJson" };
}
function isCoreFailure(v) {
  return typeof v === "object" && v !== null && v[CORE_FAILURE_BRAND] === true;
}

// packages/core/src/utf8.ts
var MAX_INPUT_BYTES = 1048576;
function decodeUtf8Fatal(bytes) {
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    return oversizeInput(MAX_INPUT_BYTES);
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return decoder.decode(bytes);
  } catch {
    return malformedUtf8();
  }
}

// packages/core/src/canonical-json.ts
var PARSE_FAIL = Symbol("@foreman/core/parseFail");
function parseFail(failure) {
  return { [PARSE_FAIL]: true, failure };
}
function isParseFail(v) {
  return typeof v === "object" && v !== null && v[PARSE_FAIL] === true;
}
function parseJsonRejectDuplicateKeys(text) {
  let i = 0;
  const s = text;
  let depth = 0;
  function skipWs() {
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        i += 1;
      } else {
        break;
      }
    }
  }
  function peek() {
    return i < s.length ? s[i] : "";
  }
  function fail7() {
    return parseFail(invalidJson());
  }
  function parseString() {
    if (peek() !== '"') return fail7();
    i += 1;
    let out = "";
    while (i < s.length) {
      const c = s[i];
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === "\\") {
        i += 1;
        if (i >= s.length) return fail7();
        const e = s[i];
        i += 1;
        switch (e) {
          case '"':
          case "\\":
          case "/":
            out += e;
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "	";
            break;
          case "u": {
            if (i + 4 > s.length) return fail7();
            const hex = s.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail7();
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            return fail7();
        }
      } else if (c.charCodeAt(0) < 32) {
        return fail7();
      } else {
        out += c;
        i += 1;
      }
    }
    return fail7();
  }
  function parseNumber() {
    const start3 = i;
    if (peek() === "-") i += 1;
    if (peek() < "0" || peek() > "9") return fail7();
    if (peek() === "0") {
      i += 1;
      if (peek() >= "0" && peek() <= "9") return fail7();
    } else {
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    if (peek() === ".") {
      i += 1;
      if (peek() < "0" || peek() > "9") return fail7();
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    if (peek() === "e" || peek() === "E") {
      i += 1;
      if (peek() === "+" || peek() === "-") i += 1;
      if (peek() < "0" || peek() > "9") return fail7();
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    const num = Number(s.slice(start3, i));
    if (!Number.isFinite(num)) return fail7();
    return num;
  }
  function parseValue() {
    skipWs();
    const c = peek();
    if (c === '"') return parseString();
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === "t") {
      if (s.slice(i, i + 4) !== "true") return fail7();
      i += 4;
      return true;
    }
    if (c === "f") {
      if (s.slice(i, i + 5) !== "false") return fail7();
      i += 5;
      return false;
    }
    if (c === "n") {
      if (s.slice(i, i + 4) !== "null") return fail7();
      i += 4;
      return null;
    }
    if (c === "-" || c >= "0" && c <= "9") return parseNumber();
    return fail7();
  }
  function parseObject() {
    if (depth >= 64) return fail7();
    depth += 1;
    if (peek() !== "{") return fail7();
    i += 1;
    skipWs();
    const obj = /* @__PURE__ */ Object.create(null);
    const seen = /* @__PURE__ */ new Set();
    if (peek() === "}") {
      i += 1;
      depth -= 1;
      return obj;
    }
    while (true) {
      skipWs();
      const key = parseString();
      if (isParseFail(key)) return key;
      if (seen.has(key)) return parseFail(duplicateJsonKey());
      seen.add(key);
      skipWs();
      if (peek() !== ":") return fail7();
      i += 1;
      const val = parseValue();
      if (isParseFail(val)) return val;
      Object.defineProperty(obj, key, {
        value: val,
        writable: true,
        enumerable: true,
        configurable: true
      });
      skipWs();
      if (peek() === ",") {
        i += 1;
        continue;
      }
      if (peek() === "}") {
        i += 1;
        depth -= 1;
        return obj;
      }
      return fail7();
    }
  }
  function parseArray() {
    if (depth >= 64) return fail7();
    depth += 1;
    if (peek() !== "[") return fail7();
    i += 1;
    skipWs();
    const arr = [];
    if (peek() === "]") {
      i += 1;
      depth -= 1;
      return arr;
    }
    while (true) {
      const val = parseValue();
      if (isParseFail(val)) return val;
      arr.push(val);
      skipWs();
      if (peek() === ",") {
        i += 1;
        continue;
      }
      if (peek() === "]") {
        i += 1;
        depth -= 1;
        return arr;
      }
      return fail7();
    }
  }
  const value = parseValue();
  if (isParseFail(value)) {
    return value.failure;
  }
  skipWs();
  if (i !== s.length) {
    return invalidJson();
  }
  return value;
}
function canonicalize(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non_finite_number");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value;
    const keys5 = Object.keys(obj).sort();
    const parts2 = [];
    for (const k of keys5) {
      parts2.push(JSON.stringify(k) + ":" + canonicalize(obj[k]));
    }
    return "{" + parts2.join(",") + "}";
  }
  throw new Error("unsupported_json_value");
}

// packages/session-store/src/entities.ts
var SESSION_MODEL_VERSION = 1;
var ENTITY_KINDS = [
  "session",
  "fact",
  "measurement",
  "obligation"
];
var COUNTED_KINDS = ["fact", "measurement", "obligation"];
function isCountedKind(kind) {
  return kind !== "session";
}
var OBLIGATION_STATUSES = ["open", "done", "dropped"];
var SUPERSESSION_FIELDS = [
  { name: "superseded_by", type: "integer", nullable: true },
  { name: "superseded_at", type: "timestamp", nullable: true },
  { name: "supersede_reason", type: "string", nullable: true }
];
var SESSION_SPEC = {
  kind: "session",
  identity: ["session_id"],
  ordering: ["session_id"],
  supersedable: false,
  fields: [
    { name: "session_id", type: "string", nullable: false },
    { name: "started_ts", type: "timestamp", nullable: false },
    { name: "start_sha", type: "string", nullable: true },
    { name: "ended_ts", type: "timestamp", nullable: true },
    { name: "note", type: "string", nullable: true }
  ]
};
var FACT_SPEC = {
  kind: "fact",
  identity: ["id"],
  ordering: ["id"],
  supersedable: true,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "statement", type: "string", nullable: false },
    { name: "evidence", type: "string", nullable: true },
    { name: "established_ts", type: "timestamp", nullable: false },
    { name: "session_id", type: "string", nullable: true },
    ...SUPERSESSION_FIELDS
  ]
};
var MEASUREMENT_SPEC = {
  kind: "measurement",
  identity: ["id"],
  ordering: ["id"],
  supersedable: true,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "metric", type: "string", nullable: false },
    { name: "value", type: "string", nullable: false },
    { name: "value_num", type: "real", nullable: true },
    { name: "command", type: "string", nullable: true },
    { name: "measured_ts", type: "timestamp", nullable: false },
    { name: "measured_sha", type: "string", nullable: true },
    { name: "scope_paths", type: "string", nullable: true },
    { name: "session_id", type: "string", nullable: true },
    ...SUPERSESSION_FIELDS
  ]
};
var OBLIGATION_SPEC = {
  kind: "obligation",
  identity: ["id"],
  ordering: ["id"],
  supersedable: false,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "statement", type: "string", nullable: false },
    {
      name: "status",
      type: "enum",
      nullable: false,
      enumValues: OBLIGATION_STATUSES
    },
    { name: "blocker", type: "string", nullable: true },
    { name: "opened_ts", type: "timestamp", nullable: false },
    { name: "closed_ts", type: "timestamp", nullable: true },
    { name: "session_id", type: "string", nullable: true }
  ]
};
var ENTITY_SPECS = {
  session: SESSION_SPEC,
  fact: FACT_SPEC,
  measurement: MEASUREMENT_SPEC,
  obligation: OBLIGATION_SPEC
};
var ENTITY_ORDER = ENTITY_KINDS;
function specFor(kind) {
  return ENTITY_SPECS[kind];
}
function initialNextIds() {
  return { fact: 1, measurement: 1, obligation: 1 };
}
function emptySnapshot() {
  return {
    modelVersion: SESSION_MODEL_VERSION,
    nextIds: initialNextIds(),
    sessions: [],
    facts: [],
    measurements: [],
    obligations: []
  };
}
function rowsOfKind(snapshot, kind) {
  const pick2 = kind === "session" ? snapshot.sessions : kind === "fact" ? snapshot.facts : kind === "measurement" ? snapshot.measurements : snapshot.obligations;
  return pick2;
}
function countRows(snapshot) {
  let total = 0;
  for (const kind of ENTITY_ORDER) total += rowsOfKind(snapshot, kind).length;
  return total;
}
function snapshotsEqual(a, b) {
  if (a.modelVersion !== b.modelVersion) return false;
  for (const kind of COUNTED_KINDS) {
    if (a.nextIds[kind] !== b.nextIds[kind]) return false;
  }
  for (const kind of ENTITY_ORDER) {
    const ra = rowsOfKind(a, kind);
    const rb = rowsOfKind(b, kind);
    if (ra.length !== rb.length) return false;
    const fields = specFor(kind).fields;
    for (let i = 0; i < ra.length; i++) {
      const x = ra[i];
      const y = rb[i];
      for (const f of fields) {
        if (!Object.is(normaliseValue(x[f.name]), normaliseValue(y[f.name]))) {
          return false;
        }
      }
    }
  }
  return true;
}
function normaliseValue(v) {
  return typeof v === "number" && Object.is(v, -0) ? 0 : v;
}

// packages/session-store/src/failures.ts
var SESSION_STORE_FAILURE_BRAND = Symbol(
  "@foreman/session-store/SessionStoreFailure"
);
function sessionStoreFailure(reason, message, extra) {
  return {
    [SESSION_STORE_FAILURE_BRAND]: true,
    _tag: "SessionStoreFailure",
    reason,
    message,
    ...extra?.kind !== void 0 ? { kind: extra.kind } : {},
    ...extra?.field !== void 0 ? { field: extra.field } : {},
    ...extra?.detail !== void 0 ? { detail: extra.detail } : {}
  };
}
function isSessionStoreFailure(v) {
  return typeof v === "object" && v !== null && v[SESSION_STORE_FAILURE_BRAND] === true;
}
var SessionStoreError = class extends Error {
  failure;
  constructor(failure) {
    super(failure.message);
    this.name = "SessionStoreError";
    this.failure = failure;
  }
};
function raise(reason, message, extra) {
  throw new SessionStoreError(sessionStoreFailure(reason, message, extra));
}
function reasonOf(e) {
  if (e instanceof SessionStoreError) return e.failure.reason;
  if (isSessionStoreFailure(e)) return e.reason;
  return null;
}

// packages/session-store/src/integrity.ts
function typeOk(spec, v) {
  switch (spec.type) {
    case "string":
    case "timestamp":
      return typeof v === "string";
    case "enum":
      return typeof v === "string" && (spec.enumValues ?? []).includes(v);
    case "integer":
      return typeof v === "number" && Number.isSafeInteger(v);
    case "real":
      return typeof v === "number" && Number.isFinite(v);
  }
}
function describe(v) {
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}
function at(kind, row) {
  const parts2 = specFor(kind).identity.map((f) => `${f}=${describe(row[f])}`);
  return parts2.length === 0 ? "" : ` (${parts2.join(", ")})`;
}
function findViolations(snapshot) {
  const out = [];
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    const declared = new Set(spec.fields.map((f) => f.name));
    const rows = rowsOfKind(snapshot, kind);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!declared.has(key)) {
          out.push({
            kind,
            field: key,
            detail: `field is not in the model${at(kind, row)}`
          });
        }
      }
      for (const f of spec.fields) {
        if (!(f.name in row)) {
          out.push({
            kind,
            field: f.name,
            detail: `field absent; the model requires an explicit null${at(kind, row)}`
          });
          continue;
        }
        const v = row[f.name];
        if (v === null) {
          if (!f.nullable) {
            out.push({
              kind,
              field: f.name,
              detail: `null in a non-null field${at(kind, row)}`
            });
          }
          continue;
        }
        if (v === void 0) {
          out.push({
            kind,
            field: f.name,
            detail: `undefined is not a value; use null${at(kind, row)}`
          });
          continue;
        }
        if (!typeOk(f, v)) {
          out.push({
            kind,
            field: f.name,
            detail: `expected ${f.type}, got ${describe(v)}${at(kind, row)}`
          });
        }
      }
    }
  }
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    const rows = rowsOfKind(snapshot, kind);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      for (const key of spec.ordering) {
        const a = prev[key];
        const b = cur[key];
        if (typeof a === "number" && typeof b === "number") {
          if (b < a) {
            out.push({ kind, field: key, detail: "rows are not in declared order" });
          }
          break;
        }
        if (typeof a === "string" && typeof b === "string") {
          if (b < a) {
            out.push({ kind, field: key, detail: "rows are not in declared order" });
          }
          break;
        }
      }
    }
  }
  const idsByKind = /* @__PURE__ */ new Map();
  for (const kind of COUNTED_KINDS) {
    const seen = /* @__PURE__ */ new Set();
    const next = snapshot.nextIds[kind];
    if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 1) {
      out.push({
        kind,
        field: null,
        detail: `nextIds.${kind} must be a positive safe integer`
      });
    }
    for (const row of rowsOfKind(snapshot, kind)) {
      const id = row["id"];
      if (typeof id !== "number" || !Number.isSafeInteger(id)) continue;
      if (id < 1) {
        out.push({ kind, field: "id", detail: `id ${id} is not positive` });
      }
      if (seen.has(id)) {
        out.push({ kind, field: "id", detail: `duplicate id ${id}` });
      }
      seen.add(id);
      if (typeof next === "number" && Number.isSafeInteger(next) && next >= 1 && id >= next) {
        out.push({
          kind,
          field: "id",
          detail: `id ${id} is at or above nextIds.${kind} (${next})`
        });
      }
    }
    idsByKind.set(kind, seen);
  }
  const sessionIds = /* @__PURE__ */ new Set();
  for (const row of rowsOfKind(snapshot, "session")) {
    const sid = row["session_id"];
    if (typeof sid !== "string") continue;
    if (sessionIds.has(sid)) {
      out.push({
        kind: "session",
        field: "session_id",
        detail: `duplicate session_id ${JSON.stringify(sid)}`
      });
    }
    sessionIds.add(sid);
  }
  for (const kind of COUNTED_KINDS) {
    for (const row of rowsOfKind(snapshot, kind)) {
      const sid = row["session_id"];
      if (sid === null || sid === void 0) continue;
      if (typeof sid === "string" && !sessionIds.has(sid)) {
        out.push({
          kind,
          field: "session_id",
          detail: `references unknown session ${JSON.stringify(sid)}`
        });
      }
    }
  }
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    if (!spec.supersedable || !isCountedKind(kind)) continue;
    const ids3 = idsByKind.get(kind) ?? /* @__PURE__ */ new Set();
    const rows = rowsOfKind(snapshot, kind);
    const successorOf = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const id = row["id"];
      const by = row["superseded_by"];
      const at2 = row["superseded_at"];
      const reason = row["supersede_reason"];
      if (by === null !== (at2 === null)) {
        out.push({
          kind,
          field: "superseded_by",
          detail: "superseded_by and superseded_at must both be set or both be null"
        });
      }
      if (by === null && reason !== null) {
        out.push({
          kind,
          field: "supersede_reason",
          detail: "reason present on a row that is not superseded"
        });
      }
      if (by === null || typeof by !== "number") continue;
      if (typeof id === "number" && by === id) {
        out.push({ kind, field: "superseded_by", detail: `row ${id} supersedes itself` });
        continue;
      }
      if (!ids3.has(by)) {
        out.push({
          kind,
          field: "superseded_by",
          detail: `dangling superseded_by ${by}`
        });
        continue;
      }
      if (typeof id === "number") successorOf.set(id, by);
    }
    for (const start3 of successorOf.keys()) {
      let cur = start3;
      const path = /* @__PURE__ */ new Set();
      let steps = 0;
      while (cur !== void 0 && steps++ <= successorOf.size) {
        if (path.has(cur)) {
          out.push({
            kind,
            field: "superseded_by",
            detail: `supersession cycle through row ${cur}`
          });
          break;
        }
        path.add(cur);
        cur = successorOf.get(cur);
      }
    }
  }
  for (const row of rowsOfKind(snapshot, "obligation")) {
    const status = row["status"];
    const closed = row["closed_ts"];
    if (status === "open" && closed !== null) {
      out.push({
        kind: "obligation",
        field: "closed_ts",
        detail: "an open obligation must not have closed_ts"
      });
    }
    if ((status === "done" || status === "dropped") && closed === null) {
      out.push({
        kind: "obligation",
        field: "closed_ts",
        detail: `a ${status} obligation requires closed_ts`
      });
    }
  }
  return out;
}
function formatViolations(vs) {
  return vs.map((v) => `  ${v.kind}${v.field ? `.${v.field}` : ""}: ${v.detail}`).join("\n");
}
function assertIntegrity(snapshot) {
  const vs = findViolations(snapshot);
  if (vs.length === 0) return;
  raise(
    "supersession_dangling",
    `snapshot violates ${vs.length} integrity rule(s):
${formatViolations(vs)}`,
    { detail: formatViolations(vs) }
  );
}

// packages/session-store/src/port.ts
var PROJECTABLE_FIELDS = {
  fact: ["statement"],
  measurement: ["metric", "value"],
  obligation: ["statement", "status"]
};

// packages/session-store/src/projection.ts
var PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isProjectIdV1(value) {
  return typeof value === "string" && PROJECT_ID.test(value);
}
function projectionKey(kind, id, projectId = null) {
  if (projectId !== null && !isProjectIdV1(projectId)) {
    throw new Error("invalid project id");
  }
  return projectId === null ? `${kind}:${id}` : `${projectId}:${kind}:${id}`;
}
function projectableText(kind, row) {
  const allowed = PROJECTABLE_FIELDS[kind];
  return allowed.map((f) => row[f]).filter((v) => typeof v === "string").join(" \u2014 ");
}
function upsertRecord(kind, id, row, projectId = null, projectionVersion = 1) {
  if (!Number.isSafeInteger(projectionVersion) || projectionVersion < 1) {
    throw new Error("invalid projection version");
  }
  const base = {
    key: projectionKey(kind, id, projectId),
    kind,
    id,
    projection_version: projectionVersion,
    mutation: "upsert",
    text: projectableText(kind, row)
  };
  return projectId === null ? base : { project_id: projectId, ...base };
}
function retractRecord(kind, id, projectId = null, projectionVersion = 1) {
  if (!Number.isSafeInteger(projectionVersion) || projectionVersion < 1) {
    throw new Error("invalid projection version");
  }
  const base = {
    key: projectionKey(kind, id, projectId),
    kind,
    id,
    projection_version: projectionVersion,
    mutation: "retract"
  };
  return projectId === null ? base : { project_id: projectId, ...base };
}
function isLiveCountedRow(row) {
  return row["superseded_by"] == null;
}
function buildProjection(snapshot, projectId = null) {
  const out = [];
  for (const kind of COUNTED_KINDS) {
    for (const row of rowsOfKind(snapshot, kind)) {
      const id = row["id"];
      if (typeof id !== "number") continue;
      if (!isLiveCountedRow(row)) continue;
      out.push(upsertRecord(kind, id, row, projectId));
    }
  }
  return out;
}
function liveProjectionMap(snapshot, projectId = null) {
  const map14 = /* @__PURE__ */ new Map();
  for (const rec of buildProjection(snapshot, projectId)) {
    if (rec.mutation === "upsert") map14.set(rec.key, rec);
  }
  return map14;
}

// packages/session-store/src/import-remap.ts
function resolveIdCollisionPolicy(raw) {
  if (raw === void 0 || raw === "refuse") return "refuse";
  if (raw === "remap") return "remap";
  raise(
    "invalid_argument",
    `unknown onIdCollision policy: ${String(raw)}`
  );
}
function snapshotIsOccupied(snapshot) {
  return countRows(snapshot) > 0;
}
function hasOpenSession(snapshot) {
  return snapshot.sessions.some((s) => s.ended_ts === null);
}
function sortSessions(rows) {
  return [...rows].sort(
    (a, b) => a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0
  );
}
function sortById(rows) {
  return [...rows].sort((a, b) => a.id - b.id);
}
function allocateSessionId(original, reserved) {
  if (!reserved.has(original)) return original;
  let n = 1;
  for (; ; ) {
    const candidate = `${original}~import-${n}`;
    if (!reserved.has(candidate)) return candidate;
    n += 1;
    if (n >= Number.MAX_SAFE_INTEGER) {
      raise(
        "invalid_argument",
        `cannot allocate import session id for ${JSON.stringify(original)}`
      );
    }
  }
}
function buildSessionMap(target, donor) {
  const targetIds = new Set(target.sessions.map((s) => s.session_id));
  const donorOriginals = donor.sessions.map((s) => s.session_id);
  const reserved = /* @__PURE__ */ new Set([...targetIds, ...donorOriginals]);
  const sessionMap = /* @__PURE__ */ new Map();
  const insertSessions = [];
  for (const row of sortSessions(donor.sessions)) {
    const mapped = targetIds.has(row.session_id) ? allocateSessionId(row.session_id, reserved) : row.session_id;
    if (mapped !== row.session_id) reserved.add(mapped);
    sessionMap.set(row.session_id, mapped);
    insertSessions.push(
      mapped === row.session_id ? { ...row } : { ...row, session_id: mapped }
    );
  }
  return { sessionMap, insertSessions };
}
function allocateCountedIds(kind, targetNext, donorRows) {
  const ordered = sortById(donorRows);
  const count = ordered.length;
  if (count === 0) return /* @__PURE__ */ new Map();
  if (typeof targetNext !== "number" || !Number.isSafeInteger(targetNext) || targetNext < 1) {
    raise(
      "invalid_argument",
      `target nextIds.${kind} must be a positive safe integer`
    );
  }
  const nextAfter = targetNext + count;
  if (!Number.isSafeInteger(nextAfter) || nextAfter < 1) {
    raise(
      "invalid_argument",
      `import remap would overflow nextIds.${kind}`
    );
  }
  const map14 = /* @__PURE__ */ new Map();
  let next = targetNext;
  for (const row of ordered) {
    map14.set(row.id, next);
    next += 1;
  }
  return map14;
}
function mapSessionId(sessionId, sessionMap) {
  if (sessionId === null) return null;
  const mapped = sessionMap.get(sessionId);
  if (mapped === void 0) {
    raise(
      "invalid_argument",
      `donor session_id ${JSON.stringify(sessionId)} missing from session map`
    );
  }
  return mapped;
}
function remapFacts(rows, idMap, sessionMap) {
  return sortById(rows).map((row) => {
    const id = idMap.get(row.id);
    if (id === void 0) {
      raise("invalid_argument", `fact ${row.id} missing from id map`);
    }
    let superseded_by = row.superseded_by;
    if (superseded_by !== null) {
      const mapped = idMap.get(superseded_by);
      if (mapped === void 0) {
        raise(
          "invalid_argument",
          `fact superseded_by ${superseded_by} missing from id map`
        );
      }
      superseded_by = mapped;
    }
    return {
      ...row,
      id,
      session_id: mapSessionId(row.session_id, sessionMap),
      superseded_by
    };
  });
}
function remapMeasurements(rows, idMap, sessionMap) {
  return sortById(rows).map((row) => {
    const id = idMap.get(row.id);
    if (id === void 0) {
      raise("invalid_argument", `measurement ${row.id} missing from id map`);
    }
    let superseded_by = row.superseded_by;
    if (superseded_by !== null) {
      const mapped = idMap.get(superseded_by);
      if (mapped === void 0) {
        raise(
          "invalid_argument",
          `measurement superseded_by ${superseded_by} missing from id map`
        );
      }
      superseded_by = mapped;
    }
    return {
      ...row,
      id,
      session_id: mapSessionId(row.session_id, sessionMap),
      superseded_by
    };
  });
}
function remapObligations(rows, idMap, sessionMap) {
  return sortById(rows).map((row) => {
    const id = idMap.get(row.id);
    if (id === void 0) {
      raise("invalid_argument", `obligation ${row.id} missing from id map`);
    }
    return {
      ...row,
      id,
      session_id: mapSessionId(row.session_id, sessionMap)
    };
  });
}
function planAdditiveRemapImport(target, donor) {
  if (target.modelVersion !== SESSION_MODEL_VERSION) {
    raise(
      "model_version_unsupported",
      `target model version ${target.modelVersion} != ${SESSION_MODEL_VERSION}`
    );
  }
  if (donor.modelVersion !== SESSION_MODEL_VERSION) {
    raise(
      "model_version_unsupported",
      `donor model version ${donor.modelVersion} != ${SESSION_MODEL_VERSION}`
    );
  }
  assertIntegrity(target);
  assertIntegrity(donor);
  if (!snapshotIsOccupied(target)) {
    raise(
      "invalid_argument",
      "planAdditiveRemapImport requires a non-empty target; empty targets use exact import"
    );
  }
  if (hasOpenSession(target) && hasOpenSession(donor)) {
    raise(
      "invalid_argument",
      "force+remap refuses when both target and donor contain an open session"
    );
  }
  const written = countRows(donor);
  if (written === 0) {
    return {
      merged: target,
      insert: {
        sessions: [],
        facts: [],
        measurements: [],
        obligations: []
      },
      idMaps: {
        fact: /* @__PURE__ */ new Map(),
        measurement: /* @__PURE__ */ new Map(),
        obligation: /* @__PURE__ */ new Map()
      },
      sessionMap: /* @__PURE__ */ new Map(),
      written: 0
    };
  }
  const { sessionMap, insertSessions } = buildSessionMap(target, donor);
  const factMap = allocateCountedIds("fact", target.nextIds.fact, donor.facts);
  const measurementMap = allocateCountedIds(
    "measurement",
    target.nextIds.measurement,
    donor.measurements
  );
  const obligationMap = allocateCountedIds(
    "obligation",
    target.nextIds.obligation,
    donor.obligations
  );
  const insertFacts = remapFacts(donor.facts, factMap, sessionMap);
  const insertMeasurements = remapMeasurements(
    donor.measurements,
    measurementMap,
    sessionMap
  );
  const insertObligations = remapObligations(
    donor.obligations,
    obligationMap,
    sessionMap
  );
  const nextIds = {
    fact: target.nextIds.fact + donor.facts.length,
    measurement: target.nextIds.measurement + donor.measurements.length,
    obligation: target.nextIds.obligation + donor.obligations.length
  };
  const merged = {
    modelVersion: SESSION_MODEL_VERSION,
    nextIds,
    sessions: sortSessions([...target.sessions, ...insertSessions]),
    facts: sortById([...target.facts, ...insertFacts]),
    measurements: sortById([...target.measurements, ...insertMeasurements]),
    obligations: sortById([...target.obligations, ...insertObligations])
  };
  assertIntegrity(merged);
  return {
    merged,
    insert: {
      sessions: insertSessions,
      facts: insertFacts,
      measurements: insertMeasurements,
      obligations: insertObligations
    },
    idMaps: {
      fact: factMap,
      measurement: measurementMap,
      obligation: obligationMap
    },
    sessionMap,
    written
  };
}
function additiveImportProjectionUpserts(target, merged, projectId = null) {
  const oldLive = liveProjectionMap(target, projectId);
  const newLive = liveProjectionMap(merged, projectId);
  const out = [];
  for (const [key, rec] of newLive) {
    if (!oldLive.has(key)) out.push(rec);
  }
  out.sort((a, b) => {
    const ka = COUNTED_KINDS.indexOf(a.kind);
    const kb = COUNTED_KINDS.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return a.id - b.id;
  });
  return out;
}

// packages/session-store/src/outbox.ts
function outboxDrainFailure(reason, message, progress) {
  return {
    _tag: "OutboxDrainFailure",
    reason,
    message,
    projected: progress.projected,
    attempts: progress.attempts,
    batches: progress.batches
  };
}
function isPositiveSafeIntInRange(value, min4, max6) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min4 && value <= max6;
}
function validateOptions(opts) {
  const zero2 = { projected: 0, attempts: 0, batches: 0 };
  if (!isPositiveSafeIntInRange(opts.batch, 1, 1e3)) {
    return Effect_exports.fail(
      outboxDrainFailure(
        "invalid_options",
        `batch must be an integer in 1..1000, got ${String(opts.batch)}`,
        zero2
      )
    );
  }
  if (!isPositiveSafeIntInRange(opts.maxAttempts, 1, 10)) {
    return Effect_exports.fail(
      outboxDrainFailure(
        "invalid_options",
        `maxAttempts must be an integer in 1..10, got ${String(opts.maxAttempts)}`,
        zero2
      )
    );
  }
  if (!isPositiveSafeIntInRange(opts.timeoutMs, 1, 3e5)) {
    return Effect_exports.fail(
      outboxDrainFailure(
        "invalid_options",
        `timeoutMs must be an integer in 1..300000, got ${String(opts.timeoutMs)}`,
        zero2
      )
    );
  }
  if (!isPositiveSafeIntInRange(opts.maxBatches, 1, 1e4)) {
    return Effect_exports.fail(
      outboxDrainFailure(
        "invalid_options",
        `maxBatches must be an integer in 1..10000, got ${String(opts.maxBatches)}`,
        zero2
      )
    );
  }
  return Effect_exports.succeed(opts);
}
function defensiveRecords(entries2) {
  return entries2.map((e) => {
    const project = e.record.project_id === void 0 ? {} : { project_id: e.record.project_id };
    if (e.record.mutation === "upsert") {
      return {
        ...project,
        key: e.record.key,
        kind: e.record.kind,
        id: e.record.id,
        projection_version: e.record.projection_version,
        mutation: "upsert",
        text: e.record.text
      };
    }
    return {
      ...project,
      key: e.record.key,
      kind: e.record.kind,
      id: e.record.id,
      projection_version: e.record.projection_version,
      mutation: "retract"
    };
  });
}
function projectOnce(index, records, timeoutMs) {
  return Effect_exports.tryPromise({
    try: () => index.project(records),
    catch: (e) => ({
      kind: "reject",
      detail: e instanceof Error ? e.message : String(e)
    })
  }).pipe(
    Effect_exports.timeout(Duration_exports.millis(timeoutMs)),
    Effect_exports.mapError((e) => {
      if (typeof e === "object" && e !== null && "_tag" in e && e._tag === "TimeoutException") {
        return { kind: "timeout", detail: "projection timed out" };
      }
      if (typeof e === "object" && e !== null && "kind" in e && (e.kind === "timeout" || e.kind === "reject")) {
        return e;
      }
      return {
        kind: "reject",
        detail: e instanceof Error ? e.message : String(e)
      };
    })
  );
}
function drainOutbox(store, index, opts) {
  return Effect_exports.gen(function* () {
    const validated = yield* validateOptions(opts);
    let projected = 0;
    let attempts = 0;
    let batches = 0;
    for (let batchNo = 0; batchNo < validated.maxBatches; batchNo++) {
      let entries2;
      try {
        entries2 = store.listOutbox(validated.batch);
      } catch (e) {
        return yield* Effect_exports.fail(
          outboxDrainFailure(
            "list_failed",
            e instanceof Error ? e.message : String(e),
            { projected, attempts, batches }
          )
        );
      }
      if (entries2.length === 0) {
        return { projected, attempts, batches };
      }
      const receipts = entries2.map((e) => e.receipt);
      const records = defensiveRecords(entries2);
      let applied = false;
      let lastDetail = "projection failed";
      for (let attempt = 0; attempt < validated.maxAttempts; attempt++) {
        attempts += 1;
        const outcome = yield* Effect_exports.either(
          projectOnce(index, records, validated.timeoutMs)
        );
        if (outcome._tag === "Right") {
          applied = true;
          break;
        }
        lastDetail = outcome.left.detail;
        if (attempt + 1 >= validated.maxAttempts) {
          return yield* Effect_exports.fail(
            outboxDrainFailure(
              outcome.left.kind === "timeout" ? "timeout" : "attempts_exhausted",
              lastDetail,
              { projected, attempts, batches }
            )
          );
        }
      }
      if (!applied) {
        return yield* Effect_exports.fail(
          outboxDrainFailure("attempts_exhausted", lastDetail, {
            projected,
            attempts,
            batches
          })
        );
      }
      let acked;
      try {
        acked = store.ackOutbox(receipts);
      } catch (e) {
        return yield* Effect_exports.fail(
          outboxDrainFailure(
            "ack_failed",
            e instanceof Error ? e.message : String(e),
            { projected, attempts, batches }
          )
        );
      }
      projected += acked;
      batches += 1;
      if (batches >= validated.maxBatches) {
        let remaining;
        try {
          remaining = store.listOutbox(1);
        } catch (e) {
          return yield* Effect_exports.fail(
            outboxDrainFailure(
              "list_failed",
              e instanceof Error ? e.message : String(e),
              { projected, attempts, batches }
            )
          );
        }
        if (remaining.length > 0) {
          return yield* Effect_exports.fail(
            outboxDrainFailure(
              "max_batches",
              `reached maxBatches=${validated.maxBatches} with pending outbox entries`,
              { projected, attempts, batches }
            )
          );
        }
        return { projected, attempts, batches };
      }
    }
    return { projected, attempts, batches };
  });
}

// packages/session-store/src/sidecar-v1.ts
var SIDECAR_FORMAT = "foreman-session-sidecar";
var V1_FORMAT_VERSION = 1;
var TABLE_TO_KIND = {
  sessions: "session",
  facts: "fact",
  measurements: "measurement",
  obligations: "obligation"
};
var NON_ENTITY_TABLES = /* @__PURE__ */ new Set([
  "schema_meta",
  "store_meta",
  "memory_outbox"
]);
var KNOWN_HEADER_FIELDS = /* @__PURE__ */ new Set(["format", "format_version"]);
function parseLine(line, lineNo) {
  let doc;
  try {
    doc = JSON.parse(line);
  } catch {
    raise("sidecar_malformed", `line ${lineNo} is not valid JSON`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    raise("sidecar_malformed", `line ${lineNo} is not a JSON object`);
  }
  return doc;
}
function readHeaderV1(doc) {
  if (doc["format"] !== SIDECAR_FORMAT) {
    raise(
      "sidecar_format",
      `unsupported sidecar format ${JSON.stringify(String(doc["format"]))}`
    );
  }
  const fv = doc["format_version"];
  if (fv !== V1_FORMAT_VERSION) {
    raise("sidecar_format", `unsupported sidecar format version ${String(fv)}`);
  }
  for (const k of Object.keys(doc)) {
    if (!KNOWN_HEADER_FIELDS.has(k)) {
      raise("sidecar_format", `unknown header field ${JSON.stringify(k)}`);
    }
  }
}
function decodeSnapshotV1(lines) {
  if (lines.length === 0) {
    raise("sidecar_format", "sidecar is empty; a header record is required");
  }
  readHeaderV1(parseLine(lines[0], 1));
  const buckets = {
    session: [],
    fact: [],
    measurement: [],
    obligation: []
  };
  const seen = {
    session: /* @__PURE__ */ new Set(),
    fact: /* @__PURE__ */ new Set(),
    measurement: /* @__PURE__ */ new Set(),
    obligation: /* @__PURE__ */ new Set()
  };
  for (let i = 1; i < lines.length; i++) {
    const doc = parseLine(lines[i], i + 1);
    const keys5 = Object.keys(doc).sort().join(",");
    if (keys5 !== "row,table") {
      raise(
        "sidecar_malformed",
        `line ${i + 1} must contain exactly table and row`
      );
    }
    const table = doc["table"];
    if (typeof table !== "string") {
      raise("sidecar_malformed", `line ${i + 1} table is not a string`);
    }
    if (NON_ENTITY_TABLES.has(table)) {
      continue;
    }
    const kind = TABLE_TO_KIND[table];
    if (kind === void 0) {
      raise(
        "unknown_entity_kind",
        `unknown v1 table ${JSON.stringify(table)}`
      );
    }
    const row = doc["row"];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      raise("sidecar_malformed", `line ${i + 1} row is not an object`);
    }
    const normalized = normalize(kind, row);
    const identityField = kind === "session" ? "session_id" : "id";
    const identity2 = String(normalized[identityField] ?? "");
    if (seen[kind].has(identity2)) {
      raise(
        "identity_conflict",
        `duplicate ${kind} identity ${identity2}`,
        { kind, field: identityField, detail: identity2 }
      );
    }
    seen[kind].add(identity2);
    buckets[kind].push(normalized);
  }
  return {
    modelVersion: 1,
    nextIds: computeNextIds(buckets),
    sessions: buckets.session,
    facts: buckets.fact,
    measurements: buckets.measurement,
    obligations: buckets.obligation
  };
}
function normalize(kind, row) {
  if (kind !== "obligation" || row["status"] !== "blocked") {
    return row;
  }
  return { ...row, status: "open" };
}
function computeNextIds(buckets) {
  const next = {};
  for (const kind of COUNTED_KINDS) {
    let max6 = 0;
    for (const row of buckets[kind]) {
      const id = row["id"];
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
        raise("field_type", `${kind} row has a non-integer id`);
      }
      if (id > max6) {
        max6 = id;
      }
    }
    next[kind] = max6 + 1;
  }
  return next;
}

// packages/session-store/src/sidecar.ts
var SIDECAR_FORMAT_VERSION = 2;
var UPGRADES = /* @__PURE__ */ new Map();
function encodeNumber(v) {
  if (!Number.isFinite(v)) {
    raise(
      "field_type",
      `non-finite number ${String(v)} cannot be encoded; reject at write time`
    );
  }
  return JSON.stringify(Object.is(v, -0) ? 0 : v);
}
function encodeValue(v) {
  if (v === null) return "null";
  if (typeof v === "number") return encodeNumber(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  raise("field_type", `value of type ${typeof v} is not encodable`);
}
function encodeObject(row, keys5) {
  const parts2 = keys5.map((k) => `${JSON.stringify(k)}:${encodeValue(row[k])}`);
  return `{${parts2.join(",")}}`;
}
function encodeSnapshot(snapshot) {
  assertIntegrity(snapshot);
  const lines = [];
  const nextIdParts = COUNTED_KINDS.map(
    (k) => `${JSON.stringify(k)}:${encodeNumber(snapshot.nextIds[k])}`
  );
  lines.push(
    `{"format":${JSON.stringify(SIDECAR_FORMAT)},"format_version":${SIDECAR_FORMAT_VERSION},"session_model_version":${snapshot.modelVersion},"next_ids":{${nextIdParts.join(",")}}}`
  );
  for (const kind of ENTITY_ORDER) {
    const keys5 = specFor(kind).fields.map((f) => f.name);
    for (const row of rowsOfKind(snapshot, kind)) {
      lines.push(
        `{"kind":${JSON.stringify(kind)},"row":${encodeObject(row, keys5)}}`
      );
    }
  }
  return lines.join("\n") + "\n";
}
function assertNoDuplicateKeys(line, lineNo) {
  const seen = /* @__PURE__ */ new Set();
  const re = /"((?:[^"\\]|\\.)*)"\s*:/g;
  let m;
  const depthAt = [];
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    depthAt[i] = depth;
  }
  while ((m = re.exec(line)) !== null) {
    const key = m[1] ?? "";
    const d = depthAt[m.index] ?? 0;
    const tag = `${d}:${key}`;
    if (seen.has(tag)) {
      raise(
        "sidecar_malformed",
        `duplicate key ${JSON.stringify(key)} on line ${lineNo}`
      );
    }
    seen.add(tag);
  }
}
function parseLine2(line, lineNo) {
  assertNoDuplicateKeys(line, lineNo);
  let doc;
  try {
    doc = JSON.parse(line);
  } catch (e) {
    raise(
      "sidecar_malformed",
      `invalid JSON on line ${lineNo}: ${e.message}`
    );
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    raise("sidecar_malformed", `line ${lineNo} is not a JSON object`);
  }
  return doc;
}
function readHeader(doc) {
  if (doc["format"] !== SIDECAR_FORMAT) {
    raise(
      "sidecar_format",
      `unsupported sidecar format ${JSON.stringify(String(doc["format"]))}`
    );
  }
  const fv = doc["format_version"];
  if (fv !== SIDECAR_FORMAT_VERSION) {
    raise("sidecar_format", `unsupported sidecar format version ${String(fv)}`);
  }
  const mv = doc["session_model_version"];
  if (typeof mv !== "number" || !Number.isSafeInteger(mv) || mv < 1) {
    raise("sidecar_format", `invalid session_model_version ${String(mv)}`);
  }
  const rawNext = doc["next_ids"];
  if (typeof rawNext !== "object" || rawNext === null) {
    raise("sidecar_format", "header is missing next_ids");
  }
  const nextRec = rawNext;
  const next = {};
  for (const k of COUNTED_KINDS) {
    const v = nextRec[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
      raise("sidecar_format", `invalid next_ids.${k}`);
    }
    next[k] = v;
  }
  const known = /* @__PURE__ */ new Set(["format", "format_version", "session_model_version", "next_ids"]);
  for (const k of Object.keys(doc)) {
    if (!known.has(k)) {
      raise("sidecar_format", `unknown header field ${JSON.stringify(k)}`);
    }
  }
  return {
    format: SIDECAR_FORMAT,
    format_version: SIDECAR_FORMAT_VERSION,
    session_model_version: mv,
    next_ids: next
  };
}
function decodeSnapshot(text) {
  if (text.includes("\r")) {
    raise("sidecar_malformed", "sidecar must use LF line endings");
  }
  const rawLines = text.split("\n");
  if (rawLines.length === 0 || rawLines[rawLines.length - 1] !== "") {
    raise("sidecar_malformed", "sidecar must end with exactly one newline");
  }
  const lines = rawLines.slice(0, -1);
  if (lines.length === 0) {
    raise("sidecar_format", "sidecar is empty; a header record is required");
  }
  const head5 = parseLine2(lines[0], 1);
  if (head5["format_version"] === V1_FORMAT_VERSION) {
    const v1 = decodeSnapshotV1(lines);
    assertIntegrity(v1);
    return v1;
  }
  const header = readHeader(head5);
  const buckets = {
    session: [],
    fact: [],
    measurement: [],
    obligation: []
  };
  const kindSet = new Set(ENTITY_KINDS);
  for (let i = 1; i < lines.length; i++) {
    const doc = parseLine2(lines[i], i + 1);
    if ("format" in doc) {
      raise("sidecar_format", `second header record on line ${i + 1}`);
    }
    const keys5 = Object.keys(doc).sort().join(",");
    if (keys5 !== "kind,row") {
      raise(
        "sidecar_malformed",
        `line ${i + 1} must contain exactly kind and row`
      );
    }
    const kind = doc["kind"];
    if (typeof kind !== "string" || !kindSet.has(kind)) {
      raise("unknown_entity_kind", `unknown entity kind ${JSON.stringify(String(kind))}`);
    }
    const row = doc["row"];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      raise("sidecar_malformed", `line ${i + 1} row is not an object`);
    }
    buckets[kind].push(row);
  }
  let snapshot = {
    modelVersion: header.session_model_version,
    nextIds: header.next_ids,
    sessions: buckets.session,
    facts: buckets.fact,
    measurements: buckets.measurement,
    obligations: buckets.obligation
  };
  snapshot = applyVersionPolicy(snapshot);
  assertIntegrity(snapshot);
  return snapshot;
}
function applyVersionPolicy(snapshot) {
  if (snapshot.modelVersion > SESSION_MODEL_VERSION) {
    raise(
      "model_version_unsupported",
      `sidecar declares session model version ${snapshot.modelVersion}, but this build understands ${SESSION_MODEL_VERSION}. Refusing before any write. Upgrade Foreman to import it.`
    );
  }
  let cur = snapshot;
  while (cur.modelVersion < SESSION_MODEL_VERSION) {
    const up = UPGRADES.get(cur.modelVersion);
    if (!up) {
      raise(
        "model_version_unsupported",
        `no registered upgrade from session model version ${cur.modelVersion}`
      );
    }
    const next = up(cur);
    if (next.modelVersion <= cur.modelVersion) {
      raise(
        "model_version_unsupported",
        `upgrade from ${cur.modelVersion} did not advance the model version`
      );
    }
    cur = next;
  }
  return cur;
}

// packages/session-store/src/memory-index.ts
var NullMemoryIndex = class {
  name = "null";
  async project(_records) {
  }
  async recall(_query, _limit) {
    return [];
  }
  async beginEpoch() {
    return "null-epoch";
  }
  async activateEpoch(_epoch) {
  }
};

// packages/session-store/src/sqlite-store.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
var TABLE = {
  session: "sessions",
  fact: "facts",
  measurement: "measurements",
  obligation: "obligations"
};
var SCHEMA = `
CREATE TABLE IF NOT EXISTS store_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  started_ts TEXT NOT NULL,
  start_sha  TEXT,
  ended_ts   TEXT,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id               INTEGER PRIMARY KEY,
  statement        TEXT NOT NULL,
  evidence         TEXT,
  established_ts   TEXT NOT NULL,
  session_id       TEXT REFERENCES sessions(session_id),
  superseded_by    INTEGER REFERENCES facts(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id               INTEGER PRIMARY KEY,
  metric           TEXT NOT NULL,
  value            TEXT NOT NULL,
  value_num        REAL,
  command          TEXT,
  measured_ts      TEXT NOT NULL,
  measured_sha     TEXT,
  scope_paths      TEXT,
  session_id       TEXT REFERENCES sessions(session_id),
  superseded_by    INTEGER REFERENCES measurements(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS obligations (
  id         INTEGER PRIMARY KEY,
  statement  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  blocker    TEXT,
  opened_ts  TEXT NOT NULL,
  closed_ts  TEXT,
  session_id TEXT REFERENCES sessions(session_id)
);

-- Derived projection bookkeeping. Written in the same transaction as the row
-- it describes. Deliberately NOT part of SessionSnapshot: it is rebuildable and
-- nothing outside the projector may read it.
--
-- position is stable across coalescing (hot entities keep their queue place).
-- receipt is a fresh compare-and-delete version per desired-state change.
-- UNIQUE(kind, entity_id) coalesces pending work by desired-state identity.
CREATE TABLE IF NOT EXISTS memory_outbox (
  position  INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt   TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation  TEXT NOT NULL,
  text      TEXT,
  UNIQUE(kind, entity_id)
);

CREATE TABLE IF NOT EXISTS memory_projection_versions (
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  version   INTEGER NOT NULL,
  PRIMARY KEY(kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_meas_metric ON measurements(metric);
CREATE INDEX IF NOT EXISTS idx_oblig_status ON obligations(status);
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by);
`;
var OUTBOX_LIMIT_MIN = 1;
var OUTBOX_LIMIT_MAX = 1e3;
function outboxColumnNames(db) {
  const info = db.prepare("PRAGMA table_info(memory_outbox)").all();
  return new Set(info.map((c) => c.name));
}
function isLegacyOutboxSchema(cols) {
  return cols.has("key") && cols.has("queued_ts") && !cols.has("receipt");
}
function isCurrentOutboxSchema(cols) {
  return cols.has("position") && cols.has("receipt") && cols.has("kind") && cols.has("entity_id") && cols.has("mutation") && cols.has("text");
}
var INTERNAL_NUMERIC_RECEIPT = /^r([1-9][0-9]*)$/;
function parseCanonicalNextReceipt(raw) {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  if (String(n) !== raw) return null;
  return n;
}
function maxInternalNumericReceipt(receipts) {
  let max6 = 0;
  for (const receipt of receipts) {
    const m = INTERNAL_NUMERIC_RECEIPT.exec(receipt);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n > max6) max6 = n;
  }
  return max6;
}
function quoteIdent(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}
var SqliteSessionStore = class _SqliteSessionStore {
  modelVersion = SESSION_MODEL_VERSION;
  db;
  readOnly;
  closed = false;
  constructor(db, opts = {}) {
    this.db = db;
    this.readOnly = opts.readOnly === true;
    if (!opts.skipSchemaCheck) this.assertSchemaMatchesModel();
    if (!this.readOnly) {
      this.ensureCounters();
      this.migrateOutboxIfNeeded();
      this.migrateProjectionVersionsIfNeeded();
    } else {
      this.projectionVersions();
    }
  }
  // -- construction --------------------------------------------------------
  static open(path, opts = {}) {
    if (opts.readOnly) {
      const db2 = new DatabaseSync(path, { readOnly: true });
      db2.exec("PRAGMA busy_timeout=5000");
      return new _SqliteSessionStore(db2, opts);
    }
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec(SCHEMA);
    return new _SqliteSessionStore(db, opts);
  }
  /**
   * Migrate pre-release memory_outbox(key, kind, entity_id, mutation, queued_ts)
   * to the durable receipt/position schema. Idempotent. Prefer seeding from
   * live entities because no external adapter shipped before sync.
   */
  migrateOutboxIfNeeded() {
    const cols = outboxColumnNames(this.db);
    if (cols.size === 0) {
      raise(
        "backend_mismatch",
        "memory_outbox table is missing; cannot open writable store"
      );
    }
    if (isCurrentOutboxSchema(cols)) {
      this.ensureReceiptCounter();
      return;
    }
    if (!isLegacyOutboxSchema(cols)) {
      raise(
        "backend_mismatch",
        "memory_outbox schema is not recognized; refusing writable open"
      );
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DROP TABLE IF EXISTS memory_outbox");
      this.db.exec("DELETE FROM memory_projection_versions");
      this.db.exec(`
CREATE TABLE memory_outbox (
  position  INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt   TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation  TEXT NOT NULL,
  text      TEXT,
  UNIQUE(kind, entity_id)
);`);
      this.db.prepare(
        "INSERT INTO store_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run("next_receipt", "1");
      const snap = this.readSnapshot();
      for (const rec of buildProjection(snap, this.projectId())) {
        this.queueRecord(rec);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw e;
    }
  }
  projectionVersions() {
    const table = this.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?"
    ).get("memory_projection_versions");
    if (table === void 0) {
      raise(
        "backend_mismatch",
        "projection versions are missing; reopen writable to migrate"
      );
    }
    const rows = this.db.prepare(
      "SELECT kind, entity_id, version FROM memory_projection_versions ORDER BY CASE kind WHEN 'fact' THEN 1 WHEN 'measurement' THEN 2 ELSE 3 END, entity_id"
    ).all();
    const versions = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const kind = row["kind"];
      const entityId = Number(row["entity_id"]);
      const version = Number(row["version"]);
      if (kind !== "fact" && kind !== "measurement" && kind !== "obligation" || !Number.isSafeInteger(entityId) || entityId < 1 || !Number.isSafeInteger(version) || version < 1) {
        raise("backend_mismatch", "projection version state is malformed");
      }
      versions.set(projectionKey(kind, entityId), version);
    }
    return versions;
  }
  /** Assign retained versions to legacy live rows in canonical projection order. */
  migrateProjectionVersionsIfNeeded() {
    const live = buildProjection(this.readSnapshot(), this.projectId());
    const versions = this.projectionVersions();
    const missing = live.filter(
      (record) => !versions.has(projectionKey(record.kind, record.id))
    );
    if (missing.length === 0) return;
    this.tx(() => {
      for (const record of missing) this.queueRecord(record);
    });
  }
  /**
   * Validate store_meta.next_receipt for the current outbox schema.
   * Missing + empty outbox → initialize to 1. Missing + pending → refuse.
   * MAX_SAFE_INTEGER is a valid readable exhausted state.
   */
  ensureReceiptCounter() {
    const row = this.db.prepare("SELECT value FROM store_meta WHERE key = ?").get("next_receipt");
    const pending3 = this.db.prepare("SELECT receipt FROM memory_outbox").all();
    if (row === void 0) {
      if (pending3.length > 0) {
        raise(
          "backend_mismatch",
          "next_receipt is missing while memory_outbox has pending entries"
        );
      }
      this.db.prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)").run("next_receipt", "1");
      return;
    }
    if (typeof row.value !== "string") {
      raise("backend_mismatch", "next_receipt must be a canonical integer string");
    }
    const n = parseCanonicalNextReceipt(row.value);
    if (n === null) {
      raise(
        "backend_mismatch",
        "next_receipt must be a canonical positive safe integer string"
      );
    }
    const maxReceipt = maxInternalNumericReceipt(pending3.map((r) => r.receipt));
    if (n <= maxReceipt) {
      raise(
        "backend_mismatch",
        "next_receipt must be strictly greater than every numeric receipt"
      );
    }
  }
  /**
   * Compare the live SQLite schema to the declared model and fail on drift.
   * This is the check whose absence let the old code treat `sqlite_schema` as
   * the contract.
   */
  assertSchemaMatchesModel() {
    for (const kind of ENTITY_ORDER) {
      const table = TABLE[kind];
      const info = this.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
      const actual = new Set(info.map((r) => r.name));
      const declared = specFor(kind).fields.map((f) => f.name);
      const missing = declared.filter((f) => !actual.has(f));
      const extra = [...actual].filter((c) => !declared.includes(c));
      if (missing.length > 0 || extra.length > 0) {
        raise(
          "backend_mismatch",
          `table ${table} does not match the model (missing=[${missing.join(", ")}], extra=[${extra.join(", ")}])`,
          { kind }
        );
      }
    }
  }
  ensureCounters() {
    const init = initialNextIds();
    for (const kind of COUNTED_KINDS) {
      const key = `next_id.${kind}`;
      const row = this.db.prepare("SELECT value FROM store_meta WHERE key = ?").get(key);
      if (row === void 0) {
        this.db.prepare("INSERT OR IGNORE INTO store_meta (key, value) VALUES (?, ?)").run(key, String(init[kind]));
      }
    }
  }
  // -- transaction helper --------------------------------------------------
  tx(fn2) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn2();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw e;
    }
  }
  // -- identity ------------------------------------------------------------
  projectId() {
    const row = this.db.prepare("SELECT value FROM store_meta WHERE key = ?").get("project_id");
    if (row === void 0) return null;
    if (!isProjectIdV1(row.value)) {
      raise("backend_mismatch", "store project_id is malformed");
    }
    return row.value;
  }
  bindProject(projectId) {
    if (this.readOnly) raise("invalid_argument", "store is read-only");
    if (!isProjectIdV1(projectId)) {
      raise("invalid_argument", "project id must be a lowercase UUID");
    }
    this.tx(() => {
      const current = this.projectId();
      if (current !== null && current !== projectId) {
        raise("identity_conflict", "store is already bound to another project");
      }
      if (current === projectId) return;
      this.db.prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)").run("project_id", projectId);
      for (const record of buildProjection(this.readSnapshot(), projectId)) {
        this.queueRecord(record);
      }
    });
  }
  peekNextId(kind) {
    const row = this.db.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`);
    return row ? Number(row.value) : 1;
  }
  /** Mint the next id for `kind`. Must be called inside a transaction. */
  mintId(kind) {
    const id = this.peekNextId(kind);
    this.db.prepare("UPDATE store_meta SET value = ? WHERE key = ?").run(String(id + 1), `next_id.${kind}`);
    return id;
  }
  setNextIds(next) {
    for (const kind of COUNTED_KINDS) {
      this.db.prepare("UPDATE store_meta SET value = ? WHERE key = ?").run(String(next[kind]), `next_id.${kind}`);
    }
  }
  /** Mint a fresh receipt version. Must run inside a write transaction. */
  mintReceipt() {
    const row = this.db.prepare("SELECT value FROM store_meta WHERE key = ?").get("next_receipt");
    if (row === void 0 || typeof row.value !== "string") {
      raise("backend_mismatch", "next_receipt is missing or malformed");
    }
    const n = parseCanonicalNextReceipt(row.value);
    if (n === null) {
      raise(
        "backend_mismatch",
        "next_receipt must be a canonical positive safe integer string"
      );
    }
    if (n >= Number.MAX_SAFE_INTEGER) {
      raise("invalid_argument", "outbox nextReceipt is exhausted");
    }
    const receipt = `r${n}`;
    this.db.prepare(
      "INSERT INTO store_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("next_receipt", String(n + 1));
    return { receipt, version: n };
  }
  /**
   * Coalesce pending desired state by (kind, id). A replacement gets a fresh
   * receipt but keeps the original queue position so hot entities cannot starve.
   * Must run inside the same transaction as the authoritative entity mutation.
   */
  queueRecord(record) {
    const existing = this.db.prepare(
      "SELECT position FROM memory_outbox WHERE kind = ? AND entity_id = ?"
    ).get(record.kind, record.id);
    const minted = this.mintReceipt();
    const receipt = minted.receipt;
    const text = record.mutation === "upsert" ? record.text : null;
    this.db.prepare(
      "INSERT INTO memory_projection_versions (kind, entity_id, version) VALUES (?, ?, ?) ON CONFLICT(kind, entity_id) DO UPDATE SET version = excluded.version"
    ).run(record.kind, record.id, minted.version);
    if (existing) {
      this.db.prepare(
        "UPDATE memory_outbox SET receipt = ?, mutation = ?, text = ? WHERE kind = ? AND entity_id = ?"
      ).run(receipt, record.mutation, text, record.kind, record.id);
      return;
    }
    this.db.prepare(
      "INSERT INTO memory_outbox (receipt, kind, entity_id, mutation, text) VALUES (?, ?, ?, ?, ?)"
    ).run(receipt, record.kind, record.id, record.mutation, text);
  }
  queueUpsert(kind, id, row) {
    this.queueRecord(upsertRecord(kind, id, row, this.projectId()));
  }
  queueRetract(kind, id) {
    this.queueRecord(retractRecord(kind, id, this.projectId()));
  }
  assertOutboxReadable() {
    const cols = outboxColumnNames(this.db);
    if (cols.size === 0) {
      raise(
        "backend_mismatch",
        "memory_outbox table is missing; cannot list projection work"
      );
    }
    if (isLegacyOutboxSchema(cols)) {
      raise(
        "backend_mismatch",
        "memory_outbox is the pre-release schema; reopen writable to migrate before listing"
      );
    }
    if (!isCurrentOutboxSchema(cols)) {
      raise(
        "backend_mismatch",
        "memory_outbox schema is not recognized; cannot list projection work"
      );
    }
  }
  decodeOutboxRow(r) {
    const kindRaw = r["kind"];
    if (kindRaw !== "fact" && kindRaw !== "measurement" && kindRaw !== "obligation") {
      raise("backend_mismatch", "outbox row kind is invalid");
    }
    const kind = kindRaw;
    const idRaw = r["entity_id"];
    const id = typeof idRaw === "number" ? idRaw : typeof idRaw === "bigint" ? Number(idRaw) : Number(idRaw);
    if (!Number.isSafeInteger(id)) {
      raise("backend_mismatch", "outbox row entity_id must be a safe integer");
    }
    const receipt = r["receipt"];
    if (typeof receipt !== "string" || receipt.length === 0) {
      raise("backend_mismatch", "outbox row receipt must be a non-empty string");
    }
    const projectionVersion = Number(r["projection_version"]);
    if (projectionVersion === null || !Number.isSafeInteger(projectionVersion) || projectionVersion < 1) {
      raise(
        "backend_mismatch",
        "outbox projection version is invalid"
      );
    }
    const projectId = this.projectId();
    const key = projectionKey(kind, id, projectId);
    const project = projectId === null ? {} : { project_id: projectId };
    const mutation = r["mutation"];
    if (mutation === "retract") {
      return {
        receipt,
        record: {
          ...project,
          key,
          kind,
          id,
          projection_version: projectionVersion,
          mutation: "retract"
        }
      };
    }
    if (mutation === "upsert") {
      if (typeof r["text"] !== "string") {
        raise("backend_mismatch", "outbox upsert text must be a string");
      }
      return {
        receipt,
        record: {
          ...project,
          key,
          kind,
          id,
          projection_version: projectionVersion,
          mutation: "upsert",
          text: r["text"]
        }
      };
    }
    raise(
      "backend_mismatch",
      `outbox mutation ${String(mutation)} is not upsert or retract`
    );
  }
  listOutbox(limit) {
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < OUTBOX_LIMIT_MIN || limit > OUTBOX_LIMIT_MAX) {
      raise(
        "invalid_argument",
        `listOutbox limit must be an integer in ${OUTBOX_LIMIT_MIN}..${OUTBOX_LIMIT_MAX}`
      );
    }
    this.assertOutboxReadable();
    const rows = this.db.prepare(
      "SELECT o.receipt, o.kind, o.entity_id, o.mutation, o.text, v.version AS projection_version FROM memory_outbox o JOIN memory_projection_versions v ON v.kind = o.kind AND v.entity_id = o.entity_id ORDER BY position ASC LIMIT ?"
    ).all(limit);
    return rows.map((r) => this.decodeOutboxRow(r));
  }
  projectionSnapshot() {
    const versions = this.projectionVersions();
    return buildProjection(this.readSnapshot(), this.projectId()).map((record) => {
      const version = versions.get(projectionKey(record.kind, record.id));
      if (version === void 0) {
        raise("backend_mismatch", "a live projection version is missing");
      }
      return { ...record, projection_version: version };
    });
  }
  ackOutbox(receipts) {
    if (this.readOnly) {
      raise("invalid_argument", "store is read-only");
    }
    if (receipts.length === 0) return 0;
    const unique = [...new Set(receipts)];
    return this.tx(() => {
      let deleted = 0;
      const stmt = this.db.prepare(
        "DELETE FROM memory_outbox WHERE receipt = ?"
      );
      for (const receipt of unique) {
        const info = stmt.run(receipt);
        deleted += info.changes;
      }
      return deleted;
    });
  }
  // -- reads ---------------------------------------------------------------
  selectRows(kind) {
    const spec = specFor(kind);
    const cols = spec.fields.map((f) => quoteIdent(f.name)).join(", ");
    const order = spec.ordering.map((f) => quoteIdent(f)).join(", ");
    const sql = `SELECT ${cols} FROM ${quoteIdent(TABLE[kind])} ORDER BY ${order}`;
    const raw = this.db.prepare(sql).all();
    return raw.map((r) => {
      const out = {};
      for (const f of spec.fields) out[f.name] = r[f.name] ?? null;
      return out;
    });
  }
  /**
   * A whole-store picture, read inside ONE deferred read transaction.
   *
   * The transaction is load-bearing, not decoration. Without it each table's
   * SELECT is its own read transaction, so a writer committing between two of
   * them yields a torn picture -- facts from before the write and measurements
   * from after. The canonical sidecar is encoded from this value, so a torn
   * snapshot is a torn record of truth. BEGIN (deferred), not BEGIN IMMEDIATE:
   * this takes no write lock and does not block a concurrent writer.
   */
  snapshot() {
    this.db.exec("BEGIN");
    try {
      const out = this.readSnapshot();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw e;
    }
  }
  readSnapshot() {
    const nextIds = {};
    for (const kind of COUNTED_KINDS) nextIds[kind] = this.peekNextId(kind);
    return {
      modelVersion: this.modelVersion,
      nextIds,
      sessions: this.selectRows("session"),
      facts: this.selectRows("fact"),
      measurements: this.selectRows(
        "measurement"
      ),
      obligations: this.selectRows(
        "obligation"
      )
    };
  }
  listSessions() {
    return this.selectRows("session");
  }
  listFacts() {
    return this.selectRows("fact");
  }
  listMeasurements() {
    return this.selectRows("measurement");
  }
  listObligations() {
    return this.selectRows("obligation");
  }
  currentSession() {
    const r = this.db.prepare(
      "SELECT session_id, started_ts, start_sha, ended_ts, note FROM sessions WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1"
    ).get();
    if (!r) return null;
    return {
      session_id: r["session_id"],
      started_ts: r["started_ts"],
      start_sha: r["start_sha"] ?? null,
      ended_ts: r["ended_ts"] ?? null,
      note: r["note"] ?? null
    };
  }
  // -- writes --------------------------------------------------------------
  beginSession(args2) {
    return this.tx(() => {
      this.db.prepare(
        "INSERT INTO sessions (session_id, started_ts, start_sha, ended_ts, note) VALUES (?, ?, ?, NULL, ?)"
      ).run(args2.session_id, args2.started_ts, args2.start_sha, args2.note);
      return {
        session_id: args2.session_id,
        started_ts: args2.started_ts,
        start_sha: args2.start_sha,
        ended_ts: null,
        note: args2.note
      };
    });
  }
  endSession(sessionId, endedTs) {
    return this.tx(() => {
      const existing = this.db.prepare("SELECT session_id, ended_ts FROM sessions WHERE session_id = ?").get(sessionId);
      if (!existing) {
        raise("invalid_argument", `no such session ${JSON.stringify(sessionId)}`);
      }
      if (existing.ended_ts !== null) {
        raise(
          "supersession_incomplete",
          `session ${JSON.stringify(sessionId)} is already ended; ended_ts is set-once`
        );
      }
      this.db.prepare("UPDATE sessions SET ended_ts = ? WHERE session_id = ?").run(endedTs, sessionId);
      const r = this.db.prepare(
        "SELECT session_id, started_ts, start_sha, ended_ts, note FROM sessions WHERE session_id = ?"
      ).get(sessionId);
      return {
        session_id: r["session_id"],
        started_ts: r["started_ts"],
        start_sha: r["start_sha"] ?? null,
        ended_ts: r["ended_ts"] ?? null,
        note: r["note"] ?? null
      };
    });
  }
  addFact(fact2) {
    return this.tx(() => this.insertFact(fact2));
  }
  insertFact(fact2) {
    const id = this.mintId("fact");
    this.db.prepare(
      "INSERT INTO facts (id, statement, evidence, established_ts, session_id, superseded_by, superseded_at, supersede_reason) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)"
    ).run(id, fact2.statement, fact2.evidence, fact2.established_ts, fact2.session_id);
    const row = {
      id,
      statement: fact2.statement,
      evidence: fact2.evidence,
      established_ts: fact2.established_ts,
      session_id: fact2.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null
    };
    this.queueUpsert("fact", id, row);
    return row;
  }
  addMeasurement(m) {
    return this.tx(() => this.insertMeasurement(m));
  }
  insertMeasurement(m) {
    if (m.value_num !== null && !Number.isFinite(m.value_num)) {
      raise("field_type", `value_num must be finite, got ${String(m.value_num)}`);
    }
    const id = this.mintId("measurement");
    this.db.prepare(
      "INSERT INTO measurements (id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)"
    ).run(
      id,
      m.metric,
      m.value,
      m.value_num,
      m.command,
      m.measured_ts,
      m.measured_sha,
      m.scope_paths,
      m.session_id
    );
    const row = {
      id,
      metric: m.metric,
      value: m.value,
      value_num: m.value_num,
      command: m.command,
      measured_ts: m.measured_ts,
      measured_sha: m.measured_sha,
      scope_paths: m.scope_paths,
      session_id: m.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null
    };
    this.queueUpsert("measurement", id, row);
    return row;
  }
  addObligation(o) {
    return this.tx(() => {
      const id = this.mintId("obligation");
      this.db.prepare(
        "INSERT INTO obligations (id, statement, status, blocker, opened_ts, closed_ts, session_id) VALUES (?, ?, 'open', ?, ?, NULL, ?)"
      ).run(id, o.statement, o.blocker, o.opened_ts, o.session_id);
      const row = {
        id,
        statement: o.statement,
        status: "open",
        blocker: o.blocker,
        opened_ts: o.opened_ts,
        closed_ts: null,
        session_id: o.session_id
      };
      this.queueUpsert("obligation", id, row);
      return row;
    });
  }
  closeObligation(id, status, closedTs) {
    return this.tx(() => {
      const cur = this.db.prepare("SELECT status FROM obligations WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such obligation ${id}`);
      if (cur.status !== "open") {
        raise(
          "invalid_argument",
          `obligation ${id} is already ${cur.status}; only an open obligation may be closed`
        );
      }
      this.db.prepare("UPDATE obligations SET status = ?, closed_ts = ? WHERE id = ?").run(status, closedTs, id);
      const r = this.db.prepare(
        "SELECT id, statement, status, blocker, opened_ts, closed_ts, session_id FROM obligations WHERE id = ?"
      ).get(id);
      const row = {
        id: r["id"],
        statement: r["statement"],
        status: r["status"],
        blocker: r["blocker"] ?? null,
        opened_ts: r["opened_ts"],
        closed_ts: r["closed_ts"] ?? null,
        session_id: r["session_id"] ?? null
      };
      this.queueUpsert("obligation", id, row);
      return row;
    });
  }
  supersedeFact(id, replacement, reason, at2) {
    return this.tx(() => {
      const cur = this.db.prepare("SELECT superseded_by FROM facts WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such fact ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `fact ${id} is already superseded; supersession columns are set-once`
        );
      }
      const next = this.insertFact(replacement);
      this.db.prepare(
        "UPDATE facts SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?"
      ).run(next.id, at2, reason, id);
      this.queueRetract("fact", id);
      const old = this.db.prepare(
        "SELECT id, statement, evidence, established_ts, session_id, superseded_by, superseded_at, supersede_reason FROM facts WHERE id = ?"
      ).get(id);
      return { superseded: old, replacement: next };
    });
  }
  supersedeMeasurement(id, replacement, reason, at2) {
    return this.tx(() => {
      const cur = this.db.prepare("SELECT superseded_by FROM measurements WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such measurement ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `measurement ${id} is already superseded; supersession columns are set-once`
        );
      }
      const next = this.insertMeasurement(replacement);
      this.db.prepare(
        "UPDATE measurements SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?"
      ).run(next.id, at2, reason, id);
      this.queueRetract("measurement", id);
      const old = this.db.prepare(
        "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?"
      ).get(id);
      return { superseded: old, replacement: next };
    });
  }
  retireMeasurement(id, byId, reason, at2) {
    return this.tx(() => {
      if (byId === id) {
        raise("invalid_argument", `measurement ${id} cannot supersede itself`);
      }
      const cur = this.db.prepare("SELECT superseded_by FROM measurements WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such measurement ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `measurement ${id} is already superseded; supersession columns are set-once`
        );
      }
      const by = this.db.prepare("SELECT superseded_by FROM measurements WHERE id = ?").get(byId);
      if (!by) raise("invalid_argument", `no such measurement ${byId}`);
      if (by.superseded_by !== null) {
        raise(
          "invalid_argument",
          `measurement ${byId} is itself superseded by ${by.superseded_by}; a retired measurement cannot supersede another`
        );
      }
      this.db.prepare(
        "UPDATE measurements SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?"
      ).run(byId, at2, reason, id);
      this.queueRetract("measurement", id);
      return this.db.prepare(
        "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?"
      ).get(id);
    });
  }
  // -- snapshot transfer ---------------------------------------------------
  importSnapshot(snapshot, opts = {}) {
    if (this.readOnly) {
      raise("invalid_argument", "store is read-only");
    }
    assertIntegrity(snapshot);
    if (snapshot.modelVersion !== this.modelVersion) {
      raise(
        "model_version_unsupported",
        `snapshot model version ${snapshot.modelVersion} != store ${this.modelVersion}`
      );
    }
    const force = opts.force ?? false;
    const policy = resolveIdCollisionPolicy(opts.onIdCollision);
    return this.tx(() => {
      this.db.exec("PRAGMA defer_foreign_keys=ON");
      const target = this.readSnapshot();
      const occupied = snapshotIsOccupied(target);
      if (occupied && !force) {
        raise(
          "store_not_empty",
          "target store already has rows; pass force to replace it"
        );
      }
      if (occupied && policy === "remap") {
        if (countRows(snapshot) === 0) return 0;
        const plan = planAdditiveRemapImport(target, snapshot);
        this.insertSnapshotRows(plan.insert.sessions, "session");
        this.insertSnapshotRows(plan.insert.facts, "fact");
        this.insertSnapshotRows(plan.insert.measurements, "measurement");
        this.insertSnapshotRows(plan.insert.obligations, "obligation");
        this.setNextIds(plan.merged.nextIds);
        for (const rec of additiveImportProjectionUpserts(
          target,
          plan.merged,
          this.projectId()
        )) {
          this.queueRecord(rec);
        }
        return plan.written;
      }
      const projectId = this.projectId();
      const oldLive = liveProjectionMap(target, projectId);
      const newLive = liveProjectionMap(snapshot, projectId);
      for (const kind of [...ENTITY_ORDER].reverse()) {
        this.db.exec(`DELETE FROM ${quoteIdent(TABLE[kind])}`);
      }
      let written = 0;
      for (const kind of ENTITY_ORDER) {
        written += this.insertSnapshotRows(rowsOfKind(snapshot, kind), kind);
      }
      this.setNextIds(snapshot.nextIds);
      for (const [key, oldRec] of oldLive) {
        if (!newLive.has(key)) {
          this.queueRetract(oldRec.kind, oldRec.id);
        }
      }
      for (const [key, newRec] of newLive) {
        const oldRec = oldLive.get(key);
        if (!oldRec || oldRec.text !== newRec.text) {
          this.queueRecord(newRec);
        }
      }
      return written;
    });
  }
  /** Insert rows of one kind. Returns the number inserted. Must run in a tx. */
  insertSnapshotRows(rows, kind) {
    const spec = specFor(kind);
    const names = spec.fields.map((f) => f.name);
    const cols = names.map(quoteIdent).join(", ");
    const qs = names.map(() => "?").join(", ");
    const stmt = this.db.prepare(
      `INSERT INTO ${quoteIdent(TABLE[kind])} (${cols}) VALUES (${qs})`
    );
    let written = 0;
    for (const row of rows) {
      const r = row;
      stmt.run(...names.map((n) => r[n] ?? null));
      written++;
    }
    return written;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
};

// packages/session-store/src/files-only.ts
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync as mkdirSync2,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { join as join3 } from "node:path";
var CURRENT = "CURRENT";
var GENERATIONS = "generations";
var OUTBOX_GENERATIONS = "outbox-generations";
var WRITER_CLAIMS_DIR = ".writer-claims";
var GEN_WIDTH = 8;
var OUTBOX_LIMIT_MIN2 = 1;
var OUTBOX_LIMIT_MAX2 = 1e3;
var OUTBOX_FILE_VERSION = 3;
var PROJECT_BOUND_OUTBOX_FILE_VERSION = 2;
var LEGACY_OUTBOX_FILE_VERSION = 1;
var INTERNAL_NUMERIC_RECEIPT2 = /^r([1-9][0-9]*)$/;
var LEGACY_TOKEN_RE = /^\d{8}\.ndjson$/;
var PAIRED_TOKEN_RE = /^v2-\d{8}\.ndjson$/;
function genName(n) {
  return `v2-${String(n).padStart(GEN_WIDTH, "0")}.ndjson`;
}
function isLegacyToken(name) {
  return LEGACY_TOKEN_RE.test(name);
}
function isPairedToken(name) {
  return PAIRED_TOKEN_RE.test(name);
}
function genNumberFromToken(name) {
  if (isPairedToken(name)) {
    const n = Number.parseInt(name.slice(3, 3 + GEN_WIDTH), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (isLegacyToken(name)) {
    const n = Number.parseInt(name.slice(0, GEN_WIDTH), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
var counter6 = 0;
function writeFileAtomic(dir, name, text) {
  const tmp = join3(dir, `.tmp-${name}-${process.pid}-${counter6++}`);
  const fd = openSync(tmp, "wx", 420);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, join3(dir, name));
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    throw e;
  }
}
function writeFileDurable(dir, name, text) {
  writeFileAtomic(dir, name, text);
  fsyncDir(dir);
}
function fsyncDir(dir) {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function sortedSnapshot(s) {
  return {
    modelVersion: s.modelVersion,
    nextIds: s.nextIds,
    sessions: [...s.sessions].sort(
      (a, b) => a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0
    ),
    facts: [...s.facts].sort((a, b) => a.id - b.id),
    measurements: [...s.measurements].sort((a, b) => a.id - b.id),
    obligations: [...s.obligations].sort((a, b) => a.id - b.id)
  };
}
function copyRecord(record) {
  const project = record.project_id === void 0 ? {} : { project_id: record.project_id };
  if (record.mutation === "upsert") {
    return {
      ...project,
      key: record.key,
      kind: record.kind,
      id: record.id,
      projection_version: record.projection_version,
      mutation: "upsert",
      text: record.text
    };
  }
  return {
    ...project,
    key: record.key,
    kind: record.kind,
    id: record.id,
    projection_version: record.projection_version,
    mutation: "retract"
  };
}
function copyEntry(entry) {
  return { receipt: entry.receipt, record: copyRecord(entry.record) };
}
function encodeOutbox(entries2, nextReceipt, projectId, projectionVersions) {
  const versions = [...projectionVersions.entries()].map(([key, version]) => {
    const [kind, rawId] = key.split(":");
    return { kind, id: Number(rawId), version };
  }).sort((a, b) => {
    const kinds = ["fact", "measurement", "obligation"];
    const byKind = kinds.indexOf(a.kind) - kinds.indexOf(b.kind);
    return byKind === 0 ? a.id - b.id : byKind;
  });
  return `${JSON.stringify({
    version: OUTBOX_FILE_VERSION,
    projectId,
    nextReceipt,
    entries: entries2.map(copyEntry),
    projectionVersions: versions
  })}
`;
}
function isCountedKindName(v) {
  return v === "fact" || v === "measurement" || v === "obligation";
}
function decodeOutbox(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    raise("sidecar_malformed", "outbox generation is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    raise("sidecar_malformed", "outbox generation root must be an object");
  }
  const root = parsed;
  if (root["version"] !== LEGACY_OUTBOX_FILE_VERSION && root["version"] !== PROJECT_BOUND_OUTBOX_FILE_VERSION && root["version"] !== OUTBOX_FILE_VERSION) {
    raise(
      "sidecar_malformed",
      `outbox generation version ${String(root["version"])} is unsupported`
    );
  }
  const projectId = root["version"] === LEGACY_OUTBOX_FILE_VERSION ? null : root["projectId"];
  if (projectId !== null && !isProjectIdV1(projectId)) {
    raise("sidecar_malformed", "outbox projectId must be null or a lowercase UUID");
  }
  if (!Array.isArray(root["entries"])) {
    raise("sidecar_malformed", "outbox generation entries must be an array");
  }
  const seenReceipts = /* @__PURE__ */ new Set();
  const seenIdentities = /* @__PURE__ */ new Set();
  const entries2 = [];
  let maxNumericReceipt = 0;
  for (const raw of root["entries"]) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      raise("sidecar_malformed", "outbox entry must be an object");
    }
    const e = raw;
    if (typeof e["receipt"] !== "string" || e["receipt"].length === 0) {
      raise("sidecar_malformed", "outbox entry receipt must be a non-empty string");
    }
    if (seenReceipts.has(e["receipt"])) {
      raise("sidecar_malformed", "outbox receipts must be unique");
    }
    seenReceipts.add(e["receipt"]);
    const numeric = INTERNAL_NUMERIC_RECEIPT2.exec(e["receipt"]);
    if (numeric) {
      const n = Number(numeric[1]);
      if (Number.isSafeInteger(n) && n > maxNumericReceipt) maxNumericReceipt = n;
    }
    const rec = e["record"];
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      raise("sidecar_malformed", "outbox entry record must be an object");
    }
    const r = rec;
    if (!isCountedKindName(r["kind"])) {
      raise("sidecar_malformed", "outbox record kind is invalid");
    }
    if (typeof r["id"] !== "number" || !Number.isSafeInteger(r["id"])) {
      raise("sidecar_malformed", "outbox record id must be a safe integer");
    }
    const identity2 = projectionKey(r["kind"], r["id"], projectId);
    if (seenIdentities.has(identity2)) {
      raise(
        "sidecar_malformed",
        "outbox desired-state identities (kind,id) must be unique"
      );
    }
    seenIdentities.add(identity2);
    if (typeof r["key"] !== "string" || r["key"] !== identity2) {
      raise("sidecar_malformed", "outbox record key does not match its identity");
    }
    if (projectId === null && r["project_id"] !== void 0 || projectId !== null && r["project_id"] !== projectId) {
      raise("sidecar_malformed", "outbox record project_id does not match metadata");
    }
    const project = projectId === null ? {} : { project_id: projectId };
    const persistedVersion = r["projection_version"];
    const derivedVersion = numeric === null ? null : Number(numeric[1]);
    const projectionVersion = persistedVersion === void 0 ? derivedVersion : persistedVersion;
    if (typeof projectionVersion !== "number" || !Number.isSafeInteger(projectionVersion) || projectionVersion < 1 || derivedVersion !== null && projectionVersion !== derivedVersion) {
      raise(
        "sidecar_malformed",
        "outbox projection_version must match its internal receipt"
      );
    }
    if (r["mutation"] === "upsert") {
      if (typeof r["text"] !== "string") {
        raise("sidecar_malformed", "outbox upsert record text must be a string");
      }
      entries2.push({
        receipt: e["receipt"],
        record: {
          ...project,
          key: r["key"],
          kind: r["kind"],
          id: r["id"],
          projection_version: projectionVersion,
          mutation: "upsert",
          text: r["text"]
        }
      });
    } else if (r["mutation"] === "retract") {
      entries2.push({
        receipt: e["receipt"],
        record: {
          ...project,
          key: r["key"],
          kind: r["kind"],
          id: r["id"],
          projection_version: projectionVersion,
          mutation: "retract"
        }
      });
    } else {
      raise("sidecar_malformed", "outbox record mutation must be upsert or retract");
    }
  }
  if (!Object.prototype.hasOwnProperty.call(root, "nextReceipt")) {
    raise("sidecar_malformed", "outbox generation nextReceipt is required");
  }
  if (typeof root["nextReceipt"] !== "number" || !Number.isSafeInteger(root["nextReceipt"]) || root["nextReceipt"] < 1) {
    raise(
      "sidecar_malformed",
      "outbox nextReceipt must be a positive safe integer"
    );
  }
  const nextReceipt = root["nextReceipt"];
  if (nextReceipt <= maxNumericReceipt) {
    raise(
      "sidecar_malformed",
      "outbox nextReceipt must be strictly greater than every numeric receipt"
    );
  }
  const projectionVersions = /* @__PURE__ */ new Map();
  const needsProjectionMigration = root["version"] !== OUTBOX_FILE_VERSION;
  if (!needsProjectionMigration) {
    if (!Array.isArray(root["projectionVersions"])) {
      raise("sidecar_malformed", "outbox projectionVersions must be an array");
    }
    for (const raw of root["projectionVersions"]) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        raise("sidecar_malformed", "projection version row must be an object");
      }
      const row = raw;
      if (!isCountedKindName(row["kind"]) || typeof row["id"] !== "number" || !Number.isSafeInteger(row["id"]) || row["id"] < 1 || typeof row["version"] !== "number" || !Number.isSafeInteger(row["version"]) || row["version"] < 1 || row["version"] >= nextReceipt) {
        raise("sidecar_malformed", "projection version row is invalid");
      }
      const key = projectionKey(row["kind"], row["id"]);
      if (projectionVersions.has(key)) {
        raise("sidecar_malformed", "projection version identities must be unique");
      }
      projectionVersions.set(key, row["version"]);
    }
    for (const entry of entries2) {
      const key = projectionKey(entry.record.kind, entry.record.id);
      if (projectionVersions.get(key) !== entry.record.projection_version) {
        raise(
          "sidecar_malformed",
          "pending projection version must match retained current version"
        );
      }
    }
  }
  return {
    entries: entries2,
    nextReceipt,
    projectId,
    projectionVersions,
    needsProjectionMigration
  };
}
function synthesizeOutbox(snap, projectId = null) {
  const entries2 = [];
  const projectionVersions = /* @__PURE__ */ new Map();
  let nextReceipt = 1;
  for (const record of buildProjection(snap, projectId)) {
    const version = nextReceipt++;
    const versioned = copyRecord({ ...record, projection_version: version });
    entries2.push({ receipt: `r${version}`, record: versioned });
    projectionVersions.set(projectionKey(record.kind, record.id), version);
  }
  return { entries: entries2, nextReceipt, projectionVersions };
}
function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e;
    if (err.code === "EPERM") return true;
    return false;
  }
}
function processStartIdentity(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = raw.lastIndexOf(")");
    if (closeParen < 0) return null;
    const fields = raw.slice(closeParen + 2).split(" ");
    const start3 = fields[19];
    return start3 !== void 0 && /^\d+$/.test(start3) ? start3 : null;
  } catch {
    return null;
  }
}
function claimsDir(dir) {
  return join3(dir, WRITER_CLAIMS_DIR);
}
function encodeClaim(body) {
  return `${JSON.stringify(body)}
`;
}
function parseClaim(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed;
  if (typeof o["pid"] !== "number" || !Number.isSafeInteger(o["pid"]) || o["pid"] <= 0) {
    return null;
  }
  if (typeof o["ownerToken"] !== "string" || o["ownerToken"].length === 0) {
    return null;
  }
  const startIdentity = o["startIdentity"] === null ? null : typeof o["startIdentity"] === "string" ? o["startIdentity"] : null;
  if (o["startIdentity"] !== null && startIdentity === null) return null;
  return {
    pid: o["pid"],
    startIdentity,
    ownerToken: o["ownerToken"]
  };
}
function isClaimLive(body) {
  if (!isProcessAlive(body.pid)) return false;
  if (body.startIdentity === null) return true;
  const current = processStartIdentity(body.pid);
  if (current === null) return true;
  return current === body.startIdentity;
}
function acquireWriterLock(dir) {
  const dirPath = claimsDir(dir);
  mkdirSync2(dirPath, { recursive: true });
  const token = randomBytes(16).toString("hex");
  const startIdentity = processStartIdentity(process.pid);
  const claimName = `claim-${Date.now().toString().padStart(15, "0")}-${token}.json`;
  const claimPath = join3(dirPath, claimName);
  const body = {
    pid: process.pid,
    startIdentity,
    ownerToken: token
  };
  const fd = openSync(claimPath, "wx", 420);
  try {
    writeSync(fd, encodeClaim(body));
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try {
      unlinkSync(claimPath);
    } catch {
    }
    throw e;
  }
  closeSync(fd);
  try {
    fsyncDir(dirPath);
  } catch {
  }
  try {
    const scanLive = () => {
      const live = [];
      for (const name of readdirSync(dirPath)) {
        if (!name.startsWith("claim-") || !name.endsWith(".json")) continue;
        const path = join3(dirPath, name);
        let raw;
        try {
          raw = readFileSync(path, "utf8");
        } catch {
          continue;
        }
        const parsed = parseClaim(raw);
        if (parsed === null || !isClaimLive(parsed)) {
          if (path !== claimPath) {
            try {
              unlinkSync(path);
            } catch {
            }
          }
          continue;
        }
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          continue;
        }
        live.push({ name, path, mtimeMs });
      }
      live.sort((a, b) => {
        if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      return live;
    };
    const lose = (winner) => {
      try {
        unlinkSync(claimPath);
      } catch {
      }
      const ownerHint = winner !== void 0 ? `another live claim (${winner.name})` : "no winning live claim";
      raise(
        "invalid_argument",
        `files-only store directory is owned by another live writable handle (${ownerHint}); single-host exclusive writer only, not a network filesystem lease`
      );
    };
    let soleWins = 0;
    for (let round = 0; round < 40; round++) {
      const live = scanLive();
      const winner = live[0];
      if (winner === void 0 || winner.path !== claimPath) {
        return lose(winner);
      }
      if (live.length === 1) {
        soleWins += 1;
        if (soleWins >= 2) {
          return { path: claimPath, token };
        }
      } else {
        soleWins = 0;
      }
      const waitUntil = Date.now() + 10;
      while (Date.now() < waitUntil) {
      }
    }
    return lose(scanLive()[0]);
  } catch (e) {
    try {
      unlinkSync(claimPath);
    } catch {
    }
    throw e;
  }
}
function releaseWriterClaim(claim) {
  try {
    unlinkSync(claim.path);
  } catch {
  }
}
function cloneQueue(entries2, nextReceipt) {
  return {
    entries: entries2.map(copyEntry),
    nextReceipt
  };
}
function assertReceiptCounterMintable(nextReceipt) {
  if (!Number.isSafeInteger(nextReceipt) || nextReceipt < 1 || nextReceipt >= Number.MAX_SAFE_INTEGER) {
    raise("invalid_argument", "outbox nextReceipt is exhausted");
  }
}
function queueRecord(q, record) {
  assertReceiptCounterMintable(q.nextReceipt);
  const projectionVersion = q.nextReceipt++;
  const receipt = `r${projectionVersion}`;
  const entry = {
    receipt,
    record: copyRecord({ ...record, projection_version: projectionVersion })
  };
  const idx = q.entries.findIndex(
    (e) => e.record.kind === record.kind && e.record.id === record.id
  );
  if (idx >= 0) {
    q.entries[idx] = entry;
    return;
  }
  q.entries.push(entry);
}
function queueUpsert(q, kind, id, row, projectId) {
  queueRecord(q, upsertRecord(kind, id, row, projectId));
}
function queueRetract(q, kind, id, projectId) {
  queueRecord(q, retractRecord(kind, id, projectId));
}
var FilesOnlySessionStore = class _FilesOnlySessionStore {
  modelVersion = SESSION_MODEL_VERSION;
  #dir;
  #genDir;
  #outboxDir;
  #readOnly;
  #writerClaim;
  #snap;
  #outbox;
  #nextReceipt;
  #projectId;
  #projectionVersions;
  #gen;
  #closed = false;
  constructor(dir, snap, outbox, nextReceipt, projectId, projectionVersions, gen3, readOnly, writerClaim) {
    this.#dir = dir;
    this.#genDir = join3(dir, GENERATIONS);
    this.#outboxDir = join3(dir, OUTBOX_GENERATIONS);
    this.#readOnly = readOnly;
    this.#writerClaim = writerClaim;
    this.#snap = snap;
    this.#outbox = outbox.map(copyEntry);
    this.#nextReceipt = nextReceipt;
    this.#projectId = projectId;
    this.#projectionVersions = new Map(projectionVersions);
    this.#gen = gen3;
  }
  static open(opts) {
    const dir = opts.dir;
    const readOnly = opts.readOnly === true;
    if (readOnly) {
      return _FilesOnlySessionStore.#openReadOnly(dir);
    }
    mkdirSync2(dir, { recursive: true });
    mkdirSync2(join3(dir, GENERATIONS), { recursive: true });
    mkdirSync2(join3(dir, OUTBOX_GENERATIONS), { recursive: true });
    let claim = null;
    try {
      claim = acquireWriterLock(dir);
      return _FilesOnlySessionStore.#openWritable(dir, claim);
    } catch (e) {
      if (claim !== null) releaseWriterClaim(claim);
      throw e;
    }
  }
  static #openReadOnly(dir) {
    if (!existsSync(dir)) {
      raise(
        "invalid_argument",
        `files-only store directory does not exist: ${JSON.stringify(dir)}`
      );
    }
    const loaded = _FilesOnlySessionStore.#loadLive(dir, join3(dir, GENERATIONS));
    if (loaded.needsProjectionMigration) {
      raise(
        "sidecar_malformed",
        "projection versions require a writable migration"
      );
    }
    return new _FilesOnlySessionStore(
      dir,
      loaded.snap,
      loaded.outbox,
      loaded.nextReceipt,
      loaded.projectId,
      loaded.projectionVersions,
      loaded.gen,
      true,
      null
    );
  }
  static #openWritable(dir, claim) {
    const currentPath = join3(dir, CURRENT);
    if (!existsSync(currentPath)) {
      const store2 = new _FilesOnlySessionStore(
        dir,
        emptySnapshot(),
        [],
        1,
        null,
        /* @__PURE__ */ new Map(),
        0,
        false,
        claim
      );
      store2.#publish(store2.#snap, [], 1);
      return store2;
    }
    const loaded = _FilesOnlySessionStore.#loadLive(dir, join3(dir, GENERATIONS));
    const store = new _FilesOnlySessionStore(
      dir,
      loaded.snap,
      loaded.outbox,
      loaded.nextReceipt,
      loaded.projectId,
      loaded.projectionVersions,
      loaded.gen,
      false,
      claim
    );
    if (loaded.needsProjectionMigration) {
      const q = cloneQueue(store.#outbox, store.#nextReceipt);
      for (const record of buildProjection(store.#snap, store.#projectId)) {
        queueRecord(q, record);
      }
      store.#publish(store.#snap, q.entries, q.nextReceipt);
    }
    return store;
  }
  static #loadLive(dir, genDir) {
    const currentPath = join3(dir, CURRENT);
    if (!existsSync(currentPath)) {
      raise(
        "sidecar_malformed",
        `${CURRENT} is missing in ${JSON.stringify(dir)}`
      );
    }
    const name = readFileSync(currentPath, "utf8").trim();
    if (name === "") {
      raise("sidecar_malformed", `${CURRENT} is empty in ${JSON.stringify(dir)}`);
    }
    if (!isLegacyToken(name) && !isPairedToken(name)) {
      raise(
        "sidecar_malformed",
        `${CURRENT} names unsupported generation token ${JSON.stringify(name)}`
      );
    }
    const genPath = join3(genDir, name);
    if (!existsSync(genPath)) {
      raise(
        "sidecar_malformed",
        `${CURRENT} names generation ${JSON.stringify(name)}, which does not exist`
      );
    }
    const snap = decodeSnapshot(readFileSync(genPath, "utf8"));
    if (snap.modelVersion !== SESSION_MODEL_VERSION) {
      raise(
        "model_version_unsupported",
        `stored model version ${snap.modelVersion} != store ${SESSION_MODEL_VERSION}`
      );
    }
    const parsedGen = genNumberFromToken(name);
    const gen3 = parsedGen !== null ? parsedGen : latestGeneration(genDir);
    if (isLegacyToken(name)) {
      const outboxPath2 = join3(dir, OUTBOX_GENERATIONS, name);
      if (existsSync(outboxPath2)) {
        const decoded2 = decodeOutbox(readFileSync(outboxPath2, "utf8"));
        return {
          snap,
          outbox: decoded2.entries,
          nextReceipt: decoded2.nextReceipt,
          projectId: decoded2.projectId,
          projectionVersions: decoded2.projectionVersions,
          needsProjectionMigration: decoded2.needsProjectionMigration,
          gen: gen3
        };
      }
      const synthesized = synthesizeOutbox(snap);
      return {
        snap,
        outbox: synthesized.entries,
        nextReceipt: synthesized.nextReceipt,
        projectId: null,
        projectionVersions: synthesized.projectionVersions,
        needsProjectionMigration: true,
        gen: gen3
      };
    }
    const outboxPath = join3(dir, OUTBOX_GENERATIONS, name);
    if (!existsSync(outboxPath)) {
      raise(
        "sidecar_malformed",
        `paired outbox generation ${JSON.stringify(name)} is missing`
      );
    }
    const decoded = decodeOutbox(readFileSync(outboxPath, "utf8"));
    return {
      snap,
      outbox: decoded.entries,
      nextReceipt: decoded.nextReceipt,
      projectId: decoded.projectId,
      projectionVersions: decoded.projectionVersions,
      needsProjectionMigration: decoded.needsProjectionMigration,
      gen: gen3
    };
  }
  // -- publication ---------------------------------------------------------
  /**
   * Make `next` / `nextOutbox` the live paired generation.
   *
   * Order matters for crash atomicity:
   *   1. write+fsync+rename both generation files
   *   2. fsync both generation directories
   *   3. atomically replace+fsync CURRENT last
   *   4. only then update in-memory state
   *
   * A crash before CURRENT moves leaves both the old snapshot and the old
   * outbox live. `encodeSnapshot` runs first and throws on an invalid
   * snapshot, so nothing reaches the disk and in-memory state is untouched.
   */
  #publish(next, nextOutbox, nextReceipt, projectId = this.#projectId) {
    const ordered = sortedSnapshot(next);
    const snapText = encodeSnapshot(ordered);
    const projectionVersions = new Map(this.#projectionVersions);
    for (const entry of nextOutbox) {
      projectionVersions.set(
        projectionKey(entry.record.kind, entry.record.id),
        entry.record.projection_version
      );
    }
    const outboxText = encodeOutbox(
      nextOutbox,
      nextReceipt,
      projectId,
      projectionVersions
    );
    const gen3 = this.#gen + 1;
    const name = genName(gen3);
    writeFileAtomic(this.#genDir, name, snapText);
    writeFileAtomic(this.#outboxDir, name, outboxText);
    fsyncDir(this.#genDir);
    fsyncDir(this.#outboxDir);
    writeFileDurable(this.#dir, CURRENT, `${name}
`);
    this.#gen = gen3;
    this.#snap = ordered;
    this.#outbox = nextOutbox.map(copyEntry);
    this.#nextReceipt = nextReceipt;
    this.#projectId = projectId;
    this.#projectionVersions = projectionVersions;
  }
  #assertOpen() {
    if (this.#closed) {
      raise("invalid_argument", "store is closed");
    }
  }
  #assertWritable() {
    this.#assertOpen();
    if (this.#readOnly) {
      raise("invalid_argument", "store is read-only");
    }
  }
  // -- reads ---------------------------------------------------------------
  projectId() {
    this.#assertOpen();
    return this.#projectId;
  }
  bindProject(projectId) {
    this.#assertWritable();
    if (!isProjectIdV1(projectId)) {
      raise("invalid_argument", "project id must be a lowercase UUID");
    }
    if (this.#projectId !== null && this.#projectId !== projectId) {
      raise("identity_conflict", "store is already bound to another project");
    }
    if (this.#projectId === projectId) return;
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    for (const record of buildProjection(this.#snap, projectId)) {
      queueRecord(q, record);
    }
    this.#publish(this.#snap, q.entries, q.nextReceipt, projectId);
  }
  snapshot() {
    this.#assertOpen();
    return this.#snap;
  }
  listSessions() {
    this.#assertOpen();
    return this.#snap.sessions;
  }
  listFacts() {
    this.#assertOpen();
    return this.#snap.facts;
  }
  listMeasurements() {
    this.#assertOpen();
    return this.#snap.measurements;
  }
  listObligations() {
    this.#assertOpen();
    return this.#snap.obligations;
  }
  currentSession() {
    this.#assertOpen();
    let best = null;
    for (const s of this.#snap.sessions) {
      if (s.ended_ts !== null) continue;
      if (best === null || s.session_id > best.session_id) best = s;
    }
    return best;
  }
  peekNextId(kind) {
    this.#assertOpen();
    return this.#snap.nextIds[kind];
  }
  #mint(kind) {
    const id = this.#snap.nextIds[kind];
    return { id, nextIds: { ...this.#snap.nextIds, [kind]: id + 1 } };
  }
  // -- projection outbox ---------------------------------------------------
  listOutbox(limit) {
    this.#assertOpen();
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < OUTBOX_LIMIT_MIN2 || limit > OUTBOX_LIMIT_MAX2) {
      raise(
        "invalid_argument",
        `listOutbox limit must be an integer in ${OUTBOX_LIMIT_MIN2}..${OUTBOX_LIMIT_MAX2}`
      );
    }
    return this.#outbox.slice(0, limit).map(copyEntry);
  }
  projectionSnapshot() {
    this.#assertOpen();
    return buildProjection(this.#snap, this.#projectId).map((record) => {
      const version = this.#projectionVersions.get(
        projectionKey(record.kind, record.id)
      );
      if (version === void 0) {
        raise("sidecar_malformed", "a live projection version is missing");
      }
      return copyRecord({ ...record, projection_version: version });
    });
  }
  ackOutbox(receipts) {
    this.#assertWritable();
    if (receipts.length === 0) return 0;
    const unique = [...new Set(receipts)];
    const remove8 = new Set(unique);
    const remaining = [];
    let deleted = 0;
    for (const entry of this.#outbox) {
      if (remove8.has(entry.receipt)) {
        deleted += 1;
        continue;
      }
      remaining.push(copyEntry(entry));
    }
    if (deleted === 0) return 0;
    this.#publish(this.#snap, remaining, this.#nextReceipt);
    return deleted;
  }
  // -- writes --------------------------------------------------------------
  beginSession(args2) {
    this.#assertWritable();
    if (this.#snap.sessions.some((s) => s.session_id === args2.session_id)) {
      raise(
        "identity_conflict",
        `session ${JSON.stringify(args2.session_id)} already exists`
      );
    }
    const row = {
      session_id: args2.session_id,
      started_ts: args2.started_ts,
      start_sha: args2.start_sha,
      ended_ts: null,
      note: args2.note
    };
    this.#publish(
      { ...this.#snap, sessions: [...this.#snap.sessions, row] },
      this.#outbox,
      this.#nextReceipt
    );
    return row;
  }
  endSession(sessionId, endedTs) {
    this.#assertWritable();
    const cur = this.#snap.sessions.find((s) => s.session_id === sessionId);
    if (!cur) {
      raise("invalid_argument", `no such session ${JSON.stringify(sessionId)}`);
    }
    if (cur.ended_ts !== null) {
      raise(
        "supersession_incomplete",
        `session ${JSON.stringify(sessionId)} is already ended; ended_ts is set-once`
      );
    }
    const row = { ...cur, ended_ts: endedTs };
    this.#publish(
      {
        ...this.#snap,
        sessions: this.#snap.sessions.map(
          (s) => s.session_id === sessionId ? row : s
        )
      },
      this.#outbox,
      this.#nextReceipt
    );
    return row;
  }
  addFact(fact2) {
    this.#assertWritable();
    const { row, next } = this.#buildFact(fact2);
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "fact",
      row.id,
      row,
      this.#projectId
    );
    this.#publish(next, q.entries, q.nextReceipt);
    return row;
  }
  /** Shared by addFact and supersedeFact; does not publish or queue. */
  #buildFact(fact2) {
    const { id, nextIds } = this.#mint("fact");
    const row = {
      id,
      statement: fact2.statement,
      evidence: fact2.evidence,
      established_ts: fact2.established_ts,
      session_id: fact2.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null
    };
    return {
      row,
      next: { ...this.#snap, nextIds, facts: [...this.#snap.facts, row] }
    };
  }
  addMeasurement(m) {
    this.#assertWritable();
    const { row, next } = this.#buildMeasurement(m);
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "measurement",
      row.id,
      row,
      this.#projectId
    );
    this.#publish(next, q.entries, q.nextReceipt);
    return row;
  }
  #buildMeasurement(m) {
    if (m.value_num !== null && !Number.isFinite(m.value_num)) {
      raise("field_type", `value_num must be finite, got ${String(m.value_num)}`);
    }
    const { id, nextIds } = this.#mint("measurement");
    const row = {
      id,
      metric: m.metric,
      value: m.value,
      value_num: m.value_num,
      command: m.command,
      measured_ts: m.measured_ts,
      measured_sha: m.measured_sha,
      scope_paths: m.scope_paths,
      session_id: m.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null
    };
    return {
      row,
      next: {
        ...this.#snap,
        nextIds,
        measurements: [...this.#snap.measurements, row]
      }
    };
  }
  addObligation(o) {
    this.#assertWritable();
    const { id, nextIds } = this.#mint("obligation");
    const row = {
      id,
      statement: o.statement,
      status: "open",
      blocker: o.blocker,
      opened_ts: o.opened_ts,
      closed_ts: null,
      session_id: o.session_id
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "obligation",
      row.id,
      row,
      this.#projectId
    );
    this.#publish(
      {
        ...this.#snap,
        nextIds,
        obligations: [...this.#snap.obligations, row]
      },
      q.entries,
      q.nextReceipt
    );
    return row;
  }
  closeObligation(id, status, closedTs) {
    this.#assertWritable();
    const cur = this.#snap.obligations.find((o) => o.id === id);
    if (!cur) raise("invalid_argument", `no such obligation ${id}`);
    if (cur.status !== "open") {
      raise(
        "invalid_argument",
        `obligation ${id} is already ${cur.status}; only an open obligation may be closed`
      );
    }
    const row = { ...cur, status, closed_ts: closedTs };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "obligation",
      id,
      row,
      this.#projectId
    );
    this.#publish(
      {
        ...this.#snap,
        obligations: this.#snap.obligations.map((o) => o.id === id ? row : o)
      },
      q.entries,
      q.nextReceipt
    );
    return row;
  }
  supersedeFact(id, replacement, reason, at2) {
    this.#assertWritable();
    const cur = this.#snap.facts.find((f) => f.id === id);
    if (!cur) raise("invalid_argument", `no such fact ${id}`);
    if (cur.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `fact ${id} is already superseded; supersession columns are set-once`
      );
    }
    const { row: next, next: withNew } = this.#buildFact(replacement);
    const old = {
      ...cur,
      superseded_by: next.id,
      superseded_at: at2,
      supersede_reason: reason
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "fact",
      next.id,
      next,
      this.#projectId
    );
    queueRetract(q, "fact", id, this.#projectId);
    this.#publish(
      {
        ...withNew,
        facts: withNew.facts.map((f) => f.id === id ? old : f)
      },
      q.entries,
      q.nextReceipt
    );
    return { superseded: old, replacement: next };
  }
  supersedeMeasurement(id, replacement, reason, at2) {
    this.#assertWritable();
    const cur = this.#snap.measurements.find((m) => m.id === id);
    if (!cur) raise("invalid_argument", `no such measurement ${id}`);
    if (cur.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `measurement ${id} is already superseded; supersession columns are set-once`
      );
    }
    const { row: next, next: withNew } = this.#buildMeasurement(replacement);
    const old = {
      ...cur,
      superseded_by: next.id,
      superseded_at: at2,
      supersede_reason: reason
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "measurement",
      next.id,
      next,
      this.#projectId
    );
    queueRetract(q, "measurement", id, this.#projectId);
    this.#publish(
      {
        ...withNew,
        measurements: withNew.measurements.map((m) => m.id === id ? old : m)
      },
      q.entries,
      q.nextReceipt
    );
    return { superseded: old, replacement: next };
  }
  retireMeasurement(id, byId, reason, at2) {
    this.#assertWritable();
    if (byId === id) {
      raise("invalid_argument", `measurement ${id} cannot supersede itself`);
    }
    const cur = this.#snap.measurements.find((m) => m.id === id);
    if (!cur) raise("invalid_argument", `no such measurement ${id}`);
    if (cur.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `measurement ${id} is already superseded; supersession columns are set-once`
      );
    }
    const by = this.#snap.measurements.find((m) => m.id === byId);
    if (!by) raise("invalid_argument", `no such measurement ${byId}`);
    if (by.superseded_by !== null) {
      raise(
        "invalid_argument",
        `measurement ${byId} is itself superseded by ${by.superseded_by}; a retired measurement cannot supersede another`
      );
    }
    const row = {
      ...cur,
      superseded_by: byId,
      superseded_at: at2,
      supersede_reason: reason
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueRetract(q, "measurement", id, this.#projectId);
    this.#publish(
      {
        ...this.#snap,
        measurements: this.#snap.measurements.map((m) => m.id === id ? row : m)
      },
      q.entries,
      q.nextReceipt
    );
    return row;
  }
  // -- snapshot transfer ---------------------------------------------------
  importSnapshot(snapshot, opts = {}) {
    this.#assertWritable();
    assertIntegrity(snapshot);
    if (snapshot.modelVersion !== this.modelVersion) {
      raise(
        "model_version_unsupported",
        `snapshot model version ${snapshot.modelVersion} != store ${this.modelVersion}`
      );
    }
    const force = opts.force ?? false;
    const policy = resolveIdCollisionPolicy(opts.onIdCollision);
    const target = this.#snap;
    const occupied = snapshotIsOccupied(target);
    if (occupied && !force) {
      raise(
        "store_not_empty",
        "target store already has rows; pass force to replace it"
      );
    }
    if (occupied && policy === "remap") {
      if (countRows(snapshot) === 0) return 0;
      const plan = planAdditiveRemapImport(target, snapshot);
      const q2 = cloneQueue(this.#outbox, this.#nextReceipt);
      for (const rec of additiveImportProjectionUpserts(
        target,
        plan.merged,
        this.#projectId
      )) {
        queueRecord(q2, rec);
      }
      this.#publish(plan.merged, q2.entries, q2.nextReceipt);
      return plan.written;
    }
    const oldLive = liveProjectionMap(target, this.#projectId);
    const newLive = liveProjectionMap(snapshot, this.#projectId);
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    for (const [key, oldRec] of oldLive) {
      if (!newLive.has(key)) {
        queueRetract(q, oldRec.kind, oldRec.id, this.#projectId);
      }
    }
    for (const [key, newRec] of newLive) {
      const oldRec = oldLive.get(key);
      if (!oldRec || oldRec.text !== newRec.text) {
        queueRecord(q, newRec);
      }
    }
    const next = {
      modelVersion: snapshot.modelVersion,
      nextIds: snapshot.nextIds,
      sessions: [...snapshot.sessions],
      facts: [...snapshot.facts],
      measurements: [...snapshot.measurements],
      obligations: [...snapshot.obligations]
    };
    this.#publish(next, q.entries, q.nextReceipt);
    return countRows(next);
  }
  // -- lifecycle -----------------------------------------------------------
  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#writerClaim !== null) {
      releaseWriterClaim(this.#writerClaim);
    }
  }
};
function latestGeneration(genDir) {
  let best = 0;
  for (const name of readdirSync(genDir)) {
    const n = genNumberFromToken(name);
    if (n !== null && n > best) best = n;
  }
  return best;
}
function openFilesOnlyStore(opts) {
  return FilesOnlySessionStore.open(opts);
}

// packages/session-store/src/open.ts
var CANONICAL_BACKENDS = ["sqlite", "files_only"];
function normalizeBackend(raw) {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "sqlite") return "sqlite";
  if (normalized === "files_only" || normalized === "files" || normalized === "file") {
    return "files_only";
  }
  raise(
    "backend_misconfiguration",
    `unknown FOREMAN_SESSION_BACKEND ${JSON.stringify(raw)}; accepted canonical names are ${CANONICAL_BACKENDS.join(" and ")}`
  );
}
function nonemptyPath(value) {
  if (value === void 0) return void 0;
  if (value.trim() === "") return void 0;
  return value;
}
function openSqliteSessionStore(opts) {
  return openSqliteAtPath(opts);
}
function openSqliteAtPath(opts) {
  const readOnly = opts.readOnly === true;
  const selection = {
    location: opts.path,
    locationKind: "file"
  };
  opts.onSelected?.(selection);
  const access = {
    readOnly,
    allowMigration: !readOnly
  };
  opts.prepareSqlite?.(opts.path, access);
  return SqliteSessionStore.open(opts.path, { readOnly });
}
function openSessionStore(opts = {}) {
  const env = opts.env ?? process.env;
  const readOnly = opts.readOnly === true;
  const backend = normalizeBackend(env.FOREMAN_SESSION_BACKEND);
  if (backend === "sqlite") {
    const path = nonemptyPath(env.FOREMAN_SESSION_DB) ?? nonemptyPath(opts.defaultSqlitePath?.());
    if (path === void 0) {
      raise(
        "backend_misconfiguration",
        "FOREMAN_SESSION_DB is required when FOREMAN_SESSION_BACKEND is sqlite"
      );
    }
    return openSqliteAtPath({
      path,
      readOnly,
      ...opts.prepareSqlite !== void 0 ? { prepareSqlite: opts.prepareSqlite } : {},
      ...opts.onSelected !== void 0 ? { onSelected: opts.onSelected } : {}
    });
  }
  const dir = nonemptyPath(env.FOREMAN_SESSION_DIR);
  if (dir === void 0) {
    raise(
      "backend_misconfiguration",
      "FOREMAN_SESSION_DIR is required when FOREMAN_SESSION_BACKEND is files_only"
    );
  }
  opts.onSelected?.({
    location: dir,
    locationKind: "directory"
  });
  return openFilesOnlyStore({ dir, readOnly });
}

// packages/session-store/src/projection-lease.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// packages/session-store/src/sqlite-migration.ts
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";
import fs, { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join4 } from "node:path";
var SQLITE_BUSY = 5;
var SQLITE_READONLY = 8;
var SQLITE_CORRUPT = 11;
var SQLITE_CANTOPEN = 14;
var SQLITE_READONLY_DIRECTORY = 1544;
var V1_TABLE = {
  session: "sessions",
  fact: "facts",
  measurement: "measurements",
  obligation: "obligations"
};
function quoteIdentifier(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}
function asJsonValue(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = asJsonValue(v);
    return out;
  }
  return String(value);
}
function jsonDumps(obj, sortKeys = false) {
  if (obj === null) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => jsonDumps(v, sortKeys)).join(", ") + "]";
  }
  const keys5 = sortKeys ? Object.keys(obj).sort() : Object.keys(obj);
  return "{" + keys5.map((k) => {
    const value = obj[k];
    return JSON.stringify(k) + ": " + jsonDumps(value === void 0 ? null : value, sortKeys);
  }).join(", ") + "}";
}
function sqliteErrcode(e) {
  if (typeof e !== "object" || e === null) return void 0;
  const code = e.errcode;
  return typeof code === "number" ? code : void 0;
}
function classifySqliteStore(path) {
  let st;
  try {
    st = fs.lstatSync(path);
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    if (code === "ENOENT") return "absent";
    throw e;
  }
  if (st.isSymbolicLink()) {
    try {
      st = fs.statSync(path);
    } catch {
      return "unrecognised";
    }
  }
  if (!st.isFile() && !st.isDirectory()) {
    return "unrecognised";
  }
  const db = new DatabaseSync3(path, { readOnly: true });
  try {
    let names;
    try {
      names = new Set(
        db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((r) => r.name)
      );
    } catch (e) {
      const errcode = sqliteErrcode(e);
      if (errcode === SQLITE_CORRUPT) return "corrupt";
      if (errcode === SQLITE_BUSY || errcode === SQLITE_READONLY || errcode === SQLITE_READONLY_DIRECTORY || errcode === SQLITE_CANTOPEN) {
        throw e;
      }
      return "unrecognised";
    }
    const hasPort = names.has("store_meta");
    const hasLegacy = names.has("schema_meta");
    if (hasPort && hasLegacy) return "corrupt";
    if (hasPort) {
      for (const table of [
        "store_meta",
        "sessions",
        "facts",
        "measurements",
        "obligations",
        "memory_outbox"
      ]) {
        if (!names.has(table)) return "corrupt";
      }
      for (const [kind, table] of [
        ["fact", "facts"],
        ["measurement", "measurements"],
        ["obligation", "obligations"]
      ]) {
        const row = db.prepare(`SELECT MAX(id) AS m FROM ${quoteIdentifier(table)}`).get();
        const max6 = row && row.m !== null ? Number(row.m) : 0;
        const wm = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`);
        if (wm === void 0 || typeof wm.value !== "string") return "corrupt";
        const next = Number(wm.value);
        if (!Number.isFinite(next)) return "corrupt";
        if (next <= max6) return "corrupt";
      }
      return "port";
    }
    if (hasLegacy) return "legacy";
    return "unrecognised";
  } finally {
    db.close();
  }
}
function dumpLegacySqliteAsV1(path) {
  const snapshotDir = mkdtempSync(join4(tmpdir(), "foreman-legacy-dump-"));
  const snapshotPath = join4(snapshotDir, "session.db");
  try {
    copyFileSync(path, snapshotPath);
    if (fs.existsSync(`${path}-wal`)) {
      copyFileSync(`${path}-wal`, `${snapshotPath}-wal`);
    }
    const db = new DatabaseSync3(snapshotPath, { readOnly: true });
    try {
      db.exec("PRAGMA foreign_keys=OFF");
      const present = new Set(
        db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((r) => r.name)
      );
      const documents = [jsonDumps({ format: SIDECAR_FORMAT, format_version: 1 }, true)];
      for (const kind of ENTITY_ORDER) {
        const table = V1_TABLE[kind];
        if (!present.has(table)) {
          return { ok: false, reason: "missing_declared_table", table };
        }
        const spec = specFor(kind);
        const have = new Set(
          db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((r) => r.name)
        );
        const columns = spec.fields.map((f) => f.name);
        const selected = columns.map((c) => have.has(c) ? quoteIdentifier(c) : `NULL AS ${quoteIdentifier(c)}`).join(", ");
        const ordering = spec.ordering.map((c) => quoteIdentifier(c)).join(", ");
        const query = `SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY ${ordering}`;
        for (const record of db.prepare(query).all()) {
          const row = {};
          for (const c of columns) row[c] = asJsonValue(record[c] ?? null);
          documents.push(jsonDumps({ row, table }, true));
        }
      }
      return { ok: true, text: documents.join("\n") + "\n" };
    } finally {
      db.close();
    }
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}
function sqliteStoreIsEmpty(path) {
  const db = new DatabaseSync3(path);
  try {
    const row = db.prepare(
      "SELECT (SELECT COUNT(*) FROM facts) + (SELECT COUNT(*) FROM measurements) + (SELECT COUNT(*) FROM obligations) + (SELECT COUNT(*) FROM sessions) AS n"
    ).get();
    return row !== void 0 && row.n === 0;
  } finally {
    db.close();
  }
}

// packages/session-store/src/sqlite-rebuild.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, renameSync as renameSync2, rmSync as rmSync2 } from "node:fs";
function removeJournalSidecars(dbPath2) {
  rmSync2(`${dbPath2}-wal`, { force: true });
  rmSync2(`${dbPath2}-shm`, { force: true });
}
function rebuildSqliteFromSidecar(opts) {
  if (existsSync2(opts.dbPath) && opts.force !== true) {
    throw new Error(
      `${opts.dbPath} already exists; pass force to replace it. Rebuilding onto an existing file would skip schema creation.`
    );
  }
  const snapshot = decodeSnapshot(readFileSync2(opts.sidecarPath, "utf8"));
  const tmpPath = `${opts.dbPath}.rebuild`;
  rmSync2(tmpPath, { force: true });
  removeJournalSidecars(tmpPath);
  const store = openSqliteSessionStore({ path: tmpPath });
  let rowsWritten;
  try {
    rowsWritten = store.importSnapshot(snapshot);
  } finally {
    store.close();
  }
  removeJournalSidecars(tmpPath);
  const asideWal = `${opts.dbPath}-wal.rebuild-aside`;
  const asideShm = `${opts.dbPath}-shm.rebuild-aside`;
  rmSync2(asideWal, { force: true });
  rmSync2(asideShm, { force: true });
  let movedWal = false;
  let movedShm = false;
  try {
    if (existsSync2(`${opts.dbPath}-wal`)) {
      renameSync2(`${opts.dbPath}-wal`, asideWal);
      movedWal = true;
    }
    opts.afterWalAside?.();
    if (existsSync2(`${opts.dbPath}-shm`)) {
      renameSync2(`${opts.dbPath}-shm`, asideShm);
      movedShm = true;
    }
    renameSync2(tmpPath, opts.dbPath);
  } catch (e) {
    try {
      if (movedWal) renameSync2(asideWal, `${opts.dbPath}-wal`);
      if (movedShm) renameSync2(asideShm, `${opts.dbPath}-shm`);
    } catch {
    }
    throw e;
  }
  try {
    opts.afterRename?.();
  } finally {
    rmSync2(asideWal, { force: true });
    rmSync2(asideShm, { force: true });
    removeJournalSidecars(tmpPath);
  }
  return { rowsWritten, nextIds: snapshot.nextIds };
}

// packages/session-store/src/contract-suite.ts
function assert(cond, msg) {
  if (!cond) {
    const e = new Error(msg);
    e.name = "AssertionError";
    throw e;
  }
}
function assertRejects(fn2, reason) {
  let threw = false;
  try {
    fn2();
  } catch (e) {
    threw = true;
    const got = reasonOf(e);
    assert(
      got === reason,
      `expected failure ${reason}, got ${got ?? e.message}`
    );
  }
  assert(threw, `expected failure ${reason}, but the call succeeded`);
}
function assertViolation(snap, match12, msg) {
  const vs = findViolations(snap);
  const found = vs.some((v) => v.detail.includes(match12));
  assert(
    found,
    `${msg} (expected a violation detail containing ${JSON.stringify(match12)}; got: ${vs.length === 0 ? "no violations" : vs.map((v) => v.detail).join("; ")})`
  );
}
function seedFixture(store) {
  store.beginSession({
    session_id: "S1",
    started_ts: "2026-08-08T10:00:00Z",
    start_sha: "abc123",
    note: null
  });
  const f1 = store.addFact({
    statement: "the port is the contract",
    evidence: null,
    established_ts: "2026-08-08T10:01:00Z",
    session_id: "S1"
  });
  store.supersedeFact(
    f1.id,
    {
      statement: "the port is the contract, and the model declares it",
      evidence: "packages/session-store/src/entities.ts",
      established_ts: "2026-08-08T10:02:00Z",
      session_id: "S1"
    },
    "sharpened",
    "2026-08-08T10:02:00Z"
  );
  store.addMeasurement({
    metric: "typecheck.errors",
    value: "0",
    value_num: 0,
    command: "npm run typecheck",
    measured_ts: "2026-08-08T10:03:00Z",
    measured_sha: "abc123",
    scope_paths: "packages/session-store",
    session_id: "S1"
  });
  const o1 = store.addObligation({
    statement: "write the conformance suite",
    blocker: null,
    opened_ts: "2026-08-08T10:04:00Z",
    session_id: "S1"
  });
  store.closeObligation(o1.id, "done", "2026-08-08T10:05:00Z");
}
function withFacts(base, facts) {
  return { ...base, facts };
}
function baseWithSession() {
  return {
    ...emptySnapshot(),
    sessions: [
      {
        session_id: "S1",
        started_ts: "2026-08-08T10:00:00Z",
        start_sha: null,
        ended_ts: null,
        note: null
      }
    ]
  };
}
function fact(over) {
  return {
    id: 1,
    statement: "s",
    evidence: null,
    established_ts: "2026-08-08T10:00:00Z",
    session_id: "S1",
    superseded_by: null,
    superseded_at: null,
    supersede_reason: null,
    ...over
  };
}
var CASES = [
  {
    name: "roundtrip/empty-store",
    run: (f) => {
      const s = f();
      try {
        const snap = s.snapshot();
        const back = decodeSnapshot(encodeSnapshot(snap));
        assert(snapshotsEqual(snap, back), "empty snapshot did not round-trip");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "roundtrip/populated-store",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const snap = s.snapshot();
        const back = decodeSnapshot(encodeSnapshot(snap));
        assert(snapshotsEqual(snap, back), "populated snapshot did not round-trip");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "roundtrip/import-of-export-is-equal",
    run: (f) => {
      const a = f();
      const b = f();
      try {
        seedFixture(a);
        const snap = a.snapshot();
        b.importSnapshot(decodeSnapshot(encodeSnapshot(snap)));
        assert(
          snapshotsEqual(snap, b.snapshot()),
          "import(export(store)) produced a different snapshot"
        );
      } finally {
        a.close();
        b.close();
      }
    }
  },
  {
    name: "encoding/byte-stable-across-repeated-encodes",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const one = encodeSnapshot(s.snapshot());
        const two = encodeSnapshot(s.snapshot());
        assert(one === two, "two encodes of an untouched store differed");
        const three = encodeSnapshot(decodeSnapshot(one));
        assert(one === three, "encode\u2218decode\u2218encode was not byte-identical");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "encoding/ends-with-exactly-one-newline",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const text = encodeSnapshot(s.snapshot());
        assert(text.endsWith("\n"), "sidecar must end with a newline");
        assert(!text.endsWith("\n\n"), "sidecar must not end with a blank line");
        assert(!text.includes("\r"), "sidecar must not contain CR");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "identity/ids-are-port-minted-and-advance",
    run: (f) => {
      const s = f();
      try {
        assert(s.peekNextId("fact") === 1, "fresh store should mint fact id 1");
        const a = s.addFact({
          statement: "a",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null
        });
        assert(a.id === 1, `expected minted id 1, got ${a.id}`);
        assert(s.peekNextId("fact") === 2, "counter did not advance");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "identity/allocation-state-round-trips",
    run: (f) => {
      const a = f();
      const b = f();
      try {
        seedFixture(a);
        const before2 = a.peekNextId("fact");
        b.importSnapshot(decodeSnapshot(encodeSnapshot(a.snapshot())));
        assert(
          b.peekNextId("fact") === before2,
          `next id did not round-trip: ${b.peekNextId("fact")} != ${before2}`
        );
      } finally {
        a.close();
        b.close();
      }
    }
  },
  {
    name: "supersession/set-once",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const superseded = s.listFacts().find((r) => r.superseded_by !== null);
        assert(superseded !== void 0, "fixture should contain a superseded fact");
        assertRejects(
          () => s.supersedeFact(
            superseded.id,
            {
              statement: "third",
              evidence: null,
              established_ts: "2026-08-08T11:00:00Z",
              session_id: "S1"
            },
            null,
            "2026-08-08T11:00:00Z"
          ),
          "supersession_incomplete"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "supersession/fan-in-is-accepted",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 3, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 3, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 3 })
        ]),
        nextIds: { fact: 4, measurement: 1, obligation: 1 }
      };
      assert(
        findViolations(snap).length === 0,
        "legitimate fan-in supersession was rejected"
      );
    }
  },
  {
    name: "supersession/fan-in-does-not-disable-other-checks",
    run: () => {
      const dangling = {
        ...withFacts(baseWithSession(), [
          fact({ superseded_by: 99, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(dangling, "dangling superseded_by", "dangling pointer was accepted");
      const selfSupersede = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(selfSupersede, "supersedes itself", "self-supersession was accepted");
      const cycle = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 2, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 }
      };
      assertViolation(cycle, "supersession cycle", "supersession cycle was accepted");
    }
  },
  {
    name: "obligation/close-is-once-only",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const done7 = s.listObligations().find((o) => o.status === "done");
        assert(done7 !== void 0, "fixture should contain a closed obligation");
        assertRejects(
          () => s.closeObligation(done7.id, "dropped", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "session/end-is-once-only",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const first2 = s.endSession("S1", "2026-08-08T12:00:00Z");
        assert(first2.ended_ts === "2026-08-08T12:00:00Z", "first end must stamp ended_ts");
        assertRejects(
          () => s.endSession("S1", "2026-08-08T12:01:00Z"),
          "supersession_incomplete"
        );
        const after3 = s.listSessions().find((row) => row.session_id === "S1");
        assert(
          after3?.ended_ts === "2026-08-08T12:00:00Z",
          "a second end must not rewrite ended_ts"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "write/rejects-non-finite-value-num",
    run: (f) => {
      const s = f();
      try {
        assertRejects(
          () => s.addMeasurement({
            metric: "rate",
            value: "Infinity",
            value_num: Number.POSITIVE_INFINITY,
            command: null,
            measured_ts: "2026-08-08T10:00:00Z",
            measured_sha: null,
            scope_paths: null,
            session_id: null
          }),
          "field_type"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/refuses-non-empty-store-without-force",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        assertRejects(
          () => s.importSnapshot(emptySnapshot()),
          "store_not_empty"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/newer-model-version-refused-without-mutation",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const before2 = encodeSnapshot(s.snapshot());
        const future = {
          ...emptySnapshot(),
          modelVersion: SESSION_MODEL_VERSION + 1
        };
        assertRejects(
          () => s.importSnapshot(future, { force: true }),
          "model_version_unsupported"
        );
        assert(
          encodeSnapshot(s.snapshot()) === before2,
          "store was mutated despite refusing a newer model version"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/remap-additive-preserves-target-and-returns-donor-count",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        s.endSession("S1", "2026-08-08T12:00:00Z");
        const before2 = s.snapshot();
        const beforeFacts = before2.facts.map((row) => ({ ...row }));
        const donor = {
          ...emptySnapshot(),
          nextIds: { fact: 2, measurement: 1, obligation: 1 },
          sessions: [
            {
              session_id: "D1",
              started_ts: "2026-08-09T10:00:00Z",
              start_sha: null,
              ended_ts: null,
              note: "donor"
            }
          ],
          facts: [
            {
              id: 1,
              statement: "donor-only fact",
              evidence: null,
              established_ts: "2026-08-09T10:01:00Z",
              session_id: "D1",
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null
            }
          ]
        };
        const written = s.importSnapshot(donor, {
          force: true,
          onIdCollision: "remap"
        });
        assert(
          written === 2,
          `force+remap must return countRows(donor)=2, got ${written}`
        );
        const after3 = s.snapshot();
        const targetFactsAfter = after3.facts.filter(
          (row) => before2.facts.some((b) => b.id === row.id)
        );
        assert(
          JSON.stringify(targetFactsAfter) === JSON.stringify(beforeFacts),
          "target facts must remain byte-identical after additive remap"
        );
        assert(
          after3.facts.length === before2.facts.length + 1,
          "donor fact must be inserted additively"
        );
        assert(
          after3.sessions.some((row) => row.session_id === "D1"),
          "unused donor session id must be preserved"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/remap-per-kind-ids-and-pointer-fan-in",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        s.endSession("S1", "2026-08-08T12:00:00Z");
        const before2 = s.snapshot();
        const donor = {
          ...emptySnapshot(),
          nextIds: { fact: 3, measurement: 4, obligation: 2 },
          sessions: [
            {
              session_id: "DX",
              started_ts: "2026-08-09T10:00:00Z",
              start_sha: null,
              ended_ts: "2026-08-09T11:00:00Z",
              note: null
            }
          ],
          facts: [
            {
              id: 1,
              statement: "old",
              evidence: null,
              established_ts: "2026-08-09T10:01:00Z",
              session_id: "DX",
              superseded_by: 2,
              superseded_at: "2026-08-09T10:02:00Z",
              supersede_reason: "rewritten"
            },
            {
              id: 2,
              statement: "new",
              evidence: null,
              established_ts: "2026-08-09T10:02:00Z",
              session_id: "DX",
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null
            }
          ],
          measurements: [
            {
              id: 1,
              metric: "a",
              value: "1",
              value_num: 1,
              command: null,
              measured_ts: "2026-08-09T10:03:00Z",
              measured_sha: null,
              scope_paths: null,
              session_id: "DX",
              superseded_by: 3,
              superseded_at: "2026-08-09T10:05:00Z",
              supersede_reason: "fan-in"
            },
            {
              id: 2,
              metric: "b",
              value: "2",
              value_num: 2,
              command: null,
              measured_ts: "2026-08-09T10:04:00Z",
              measured_sha: null,
              scope_paths: null,
              session_id: "DX",
              superseded_by: 3,
              superseded_at: "2026-08-09T10:05:00Z",
              supersede_reason: "fan-in"
            },
            {
              id: 3,
              metric: "c",
              value: "3",
              value_num: 3,
              command: null,
              measured_ts: "2026-08-09T10:05:00Z",
              measured_sha: null,
              scope_paths: null,
              session_id: "DX",
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null
            }
          ],
          obligations: [
            {
              id: 1,
              statement: "do",
              status: "open",
              blocker: null,
              opened_ts: "2026-08-09T10:06:00Z",
              closed_ts: null,
              session_id: "DX"
            }
          ]
        };
        s.importSnapshot(donor, { force: true, onIdCollision: "remap" });
        const after3 = s.snapshot();
        const newFacts = after3.facts.filter(
          (row) => !before2.facts.some((b) => b.id === row.id)
        );
        assert(newFacts.length === 2, "expected two remapped donor facts");
        const sortedFacts = [...newFacts].sort((a, b) => a.id - b.id);
        const fOld = sortedFacts[0];
        const fNew = sortedFacts[1];
        assert(fOld.superseded_by === fNew.id, "fact pointer must use fact map");
        assert(
          fOld.id === before2.nextIds.fact,
          "first remapped fact must start at target nextIds.fact"
        );
        const newMeas = after3.measurements.filter(
          (row) => !before2.measurements.some((b) => b.id === row.id)
        );
        assert(newMeas.length === 3, "expected three remapped donor measurements");
        const sortedM = [...newMeas].sort((a, b) => a.id - b.id);
        const m0 = sortedM[0];
        const m1 = sortedM[1];
        const m2 = sortedM[2];
        assert(
          m0.id === before2.nextIds.measurement,
          "measurement remap must start at target nextIds.measurement"
        );
        assert(
          m0.superseded_by === m2.id && m1.superseded_by === m2.id,
          "measurement fan-in pointers must rewrite through the measurement map"
        );
        const newObs = after3.obligations.filter(
          (row) => !before2.obligations.some((b) => b.id === row.id)
        );
        assert(
          newObs.length === 1 && newObs[0].id === before2.nextIds.obligation,
          "obligation remap must use obligation nextIds independently"
        );
        assert(
          after3.nextIds.fact === before2.nextIds.fact + 2 && after3.nextIds.measurement === before2.nextIds.measurement + 3 && after3.nextIds.obligation === before2.nextIds.obligation + 1,
          "merged nextIds must be target-derived"
        );
        const minted = s.addFact({
          statement: "post-import",
          evidence: null,
          established_ts: "2026-08-09T12:00:00Z",
          session_id: null
        });
        assert(
          minted.id === after3.nextIds.fact,
          "ordinary post-import allocation must continue from merged nextIds"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/remap-session-collision-reserves-donor-originals",
    run: (f) => {
      const s = f();
      try {
        s.beginSession({
          session_id: "A",
          started_ts: "2026-08-08T10:00:00Z",
          start_sha: null,
          note: "target"
        });
        s.endSession("A", "2026-08-08T11:00:00Z");
        const donor = {
          ...emptySnapshot(),
          nextIds: { fact: 2, measurement: 1, obligation: 1 },
          sessions: [
            {
              session_id: "A",
              started_ts: "2026-08-09T10:00:00Z",
              start_sha: null,
              ended_ts: "2026-08-09T11:00:00Z",
              note: "target"
              // byte-identical collision still remaps
            },
            {
              session_id: "A~import-1",
              started_ts: "2026-08-09T10:00:01Z",
              start_sha: null,
              ended_ts: "2026-08-09T11:00:01Z",
              note: "reserved"
            },
            {
              session_id: "B",
              started_ts: "2026-08-09T10:00:02Z",
              start_sha: null,
              ended_ts: "2026-08-09T11:00:02Z",
              note: "free"
            }
          ],
          facts: [
            {
              id: 1,
              statement: "from-A",
              evidence: null,
              established_ts: "2026-08-09T10:01:00Z",
              session_id: "A",
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null
            }
          ]
        };
        s.importSnapshot(donor, { force: true, onIdCollision: "remap" });
        const sessions = s.listSessions().map((row) => row.session_id).sort();
        assert(
          sessions.includes("A") && sessions.includes("A~import-1") && sessions.includes("A~import-2") && sessions.includes("B"),
          `expected reserved-avoiding remap, got ${sessions.join(",")}`
        );
        const fact2 = s.listFacts().find((row) => row.statement === "from-A");
        assert(fact2?.session_id === "A~import-2", "counted session_id must follow session map");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/remap-refuses-dual-open-sessions-without-mutation",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const before2 = encodeSnapshot(s.snapshot());
        const donor = {
          ...emptySnapshot(),
          sessions: [
            {
              session_id: "D-open",
              started_ts: "2026-08-09T10:00:00Z",
              start_sha: null,
              ended_ts: null,
              note: null
            }
          ]
        };
        assertRejects(
          () => s.importSnapshot(donor, { force: true, onIdCollision: "remap" }),
          "invalid_argument"
        );
        assert(
          encodeSnapshot(s.snapshot()) === before2,
          "dual-open refusal must leave the target unchanged"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/remap-empty-donor-is-noop",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        assert(
          s.listFacts().length > 0,
          "fixture must persist before empty-donor no-op"
        );
        const before2 = encodeSnapshot(s.snapshot());
        const written = s.importSnapshot(emptySnapshot(), {
          force: true,
          onIdCollision: "remap"
        });
        assert(written === 0, `empty donor must return 0, got ${written}`);
        assert(
          encodeSnapshot(s.snapshot()) === before2,
          "empty-donor force+remap must be a true no-op"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/unknown-policy-refused",
    run: (f) => {
      const s = f();
      try {
        assertRejects(
          () => s.importSnapshot(emptySnapshot(), {
            onIdCollision: "merge"
          }),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/empty-target-remap-is-exact-round-trip",
    run: (f) => {
      const s = f();
      try {
        const snap = {
          ...emptySnapshot(),
          nextIds: { fact: 2, measurement: 1, obligation: 1 },
          sessions: [
            {
              session_id: "E1",
              started_ts: "2026-08-08T10:00:00Z",
              start_sha: null,
              ended_ts: null,
              note: null
            }
          ],
          facts: [
            {
              id: 1,
              statement: "exact-remap",
              evidence: null,
              established_ts: "2026-08-08T10:01:00Z",
              session_id: "E1",
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null
            }
          ]
        };
        const written = s.importSnapshot(snap, { onIdCollision: "remap" });
        assert(written === 2, `empty-target remap must write 2 rows, got ${written}`);
        assert(
          snapshotsEqual(snap, s.snapshot()),
          "empty-target remap must preserve donor ids and nextIds exactly"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/force-refuse-still-replaces",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const replacement = {
          ...emptySnapshot(),
          nextIds: { fact: 2, measurement: 1, obligation: 1 },
          facts: [
            {
              id: 1,
              statement: "replacement-only",
              evidence: null,
              established_ts: "2026-08-10T10:00:00Z",
              session_id: null,
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null
            }
          ]
        };
        const written = s.importSnapshot(replacement, { force: true });
        assert(written === 1, `force+refuse must return replacement size, got ${written}`);
        const after3 = s.snapshot();
        assert(after3.sessions.length === 0, "force+refuse must replace sessions");
        assert(
          after3.facts.length === 1 && after3.facts[0].statement === "replacement-only",
          "force+refuse must replace facts"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/points-one-existing-measurement-at-another",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const a = s.addMeasurement({
          metric: "suite.pass",
          value: "700",
          value_num: 700,
          command: "bats tests/",
          measured_ts: "2026-08-08T11:00:00Z",
          measured_sha: "aaa111",
          scope_paths: "tests",
          session_id: "S1"
        });
        const b = s.addMeasurement({
          metric: "suite.pass",
          value: "720",
          value_num: 720,
          command: "bats tests/",
          measured_ts: "2026-08-08T12:00:00Z",
          measured_sha: "bbb222",
          scope_paths: "tests",
          session_id: "S1"
        });
        const before2 = s.listMeasurements().length;
        const retired = s.retireMeasurement(a.id, b.id, "stale", "2026-08-08T12:00:01Z");
        assert(retired.superseded_by === b.id, "superseded_by was not set to byId");
        assert(retired.superseded_at === "2026-08-08T12:00:01Z", "superseded_at was not set");
        assert(retired.supersede_reason === "stale", "supersede_reason was not set");
        assert(
          s.listMeasurements().length === before2,
          "retire inserted a row; it must only link existing rows"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/fan-in-many-predecessors-onto-one-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v, ts) => s.addMeasurement({
          metric: "suite.pass",
          value: v,
          value_num: Number(v),
          command: "bats tests/",
          measured_ts: ts,
          measured_sha: "ccc333",
          scope_paths: "tests",
          session_id: "S1"
        });
        const p1 = mk("1", "2026-08-08T11:00:00Z");
        const p2 = mk("2", "2026-08-08T11:01:00Z");
        const p3 = mk("3", "2026-08-08T11:02:00Z");
        const fresh = mk("4", "2026-08-08T12:00:00Z");
        for (const p of [p1, p2, p3]) {
          s.retireMeasurement(p.id, fresh.id, "retired by a fresh reading", "2026-08-08T12:00:01Z");
        }
        const rows = s.listMeasurements();
        const naming = rows.filter((r) => r.superseded_by === fresh.id);
        assert(naming.length === 3, `expected 3 rows naming ${fresh.id}, got ${naming.length}`);
        const back = decodeSnapshot(encodeSnapshot(s.snapshot()));
        assert(snapshotsEqual(s.snapshot(), back), "fan-in snapshot did not round-trip");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-missing-target",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        assertRejects(
          () => s.retireMeasurement(9999, 1, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-missing-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const only = s.listMeasurements()[0];
        assert(only !== void 0, "fixture has no measurement");
        assertRejects(
          () => s.retireMeasurement(only.id, 9999, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-self-retire",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const only = s.listMeasurements()[0];
        assert(only !== void 0, "fixture has no measurement");
        assertRejects(
          () => s.retireMeasurement(only.id, only.id, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-already-retired-target",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v, ts) => s.addMeasurement({
          metric: "m",
          value: v,
          value_num: Number(v),
          command: null,
          measured_ts: ts,
          measured_sha: null,
          scope_paths: "x",
          session_id: "S1"
        });
        const a = mk("1", "2026-08-08T11:00:00Z");
        const b = mk("2", "2026-08-08T11:01:00Z");
        const c = mk("3", "2026-08-08T11:02:00Z");
        s.retireMeasurement(a.id, b.id, "first", "2026-08-08T11:03:00Z");
        assertRejects(
          () => s.retireMeasurement(a.id, c.id, "second", "2026-08-08T11:04:00Z"),
          "supersession_incomplete"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-a-retired-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v, ts) => s.addMeasurement({
          metric: "m",
          value: v,
          value_num: Number(v),
          command: null,
          measured_ts: ts,
          measured_sha: null,
          scope_paths: "x",
          session_id: "S1"
        });
        const a = mk("1", "2026-08-08T11:00:00Z");
        const b = mk("2", "2026-08-08T11:01:00Z");
        const c = mk("3", "2026-08-08T11:02:00Z");
        s.retireMeasurement(b.id, c.id, "b is retired", "2026-08-08T11:03:00Z");
        assertRejects(
          () => s.retireMeasurement(a.id, b.id, "r", "2026-08-08T11:04:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "outbox/queues-projection-on-entity-mutation",
    run: (f) => {
      const s = f();
      try {
        const fact2 = s.addFact({
          statement: "queued for projection",
          evidence: "/secret/path/credentials",
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null
        });
        const entries2 = s.listOutbox(100);
        const hit = entries2.find(
          (e) => e.record.kind === "fact" && e.record.id === fact2.id
        );
        assert(hit !== void 0, "addFact must queue a projection entry");
        assert(hit.record.key === `fact:${fact2.id}`, "desired-state key must be kind:id");
        assert(hit.record.mutation === "upsert", "add must queue upsert");
        if (hit.record.mutation === "upsert") {
          assert(
            hit.record.text === "queued for projection",
            "outbox text must be projectable fields only"
          );
          assert(
            !hit.record.text.includes("/secret/path"),
            "evidence must not enter outbox text"
          );
        }
        assert(typeof hit.receipt === "string" && hit.receipt.length > 0, "receipt required");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "outbox/selective-receipt-ack",
    run: (f) => {
      const s = f();
      try {
        const a = s.addFact({
          statement: "a",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null
        });
        const b = s.addFact({
          statement: "b",
          evidence: null,
          established_ts: "2026-08-08T10:01:00Z",
          session_id: null
        });
        const before2 = s.listOutbox(100);
        const aEntry = before2.find((e) => e.record.id === a.id && e.record.kind === "fact");
        const bEntry = before2.find((e) => e.record.id === b.id && e.record.kind === "fact");
        assert(aEntry !== void 0 && bEntry !== void 0, "both facts must be queued");
        const deleted = s.ackOutbox([aEntry.receipt]);
        assert(deleted === 1, `expected 1 ack, got ${deleted}`);
        const after3 = s.listOutbox(100);
        assert(
          after3.every((e) => e.receipt !== aEntry.receipt),
          "acked receipt must be gone"
        );
        assert(
          after3.some((e) => e.receipt === bEntry.receipt),
          "unacked receipt must remain"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "outbox/unknown-receipt-noop",
    run: (f) => {
      const s = f();
      try {
        s.addFact({
          statement: "stays",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null
        });
        const before2 = s.listOutbox(100);
        assert(before2.length >= 1, "expected pending work");
        const deleted = s.ackOutbox(["receipt-that-does-not-exist"]);
        assert(deleted === 0, `unknown receipt must delete 0, got ${deleted}`);
        const after3 = s.listOutbox(100);
        assert(
          after3.length === before2.length && after3.every((e, i) => e.receipt === before2[i].receipt),
          "unknown ack must leave the queue unchanged"
        );
      } finally {
        s.close();
      }
    }
  }
];
var HOSTILE_CASES = [
  {
    name: "hostile/dangling-superseded-by",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ superseded_by: 99, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(snap, "dangling superseded_by", "dangling pointer was accepted");
    }
  },
  {
    name: "hostile/self-supersession",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(snap, "supersedes itself", "self-supersession was accepted");
    }
  },
  {
    name: "hostile/supersession-cycle",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 2, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 }
      };
      assertViolation(snap, "supersession cycle", "supersession cycle was accepted");
    }
  },
  {
    name: "hostile/partial-supersession-metadata",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: null, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(
        snap,
        "must both be set or both be null",
        "superseded_at without superseded_by was accepted"
      );
    }
  },
  {
    name: "hostile/absent-field-instead-of-null",
    run: () => {
      const partial = { ...fact({}) };
      delete partial["evidence"];
      const snap = withFacts(baseWithSession(), [partial]);
      assert(findViolations(snap).length > 0, "absent key was accepted");
    }
  },
  {
    name: "hostile/unknown-extra-field",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ rogue: "x" })]);
      assert(findViolations(snap).length > 0, "unknown field was accepted");
    }
  },
  {
    name: "hostile/unknown-session-reference",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ session_id: "NOPE" })]);
      assert(findViolations(snap).length > 0, "dangling session ref was accepted");
    }
  },
  {
    name: "hostile/duplicate-id",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [fact({ id: 1 }), fact({ id: 1 })]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assert(findViolations(snap).length > 0, "duplicate id was accepted");
    }
  },
  {
    name: "hostile/id-at-or-above-watermark",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ id: 5 })]);
      assert(
        findViolations(snap).length > 0,
        "id at/above nextIds watermark was accepted"
      );
    }
  },
  {
    name: "hostile/nextIds-must-be-positive-safe-integer",
    run: () => {
      assertViolation(
        {
          ...emptySnapshot(),
          nextIds: { fact: 0, measurement: 1, obligation: 1 }
        },
        "nextIds.fact must be a positive safe integer",
        "nextIds.fact=0 on an empty kind was accepted"
      );
      assertViolation(
        {
          ...emptySnapshot(),
          nextIds: { fact: 1.5, measurement: 1, obligation: 1 }
        },
        "nextIds.fact must be a positive safe integer",
        "non-integer nextIds.fact was accepted"
      );
    }
  },
  {
    name: "hostile/rows-out-of-declared-order",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [fact({ id: 2 }), fact({ id: 1 })]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 }
      };
      assert(findViolations(snap).length > 0, "out-of-order rows were accepted");
    }
  },
  {
    name: "hostile/open-obligation-with-closed-ts",
    run: () => {
      const snap = {
        ...baseWithSession(),
        nextIds: { fact: 1, measurement: 1, obligation: 2 },
        obligations: [
          {
            id: 1,
            statement: "x",
            status: "open",
            blocker: null,
            opened_ts: "2026-08-08T10:00:00Z",
            closed_ts: "2026-08-08T11:00:00Z",
            session_id: "S1"
          }
        ]
      };
      assert(
        findViolations(snap).length > 0,
        "open obligation with closed_ts was accepted"
      );
    }
  },
  {
    name: "hostile/duplicate-json-key-in-sidecar",
    run: () => {
      const line = '{"format":"foreman-session-sidecar","format_version":2,"session_model_version":1,"next_ids":{"fact":1,"measurement":1,"obligation":1}}\n{"kind":"session","kind":"session","row":{}}\n';
      let threw = false;
      try {
        decodeSnapshot(line);
      } catch {
        threw = true;
      }
      assert(threw, "duplicate JSON key was accepted");
    }
  },
  {
    name: "hostile/crlf-line-endings",
    run: () => {
      let threw = false;
      try {
        decodeSnapshot(encodeSnapshot(emptySnapshot()).replace(/\n/g, "\r\n"));
      } catch {
        threw = true;
      }
      assert(threw, "CRLF sidecar was accepted");
    }
  },
  {
    name: "hostile/missing-trailing-newline",
    run: () => {
      let threw = false;
      try {
        decodeSnapshot(encodeSnapshot(emptySnapshot()).trimEnd());
      } catch {
        threw = true;
      }
      assert(threw, "sidecar without a trailing newline was accepted");
    }
  },
  {
    name: "hostile/unknown-entity-kind",
    run: () => {
      const text = '{"format":"foreman-session-sidecar","format_version":2,"session_model_version":1,"next_ids":{"fact":1,"measurement":1,"obligation":1}}\n{"kind":"wormhole","row":{}}\n';
      let threw = false;
      try {
        decodeSnapshot(text);
      } catch {
        threw = true;
      }
      assert(threw, "unknown entity kind was accepted");
    }
  }
];
var ALL_CASES = [...CASES, ...HOSTILE_CASES];
var STORE_CASES = ALL_CASES.filter(
  (c) => c.run.length > 0
);

// packages/orchestration/src/session-paths.ts
import { resolve } from "node:path";
function sidecarPathFor(p) {
  return p.replace(/\.db$/, ".ndjson");
}
function pathsAlias(left3, right3) {
  try {
    return resolve(left3) === resolve(right3);
  } catch {
    return false;
  }
}

// packages/orchestration/src/session-sqlite-bootstrap.ts
import fs2 from "node:fs";
var LegacyMigrationRefusal = class extends Error {
  constructor(message) {
    super(message);
    this.name = "LegacyMigrationRefusal";
  }
};
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function trackedSidecarCanRebuild(dbPath2) {
  const sidecar = sidecarPathFor(dbPath2);
  try {
    if (!fs2.existsSync(sidecar)) return true;
    decodeSnapshot(fs2.readFileSync(sidecar, "utf8"));
    return true;
  } catch {
    return false;
  }
}
function sidecarRebuildRemedy(dbPath2, asideSuffix) {
  const move = `mv ${dbPath2} ${dbPath2}.${asideSuffix} && fm-session recover`;
  if (trackedSidecarCanRebuild(dbPath2)) {
    return `Move it aside and rebuild from the tracked sidecar: ${move}`;
  }
  return `The tracked sidecar cannot be used to rebuild this store. Clear the sidecar fault, then: ${move}`;
}
function compactUtcTimestamp(date) {
  const pad = (n, width) => n.toString().padStart(width, "0");
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}T${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}Z`;
}
var BACKUP_SIDECARS = ["-wal", "-shm"];
var MAX_BACKUP_MOVE_ATTEMPTS = 100;
function fsErrorCode(e) {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = e.code;
    return typeof code === "string" ? code : void 0;
  }
  return void 0;
}
function pathOccupied(path) {
  try {
    fs2.lstatSync(path);
    return true;
  } catch (e) {
    if (fsErrorCode(e) === "ENOENT") return false;
    throw e;
  }
}
function sourceStatForValidation(path, statSource) {
  if (statSource !== void 0) {
    return statSource(path);
  }
  try {
    return fs2.lstatSync(path);
  } catch (e) {
    if (fsErrorCode(e) === "ENOENT") return null;
    throw e;
  }
}
function backupTripletOccupied(dest, occupied = pathOccupied) {
  if (occupied(dest)) return true;
  for (const suffix of BACKUP_SIDECARS) {
    if (occupied(dest + suffix)) return true;
  }
  return false;
}
function allocateCorruptBackupPath(dbPath2, stamp, startSuffix = 0, occupied = pathOccupied) {
  const base = `${dbPath2}.corrupt-${stamp}`;
  let n = startSuffix;
  for (; ; ) {
    const candidate = n === 0 ? base : `${base}-${n}`;
    if (!backupTripletOccupied(candidate, occupied)) {
      return { path: candidate, suffix: n };
    }
    n += 1;
  }
}
function unlinkCreated(paths) {
  for (const p of paths) {
    try {
      fs2.unlinkSync(p);
    } catch {
    }
  }
}
var BACKUP_TRIPLET_SUFFIXES = ["", ...BACKUP_SIDECARS];
function sameFileIdentity(a, b) {
  try {
    const sa = fs2.lstatSync(a);
    const sb = fs2.lstatSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}
function renameStoreAside(dbPath2, dest, opts = {}) {
  const created = [];
  const reservations = [];
  const linkedSources = [];
  try {
    for (const suffix of BACKUP_TRIPLET_SUFFIXES) {
      const src = dbPath2 + suffix;
      const dst = dest + suffix;
      if (pathOccupied(src)) {
        fs2.linkSync(src, dst);
        created.push(dst);
        linkedSources.push(src);
      } else {
        const fd = fs2.openSync(dst, "wx");
        created.push(dst);
        reservations.push(dst);
        fs2.closeSync(fd);
      }
    }
  } catch (e) {
    unlinkCreated(created);
    throw e;
  }
  opts.beforeUnlink?.();
  try {
    for (const suffix of BACKUP_TRIPLET_SUFFIXES) {
      const src = dbPath2 + suffix;
      const dst = dest + suffix;
      const wasLinked = linkedSources.includes(src);
      const srcStat = sourceStatForValidation(src, opts.statSource);
      if (srcStat !== null !== wasLinked) {
        throw new Error("source store changed during move");
      }
      if (wasLinked && !sameFileIdentity(src, dst)) {
        throw new Error("source store changed during move");
      }
    }
  } catch {
    unlinkCreated(created);
    throw new Error("source store changed during move");
  }
  for (const src of linkedSources) {
    fs2.unlinkSync(src);
  }
  opts.beforeCleanup?.(reservations);
  for (const reservation of reservations) {
    try {
      fs2.unlinkSync(reservation);
    } catch (e) {
      throw new Error(
        `backup cleanup failed at ${reservation}: ${fsErrorCode(e) ?? "unknown"}`
      );
    }
  }
}
function repairStore(dbPath2, opts = {}) {
  const shape = classifySqliteStore(dbPath2);
  if (shape !== "corrupt") {
    return { status: "healthy" };
  }
  const stamp = compactUtcTimestamp((opts.now ?? (() => /* @__PURE__ */ new Date()))());
  let renamedPath;
  let lastSuffix = -1;
  for (let attempt = 0; attempt < MAX_BACKUP_MOVE_ATTEMPTS; attempt++) {
    const allocated = allocateCorruptBackupPath(dbPath2, stamp, lastSuffix + 1);
    lastSuffix = allocated.suffix;
    const dest = allocated.path;
    try {
      opts.beforeMove?.(dest);
      renameStoreAside(dbPath2, dest, opts);
      renamedPath = dest;
      break;
    } catch (e) {
      const detail = errorMessage(e);
      if (detail === "source store changed during move") {
        return { status: "failed", renamedPath: dbPath2, detail };
      }
      if (detail.startsWith("backup cleanup failed at ")) {
        return { status: "failed", renamedPath: dest, detail };
      }
      if (fsErrorCode(e) !== "EEXIST") throw e;
    }
  }
  if (renamedPath === void 0) {
    return {
      status: "failed",
      renamedPath: dbPath2,
      detail: "could not allocate a free backup path without replacing an existing file"
    };
  }
  const sidecar = sidecarPathFor(dbPath2);
  try {
    const res = rebuildSqliteFromSidecar({
      sidecarPath: sidecar,
      dbPath: dbPath2,
      force: true
    });
    return { status: "repaired", renamedPath, rowsWritten: res.rowsWritten };
  } catch (e) {
    return { status: "failed", renamedPath, detail: errorMessage(e) };
  }
}
function rehydrateFromSidecarIfEmpty(p) {
  const sidecar = sidecarPathFor(p);
  if (pathsAlias(sidecar, p) || !fs2.existsSync(sidecar)) return;
  try {
    if (!sqliteStoreIsEmpty(p)) return;
  } catch {
    return;
  }
  try {
    const res = rebuildSqliteFromSidecar({ sidecarPath: sidecar, dbPath: p, force: true });
    process.stderr.write(
      `rehydrated ${res.rowsWritten} row(s) from ${sidecar} (the .db is a derived cache; the sidecar is what git tracks)
`
    );
  } catch (e) {
    process.stderr.write(
      `refusing: the session store is empty and the tracked sidecar at ${sidecar} could not be read: ${errorMessage(e)}
`
    );
    throw new LegacyMigrationRefusal(errorMessage(e));
  }
}
function bootstrapStore(p, opts) {
  const shape = classifySqliteStore(p);
  if (shape === "corrupt") {
    process.stderr.write(
      `refusing: the session store at ${p} is corrupt: it carries both the legacy and port schemas, or identity counters behind its own rows. It is the half-migrated state a pre-fix open produced. run: node skills/foreman/runtime/dist/fm-session.js repair. ${sidecarRebuildRemedy(p, "corrupt")}
`
    );
    process.exit(2);
  }
  if (shape === "unrecognised") {
    process.stderr.write(
      `refusing: the session store at ${p} exists but is not a Foreman session database. This tool will not write into a file it does not recognise. ${sidecarRebuildRemedy(p, "unrecognised")}
`
    );
    throw new LegacyMigrationRefusal(`unrecognised session store at ${p}`);
  }
  if (shape === "legacy") {
    if (!opts.allowMigration) {
      process.stderr.write(
        `refusing: the session store at ${p} is in the pre-port schema and this is a read-only command. Run a write command, or \`fm-session import-sidecar\`, to migrate it.
`
      );
      process.exit(2);
    }
    const carrier = `${p}.legacy.ndjson`;
    try {
      const dumped = dumpLegacySqliteAsV1(p);
      if (!dumped.ok) {
        throw new LegacyMigrationRefusal(
          `legacy store is missing declared table ${dumped.table}; refusing a lossy dump that would recreate it empty. Move it aside and rebuild from the tracked sidecar: mv ${p} ${p}.unmigratable && fm-session recover`
        );
      }
      fs2.writeFileSync(carrier, dumped.text, { encoding: "utf8" });
      const res = rebuildSqliteFromSidecar({ sidecarPath: carrier, dbPath: p, force: true });
      process.stderr.write(`migrated ${res.rowsWritten} row(s) out of the legacy session schema into ${p}
`);
    } catch (e) {
      process.stderr.write(
        `refusing: the legacy session store at ${p} could not be migrated to the port schema: ${errorMessage(e)}
`
      );
      throw new LegacyMigrationRefusal(errorMessage(e));
    } finally {
      fs2.rmSync(carrier, { force: true });
    }
    rehydrateFromSidecarIfEmpty(p);
    return true;
  }
  if (shape === "absent") {
    if (opts.requireSessionSource === true) {
      const sidecar = sidecarPathFor(p);
      if (!fs2.existsSync(sidecar)) {
        process.stderr.write(
          `refusing: no_session_source (neither ${p} nor ${sidecar} exists)
`
        );
        throw new LegacyMigrationRefusal("no_session_source");
      }
    }
    if (fs2.existsSync(p)) {
      process.stderr.write(
        `refusing: the session store at ${p} exists but is not a Foreman session database. This tool will not write into a file it does not recognise. ${sidecarRebuildRemedy(p, "unrecognised")}
`
      );
      throw new LegacyMigrationRefusal(`unrecognised session store at ${p}`);
    }
    openSqliteSessionStore({ path: p }).close();
    try {
      rehydrateFromSidecarIfEmpty(p);
    } catch (e) {
      try {
        for (const suffix of ["", "-wal", "-shm"]) {
          fs2.rmSync(p + suffix, { force: true });
        }
      } catch {
      }
      throw e;
    }
    return false;
  }
  if (!opts.readOnly) {
    rehydrateFromSidecarIfEmpty(p);
  }
  return false;
}

// packages/orchestration/src/project-registry.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import {
  closeSync as closeSync2,
  constants,
  fstatSync,
  fsyncSync as fsyncSync2,
  lstatSync,
  openSync as openSync2,
  readSync,
  renameSync as renameSync3,
  unlinkSync as unlinkSync2,
  writeSync as writeSync2
} from "node:fs";
import { basename, dirname as dirname2, isAbsolute, join as join5 } from "node:path";
var ONE_MIB = 1048576;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var CONTROL = /[\u0000-\u001f\u007f]/;
var REGISTRY_KEYS = ["generation", "projects", "schema"];
var PROJECT_KEYS = [
  "generation",
  "git_common_dir",
  "operation_id",
  "project_id",
  "state",
  "store_backend",
  "store_location",
  "worktree_paths"
];
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasExactOwnKeys(value, keys5) {
  const own = Object.keys(value);
  return own.length === keys5.length && keys5.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function validUuid(value) {
  return typeof value === "string" && UUID.test(value);
}
function validAbsolutePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !CONTROL.test(value) && isAbsolute(value);
}
function validSafeInteger(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}
function compareUtf8(left3, right3) {
  return Buffer.from(left3).compare(Buffer.from(right3));
}
function parseProject(value) {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, PROJECT_KEYS)) {
    return null;
  }
  if (!validUuid(value["project_id"]) || !validUuid(value["operation_id"])) {
    return null;
  }
  if (!validSafeInteger(value["generation"], 1)) return null;
  if (!validAbsolutePath(value["git_common_dir"])) return null;
  if (!validAbsolutePath(value["store_location"])) return null;
  if (value["store_backend"] !== "sqlite" && value["store_backend"] !== "files-only") {
    return null;
  }
  if (value["state"] !== "active" && value["state"] !== "missing" && value["state"] !== "conflicted") {
    return null;
  }
  const worktreePaths = value["worktree_paths"];
  if (!Array.isArray(worktreePaths) || worktreePaths.length === 0) return null;
  const paths = [];
  let previous;
  for (const path of worktreePaths) {
    if (!validAbsolutePath(path)) return null;
    if (previous !== void 0 && compareUtf8(previous, path) >= 0) return null;
    paths.push(path);
    previous = path;
  }
  return {
    project_id: value["project_id"],
    operation_id: value["operation_id"],
    generation: value["generation"],
    git_common_dir: value["git_common_dir"],
    worktree_paths: paths,
    store_backend: value["store_backend"],
    store_location: value["store_location"],
    state: value["state"]
  };
}
function parseRegistry(value) {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, REGISTRY_KEYS)) {
    return null;
  }
  if (value["schema"] !== "foreman.project-registry.v1") return null;
  if (!validSafeInteger(value["generation"], 0)) return null;
  if (!Array.isArray(value["projects"])) return null;
  if (value["projects"].length > 1e4) return null;
  const projects = [];
  const ids3 = /* @__PURE__ */ new Set();
  const commonDirs = /* @__PURE__ */ new Set();
  const stores = /* @__PURE__ */ new Set();
  let previousId;
  for (const item of value["projects"]) {
    const project = parseProject(item);
    if (project === null || project.generation > value["generation"]) return null;
    if (ids3.has(project.project_id) || commonDirs.has(project.git_common_dir) || stores.has(project.store_location)) {
      return null;
    }
    if (previousId !== void 0 && compareUtf8(previousId, project.project_id) >= 0) {
      return null;
    }
    ids3.add(project.project_id);
    commonDirs.add(project.git_common_dir);
    stores.add(project.store_location);
    projects.push(project);
    previousId = project.project_id;
  }
  if (projects.length === 0 && value["generation"] !== 0) return null;
  if (projects.length > 0 && value["generation"] === 0) return null;
  return {
    schema: "foreman.project-registry.v1",
    generation: value["generation"],
    projects
  };
}
function emptyProjectRegistryV1() {
  return {
    schema: "foreman.project-registry.v1",
    generation: 0,
    projects: []
  };
}
function renderProjectRegistryFileV1(registry) {
  const parsed = parseRegistry(registry);
  if (parsed === null) throw new Error("invalid project registry");
  return new TextEncoder().encode(`${canonicalize(parsed)}
`);
}
function decodeProjectRegistryFileV1(bytes) {
  try {
    if (bytes.byteLength > ONE_MIB) return { _tag: "Invalid" };
    const text = decodeUtf8Fatal(bytes);
    if (isCoreFailure(text)) return { _tag: "Invalid" };
    if (!text.endsWith("\n") || text.endsWith("\n\n")) {
      return { _tag: "Invalid" };
    }
    const body = text.slice(0, -1);
    const decoded = parseJsonRejectDuplicateKeys(body);
    if (isCoreFailure(decoded)) return { _tag: "Invalid" };
    if (canonicalize(decoded) !== body) return { _tag: "Invalid" };
    const value = parseRegistry(decoded);
    return value === null ? { _tag: "Invalid" } : { _tag: "Valid", value };
  } catch {
    return { _tag: "Invalid" };
  }
}
function validRegistrationInput(input) {
  return validUuid(input.project_id) && validUuid(input.operation_id) && validAbsolutePath(input.git_common_dir) && validAbsolutePath(input.worktree_path) && validAbsolutePath(input.store_location) && (input.store_backend === "sqlite" || input.store_backend === "files-only");
}
function registerProjectV1(registry, input) {
  const current = parseRegistry(registry);
  if (current === null || !validRegistrationInput(input)) {
    return { _tag: "Refused", reason: "invalid_input" };
  }
  const commonMatch = current.projects.find(
    (project2) => project2.git_common_dir === input.git_common_dir
  );
  const storeMatch = current.projects.find(
    (project2) => project2.store_location === input.store_location
  );
  if (commonMatch !== void 0 || storeMatch !== void 0) {
    if (commonMatch === void 0 || commonMatch !== storeMatch) {
      return { _tag: "Refused", reason: "binding_conflict" };
    }
    const worktrees = [...commonMatch.worktree_paths];
    if (worktrees.includes(input.worktree_path)) {
      return {
        _tag: "Registered",
        registry: current,
        project: commonMatch,
        changed: false
      };
    }
    worktrees.push(input.worktree_path);
    worktrees.sort(compareUtf8);
    const project2 = {
      ...commonMatch,
      generation: commonMatch.generation + 1,
      worktree_paths: worktrees
    };
    const projects2 = current.projects.map(
      (item) => item.project_id === project2.project_id ? project2 : item
    ).sort((left3, right3) => compareUtf8(left3.project_id, right3.project_id));
    return {
      _tag: "Registered",
      registry: { ...current, generation: current.generation + 1, projects: projects2 },
      project: project2,
      changed: true
    };
  }
  if (current.projects.some(
    (project2) => project2.project_id === input.project_id || project2.operation_id === input.operation_id
  )) {
    return { _tag: "Refused", reason: "binding_conflict" };
  }
  const project = {
    project_id: input.project_id,
    operation_id: input.operation_id,
    generation: 1,
    git_common_dir: input.git_common_dir,
    worktree_paths: [input.worktree_path],
    store_backend: input.store_backend,
    store_location: input.store_location,
    state: "active"
  };
  const projects = [...current.projects, project].sort(
    (left3, right3) => compareUtf8(left3.project_id, right3.project_id)
  );
  return {
    _tag: "Registered",
    registry: { ...current, generation: current.generation + 1, projects },
    project,
    changed: true
  };
}
function resolveProjectV1(registry, input) {
  const current = parseRegistry(registry);
  if (current === null) return null;
  return current.projects.find(
    (project) => project.state === "active" && project.git_common_dir === input.git_common_dir && project.store_location === input.store_location
  ) ?? null;
}
function isEnoent(error) {
  return error !== null && typeof error === "object" && error.code === "ENOENT";
}
function sameIdentity(left3, right3) {
  return left3.dev === right3.dev && left3.ino === right3.ino;
}
function readRegistryFile(path) {
  let pathStat;
  try {
    pathStat = lstatSync(path);
  } catch (error) {
    if (isEnoent(error)) {
      return {
        _tag: "Read",
        registry: emptyProjectRegistryV1(),
        identity: null
      };
    }
    return { _tag: "Refused", reason: "io_failure" };
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
    return { _tag: "Refused", reason: "unsafe_path" };
  }
  if (pathStat.size > ONE_MIB) {
    return { _tag: "Refused", reason: "invalid_registry" };
  }
  let fd;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    fd = openSync2(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > ONE_MIB || !sameIdentity(pathStat, opened)) {
      return { _tag: "Refused", reason: "unsafe_path" };
    }
    const buffer = Buffer.alloc(ONE_MIB + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(fd, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const afterOpen = fstatSync(fd);
    const afterPath = lstatSync(path);
    if (offset > ONE_MIB || afterPath.isSymbolicLink() || !afterPath.isFile() || afterPath.nlink !== 1 || !sameIdentity(opened, afterOpen) || !sameIdentity(opened, afterPath) || afterOpen.size !== offset) {
      return { _tag: "Refused", reason: "unsafe_path" };
    }
    const decoded = decodeProjectRegistryFileV1(
      Uint8Array.from(buffer.subarray(0, offset))
    );
    return decoded._tag === "Valid" ? { _tag: "Read", registry: decoded.value, identity: afterPath } : { _tag: "Refused", reason: "invalid_registry" };
  } catch (error) {
    return {
      _tag: "Refused",
      reason: isEnoent(error) ? "unsafe_path" : "io_failure"
    };
  } finally {
    if (fd !== void 0) closeSync2(fd);
  }
}
function loadProjectRegistryFileV1(registryPath) {
  if (!validAbsolutePath(registryPath)) {
    return { _tag: "Invalid", reason: "unsafe_path" };
  }
  const read = readRegistryFile(registryPath);
  return read._tag === "Read" ? { _tag: "Valid", value: read.registry } : { _tag: "Invalid", reason: read.reason };
}
function targetUnchanged(path, before2) {
  try {
    const after3 = lstatSync(path);
    return before2 !== null && !after3.isSymbolicLink() && after3.isFile() && after3.nlink === 1 && sameIdentity(before2, after3);
  } catch (error) {
    return before2 === null && isEnoent(error);
  }
}
function publishRegistryFile(path, bytes, before2) {
  const parent = dirname2(path);
  let parentStat;
  try {
    parentStat = lstatSync(parent);
  } catch {
    return "io_failure";
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    return "unsafe_path";
  }
  const temporary = join5(
    parent,
    `.${basename(path)}.${process.pid}.${randomBytes2(6).toString("hex")}.tmp`
  );
  let fd;
  let published = false;
  try {
    fd = openSync2(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      384
    );
    let offset = 0;
    while (offset < bytes.byteLength) {
      offset += writeSync2(fd, bytes, offset, bytes.byteLength - offset);
    }
    fsyncSync2(fd);
    closeSync2(fd);
    fd = void 0;
    if (!targetUnchanged(path, before2)) return "unsafe_path";
    renameSync3(temporary, path);
    published = true;
    const parentFd = openSync2(parent, constants.O_RDONLY);
    try {
      fsyncSync2(parentFd);
    } finally {
      closeSync2(parentFd);
    }
    return "ok";
  } catch {
    return "io_failure";
  } finally {
    if (fd !== void 0) closeSync2(fd);
    if (!published) {
      try {
        unlinkSync2(temporary);
      } catch {
      }
    }
  }
}
function registerProjectFileV1(registryPath, input) {
  if (!validAbsolutePath(registryPath)) {
    return { _tag: "Refused", reason: "invalid_input" };
  }
  const read = readRegistryFile(registryPath);
  if (read._tag === "Refused") return read;
  const registered = registerProjectV1(read.registry, input);
  if (registered._tag === "Refused") return registered;
  if (!registered.changed) return registered;
  const published = publishRegistryFile(
    registryPath,
    renderProjectRegistryFileV1(registered.registry),
    read.identity
  );
  return published === "ok" ? registered : { _tag: "Refused", reason: published };
}

// packages/orchestration/src/fm-session-main.ts
var READ_ONLY_CMDS = /* @__PURE__ */ new Set(["recover", "freshness", "sidecar"]);
var NO_SIDECAR_REFRESH_CMDS = /* @__PURE__ */ new Set(["sync", "project", "repair"]);
var STORE_CMDS = /* @__PURE__ */ new Set([
  "begin",
  "recover",
  "repair",
  "freshness",
  "end",
  "fact",
  "measure",
  "obligation",
  "close",
  "sidecar",
  "import-sidecar",
  "supersede",
  "retire",
  "sync",
  "project"
]);
var syncTestDeps;
function setSyncTestDeps(deps) {
  syncTestDeps = deps;
}
var SYNC_ALLOWED_OPTIONS = /* @__PURE__ */ new Set([
  "batch",
  "max-attempts",
  "timeout-ms",
  "max-batches"
]);
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function repoRoot() {
  try {
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8"
    }).trim();
    return dirname3(resolve2(out));
  } catch {
    return process.cwd();
  }
}
function gitSha(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8"
    }).trim();
  } catch {
    return null;
  }
}
function warnOrphanStore(chosen) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (!top) return;
    const orphan = resolve2(top, ".foreman", "session.db");
    if (orphan === resolve2(chosen) || !existsSync3(orphan)) return;
    process.stderr.write(
      `WARNING: an orphaned session store sits at ${orphan}. Nothing reads it. The store in use is ${chosen}.
`
    );
  } catch {
  }
}
function dbPath() {
  if (process.env["FOREMAN_SESSION_DB"]) return process.env["FOREMAN_SESSION_DB"];
  const chosen = join6(repoRoot(), ".foreman", "session.db");
  warnOrphanStore(chosen);
  return chosen;
}
function projectRegistryPath() {
  const configured = process.env["FOREMAN_HOME"];
  const home = configured && configured.length > 0 ? configured : join6(homedir(), ".foreman");
  return isAbsolute2(home) ? join6(home, "projects.json") : null;
}
function ensureProjectRegistryParent(path) {
  const parent = dirname3(path);
  try {
    if (!existsSync3(parent)) mkdirSync3(parent, { recursive: true, mode: 448 });
    const stat = lstatSync2(parent);
    return !stat.isSymbolicLink() && stat.isDirectory();
  } catch {
    return false;
  }
}
function gitProjectIdentityAt(cwd) {
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8" }
    ).trim();
    const worktree = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8"
    }).trim();
    if (!isAbsolute2(common) || !isAbsolute2(worktree)) return null;
    return {
      gitCommonDir: realpathSync(common),
      worktreePath: realpathSync(worktree)
    };
  } catch {
    return null;
  }
}
function currentGitProjectIdentity() {
  return gitProjectIdentityAt(process.cwd());
}
function recoveryGitCwd(selection) {
  let storeLocation;
  try {
    storeLocation = realpathSync(selection.location);
  } catch {
    return null;
  }
  const registryPath = projectRegistryPath();
  if (registryPath !== null) {
    const loaded = loadProjectRegistryFileV1(registryPath);
    if (loaded._tag === "Invalid") return null;
    const registered = loaded.value.projects.find(
      (project) => project.state === "active" && project.store_location === storeLocation
    );
    if (registered !== void 0) {
      for (const recordedWorktree of registered.worktree_paths) {
        const identity2 = gitProjectIdentityAt(recordedWorktree);
        if (identity2 !== null && identity2.gitCommonDir === registered.git_common_dir && identity2.worktreePath === recordedWorktree) {
          return identity2.worktreePath;
        }
      }
      return null;
    }
  }
  const current = currentGitProjectIdentity();
  return current?.worktreePath ?? null;
}
function writeCanonicalLine(value) {
  process.stdout.write(`${canonicalize(value)}
`);
}
function errorMessage2(e) {
  return e instanceof Error ? e.message : String(e);
}
function defaultSidecarPath(selection) {
  if (selection.locationKind === "file") return sidecarPathFor(selection.location);
  return join6(selection.location, "session.ndjson");
}
function openCliStore(opts = {}) {
  const readOnly = opts.readOnly === true;
  let selection;
  let migrated = false;
  let store;
  try {
    store = openSessionStore({
      readOnly,
      defaultSqlitePath: dbPath,
      onSelected: (sel) => {
        selection = sel;
      },
      prepareSqlite: (path, access) => {
        mkdirSync3(dirname3(path), { recursive: true });
        migrated = bootstrapStore(path, {
          allowMigration: access.allowMigration,
          readOnly: access.readOnly,
          requireSessionSource: opts.requireSessionSource === true
        });
      }
    });
  } catch (e) {
    if (e instanceof CliRefusal) throw e;
    if (e instanceof LegacyMigrationRefusal) {
      exitCli(2);
    }
    if (e instanceof SessionStoreError || reasonOf(e) === "backend_misconfiguration") {
      process.stderr.write(`refusing: ${errorMessage2(e)}
`);
      exitCli(2);
    }
    const failedPath = selection?.location ?? dbPath();
    if (isSqliteOperationalError(e) && (parentDirNotWritable(failedPath) || pathNotReadable(failedPath))) {
      process.stderr.write(`EACCES: permission denied, open '${failedPath}'
`);
      exitCli(1);
    }
    if (isSqliteOperationalError(e)) {
      process.stderr.write(`sqlite3.OperationalError
`);
      exitCli(1);
    }
    process.stderr.write(`${errorMessage2(e)}
`);
    exitCli(1);
  }
  if (selection === void 0) {
    store.close();
    process.stderr.write("refusing: session store opened without a selection\n");
    exitCli(2);
  }
  if (migrated) {
    try {
      persistSidecarAfterMigration(store, selection);
    } catch (e) {
      store.close();
      throw e;
    }
  }
  return { store, selection };
}
function openExplicitSqliteImportTarget(target) {
  try {
    let migrated = false;
    const store = openSqliteSessionStore({
      path: target,
      prepareSqlite: (path, access) => {
        mkdirSync3(dirname3(path), { recursive: true });
        migrated = bootstrapStore(path, access);
      }
    });
    if (migrated) {
      try {
        persistSidecarAfterMigration(store, {
          location: target,
          locationKind: "file"
        });
      } catch (e) {
        store.close();
        throw e;
      }
    }
    return store;
  } catch (e) {
    if (e instanceof CliRefusal) throw e;
    const message = errorMessage2(e);
    const msg = message.includes("unable to open database file") ? "sqlite3.OperationalError" : message;
    process.stderr.write(`refusing: cannot open target store: ${msg}
`);
    exitCli(2);
  }
}
function currentSessionId(store) {
  return store.currentSession()?.session_id ?? null;
}
var CliRefusal = class extends Error {
  exitCode;
  constructor(exitCode) {
    super(`cli refusal ${exitCode}`);
    this.name = "CliRefusal";
    this.exitCode = exitCode;
  }
};
function exitCli(code) {
  throw new CliRefusal(code);
}
function isSqliteOperationalError(e) {
  return typeof e === "object" && e !== null && e.code === "ERR_SQLITE_ERROR";
}
function parentDirNotWritable(dbFile) {
  try {
    accessSync(dirname3(dbFile), constants2.W_OK);
    return false;
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    return code === "EACCES" || code === "EPERM";
  }
}
function pathNotReadable(file) {
  try {
    accessSync(file, constants2.R_OK);
    return false;
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    return code === "EACCES" || code === "EPERM";
  }
}
function requirePositional(args2, index, label) {
  const value = args2[index];
  if (value === void 0) {
    process.stderr.write(`refusing: missing ${label}
`);
    exitCli(2);
  }
  return value;
}
function refuseFromPort(e, legacyMessage, expectedReasons) {
  const reason = reasonOf(e);
  if (isSessionStoreFailure(e) || reason !== null) {
    if (expectedReasons === void 0 || reason !== null && expectedReasons.includes(reason)) {
      process.stderr.write(legacyMessage);
    } else {
      process.stderr.write(`refusing: ${errorMessage2(e)}
`);
    }
    exitCli(2);
  }
  throw e;
}
function scalarOf(text) {
  const match12 = text.match(/^\s*(-?\d+(?:\.\d+)?)/);
  const captured = match12?.[1];
  return captured === void 0 ? null : parseFloat(captured);
}
function mintSessionId() {
  const d = /* @__PURE__ */ new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min4 = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const hex = randomBytes3(3).toString("hex");
  return `${yyyy}${mm}${dd}T${hh}${min4}${ss}Z-${hex}`;
}
function measurementValidity(measuredSha, scopePaths, gitCwd) {
  if (!measuredSha) return ["unknown", "no measured_sha recorded"];
  const paths = (scopePaths || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (paths.length === 0) return ["unknown", "no scope_paths recorded; cannot bound what invalidates it"];
  if (gitCwd === null) {
    return ["unknown", "registered project repository is unavailable"];
  }
  try {
    const out = execFileSync("git", ["rev-list", `${measuredSha}..HEAD`, "--", ...paths], {
      cwd: gitCwd,
      encoding: "utf8"
    });
    const commits = out.split("\n").map((s) => s.trim()).filter(Boolean);
    if (commits.length > 0) {
      return ["stale", `${commits.length} commit(s) touched its scope since measurement`];
    }
    return ["fresh", "no commit has touched its scope since measurement"];
  } catch (e) {
    const err = e;
    const stderrRaw = err.stderr;
    const stderr = typeof stderrRaw === "string" ? stderrRaw : stderrRaw instanceof Uint8Array ? Buffer.from(stderrRaw).toString("utf8") : "";
    const message = typeof err.message === "string" ? err.message : String(e);
    const name = typeof err.name === "string" ? err.name : "Error";
    const errStr = (stderr || message).trim().substring(0, 80);
    if (stderr) {
      return ["unknown", `git rev-list failed: ${errStr}`];
    }
    return ["unknown", `${name}: ${message}`];
  }
}
function displayStatus(o) {
  return o.status === "open" && o.blocker ? "blocked" : o.status;
}
function buildRecoveryFromStore(store, gitCwd) {
  const head5 = gitCwd === null ? null : gitSha(gitCwd);
  const sessions = [...store.listSessions()].sort(
    (a, b) => a.session_id < b.session_id ? 1 : a.session_id > b.session_id ? -1 : 0
  );
  const sess = sessions[0] ?? null;
  const facts = [...store.listFacts()].filter((r) => r.superseded_by === null).sort((a, b) => b.id - a.id).map((r) => ({
    kind: "fact",
    id: r.id,
    statement: r.statement,
    evidence: r.evidence,
    established_ts: r.established_ts
  }));
  const measurements = [...store.listMeasurements()].filter((r) => r.superseded_by === null).sort((a, b) => b.id - a.id).map((r) => {
    const [validity, why] = measurementValidity(
      r.measured_sha,
      r.scope_paths,
      gitCwd
    );
    return {
      kind: "measurement",
      id: r.id,
      metric: r.metric,
      value: r.value,
      command: r.command,
      measured_ts: r.measured_ts,
      measured_sha: (r.measured_sha || "").substring(0, 12),
      scope_paths: (r.scope_paths || "").split("\n").filter(Boolean),
      validity,
      validity_reason: why
    };
  });
  const obligations = [...store.listObligations()].filter((r) => r.status !== "done").map((r) => ({
    kind: "obligation",
    id: r.id,
    statement: r.statement,
    status: displayStatus(r),
    blocker: r.blocker,
    opened_ts: r.opened_ts
  }));
  const obligationRank = (o) => {
    if (o.status === "open" && !o.blocker) return 0;
    if (o.status === "open" || o.status === "blocked") return 1;
    return 2;
  };
  obligations.sort((a, b) => {
    const ra = obligationRank(a);
    const rb = obligationRank(b);
    if (ra !== rb) return ra - rb;
    return b.id - a.id;
  });
  return {
    recovered_at: nowIso(),
    head_sha: (head5 || "").substring(0, 12),
    last_session: sess,
    facts,
    measurements,
    obligations,
    counts: {
      facts: facts.length,
      measurements_fresh: measurements.filter((m) => m.validity === "fresh").length,
      measurements_stale: measurements.filter((m) => m.validity === "stale").length,
      measurements_unknown: measurements.filter((m) => m.validity === "unknown").length,
      obligations_open: obligations.filter((o) => o.status === "open").length,
      obligations_blocked: obligations.filter((o) => o.status === "blocked").length
    }
  };
}
function buildFreshnessFromStore(store, staleOnly, gitCwd) {
  const out = [];
  const rows = [...store.listMeasurements()].filter((r) => r.superseded_by === null).sort((a, b) => b.id - a.id);
  for (const row of rows) {
    const [validity, why] = measurementValidity(
      row.measured_sha,
      row.scope_paths,
      gitCwd
    );
    if (staleOnly && validity === "fresh") continue;
    out.push({
      id: row.id,
      metric: row.metric,
      value: row.value,
      verdict: validity === "stale" ? "STALE" : validity,
      reason: why,
      command: row.command || "(no command recorded)",
      scope: (row.scope_paths || "").split("\n").filter(Boolean).join(","),
      sha: row.measured_sha || "",
      timestamp: row.measured_ts
    });
  }
  return out;
}
function renderFreshness(measurements, outputFormat) {
  const columns = ["id", "metric", "value", "verdict", "reason", "command", "scope", "sha", "timestamp"];
  if (outputFormat === "tsv") {
    const lines = [columns.join("	")];
    for (const m of measurements) {
      lines.push(columns.map((c) => String(m[c])).join("	"));
    }
    return lines.join("\n");
  }
  return measurements.map(
    (m) => `[${m.id}] ${m.metric} = ${m.value}  verdict=${m.verdict}  reason=${m.reason}  command=${m.command}  scope=${m.scope}  sha=${m.sha}  timestamp=${m.timestamp}`
  ).join("\n");
}
function render2(rec) {
  const lines = [];
  const A = (s) => lines.push(s);
  A(`FOREMAN RECOVERY  head=${rec.head_sha}  at=${rec.recovered_at}`);
  const ls = rec.last_session;
  if (ls) {
    A(
      `last session: ${ls.session_id}  started=${ls.started_ts}  start_sha=${(ls.start_sha || "").substring(0, 12)}  ${ls.ended_ts ? "ENDED " + ls.ended_ts : "NOT ENDED"}`
    );
    if (ls.note) {
      A(`  note: ${ls.note}`);
    }
  } else {
    A("last session: (none \u2014 this is the first)");
  }
  const c = rec.counts;
  A("");
  A(`FACTS (${c.facts}) \u2014 durable, true by construction`);
  const FACT_LIMIT = 20;
  const factsShown = rec.facts.slice(0, FACT_LIMIT);
  for (const f of factsShown) {
    A(`  [${f.id}] ${f.statement}`);
    if (f.evidence) A(`       evidence: ${f.evidence}`);
  }
  const factsHidden = rec.facts.length - factsShown.length;
  if (factsHidden > 0) {
    A(`  ... ${factsHidden} more fact(s) not shown. Run: fm-session recover --json`);
  }
  A("");
  A(`MEASUREMENTS \u2014 fresh=${c.measurements_fresh} STALE=${c.measurements_stale} unknown=${c.measurements_unknown}`);
  const MEASUREMENT_LIMIT = 20;
  const measurementsShown = rec.measurements.slice(0, MEASUREMENT_LIMIT);
  const markFor = { fresh: "OK   ", stale: "STALE", unknown: "?    " };
  for (const m of measurementsShown) {
    A(`  ${markFor[m.validity]} [${m.id}] ${m.metric} = ${m.value}`);
    A(`       ${m.validity_reason}  (measured ${m.measured_ts} @ ${m.measured_sha})`);
    if (m.validity !== "fresh" && m.command) {
      A(`       re-run: ${m.command}`);
    }
  }
  const measurementsHidden = rec.measurements.length - measurementsShown.length;
  if (measurementsHidden > 0) {
    A(`  ... ${measurementsHidden} more measurement(s) not shown. Run: fm-session recover --json`);
  }
  A("");
  A(`OBLIGATIONS \u2014 open=${c.obligations_open} blocked=${c.obligations_blocked}`);
  const OBLIGATION_LIMIT = 20;
  const obligationsShown = rec.obligations.slice(0, OBLIGATION_LIMIT);
  for (const o of obligationsShown) {
    A(`  [${o.id}] (${o.status}) ${o.statement}`);
    if (o.blocker) A(`       blocked by: ${o.blocker}`);
  }
  const obligationsHidden = rec.obligations.length - obligationsShown.length;
  if (obligationsHidden > 0) {
    A(`  ... ${obligationsHidden} more obligation(s) not shown. Run: fm-session recover --json`);
  }
  A("");
  const stale = c.measurements_stale + c.measurements_unknown;
  const live = rec.measurements.length;
  if (stale > 0) {
    A(
      `LAUNCH POINT: ${stale} measurement(s) are not fresh \u2014 re-run them before quoting any of their numbers. Then work the open obligations above.`
    );
  } else if (live === 0) {
    A(
      "LAUNCH POINT: no measurement is recorded, so nothing here is measured. Measure before you quote a number. Then work the open obligations above."
    );
  } else {
    A("LAUNCH POINT: every measurement is fresh. Work the open obligations above.");
  }
  return lines.join("\n");
}
function sidecarNdjson(store) {
  const snapshot = store.snapshot();
  return [encodeSnapshot(snapshot), countRows(snapshot)];
}
function writeAtomic(path, text) {
  const tmp = `${path}.tmp.${process.pid}.${randomBytes3(8).toString("hex")}`;
  try {
    writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
    const fd = openSync3(tmp, "r+");
    try {
      fsyncSync3(fd);
    } finally {
      closeSync3(fd);
    }
    renameSync4(tmp, path);
  } catch (e) {
    try {
      rmSync3(tmp, { force: true });
    } catch {
    }
    throw e;
  }
  try {
    const dirFd = openSync3(dirname3(path), "r");
    try {
      fsyncSync3(dirFd);
    } finally {
      closeSync3(dirFd);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `WARNING: sidecar published, durability flush failed (${msg}). The tracked record is complete.
`
    );
  }
}
var SidecarReplaceRefused = class extends Error {
  kind;
  constructor(message, kind) {
    super(message);
    this.name = "SidecarReplaceRefused";
    this.kind = kind;
  }
};
function identityToken(kind, row, fields) {
  return `${kind}	${fields.map((f) => String(row[f] ?? "")).join("	")}`;
}
function identityTokens(snapshot) {
  const tokens = [];
  for (const kind of ENTITY_ORDER) {
    const fields = specFor(kind).identity;
    for (const row of rowsOfKind(snapshot, kind)) {
      tokens.push(identityToken(kind, row, fields));
    }
  }
  tokens.sort();
  return tokens;
}
function identityDigest(tokens) {
  return createHash("sha256").update(tokens.join("\n"), "utf8").digest("hex");
}
function assessSidecarReplace(oldSnap, newSnap) {
  const oldTokens = identityTokens(oldSnap);
  const newTokens = identityTokens(newSnap);
  const newSet = new Set(newTokens);
  const lostIdentities = oldTokens.filter((t) => !newSet.has(t));
  const kindShrinks = [];
  for (const kind of ENTITY_ORDER) {
    const oldN = rowsOfKind(oldSnap, kind).length;
    const newN = rowsOfKind(newSnap, kind).length;
    if (newN < oldN) kindShrinks.push(`${kind}:${oldN}->${newN}`);
  }
  if (kindShrinks.length === 0 && lostIdentities.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    oldCount: countRows(oldSnap),
    newCount: countRows(newSnap),
    oldDigest: identityDigest(oldTokens),
    newDigest: identityDigest(newTokens),
    kindShrinks,
    lostIdentities
  };
}
function sidecarDumpElsewhereRemedy() {
  return "Dump the store to a new file with `fm-session sidecar --out <fresh-path>`.";
}
function sidecarReplaceMessage(path, verdict) {
  const kinds = verdict.kindShrinks.length > 0 ? ` kinds ${verdict.kindShrinks.join(",")}` : "";
  const lost = verdict.lostIdentities.length > 0 ? ` missing ${verdict.lostIdentities.length} identit${verdict.lostIdentities.length === 1 ? "y" : "ies"}` : "";
  return `refusing: existing sidecar ${path} has ${verdict.oldCount} row(s); refusing to replace it with ${verdict.newCount} row(s)${kinds}${lost} (identity-scoped ${verdict.oldDigest.slice(0, 12)} -> ${verdict.newDigest.slice(0, 12)}). Run \`fm-session sidecar --force\` to dump the store over this file, or \`fm-session import-sidecar ${path} --force\` to restore this file into the store.
`;
}
function unreadSidecarMessage(path, detail) {
  return `refusing: existing sidecar ${path} could not be read: ${detail}. Refusing to replace a sidecar whose contents could not be established. ${sidecarDumpElsewhereRemedy()}
`;
}
function unparsedSidecarMessage(path, detail) {
  return `refusing: existing sidecar ${path} could not be parsed: ${detail}. Refusing to replace a sidecar whose contents could not be established. ${sidecarDumpElsewhereRemedy()}
`;
}
function inspectSidecarPath(path) {
  let st;
  try {
    st = lstatSync2(path);
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    if (code === "ENOENT") return { dest: path, kind: "missing" };
    throw e;
  }
  if (st.isSymbolicLink()) {
    let resolved;
    try {
      resolved = realpathSync(path);
    } catch {
      return { dest: path, kind: "unreadable" };
    }
    return inspectSidecarPath(resolved);
  }
  if (st.isFile()) return { dest: path, kind: "regular" };
  if (st.isDirectory()) return { dest: path, kind: "directory" };
  return { dest: path, kind: "unreadable" };
}
function writeSidecar(path, text, opts = {}) {
  const inspected = inspectSidecarPath(path);
  if (inspected.kind === "unreadable") {
    throw new SidecarReplaceRefused(unreadSidecarMessage(path, "not a regular file"), "unread");
  }
  const dest = inspected.dest;
  if (inspected.kind === "regular") {
    let raw;
    try {
      raw = readFileSync3(dest, "utf8");
    } catch (e) {
      throw new SidecarReplaceRefused(unreadSidecarMessage(path, errorMessage2(e)), "unread");
    }
    let oldSnap;
    try {
      oldSnap = decodeSnapshot(raw);
    } catch (e) {
      throw new SidecarReplaceRefused(unparsedSidecarMessage(path, errorMessage2(e)), "unparsed");
    }
    if (opts.allowShrink !== true) {
      const verdict = assessSidecarReplace(oldSnap, decodeSnapshot(text));
      if (!verdict.ok) {
        throw new SidecarReplaceRefused(sidecarReplaceMessage(path, verdict), "shrink");
      }
    }
  }
  writeAtomic(dest, text);
}
function persistSidecarAfterMigration(store, selection) {
  const out = defaultSidecarPath(selection);
  if (pathsAlias(out, selection.location)) return;
  const [lines, rowCount] = sidecarNdjson(store);
  try {
    writeSidecar(out, lines);
    process.stderr.write(`sidecar refreshed: ${rowCount} row(s) -> ${out}
`);
  } catch (e) {
    if (e instanceof SidecarReplaceRefused) {
      process.stderr.write(e.message);
      return;
    }
    throw e;
  }
}
function importSidecar(store, path, force = false) {
  const snapshot = decodeSnapshot(readFileSync3(path, "utf8"));
  return store.importSnapshot(snapshot, { force });
}
function emptyOptions() {
  return {
    json: false,
    "stale-only": false,
    force: false,
    note: void 0,
    format: "text",
    evidence: void 0,
    command: void 0,
    scope: [],
    num: void 0,
    blocker: void 0,
    status: "done",
    out: void 0,
    into: void 0,
    by: void 0,
    reason: void 0,
    batch: void 0,
    "max-attempts": void 0,
    "timeout-ms": void 0,
    "max-batches": void 0
  };
}
var BOOLEAN_ARGS = /* @__PURE__ */ new Set(["--json", "--stale-only", "--force"]);
var STRING_ARGS = /* @__PURE__ */ new Set([
  "--note",
  "--format",
  "--evidence",
  "--command",
  "--scope",
  "--num",
  "--blocker",
  "--status",
  "--out",
  "--into",
  "--by",
  "--reason",
  "--batch",
  "--max-attempts",
  "--timeout-ms",
  "--max-batches"
]);
function parseStrictIntInRange(raw, label, min4, max6, fallback) {
  if (raw === void 0) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    process.stderr.write(`refusing: ${label} must be a decimal integer
`);
    exitCli(2);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min4 || n > max6) {
    process.stderr.write(`refusing: ${label} must be an integer in ${min4}..${max6}
`);
    exitCli(2);
  }
  return n;
}
function isStringOption(key) {
  return STRING_ARGS.has(`--${key}`);
}
function parseCli(argv) {
  const options = emptyOptions();
  const present = /* @__PURE__ */ new Set();
  const args2 = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === void 0) continue;
    if (arg.startsWith("--")) {
      if (BOOLEAN_ARGS.has(arg)) {
        const key = arg.slice(2);
        present.add(key);
        if (key === "json" || key === "stale-only" || key === "force") {
          options[key] = true;
        }
      } else if (STRING_ARGS.has(arg) || arg === "--scope") {
        if (i + 1 >= argv.length) {
          process.stderr.write(`error: option ${arg} requires an argument
`);
          exitCli(2);
        }
        const value = argv[++i];
        if (value === void 0) {
          process.stderr.write(`error: option ${arg} requires an argument
`);
          exitCli(2);
        }
        if (arg === "--scope") {
          present.add("scope");
          options.scope.push(value);
        } else {
          const key = arg.slice(2);
          present.add(key);
          if (isStringOption(key)) options[key] = value;
        }
      } else {
        process.stderr.write(`error: unrecognized option: ${arg}
`);
        exitCli(2);
      }
    } else {
      args2.push(arg);
    }
  }
  return { args: args2, options, present };
}
function main() {
  const args2 = process.argv.slice(2);
  const cmd = args2[0];
  if (cmd === void 0) {
    process.stderr.write("refusing: missing command\n");
    exitCli(2);
  }
  if (!STORE_CMDS.has(cmd)) {
    process.stderr.write(`refusing: unknown command ${cmd}
`);
    exitCli(2);
  }
  const parsed = parseCli(args2.slice(1));
  if (cmd === "sync") {
    return runSync2(parsed);
  }
  if (cmd === "project") {
    if (parsed.present.size > 0 || parsed.args.length !== 1) {
      process.stderr.write(
        "refusing: project requires exactly register, status, or list\n"
      );
      exitCli(2);
    }
    const operation = parsed.args[0];
    if (operation !== "register" && operation !== "status" && operation !== "list") {
      process.stderr.write(
        "refusing: project requires exactly register, status, or list\n"
      );
      exitCli(2);
    }
    const registryPath = projectRegistryPath();
    if (registryPath === null) {
      process.stderr.write("refusing: FOREMAN_HOME must be absolute\n");
      exitCli(2);
    }
    if (operation === "list") {
      const loaded = loadProjectRegistryFileV1(registryPath);
      if (loaded._tag === "Invalid") {
        process.stderr.write("refusing: project registry is unavailable\n");
        exitCli(1);
      }
      writeCanonicalLine({ projects: loaded.value.projects });
      return 0;
    }
    const identity2 = currentGitProjectIdentity();
    if (identity2 === null) {
      process.stderr.write("refusing: project Git identity is unavailable\n");
      exitCli(1);
    }
    const { store, selection } = openCliStore({
      readOnly: operation === "status"
    });
    try {
      let storeLocation;
      try {
        storeLocation = realpathSync(selection.location);
      } catch {
        process.stderr.write("refusing: project store identity is unavailable\n");
        exitCli(1);
      }
      if (operation === "status") {
        const loaded2 = loadProjectRegistryFileV1(registryPath);
        if (loaded2._tag === "Invalid") {
          process.stderr.write("refusing: project registry is unavailable\n");
          exitCli(1);
        }
        const project = resolveProjectV1(loaded2.value, {
          git_common_dir: identity2.gitCommonDir,
          store_location: storeLocation
        });
        if (project !== null && store.projectId() !== null && store.projectId() !== project.project_id) {
          process.stderr.write("refusing: project store binding is conflicted\n");
          exitCli(1);
        }
        writeCanonicalLine(
          project === null ? { _tag: "Unregistered" } : { _tag: "Registered", project }
        );
        return 0;
      }
      if (!ensureProjectRegistryParent(registryPath)) {
        process.stderr.write("refusing: project registry is unavailable\n");
        exitCli(1);
      }
      const loaded = loadProjectRegistryFileV1(registryPath);
      if (loaded._tag === "Invalid") {
        process.stderr.write("refusing: project registry is unavailable\n");
        exitCli(1);
      }
      const commonMatch = loaded.value.projects.find(
        (project) => project.git_common_dir === identity2.gitCommonDir
      );
      const storeMatch = loaded.value.projects.find(
        (project) => project.store_location === storeLocation
      );
      if (commonMatch === void 0 !== (storeMatch === void 0) || commonMatch !== void 0 && commonMatch !== storeMatch) {
        process.stderr.write("refusing: project registration failed\n");
        exitCli(1);
      }
      const storedProjectId = store.projectId();
      const registeredProjectId = commonMatch?.project_id ?? null;
      if (storedProjectId !== null && registeredProjectId !== null && storedProjectId !== registeredProjectId) {
        process.stderr.write("refusing: project store binding is conflicted\n");
        exitCli(1);
      }
      const projectId = registeredProjectId ?? storedProjectId ?? randomUUID();
      try {
        store.bindProject(projectId);
      } catch {
        process.stderr.write("refusing: project store binding failed\n");
        exitCli(1);
      }
      const registered = registerProjectFileV1(registryPath, {
        project_id: projectId,
        operation_id: randomUUID(),
        git_common_dir: identity2.gitCommonDir,
        worktree_path: identity2.worktreePath,
        store_backend: selection.locationKind === "directory" ? "files-only" : "sqlite",
        store_location: storeLocation
      });
      if (registered._tag === "Refused") {
        process.stderr.write("refusing: project registration failed\n");
        exitCli(1);
      }
      writeCanonicalLine({ _tag: "Registered", project: registered.project });
      return 0;
    } finally {
      store.close();
    }
  }
  if (cmd === "begin") {
    const { store, selection } = openCliStore();
    try {
      const rec = buildRecoveryFromStore(store, recoveryGitCwd(selection));
      const sid = mintSessionId();
      try {
        store.beginSession({
          session_id: sid,
          started_ts: nowIso(),
          start_sha: gitSha(),
          note: parsed.options.note || null
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot begin session\n");
      }
      process.stdout.write(render2(rec) + "\n\n");
      process.stdout.write(`SESSION BEGUN: ${sid}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "repair") {
    const result = repairStore(dbPath());
    if (result.status === "healthy") {
      process.stdout.write("repair: store is healthy, nothing to do\n");
      return 0;
    }
    if (result.status === "failed") {
      process.stderr.write(`repair_failed ${result.renamedPath}: ${result.detail}
`);
      return 1;
    }
    process.stdout.write(`repair: moved aside ${result.renamedPath}
`);
    return 0;
  }
  if (cmd === "recover") {
    const { store, selection } = openCliStore({
      readOnly: true,
      requireSessionSource: true
    });
    try {
      const rec = buildRecoveryFromStore(store, recoveryGitCwd(selection));
      if (parsed.options.json) {
        process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      } else {
        process.stdout.write(render2(rec) + "\n");
      }
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "freshness") {
    const staleOnly = parsed.options["stale-only"];
    const { store, selection } = openCliStore({ readOnly: true });
    try {
      const measurements = buildFreshnessFromStore(
        store,
        staleOnly,
        recoveryGitCwd(selection)
      );
      process.stdout.write(renderFreshness(measurements, parsed.options.format) + "\n");
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "end") {
    const { store } = openCliStore();
    try {
      const sid = parsed.args[0] || currentSessionId(store);
      if (!sid) {
        process.stderr.write("no open session\n");
        exitCli(2);
      }
      try {
        store.endSession(sid, nowIso());
      } catch (e) {
        if (reasonOf(e) === "supersession_incomplete") {
          process.stderr.write(`refusing: session ${sid} is already ended; ended_ts is set-once
`);
          exitCli(2);
        }
        refuseFromPort(e, "no open session\n", ["invalid_argument"]);
      }
      process.stdout.write(`session ended: ${sid}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "fact") {
    const evidence = parsed.options.evidence || null;
    const { store } = openCliStore();
    try {
      const statement = requirePositional(parsed.args, 0, "STATEMENT");
      let row;
      try {
        row = store.addFact({
          statement,
          evidence,
          established_ts: nowIso(),
          session_id: currentSessionId(store)
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot add fact\n");
      }
      process.stdout.write(`fact ${row.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "measure") {
    const command = parsed.options.command || null;
    const { store } = openCliStore();
    try {
      if (parsed.options.scope.length === 0) {
        process.stderr.write(
          "refusing: --scope is required. A measurement with no path scope can never be shown stale, which is the entire point.\n"
        );
        exitCli(2);
      }
      const metric = parsed.args[0];
      const value = parsed.args[1];
      if (metric === void 0 || value === void 0) {
        process.stderr.write("refusing: measure requires METRIC and VALUE\n");
        exitCli(2);
      }
      let vnum = null;
      if (parsed.options.num !== void 0) vnum = parseFloat(parsed.options.num);
      else vnum = scalarOf(value);
      let row;
      try {
        row = store.addMeasurement({
          metric,
          value,
          value_num: vnum,
          command,
          measured_ts: nowIso(),
          measured_sha: gitSha(),
          scope_paths: parsed.options.scope.join("\n"),
          session_id: currentSessionId(store)
        });
      } catch (e) {
        refuseFromPort(e, "refusing: --num must be a finite number\n");
      }
      process.stdout.write(`measurement ${row.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "obligation") {
    const blocker = parsed.options.blocker || null;
    const { store } = openCliStore();
    try {
      const statement = requirePositional(parsed.args, 0, "STATEMENT");
      let row;
      try {
        row = store.addObligation({
          statement,
          blocker,
          opened_ts: nowIso(),
          session_id: currentSessionId(store)
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot add obligation\n");
      }
      process.stdout.write(`obligation ${row.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "close") {
    const status = parsed.options.status;
    const { store } = openCliStore();
    try {
      const obligationId = parseInt(requirePositional(parsed.args, 0, "OBLIGATION_ID"), 10);
      if (parsed.options.blocker !== void 0) {
        process.stderr.write("refusing: --blocker is not valid with close\n");
        exitCli(2);
      }
      if (status !== "done" && status !== "dropped") {
        process.stderr.write(`refusing: --status must be done or dropped, got ${JSON.stringify(status)}
`);
        exitCli(2);
      }
      try {
        store.closeObligation(obligationId, status, nowIso());
      } catch (e) {
        refuseFromPort(
          e,
          `refusing: obligation ${obligationId} is not open; only an open obligation may be closed
`
        );
      }
      process.stdout.write(`obligation ${obligationId} -> ${status}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "sidecar") {
    const { store, selection } = openCliStore({ readOnly: true });
    const outPath = parsed.options.out || defaultSidecarPath(selection);
    try {
      if (pathsAlias(outPath, selection.location)) {
        process.stderr.write(
          `refusing: sidecar output ${outPath} aliases the session store ${selection.location}
`
        );
        exitCli(2);
      }
      const [lines, rowCount] = sidecarNdjson(store);
      writeSidecar(outPath, lines, { allowShrink: parsed.options.force });
      process.stdout.write(`dumped ${rowCount} row(s) -> ${outPath}
`);
      return 0;
    } catch (e) {
      if (e instanceof SidecarReplaceRefused) {
        process.stderr.write(e.message);
        exitCli(2);
      }
      process.stderr.write(`refusing: cannot write sidecar ${outPath}: ${errorMessage2(e)}
`);
      exitCli(2);
    } finally {
      store.close();
    }
  }
  if (cmd === "import-sidecar") {
    const explicitInto = parsed.options.into;
    if (explicitInto !== void 0) {
      const store2 = openExplicitSqliteImportTarget(explicitInto);
      try {
        const path = requirePositional(parsed.args, 0, "PATH");
        const count = importSidecar(store2, path, parsed.options.force);
        process.stdout.write(`imported ${count} document(s) -> ${explicitInto}
`);
        return 0;
      } catch (e) {
        if (e instanceof CliRefusal) throw e;
        process.stderr.write(`refusing: ${errorMessage2(e)}
`);
        exitCli(2);
      } finally {
        store2.close();
      }
    }
    const { store, selection } = openCliStore();
    try {
      const path = requirePositional(parsed.args, 0, "PATH");
      const count = importSidecar(store, path, parsed.options.force);
      process.stdout.write(`imported ${count} document(s) -> ${selection.location}
`);
      return 0;
    } catch (e) {
      if (e instanceof CliRefusal) throw e;
      process.stderr.write(`refusing: ${errorMessage2(e)}
`);
      exitCli(2);
    } finally {
      store.close();
    }
  }
  if (cmd === "supersede") {
    const evidence = parsed.options.evidence || null;
    const { store } = openCliStore();
    try {
      const factId = parseInt(requirePositional(parsed.args, 0, "FACT_ID"), 10);
      const statement = requirePositional(parsed.args, 1, "STATEMENT");
      const reason = parsed.options.reason;
      if (!reason) {
        process.stderr.write("error: option --reason requires an argument\n");
        exitCli(2);
      }
      let res;
      try {
        res = store.supersedeFact(
          factId,
          { statement, evidence, established_ts: nowIso(), session_id: currentSessionId(store) },
          reason,
          nowIso()
        );
      } catch (e) {
        if (reasonOf(e) === "supersession_incomplete") {
          process.stderr.write(
            `refusing: fact ${factId} is already superseded; supersession columns are set-once
`
          );
          exitCli(2);
        }
        refuseFromPort(
          e,
          `refusing: cannot supersede fact ${factId}: it does not exist or is already superseded
`,
          ["invalid_argument"]
        );
      }
      process.stdout.write(`fact ${factId} superseded by ${res.replacement.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "retire") {
    const { store } = openCliStore();
    try {
      const measurementId = parseInt(requirePositional(parsed.args, 0, "MEASUREMENT_ID"), 10);
      const byId = parseInt(parsed.options.by ?? "", 10);
      const reason = parsed.options.reason;
      if (Number.isNaN(byId)) {
        process.stderr.write("error: option --by requires an argument\n");
        exitCli(2);
      }
      if (!reason) {
        process.stderr.write("error: option --reason requires an argument\n");
        exitCli(2);
      }
      if (byId === measurementId) {
        process.stderr.write("refusing: a measurement cannot supersede itself\n");
        exitCli(2);
      }
      const rows = store.listMeasurements();
      if (!rows.some((r) => r.id === measurementId)) {
        process.stderr.write(`refusing: no measurement ${measurementId} to retire
`);
        exitCli(2);
      }
      const by = rows.find((r) => r.id === byId);
      if (!by) {
        process.stderr.write(`refusing: no measurement ${byId} to supersede it
`);
        exitCli(2);
      }
      if (by.superseded_by !== null) {
        process.stderr.write(
          `refusing: measurement ${byId} is itself superseded by ${by.superseded_by}. A retired measurement cannot supersede another one.
`
        );
        exitCli(2);
      }
      try {
        store.retireMeasurement(measurementId, byId, reason, nowIso());
      } catch (e) {
        refuseFromPort(e, `refusing: measurement ${measurementId} is already superseded
`, [
          "supersession_incomplete"
        ]);
      }
      process.stdout.write(`measurement ${measurementId} retired, superseded by ${byId}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  exitCli(2);
}
async function runSync2(parsed) {
  if (parsed.args.length > 0) {
    process.stderr.write("refusing: sync accepts no positional arguments\n");
    exitCli(2);
  }
  for (const key of parsed.present) {
    if (!SYNC_ALLOWED_OPTIONS.has(key)) {
      process.stderr.write(`refusing: sync does not accept --${key}
`);
      exitCli(2);
    }
  }
  const opts = {
    batch: parseStrictIntInRange(parsed.options.batch, "--batch", 1, 1e3, 100),
    maxAttempts: parseStrictIntInRange(
      parsed.options["max-attempts"],
      "--max-attempts",
      1,
      10,
      3
    ),
    timeoutMs: parseStrictIntInRange(
      parsed.options["timeout-ms"],
      "--timeout-ms",
      1,
      3e5,
      5e3
    ),
    maxBatches: parseStrictIntInRange(
      parsed.options["max-batches"],
      "--max-batches",
      1,
      1e4,
      100
    )
  };
  const { store } = openCliStore();
  const index = syncTestDeps?.index ?? new NullMemoryIndex();
  const drain = syncTestDeps?.drain ?? drainOutbox;
  try {
    const exit4 = await Effect_exports.runPromiseExit(drain(store, index, opts));
    if (Exit_exports.isSuccess(exit4)) {
      const result = exit4.value;
      process.stdout.write(
        `synced ${result.projected} record(s) to ${index.name} in ${result.attempts} attempt(s)
`
      );
      return 0;
    }
    const squashed = Cause_exports.squash(exit4.cause);
    let reason = "failed";
    let projected = 0;
    let attempts = 0;
    let batches = 0;
    if (squashed !== null && typeof squashed === "object" && "_tag" in squashed && squashed._tag === "OutboxDrainFailure") {
      const f = squashed;
      reason = f.reason;
      projected = f.projected;
      attempts = f.attempts;
      batches = f.batches;
    }
    process.stderr.write(
      `refusing: sync failed (${reason}; projected=${projected} attempts=${attempts} batches=${batches})
`
    );
    return 1;
  } finally {
    store.close();
  }
}
async function mainWithSidecar() {
  let rc = 0;
  try {
    rc = await Promise.resolve(main()) || 0;
  } catch (e) {
    if (e instanceof CliRefusal) {
      process.exit(e.exitCode);
    }
    const code = e instanceof Error && "code" in e ? String(e.code) : "";
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
      process.stderr.write(`error: ${errorMessage2(e)}
`);
      rc = 2;
    } else {
      throw e;
    }
  }
  const invoked = process.argv[2];
  if (rc !== 0 || process.argv.length < 3 || invoked !== void 0 && READ_ONLY_CMDS.has(invoked) || invoked !== void 0 && NO_SIDECAR_REFRESH_CMDS.has(invoked)) {
    process.exit(rc);
  }
  let selection;
  let refreshStore;
  let out = "";
  try {
    refreshStore = openSessionStore({
      readOnly: true,
      defaultSqlitePath: dbPath,
      onSelected: (sel) => {
        selection = sel;
      },
      prepareSqlite: (path, access) => {
        mkdirSync3(dirname3(path), { recursive: true });
        bootstrapStore(path, access);
      }
    });
    if (selection === void 0) {
      throw new Error("session store reopened without a selection");
    }
    out = defaultSidecarPath(selection);
    if (!pathsAlias(out, selection.location)) {
      const [lines, rowCount] = sidecarNdjson(refreshStore);
      const allowShrink = process.argv.includes("--force") && (invoked === "import-sidecar" || invoked === "sidecar");
      writeSidecar(out, lines, { allowShrink });
      process.stderr.write(`sidecar refreshed: ${rowCount} row(s) -> ${out}
`);
    }
  } catch (e) {
    if (e instanceof SidecarReplaceRefused) {
      const remedy = e.kind === "shrink" ? `Run \`fm-session sidecar --force\` to dump the store over the tracked record, or \`fm-session import-sidecar ${out} --force\` to restore the tracked record into the store.` : `The existing sidecar could not be decoded, so --force cannot overwrite it. Dump the store to a new file with \`fm-session sidecar --out <fresh-path>\`.`;
      process.stderr.write(
        `WARNING: the store was written but its sidecar could not be refreshed (${e}). The tracked record is now BEHIND the database. ${remedy}
`
      );
    } else {
      process.stderr.write(
        `WARNING: the store was written but its sidecar could not be refreshed (${e}). The store write already committed. Re-running this write will duplicate the row. Clear the sidecar fault, then run \`fm-session sidecar --force\` to dump the store over the tracked record.
`
      );
      rc = 1;
    }
  } finally {
    refreshStore?.close();
  }
  process.exit(rc);
}
var invokedDirectly = process.argv[1] !== void 0 && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void mainWithSidecar().catch((e) => {
    process.stderr.write(`refusing: ${errorMessage2(e)}
`);
    process.exit(1);
  });
}
export {
  CliRefusal,
  SidecarReplaceRefused,
  assessSidecarReplace,
  importSidecar,
  main,
  setSyncTestDeps,
  sidecarNdjson,
  writeAtomic
};
