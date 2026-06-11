/**
 * Minimal runtime validator — the small slice of the `zod` API this codebase
 * uses, reimplemented to drop the dependency. This guards the UNTRUSTED-RELAY
 * boundary (see `wireSchemas.ts`), so the security-relevant semantics are
 * preserved EXACTLY and deliberately:
 *
 *   - `.strict()` objects REJECT unknown keys (an attacker can't smuggle extra
 *     fields a later handler might read). Non-strict objects strip them, like zod.
 *   - string `.min`/`.max` bound `.length` (UTF-16 units, same as zod).
 *   - `.array().max(n)` caps element count; `number().int()` rejects
 *     non-integers / NaN / Infinity; `literal`/`enum` require exact matches.
 *   - `.optional()` permits `undefined` (absent key) but validates when present.
 *
 * `safeParse` returns zod's shape: `{ success, data }` | `{ success, error }`,
 * where `error` exposes BOTH `.issues` (used by `wireSchemas.safeParse`) and
 * `.errors` (used by `CreateCommunityModal`), each an array of
 * `{ path, message }`. Equivalence to the prior zod behavior is exercised by
 * `scripts/validate-compat.mjs`.
 */

type Path = (string | number)[];
export interface Issue {
  path: Path;
  message: string;
}
type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Issue[]; errors: Issue[] } };

export interface Schema<T> {
  _parse(value: unknown, path: Path): ParseResult<T>;
  safeParse(value: unknown): SafeParseResult<T>;
  parse(value: unknown): T;
  optional(): Schema<T | undefined>;
}

type Infer<S> = S extends Schema<infer T> ? T : never;
type ShapeOutput<Shape extends Record<string, Schema<unknown>>> = {
  [K in keyof Shape]: Infer<Shape[K]>;
};

const fail = (path: Path, message: string): ParseResult<never> => ({
  ok: false,
  issues: [{ path, message }],
});

abstract class BaseSchema<T> implements Schema<T> {
  abstract _parse(value: unknown, path: Path): ParseResult<T>;

  safeParse(value: unknown): SafeParseResult<T> {
    const r = this._parse(value, []);
    if (r.ok) return { success: true, data: r.value };
    return { success: false, error: { issues: r.issues, errors: r.issues } };
  }

  parse(value: unknown): T {
    const r = this.safeParse(value);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'Invalid input');
    return r.data;
  }

  optional(): Schema<T | undefined> {
    return new OptionalSchema(this);
  }
}

class OptionalSchema<T> extends BaseSchema<T | undefined> {
  private readonly inner: Schema<T>;
  constructor(inner: Schema<T>) {
    super();
    this.inner = inner;
  }
  _parse(value: unknown, path: Path): ParseResult<T | undefined> {
    if (value === undefined) return { ok: true, value: undefined };
    return this.inner._parse(value, path);
  }
}

type StringCheck = (v: string, path: Path) => Issue | null;

class StringSchema extends BaseSchema<string> {
  private checks: StringCheck[] = [];
  _parse(value: unknown, path: Path): ParseResult<string> {
    if (typeof value !== 'string') return fail(path, 'Expected string');
    for (const check of this.checks) {
      const issue = check(value, path);
      if (issue) return { ok: false, issues: [issue] };
    }
    return { ok: true, value };
  }
  min(n: number): this {
    this.checks.push((v, p) =>
      v.length < n ? { path: p, message: `String must contain at least ${n} character(s)` } : null,
    );
    return this;
  }
  max(n: number): this {
    this.checks.push((v, p) =>
      v.length > n ? { path: p, message: `String must contain at most ${n} character(s)` } : null,
    );
    return this;
  }
  regex(re: RegExp): this {
    this.checks.push((v, p) => (re.test(v) ? null : { path: p, message: 'Invalid' }));
    return this;
  }
}

class NumberSchema extends BaseSchema<number> {
  private mustBeInt = false;
  _parse(value: unknown, path: Path): ParseResult<number> {
    if (typeof value !== 'number' || Number.isNaN(value)) return fail(path, 'Expected number');
    if (this.mustBeInt && !Number.isInteger(value)) return fail(path, 'Expected integer');
    return { ok: true, value };
  }
  int(): this {
    this.mustBeInt = true;
    return this;
  }
}

class BooleanSchema extends BaseSchema<boolean> {
  _parse(value: unknown, path: Path): ParseResult<boolean> {
    if (typeof value !== 'boolean') return fail(path, 'Expected boolean');
    return { ok: true, value };
  }
}

class LiteralSchema<T extends string | number | boolean> extends BaseSchema<T> {
  private readonly literal: T;
  constructor(literal: T) {
    super();
    this.literal = literal;
  }
  _parse(value: unknown, path: Path): ParseResult<T> {
    if (value !== this.literal) return fail(path, `Invalid literal value, expected ${JSON.stringify(this.literal)}`);
    return { ok: true, value: this.literal };
  }
}

class EnumSchema<T extends string> extends BaseSchema<T> {
  private readonly values: readonly T[];
  private readonly set: Set<string>;
  constructor(values: readonly T[]) {
    super();
    this.values = values;
    this.set = new Set(values);
  }
  _parse(value: unknown, path: Path): ParseResult<T> {
    if (typeof value !== 'string' || !this.set.has(value)) {
      return fail(path, `Invalid enum value. Expected one of: ${this.values.join(', ')}`);
    }
    return { ok: true, value: value as T };
  }
}

class ArraySchema<T> extends BaseSchema<T[]> {
  private maxLen = Infinity;
  private readonly element: Schema<T>;
  constructor(element: Schema<T>) {
    super();
    this.element = element;
  }
  _parse(value: unknown, path: Path): ParseResult<T[]> {
    if (!Array.isArray(value)) return fail(path, 'Expected array');
    if (value.length > this.maxLen) {
      return fail(path, `Array must contain at most ${this.maxLen} element(s)`);
    }
    const out: T[] = [];
    for (let i = 0; i < value.length; i++) {
      const r = this.element._parse(value[i], [...path, i]);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  max(n: number): this {
    this.maxLen = n;
    return this;
  }
}

class ObjectSchema<Shape extends Record<string, Schema<unknown>>> extends BaseSchema<ShapeOutput<Shape>> {
  private isStrict = false;
  private readonly shape: Shape;
  constructor(shape: Shape) {
    super();
    this.shape = shape;
  }
  _parse(value: unknown, path: Path): ParseResult<ShapeOutput<Shape>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail(path, 'Expected object');
    }
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this.shape)) {
      const r = this.shape[key]._parse(input[key], [...path, key]);
      if (!r.ok) return r;
      // Only emit keys that are actually present (mirrors zod: absent optional
      // fields stay absent rather than becoming explicit `undefined`).
      if (key in input || r.value !== undefined) out[key] = r.value;
    }
    if (this.isStrict) {
      for (const key of Object.keys(input)) {
        if (!(key in this.shape)) {
          return fail([...path, key], `Unrecognized key(s) in object: '${key}'`);
        }
      }
    }
    return { ok: true, value: out as ShapeOutput<Shape> };
  }
  strict(): this {
    this.isStrict = true;
    return this;
  }
}

export const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  literal: <T extends string | number | boolean>(value: T) => new LiteralSchema(value),
  enum: <T extends string>(values: readonly T[]) => new EnumSchema(values),
  array: <T>(element: Schema<T>) => new ArraySchema(element),
  object: <Shape extends Record<string, Schema<unknown>>>(shape: Shape) => new ObjectSchema(shape),
};
